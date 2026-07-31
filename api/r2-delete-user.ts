// Vercel Edge function. Deletes EVERY R2 object belonging to one member.
//
// Request body: { userId: string }            (the member being deleted)
// Response:    { deleted: number, failed: number, done: boolean, error?: string }
//
// Auth: caller must be an ADMIN. We verify their Supabase token, then read
// their own profile row (RLS lets everyone read their own) and require
// is_admin. Unlike the disabled_at check in r2-sign/r2-delete, this one fails
// CLOSED — a profile we can't read is not an admin.
//
// This is the R2 half of deleting a member; the Postgres half is the
// admin_delete_member() RPC (migration 0018), which cascades every row off
// auth.users. Objects are found by listing the `auth/<userId>/` prefix rather
// than by reading the assets table, so anything orphaned there goes too.
//
// `done: false` means the time budget ran out with objects still under the
// prefix — call again with the same body until it comes back true.

import { AwsClient } from 'aws4fetch'

export const config = {
  runtime: 'edge',
}

// Edge functions get ~25s. Stop listing/deleting at 18s and report done:false
// so the client can call again rather than lose the whole run to a timeout.
const TIME_BUDGET_MS = 18_000

// Individual DELETEs rather than the S3 batch DeleteObjects call: R2 wants a
// Content-MD5 on that request and WebCrypto has no MD5. A member's library is
// hundreds of objects at most, so a pool of concurrent DELETEs is plenty.
const DELETE_CONCURRENCY = 12

const UUID_RE = /^[0-9a-fA-F-]{36}$/

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function verifyAdmin(authHeader: string | null): Promise<{ userId: string } | { error: string; status?: number }> {
  if (!authHeader?.startsWith('Bearer ')) return { error: 'Missing bearer token' }
  const token = authHeader.slice('Bearer '.length)
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseAnon = process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnon) return { error: 'Server missing SUPABASE_URL/ANON_KEY' }

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnon },
  })
  if (!res.ok) return { error: 'Invalid session' }
  const user = await res.json() as { id?: string }
  if (!user.id) return { error: 'No user id in session' }

  const profRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=is_admin,disabled_at&id=eq.${user.id}`,
    { headers: { apikey: supabaseAnon, Authorization: `Bearer ${token}` } },
  )
  if (!profRes.ok) return { error: 'Could not verify admin status', status: 403 }
  const rows = await profRes.json() as Array<{ is_admin: boolean; disabled_at: string | null }>
  if (!rows[0]?.is_admin || rows[0].disabled_at) return { error: 'Admin only', status: 403 }

  return { userId: user.id }
}

// Keys out of a ListObjectsV2 body. Asset keys are `auth/<uuid>/<assetId>` with
// assetId restricted to [a-zA-Z0-9._-] (see r2-sign), so no XML entities can
// appear inside <Key> and a regex is honest here.
function parseListing(xml: string): { keys: string[]; nextToken: string | null } {
  const keys: string[] = []
  const re = /<Key>([^<]+)<\/Key>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) keys.push(m[1])
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml)
  const tokenMatch = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)
  return { keys, nextToken: truncated && tokenMatch ? tokenMatch[1] : null }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const auth = await verifyAdmin(req.headers.get('authorization'))
  if ('error' in auth) return json(auth.status ?? 401, { error: auth.error })

  let body: { userId?: unknown }
  try {
    body = await req.json() as { userId?: unknown }
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }
  const targetId = typeof body.userId === 'string' ? body.userId : ''
  if (!UUID_RE.test(targetId)) return json(400, { error: 'userId (uuid) required' })

  const accountId = process.env.R2_ACCOUNT_ID
  const accessKey = process.env.R2_ACCESS_KEY_ID
  const secretKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  if (!accountId || !accessKey || !secretKey || !bucket) {
    return json(500, { error: 'Server R2 env vars not configured' })
  }

  const aws = new AwsClient({
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    service: 's3',
    region: 'auto',
  })

  const base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`
  const prefix = `auth/${targetId}/`
  const startedAt = Date.now()
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS

  let deleted = 0
  let failed = 0
  let firstError: string | null = null
  let continuation: string | null = null
  let done = true

  do {
    const listUrl = new URL(base)
    listUrl.searchParams.set('list-type', '2')
    listUrl.searchParams.set('prefix', prefix)
    listUrl.searchParams.set('max-keys', '1000')
    if (continuation) listUrl.searchParams.set('continuation-token', continuation)

    const listRes = await aws.fetch(listUrl.toString(), { method: 'GET' })
    if (!listRes.ok) {
      const text = await listRes.text().catch(() => '')
      return json(502, { error: `R2 list failed (${listRes.status}): ${text.slice(0, 300) || listRes.statusText}` })
    }
    const { keys, nextToken } = parseListing(await listRes.text())

    for (let i = 0; i < keys.length; i += DELETE_CONCURRENCY) {
      if (outOfTime()) { done = false; break }
      const batch = keys.slice(i, i + DELETE_CONCURRENCY)
      const results = await Promise.all(batch.map(async (key) => {
        try {
          const res = await aws.fetch(`${base}/${encodeURIComponent(key)}`, { method: 'DELETE' })
          // 204 = deleted, 404 = already gone. Both leave the object absent.
          if (res.status !== 204 && res.status !== 404) {
            return `R2 DELETE ${key} failed (${res.status})`
          }
          return null
        } catch (e) {
          return `R2 DELETE ${key} errored (${e instanceof Error ? e.message : String(e)})`
        }
      }))
      for (const err of results) {
        if (err) { failed++; firstError ??= err } else { deleted++ }
      }
    }

    if (!done) break
    continuation = nextToken
    if (continuation && outOfTime()) { done = false; break }
  } while (continuation)

  return json(200, { deleted, failed, done, ...(firstError ? { error: firstError } : {}) })
}
