import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabase, isCloudEnabled } from '../lib/supabase'
import { resetBankStore } from './bankStore'
import { resetSettingsStore, adoptUserKeys } from './settingsStore'
import { resetAnnouncementStore } from './announcementStore'
import { resetAssetStore } from '../utils/assetStore'

// Remove every localStorage key whose name starts with any of these prefixes.
// Used to clear per-user residue that the store-reset helpers don't own:
//   • sync-outbox — holds full row snapshots of unsynced writes (a global key
//     here was a cross-tenant leak; now per-user, but still purged for hygiene
//     plus the legacy pre-namespacing key)
//   • draft       — Playground/other app editor state (prompt text + uploaded
//     image data-URIs), keyed `ai-ugc-lab:draft:*`
//   • custom-chips — Character Studio custom trait chips
// All of these otherwise survive sign-out and surface for the next person.
// Deliberately NOT listed: `ai-ugc-lab-keys`, the per-user API-key vault. It is
// keyed by user id and adopted only by its own owner (see settingsStore), so it
// can't surface for the next person — and purging it here would put the member
// back to re-pasting both keys on every sign-in. Don't widen these prefixes to
// a bare `ai-ugc-lab`.
const LOCAL_RESIDUE_PREFIXES = ['ugc-lab:sync-outbox', 'ai-ugc-lab:draft', 'ai-ugc-lab-custom-chips']

function clearLocalResidue(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && LOCAL_RESIDUE_PREFIXES.some((p) => k.startsWith(p))) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch { /* localStorage unavailable — nothing to clear */ }
}

// Wipe every local trace of the current user — banks, settings, IndexedDB
// blobs, the sync outbox, app drafts, and their localStorage snapshots — so the
// next person to sign in on this browser starts from a clean slate. Cloud data
// is untouched; the next sign-in re-hydrates from Supabase + R2.
async function wipeLocalUserData(): Promise<void> {
  resetBankStore()
  resetSettingsStore()
  // Announcements are global, but WHICH ones this account had read is not —
  // leaving the receipts behind would hide the dot for the next person.
  resetAnnouncementStore()
  clearLocalResidue()
  await resetAssetStore()
}

// Where a Supabase password-recovery link lands. Registered in the project's
// Auth → URL Configuration → Redirect URLs, and passed as `redirectTo`.
export const RECOVERY_PATH = '/reset-password'

// Whether THIS page load arrived on a recovery link. Read at module scope on
// purpose: by the time a component renders, neither half of the evidence is
// still there to read — supabase-js consumes the token out of the URL as soon
// as the client is created, and RouterSync rewrites any unrecognised path to
// /dashboard. The path is the primary signal (it survives both auth flows);
// the hash check is the belt-and-braces for a link that redirected to the
// site root instead.
const RECOVERY_ON_LOAD =
  typeof window !== 'undefined' &&
  (window.location.pathname === RECOVERY_PATH || window.location.hash.includes('type=recovery'))

export interface ProfileRow {
  id: string
  email: string
  display_name: string | null
  first_name: string | null
  last_name: string | null
  is_admin: boolean
  disabled_at: string | null
  // Set while a cancelled member is locked out (migration 0023). Unlike
  // disabled_at this is a door they can open themselves, by entering the
  // current shared access code — see redeemAccessCode.
  lapsed_at: string | null
  per_app_model: Record<string, string>
  active_project_id: string | null
  tos_accepted_at: string | null
  privacy_accepted_at: string | null
  aup_accepted_at: string | null
  policy_version_accepted: string | null
}

interface AuthState {
  // Hydration runs once on app start: read existing session, fetch profile.
  // While `bootstrapping` is true, AuthGate shows a spinner instead of the
  // login screen — avoids a flash of "logged out" for already-signed-in users.
  bootstrapping: boolean

  session: Session | null
  user: User | null
  profile: ProfileRow | null

  // True when the last sign-in attempt (or a stale session on load) belonged to
  // a disabled account. AuthScreen reads this to show the "members only" Skool
  // popup instead of a generic error. Cleared by clearAccessRevoked().
  accessRevoked: boolean

  // True when this page load arrived on a password-recovery link. AuthGate
  // renders the set-a-new-password screen on it INSTEAD of the workspace —
  // the link carries a real session, so without this the member would land
  // straight in the app with the password they can't remember still set.
  recovery: boolean

  bootstrap: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string; revoked?: boolean }>
  signUp: (email: string, password: string, firstName: string, lastName: string, signupCode: string) => Promise<{ ok: true; needsConfirm: boolean } | { ok: false; error: string }>
  signOut: () => Promise<void>
  clearAccessRevoked: () => void
  // Leaves the recovery screen without touching whatever session this browser
  // already had — deliberately NOT signOut(), which would sign out a member
  // who merely opened someone's expired link in their own browser.
  exitRecovery: () => void
  // Sends the reset email. Resolves ok even for an address with no account —
  // the response must not tell a stranger which emails are registered.
  requestPasswordReset: (email: string) => Promise<{ ok: true } | { ok: false; error: string }>
  // Sets the new password using the session the recovery link established,
  // then drops out of recovery mode.
  completePasswordReset: (password: string) => Promise<{ ok: true } | { ok: false; error: string }>
  // A lapsed member's own way back in: checked server-side against the current
  // shared access code (migration 0023), throttled to 5 tries an hour.
  redeemAccessCode: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>
  refreshProfile: () => Promise<void>
  // Sets the preferred name the app greets the user by (profiles.display_name).
  // Optimistic: updates local state first, then persists; reverts on failure.
  updateDisplayName: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>
  // Stamps tos/privacy/aup acceptance + policy version. Used on signup and
  // when an existing user re-accepts after a POLICY_VERSION bump.
  acceptPolicies: (version: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

// Column sets tried widest-first. Selecting a column a not-yet-applied
// migration hasn't created fails the whole query (42703), so each tier drops
// one migration's worth of columns and retries — an environment running behind
// on SQL degrades a feature instead of locking every member out of sign-in.
const PROFILE_COL_TIERS = [
  'id, email, display_name, first_name, last_name, is_admin, disabled_at, lapsed_at, per_app_model, active_project_id, tos_accepted_at, privacy_accepted_at, aup_accepted_at, policy_version_accepted',
  // …without 0023's lapsed status
  'id, email, display_name, first_name, last_name, is_admin, disabled_at, per_app_model, active_project_id, tos_accepted_at, privacy_accepted_at, aup_accepted_at, policy_version_accepted',
  // …without 0007's legal-acceptance columns either. LegalAcceptModal fires as
  // soon as that migration eventually runs.
  'id, email, display_name, is_admin, disabled_at, per_app_model, active_project_id',
]

// Backfilled onto whatever the surviving tier didn't ask for, so callers always
// get the shape ProfileRow promises.
const MISSING_PROFILE_DEFAULTS = {
  first_name: null,
  last_name: null,
  lapsed_at: null,
  tos_accepted_at: null,
  privacy_accepted_at: null,
  aup_accepted_at: null,
  policy_version_accepted: null,
}

function isMissingColumnError(error: { message: string; code?: string } | null): boolean {
  if (!error) return false
  return /column .* does not exist|42703/i.test(`${error.message} ${error.code ?? ''}`)
}

async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const sb = getSupabase()
  for (let tier = 0; tier < PROFILE_COL_TIERS.length; tier++) {
    const { data, error } = await sb
      .from('profiles')
      .select(PROFILE_COL_TIERS[tier])
      .eq('id', userId)
      .maybeSingle()
    if (!error) {
      if (!data) return null
      // The select list is a runtime string, so supabase-js can't infer a row
      // type for it — hence the double cast rather than a plain one.
      return { ...MISSING_PROFILE_DEFAULTS, ...(data as unknown as Record<string, unknown>) } as unknown as ProfileRow
    }
    const last = tier === PROFILE_COL_TIERS.length - 1
    if (last || !isMissingColumnError(error as { message: string; code?: string })) {
      console.error('[auth] fetchProfile failed', error)
      return null
    }
    console.warn(`[auth] profile columns missing at tier ${tier} — run the latest migrations. Falling back.`)
  }
  return null
}

export const useAuthStore = create<AuthState>((set, get) => ({
  bootstrapping: isCloudEnabled(),
  session: null,
  user: null,
  profile: null,
  accessRevoked: false,
  recovery: RECOVERY_ON_LOAD,

  bootstrap: async () => {
    if (!isCloudEnabled()) {
      set({ bootstrapping: false })
      return
    }
    const sb = getSupabase()
    const { data } = await sb.auth.getSession()
    const session = data.session ?? null
    const user = session?.user ?? null
    let profile: ProfileRow | null = null
    if (user) {
      profile = await fetchProfile(user.id)
      // If admin removed the user from allowlist, sign them out immediately
      // and flag it so AuthScreen shows the "members only" popup.
      if (profile?.disabled_at) {
        await sb.auth.signOut()
        await wipeLocalUserData()
        set({ session: null, user: null, profile: null, accessRevoked: true, bootstrapping: false })
        return
      }
    }
    set({ session, user, profile, bootstrapping: false })
    // Restore this member's own API keys (see the vault note in settingsStore):
    // they survive the sign-out wipe, so a returning member doesn't re-paste.
    if (user) adoptUserKeys(user.id)

    // Keep state in sync with auth changes (other-tab sign-in, refresh, etc.)
    sb.auth.onAuthStateChange(async (event, nextSession) => {
      // Belt-and-braces beside RECOVERY_ON_LOAD: this fires only if the client
      // was created before the URL was consumed, which the lazy getSupabase()
      // usually means it wasn't.
      if (event === 'PASSWORD_RECOVERY') set({ recovery: true })
      const prevUserId = get().user?.id
      const nextUser = nextSession?.user ?? null
      let nextProfile: ProfileRow | null = null
      if (nextUser) {
        nextProfile = await fetchProfile(nextUser.id)
        if (nextProfile?.disabled_at) {
          await sb.auth.signOut()
          await wipeLocalUserData()
          set({ session: null, user: null, profile: null, accessRevoked: true })
          return
        }
      }
      // If the user changed (sign-out or account swap in another tab), wipe
      // every trace of the previous user before letting cloudSync hydrate
      // the next account.
      if (prevUserId && prevUserId !== nextUser?.id) {
        await wipeLocalUserData()
      }
      set({ session: nextSession, user: nextUser, profile: nextProfile })
      // After any wipe, never before — the incoming member adopts their own
      // vaulted keys, which is also what stops them adopting the outgoing one's.
      if (nextUser) adoptUserKeys(nextUser.id)
    })
  },

  signIn: async (email, password) => {
    if (!isCloudEnabled()) return { ok: false, error: 'Cloud not configured.' }
    const sb = getSupabase()
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password })
    if (error) return { ok: false, error: error.message }
    if (data.user) {
      const profile = await fetchProfile(data.user.id)
      if (profile?.disabled_at) {
        await sb.auth.signOut()
        set({ accessRevoked: true })
        return { ok: false, error: 'Your access has been revoked.', revoked: true }
      }
      set({ session: data.session, user: data.user, profile, accessRevoked: false })
      adoptUserKeys(data.user.id)
    }
    return { ok: true }
  },

  clearAccessRevoked: () => set({ accessRevoked: false }),

  exitRecovery: () => {
    window.history.replaceState(null, '', '/')
    set({ recovery: false })
  },

  requestPasswordReset: async (email) => {
    if (!isCloudEnabled()) return { ok: false, error: 'Cloud not configured.' }
    const sb = getSupabase()
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}${RECOVERY_PATH}`,
    })
    // Supabase answers success for an address with no account, which is what
    // keeps this from being a "does this email have one?" oracle. What DOES
    // land here is a rate limit or a transport failure — worth showing, or the
    // member sits waiting for mail that was never sent.
    if (error) return { ok: false, error: prettifyAuthError(error.message) }
    return { ok: true }
  },

  completePasswordReset: async (password) => {
    if (!isCloudEnabled()) return { ok: false, error: 'Cloud not configured.' }
    const sb = getSupabase()
    const { error } = await sb.auth.updateUser({ password })
    if (error) return { ok: false, error: prettifyAuthError(error.message) }
    // Take the recovery token out of the address bar before leaving recovery
    // mode, or a refresh drops straight back into this screen.
    window.history.replaceState(null, '', '/')
    const { data } = await sb.auth.getSession()
    const session = data.session ?? null
    const user = session?.user ?? null
    const profile = user ? await fetchProfile(user.id) : null
    set({ session, user, profile, recovery: false })
    if (user) adoptUserKeys(user.id)
    return { ok: true }
  },

  redeemAccessCode: async (code) => {
    const user = get().user
    if (!isCloudEnabled() || !user) return { ok: false, error: 'Not signed in.' }
    const sb = getSupabase()
    const { data, error } = await sb.rpc('redeem_access_code', { code: code.trim() })
    if (error) {
      // 42883 — the function isn't there, i.e. migration 0023 hasn't been run
      // in this environment. Say something a member can act on rather than
      // showing them a Postgres error.
      if (/could not find the function|42883/i.test(`${error.message} ${error.code ?? ''}`)) {
        return { ok: false, error: 'Re-entry by code isn’t set up yet. Ask in the community to be reinstated.' }
      }
      return { ok: false, error: error.message }
    }
    const verdict = data as { ok?: boolean; error?: string } | null
    if (!verdict?.ok) {
      return { ok: false, error: verdict?.error ?? 'That access code is incorrect.' }
    }
    await get().refreshProfile()
    return { ok: true }
  },

  signUp: async (email, password, firstName, lastName, signupCode) => {
    if (!isCloudEnabled()) return { ok: false, error: 'Cloud not configured.' }
    const sb = getSupabase()
    // Names ride along as user metadata; the on_auth_user_created trigger reads
    // them into the profile when the allowlist has no name for this email (e.g.
    // they signed up with a different email than their Skool one).
    //
    // The access code rides the same way and is checked by enforce_allowlist
    // (migration 0021), which strips it back off the row. It is deliberately
    // NOT validated here: the expected value lives in app_config, never in the
    // bundle, so nobody can read it out of the shipped JS.
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          signup_code: signupCode.trim(),
        },
      },
    })
    if (error) {
      // Surface our allowlist-trigger message verbatim — that's the friendly
      // "not on access list" copy.
      return { ok: false, error: prettifyAuthError(error.message) }
    }
    // If email confirmation is enabled in Supabase, session is null and the
    // user has to click a link before they can log in.
    const needsConfirm = !data.session
    if (data.session && data.user) {
      const profile = await fetchProfile(data.user.id)
      set({ session: data.session, user: data.user, profile })
    }
    return { ok: true, needsConfirm }
  },

  signOut: async () => {
    if (!isCloudEnabled()) return
    const sb = getSupabase()
    await sb.auth.signOut()
    await wipeLocalUserData()
    set({ session: null, user: null, profile: null })
  },

  refreshProfile: async () => {
    const user = get().user
    if (!user) return
    const profile = await fetchProfile(user.id)
    set({ profile })
  },

  updateDisplayName: async (name) => {
    const user = get().user
    if (!isCloudEnabled() || !user) return { ok: false, error: 'Not signed in.' }
    const trimmed = name.trim()
    const value = trimmed.length > 0 ? trimmed : null
    const prev = get().profile
    // Optimistic local update so the greeting reflects the change instantly.
    if (prev) set({ profile: { ...prev, display_name: value } })
    const sb = getSupabase()
    const { error } = await sb
      .from('profiles')
      .update({ display_name: value })
      .eq('id', user.id)
    if (error) {
      if (prev) set({ profile: prev }) // revert
      return { ok: false, error: error.message }
    }
    return { ok: true }
  },

  acceptPolicies: async (version) => {
    const user = get().user
    if (!isCloudEnabled() || !user) return { ok: false, error: 'Not signed in.' }
    const sb = getSupabase()
    const now = new Date().toISOString()
    const { error } = await sb
      .from('profiles')
      .update({
        tos_accepted_at: now,
        privacy_accepted_at: now,
        aup_accepted_at: now,
        policy_version_accepted: version,
      })
      .eq('id', user.id)
    if (error) return { ok: false, error: error.message }
    const profile = await fetchProfile(user.id)
    set({ profile })
    return { ok: true }
  },
}))

function prettifyAuthError(message: string): string {
  // Postgres trigger errors come back with the `P0001` prefix stripped; we
  // recognise our specific phrases and clean them up. Everything else passes
  // through so kie/Supabase errors stay debuggable.
  if (/not on the access list/i.test(message)) {
    return "This email isn't on the access list. Join the Skool community first, then try again."
  }
  if (/access code/i.test(message)) {
    return 'That access code is incorrect. You can find it in the Skool community.'
  }
  // Supabase throttles reset mail per address and per project. Both come back
  // as prose about seconds or rate limits; neither is worth showing raw.
  if (/rate limit|only request this after|too many requests/i.test(message)) {
    return 'Too many reset emails just went out. Wait a minute, then try again.'
  }
  if (/should be different from the old password/i.test(message)) {
    return 'That is already your password. Pick a different one.'
  }
  // Some GoTrue versions swallow a signup trigger's own message and return this
  // generic one instead, so name both things it can be rather than leaving the
  // member staring at "Database error".
  if (/database error saving new user/i.test(message)) {
    return "Couldn't create your account. Check your access code, and that you're signing up with the email you use on Skool."
  }
  return message
}
