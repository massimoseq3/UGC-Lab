// Auto-generates a plausible first name when saving an influencer to the bank,
// so the inline save flow can prefill a real-sounding name the user can edit.
// Pool is keyed off the profile's gender; falls back to a unisex pool.

const FEMALE_NAMES = [
  'Ava', 'Olivia', 'Mia', 'Sophia', 'Isabella', 'Emma', 'Amelia', 'Harper',
  'Evelyn', 'Charlotte', 'Lily', 'Chloe', 'Zoe', 'Ella', 'Maya', 'Aria',
  'Nora', 'Luna', 'Hazel', 'Ivy', 'Stella', 'Aurora', 'Violet', 'Penelope',
  'Ruby', 'Sadie', 'Camila', 'Layla', 'Naomi', 'Sienna', 'Willow', 'Riley',
  'Quinn', 'Eloise', 'Iris', 'Juniper', 'Maeve', 'Nova', 'Sage', 'Wren',
]
const MALE_NAMES = [
  'Liam', 'Noah', 'Oliver', 'Elijah', 'Lucas', 'Mason', 'Logan', 'Ethan',
  'James', 'Aiden', 'Jack', 'Levi', 'Benjamin', 'Henry', 'Sebastian', 'Owen',
  'Daniel', 'Caleb', 'Wyatt', 'Julian', 'Leo', 'Hudson', 'Theo', 'Nathan',
  'Isaac', 'Asher', 'Eli', 'Carter', 'Miles', 'Felix', 'Silas', 'Atlas',
  'Kai', 'Jude', 'Ezra', 'August', 'Beckett', 'Rowan', 'Finn', 'Arlo',
]
const UNISEX_NAMES = [
  'Riley', 'Quinn', 'Avery', 'Rowan', 'Sage', 'River', 'Sky', 'Reese',
  'Phoenix', 'Wren', 'Blake', 'Cameron', 'Drew', 'Ellis', 'Finley', 'Hayden',
  'Jordan', 'Kai', 'Lennon', 'Morgan', 'Nico', 'Parker', 'Remy', 'Sasha',
  'Tatum', 'Wesley', 'Charlie', 'Emerson', 'Frankie', 'Indigo',
]

// Deterministic string hash — lets a lineage that isn't saved to the bank yet
// get the SAME suggested name everywhere it's offered (the edit modal and the
// main gallery), so its variants still read as one character.
function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export function pickInfluencerName(gender?: string, seed?: string): string {
  const g = (gender || '').toLowerCase()
  const pool =
    g.startsWith('f') || g.includes('woman') ? FEMALE_NAMES :
    g.startsWith('m') && !g.startsWith('mx') ? MALE_NAMES :
    UNISEX_NAMES
  const i = seed ? hashSeed(seed) % pool.length : Math.floor(Math.random() * pool.length)
  return pool[i]
}

// Strips the suffixes this file adds, so they can never stack: a sheet of a
// sheet stays one "- Character Sheet", and a variant of "Mia 2" is numbered off
// "Mia", not "Mia 2 2". The legacy "Influencer Sheet" wording is stripped too so
// re-sheeting an older entry is clean.
function stripVariantSuffix(name: string): string {
  return name
    .replace(/\s*-\s*(Character|Influencer) Sheet\s*$/i, '')
    .replace(/\s+\d+$/, '')
    .trim()
}

// A character sheet files next to its source portrait — same character name
// with a " - Character Sheet" suffix.
export function sheetNameFrom(baseName: string): string {
  return `${stripVariantSuffix(baseName)} - Character Sheet`
}

// Numbers a name until it's free in the bank ("Mia" → "Mia 2" → "Mia 3"), so
// two variants of the same character can't be offered the same name.
export function uniqueBankName(desired: string, taken: Iterable<string>): string {
  const used = new Set<string>()
  for (const n of taken) used.add(n.trim().toLowerCase())
  if (!used.has(desired.trim().toLowerCase())) return desired
  for (let n = 2; n < 1000; n++) {
    const candidate = `${desired} ${n}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return desired
}

// An edited character files next to the character it was generated FROM: the
// source's name plus whatever makes this one different — the visual style it was
// restyled into ("Mia - Claymation"), else the next free number ("Mia 2").
// Before this, every edit was offered a fresh random name, so one character's
// variants scattered across the bank under unrelated names.
export function variantNameFrom(
  sourceName: string,
  styleLabel: string | undefined,
  taken: Iterable<string>,
): string {
  const base = stripVariantSuffix(sourceName)
  return uniqueBankName(styleLabel ? `${base} - ${styleLabel}` : base, taken)
}
