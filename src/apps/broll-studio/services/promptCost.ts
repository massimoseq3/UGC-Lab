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
import { estimateCredits } from '../../../utils/models'
import { resolveScriptModel } from '../../../stores/settingsStore'
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

// With Dialogue sends the same base instruction plus the delivery override.
const DIALOGUE_ADDENDUM_TOKENS = 500

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
// button. Null when the picked chat model has no verified per-token rate —
// which is the case for every model past the Gemini pair, so the pill simply
// disappears rather than quoting a number we'd be making up. See the "NO CREDIT
// FIGURES" note in the registry.
export function estimatePromptCredits(
  mode: BrollMode,
  scriptText: string,
  // Line-by-Line only. Both deliveries write three prompts per scene, so it
  // only moves the input side (the dialogue override) — kept as an input
  // because the count comes from variationsForDelivery, which is where a
  // future change to the shape would land.
  delivery: BrollDelivery = 'silent',
): number | null {
  const chatModelId = resolveScriptModel('broll-studio')
  const scriptTokens = Math.ceil(scriptText.length / CHARS_PER_TOKEN)
  const scenes = sentenceCount(scriptText)
  const dialogueOverride = mode === 'line' && delivery === 'dialogue' ? DIALOGUE_ADDENDUM_TOKENS : 0
  const inputTokens = SYSTEM_TOKENS[mode] + dialogueOverride + scriptTokens

  // One call either way; what differs is the shape of what comes back.
  const outputTokens = mode === 'continuous'
    // N+1 frames × concepts, plus a motion block per scene.
    ? TOKENS_PER_STYLE_BLOCK +
      (scenes + 1) * CONCEPTS_PER_FRAME * TOKENS_PER_CONCEPT +
      scenes * TOKENS_PER_MOTION
    // Every scene gets this delivery's variation count.
    : scenes * variationsForDelivery(delivery) * TOKENS_PER_VARIATION

  return estimateCredits(chatModelId, { tokenCount: inputTokens + outputTokens })
}
