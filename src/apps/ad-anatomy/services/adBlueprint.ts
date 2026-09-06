// The Ad Analyzer → B-Roll handoff.
//
// THE RULE THIS FILE EXISTS FOR: the analyzed scenes describe SOMEONE ELSE'S
// ad. They name the original creator's face, hair and wardrobe and the original
// brand's packaging on purpose — the recreation prompts exist to reproduce that
// ad one-for-one. Shipping them into B-Roll beside the member's own product and
// character references would put two people and two products in frame, because
// an image model draws what it is shown AND what it is told, and it would
// render a competitor's packaging as the member's product.
//
// So "Clone this with my product" sends STAGING, not prompts. The clone is of
// the ad's CRAFT — its beats, rhythm, framing and camera. The transcript becomes B-Roll's
// script; the ad's beat map and shot craft ride `BrollInput.sceneStaging`, the
// same seam a Script Style format uses. B-Roll writes fresh prompts against the
// member's own refs, shot the way the analyzed ad was shot.
//
// The beat map is identity-free by construction (timings, beat names, scene
// labels). The shot reference is not, so it ships behind an explicit exclusion
// clause — a prompt-level guard, the same kind the app already relies on to
// keep an unbranded stand-in out of the product reference.

import type { AdBlueprintPayload } from '../../../stores/types'
import type { AnalysisResult } from '../types'

const EXCLUSION_CLAUSE = `BORROW THE CRAFT, NEVER THE IDENTITY. Everything below was observed in a DIFFERENT ad, filmed by a different person for a different brand. Take ONLY the shot rhythm, the framing, the camera movement, the lighting, the kind of location and the physical action. Never carry over any person's face, build, hair, wardrobe or accessories from it, and never any brand name, wordmark, packaging shape, label design, price or claim. The character and the product in THIS ad are the ones attached as reference images; describe those and nothing else.`

export function deriveFallbackTitle(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const cleaned = stem.replace(/[_-]+/g, ' ').trim()
  return cleaned || 'Untitled ad'
}

export function adBlueprintTitle(result: AnalysisResult, fileName: string): string {
  return result.adTitle?.trim() || deriveFallbackTitle(fileName)
}

// The words. Transcript lines only — B-Roll splits the script on newlines and
// walks it line by line, so one spoken line per row is exactly its input shape.
function blueprintScript(result: AnalysisResult): string {
  return result.transcript.map((l) => l.text.trim()).filter(Boolean).join('\n')
}

export function buildAdBlueprint(result: AnalysisResult, fileName: string): AdBlueprintPayload {
  const title = adBlueprintTitle(result, fileName)
  const { scenes, totalDurationSeconds } = result.reverseEngineeredPrompt
  const structure = result.creativeBreakdown?.structure?.trim()

  const parts: string[] = [
    `SCENE STAGING — SHOT LIKE AN ANALYSED AD ("${title}"): stage the storyboard on the rhythm below. Match the beat order and roughly the per-beat timing, and shoot each beat with the framing and camera the shot reference describes.`,
    EXCLUSION_CLAUSE,
  ]

  if (structure) {
    parts.push(`BEAT MAP (${totalDurationSeconds}s total):\n${structure}`)
  }

  if (scenes.length > 0) {
    const shots = scenes
      .map((s) => `${s.index}. ${s.label} (${s.startTime}–${s.endTime}, ${s.durationSeconds}s): ${s.prompt.trim()}`)
      .join('\n')
    parts.push(`SHOT REFERENCE — how each beat was filmed (craft only, per the rule above):\n${shots}`)
  }

  return { title, script: blueprintScript(result), staging: parts.join('\n\n') }
}
