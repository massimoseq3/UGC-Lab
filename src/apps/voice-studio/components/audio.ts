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

// --- Waveform peaks --------------------------------------------------------
// The card's waveform is the WHOLE clip, decoded once and drawn at rest, with
// playback filling it left to right. Nothing here touches the playing element:
// the old live-spectrum version routed it through an AnalyserNode, and an
// element feeding a Web Audio graph plays SILENTLY whenever that context is
// suspended. Decoding is read-only, so the whole hazard is gone with it.

export const WAVEFORM_BARS = 56

// Decoding the same clip on every replay is wasted work — one entry per asset
// ref, plus the in-flight promise so two cards can't decode it twice.
const peakCache = new Map<string, number[]>()
const decoding = new Map<string, Promise<number[] | null>>()

function decodeContext(): BaseAudioContext | null {
  const Offline: typeof OfflineAudioContext | undefined =
    window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  try {
    // Offline, not a live AudioContext: decoding needs no output device, and a
    // live context opened outside a user gesture only comes up suspended.
    if (Offline) return new Offline(1, 1, 44100)
  } catch { /* fall through to a live context */ }
  const Live: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  try {
    return Live ? new Live() : null
  } catch {
    return null
  }
}

// Peak amplitude per bar, normalised so the loudest bar is full height — a
// quiet recording still fills the strip, and a loud one can't sit clipped flat.
function peaksFrom(buffer: AudioBuffer, bars: number): number[] {
  const data = buffer.getChannelData(0)
  const per = Math.floor(data.length / bars) || 1
  const out = new Array<number>(bars).fill(0)
  let loudest = 0
  for (let i = 0; i < bars; i++) {
    const start = i * per
    let peak = 0
    // Every 4th sample: a peak that survives thinning by 4 is still a peak, and
    // it keeps a long clip from holding the main thread for a visible beat.
    for (let j = start; j < start + per && j < data.length; j += 4) {
      const v = Math.abs(data[j])
      if (v > peak) peak = v
    }
    out[i] = peak
    if (peak > loudest) loudest = peak
  }
  if (loudest <= 0) return out.fill(0)
  // Square-root curve: raw amplitude leaves everything but the loudest syllable
  // near the floor, which reads as a flat line with a couple of spikes.
  return out.map((v) => Math.min(1, Math.sqrt(v / loudest)))
}

// Returns null when the clip can't be decoded (unsupported codec, missing
// asset) — the strip then just sits at rest. It's never worth an error.
export async function waveformPeaks(ref: string, bars = WAVEFORM_BARS): Promise<number[] | null> {
  const cached = peakCache.get(ref)
  if (cached) return cached
  const running = decoding.get(ref)
  if (running) return running

  const job = (async () => {
    try {
      const url = await resolveAudioUrl(ref)
      const bytes = await (await fetch(url)).arrayBuffer()
      const context = decodeContext()
      if (!context) return null
      const peaks = peaksFrom(await context.decodeAudioData(bytes), bars)
      peakCache.set(ref, peaks)
      return peaks
    } catch (err) {
      console.warn('[voice] waveform decode failed', err)
      return null
    } finally {
      decoding.delete(ref)
    }
  })()

  decoding.set(ref, job)
  return job
}
