// "I don't have a script yet" — B-Roll writes one, then storyboards it.
//
// The whole point of this file is that it does NOT write a script. It hands the
// job to Scripts' own Write New pipeline (writeOneScript), so a script written
// here is byte-for-byte the kind of script the Scripts app would have written:
// the same human-voice rules, the same banned AI sentence shapes, the same hook
// library seeding the opening line, the same per-style instruction and length
// budget. If that pipeline improves, this improves with it — there is no second
// copy of the prompt to keep in step.
//
// What this file owns is the mapping: a B-Roll session's product row, style
// pick, length pick and notes → the input shape that pipeline expects.

import type { Product } from '../../../stores/types'
import { createEditableContext, isWriteStyle, type WriteLength } from '../../script-architect/types'
import type { AdFormat } from '../types'
import { writeOneScript } from '../../script-architect/services/generateScript'

export interface AutoScriptInput {
  // The bank row driving the ad. Optional: a member can write off the notes
  // alone, and the script pipeline handles an empty product context.
  product: Product | null
  // Which Script Style the ad is written in — a structure (the persuasion
  // mechanic) or a format (the kind of organic content it imitates).
  //
  // 'standard' is B-Roll's own "no format at all" pick: the write pipeline
  // falls back to its default shape and no scene staging is appended, so the
  // shots come out as plain organic UGC rather than staged as a podcast or a
  // street interview.
  style: AdFormat
  // Target read-aloud length in seconds. Drives the word budget, which is what
  // decides how many lines come back — and therefore how many scenes the
  // storyboard has.
  length: WriteLength
  // The panel's "Additional Instructions" box, doubling as the creative brief.
  // Blank is normal: the product row carries pain points, USPs, benefits,
  // objections, offer and CTA, which is what the script is actually written from.
  notes: string
}

export async function writeAutoScript(input: AutoScriptInput): Promise<string> {
  const context = input.product ? createEditableContext(input.product) : null
  const script = await writeOneScript({
    mode: 'write',
    // Unused by the write pipeline, but part of its input shape.
    winningTranscript: '',
    reversePrompt: '',
    // The notes ARE the brief. When they're empty the product context is the
    // whole brief, which is the common case — the member picked a product, a
    // style and a length and expects that to be enough.
    brief: input.notes.trim() || briefFromProduct(input.product),
    // Undefined lets runWrite use its own default shape (see 'standard' above).
    writeStyle: isWriteStyle(input.style) ? input.style : undefined,
    writeFormat: 'script',
    writeLength: input.length,
    productId: input.product?.id ?? null,
    productName: input.product?.productName,
    productContext: context,
    additionalContext: '',
  })
  return script.trim()
}

// A minimal stand-in brief when the member typed nothing. The write pipeline
// prints the brief verbatim under "The creator's brief for this ad", so handing
// it an empty string leaves a dangling heading; this states the obvious job and
// lets the product details below it do the work.
function briefFromProduct(product: Product | null): string {
  const name = product?.productName?.trim()
  return name
    ? `A short-form organic UGC ad for ${name}. Use the product details below to choose the angle.`
    : 'A short-form organic UGC ad. Use whatever product details are given below to choose the angle.'
}
