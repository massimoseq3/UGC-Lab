// Audio plumbing shared by every surface that plays a generated clip —
// Voiceovers' history cards and bottom player, Playground's music tiles: the
// one-clip-at-a-time slot, asset-ref resolution, and the peak decoder the
// waveform strip draws from. It lived in voice-studio until Playground's music
// history wanted the same player.
import { getUrl } from './assetStore'

// One clip plays at a time, app-wide — every audio surface shares this slot,
// so pressing play on a card pauses whoever held it
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

