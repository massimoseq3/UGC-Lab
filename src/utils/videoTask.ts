// Shared tail of every video generation (B-Roll cards, Playground): poll the
// task to completion (Veo custom endpoint vs the standard jobs pipeline),
// download the first result URL, guard against kie's silent-failure responses,
// and persist the blob as a local asset. Returns the saved asset id. Callers
// keep their own history-row / result-shape assembly.
//
// The guards matter: kie's CDN can hand back a 200 with the right Content-Type
// yet bytes that are a CORS-opaque stub, an HTML error page tagged video/mp4,
// or a content-filtered MP4 with no decodable frames — all of which render as
// a silent black tile. We reject those here so no caller can save one.

import { pollTask, parseResult, kieVeoPoll, fetchGeneratedAsset, VIDEO_POLL_ATTEMPTS } from './kie'
import { saveAsset } from './assetStore'
import { useSettingsStore } from '../stores/settingsStore'

export async function finishVideoAssetTask(
  taskId: string,
  modelId: string,
  videoEndpoint: 'veo' | undefined,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const { signal } = opts

  const urls = videoEndpoint === 'veo'
    ? await kieVeoPoll(apiKey, taskId, { signal, maxPollAttempts: VIDEO_POLL_ATTEMPTS })
    : parseResult(await pollTask(apiKey, taskId, { signal, maxPollAttempts: VIDEO_POLL_ATTEMPTS })).resultUrls

  if (urls.length === 0) {
    throw new Error(
      `${modelId}: kie.ai returned no resultUrls. taskId=${taskId} endpoint=${videoEndpoint ?? 'jobs'}`,
    )
  }

  // Deadline-bounded, and cancellable: this is the biggest download in the app
  // (a 30s clip is tens of MB) and a stalled body read here used to park the
  // tile on "generating" forever with nothing to cancel.
  const res = await fetchGeneratedAsset(urls[0], { signal })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `Failed to download generated video (${res.status} ${res.statusText}). url=${urls[0]} body=${body.slice(0, 200)}`,
    )
  }
  const contentType = res.headers.get('content-type') ?? ''
  const blob = await res.blob()
  if (blob.size === 0) {
    throw new Error(
      `kie.ai returned an empty video (0 bytes). url=${urls[0]} — likely filtered by content policy or the result expired.`,
    )
  }
  const effectiveType = contentType || blob.type
  if (effectiveType && !effectiveType.startsWith('video/')) {
    const sample = await blob.text().catch(() => '')
    throw new Error(
      `kie.ai returned non-video content-type=${effectiveType}. url=${urls[0]} body=${sample.slice(0, 200)}`,
    )
  }
  // Final check: ask the browser if it can decode the blob. Catches the case
  // where kie returns 200 + video/mp4 but the bytes are an HTML error page,
  // a CORS-opaque stub, or a content-filtered 0-duration placeholder — all
  // of which produce a silent black tile in the UI.
  await probeVideoBlob(blob, urls[0])
  return saveAsset(blob)
}

// Verify the downloaded blob is actually a playable video before we persist
// it. The size + content-type guards catch obvious failures (0 bytes,
// application/json), but not the trickier cases where kie's CDN hands back a
// 200 with the right Content-Type yet the bytes are a CORS-opaque stub, an
// HTML error page tagged as video/mp4, or a content-filtered MP4 with no
// decodable frames. Those all render as a silent black tile with `0:00` in the
// controls. We hand the blob to a hidden <video>, wait for `loadedmetadata`,
// and treat anything with a non-finite or near-zero duration as broken.
async function probeVideoBlob(blob: Blob, sourceUrl: string): Promise<void> {
  const objectUrl = URL.createObjectURL(blob)
  try {
    await new Promise<void>((resolve, reject) => {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.muted = true
      const cleanup = () => {
        v.removeAttribute('src')
        v.load()
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(
          `Video metadata probe timed out after 8s. url=${sourceUrl} size=${blob.size}B type=${blob.type || '(none)'}`,
        ))
      }, 8000)
      v.onloadedmetadata = () => {
        clearTimeout(timer)
        const d = v.duration
        cleanup()
        if (!isFinite(d) || d < 0.1) {
          reject(new Error(
            `kie.ai returned an undecodable video (duration=${d}s, size=${blob.size}B, type=${blob.type || '(none)'}). Likely a content-filtered placeholder or a CORS-opaque response. url=${sourceUrl}`,
          ))
          return
        }
        resolve()
      }
      v.onerror = () => {
        clearTimeout(timer)
        cleanup()
        reject(new Error(
          `Browser rejected the downloaded video blob (size=${blob.size}B, type=${blob.type || '(none)'}). url=${sourceUrl}`,
        ))
      }
      v.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
