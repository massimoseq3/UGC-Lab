// Cut-point keyframe extraction for the perception pass. Gemini samples video
// at roughly 1 fps, and UGC ads cut every 1-3 seconds — quick product inserts
// and text-card flashes literally fall between sampled frames. This detects
// hard cuts client-side (frame-difference spikes on a tiny downscaled canvas)
// and captures a still just after each one, so the model gets every shot even
// when the video sampling skips it.
//
// Best-effort by design: any failure returns the frames gathered so far (or
// none) and the analysis proceeds with the video alone.

export interface Keyframe {
  // Seconds into the video the frame was captured at.
  time: number
  dataUri: string
}

// Sampling cadence for cut detection. 4 fps catches 1-3s UGC cutting comfortably.
const SAMPLE_STEP_S = 0.25
// Cap detection work on long uploads — the step widens instead.
const MAX_SAMPLES = 480
// Downscale width for the diff pass; detail is irrelevant, only change is.
const DIFF_WIDTH = 64
// Capture resolution/quality — enough to read label text without bloating the
// request (each frame rides inline as base64 next to the video).
const CAPTURE_WIDTH = 480
const CAPTURE_QUALITY = 0.7
const MAX_KEYFRAMES = 20
// A cut must clear both an absolute floor (mean per-channel delta, 0-255) and
// a multiple of the clip's median frame-to-frame motion.
const DIFF_FLOOR = 14
const DIFF_MEDIAN_FACTOR = 3
// Two detections closer than this are one cut (fades/whip-pans spike twice).
const MIN_CUT_GAP_S = 0.4
const OVERALL_TIMEOUT_MS = 45_000

export async function extractCutKeyframes(file: File): Promise<Keyframe[]> {
  if (!file.type.startsWith('video/')) return []

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url

  const deadline = Date.now() + OVERALL_TIMEOUT_MS
  const cleanup = () => {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => reject(new Error('Video load timed out')), 10_000)
      video.addEventListener('error', () => { window.clearTimeout(timeoutId); reject(new Error('Video failed to decode')) }, { once: true })
      video.addEventListener('loadeddata', () => { window.clearTimeout(timeoutId); resolve() }, { once: true })
    })

    // Recorded WebMs (screen captures etc.) report duration: Infinity until
    // forced to seek far past the end — the standard workaround.
    if (video.duration === Infinity) {
      await new Promise<void>((resolve) => {
        const timeoutId = window.setTimeout(() => resolve(), 3_000)
        video.addEventListener('seeked', () => { window.clearTimeout(timeoutId); resolve() }, { once: true })
        video.currentTime = 1e7
      })
      video.currentTime = 0
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const naturalW = video.videoWidth
    const naturalH = video.videoHeight
    if (!duration || !naturalW || !naturalH) return []

    const seekTo = (t: number) =>
      new Promise<void>((resolve, reject) => {
        if (Date.now() > deadline) { reject(new Error('Keyframe extraction timed out')); return }
        const timeoutId = window.setTimeout(() => reject(new Error('Seek timed out')), 5_000)
        video.addEventListener('seeked', () => { window.clearTimeout(timeoutId); resolve() }, { once: true })
        video.currentTime = t
      })

    // ── Pass 1: sample tiny frames and measure frame-to-frame change ──
    const step = Math.max(SAMPLE_STEP_S, duration / MAX_SAMPLES)
    const diffCanvas = document.createElement('canvas')
    diffCanvas.width = DIFF_WIDTH
    diffCanvas.height = Math.max(1, Math.round((naturalH / naturalW) * DIFF_WIDTH))
    const diffCtx = diffCanvas.getContext('2d', { willReadFrequently: true })
    if (!diffCtx) return []

    let prev: Uint8ClampedArray | null = null
    const diffs: Array<{ time: number; diff: number }> = []
    // Start slightly past 0 (encoders often emit a black frame at exactly 0)
    // and stop a hair before the end (seeking to duration may never fire).
    for (let t = 0.1; t < duration - 0.05; t += step) {
      await seekTo(t)
      diffCtx.drawImage(video, 0, 0, diffCanvas.width, diffCanvas.height)
      const data = diffCtx.getImageData(0, 0, diffCanvas.width, diffCanvas.height).data
      if (prev) {
        let sum = 0
        for (let i = 0; i < data.length; i += 4) {
          sum += Math.abs(data[i] - prev[i]) + Math.abs(data[i + 1] - prev[i + 1]) + Math.abs(data[i + 2] - prev[i + 2])
        }
        diffs.push({ time: t, diff: sum / (data.length * 0.75) })
      }
      prev = data.slice()
    }
    if (diffs.length === 0) return []

    // ── Detect cuts: spikes well above the clip's typical motion ──
    const sorted = diffs.map((d) => d.diff).sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const threshold = Math.max(DIFF_FLOOR, median * DIFF_MEDIAN_FACTOR)
    const cutTimes: number[] = []
    for (const { time, diff } of diffs) {
      if (diff < threshold) continue
      if (cutTimes.length > 0 && time - cutTimes[cutTimes.length - 1] < MIN_CUT_GAP_S) continue
      cutTimes.push(time)
    }

    // Keyframe times: the opening frame plus one frame per detected cut
    // (the spike sample already sits just past the boundary).
    const times = evenlySpread([0.1, ...cutTimes], MAX_KEYFRAMES)

    // ── Pass 2: capture the chosen frames at readable resolution ──
    const scale = naturalW > CAPTURE_WIDTH ? CAPTURE_WIDTH / naturalW : 1
    const capCanvas = document.createElement('canvas')
    capCanvas.width = Math.round(naturalW * scale)
    capCanvas.height = Math.round(naturalH * scale)
    const capCtx = capCanvas.getContext('2d')
    if (!capCtx) return []

    const frames: Keyframe[] = []
    for (const t of times) {
      await seekTo(t)
      capCtx.drawImage(video, 0, 0, capCanvas.width, capCanvas.height)
      const dataUri = capCanvas.toDataURL('image/jpeg', CAPTURE_QUALITY)
      if (dataUri && dataUri.startsWith('data:image/')) frames.push({ time: t, dataUri })
    }
    return frames
  } catch (e) {
    console.warn('[ad-anatomy] keyframe extraction failed — analysing video only', e)
    return []
  } finally {
    cleanup()
  }
}

// Trim a chronological list down to `max` entries by keeping the first and
// spreading the rest evenly, so coverage stays spread across the ad instead of
// front-loaded onto its opening seconds. Used both when detection finds more
// cuts than we cap at, and when the request's payload budget can't carry every
// frame we captured.
export function evenlySpread<T>(items: T[], max: number): T[] {
  if (max <= 0) return []
  if (items.length <= max) return items
  if (max === 1) return [items[0]]
  const kept: T[] = [items[0]]
  const stride = (items.length - 1) / (max - 1)
  for (let i = 1; i < max; i++) kept.push(items[Math.round(i * stride)])
  return [...new Set(kept)]
}

export function formatKeyframeTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const m = Math.floor(whole / 60)
  const s = whole % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
