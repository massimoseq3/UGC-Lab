// Carrying a found ad into the rest of the app.
//
// This is the whole reason Outliers lives inside UGC OS rather than in a
// browser tab: find a winner, then tear it down or remix it without saving
// files or switching apps.

import { fetchMetaAdTranscript, fetchTikTokTranscript, vttToPlainText } from '../../../utils/scrapecreators'
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
export async function downloadResultVideo(result: DiscoverResult): Promise<File> {
  const url = result.videoUrl
  if (!url) throw new Error('This result has no downloadable video.')

  const fileName = `${result.platform}-${result.id}.mp4`

  const toFile = async (res: Response): Promise<File> => {
    const blob = await res.blob()
    if (blob.size === 0) throw new Error('The downloaded file was empty.')
    return new File([blob], fileName, { type: blob.type || 'video/mp4' })
  }

  try {
    const direct = await fetch(url)
    if (direct.ok) return await toFile(direct)
  } catch {
    // CORS rejection and a network drop are indistinguishable here — both are
    // an opaque TypeError. Either way the proxy is the next thing to try.
  }

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
export async function saveResultVideoToDisk(result: DiscoverResult): Promise<void> {
  const file = await downloadResultVideo(result)
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = adFileName(result)
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
  if (!result.coverUrl) return undefined
  try {
    const res = await fetch(result.coverUrl)
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
 */
export async function fetchResultTranscript(
  apiKey: string,
  result: DiscoverResult,
  useAiFallback = false,
): Promise<{ text: string; creditsRemaining: number | null }> {
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
