import { getVoiceById } from '../types'

// Deterministic avatar fill for a voice — keeps a voice's disc stable across
// mounts and identical everywhere it appears (the two pickers, the settings
// row, History's cards, the details view, the player's play button).
//
// Lives in its own module (not VoicePickerView) so that component file only
// exports components — keeps React Fast Refresh working, and lets the other
// voice views share the palette without importing the picker.
//
// It was a rainbow: two hues picked out of ten spanning the whole wheel, so a
// list of thirty voices was thirty saturated discs in every colour at once —
// the loudest thing in a panel of grey chrome, and nothing like the rest of
// the app. September 2026 (Massimo's call) it became METAL: monochrome,
// bronze, gold and silver, which reads as premium and, more usefully, as ONE
// set of objects.
//
// The metal is picked by GENDER, and that is the whole reason the split
// exists: the picker groups and filters by Female / Male, so the disc has to
// agree with the heading above it or the two say different things about the
// same voice. Women get the WARM metals (rose gold, copper, champagne),
// men the COOL ones (silver, steel, graphite, onyx). Both are the same
// material family at the same weight — this is a warm/cool split, never a
// pink/blue one, which would drop a stock gender cliché into an app that has
// none anywhere else. Anything with no gender on file falls to the cool set.
//
// Within a gender the metal is seeded off the id, so a voice keeps its own
// disc and is still recognisable at a glance — the point of seeding it.

type Ramp = readonly [string, string, string]

// Three stops of one material, light → mid → shadow. The lightest stop is
// deliberately no paler than ~#DDE2E8: these discs sit on a white card in
// light mode, and a near-white one disappears into it.
const WARM: readonly Ramp[] = [
  ['#F0CBBE', '#C98D77', '#8E5A46'], // rose gold
  ['#E5A98A', '#B67150', '#77432B'], // copper
  ['#EEDFC6', '#C9B189', '#8D7752'], // champagne
  ['#EFCE8A', '#C9A24E', '#8C6A24'], // antique gold
  ['#E7BCA8', '#BD8468', '#7C513C'], // blush bronze
]

const COOL: readonly Ramp[] = [
  ['#DDE2E8', '#A8B0BA', '#6E7681'], // silver
  ['#C6CED8', '#8B96A3', '#59626E'], // steel
  ['#B4BCC6', '#79838F', '#474F59'], // gunmetal
  ['#A2A9B1', '#666D75', '#3A3F45'], // graphite
  ['#82868D', '#4A4E55', '#26292E'], // onyx
]

// Two ramp angles per metal, so fifteen voices in one gender land on more
// than five looks without leaving the family. Nothing here is random — same
// id, same disc.
const ANGLES = [135, 160] as const

export function seedColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  const metals = getVoiceById(id)?.gender === 'Female' ? WARM : COOL
  const [light, mid, shade] = metals[Math.abs(hash) % metals.length]
  const angle = ANGLES[Math.abs(hash >> 5) % ANGLES.length]
  // A diffuse bloom off the top-left over the ramp — the same thing
  // `.glass-fill` does, and what separates polished metal from a flat two-stop
  // wash. Deliberately broad and soft rather than a tight specular dot: a hot
  // glint reads as plastic gloss.
  return (
    `radial-gradient(circle at 30% 22%, rgba(255,255,255,0.5), rgba(255,255,255,0) 58%), ` +
    `linear-gradient(${angle}deg, ${light}, ${mid} 52%, ${shade})`
  )
}
