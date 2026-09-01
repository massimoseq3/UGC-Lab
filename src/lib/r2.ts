// Client helpers for the R2 asset pipeline.
//
// We never talk to R2 directly with credentials — `/api/r2-sign` mints a
// presigned URL scoped to the current user, then we PUT/GET against R2 with it.

import { getSupabase, isCloudEnabled, ensureFreshSession, forceRefreshSession } from './supabase'
import { useAuthStore } from '../stores/authStore'

interface SignedUrlResponse {
  url: string
  key: string
  expiresIn: number
}

// 60s per network attempt. Beyond this we'd rather fail and surface the error
// than hold the UI on a dead connection.
const ATTEMPT_TIMEOUT_MS = 60_000

async function getAccessToken(): Promise<string | null> {
  // Delegated to the shared helper so r2 + cloudSync use the same refresh path.
  return ensureFreshSession()
}

async function presign(op: 'put' | 'get', assetId: string, mimeType?: string, byteSize?: number): Promise<SignedUrlResponse> {
  const token = await getAccessToken()
  if (!token) throw new Error('Not signed in')

  const attempt = (bearer: string) => fetchWithDeadline('/api/r2-sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ op, assetId, mimeType, byteSize }),
  }, ATTEMPT_TIMEOUT_MS)

  let res = await attempt(token)

  // 401 means the server asked Supabase about this exact token and Supabase said
  // no. Practically always a token that aged out while the tab was hidden — see
  // the ensureFreshSession comment. Buy a genuinely new one and retry once,
  // rather than reporting a sync failure the member can neither read nor act on.
  if (res.status === 401) {
    const refreshed = await forceRefreshSession()
    if (refreshed && refreshed !== token) res = await attempt(refreshed)
  }

  if (!res.ok) {
    // Parse JSON error body so the toast shows the friendly server message
    // (e.g. "Storage cap reached — you're using 5.23 GB of 10 GB.") rather
    // than a raw "Presign failed (413): {...}".
    const text = await res.text().catch(() => '')
    let friendly = text || res.statusText
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed.error) friendly = parsed.error
    } catch { /* not JSON — fall back to the raw text */ }
    throw isRetryableStatus(res.status) ? new TransientError(friendly) : new Error(friendly)
  }
  return await res.json() as SignedUrlResponse
}

// "Come back in a moment" — the mirror retries these instead of reporting them.
// A class, so a failure we can already classify (a 503, a stall we timed out
// ourselves) never has to be recognised by matching words in its own message.
class TransientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TransientError'
  }
}

// Thrown when an attempt outlives its budget. A distinct class (rather than a
// bare Error the caller has to string-match) because a stall and a rejection
// need opposite advice: check your connection vs. fix the bucket CORS policy.
class NetworkTimeoutError extends TransientError {
  constructor(ms: number) {
    super(`Network timeout after ${Math.round(ms / 1000)}s`)
    this.name = 'NetworkTimeoutError'
  }
}

// A status the server is telling us to come back from. Everything else — a 400,
// a 403, the 413 that means the storage cap is reached — is an answer, and
// asking again just spends the member's time getting it three more times.
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

// This used to be a `withTimeout(fetch(...))` race, which only ever rejected the
// WRAPPER — the request it was racing kept running, invisibly, to completion.
// That was survivable while every call here happened exactly once; it isn't now
// that they retry, because attempt two would share the uplink with the zombie
// whose stall caused it. So every request gets a real AbortController, and a body
// read gets a fresh budget of its own:
// fetch() settles at the response HEADERS, which leaves a plain timeout disarmed
// while the body is still streaming.
async function fetchWithDeadline(input: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  let res: Response
  try {
    res = await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    // An abort we asked for is a timeout; report it as one, since the two need
    // opposite advice and `AbortError` says neither.
    throw controller.signal.aborted ? new NetworkTimeoutError(ms) : err
  } finally {
    clearTimeout(timer)
  }

  const guard = <T>(read: () => Promise<T>) => async (): Promise<T> => {
    const bodyTimer = setTimeout(() => controller.abort(), ms)
    try {
      return await read()
    } catch (err) {
      throw controller.signal.aborted ? new NetworkTimeoutError(ms) : err
    } finally {
      clearTimeout(bodyTimer)
    }
  }
  Object.defineProperties(res, {
    json: { value: guard(() => Response.prototype.json.call(res)) },
    text: { value: guard(() => Response.prototype.text.call(res)) },
    blob: { value: guard(() => Response.prototype.blob.call(res)) },
  })
  return res
}

// ── Mirror retries ───────────────────────────────────────────────────
//
// The failures this path actually hits are transient, and they arrive with no
// detail at all: WebKit reports every network-layer fetch failure as
// `TypeError: Load failed` (Chromium: "Failed to fetch"), which is equally what
// a backgrounded tab, a dropped Wi-Fi hop and a saturated uplink look like from
// here. supabase-js stringifies that throw into `error.message`, so a member
// generating a batch got "Cloud sync failed: assets row insert failed:
// TypeError: Load failed" — an error they can neither read nor act on, for a
// mirror that would have gone through a second later.
const MAX_UPLOAD_ATTEMPTS = 4

// A finished batch calls saveAsset once per output — finishImageAssetTask and
// finishVideoAssetTask are the tail of EVERY generation — so a dozen-card B-Roll
// run fires a dozen presigns, a dozen multi-MB PUTs and a dozen row upserts in
// one tick. The PUTs saturate the uplink and the small requests sharing it are
// the ones that lose, which is the reported failure. Three at a time mirrors a
// batch promptly without stampeding; nothing is waiting on this, it's background.
const MAX_CONCURRENT_UPLOADS = 3

// A hidden tab is where these cluster: the browser throttles (and iOS suspends)
// a page whose member has switched away to watch the generation land, killing
// everything in flight at once. Retrying into a page that's still hidden mostly
// spends an attempt, so the backoff waits for it to come back — bounded, because
// a tab can stay hidden for an hour and an upload shouldn't hold its slot for it.
const MAX_HIDDEN_WAIT_MS = 60_000

const TRANSIENT_MARKERS = [
  'load failed',            // WebKit, for any network-layer failure
  'failed to fetch',        // Chromium
  'networkerror',           // Firefox
  'network request failed',
  'network error',
  'connection',
  'timed out',
  'timeout',
  'aborted',
]

function isTransientNetworkFailure(reason: unknown): boolean {
  if (reason instanceof TransientError) return true
  // Everything else has to be recognised by its words, because that is genuinely
  // all a network-layer failure gives us: supabase-js hands back a plain
  // `{ message }`, and the browser's own throw carries no code, no status, and
  // nothing to distinguish a dropped socket from a CORS rejection.
  const msg = (reason instanceof Error ? reason.message : String(reason ?? '')).toLowerCase()
  return TRANSIENT_MARKERS.some((marker) => msg.includes(marker))
}

// 1s, 2s, 4s, plus jitter — a batch that backed off together must not retry in
// lockstep and rebuild the same stampede that knocked it over.
function retryDelayMs(attempt: number): number {
  return Math.min(2 ** attempt * 1000 + Math.random() * 500, 15_000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function whenVisible(timeoutMs: number): Promise<void> {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onChange)
      resolve()
    }
    const onChange = () => { if (document.visibilityState !== 'hidden') done() }
    const timer = setTimeout(done, timeoutMs)
    document.addEventListener('visibilitychange', onChange)
  })
}

let activeUploads = 0
const uploadQueue: Array<() => void> = []

function acquireUploadSlot(): Promise<void> {
  if (activeUploads < MAX_CONCURRENT_UPLOADS) {
    activeUploads++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => { uploadQueue.push(resolve) })
}

function releaseUploadSlot(): void {
  const next = uploadQueue.shift()
  // Hand the slot straight over rather than decrementing and re-incrementing —
  // the count is unchanged because it never actually goes idle.
  if (next) next()
  else activeUploads--
}

// Presign + PUT the binary. Returns the R2 key the metadata row must point at.
async function putAssetBinary(assetId: string, blob: Blob): Promise<string> {
  const { url, key } = await presign('put', assetId, blob.type, blob.size)

  // fetch() throws (rather than returning a non-OK Response) on CORS rejection,
  // network failure, or timeout. The browser hides CORS detail for security
  // reasons — on a thrown error we name the R2 host and the current origin so
  // the user can fix the bucket CORS policy directly.
  let putRes: Response
  try {
    putRes = await fetchWithDeadline(url, {
      method: 'PUT',
      headers: blob.type ? { 'content-type': blob.type } : {},
      body: blob,
    }, ATTEMPT_TIMEOUT_MS)
  } catch (err) {
    const host = (() => { try { return new URL(url).host } catch { return 'r2.cloudflarestorage.com' } })()
    const origin = typeof window !== 'undefined' ? window.location.origin : '<unknown origin>'
    const reason = err instanceof Error ? err.message : String(err)
    // A CORS rejection fails on the preflight — instantly. A timeout means the
    // socket opened and the upload stalled, which is the opposite diagnosis:
    // the member's connection, not the bucket. Blaming CORS for both sent a
    // real outage (weak uplink, kie.ai timing out alongside it) to the wrong
    // place, so the hint is only offered for failures it can actually explain.
    if (err instanceof NetworkTimeoutError) {
      throw new Error(`Upload to ${host} stalled and timed out after ${Math.round(ATTEMPT_TIMEOUT_MS / 1000)}s. Check your internet connection and try again.`)
    }
    // A bare network failure reads identically to a CORS rejection from here, so
    // it keeps the marker word the retry loop matches on. Only a run that has
    // exhausted its attempts ever shows this, by which point a misconfigured
    // bucket really is the likelier of the two.
    throw new Error(`R2 PUT to ${host} failed (${reason}). Likely a CORS misconfiguration — verify the bucket CORS policy allows ${origin} with method PUT.`)
  }
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '')
    const detail = `R2 upload failed (${putRes.status}): ${text || putRes.statusText}`
    throw isRetryableStatus(putRes.status) ? new TransientError(detail) : new Error(detail)
  }
  return key
}

// Record the binary in Postgres. Until this lands the object is invisible to
// every other device: `existingRemoteAssetIds` reads this table, not the bucket.
async function insertAssetRow(assetId: string, userId: string, key: string, blob: Blob): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.from('assets').upsert({
    id: assetId,
    user_id: userId,
    r2_key: key,
    mime_type: blob.type || 'application/octet-stream',
    byte_size: blob.size,
  })
  if (error) {
    throw new Error(`assets row insert failed: ${error.message}`)
  }
}

// Atomic upload: resolves only after BOTH the R2 PUT and the `assets` row
// upsert succeed. Failure surfaces as a thrown error so the caller can react.
//
// Runs under a concurrency cap and retries transient network failures — see the
// Mirror retries block above for why both are needed. The PUT is not repeated
// once it has landed: the row insert is the half that fails most (it's a small
// request queued behind everyone else's large ones), and re-sending tens of MB
// to fix a missing 5-column row would make the saturation worse.
export async function uploadAssetToR2(assetId: string, blob: Blob): Promise<void> {
  if (!isCloudEnabled()) return
  const userId = useAuthStore.getState().user?.id
  if (!userId) throw new Error('Not signed in')

  await acquireUploadSlot()
  try {
    let key: string | null = null
    for (let attempt = 0; ; attempt++) {
      try {
        if (key === null) key = await putAssetBinary(assetId, blob)
        await insertAssetRow(assetId, userId, key, blob)
        return
      } catch (err) {
        const transient = isTransientNetworkFailure(err)
        if (!transient) throw err
        if (attempt >= MAX_UPLOAD_ATTEMPTS - 1) {
          // Every one of these carries the browser's own wording for "the network
          // failed", which is `TypeError: Load failed` in Safari and says nothing
          // to the member reading the toast. Keep the raw text in the console,
          // where it's the operator's to debug, and say what happened instead.
          console.warn(`[r2] mirror gave up for ${assetId} after ${MAX_UPLOAD_ATTEMPTS} attempts`, err)
          throw new Error(
            `the connection dropped mid-upload, after ${MAX_UPLOAD_ATTEMPTS} attempts`,
            { cause: err },
          )
        }
        console.warn(`[r2] mirror attempt ${attempt + 1}/${MAX_UPLOAD_ATTEMPTS} failed for ${assetId} — retrying`, err)
        await sleep(retryDelayMs(attempt))
        await whenVisible(MAX_HIDDEN_WAIT_MS)
      }
    }
  } finally {
    releaseUploadSlot()
  }
}

export async function existingRemoteAssetIds(assetIds: string[]): Promise<Set<string>> {
  if (!isCloudEnabled() || assetIds.length === 0) return new Set()
  const userId = useAuthStore.getState().user?.id
  if (!userId) return new Set()
  const sb = getSupabase()

  // A heavy library can hold thousands of assets; `.in('id', allIds)` becomes a
  // single GET with every id in the URL, which blows past URL/PostgREST limits
  // and errors. That used to be swallowed into an empty Set, making the caller
  // treat *every* asset as missing and re-upload the whole library each
  // sign-in. Chunk the id list so each query stays well under the limit.
  const CHUNK = 200
  const found = new Set<string>()
  for (let i = 0; i < assetIds.length; i += CHUNK) {
    const chunk = assetIds.slice(i, i + CHUNK)
    const { data, error } = await sb.from('assets').select('id').in('id', chunk).eq('user_id', userId)
    if (error) {
      console.warn('[r2] existingRemoteAssetIds chunk failed', error)
      continue
    }
    for (const row of data ?? []) found.add(row.id as string)
  }
  return found
}

// The mirror image of MAX_CONCURRENT_UPLOADS, and it exists for the same reason
// one hop over. Every history bank resolves its media through getBlob, so an app
// whose gallery holds hundreds of rows misses IndexedDB hundreds of times the
// first time a member opens it on a NEW browser — a second device, cleared site
// data, or Safari evicting a site it hasn't seen in a week, which is exactly the
// shape of a member who skips one. Each miss is THREE round trips (the assets row
// select, the presign, then the CDN GET), and they were all fired in one tick with
// nothing holding them back: hundreds of requests competing for the same uplink as
// whatever generation the member started, which is the failure the upload cap
// already describes, in the direction it happens far more often.
//
// Four rather than the upload path's three: a download is on the critical path for
// something a member is watching for (pictures filling a gallery), where an upload
// is background. Still far below the point where the small requests start losing.
//
// The gate wraps the WHOLE function, so all three round trips of one asset run
// inside a single slot — gating only the binary GET would leave the row selects
// and presigns to stampede on their own.
const MAX_CONCURRENT_DOWNLOADS = 4

// The upload path above keeps its own hand-rolled copy of this, deliberately
// untouched: it works, and rewriting a proven queue to share a helper is risk
// spent for no behaviour change.
function makeConcurrencyGate(max: number) {
  let active = 0
  const queue: Array<() => void> = []
  return {
    acquire(): Promise<void> {
      if (active < max) {
        active++
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => { queue.push(resolve) })
    },
    release(): void {
      const next = queue.shift()
      // Hand the slot straight over rather than decrementing and re-incrementing
      // — the count is unchanged because it never actually goes idle.
      if (next) next()
      else active--
    },
  }
}

const downloadGate = makeConcurrencyGate(MAX_CONCURRENT_DOWNLOADS)

export async function downloadAssetFromR2(assetId: string): Promise<Blob | null> {
  if (!isCloudEnabled()) return null
  const userId = useAuthStore.getState().user?.id
  if (!userId) return null

  await downloadGate.acquire()
  try {
    return await downloadAssetInner(assetId)
  } finally {
    downloadGate.release()
  }
}

async function downloadAssetInner(assetId: string): Promise<Blob | null> {
  const sb = getSupabase()
  const { data, error } = await sb.from('assets').select('id, mime_type').eq('id', assetId).maybeSingle()
  if (error || !data) return null

  // Bounded like every other network hop here. Unguarded, a stalled CDN read
  // hung getBlob() — and getBlob is awaited by useAssetUrl on first paint of a
  // bank card and by the product-photo step that runs BEFORE B-Roll's prompt
  // call, so one stuck download could hold up a whole generation rather than
  // just leaving a tile on its placeholder. Returning null is the established
  // contract for "couldn't fetch"; the caller shows the placeholder.
  const { url } = await presign('get', assetId)
  try {
    const res = await fetchWithDeadline(url, {}, ATTEMPT_TIMEOUT_MS)
    if (!res.ok) return null
    // `.blob()` carries its own budget and aborts the request when it blows it,
    // so a CDN that answers and then stalls can't hold this open.
    return await res.blob()
  } catch (e) {
    console.warn('[r2] asset download failed', assetId, e)
    return null
  }
}

// Awaited delete of both the `assets` metadata row AND the R2 binary itself.
// The metadata row delete is required (throws on failure). The R2 object
// delete is best-effort — if it fails the user can run the orphan-cleanup
// flow in Settings to sweep it later. We don't want a slow R2 region pinning
// bank deletes to its latency.
export async function deleteAssetFromR2(assetId: string): Promise<void> {
  if (!isCloudEnabled()) return
  const userId = useAuthStore.getState().user?.id
  if (!userId) return
  const sb = getSupabase()
  const { error } = await sb.from('assets').delete().eq('id', assetId).eq('user_id', userId)
  if (error) throw new Error(`assets row delete: ${error.message}`)

  try {
    const token = await getAccessToken()
    if (!token) return
    const res = await fetch('/api/r2-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ assetId }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn(`[r2] R2 object delete failed (${res.status}):`, text || res.statusText)
    }
  } catch (e) {
    console.warn('[r2] R2 object delete network error', e)
  }
}
