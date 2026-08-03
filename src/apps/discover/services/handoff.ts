// Carrying a found ad into the rest of the app.
//
// This is the whole reason Outliers lives inside UGC OS rather than in a
// browser tab: find a winner, then tear it down or remix it without saving
// files or switching apps.

import { fetchTikTokTranscript, vttToPlainText } from '../../../utils/scrapecreators'
import { ensureFreshSession } from '../../../lib/supabase'
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
    throw new Error(
      'Importing this video needs you to be signed in. Sign in and try again.',
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
 * The words of a TikTok, as plain prose.
 *
 * `useAiFallback` costs 10 extra credits, so it is never passed automatically —
 * the UI offers it as an explicit retry after a miss. Plenty of TikToks have no
 * caption track at all, which is a normal outcome rather than an error.
 */
export async function fetchResultTranscript(
  apiKey: string,
  result: DiscoverResult,
  useAiFallback = false,
): Promise<{ text: string; creditsRemaining: number | null }> {
  if (result.platform === 'meta') {
    // A Meta ad's body copy IS its script — already in hand, no call needed.
    return { text: result.caption, creditsRemaining: null }
  }

  const { transcript, creditsRemaining } = await fetchTikTokTranscript(
    apiKey,
    result.postUrl,
    { useAiFallback },
  )
  return { text: vttToPlainText(transcript), creditsRemaining }
}
