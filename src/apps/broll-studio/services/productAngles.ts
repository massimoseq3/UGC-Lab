import { referenceImageCapacity } from '../../../utils/models'
import type { ReferenceImage } from '../types'

// The label every auto-attached product angle carries. The preamble builders
// count these to tell the model that several product photos are ONE object shot
// several ways — without that line an image model reads three photos of a
// protein bar as three different bars, or a multipack.
export const PRODUCT_ANGLE_LABEL = 'product-angle'

export function productAngleRefsFrom(extraImages: string[] | undefined): ReferenceImage[] {
  return (extraImages ?? []).map((dataUrl) => ({ dataUrl, label: PRODUCT_ANGLE_LABEL }))
}

export function countProductAngles(refs: ReferenceImage[]): number {
  return refs.filter((r) => r.label === PRODUCT_ANGLE_LABEL).length
}

/**
 * Append the product's extra angles (the "More Angles" strip on the bank row)
 * to a generation's reference list, filling whatever slots the model has left.
 *
 * The angles are the LOWEST-priority refs: a scene that says "she bites the
 * bar" renders the bar still sealed in its wrapper unless the model has seen it
 * unwrapped, so attaching them is close to free value — but never at the cost
 * of a reference the user chose. Everything in `manual` is passed through
 * untouched; only the angles are clamped, and only down to zero.
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
