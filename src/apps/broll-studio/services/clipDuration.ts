// How long a clip has to be to hold ONE line of the script.
//
// Every B-Roll clip renders exactly one script line — spoken to camera under
// "With Dialogue", covered by the voiceover under "B-Roll Clips" — so the
// length that fits is a property of the LINE, not a setting. It used to be a
// flat 5s on every card, which is the wrong answer in both directions: a
// twenty-word line crammed into 5s comes back with the character gabbling, and
// a five-word hook stretched over the same 5s comes back slow and dead. Both
// were reported, which is what this module exists for.
//
// Deliberately a word-count estimate rather than a number the storyboard model
// answers with. It's free, deterministic and debuggable, it costs no prompt
// surface and no parser, and it's the same ~2.4 words/sec pace Scripts already
// writes its word budgets against — so a script written for a beat and the clip
// rendered for that beat agree by construction. Continuous mode has estimated
// its scene lengths this way since it shipped; this is that estimator, shared.

import { getModel, snapVideoDurationUp } from '../../../utils/models'

// On-camera narration pace. Same assumption as Scripts' word budgets.
export const WORDS_PER_SECOND = 2.4

// A talking-head clip doesn't open on the first syllable and shouldn't cut on
// the last one — a beat of lead-in and a beat of tail. Without it every clip
// lands exactly as long as the words, which is the "talks super quickly" report
// again with an extra step.
export const LEAD_TAIL_SECONDS = 1

// Floor and ceiling, applied before the model's own grid gets a say. The floor
// keeps a three-word hook from rendering as a 2s flash; the ceiling is where a
// line is long enough that splitting it (the scene line editor) beats paying
// for a 20s clip nobody asked for.
export const MIN_CLIP_SECONDS = 4
export const MAX_CLIP_SECONDS = 15

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// Raw seconds this line needs, before any model's duration grid.
export function spokenClipSeconds(line: string, opts?: { min?: number }): number {
  const min = opts?.min ?? MIN_CLIP_SECONDS
  const raw = wordCount(line) / WORDS_PER_SECOND + LEAD_TAIL_SECONDS
  return Math.min(MAX_CLIP_SECONDS, Math.max(min, Math.ceil(raw)))
}

// The same estimate snapped onto what the picked model actually offers.
//
// Snapped UP, always: rounding down truncates the line, which is the failure
// this module exists to fix. (The app-wide `snapVideoDuration` rounds down on
// purpose — "short and cheap" is the right posture for a default nobody chose,
// and the wrong one for a length the words have to fit inside.) The snap caps
// at the model's longest option, so a model with a short ladder gives what it
// can rather than a duration kie would reject.
export function autoClipSeconds(
  line: string,
  modelId?: string | null,
  opts?: { min?: number },
): number {
  const durations = (modelId ? getModel(modelId)?.videoConstraints?.durations : undefined) ?? []
  const raw = spokenClipSeconds(line, opts)
  return durations.length > 0 ? snapVideoDurationUp(raw, durations) : raw
}

// What a Line-by-Line card will actually fire with: its own per-line estimate
// while the length is Auto, otherwise the length the member picked (snapped up
// onto this model's grid, since the pick may have been made against another
// model's ladder). The one place that decision lives — the card, the card
// modal's duration chip and the batch dialog's cost estimate all read it, so
// what's on screen and what gets billed can't drift.
export function cardClipSeconds(
  card: { cardVideoDurationSeconds: number; cardVideoDurationAuto?: boolean },
  scriptLine: string,
  modelId?: string | null,
): number {
  if (card.cardVideoDurationAuto !== false) return autoClipSeconds(scriptLine, modelId)
  const durations = (modelId ? getModel(modelId)?.videoConstraints?.durations : undefined) ?? []
  return durations.length > 0
    ? snapVideoDurationUp(card.cardVideoDurationSeconds, durations)
    : card.cardVideoDurationSeconds
}
