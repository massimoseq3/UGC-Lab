// Which build the tab is running, and which one the server is serving.
//
// The app code-splits every dock app into a hash-named chunk, and a deploy
// replaces those files. A member who leaves the tab open across a deploy is
// still holding the OLD index.html, so the moment they open an app they hadn't
// opened yet, the browser asks for a chunk that no longer exists — and Vercel's
// SPA rewrite answers with index.html, so the import fails on a MIME error
// rather than a 404. Nothing above it caught that, which is the white screen.
//
// BUILD_ID is baked in at build time; /version.json carries the same value for
// whatever is deployed right now. Different values mean a deploy landed under
// this tab.

export const BUILD_ID: string = __BUILD_ID__

// A short deadline covering the body read as well as the headers: this runs on
// a timer forever, and a stalled check that never settles would silently stop
// every later one (the poll skips while a check is in flight).
const CHECK_TIMEOUT_MS = 8000

/**
 * The build id the server is serving right now, or null if it can't be read
 * (offline, a hiccup, a host that didn't ship the file). Null is always
 * treated as "no news" — never as an update.
 */
export async function fetchDeployedBuildId(): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  try {
    // Both a no-store fetch and a cache-busting param: the fetch cache is the
    // one we can ask nicely, the query string is the one intermediaries obey.
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as { buildId?: unknown }
    return typeof data.buildId === 'string' ? data.buildId : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * True when an error is the browser failing to load a code chunk — i.e. this
 * tab asking for a file the current deploy no longer has.
 *
 * The wording differs per browser and per host. Vercel's SPA rewrite is the
 * reason the MIME variant matters most here: a deleted chunk comes back as
 * index.html with a 200, so the browser complains about the content type
 * rather than about a missing file.
 */
export function isStaleChunkError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return (
    /dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    /loading chunk \S+ failed/i.test(message) ||
    /chunkloaderror/i.test(message) ||
    // "Expected a JavaScript module script but the server responded with a
    // MIME type of text/html" — the SPA-rewrite shape above.
    (/module script/i.test(message) && /mime type/i.test(message))
  )
}
