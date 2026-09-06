// The app's metal palette — monochrome, bronze, gold and silver.
//
// It started as Voiceovers' avatar fill (`voice-studio/components/seedColor.ts`),
// where a rainbow of thirty saturated discs was replaced by metal in September
// 2026 (Massimo's call) because metal reads as premium and, more usefully, as
// ONE set of objects. It moved here when Scripts' history badges wanted the
// same material: two surfaces painting their own "premium monochrome" is how
// two palettes drift into three.
//
// The ramps are three stops of one material, light → mid → shadow. The
// lightest stop is deliberately no paler than ~#DDE2E8: these sit on a white
// card in light mode, and a near-white one disappears into it.

export type MetalRamp = readonly [light: string, mid: string, shade: string]

// Warm metals. In Voiceovers these are the female voices — see that file for
// why the split is warm/cool rather than a stock pink/blue.
export const WARM_METALS: readonly MetalRamp[] = [
  ['#F0CBBE', '#C98D77', '#8E5A46'], // rose gold
  ['#E5A98A', '#B67150', '#77432B'], // copper
  ['#EEDFC6', '#C9B189', '#8D7752'], // champagne
  ['#EFCE8A', '#C9A24E', '#8C6A24'], // antique gold
  ['#E7BCA8', '#BD8468', '#7C513C'], // blush bronze
]

// Cool metals.
export const COOL_METALS: readonly MetalRamp[] = [
  ['#DDE2E8', '#A8B0BA', '#6E7681'], // silver
  ['#C6CED8', '#8B96A3', '#59626E'], // steel
  ['#B4BCC6', '#79838F', '#474F59'], // gunmetal
  ['#A2A9B1', '#666D75', '#3A3F45'], // graphite
  ['#82868D', '#4A4E55', '#26292E'], // onyx
]

// A diffuse bloom off the top-left over the ramp — the same thing
// `.glass-fill` does, and what separates polished metal from a flat two-stop
// wash. Deliberately broad and soft rather than a tight specular dot: a hot
// glint reads as plastic gloss.
const BLOOM = 'radial-gradient(circle at 30% 22%, rgba(255,255,255,0.5), rgba(255,255,255,0) 58%)'

// The full three-stop fill, for a shape big enough to carry the falloff —
// Voiceovers' 40px discs.
export function metalFill([light, mid, shade]: MetalRamp, angle: number): string {
  return `${BLOOM}, linear-gradient(${angle}deg, ${light}, ${mid} 52%, ${shade})`
}

// The same material as a small PLATE — a badge, a chip — and it stops at the
// ramp's mid stop on purpose. A 9.5px label runs the width of the pill, so a
// fill that ran down to the shadow stop would put dark text on a dark end;
// light → mid keeps one readable ground under the whole word.
export function metalPlate([light, mid]: MetalRamp, angle = 160): string {
  return `${BLOOM}, linear-gradient(${angle}deg, ${light}, ${mid})`
}

// The label on a plate. Metal is the same colour in both themes, so its text
// is a literal too — this is engraving, not chrome that flips.
export const METAL_PLATE_INK = '#1F2328'

// The rim a plate wears, so it reads as a piece of metal rather than a
// coloured pill. Both inset rims are LIT, top brighter than bottom, the rule
// `.glass-fill` states for its squircles: light entering the top of a solid
// object exits along its far edge, so a dark bottom rim reads as a printed
// sticker. The outer shadow is what lifts it off the row.
export const METAL_PLATE_RIM =
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.5),inset_0_-1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(0,0,0,0.22)]'
