import { referenceImageCapacity } from '../../../utils/models'
import { isAssetRef, getAsBase64 } from '../../../utils/assetStore'
import type { ReferenceImage } from '../types'
import type { Product } from '../../../stores/types'

// The label every auto-attached product angle carries. The preamble builders
// count these to tell the model that several product photos are ONE object shot
// several ways — without that line an image model reads three photos of a
// protein bar as three different bars, or a multipack.
export const PRODUCT_ANGLE_LABEL = 'product-angle'

/**
 * The product half of every storyboard and per-card prompt — Line-by-Line,
 * Continuous, each keyframe brief, and the two per-variation rewrites all paste
 * this one string, so its labels are the single lever on how the product's
 * material is read.
 *
 * THE LABELS ARE THE LOAD-BEARING PART (August 2026). This was one flat
 * sentence — `USPs: … Benefits: … Key specs: …` — pasted into Line-by-Line's
 * user prompt with no framing at all, and that is the same bug Scripts had in
 * its own product block: unlabelled product material carries no job, and the
 * spec list is the most concrete thing in the prompt. But the failure it
 * produces here is a VISUAL one, because this app never writes the copy — the
 * script arrives already written and every <LINE> is copied verbatim. Hand a
 * model a spec and ask it for a picture and it draws the spec: the claim
 * printed on the wrapper, the nutrition panel held to the lens, the number
 * across the frame. So each field now says what it is FOR in a pipeline whose
 * output is a shot, and the attached PHOTO — never this text — is what a
 * prompt describes the product from (see rule 8's "the product reference image
 * is the source of truth").
 *
 * Empty bank fields are dropped rather than rendered as a labelled blank. Only
 * keySpecs was ever guarded, so a product saved without USPs shipped the model
 * a literal `USPs: .`
 */
export function buildProductContext(product: Product | null | undefined): string {
  if (!product) return ''
  const head = [product.productName, product.productDescription].map((v) => v?.trim()).filter(Boolean).join('. ')
  const lines: string[] = [
    'THE PRODUCT THIS AD IS FOR — material for deciding WHICH picture each line gets, never words to put inside one. The attached photo is what describes the product; nothing below is.',
  ]
  if (head) lines.push(`- Product: ${head}`)
  if (product.benefits?.trim()) {
    lines.push(`- Benefits (what the viewer GETS — the outcome, which is the one thing here a shot can show happening in a real life): ${product.benefits.trim()}`)
  }
  if (product.usps?.trim()) {
    lines.push(`- USPs (what makes it different — a shot shows the DIFFERENCE it makes to someone, never the feature that causes it): ${product.usps.trim()}`)
  }
  if (product.keySpecs?.trim()) {
    lines.push(`- Key facts & specs (background, and the weakest material here: a spec is a fact about the object, and a picture of a fact is a label. Use one only to work out which outcome is worth showing — never draw it, as a badge, a panel, a printed claim, or numbers anywhere in frame): ${product.keySpecs.trim()}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

/**
 * Every photo the bank holds for a product, hero first: [productImage, …extraImages].
 * This ordering IS the numbering the storyboard LLM sees and the <PHOTOS> field
 * refers to, so it must stay stable — photo 1 is always the hero packshot.
 */
export function productPhotosOf(product: Product | null | undefined): string[] {
  if (!product?.productImage) return []
  return [product.productImage, ...(product.extraImages ?? [])]
}

/**
 * Clean up a photo pick: drop out-of-range and duplicate indexes, keep the
 * LLM's (or the member's) ordering — the first survivor is the shot the scene
 * is actually built from. Falls back to the hero photo, which is the safe
 * default: one photo can only ever render one product.
 */
export function normalizePhotoSelection(selection: number[] | undefined, photoCount: number): number[] {
  if (photoCount <= 0) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const i of selection ?? []) {
    if (!Number.isInteger(i) || i < 0 || i >= photoCount || seen.has(i)) continue
    seen.add(i)
    out.push(i)
  }
  return out.length > 0 ? out : [0]
}

/**
 * Turn a photo pick into the refs a generation actually sends.
 *
 * The first picked photo becomes THE product reference — the shot the model
 * builds the object from — and any others ride behind it as angles. That's the
 * whole fix for "she eats the bar and two bars appear": the scene gets the
 * unwrapped shot as its product reference instead of the sealed wrapper plus
 * the unwrapped one, so there's only one product in the room.
 */
export function productRefsForSelection(
  photos: string[],
  selection: number[] | undefined,
): { product?: ReferenceImage; angles: ReferenceImage[] } {
  const picked = normalizePhotoSelection(selection, photos.length)
  if (picked.length === 0) return { angles: [] }
  return {
    product: { dataUrl: photos[picked[0]], label: 'product' },
    angles: picked.slice(1).map((i) => ({ dataUrl: photos[i], label: PRODUCT_ANGLE_LABEL })),
  }
}

/**
 * Resolve the product's photos to inline data URIs for a storyboard vision
 * call. Empty for a product with one photo — there's nothing to choose between,
 * and the images aren't worth the tokens.
 *
 * All-or-nothing on purpose: the prompt numbers the photos, so one that fails
 * to load would silently renumber every pick after it. Better to fall back to
 * the hero-only default than to send a menu that doesn't match the images.
 */
export async function productPhotoDataUris(photos: ReferenceImage[] | undefined): Promise<string[]> {
  if (!photos || photos.length < 2) return []
  const resolved = await Promise.all(photos.map(async ({ dataUrl }) => {
    if (!isAssetRef(dataUrl)) return dataUrl
    const asset = await getAsBase64(dataUrl).catch(() => null)
    return asset ? `data:${asset.mimeType};base64,${asset.base64}` : null
  }))
  return resolved.every((u): u is string => !!u) ? resolved : []
}

/**
 * The storyboard's photo-pick rules, appended to the system instruction (and so
 * to the Import-prompts brief) whenever the product has more than one photo.
 *
 * `unit` is what the caller's envelope calls a shot — "variation" in
 * Line-by-Line, "concept" in Continuous — so the two modes share one rule set
 * without one of them talking about the other's tags.
 */
export function productPhotoInstruction(photoCount: number, unit: 'variation' | 'concept'): string {
  return `

# PRODUCT PHOTOS — PICK THE ONE THE SHOT NEEDS

The advertised product is attached to this message as ${photoCount} photos, numbered in the order they appear. They are ONE object in different states, never several products: photo 1 is the hero packshot (packaging closed, branding readable) and the rest show what it can't — out of the wrapper, the box open, the back of the label, what's inside.

Look at them before writing. Then every ${unit} whose <REFS> include product must carry a <PHOTOS> field, right after <REFS>, naming which photo to attach:

<PHOTOS>2</PHOTOS>

- Name ONE photo: the one showing the product in the state that shot is actually in. Someone biting into it gets the unwrapped photo. Someone pulling it out of a drawer gets the sealed packshot. A shot that has to read the claims gets the photo with the label facing the lens.
- Name a second number ONLY when the shot genuinely shows two states at once (a hand holding the open box with one sachet lifted out of it). Every extra photo is another chance the model draws a SECOND product into the frame — a character eating the bar while an identical sealed bar sits beside it. That duplication is exactly what this field exists to prevent.
- Omit <PHOTOS> when <REFS> excludes the product.

So a product-carrying ${unit} looks like:

${unit === 'variation' ? `<VAR_2>
<TAG>PRODUCT</TAG>
<LABEL>FIRST BITE</LABEL>
<REFS>both</REFS>
<PHOTOS>2</PHOTOS>
<PROMPT>…</PROMPT>
</VAR_2>` : `<CONCEPT_2>
<LABEL>FIRST BITE</LABEL>
<SHOT>close-up</SHOT>
<REFS>both</REFS>
<PHOTOS>2</PHOTOS>
<PROMPT>…</PROMPT>
<MOTION>…</MOTION>
</CONCEPT_2>`}`
}

/**
 * Read the LLM's <PHOTOS> field. It counts from 1 (that's how the photos are
 * numbered in the prompt); everything downstream is 0-based. Range-clamping
 * happens later, against the product actually attached to the card, so an
 * out-of-date pick can't crash a render.
 */
export function parsePhotoPick(raw: string | null | undefined): number[] | undefined {
  const nums = raw?.match(/\d+/g)
  if (!nums) return undefined
  const picked = [...new Set(nums.map((n) => parseInt(n, 10) - 1))].filter((n) => n >= 0)
  return picked.length > 0 ? picked : undefined
}

export function countProductAngles(refs: ReferenceImage[]): number {
  return refs.filter((r) => r.label === PRODUCT_ANGLE_LABEL).length
}

/**
 * Append the product's extra angles to a generation's reference list, filling
 * whatever slots the model has left.
 *
 * The angles are the LOWEST-priority refs: never at the cost of a reference the
 * user chose. Everything in `manual` is passed through untouched; only the
 * angles are clamped, and only down to zero.
 */
export function attachProductAngles(opts: {
  manual: ReferenceImage[]
  angles: ReferenceImage[]
  // Which model the request will actually run on — the cap is per-model.
  modelId?: string
  // Slots claimed outside `manual` (the dialogue-chain / previous-keyframe
  // still, prepended at fire time).
  reserved?: number
}): ReferenceImage[] {
  const fits = productAngleSlots({
    manualCount: opts.manual.length,
    angleCount: opts.angles.length,
    modelId: opts.modelId,
    reserved: opts.reserved,
  })
  return fits === 0 ? opts.manual : [...opts.manual, ...opts.angles.slice(0, fits)]
}

/** How many angles fit — the count the reference UI reports. */
export function productAngleSlots(opts: {
  manualCount: number
  angleCount: number
  modelId?: string
  reserved?: number
}): number {
  const room = referenceImageCapacity(opts.modelId) - opts.manualCount - (opts.reserved ?? 0)
  return Math.max(0, Math.min(opts.angleCount, room))
}
