// Re-encodes an oversized ad in the browser so it still fits inside the
// analyser's upload budget.
//
// WHY THIS EXISTS. The clip is uploaded to kie's file host and the POST that
// carries it is base64, which is 4/3 of the bytes it encodes — so a real ad
// walks past the budget the analyser can send and comes back rejected before a
// single frame is read. That is the "video is too large" rejection members were
// hitting, and it fired on files the app had already accepted.
//
// REALTIME, ON PURPOSE. MediaRecorder encodes at playback speed, so a 40s ad
// costs ~40s. That is real, but small next to the analysis it makes possible,
// and the alternatives (WebCodecs plus an MP4 muxer, or ffmpeg.wasm) are a new
// dependency and a second decoder to debug for a path that only runs on the
// files that would otherwise fail outright. Anything already under budget is
// sent untouched.
//
// IT AIMS, MEASURES, AND AIMS AGAIN. `videoBitsPerSecond` is a REQUEST, not a
// contract: the encoder is free to miss it, and on a high-motion ad it misses
// high — a single pass came back 13.3MB against a 12MB budget, which the
// caller could then only report as a failure to a member who had already
// waited out the whole re-encode. So an overshoot is re-aimed from the size the
// encoder ACTUALLY produced rather than from the number it ignored, and run
// again. Each extra pass costs another realtime run, which is why the caller
// tells the member a second one is happening.
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
// Ceiling on the asked-for bitrate, and it is what bounds a SHORT ad: spread
// over a few seconds the budget buys a bitrate no encoder needs, so the cap is
// the only thing standing between a 10s ad and a wildly bigger file than it has
// any reason to be. 2.5Mbps at 720-on-the-long-edge is already a clean encode.
const MAX_VIDEO_BITRATE = 2_500_000
const AUDIO_BITRATE = 64_000
// Capture frame rate. The model samples the clip at roughly ONE frame a second
// and reads those frames like stills, so everything above a few fps is spent on
// motion nothing ever looks at — and frame rate is the biggest lever there is
// on how many bits the encoder wants. 12 still catches every cut a viewer would
// see while asking for roughly a third less than 24 did.
const TARGET_FPS = 12
// Leave room inside the budget for the encoder to miss the bitrate it is given
// — and it misses HIGH. This is deliberately generous: an ad that comes back
// over budget costs a second realtime pass, which is a wait the member watches,
// while aiming low costs a little quality on a clip only a model ever sees. At
// 0.55 the first pass tolerates the encoder overshooting by 1.8x.
const BUDGET_HEADROOM = 0.55
// How many realtime passes we are willing to spend landing under the budget.
// Two is almost always enough — the first pass measures the encoder's real
// overshoot on THIS clip and the second corrects for it — and three is the
// ceiling because every pass is another wait as long as the ad.
const MAX_PASSES = 3
// A re-aim targets a little under the budget rather than exactly at it: the
// correction is computed from one sample of a variable-bitrate encoder, so
// landing at 99% of the limit would be a coin flip on a wait we've already
// paid for twice.
const RETRY_HEADROOM = 0.9
// A pass that shaved less than this off the last one has stopped responding to
// the bitrate we ask for (the floor, the container, or an encoder ignoring us),
// so another identical wait would buy nothing.
const MIN_PASS_IMPROVEMENT = 0.05
// In-pass rate control. `videoBitsPerSecond` is a request an encoder can ignore
// outright, and the only lever left once it is running is how many frames we
// hand it — so the recording watches its own accumulating size and thins the
// frame clock when the run projects over budget. It is the half of this file
// that does not depend on the encoder cooperating at all: fewer frames is fewer
// bits whatever its rate control is doing. Projection starts a few seconds in
// (the first chunks carry the headers and a keyframe, so an early estimate
// reads high) and the floor is low because a model sampling one frame a second
// cannot tell 4fps from 12.
const PROJECTION_AFTER_SEC = 3
const PROJECTION_TRIGGER = 0.95
const MIN_ADAPTIVE_FPS = 4
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
  /** Realtime passes it took to land under the budget. 1 unless the encoder overshot. */
  passes: number
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
interface FrameClock {
  /** Retime the clock mid-recording — the one lever left once the encoder is running. */
  retime(intervalMs: number): void
  stop(): void
}

function startFrameClock(intervalMs: number, onTick: () => void): FrameClock {
  try {
    const blobUrl = URL.createObjectURL(
      new Blob(
        [
          `let id;const run=(ms)=>{clearInterval(id);id=setInterval(()=>postMessage(0),ms)};run(${intervalMs});` +
            `onmessage=(e)=>{if(e.data==='stop'){clearInterval(id);close()}else run(e.data)}`,
        ],
        { type: 'text/javascript' },
      ),
    )
    const worker = new Worker(blobUrl)
    worker.onmessage = () => onTick()
    return {
      retime: (ms) => worker.postMessage(ms),
      stop: () => {
        worker.terminate()
        URL.revokeObjectURL(blobUrl)
      },
    }
  } catch {
    let timer = window.setInterval(onTick, intervalMs)
    return {
      retime: (ms) => {
        window.clearInterval(timer)
        timer = window.setInterval(onTick, ms)
      },
      stop: () => window.clearInterval(timer),
    }
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

// Duration alone, read before any encoding starts: it is what the first
// bitrate is derived from, and what the too-long guard answers on. A metadata
// read is cheap next to the realtime pass it gates.
async function readDuration(file: File): Promise<number> {
  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.src = objectUrl
  try {
    await loadMetadata(video)
    return video.duration
  } finally {
    video.src = ''
    URL.revokeObjectURL(objectUrl)
  }
}

interface PassResult {
  blob: Blob
  mimeType: string
  /** True when the graph recorded silence out of a file whose decoder reported audio. */
  silentDespiteAudio: boolean
}

/**
 * One realtime re-encode at the requested bitrate. Throws (with member-readable
 * copy) on anything that makes the run unusable; an oversized result is NOT a
 * failure here — that is the caller's to re-aim.
 */
async function encodePass(
  file: File,
  mimeType: string,
  videoBitrate: number,
  pass: number,
  targetBytes: number,
): Promise<PassResult> {
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
  const clipSeconds = video.duration || MAX_DURATION_SEC
  const recorded = new Promise<Blob>((resolve, reject) => {
    // Not requestAnimationFrame: it stops dead in a hidden tab, which would
    // freeze the picture while the audio kept recording. See startFrameClock.
    let fps = TARGET_FPS
    const clock = startFrameClock(Math.round(1000 / fps), () => {
      if (video.readyState >= 2) ctx.drawImage(video, 0, 0, width, height)
      sampleLevel()
    })
    const watchdog = window.setTimeout(
      () => stop(new FriendlyError('Compressing this ad timed out. Re-export it as a smaller file and try again.')),
      clipSeconds * 1000 + STALL_GRACE_MS,
    )
    let settled = false
    const stop = (err?: Error) => {
      if (settled) return
      settled = true
      clock.stop()
      window.clearTimeout(watchdog)
      video.pause()
      if (recorder.state !== 'inactive') recorder.stop()
      if (err) reject(err)
    }
    cleanups.push(() => stop())

    // `recorder.start(1000)` hands a chunk over every second, which makes the
    // run's own size readable WHILE it happens rather than only once it is too
    // late to do anything about it. Project it out to the full clip, and thin
    // the frame clock if that projection is heading past the budget — the only
    // control we have left over an encoder that is ignoring the bitrate it was
    // handed. Bits already spent can't be recovered, so this is a backstop
    // under a deliberately conservative first aim, not a substitute for one.
    const startedAt = performance.now()
    let recordedBytes = 0
    recorder.ondataavailable = (e) => {
      if (e.data.size <= 0) return
      chunks.push(e.data)
      recordedBytes += e.data.size
      const elapsed = (performance.now() - startedAt) / 1000
      if (elapsed < PROJECTION_AFTER_SEC || fps <= MIN_ADAPTIVE_FPS) return
      const projected = (recordedBytes / elapsed) * clipSeconds
      if (projected <= targetBytes * PROJECTION_TRIGGER) return
      fps = Math.max(MIN_ADAPTIVE_FPS, Math.round(fps / 2))
      clock.retime(Math.round(1000 / fps))
      console.log(
        `[ad-anatomy] pass ${pass} projects ${(projected / (1024 * 1024)).toFixed(1)}MB — thinning to ${fps}fps`,
      )
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

    console.log(`[ad-anatomy] pass ${pass}: re-encoding ${width}x${height} @ ${Math.round(videoBitrate / 1000)}kbps, ${TARGET_FPS}fps, as ${mimeType}`)
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
  // Read the decoder's counter BEFORE teardown — a released element reports
  // nothing, and this is the evidence that separates a capture failure from an
  // ad that is genuinely silent.
  const hadAudio = decodedAudioBytes(video) > 0
  release()

  if (blob.size === 0) {
    throw new FriendlyError('Compressing this ad produced an empty file. Re-export it as a smaller file and try again.')
  }

  return { blob, mimeType, silentDespiteAudio: peak === 0 && hadAudio }
}

/**
 * Shrink `file` to fit `targetBytes`, preserving its full duration and audio.
 * Runs up to `MAX_PASSES` realtime encodes, re-aiming after any that overshoots
 * — `onPass` is called with the 1-based number of each one so the caller can
 * say what the extra wait is for.
 *
 * Throws with a member-readable sentence when it can't — the caller surfaces it
 * as the analysis error, so every message here has to name what to do next.
 */
export async function compressVideoForAnalysis(
  file: File,
  targetBytes: number,
  onPass?: (pass: number) => void,
): Promise<CompressedVideo> {
  const mimeType = pickContainer()
  if (!mimeType || !canCompressVideo()) {
    throw new FriendlyError(
      'This browser cannot compress video, so this ad is too large to analyse here. Try Chrome, or export a smaller version of the clip.',
    )
  }

  const duration = await readDuration(file)
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new FriendlyError('Could not read how long this ad is, so it cannot be compressed. Re-export it and try again.')
  }
  if (duration > MAX_DURATION_SEC) {
    throw new FriendlyError(
      `This ad is ${Math.round(duration)} seconds long and too large to send as-is. Trim it to under ${MAX_DURATION_SEC / 60} minutes and analyse it again.`,
    )
  }

  // Derive the bitrate from the budget rather than picking one and hoping: the
  // budget is fixed by the transport, so duration is the only variable. `aim`
  // is the size we ASK for; what comes back is what we re-aim from.
  let aim = targetBytes * BUDGET_HEADROOM
  let best: PassResult | null = null
  let passes = 0

  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    const videoBitrate = Math.round(
      Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, (aim * 8) / duration - AUDIO_BITRATE)),
    )
    onPass?.(pass)
    const result = await encodePass(file, mimeType, videoBitrate, pass, targetBytes)
    passes = pass
    // A silent capture is final however small the file is — see encodePass.
    if (result.silentDespiteAudio) {
      throw new FriendlyError(
        'The ad’s audio could not be captured while compressing it, so the transcript would come back empty. Click anywhere on the page and retry the analysis.',
      )
    }

    const previousBest = best?.blob.size ?? Infinity
    if (result.blob.size < previousBest) best = result
    if (result.blob.size <= targetBytes) break

    console.log(
      `[ad-anatomy] pass ${pass} came back ${(result.blob.size / (1024 * 1024)).toFixed(1)}MB against a ${(aim / (1024 * 1024)).toFixed(1)}MB aim`,
    )
    // Nothing left to give: the bitrate is already on the floor, or the encoder
    // stopped responding to it. Another pass is the same wait for the same file.
    if (videoBitrate <= MIN_VIDEO_BITRATE) break
    if (result.blob.size > previousBest * (1 - MIN_PASS_IMPROVEMENT)) break

    // Re-aim from what the encoder ACTUALLY produced, against the size the
    // bitrate we actually asked for should have produced — NOT against `aim`,
    // which the MAX_VIDEO_BITRATE clamp can put well above it. Correcting the
    // uncapped number would hand the next pass the same capped bitrate and
    // spend a whole realtime run re-recording the identical file.
    const askedFor = ((videoBitrate + AUDIO_BITRATE) * duration) / 8
    aim = askedFor * ((targetBytes * RETRY_HEADROOM) / result.blob.size)
  }

  if (!best) {
    throw new FriendlyError('Compressing this ad produced nothing. Re-export it as a smaller file and try again.')
  }

  return {
    file: new File([best.blob], renameForContainer(file.name, best.mimeType), { type: best.mimeType }),
    originalBytes: file.size,
    compressedBytes: best.blob.size,
    passes,
  }
}
