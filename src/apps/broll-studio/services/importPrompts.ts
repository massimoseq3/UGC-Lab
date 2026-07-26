// Import prompts — paste in a storyboard written OUTSIDE the app (Claude, a
// saved file, a teammate) instead of paying for the in-app prompt-writing call.
//
// The whole design rule here is ONE PARSER. An imported storyboard runs through
// the exact same parse functions a live kie.ai response does, so an import can
// never produce a shape the app doesn't already handle — and the brief we hand
// the outside model is assembled from the SAME system + user prompts the live
// call sends, so the two can't drift apart when either is edited.

import type { BrollDelivery, BrollMode, BrollResult, ContinuousResult } from '../types'
import {
  brollSystemInstruction,
  buildBrollUserPrompt,
  extractVoiceProfile,
  parseScenes,
  variationsForDelivery,
} from './generateBroll'
import {
  CONTINUOUS_SYSTEM,
  buildContinuousUserPrompt,
  parseContinuousResult,
  scriptLines as splitScriptLines,
  styleBriefFor,
  styleUsesRealism,
  type ContinuousInput,
} from './generateContinuous'

// Everything the importer needs from the workspace: the same inputs a Generate
// would have used, so a parsed result is indistinguishable from a generated one.
export interface ImportContext {
  scriptText: string
  productContext: string
  modelContext: string
  additionalContext: string
  styleId: string
  styleBrief?: string
  styleName?: string
  lineDelivery: BrollDelivery
  continuousModelId: string
}

export interface ImportParsed {
  mode: BrollMode
  // Exactly one of these is set, matching `mode`.
  lineResult?: BrollResult
  continuousResult?: ContinuousResult
  // "6 scenes · 18 prompts" — shown before the user commits.
  summary: string
  // Non-blocking observations (a short scene, a missing final frame). The
  // import still commits; these just stop a silent surprise.
  notes: string[]
  // The script the imported prompts were written against, recovered from the
  // storyboard itself. Used to backfill an empty script box so the history row
  // has a title and the scene editors have their lines.
  recoveredScript: string
}

export type ImportOutcome =
  | { ok: true; parsed: ImportParsed }
  | { ok: false; error: string }

// ── Mode detection ─────────────────────────────────────────────
// Each mode's envelope has a tag the other never uses, so a paste into the
// wrong mode can say which mode it actually belongs to instead of just failing.

export function detectImportMode(text: string): BrollMode | null {
  if (/<STORYBOARD>/i.test(text) || /<SCENE_1>/i.test(text)) return 'continuous'
  if (/<SCENE>/i.test(text) && /<VAR_1>/i.test(text)) return 'line'
  return null
}

const MODE_LABEL: Record<BrollMode, string> = {
  line: 'Line-by-Line',
  continuous: 'Continuous',
}

function wrongModeError(detected: BrollMode, wanted: BrollMode): string {
  return `That looks like a ${MODE_LABEL[detected]} storyboard, but you're importing into ${MODE_LABEL[wanted]}. Switch modes and import it there.`
}

// ── Per-mode parse ─────────────────────────────────────────────

function importLine(text: string, ctx: ImportContext): ImportOutcome {
  const scenes = parseScenes(text, ctx.lineDelivery)
  if (scenes.length === 0) {
    const detected = detectImportMode(text)
    return {
      ok: false,
      error: detected && detected !== 'line'
        ? wrongModeError(detected, 'line')
        : `No <SCENE> blocks found. Each scene needs <SCENE>…</SCENE> wrapping a <LINE> and its <VAR_1>…<VAR_${variationsForDelivery(ctx.lineDelivery)}> prompts.`,
    }
  }

  const promptCount = scenes.reduce((n, s) => n + s.variations.length, 0)
  const notes: string[] = []
  // A dialogue import is expected to carry one more prompt per scene (the
  // talking card on top of the three b-roll ideas), so the "thin" bar moves.
  const expected = variationsForDelivery(ctx.lineDelivery)
  const thin = scenes.filter((s) => s.variations.length < expected).map((s) => s.number)
  if (thin.length > 0) {
    notes.push(`Scene${thin.length === 1 ? '' : 's'} ${thin.join(', ')} came in with fewer than ${expected} prompts — you can add options per scene afterwards.`)
  }
  const voiceProfile = ctx.lineDelivery === 'dialogue' ? extractVoiceProfile(text) : undefined
  if (ctx.lineDelivery === 'dialogue' && !voiceProfile) {
    notes.push('No <VOICE_PROFILE> block — the talking cards will each pick their own voice. Add one for a consistent voice across the ad.')
  }

  return {
    ok: true,
    parsed: {
      mode: 'line',
      lineResult: {
        scenes,
        style: styleBriefFor({ styleId: ctx.styleId, styleBrief: ctx.styleBrief }),
        realism: styleUsesRealism(ctx.styleId, !!ctx.styleBrief?.trim()),
        styleId: ctx.styleId,
        styleBrief: ctx.styleBrief?.trim() || undefined,
        styleName: ctx.styleBrief?.trim() ? ctx.styleName?.trim() || undefined : undefined,
        voiceProfile,
      },
      summary: `${scenes.length} scene${scenes.length === 1 ? '' : 's'} · ${promptCount} prompt${promptCount === 1 ? '' : 's'}`,
      notes,
      recoveredScript: scenes.map((s) => s.scriptLine).filter(Boolean).join('\n'),
    },
  }
}

function importContinuous(text: string, ctx: ImportContext): ImportOutcome {
  const input: ContinuousInput = {
    scriptText: ctx.scriptText,
    styleId: ctx.styleId,
    styleBrief: ctx.styleBrief,
    modelId: ctx.continuousModelId,
    productContext: ctx.productContext,
    modelContext: ctx.modelContext,
    additionalContext: ctx.additionalContext,
  }
  const result = parseContinuousResult(text, input)
  if (!result) {
    const detected = detectImportMode(text)
    return {
      ok: false,
      error: detected && detected !== 'continuous'
        ? wrongModeError(detected, 'continuous')
        : 'No <SCENE_N> blocks found. The storyboard needs <SCENE_1>, <SCENE_2>… each wrapping a <LINE> and a <FRAME> of <CONCEPT_N> blocks.',
    }
  }

  const conceptCount = result.frames.reduce((n, f) => n + f.concepts.length, 0)
  const notes: string[] = []
  if (!/<FINAL_FRAME>/i.test(text)) {
    notes.push("No <FINAL_FRAME> block — the last keyframe's concepts were reused as the end frame. Add one for a proper closing image.")
  }
  if (!/<STYLE>/i.test(text)) {
    notes.push('No <STYLE> block — falling back to the visual style picked in the panel.')
  }
  const pastedLines = splitScriptLines(ctx.scriptText).length
  if (pastedLines > 0 && pastedLines !== result.scenes.length) {
    notes.push(`Your script box has ${pastedLines} lines but the storyboard has ${result.scenes.length} scenes. The storyboard wins — split or merge scenes in place if that's wrong.`)
  }
  const missingMotion = result.frames
    .slice(0, -1)
    .filter((f) => !f.concepts.some((c) => c.motionPrompt?.trim()))
    .map((f) => f.index)
  if (missingMotion.length > 0) {
    notes.push(`Frame${missingMotion.length === 1 ? '' : 's'} ${missingMotion.join(', ')} carry no <MOTION> — those clips start with an empty motion prompt.`)
  }

  return {
    ok: true,
    parsed: {
      mode: 'continuous',
      continuousResult: result,
      summary: `${result.scenes.length} scene${result.scenes.length === 1 ? '' : 's'} · ${result.frames.length} keyframes · ${conceptCount} prompt${conceptCount === 1 ? '' : 's'}`,
      notes,
      recoveredScript: result.scenes.map((s) => s.scriptLine).filter(Boolean).join('\n'),
    },
  }
}

export function parseImport(mode: BrollMode, text: string, ctx: ImportContext): ImportOutcome {
  if (!text.trim()) return { ok: false, error: 'Paste the prompts first.' }
  if (mode === 'line') return importLine(text, ctx)
  return importContinuous(text, ctx)
}

// ── The brief handed to the outside model ──────────────────────
//
// Assembled from the live call's own system + user prompts, so whatever the
// app would have asked kie.ai for is exactly what the member asks Claude for.
// Only the tail changes: the reply is going into a parser, not into a chat.

function importTail(mode: BrollMode): string {
  const envelope =
    mode === 'line'
      ? 'the <SCENE>…</SCENE> blocks (one per line of the script)'
      : 'the single <STORYBOARD>…</STORYBOARD> envelope'
  const filename = mode === 'line' ? 'line-by-line-prompts.txt' : 'continuous-storyboard.txt'

  return `# HOW YOUR ANSWER IS USED — READ THIS LAST, IT OVERRIDES ANY HABIT TO EXPLAIN YOURSELF

Your reply is not being read by a person. It goes straight into UGC OS → B-Roll → Import prompts, which runs it through the same strict parser the in-app generator uses. So:

- Output ONLY ${envelope}. No preamble, no summary, no explanation, no markdown code fences, no headings of your own — nothing before the first tag or after the last one.
- Use the tag names and nesting EXACTLY as specified above. The parser matches them literally; a renamed, reordered or unclosed tag is silently dropped.
- Do not skip, merge, renumber or reorder the numbered blocks.
- Reference images: if I've attached the product photo or the character's photo, they are context for you only. Never describe the character's appearance — the app attaches the real reference images at render time.

If it's easier to hand me a file than a long message, write the same output to a plain-text file named \`${filename}\` — the importer accepts .txt, .md, .xml and .json files as well as pasted text.`
}

export function buildImportBrief(mode: BrollMode, ctx: ImportContext): string {
  if (mode === 'line') {
    const input = {
      productId: null,
      modelId: null,
      scriptId: null,
      scriptText: ctx.scriptText,
      additionalContext: ctx.additionalContext,
      productContext: ctx.productContext,
      modelContext: ctx.modelContext,
      referenceImages: [],
      styleId: ctx.styleId,
      styleBrief: ctx.styleBrief,
      styleName: ctx.styleName,
      delivery: ctx.lineDelivery,
    }
    return [brollSystemInstruction(ctx.lineDelivery), buildBrollUserPrompt(input), importTail('line')].join('\n\n')
  }

  const input: ContinuousInput = {
    scriptText: ctx.scriptText,
    styleId: ctx.styleId,
    styleBrief: ctx.styleBrief,
    modelId: ctx.continuousModelId,
    productContext: ctx.productContext,
    modelContext: ctx.modelContext,
    additionalContext: ctx.additionalContext,
  }
  return [CONTINUOUS_SYSTEM, buildContinuousUserPrompt(input), importTail('continuous')].join('\n\n')
}
