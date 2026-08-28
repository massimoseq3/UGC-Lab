// Hand a generated B-Roll video to Playground as a source clip — the
// "regenerate this exact take, but change X" loop (redub the dialogue in
// Spanish, restyle the setting, …). WHICH model receives it is Playground's
// call, not this file's: it owns the `videoSourceClip` branch and the models
// that take a video input at all. The asset:// ref passes through as-is:
// Playground's service resolves it at generate time, and unlike an uploaded
// data URI it survives a refresh.

import { useAppStore } from '../../../stores/appStore'
import type { VideoSourceClipPayload } from '../../../stores/types'
import { getUrl } from '../../../utils/assetStore'
import { readMediaDuration } from '../../../utils/media'
import type { GeneratedVideo } from '../types'

export async function sendClipToPlayground(video: GeneratedVideo) {
  // The stored durationSeconds is what was *requested*; per-call models (Veo)
  // decide their own clip length, so read the real duration off the blob and
  // fall back to the stored value when metadata is unreadable or bogus
  // (streamed webm containers report 0 or Infinity).
  let durationSeconds: number | undefined = video.durationSeconds
  try {
    const url = await getUrl(video.url)
    if (url) {
      const actual = await readMediaDuration(url, 'video')
      if (Number.isFinite(actual) && actual > 0) durationSeconds = actual
    }
  } catch { /* keep the stored value */ }

  const payload: VideoSourceClipPayload = {
    videoRef: video.url,
    durationSeconds,
    label: 'B-Roll clip',
  }
  useAppStore.getState().sendToApp({
    targetApp: 'playground',
    targetField: 'videoSourceClip',
    data: payload,
  })
}
