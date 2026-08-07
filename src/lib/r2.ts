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

  const attempt = (bearer: string) => withTimeout(fetch('/api/r2-sign', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ op, assetId, mimeType, byteSize }),
  }), ATTEMPT_TIMEOUT_MS)

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
    throw new Error(friendly)
  }
  return await res.json() as SignedUrlResponse
}

// Thrown when an attempt outlives its budget. A distinct class (rather than a
// bare Error the caller has to string-match) because a stall and a rejection
// need opposite advice: check your connection vs. fix the bucket CORS policy.
class NetworkTimeoutError extends Error {
  constructor(ms: number) {
    super(`Network timeout after ${Math.round(ms / 1000)}s`)
    this.name = 'NetworkTimeoutError'
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new NetworkTimeoutError(ms)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

// Atomic upload: resolves only after BOTH the R2 PUT and the `assets` row
// upsert succeed. Failure surfaces as a thrown error so the caller can react.
export async function uploadAssetToR2(assetId: string, blob: Blob): Promise<void> {
  if (!isCloudEnabled()) return
  const userId = useAuthStore.getState().user?.id
  if (!userId) throw new Error('Not signed in')

  const { url, key } = await presign('put', assetId, blob.type, blob.size)

  // fetch() throws (rather than returning a non-OK Response) on CORS rejection,
  // network failure, or timeout. The browser hides CORS detail for security
  // reasons — on a thrown error we name the R2 host and the current origin so
  // the user can fix the bucket CORS policy directly.
  let putRes: Response
  try {
    putRes = await withTimeout(fetch(url, {
      method: 'PUT',
      headers: blob.type ? { 'content-type': blob.type } : {},
      body: blob,
    }), ATTEMPT_TIMEOUT_MS)
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
    throw new Error(`R2 PUT to ${host} failed (${reason}). Likely a CORS misconfiguration — verify the bucket CORS policy allows ${origin} with method PUT.`)
  }
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '')
    throw new Error(`R2 upload failed (${putRes.status}): ${text || putRes.statusText}`)
  }

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

export async function downloadAssetFromR2(assetId: string): Promise<Blob | null> {
  if (!isCloudEnabled()) return null
  const userId = useAuthStore.getState().user?.id
  if (!userId) return null

  const sb = getSupabase()
  const { data, error } = await sb.from('assets').select('id, mime_type').eq('id', assetId).maybeSingle()
  if (error || !data) return null

  const { url } = await presign('get', assetId)
  const res = await fetch(url)
  if (!res.ok) return null
  return await res.blob()
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
