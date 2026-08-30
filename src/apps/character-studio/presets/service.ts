// Loading and faceting the starter presets, and saving one into the bank.

import type { StarterPreset } from './types'
import { createEmptyProfile } from '../types'
import { buildJsonPrompt } from '../services/generateCharacter'
import { uniqueBankName } from '../components/nameGenerator'
import { useBankStore } from '../../../stores/bankStore'
import { saveAsset } from '../../../utils/assetStore'

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
 * The full-size portrait behind that cover — the source's own 768x1376.
 *
 * Fetched only when a member saves the template, which is why the card gets a
 * separate, lighter cover: a grid of 81 faces shouldn't pay ~100KB each for
 * resolution it renders at a fifth of.
 */
export function starterPortraitUrl(id: string): string {
  return `${import.meta.env.BASE_URL}presets/full/${id}.webp`
}

/**
 * Copies a template into the Characters bank, portrait and all.
 *
 * The templates are static files, so nothing outside this picker can reach one
 * — which meant a member could fill the form from a face and still not use that
 * face as a reference anywhere. Saving is the app's own answer to "use this
 * character elsewhere": a bank row shows up in every `BankPicker`, so the
 * portrait becomes attachable in Playground, B-Roll and Scripts by the same
 * route a generated character is.
 *
 * The portrait is stored as a real asset (IndexedDB + the R2 mirror) rather
 * than kept as a URL, because that is what every consumer of `characterImage`
 * expects, and it's what makes the row survive on a browser that never opens
 * this picker again.
 */
export async function saveStarterToBank(row: StarterPreset): Promise<void> {
  const store = useBankStore.getState()
  if (store.models.some((m) => m.presetId === row.id)) return

  const res = await fetch(starterPortraitUrl(row.id))
  if (!res.ok) throw new Error(`Could not load that template's portrait (${res.status}).`)
  const blob = await res.blob()
  const imageRef = await saveAsset(blob, blob.type || 'image/webp')

  // The nested shape every other bank row carries — `flattenJsonProfile` in the
  // picker reads it back, and so does the Bank's own character form.
  const profile = createEmptyProfile()
  for (const [key, value] of Object.entries(row.profile)) {
    if (key in profile && typeof value === 'string') profile[key] = value
  }

  await store.addModel({
    // The descriptive export name ("Braided Blonde on the Sofa"), not the
    // card's "Handheld Mic Female 1": in a bank of characters a scene-and-index
    // label says nothing about which face it is.
    name: uniqueBankName(row.title, store.models.map((m) => m.name)),
    characterImage: imageRef,
    notes: '',
    source: 'character-studio',
    presetId: row.id,
    jsonProfile: buildJsonPrompt(profile) as Record<string, unknown>,
  })
}

/**
 * A bank row's nested `jsonProfile` flattened back to the form's own 29-key
 * map — the shape a starter already ships in, so the two can be faceted and
 * searched by the same code.
 */
export function flattenJsonProfile(json: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof json !== 'object' || json === null) return out
  for (const section of Object.values(json as Record<string, unknown>)) {
    if (typeof section === 'object' && section !== null) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        if (typeof value === 'string') out[key] = value
      }
    }
  }
  return out
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
