// Credit estimate for the two chat passes behind the Ad Analyzer's "Analyze Ad
// Creative" button. Like B-Roll's promptCost, these are chat completions billed
// per 1k tokens, so there's no exact number before the model answers — this is a
// deliberately rough, rounded-UP figure. It exists so the analysis never fires
// unpriced, not to be an invoice. Analysis IS the app's priciest call (it ships
// the whole video), so the estimate leans generous rather than optimistic.

import { estimateCredits } from '../../../utils/models'

// The analysis passes run on Gemini 3 Flash (see analyzeAd.ts CHAT_MODEL_ID).
const CHAT_MODEL_ID = 'gemini-3-flash'

// Per second of video: Gemini samples the inline clip at ~1 fps (each frame
// billed like an image, ~258 tokens) plus ~32 audio tokens/sec. Rounded to 300
// to stay on the safe side.
const VIDEO_TOKENS_PER_SEC = 300
// Keyframe stills captured at detected cuts — budget a generous handful.
const KEYFRAME_TOKENS = 3_200
// Both passes' system + user prompts, plus the shot-log JSON re-sent into the
// synthesis pass as input. Rounded up.
const OVERHEAD_TOKENS = 6_000
// Two JSON outputs (shot log + scorecard/breakdown/scenes) at high reasoning —
// thinking tokens bill as output, so budget generously.
const OUTPUT_TOKENS = 14_000
// Fallback when a clip's duration can't be read from its metadata.
const DEFAULT_DURATION_SEC = 30

// Estimated credits to analyse one ad of the given duration. Null only when the
// chat model has no pricing entry (never in practice).
export function estimateAnalysisCredits(durationSeconds: number): number | null {
  const secs =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.ceil(durationSeconds)
      : DEFAULT_DURATION_SEC
  const inputTokens = secs * VIDEO_TOKENS_PER_SEC + KEYFRAME_TOKENS + OVERHEAD_TOKENS
  return estimateCredits(CHAT_MODEL_ID, { tokenCount: inputTokens + OUTPUT_TOKENS })
}
