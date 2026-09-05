// Carrying a found ad into the rest of the app.
//
// This is the whole reason Outliers lives inside UGC OS rather than in a
// browser tab: find a winner, then tear it down or remix it without saving
// files or switching apps.

import { fetchInstagramTranscript, fetchMetaAdTranscript, fetchTikTokTranscript, vttToPlainText } from '../../../utils/scrapecreators'
import { ensureFreshSession } from '../../../lib/supabase'
import { saveAsset } from '../../../utils/assetStore'
import type { DiscoverResult } from '../types'

/**
 * Downloads a card's video as a File.
 *
 * Tries the CDN directly first — fbcdn and cdninstagram send
 * `access-control-allow-origin: *`, so Meta and Instagram media needs no
 * server hop. TikTok's CDN sends no CORS header and 403s requests without a
 * Referer, so those land in the catch and go through /api/fetch-media.
 *
 * Doing it in that order means we never pay for a round trip through our own
 * edge function when the browser could have fetched it, and it self-corrects
 * if TikTok ever starts sending CORS headers.
 */
export async function downloadResultVideo(
  result: DiscoverResult,
  onProgress?: (p: DownloadProgress) => void,
): Promise<File> {
  if (!result.videoUrl) throw new Error('This result has no downloadable video.')
  return downloadVideoFile(result.videoUrl, `${result.platform}-${result.id}.mp4`, onProgress)
}

/**
 * The url-shaped half, for a caller that holds a link rather than a card.
 *
 * The Outlier Vault is the one: its rows are static library entries, not
 * `DiscoverResult`s, and their video url is resolved on demand a moment before
 * this is called. Splitting it here rather than synthesising a card keeps one
 * fetch strategy — and one set of CORS lessons — behind every video the app
 * pulls off a platform.
 */
export interface DownloadProgress {
  /** Bytes fetched so far. */
  received: number
  /** Total size, when the server told us. Null while it hasn't. */
  total: number | null
}

/**
 * "Downloading… 12.4 MB" / "Downloading… 47%".
 *
 * Lives here beside `DownloadProgress` because three surfaces show it — the
 * result modal, the vault modal and the swipe file — and a download that
 * words its progress three ways is the drift this file exists to prevent.
 *
 * A percentage only when the server told us the total, which cross-origin it
 * usually hasn't: neither `Content-Range` nor a ranged `Content-Length` is
 * CORS-safelisted. Megabytes are the honest fallback — a number that keeps
 * moving is the whole point, and a percentage off a guessed total would stall
 * at "99%" on every long reel.
 */
export function downloadLabel(progress: DownloadProgress | null | undefined): string {
  if (!progress || progress.received === 0) return 'Downloading…'
  if (progress.total && progress.total > 0) {
    return `Downloading… ${Math.min(99, Math.round((progress.received / progress.total) * 100))}%`
  }
  return `Downloading… ${(progress.received / 1_048_576).toFixed(1)} MB`
}

/**
 * How much of the file each request asks for.
 *
 * Small enough that progress moves visibly and a stalled window is cheap to
 * lose, large enough that a 40MB reel is a handful of requests rather than
 * hundreds of round trips.
 */
const CHUNK_BYTES = 4 * 1024 * 1024

/** Windows in flight at once. This is the part that buys the speed. */
const PARALLEL_WINDOWS = 4

/**
 * Fetches a file the way a download manager does: in parallel byte ranges.
 *
 * A plain single GET is one connection, and Meta's CDN is widely reported to
 * serve those slowly — which is the difference a member sees between this
 * button and Chrome's own "Download" in the video context menu, since the
 * browser's downloader ranges the file across several connections and the
 * `<video>` element streams it in ranges too. Asking for the file the same way
 * the player already does should get the same throughput.
 *
 * It cannot be worse than the single GET it replaced, because a server that
 * doesn't do ranges answers the first request with `200` and the whole body —
 * which is exactly the old behaviour, taken here as the `200` branch.
 *
 * `Content-Range` is not a CORS-safelisted response header, so the total size
 * usually can't be read cross-origin. The walk therefore doesn't depend on
 * knowing it: it stops when a window comes back short or `416`.
 */
async function fetchRanged(
  url: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<Blob | null> {
  const parts: ArrayBuffer[] = []
  let received = 0
  let total: number | null = null

  const report = () => onProgress?.({ received, total })

  const window = async (index: number): Promise<Response> => {
    const start = index * CHUNK_BYTES
    return fetch(url, { headers: { Range: `bytes=${start}-${start + CHUNK_BYTES - 1}` } })
  }

  const first = await window(0)
  // The server ignored the range (or the file fits in one): one body, done.
  if (first.status === 200) {
    const len = Number(first.headers.get('content-length'))
    total = Number.isFinite(len) && len > 0 ? len : null
    const buf = await first.arrayBuffer()
    received += buf.byteLength
    report()
    return buf.byteLength > 0 ? new Blob([buf], { type: first.headers.get('content-type') || 'video/mp4' }) : null
  }
  if (first.status !== 206) return null

  // "bytes 0-4194303/39182336" — present on a same-origin response, and on a
  // cross-origin one only if the CDN exposes it. Read it when we can.
  const rangeTotal = Number(first.headers.get('content-range')?.split('/')[1])
  if (Number.isFinite(rangeTotal) && rangeTotal > 0) total = rangeTotal

  const type = first.headers.get('content-type') || 'video/mp4'
  const firstBuf = await first.arrayBuffer()
  parts[0] = firstBuf
  received += firstBuf.byteLength
  report()
  // A short first window is the whole file.
  if (firstBuf.byteLength < CHUNK_BYTES) return new Blob(parts, { type })

  let next = 1
  for (;;) {
    const batch = Array.from({ length: PARALLEL_WINDOWS }, (_, i) => next + i)
    const results = await Promise.all(batch.map(async (index) => {
      const res = await window(index)
      // Past the end of the file: the walk is finished, not failed.
      if (res.status === 416) return { index, buf: null }
      if (res.status !== 206) throw new Error(`Range request failed (${res.status}).`)
      return { index, buf: await res.arrayBuffer() }
    }))

    let done = false
    for (const { index, buf } of results) {
      if (!buf || buf.byteLength === 0) { done = true; continue }
      parts[index] = buf
      received += buf.byteLength
      if (buf.byteLength < CHUNK_BYTES) done = true
    }
    report()
    if (done) break
    next += PARALLEL_WINDOWS
  }

  // Indexed by window, so the batches reassemble in order however they landed.
  return new Blob(parts.filter(Boolean), { type })
}

export async function downloadVideoFile(
  url: string,
  fileName: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<File> {
  const toFile = async (res: Response): Promise<File> => {
    const blob = await res.blob()
    if (blob.size === 0) throw new Error('The downloaded file was empty.')
    return new File([blob], fileName, { type: blob.type || 'video/mp4' })
  }

  try {
    const blob = await fetchRanged(url, onProgress)
    if (blob && blob.size > 0) return new File([blob], fileName, { type: blob.type || 'video/mp4' })
  } catch {
    // CORS rejection and a network drop are indistinguishable here — both are
    // an opaque TypeError. Either way the proxy is the next thing to try.
  }

  // Every byte of this path is paid for by the operator rather than fetched
  // from the CDN, and it is a single un-ranged GET, so it is the slow route by
  // construction. Say so once: a member reporting "the download takes forever"
  // and a console line naming this fallback is the whole diagnosis.
  console.warn(
    `[outliers] direct CDN download failed for ${new URL(url).host}; falling back to /api/fetch-media, which is slower.`,
  )

  const token = await ensureFreshSession()
  if (!token) {
    // Deliberately neutral about WHY the video is being fetched — the same
    // download backs Analyze and the Download button.
    throw new Error(
      'Fetching this video needs you to be signed in. Sign in and try again.',
    )
  }

  const proxied = await fetch(`/api/fetch-media?url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!proxied.ok) {
    const body = await proxied.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `Could not download that video (${proxied.status}).`)
  }
  return await toFile(proxied)
}

/**
 * Saves a card's video to the member's own disk.
 *
 * Goes through `downloadResultVideo` rather than a plain anchor with a
 * `download` attribute: TikTok's CDN neither sends CORS headers nor serves
 * without a Referer, and a cross-origin `download` attribute is ignored by
 * browsers anyway — the click would open the video in a tab rather than save
 * it. Fetching to a blob first is what makes the filename ours, too.
 */
export async function saveResultVideoToDisk(
  result: DiscoverResult,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  saveVideoFileToDisk(await downloadResultVideo(result, onProgress), result)
}

/**
 * The disk-writing half, for a caller that already holds the File.
 *
 * The swipe file fetches through its own retry (an expired link, re-resolved)
 * and would otherwise have to download the video a second time just to name it.
 */
export function saveVideoFileToDisk(file: File, result: DiscoverResult): void {
  saveFileToDisk(file, adFileName(result))
}

/** Hands a blob to the browser's downloader under a name of our choosing. */
export function saveFileToDisk(file: File, fileName: string): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** "tiktok-comfofeet-7412345.mp4" — whose ad it is, readable in a Downloads folder. */
function adFileName(result: DiscoverResult): string {
  const who = (result.author.handle || result.author.name || 'ad')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${result.platform}-${who || 'ad'}-${result.id}.mp4`
}

/**
 * Copies a card's cover image into our own storage and returns the asset ref.
 *
 * This is what makes a swipe file durable. Every image URL a search hands back
 * is a signed CDN link that expires within days, so a row that merely
 * remembered the URL would be a broken image by the time it mattered.
 *
 * Returns undefined rather than throwing when there's nothing to copy or the
 * fetch fails: a swipe with no thumbnail is still a useful record, and losing
 * the save over a missing picture would be the wrong trade.
 */
export async function saveThumbnail(result: DiscoverResult): Promise<string | undefined> {
  return saveRemoteImage(result.coverUrl)
}

/**
 * The url-shaped half, for a caller holding a link rather than a card.
 *
 * A tracked account's profile picture goes through this for exactly the reason
 * a swipe's cover does — Instagram signs its avatar urls too, so a rail that
 * remembered the link would be a row of broken circles inside a week.
 */
export async function saveRemoteImage(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined
  try {
    const res = await fetch(url)
    if (!res.ok) return undefined
    const blob = await res.blob()
    if (!blob.size) return undefined
    return await saveAsset(blob, blob.type || 'image/jpeg')
  } catch {
    return undefined
  }
}

/**
 * The words actually SPOKEN in a result's video, as plain prose.
 *
 * Both platforms go through a real transcript endpoint. Meta used to short-
 * circuit to the ad's body copy — which is the written caption, so "remix the
 * transcript" was quietly handing Scripts somebody's ad copy instead of the
 * script their creator performed. Meta's transcript endpoint only charges when
 * a transcript actually comes back, so asking costs nothing on an image ad.
 *
 * `useAiFallback` (TikTok only) costs 10 EXTRA credits, so it is never passed
 * automatically — the UI offers it as an explicit retry after a miss. Plenty of
 * videos have no caption track, which is a normal outcome, not an error.
 *
 * Instagram has no caption track to read at all, so its endpoint is speech-to-
 * text every time: slower (10-30s), refused over two minutes, and with no
 * cheap tier to try first — which is why `useAiFallback` means nothing there
 * and the UI offers no second attempt behind it.
 */
export async function fetchResultTranscript(
  apiKey: string,
  result: DiscoverResult,
  useAiFallback = false,
): Promise<{ text: string; creditsRemaining: number | null }> {
  if (result.platform === 'instagram') {
    // The permalink is the API's own handle for a reel — there is no id route.
    const { transcript, creditsRemaining } = await fetchInstagramTranscript(apiKey, result.postUrl)
    return { text: transcript, creditsRemaining }
  }

  if (result.platform === 'meta') {
    const { transcript, creditsRemaining } = await fetchMetaAdTranscript(apiKey, result.id)
    // Meta hands back plain prose, not WEBVTT — but run it through the same
    // stripper anyway, since a captions-derived transcript can arrive cued and
    // the function is a no-op on text that carries no timings.
    return { text: vttToPlainText(transcript), creditsRemaining }
  }

  const { transcript, creditsRemaining } = await fetchTikTokTranscript(
    apiKey,
    result.postUrl,
    { useAiFallback },
  )
  return { text: vttToPlainText(transcript), creditsRemaining }
}
