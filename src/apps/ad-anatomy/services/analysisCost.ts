// Credit estimate for the chat call behind the Ad Analyzer's "Analyze Ad
// Creative" button. Like B-Roll's promptCost, this is a chat completion billed
// per 1k tokens, so there's no exact number before the model answers — this is a
// deliberately rough, rounded-UP figure. It exists so the analysis never fires
// unpriced, not to be an invoice. Analysis IS the app's priciest call (it ships
// the whole video), so the estimate leans generous rather than optimistic.

import { estimateCredits, CHAT_MODEL_DEFAULT } from '../../../utils/models'

// The analysis runs on Gemini 3 Flash (see analyzeAd.ts CHAT_MODEL_ID).
const CHAT_MODEL_ID = CHAT_MODEL_DEFAULT

// Per second of video: Gemini samples the inline clip at ~1 fps (each frame
// billed like an image, ~258 tokens) plus ~32 audio tokens/sec. Rounded to 300
// to stay on the safe side.
const VIDEO_TOKENS_PER_SEC = 300
// The system + user prompts. Rounded up.
const OVERHEAD_TOKENS = 3_000
// One JSON output — scorecard, breakdown, transcript and every scene prompt.
const OUTPUT_TOKENS = 8_000
// Fallback when a clip's duration can't be read from its metadata.
const DEFAULT_DURATION_SEC = 30

// Estimated credits to analyse one ad of the given duration. Null only when the
// chat model has no pricing entry (never in practice).
export function estimateAnalysisCredits(durationSeconds: number): number | null {
  const secs =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.ceil(durationSeconds)
      : DEFAULT_DURATION_SEC
  const inputTokens = secs * VIDEO_TOKENS_PER_SEC + OVERHEAD_TOKENS
  return estimateCredits(CHAT_MODEL_ID, { tokenCount: inputTokens + OUTPUT_TOKENS })
}
