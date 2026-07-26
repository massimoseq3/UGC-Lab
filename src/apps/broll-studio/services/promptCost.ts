// Credit estimate for the "write me prompts" LLM call behind B-Roll's Generate
// button (Line-by-Line, Continuous).
//
// These are chat completions, billed per 1k tokens rather than per call, so
// there is no exact number to show before the model answers. The estimate below
// is deliberately rough and rounded UP: it exists so the button never fires an
// unpriced call, not to be an invoice. Both land under a credit or two —
// which is the honest, useful signal (prompt writing is cheap; the image and
// video generations that follow are where the credits actually go).

import type { BrollDelivery, BrollMode } from '../types'
import { estimateCredits, getDefaultModel } from '../../../utils/models'
import { variationsForDelivery } from './generateBroll'
import { CONCEPTS_PER_FRAME } from './generateContinuous'

// Rough chars-per-token for English prose.
const CHARS_PER_TOKEN = 4

// Measured input overhead of each mode's system prompt, in tokens, rounded up
// to the nearest 500. Re-measure if a system prompt changes materially — being
// out by a few hundred tokens moves the estimate by hundredths of a credit.
const SYSTEM_TOKENS: Record<BrollMode, number> = {
  line: 5000,
  continuous: 4000,
}

// Typical output size of one unit of work, in tokens.
const TOKENS_PER_VARIATION = 130   // one b-roll prompt paragraph
const TOKENS_PER_CONCEPT = 150     // one keyframe prompt paragraph
const TOKENS_PER_MOTION = 90       // one motion prompt paragraph
const TOKENS_PER_STYLE_BLOCK = 200

// Sentence count is how every mode segments a script, so it drives both
// output estimates. Floors at 1 so an unpunctuated script still costs something.
function sentenceCount(scriptText: string): number {
  const sentences = scriptText.trim().split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
  return Math.max(1, sentences.length)
}

// Estimated credits for the prompt-writing call(s) behind a mode's Generate
// button. Null when the chat model has no pricing entry (never in practice).
export function estimatePromptCredits(
  mode: BrollMode,
  scriptText: string,
  // Line-by-Line only. Both deliveries write three prompts per scene, so this
  // costs the same either way — kept as an input because the count comes from
  // variationsForDelivery, which is where a future change would land.
  delivery: BrollDelivery = 'silent',
): number | null {
  const chatModelId = getDefaultModel('broll-studio', 'chat')?.id
  if (!chatModelId) return null
  const scriptTokens = Math.ceil(scriptText.length / CHARS_PER_TOKEN)
  const scenes = sentenceCount(scriptText)

  let inputTokens: number
  let outputTokens: number

  switch (mode) {
    case 'line':
      // One call: every scene gets this delivery's variation count.
      inputTokens = SYSTEM_TOKENS.line + scriptTokens
      outputTokens = scenes * variationsForDelivery(delivery) * TOKENS_PER_VARIATION
      break
    case 'continuous':
      // One call: N+1 frames × concepts, plus a motion block per scene.
      inputTokens = SYSTEM_TOKENS.continuous + scriptTokens
      outputTokens =
        TOKENS_PER_STYLE_BLOCK +
        (scenes + 1) * CONCEPTS_PER_FRAME * TOKENS_PER_CONCEPT +
        scenes * TOKENS_PER_MOTION
      break
  }

  return estimateCredits(chatModelId, { tokenCount: inputTokens + outputTokens })
}
