import { getVoiceById } from '../types'
import { WARM_METALS, COOL_METALS, metalFill } from '../../../utils/metal'

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
// set of objects. The ramps themselves now live in `utils/metal.ts`, since
// Scripts' history badges are cut from the same material.
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

// Two ramp angles per metal, so fifteen voices in one gender land on more
// than five looks without leaving the family. Nothing here is random — same
// id, same disc.
const ANGLES = [135, 160] as const

export function seedColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  const metals = getVoiceById(id)?.gender === 'Female' ? WARM_METALS : COOL_METALS
  const ramp = metals[Math.abs(hash) % metals.length]
  const angle = ANGLES[Math.abs(hash >> 5) % ANGLES.length]
  return metalFill(ramp, angle)
}

// The rim every play disc wears over that fill, so the button reads as a piece
// of metal rather than a coloured circle with a triangle stamped on it
// (September 2026, Massimo's call — it "felt tacky").
//
// Both inset rims are LIT, top brighter than bottom, which is the same rule
// `.glass-fill` states for its squircles: light entering the top of a solid
// object exits along its far edge, so a dark bottom rim reads as a printed
// sticker. The outer shadow is what lifts it off the card. The glyph shrank
// with it — a 16px triangle on a 40px disc is the stock-media-player look, and
// what says "press me" here is the disc, not the size of the mark on it.
//
// No `hover:scale-*`: a button that jumps under the pointer is the other half
// of what read as cheap. `hover:brightness-110` lifts the metal instead, and
// unlike a tint token it means the same thing in both themes.
export const PLAY_DISC_RIM =
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-1px_0_rgba(255,255,255,0.14),0_1px_3px_rgba(0,0,0,0.28)]'
