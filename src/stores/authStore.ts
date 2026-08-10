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

export interface ProfileRow {
  id: string
  email: string
  display_name: string | null
  first_name: string | null
  last_name: string | null
  is_admin: boolean
  disabled_at: string | null
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

  bootstrap: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: string; revoked?: boolean }>
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<{ ok: true; needsConfirm: boolean } | { ok: false; error: string }>
  signOut: () => Promise<void>
  clearAccessRevoked: () => void
  refreshProfile: () => Promise<void>
  // Sets the preferred name the app greets the user by (profiles.display_name).
  // Optimistic: updates local state first, then persists; reverts on failure.
  updateDisplayName: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>
  // Stamps tos/privacy/aup acceptance + policy version. Used on signup and
  // when an existing user re-accepts after a POLICY_VERSION bump.
  acceptPolicies: (version: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const sb = getSupabase()
  const fullCols = 'id, email, display_name, first_name, last_name, is_admin, disabled_at, per_app_model, active_project_id, tos_accepted_at, privacy_accepted_at, aup_accepted_at, policy_version_accepted'
  const legacyCols = 'id, email, display_name, is_admin, disabled_at, per_app_model, active_project_id'
  const first = await sb.from('profiles').select(fullCols).eq('id', userId).maybeSingle()
  let data: Record<string, unknown> | null = first.data as Record<string, unknown> | null
  let error = first.error
  // If migration 0007 hasn't been applied in this environment, fall back to the
  // legacy column set so users aren't silently locked out of sign-in. The
  // LegalAcceptModal will fire as soon as the migration eventually runs.
  if (error && /column .* does not exist|42703/i.test(`${error.message} ${(error as { code?: string }).code ?? ''}`)) {
    console.warn('[auth] legal-acceptance columns missing — run migration 0007. Falling back.')
    const r = await sb.from('profiles').select(legacyCols).eq('id', userId).maybeSingle()
    data = r.data as Record<string, unknown> | null
    error = r.error
    if (data) {
      data = { ...data, first_name: null, last_name: null, tos_accepted_at: null, privacy_accepted_at: null, aup_accepted_at: null, policy_version_accepted: null }
    }
  }
  if (error) {
    console.error('[auth] fetchProfile failed', error)
    return null
  }
  return data as ProfileRow | null
}

export const useAuthStore = create<AuthState>((set, get) => ({
  bootstrapping: isCloudEnabled(),
  session: null,
  user: null,
  profile: null,
  accessRevoked: false,

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
    sb.auth.onAuthStateChange(async (_event, nextSession) => {
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

  signUp: async (email, password, firstName, lastName) => {
    if (!isCloudEnabled()) return { ok: false, error: 'Cloud not configured.' }
    const sb = getSupabase()
    // Names ride along as user metadata; the on_auth_user_created trigger reads
    // them into the profile when the allowlist has no name for this email (e.g.
    // they signed up with a different email than their Skool one).
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { first_name: firstName.trim(), last_name: lastName.trim() } },
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
  // recognise our specific phrase and clean it up. Everything else passes
  // through so kie/Supabase errors stay debuggable.
  if (/not on the access list/i.test(message)) {
    return "This email isn't on the access list. Join the Skool community first, then try again."
  }
  return message
}
