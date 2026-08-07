import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// We expose `cloud` as a getter so the app can launch in pure-local mode if
// the env vars aren't configured (developer using Vite without a Supabase
// project) — every cloud-touching code path checks `isCloudEnabled()` first.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let client: SupabaseClient | null = null

// Most-recently-seen access token, kept current by an onAuthStateChange
// listener installed when the client is created. Used as the fallback when
// getSession() stalls (see ensureFreshSession). Lives here — not in authStore —
// so this low-level module has no import cycle with the store.
let cachedAccessToken: string | null = null

export function isCloudEnabled(): boolean {
  return !!(url && anonKey)
}

// supabase-js takes the access token via navigator.locks before every request
// (to attach the Authorization header). The default lock can stall indefinitely
// after a backgrounded tab returns — which hung our upserts until their 15s
// timeout fired. This replacement bounds lock acquisition: if we can't get the
// lock within ~2s, we run the operation WITHOUT it rather than block. A rare
// cross-tab token race is acceptable for a single-user app; an indefinite stall
// is not. Matches the signature supabase-js expects: (name, acquireTimeout, fn).
const LOCK_ACQUIRE_TIMEOUT_MS = 2_000
async function nonBlockingLock<R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks?.request || typeof AbortSignal === 'undefined' || !AbortSignal.timeout) {
    return fn()
  }
  try {
    return await locks.request(name, { signal: AbortSignal.timeout(LOCK_ACQUIRE_TIMEOUT_MS) }, () => fn())
  } catch {
    // Acquisition timed out / aborted (another tab holds the lock, or the SDK's
    // own lock stalled). Proceed unlocked instead of hanging the request.
    return fn()
  }
}

export function getSupabase(): SupabaseClient {
  if (!isCloudEnabled()) {
    throw new Error(
      'Supabase env not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.',
    )
  }
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        lock: nonBlockingLock,
      },
    })
    // Keep the cached token current. Fires on SIGNED_IN / TOKEN_REFRESHED /
    // SIGNED_OUT — exactly the events that change the access token. authStore
    // installs its own listener for app state; this one is independent and only
    // touches the module-local fallback.
    client.auth.onAuthStateChange((_event, session) => {
      cachedAccessToken = session?.access_token ?? null
    })
  }
  return client
}

// 3s is plenty for a healthy getSession() (it's normally synchronous against
// the in-memory session). Past that we assume the SDK's auth lock has stalled
// and fall back rather than block the caller.
const SESSION_TIMEOUT_MS = 3_000
const TIMED_OUT = Symbol('session-timeout')

// Headroom an access token must still have before we're willing to send it.
// Matches supabase-js's own EXPIRY_MARGIN (3 × its 30s auto-refresh tick): a
// token inside that window may well be dead by the time it reaches the server.
const TOKEN_MIN_LIFETIME_MS = 90_000

// A JWT's `exp`, in ms, read WITHOUT verifying the signature. This is never an
// authorization decision — the Edge functions still verify every token against
// Supabase. It only decides whether OUR OWN token is worth spending a round trip
// on, so a forged one would fool nobody but its forger.
function tokenExpiresAt(token: string | null): number | null {
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const exp = (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

// A token with no readable `exp` counts as usable — we can't judge it, and the
// server can.
function isTokenUsable(token: string | null): boolean {
  if (!token) return false
  const expiresAt = tokenExpiresAt(token)
  return expiresAt === null || expiresAt - Date.now() > TOKEN_MIN_LIFETIME_MS
}

// Generous: this runs on background upload paths, never in front of a click,
// and it's the last thing standing between us and a 401 the member has to read.
const FORCED_REFRESH_TIMEOUT_MS = 10_000
let forcedRefresh: Promise<string | null> | null = null

// Trade the refresh token for a new access token, explicitly. Single-flight, so
// a batch of generations finishing together mints ONE new token rather than one
// each (supabase-js dedupes its own concurrent refreshes the same way).
//
// Falls back to the cached token when the refresh itself fails: a broken refresh
// is the caller's status quo, and failing louder here would turn a recoverable
// blip into "Not signed in".
export async function forceRefreshSession(): Promise<string | null> {
  if (!isCloudEnabled()) return null
  if (forcedRefresh) return forcedRefresh
  forcedRefresh = (async () => {
    try {
      const token = await Promise.race([
        getSupabase().auth.refreshSession().then(({ data, error }) => {
          if (error) throw error
          return data.session?.access_token ?? null
        }),
        new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), FORCED_REFRESH_TIMEOUT_MS)),
      ])
      if (token === TIMED_OUT) {
        console.warn('[supabase] refreshSession() stalled — using cached access token')
        return cachedAccessToken
      }
      if (token) cachedAccessToken = token
      return token ?? cachedAccessToken
    } catch (e) {
      console.warn('[supabase] refreshSession() failed — using cached access token', e)
      return cachedAccessToken
    } finally {
      forcedRefresh = null
    }
  })()
  return forcedRefresh
}

// Returns the current access token, refreshing if the SDK deems it necessary.
//
// Why the timeout fallback exists: the SDK's `autoRefreshToken` timer gets
// throttled when the tab is backgrounded, and supabase-js's auth lock can
// stall after a long-idle tab returns — leaving getSession() hung. Every cloud
// write awaits this helper, so a hung getSession() used to pin writes until
// their 15–60s timeouts fired (surfacing as "save failed / generation failed"
// until a page refresh cleared the lock). Racing it against a short timeout and
// falling back to the last-seen token keeps writes moving: they either succeed,
// or fail fast on a stale token (recoverable) instead of hanging.
//
// The fallback is expiry-CHECKED, and that check is the whole point. supabase-js
// stops auto-refreshing a hidden tab (`_onVisibilityChanged` → `_stopAutoRefresh`),
// so a tab left in the background is exactly where the access token dies — and
// it's also where getSession() is slowest, because on return the SDK's own
// `_recoverAndRefresh` holds the lock through a network refresh while our
// nonBlockingLock gives up on it after 2s. The old code handed the timeout path
// straight to `cachedAccessToken`, i.e. handed the server the very token that had
// just expired: /api/r2-sign asked Supabase who it belonged to, got a rejection,
// and answered "Invalid session" — which surfaced on every video that finished
// while the member was in another tab.
export async function ensureFreshSession(): Promise<string | null> {
  if (!isCloudEnabled()) return null

  let token: string | null = null
  let resolved = false
  try {
    const raced = await Promise.race([
      getSupabase().auth.getSession().then((r) => r.data.session?.access_token ?? null),
      new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), SESSION_TIMEOUT_MS)),
    ])
    if (raced === TIMED_OUT) {
      console.warn('[supabase] getSession() stalled — falling back to the cached access token')
    } else {
      resolved = true
      token = raced
      if (token) cachedAccessToken = token
    }
  } catch (e) {
    console.warn('[supabase] getSession() failed — falling back to the cached access token', e)
  }

  if (isTokenUsable(token)) return token
  if (isTokenUsable(cachedAccessToken)) return cachedAccessToken

  // A clean getSession() that resolved to nothing, with nothing cached, means
  // signed out — there's no refresh token to spend a round trip on.
  if (resolved && !token && !cachedAccessToken) return null

  // Everything we hold is expired or about to be. Sending it buys a 401 the
  // caller can only report as a failure, so pay for a real token here instead.
  return await forceRefreshSession()
}

// One-time install: proactively recover the session when the user brings the
// tab back. ensureFreshSession() is timeout-guarded, so this can't hang.
// Module-level so it runs once on first import. Guarded so it's inert in
// local-only mode and during SSR.
if (isCloudEnabled() && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void ensureFreshSession().catch((e) => console.warn('[supabase] visibility refresh failed', e))
    }
  })
}
