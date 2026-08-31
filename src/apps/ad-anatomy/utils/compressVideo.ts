// Re-encodes an oversized ad in the browser so it still fits inside one chat
// request.
//
// WHY THIS EXISTS. The analysis sends the whole clip INLINE as a base64 data
// URI (see the note in `services/analyzeAd.ts` — the hosted-URL route was tried
// and reverted). Base64 is 4/3 of the bytes it encodes, so the request body is
// ~1.34x the file on disk, and the model's inline-request ceiling is what a real
// ad walks past: a 20MB MP4 is a ~27MB body and comes back 400 before a single
// frame is read. That is the "video is too large" rejection members were
// hitting, and it fired on files the app had already accepted — the upload cap
// was 50MB while the transport could only carry ~14MB.
//
// REALTIME, ON PURPOSE. MediaRecorder encodes at playback speed, so a 40s ad
// costs ~40s. That is real, but small next to the analysis it makes possible,
// and the alternatives (WebCodecs plus an MP4 muxer, or ffmpeg.wasm) are a new
// dependency and a second decoder to debug for a path that only runs on the
// files that would otherwise fail outright. Anything already under budget is
// sent untouched.
//
// AUDIO IS NOT OPTIONAL HERE. The analysis returns a transcript, so a silent
// re-encode would not fail — it would come back confidently reporting an ad
// with no speech, which is worse than an error. So the audio graph is set up
// BEFORE recording starts and this throws if it can't be brought up, rather
// than quietly shipping a mute clip.

// Long edge of the re-encoded frame. The model samples a video at roughly one
// frame a second and reads those frames like stills; 720 keeps on-screen
// caption text legible, which is the detail the prompt contract asks it to
// transcribe verbatim.
const MAX_LONG_EDGE = 720
// Below this bitrate 720p turns to mush and the captions stop being readable —
// a long ad is better served by a smaller, cleaner frame.
const LOW_BITRATE_THRESHOLD = 700_000
const LOW_BITRATE_LONG_EDGE = 480
const MIN_VIDEO_BITRATE = 250_000
const MAX_VIDEO_BITRATE = 4_000_000
const AUDIO_BITRATE = 64_000
const TARGET_FPS = 24
// Leave room inside the budget for VBR overshoot: the bitrate we ask for is an
// average and the encoder is free to miss it.
const BUDGET_HEADROOM = 0.8
// Past this, a realtime pass is a wait nobody would sit through and the bitrate
// needed to hit the budget is below anything readable. Trimming is the answer.
const MAX_DURATION_SEC = 180
// Watchdog on the whole recording. Playback can stall on a damaged file, and
// the caller is awaiting this behind a spinner with nothing to cancel.
const STALL_GRACE_MS = 30_000

import { FriendlyError } from '../../../utils/friendlyError'

export interface CompressedVideo {
  file: File
  originalBytes: number
  compressedBytes: number
}

// Ordered best-first. MP4 leads because it is the container the rest of the app
// already speaks and the only one Safari can write; WebM is equally readable by
// the model and is the fallback.
//
// NO PINNED CODEC STRING, and don't add one back. `MediaRecorder.isTypeSupported`
// answers true for 'video/mp4;codecs=avc1.42E01E,mp4a.40.2' in Chrome and then
// the encoder dies at runtime with a bare `EncodingError: Internal Error` —
// verified against Chrome 148, where the unqualified 'video/mp4' records the
// identical stream without complaint. isTypeSupported is a hint here, not a
// guarantee, so let the browser pick the profile it can actually deliver.
const CONTAINER_CANDIDATES = [
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

function pickContainer(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return CONTAINER_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

export function canCompressVideo(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    pickContainer() !== null
  )
}

// Bytes the browser's own audio decoder has handled for this element. Chromium
// and WebKit both expose it; Firefox exposes a boolean instead. An engine that
// exposes neither returns 0, which reads as "can't tell" and is treated as an
// ad with no sound — the silence check below then stands down rather than
// failing a re-encode it has no evidence against.
function decodedAudioBytes(video: HTMLVideoElement): number {
  const el = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean }
  if (typeof el.webkitAudioDecodedByteCount === 'number') return el.webkitAudioDecodedByteCount
  if (typeof el.mozHasAudio === 'boolean') return el.mozHasAudio ? 1 : 0
  return 0
}

// The clock that drives frame capture, ticking on a WORKER rather than on the
// page.
//
// A hidden tab throttles main-thread timers to roughly one a second — measured
// in Chrome 148, a `setInterval(41)` fired 4 times in 3 seconds against a
// worker's 86 — while the video element and MediaRecorder keep running at full
// speed. A page timer therefore produced a clip with complete audio over a
// ~1fps slideshow the moment the member switched browser tabs mid-encode, and
// nothing in the result said so. Worker timers are exempt from that throttle,
// so the frame rate no longer depends on the member watching.
//
// Falls back to a page timer if a worker can't be created (a CSP that forbids
// blob: workers) — degraded, but the same clip it used to produce.
function startFrameClock(intervalMs: number, onTick: () => void): () => void {
  try {
    const blobUrl = URL.createObjectURL(
      new Blob([`const id=setInterval(()=>postMessage(0),${intervalMs});onmessage=()=>{clearInterval(id);close()}`], {
        type: 'text/javascript',
      }),
    )
    const worker = new Worker(blobUrl)
    worker.onmessage = () => onTick()
    return () => {
      worker.terminate()
      URL.revokeObjectURL(blobUrl)
    }
  } catch {
    const timer = window.setInterval(onTick, intervalMs)
    return () => window.clearInterval(timer)
  }
}

function extensionFor(mimeType: string): string {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
}

function renameForContainer(fileName: string, mimeType: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '') || 'ad'
  return `${stem}-compressed.${extensionFor(mimeType)}`
}

function loadMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.onloadedmetadata = null
      video.onerror = null
    }
    video.onloadedmetadata = () => {
      done()
      resolve()
    }
    video.onerror = () => {
      done()
      reject(new FriendlyError('This browser could not open the video to compress it.'))
    }
  })
}

/**
 * Shrink `file` to fit `targetBytes`, preserving its full duration and audio.
 * Throws with a member-readable sentence when it can't — the caller surfaces it
 * as the analysis error, so every message here has to name what to do next.
 */
export async function compressVideoForAnalysis(
  file: File,
  targetBytes: number,
): Promise<CompressedVideo> {
  const mimeType = pickContainer()
  if (!mimeType || !canCompressVideo()) {
    throw new FriendlyError(
      'This browser cannot compress video, so this ad is too large to analyse here. Try Chrome, or export a smaller version of the clip.',
    )
  }

  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = objectUrl
  video.preload = 'auto'
  video.playsInline = true
  // DELIBERATELY NOT MUTED, and it must stay that way. Chromium applies the
  // element's effective volume before the audio reaches a
  // MediaElementAudioSourceNode, so `muted = true` silences the Web Audio graph
  // too — the recording would come back mute and the analysis would confidently
  // report an ad with no speech. Nothing is connected to audioCtx.destination
  // below, so the sound still never leaves the graph; the element is silent to
  // the member either way. The cost is that play() is an audible autoplay and
  // can be refused, which is caught and reported rather than worked around.

  // A decoder, a canvas stream and an AudioContext are acquired one after
  // another, each behind a check that can bail — so cleanup is a stack pushed
  // to as they open rather than one try/finally, which would have to know which
  // of them exist yet. `release()` runs on every exit path; a queue job must
  // not leak a decoder.
  const cleanups: Array<() => void> = [() => URL.revokeObjectURL(objectUrl)]
  const release = () => {
    for (const fn of cleanups.reverse()) {
      try {
        fn()
      } catch {
        // Best-effort teardown — one failure must not strand the rest.
      }
    }
    cleanups.length = 0
  }
  const fail = (message: string): never => {
    release()
    throw new FriendlyError(message)
  }

  try {
    await loadMetadata(video)
  } catch (err) {
    release()
    throw err
  }

  const duration = video.duration
  if (!Number.isFinite(duration) || duration <= 0) {
    return fail('Could not read how long this ad is, so it cannot be compressed. Re-export it and try again.')
  }
  if (duration > MAX_DURATION_SEC) {
    return fail(
      `This ad is ${Math.round(duration)} seconds long and too large to send as-is. Trim it to under ${MAX_DURATION_SEC / 60} minutes and analyse it again.`,
    )
  }

  // Derive the bitrate from the budget rather than picking one and hoping: the
  // budget is fixed by the transport, so duration is the only variable.
  const bitsAvailable = targetBytes * BUDGET_HEADROOM * 8
  const videoBitrate = Math.round(
    Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, bitsAvailable / duration - AUDIO_BITRATE)),
  )
  const longEdge = videoBitrate < LOW_BITRATE_THRESHOLD ? LOW_BITRATE_LONG_EDGE : MAX_LONG_EDGE

  const srcW = video.videoWidth || longEdge
  const srcH = video.videoHeight || longEdge
  const scale = Math.min(1, longEdge / Math.max(srcW, srcH))
  // Even dimensions — H.264 rejects odd ones outright and VP9 handles them
  // badly.
  const width = Math.max(2, Math.round((srcW * scale) / 2) * 2)
  const height = Math.max(2, Math.round((srcH * scale) / 2) * 2)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return fail('This browser could not prepare the video for analysis. Try reloading the page.')

  const videoStream = canvas.captureStream(TARGET_FPS)
  cleanups.push(() => videoStream.getTracks().forEach((t) => t.stop()))

  // Audio, via Web Audio rather than HTMLMediaElement.captureStream — Safari
  // does not implement the latter at all, and this app's members are on it.
  // Nothing is connected to audioCtx.destination, so the graph carries the
  // track without playing it out loud.
  const AudioCtor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtor) {
    return fail('This browser cannot read the ad’s audio, so the transcript would come back empty. Try Chrome, or export a smaller version of the clip.')
  }
  const audioCtx = new AudioCtor()
  cleanups.push(() => void audioCtx.close().catch(() => {}))
  const audioDest = audioCtx.createMediaStreamDestination()
  // The level meter sits IN the path (source → analyser → destination) rather
  // than tapped off the side. A MediaStreamAudioDestinationNode has no outputs
  // to tap, and a node hanging off the source with nothing downstream isn't
  // guaranteed to be pulled at all — an analyser is a pass-through, so putting
  // it inline costs nothing and is the only placement that always sees audio.
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 2048
  audioCtx.createMediaElementSource(video).connect(analyser)
  analyser.connect(audioDest)
  if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {})
  if (audioCtx.state !== 'running') {
    // Recording now would produce a silent clip and the analysis would report
    // an ad with no speech — a wrong answer, not a failed one.
    return fail('Could not capture the ad’s audio to compress it. Click anywhere on the page and retry the analysis.')
  }

  // Watch the level on the way past. The one failure this whole function has to
  // rule out is a SILENT re-encode: it would not throw, it would come back as a
  // clean analysis of an ad that supposedly has no dialogue, and the member has
  // no way to tell that from the truth. `peak` is checked against the decoder's
  // own byte counter at the end — see the note there.
  const levels = new Float32Array(analyser.fftSize)
  let peak = 0
  const sampleLevel = () => {
    analyser.getFloatTimeDomainData(levels)
    for (const v of levels) {
      const abs = Math.abs(v)
      if (abs > peak) peak = abs
    }
  }

  const stream = new MediaStream([...videoStream.getVideoTracks(), ...audioDest.stream.getAudioTracks()])
  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: videoBitrate,
      audioBitsPerSecond: AUDIO_BITRATE,
    })
  } catch {
    return fail('This browser could not compress the ad. Try Chrome, or export a smaller version of the clip.')
  }

  const chunks: Blob[] = []
  const recorded = new Promise<Blob>((resolve, reject) => {
    // Not requestAnimationFrame: it stops dead in a hidden tab, which would
    // freeze the picture while the audio kept recording. See startFrameClock.
    const stopClock = startFrameClock(Math.round(1000 / TARGET_FPS), () => {
      if (video.readyState >= 2) ctx.drawImage(video, 0, 0, width, height)
      sampleLevel()
    })
    const watchdog = window.setTimeout(
      () => stop(new FriendlyError('Compressing this ad timed out. Re-export it as a smaller file and try again.')),
      duration * 1000 + STALL_GRACE_MS,
    )
    let settled = false
    const stop = (err?: Error) => {
      if (settled) return
      settled = true
      stopClock()
      window.clearTimeout(watchdog)
      video.pause()
      if (recorder.state !== 'inactive') recorder.stop()
      if (err) reject(err)
    }
    cleanups.push(() => stop())

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
    recorder.onerror = (e) => {
      // The member gets the sentence; the console keeps the cause, the same
      // split the analysis queue makes on a failed run.
      console.error('[ad-anatomy] MediaRecorder failed', (e as unknown as { error?: unknown }).error ?? e)
      stop(new FriendlyError('Compressing this ad failed. Re-export it as a smaller file and try again.'))
    }
    video.onended = () => stop()
    video.onerror = () => stop(new FriendlyError('Playback of the ad failed while compressing it. Re-export it and try again.'))

    console.log(`[ad-anatomy] re-encoding ${width}x${height} @ ${Math.round(videoBitrate / 1000)}kbps as ${mimeType}`)
    recorder.start(1000)
    video.play().catch(() => stop(new FriendlyError('Could not play the ad to compress it. Re-export it and try again.')))
  })

  let blob: Blob
  try {
    blob = await recorded
  } catch (err) {
    release()
    throw err
  }
  release()

  if (blob.size === 0) {
    throw new FriendlyError('Compressing this ad produced an empty file. Re-export it as a smaller file and try again.')
  }

  // Silent recording of an ad that DOES have sound — the graph came up but
  // carried nothing (a refused audible autoplay, a suspended context, a
  // decoder that never fed the source node). Shipping it would cost the member
  // the transcript and every spoken line in the scene prompts, and they would
  // read as an ad nobody talks in rather than as a failure. `decodedAudioBytes`
  // is what separates that from an ad that is genuinely silent: it counts what
  // the DECODER handled, upstream of anything the capture path can drop.
  if (peak === 0 && decodedAudioBytes(video) > 0) {
    throw new FriendlyError(
      'The ad’s audio could not be captured while compressing it, so the transcript would come back empty. Click anywhere on the page and retry the analysis.',
    )
  }

  return {
    file: new File([blob], renameForContainer(file.name, mimeType), { type: mimeType }),
    originalBytes: file.size,
    compressedBytes: blob.size,
  }
}
