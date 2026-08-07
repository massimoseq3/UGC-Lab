// Vercel Edge function. Streams a social-media CDN file back to the browser.
//
// Request:  GET /api/fetch-media?url=<encoded>
// Response: the upstream body, streamed, with permissive CORS for our own app.
//
// Why this exists: Outliers hands a found video to the Ad Analyzer, which needs
// the actual bytes in the browser. Meta's CDN (fbcdn.net) sends
// `access-control-allow-origin: *` so the client fetches those directly — but
// TikTok's CDN sends no CORS header at all, so the browser can't read the
// response. The client tries direct first and only falls back to this route.
//
// SECURITY: this is a server-side fetcher, i.e. a textbook SSRF primitive. Two
// controls keep it from becoming one:
//   1. Auth — a valid Supabase session, same as every other route here.
//   2. A strict host ALLOWLIST, matched on the parsed hostname with a leading
//      dot for the suffix case. Never substring-match a URL: "evil.com/
//      ?x=tiktokcdn.com" contains an allowed host and is not one.
// Redirects are followed by fetch(), so the allowlist is re-checked on the
// final URL — an allowed host that 302s to an internal address must not pass.

export const config = {
  runtime: 'edge',
}

// Suffix match only (`host === entry` or `host.endsWith('.' + entry)`).
const ALLOWED_HOSTS = [
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'tiktokv.com',
  'muscdn.com',
  'fbcdn.net',
  'cdninstagram.com',
]

// A 9:16 ad is a few MB; the app's own upload ceiling is 200 MB. Matching it
// keeps one number in the member's head and bounds what a single call can pull.
const MAX_BYTES = 200 * 1024 * 1024

const FETCH_TIMEOUT_MS = 60_000

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

/** Parses and validates a candidate URL. Returns null if it fails any check. */
function safeUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  // http is upgraded by the CDNs anyway; refusing anything else rules out
  // file:, data:, gopher: and the rest of the SSRF toolkit.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!hostAllowed(url.hostname)) return null
  return url
}

async function verifyUser(authHeader: string | null): Promise<{ userId: string } | { error: string; status?: number }> {
  if (!authHeader?.startsWith('Bearer ')) return { error: 'Missing bearer token' }
  const token = authHeader.slice('Bearer '.length)
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseAnon = process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnon) return { error: 'Server missing SUPABASE_URL/ANON_KEY' }

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnon },
  })
  // Only a 401/403 means the token itself was rejected. A 429 or 5xx is the auth
  // service failing to answer, which isn't the member's session — reporting both
  // as "Invalid session" blamed a working login for an upstream blip.
  if (!res.ok) {
    return res.status === 401 || res.status === 403
      ? { error: 'Invalid session', status: 401 }
      : { error: `Auth check unavailable (${res.status}) — try again in a moment.`, status: 503 }
  }
  const user = await res.json() as { id?: string }
  if (!user.id) return { error: 'No user id in session' }
  return { userId: user.id }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json(405, { error: 'GET only' })

  const auth = await verifyUser(req.headers.get('authorization'))
  if ('error' in auth) return json(auth.status ?? 401, { error: auth.error })

  const raw = new URL(req.url).searchParams.get('url')
  if (!raw) return json(400, { error: 'url parameter required' })

  const target = safeUrl(raw)
  if (!target) return json(403, { error: 'That host is not allowed.' })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), {
      // TikTok's CDN serves 403 to requests with no Referer. This is the whole
      // reason the fetch has to happen server-side.
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        referer: `${target.protocol}//${target.hostname}/`,
        accept: '*/*',
      },
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    const aborted = e instanceof Error && e.name === 'AbortError'
    return json(504, { error: aborted ? 'Upstream timed out.' : 'Could not reach the media host.' })
  }
  clearTimeout(timer)

  // Re-check after redirects: `redirect: 'follow'` means the body we're about
  // to stream may come from a host the caller never named.
  if (upstream.url && !safeUrl(upstream.url)) {
    return json(403, { error: 'Upstream redirected to a host that is not allowed.' })
  }

  if (!upstream.ok) {
    return json(upstream.status === 404 ? 404 : 502, {
      error: `Media host returned ${upstream.status}. The link may have expired — search again to refresh it.`,
    })
  }

  const declared = Number(upstream.headers.get('content-length') ?? '0')
  if (declared > MAX_BYTES) {
    return json(413, { error: 'That file is too large to import.' })
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      // Signed CDN URLs expire within hours, so caching the bytes past that is
      // pointless; the app re-searches to refresh a dead link.
      'cache-control': 'private, max-age=0, no-store',
      'access-control-allow-origin': '*',
    },
  })
}
