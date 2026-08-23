// Loading and faceting the starter presets.

import type { StarterPreset } from './types'

/** A starter with its search haystack folded in — see `loadStarterPresets`. */
export type StarterRow = StarterPreset & { search: string }

// One fetch per page load, shared by every mount. ~235KB of JSON that never
// changes between deploys, so the browser's own HTTP cache does the rest, and
// nothing pays for it until the picker is first opened.
let cache: Promise<StarterRow[]> | null = null

export function loadStarterPresets(): Promise<StarterRow[]> {
  if (!cache) {
    cache = fetchPresets().catch((e) => {
      // A failed load must not poison the cache — the empty state offers a
      // retry, and a rejected promise held here would fail it forever.
      cache = null
      throw e
    })
  }
  return cache
}

async function fetchPresets(): Promise<StarterRow[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}presets/library.json`)
  if (!res.ok) throw new Error(`Could not load the starter presets (${res.status}).`)
  const rows = await res.json() as StarterPreset[]
  if (!Array.isArray(rows)) throw new Error('The starter preset library is malformed.')
  return rows.map((r) => ({ ...r, search: buildSearch([r.name, r.title, r.setting, r.note], r.profile) }))
}

/** Where a starter's cover lives. Ships with the app — no signed url, no expiry. */
export function starterThumbUrl(id: string): string {
  return `${import.meta.env.BASE_URL}presets/thumbs/${id}.webp`
}

/**
 * The haystack a card is searched on: its labels plus every word of its DNA, so
 * "freckles", "gold hoops" and "wood slat wall" all find the character they
 * describe — and so does "braided blonde", the descriptive title the card
 * itself stopped showing. Built once per row rather than per keystroke.
 */
export function buildSearch(labels: Array<string | undefined>, profile: Record<string, string>): string {
  return [...labels, ...Object.values(profile)].filter(Boolean).join(' ').toLowerCase()
}

// Scene keywords for a BANK row, whose scene has to be read out of its own
// free-text location + background. The starters carry a curated `setting` and
// never come through here. A row nothing matches gets no scene, so it drops
// out once a scene is picked — which is the same thing that would happen with
// no derivation at all, only less often.
const SETTING_PATTERNS: Array<[RegExp, string]> = [
  [/\bcars?\b|vehicle|driver'?s? seat|passenger seat|jeep|truck cab/i, 'Car'],
  [/kitchen/i, 'Kitchen'],
  [/bathroom|vanity mirror/i, 'Bathroom GRWM'],
  [/bedroom/i, 'Bedroom'],
  [/gym|weights|treadmill|fitness/i, 'Gym'],
  [/podcast/i, 'Podcast Studio'],
  [/office|\bdesk\b|study|co-?working/i, 'Desk & Office'],
  [/outdoor|street|park\b|beach|garden|patio|balcony|rooftop|clifftop|woodland/i, 'Outdoors'],
]

export function settingFromProfile(profile: Record<string, string>): string | undefined {
  const text = `${profile.location ?? ''} ${profile.background ?? ''}`
  return SETTING_PATTERNS.find(([re]) => re.test(text))?.[1]
}

/**
 * Normalises a profile's free-text gender onto the facet.
 *
 * The starters say "Female" / "Male", but a character extracted from a photo
 * can say "Non-binary" or "Woman", and a facet built from raw values would
 * list both spellings of the same thing. A gender this can't place gets none,
 * so it shows under All and under neither segment — which is honest, where
 * guessing would not be.
 */
export function genderBucket(gender: string): string | undefined {
  const g = gender.toLowerCase()
  if (!g) return undefined
  if (g.startsWith('female') || g.startsWith('woman') || g.startsWith('girl')) return 'Female'
  if (g.startsWith('male') || g.startsWith('man') || g.startsWith('boy')) return 'Male'
  return undefined
}
