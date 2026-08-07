// Vercel Edge function. Mints presigned R2 URLs scoped to the caller.
//
// Request body: { op: 'put' | 'get', assetId: string, mimeType?: string }
// Response:    { url: string, key: string, expiresIn: number }
//
// Auth: caller must include a Supabase access token in `Authorization: Bearer …`.
// We verify it against Supabase's auth API to recover the user id, then sign
// a URL keyed under `auth/<userId>/<assetId>`. Users cannot read or write
// outside their own prefix.

import { AwsClient } from 'aws4fetch'

export const config = {
  runtime: 'edge',
}

// 30 minutes — long enough that a slow upload over a flaky connection won't
// hit a signed-URL expiry mid-PUT, short enough that a leaked URL is bounded.
const PRESIGN_TTL_SECONDS = 1800

// Cap individual uploads at 200 MB. Today the largest realistic asset is a
// 30s 1080p video (~50 MB). Catches both runaway client bugs and abuse.
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

// Per-user storage cap. Enforced server-side here so a client can't bypass
// by hitting the R2 PUT URL directly — we never sign one if the new upload
// would push them over.
const MAX_USER_BYTES = 10 * 1024 * 1024 * 1024 // 10 GB

// Mime allowlist for puts. We don't enforce on gets — those just hand back
// whatever R2 has — but writes should match what the app actually saves.
const ALLOWED_PUT_MIME_PREFIXES = ['image/', 'video/', 'audio/']

interface SignBody {
  op: 'put' | 'get'
  assetId: string
  mimeType?: string
  byteSize?: number
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// How a non-OK reply from Supabase's /auth/v1/user is reported.
//
// Only a 401/403 means "this token is no good" — and only that answer earns the
// 401 the client retries after a forced token refresh. Everything else (429 rate
// limit, a 5xx, a maintenance window) is the auth service being unable to
// answer, which is nothing to do with the member's session. Reporting all of it
// as "Invalid session" told members their login had broken when it hadn't, and
// gave the client no way to tell a dead session from a retryable blip.
function authFailure(status: number): { error: string; status: number } {
  if (status === 401 || status === 403) return { error: 'Invalid session', status: 401 }
  return { error: `Auth check unavailable (${status}) — try again in a moment.`, status: 503 }
}

// The `sub` claim of a JWT, read WITHOUT verifying the signature.
//
// This is never an authorization decision — `verifyUser` still asks Supabase
// who the token belongs to, and every id used below is the VERIFIED one. The
// unverified read exists purely so the two follow-up queries (disabled_at, and
// the storage-cap sum) can be fired in the same tick as the verify instead of
// waiting a full round trip for an id we can already see. A forged `sub` buys
// nothing: the queries run under the caller's own token (RLS scopes them), and
// their results are discarded unless the guess matches the verified id.
function unverifiedSub(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const sub = (JSON.parse(json) as { sub?: unknown }).sub
    return typeof sub === 'string' && sub ? sub : null
  } catch {
    return null
  }
}

// Fetches the account's `disabled_at`. A valid JWT is not enough on its own: a
// member removed from the allowlist has their profile stamped but keeps a
// refreshable token, so a disabled account could otherwise keep minting R2
// URLs after removal. Fails OPEN on a network/REST hiccup — same philosophy as
// the storage-cap check, and RLS (migration 0012) backstops the Postgres side.
async function fetchDisabledAt(supabaseUrl: string, supabaseAnon: string, token: string, userId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/profiles?select=disabled_at&id=eq.${userId}`,
      { headers: { apikey: supabaseAnon, Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) return null
    const rows = await res.json() as Array<{ disabled_at: string | null }>
    return rows[0]?.disabled_at ?? null
  } catch {
    return null
  }
}

// Sums the caller's existing `assets.byte_size`. Returns null when the query
// itself fails — the caller lets the upload through rather than perma-blocking
// on a flaky REST call.
async function fetchUsedBytes(supabaseUrl: string, supabaseAnon: string, token: string, userId: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/assets?select=byte_size&user_id=eq.${userId}`,
      { headers: { apikey: supabaseAnon, Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) return null
    const rows = await res.json() as Array<{ byte_size: number }>
    return rows.reduce((s, r) => s + Number(r.byte_size ?? 0), 0)
  } catch {
    return null
  }
}

interface VerifiedCaller {
  userId: string
  // Present only when the pre-flight guess was right; null means the caller
  // must fetch it the slow way (or skip it, per each check's fail-open rule).
  usedBytes: number | null
}

// Verifies the caller and, in the SAME round trip, resolves the two checks that
// depend on their id. This used to be three sequential fetches to Supabase —
// verify, then disabled_at, then the storage sum — which is three transatlantic
// round trips for anyone whose Supabase region isn't next door. Every presign
// pays it, and a presign sits in front of every asset a member uploads or pulls
// on a new device, so it was the single biggest fixed cost on the asset path.
async function verifyUser(
  authHeader: string | null,
  needUsage: boolean,
): Promise<VerifiedCaller | { error: string; status?: number }> {
  if (!authHeader?.startsWith('Bearer ')) return { error: 'Missing bearer token' }
  const token = authHeader.slice('Bearer '.length)
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseAnon = process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnon) return { error: 'Server missing SUPABASE_URL/ANON_KEY' }

  const guessedId = unverifiedSub(token)

  const [res, guessedDisabledAt, guessedUsedBytes] = await Promise.all([
    fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnon },
    }),
    guessedId ? fetchDisabledAt(supabaseUrl, supabaseAnon, token, guessedId) : Promise.resolve(null),
    guessedId && needUsage ? fetchUsedBytes(supabaseUrl, supabaseAnon, token, guessedId) : Promise.resolve(null),
  ])

  if (!res.ok) return authFailure(res.status)
  const user = await res.json() as { id?: string }
  if (!user.id) return { error: 'No user id in session' }

  // The speculative results only count if they were fetched for the id
  // Supabase actually confirmed. When they weren't, redo them serially — a
  // slower path nobody should hit, since a real client's own token always
  // decodes to its own sub.
  const trusted = guessedId === user.id
  const disabledAt = trusted
    ? guessedDisabledAt
    : await fetchDisabledAt(supabaseUrl, supabaseAnon, token, user.id)
  if (disabledAt) return { error: 'Account access has been revoked.', status: 403 }

  const usedBytes = !needUsage
    ? null
    : trusted
      ? guessedUsedBytes
      : await fetchUsedBytes(supabaseUrl, supabaseAnon, token, user.id)

  return { userId: user.id, usedBytes }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  // Body is parsed BEFORE the auth call, not because anything trusts it — every
  // validation below still runs, and nothing is signed until `verifyUser`
  // returns — but because `op` decides whether the storage-cap query is worth
  // firing, and firing it alongside the verify is what collapses three
  // sequential Supabase round trips into one.
  let body: SignBody
  try {
    body = await req.json() as SignBody
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  const auth = await verifyUser(req.headers.get('authorization'), body?.op === 'put')
  if ('error' in auth) return json(auth.status ?? 401, { error: auth.error })

  if (body.op !== 'put' && body.op !== 'get') return json(400, { error: 'op must be put|get' })
  if (!body.assetId || typeof body.assetId !== 'string') return json(400, { error: 'assetId required' })
  if (!/^[a-zA-Z0-9._-]+$/.test(body.assetId)) return json(400, { error: 'assetId has invalid characters' })

  if (body.op === 'put') {
    // byteSize is REQUIRED for puts. It used to be optional, which meant a
    // client could omit it to skip BOTH the per-upload size cap and the
    // per-user storage cap entirely. Requiring it removes the trivial "omit it"
    // bypass and keeps the caps honest for the real client, which always sends
    // blob.size.
    //
    // KNOWN LIMITATION (do NOT "fix" with a presigned POST policy): a presigned
    // PUT can't pin Content-Length into the SigV4 signature, so a client that
    // declares a small byteSize can still PUT a larger body. The textbook S3 fix
    // is a presigned POST policy with a content-length-range condition — but
    // Cloudflare R2 does NOT implement the S3 POST Object operation and returns
    // 501 Not Implemented for it, which the browser surfaces as an opaque
    // "Failed to fetch" (no CORS headers on the 501). PR #111 tried exactly that
    // and broke ALL uploads; it was reverted here. The residual risk is scoped
    // to the caller's own auth/<userId>/ prefix and bounded by the per-user
    // cap below, so it's storage-cost abuse of one's own quota — acceptable.
    if (typeof body.byteSize !== 'number' || !Number.isFinite(body.byteSize) || body.byteSize < 0) {
      return json(400, { error: 'byteSize (non-negative number) required for put' })
    }
    if (body.byteSize > MAX_UPLOAD_BYTES) {
      return json(413, { error: `Upload exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit` })
    }
    if (body.mimeType && !ALLOWED_PUT_MIME_PREFIXES.some((p) => body.mimeType!.startsWith(p))) {
      return json(415, { error: `Unsupported mime type: ${body.mimeType}` })
    }

    // Per-user storage cap. The sum was fetched alongside the auth verify; a
    // null means that query failed and we let the upload through (see below).
    {
      const currentBytes = auth.usedBytes
      if (currentBytes !== null && currentBytes + body.byteSize > MAX_USER_BYTES) {
        const usedGb = (currentBytes / 1024 / 1024 / 1024).toFixed(2)
        const capGb = (MAX_USER_BYTES / 1024 / 1024 / 1024).toFixed(0)
        return json(413, {
          error: `Storage cap reached — you're using ${usedGb} GB of ${capGb} GB. Free up space in Settings → Storage.`,
          code: 'storage_cap',
          usedBytes: currentBytes,
          capBytes: MAX_USER_BYTES,
        })
      }
      // If the usage query fails (network/REST hiccup), we let the upload
      // through. The next upload retries the cap check; one slipping by is
      // far better than a perma-block when Supabase is flaky.
    }
  }

  const accountId = process.env.R2_ACCOUNT_ID
  const accessKey = process.env.R2_ACCESS_KEY_ID
  const secretKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  if (!accountId || !accessKey || !secretKey || !bucket) {
    return json(500, { error: 'Server R2 env vars not configured' })
  }

  const key = `auth/${auth.userId}/${body.assetId}`
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeURIComponent(key)}`

  const aws = new AwsClient({
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    service: 's3',
    region: 'auto',
  })

  // aws4fetch signs the URL when we call .sign with aws: { signQuery: true }.
  const url = new URL(endpoint)
  url.searchParams.set('X-Amz-Expires', String(PRESIGN_TTL_SECONDS))

  const signed = await aws.sign(
    new Request(url.toString(), { method: body.op === 'put' ? 'PUT' : 'GET' }),
    { aws: { signQuery: true } },
  )

  return json(200, { url: signed.url, key, expiresIn: PRESIGN_TTL_SECONDS })
}
