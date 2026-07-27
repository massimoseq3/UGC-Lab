// Audio plumbing shared by the History cards and the bottom player: the
// one-clip-at-a-time slot, asset-ref resolution, and the Web Audio rig the
// live waveform reads its levels from.
import { getUrl } from '../../../utils/assetStore'

// One voiceover plays at a time, app-wide — the History cards and the bottom
// player share this slot, so pressing play on a card pauses whoever held it
// (the video tiles get the same rule from `useInlineVideo`). Callers register a
// stable pause function; the slot only ever pauses, never seeks or unloads.
let holder: (() => void) | null = null

export function claimAudioSlot(pause: () => void) {
  if (holder && holder !== pause) holder()
  holder = pause
}

export function releaseAudioSlot(pause: () => void) {
  if (holder === pause) holder = null
}

export function formatClock(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export async function resolveAudioUrl(ref: string): Promise<string> {
  if (ref.startsWith('asset-')) {
    const url = await getUrl(ref)
    if (!url) throw new Error('Audio asset not found')
    return url
  }
  return ref
}

// --- Live levels -----------------------------------------------------------
// Routing an <audio> element through an AnalyserNode is what makes the card's
// waveform move with the voice. The catch: once an element feeds a graph, its
// sound comes out of that graph — so if the AudioContext is suspended the clip
// goes SILENT. Everything below is built around not letting that happen.

let ctx: AudioContext | null = null
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
const analysers = new WeakMap<HTMLMediaElement, AnalyserNode>()

function audioContext(): AudioContext | null {
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx ??= new Ctor()
  } catch {
    return null
  }
  return ctx
}

// Call this SYNCHRONOUSLY from the play click. A context created or resumed
// inside a user gesture starts running; one created later (after the await on
// the asset URL) can come up suspended — and a suspended context is exactly the
// case where attaching would mute the clip.
export function primeAudioContext() {
  const context = audioContext()
  if (context && context.state !== 'running') void context.resume()
}

// Returns null whenever the rig can't be built or the context isn't running —
// the waveform falls back to its idle drift and the audio keeps playing through
// the element untouched. Never trade the sound for a visual.
export function attachAnalyser(audio: HTMLMediaElement): AnalyserNode | null {
  const cached = analysers.get(audio)
  if (cached) return cached
  const context = audioContext()
  if (!context || context.state !== 'running') return null

  try {
    let source = sources.get(audio)
    if (!source) {
      // Once per element, ever — a second call on the same element throws.
      source = context.createMediaElementSource(audio)
      sources.set(audio, source)
      source.connect(context.destination)
    }
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.7
    source.connect(analyser)
    analysers.set(audio, analyser)
    return analyser
  } catch {
    return null
  }
}
