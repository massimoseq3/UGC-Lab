// How long a clip has to be to hold ONE SPOKEN line of the script.
//
// A card whose character SPEAKS its line to camera is as long as the words take
// to say. It used to be a flat 5s, which is the wrong answer in both
// directions: a twenty-word line crammed into 5s comes back with the character
// gabbling, and a five-word hook stretched over the same 5s comes back slow and
// dead. Both were reported, which is what this module exists for.
//
// **Auto is a WITH DIALOGUE thing, and only that.** It shipped applying to
// every card in both deliveries and was pulled back to the dialogue cards in
// August 2026. A silent B-Roll Clips card has no words in it — it's cutaway
// footage that a voiceover is laid over in the edit — so nothing about its
// length follows from the line it was written for, and deriving one from a
// word count is a number invented for a clip that isn't saying them. Those
// cards keep the flat default they always had (`speaksItsLine` is the one test,
// and it's the same `tag === 'DIALOGUE'` predicate the voice profile and the
// anchor chain already go by).
//
// Deliberately a word-count estimate rather than a number the storyboard model
// answers with. It's free, deterministic and debuggable, it costs no prompt
// surface and no parser, and it's the same ~2.4 words/sec pace Scripts already
// writes its word budgets against — so a script written for a beat and the clip
// rendered for that beat agree by construction. Continuous mode has estimated
// its scene lengths this way since it shipped; this is that estimator, shared.

import { getModel, snapVideoDuration, snapVideoDurationNearest, snapVideoDurationUp } from '../../../utils/models'
import type { VariationTag } from '../types'

// On-camera narration pace. Same assumption as Scripts' word budgets.
export const WORDS_PER_SECOND = 2.4

// A talking-head clip doesn't open on the first syllable and shouldn't cut on
// the last one — a beat of lead-in and a beat of tail. Without it every clip
// lands exactly as long as the words, which is the "talks super quickly" report
// again with an extra step.
//
// Half a second, not the full one it shipped with (August 2026). The estimate
// was reported as landing 1–2s long on every card, and this was one of THREE
// stacked round-ups paying for that: a full second of padding, a `Math.ceil` on
// top of it, and then a snap UP onto the model's ladder. Two of the three are
// gone — this is now a half-beat, the ceil only survives where there's no ladder
// to snap to, and the snap is to the NEAREST rung. Together those take 1–2s off
// a typical line, which is what was asked for.
export const LEAD_TAIL_SECONDS = 0.5

// Floor and ceiling, applied before the model's own grid gets a say. The floor
// keeps a three-word hook from rendering as a 2s flash; the ceiling is where a
// line is long enough that splitting it (the scene line editor) beats paying
// for a 20s clip nobody asked for.
export const MIN_CLIP_SECONDS = 4
export const MAX_CLIP_SECONDS = 15

// What a clip that holds no spoken words runs at unless the member picks
// otherwise — the app-wide default every B-Roll card used before Auto existed,
// and the one B-Roll Clips cards went back to.
export const DEFAULT_CLIP_SECONDS = 5

// Does this card's character speak the scene's line on camera? The one test for
// whether Auto is on the table at all: under With Dialogue every variation is a
// DIALOGUE card, under B-Roll Clips none is, and a hand-added option is a silent
// b-roll card everywhere else in the app (no voice profile, no anchor chain), so
// it is one here too.
export function speaksItsLine(variation: { tag: VariationTag }): boolean {
  return variation.tag === 'DIALOGUE'
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// Raw seconds this line needs, before any model's duration grid. Deliberately
// NOT rounded — the caller either snaps it onto a ladder (which is a rounding of
// its own) or ceils it once. Rounding here as well was a second round-up nobody
// could see, and it stacked with the snap.
export function spokenClipSeconds(line: string, opts?: { min?: number }): number {
  const min = opts?.min ?? MIN_CLIP_SECONDS
  const raw = wordCount(line) / WORDS_PER_SECOND + LEAD_TAIL_SECONDS
  return Math.min(MAX_CLIP_SECONDS, Math.max(min, raw))
}

// The same estimate snapped onto what the picked model actually offers.
//
// Snapped to the NEAREST rung (August 2026). It shipped snapping UP on the
// reasoning that rounding down truncates the line — but a duration ladder is
// coarse (…5, 6, 8, 10, 12…), so an estimate that overshoots a rung by a third
// of a second bought a whole extra rung, and the result was reported as running
// 1–2s long on card after card. It isn't a truncation to protect against
// anyway: the video model FITS the speech to the clip it's given, so a rung
// short reads as a slightly brisker delivery (the UGC register) while a rung
// long is dead air at the end of every cut. Ties go up, and the snap caps at
// the model's longest option, so a model with a short ladder gives what it can
// rather than a duration kie would reject.
//
// With no ladder at all there's nothing to snap to, so the raw estimate is
// ceiled — a length is whole seconds by the time anything bills it.
export function autoClipSeconds(
  line: string,
  modelId?: string | null,
  opts?: { min?: number },
): number {
  const durations = (modelId ? getModel(modelId)?.videoConstraints?.durations : undefined) ?? []
  const raw = spokenClipSeconds(line, opts)
  return durations.length > 0 ? snapVideoDurationNearest(raw, durations) : Math.ceil(raw)
}

// What a SILENT card fires at: the member's pinned number, or the flat default
// when nothing was ever picked. Snapped DOWN — the app-wide posture for a length
// no words have to fit inside.
//
// The `cardVideoDurationAuto` read is what un-does the day this applied to every
// card: a silent card whose flag still says Auto is holding a number the
// estimator derived, not one anybody chose, so it goes back to the default
// rather than surviving as a pin.
export function silentClipSeconds(
  card: { cardVideoDurationSeconds: number; cardVideoDurationAuto?: boolean },
  modelId?: string | null,
): number {
  const durations = (modelId ? getModel(modelId)?.videoConstraints?.durations : undefined) ?? []
  const seconds = card.cardVideoDurationAuto === false
    ? card.cardVideoDurationSeconds
    : DEFAULT_CLIP_SECONDS
  return durations.length > 0 ? snapVideoDuration(seconds, durations) : seconds
}

// What a Line-by-Line card will actually fire with: its own per-line estimate
// while the length is Auto, otherwise the length the member picked (snapped up
// onto this model's grid, since the pick may have been made against another
// model's ladder). The one place that decision lives — the card, the card
// modal's duration chip and the batch dialog's cost estimate all read it, so
// what's on screen and what gets billed can't drift.
//
// `spoken` is deliberately required rather than defaulted: it's the whole gate
// on Auto (see the note at the top of this file), and a call site that forgot it
// would quietly put Auto back on the silent cards.
export function cardClipSeconds(
  card: { cardVideoDurationSeconds: number; cardVideoDurationAuto?: boolean },
  scriptLine: string,
  modelId: string | null | undefined,
  opts: { spoken: boolean },
): number {
  if (!opts.spoken) return silentClipSeconds(card, modelId)
  if (card.cardVideoDurationAuto !== false) return autoClipSeconds(scriptLine, modelId)
  const durations = (modelId ? getModel(modelId)?.videoConstraints?.durations : undefined) ?? []
  return durations.length > 0
    ? snapVideoDurationUp(card.cardVideoDurationSeconds, durations)
    : card.cardVideoDurationSeconds
}
