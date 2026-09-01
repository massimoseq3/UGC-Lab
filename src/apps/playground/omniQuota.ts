import type { PromptRef } from './components/PromptPanel'

// Gemini Omni's inputs all draw on ONE budget, whatever kind they are:
//   images ×1  +  characters ×1  +  source clip ×2  ≤ 7
// Frames count as images against it — on Omni 1.0 they literally ARE images
// (folded into `image_urls`), and on Flash 1.1, which has real frame fields,
// they still spend a slot.
//
// Three surfaces read this sum — the References card header prints it, the
// reference strip sizes its cap from it, and OmniInputsSection refuses an
// attachment past it. It lives in a module of its own so those three can't
// drift apart; two of them had already written the arithmetic out by hand.
export const OMNI_SLOT_QUOTA = 7

export function omniQuotaUsed(refs: PromptRef[]): number {
  const images = refs.filter((r) => r.slot === 'ref' || r.slot === 'start' || r.slot === 'end').length
  const characters = refs.filter((r) => r.slot === 'omni-character').length
  const clip = refs.some((r) => r.slot === 'omni-clip') ? 2 : 0
  return images + characters + clip
}

// The cap for the reference-image strip: the quota less everything in it that
// ISN'T a strip image, so attaching a character or a clip narrows the strip.
export function omniImageCapacity(refs: PromptRef[]): number {
  const stripImages = refs.filter((r) => r.slot === 'ref').length
  return Math.max(0, OMNI_SLOT_QUOTA - omniQuotaUsed(refs) + stripImages)
}
