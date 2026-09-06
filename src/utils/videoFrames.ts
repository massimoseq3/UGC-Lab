// Pulls a single still frame out of a video — used by the Playground preview
// lightbox so a generated clip's first or last frame can be saved to the bank
// or downloaded. Full resolution (no downscale) since these become reusable
// start frames / references. PNG to stay lossless.
//
// 'first' seeks slightly past 0 (some encoders emit a black frame at exactly 0);
// 'last' seeks a hair before the end (seeking to exactly duration often never
// fires `seeked`).

export type FramePosition = 'first' | 'last'

export function extractVideoFrame(src: string, position: FramePosition): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.src = src

    let settled = false
    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }
    const fail = (msg: string) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(msg))
    }
    const timeoutId = window.setTimeout(() => fail('Frame capture timed out'), 12000)

    const grab = () => {
      try {
        const w = video.videoWidth
        const h = video.videoHeight
        if (!w || !h) { fail('Video had no dimensions'); return }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { fail('Canvas 2D context unavailable'); return }
        ctx.drawImage(video, 0, 0, w, h)
        canvas.toBlob((blob) => {
          window.clearTimeout(timeoutId)
          if (!blob || blob.size === 0) { fail('Empty frame blob'); return }
          settled = true
          cleanup()
          resolve(blob)
        }, 'image/png')
      } catch (e) {
        fail(e instanceof Error ? e.message : 'Frame capture threw')
      }
    }

    video.addEventListener('error', () => fail('Video failed to decode'))
    video.addEventListener('seeked', grab)
    video.addEventListener('loadeddata', () => {
      try {
        const d = video.duration
        const t = position === 'first'
          ? Math.min(0.1, (d || 0.2) / 2)
          : Math.max(0, (Number.isFinite(d) ? d : 0) - 0.1)
        video.currentTime = t
      } catch {
        fail('Video seek failed')
      }
    })
  })
}

// Whether the element currently holds a painted frame a canvas read can copy.
// Below this the canvas comes back blank rather than throwing, which is worse
// than refusing.
//
// `readyState >= 2` (HAVE_CURRENT_DATA) is the obvious test and the usual
// answer, but it is not the whole one: a short clip that has played out — or
// one whose buffer ran dry — drops back to HAVE_METADATA while its last frame
// stays on screen, so the readyState test alone refuses a grab of a frame the
// member is looking at. The decoded-frame counters settle that case; the
// `webkit`-prefixed one is the fallback for older Safari.
export function hasDecodedFrame(video: HTMLVideoElement): boolean {
  if (video.readyState >= 2) return true
  const quality = video.getVideoPlaybackQuality?.()
  if (quality && quality.totalVideoFrames > 0) return true
  const decoded = (video as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount
  return typeof decoded === 'number' && decoded > 0
}

// Grabs the frame a <video> is showing RIGHT NOW, straight off the live
// element on screen. `extractVideoFrame` above loads its own hidden video and
// seeks to a fixed position; this one needs no second decode and returns
// exactly the frame the member is looking at — which is the whole point when
// they scrubbed to that moment themselves. Full natural resolution (so it
// beats the screenshot it replaces), PNG to stay lossless.
//
// The source has to be same-origin or CORS-clean, same as any canvas read.
export function captureFrameFromElement(video: HTMLVideoElement): Promise<Blob> {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return Promise.reject(new Error('Video had no dimensions'))
  if (!hasDecodedFrame(video)) return Promise.reject(new Error('No frame decoded yet'))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas 2D context unavailable'))
  ctx.drawImage(video, 0, 0, w, h)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.size === 0) reject(new Error('Empty frame blob'))
      else resolve(blob)
    }, 'image/png')
  })
}

// `00m04s20` — minutes, seconds and hundredths, safe in a filename and
// precise enough to tell two grabs from the same ad apart.
export function frameTimeStamp(seconds: number): string {
  const t = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const mm = String(Math.floor(t / 60)).padStart(2, '0')
  const ss = String(Math.floor(t % 60)).padStart(2, '0')
  // Rounded, not floored: 1.4s arrives as 1.39999… and floors to `s39`.
  const cs = String(Math.min(99, Math.round((t % 1) * 100))).padStart(2, '0')
  return `${mm}m${ss}s${cs}`
}
