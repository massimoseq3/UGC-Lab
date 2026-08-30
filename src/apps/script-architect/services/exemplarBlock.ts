import { EXEMPLARS, type Exemplar } from '../data/exemplars'
import type { HookCategory, WriteStyle } from '../types'

// ── Few-shot calibration from the transcript corpus ──
//
// The hook LIBRARY tells the model what shape to write. It cannot tell it what
// real speech at this performance level actually sounds like, and it says
// nothing at all about the body — every formula in it is an opening line. This
// block is the other half: verbatim transcripts, injected as calibration.
//
// It rides in the USER prompt rather than the system prompt because the slice
// is chosen per call (by hook family, or by the write style's nearest
// families), and the system prompts are module-scope constants shared by every
// take in a batch.

// Which corpus families calibrate a given write style. The styles are
// structures and the families are content categories, so this is a judgement
// call, not a join — the point is only to put the model near the right register
// (a founder story wants storytelling cadence, a tutorial wants educational).
const STYLE_FAMILIES: Record<WriteStyle, HookCategory[]> = {
  pas: ['educational', 'myth-busting'],
  story: ['storytelling'],
  listicle: ['educational'],
  callout: ['myth-busting'],
  curiosity: ['curiosity-gap'],
  'before-after': ['authority'],
  demo: ['educational'],
  comparison: ['comparison'],
  objection: ['myth-busting'],
  founder: ['storytelling'],
  podcast: ['storytelling'],
  interview: ['storytelling'],
  'green-screen': ['myth-busting'],
  reply: ['myth-busting'],
  expert: ['authority'],
  tutorial: ['educational'],
  grwm: ['day-in-the-life'],
}

export function familiesForWriteStyle(style: WriteStyle): HookCategory[] {
  return STYLE_FAMILIES[style] ?? ['educational', 'storytelling']
}

/** Round-robin across families so a multi-family request gets a spread, not all of the first one. */
function spread(families: HookCategory[], key: 'hooks' | 'scripts', limit: number): Exemplar[] {
  const pools = families.map((f) => EXEMPLARS[f]?.[key] ?? []).filter((p) => p.length > 0)
  const out: Exemplar[] = []
  for (let i = 0; out.length < limit; i += 1) {
    let advanced = false
    for (const pool of pools) {
      if (i >= pool.length) continue
      out.push(pool[i])
      advanced = true
      if (out.length >= limit) break
    }
    if (!advanced) break
  }
  return out
}

/**
 * A calibration block for the given families, or '' when the corpus has nothing
 * for them — `pattern-interrupt` has no corpus equivalent and is deliberately
 * empty, so a Pattern Interrupt request must degrade to the library alone
 * rather than borrow another family's voice.
 */
export function exemplarBlock(
  families: HookCategory[],
  opts: { hooks?: number; scripts?: number } = {},
): string {
  const hooks = spread(families, 'hooks', opts.hooks ?? 12)
  const scripts = spread(families, 'scripts', opts.scripts ?? 3)
  if (hooks.length === 0 && scripts.length === 0) return ''

  const parts: string[] = [
    `HOW REAL WINNING VIDEOS ACTUALLY SOUND — CALIBRATION, NOT MATERIAL:`,
    `Below are verbatim transcripts of real short-form videos that genuinely went viral. They are here so you can hear the RHYTHM, the CONCRETENESS and the speed they get to the point at. Study how fast they start, how plainly they name things, and how little they explain before they show.`,
    `THEY CALIBRATE SOUND, NEVER STRUCTURE: these videos were not written to the structure or format this ad has been given, so none of them shows you how yours should open or how it should be built. The style instruction and its hook contract decide that, and they outrank every line below. Take the cadence and the concreteness from these; take the shape from the brief.`,
    `THESE ARE OTHER CREATORS' WORDS AND THEY ARE OFF-LIMITS AS CONTENT: never reproduce a line from them, never borrow their subject matter, their products, their numbers or their story. Write about THIS product, in this voice's register. If a line of yours could appear in one of these transcripts unchanged, rewrite it.`,
  ]

  if (hooks.length) {
    parts.push(
      `Real opening lines:\n${hooks.map((h) => `- "${h.text}" (@${h.author})`).join('\n')}`,
    )
  }
  if (scripts.length) {
    parts.push(
      `Real videos end to end — note how the body behaves after the opening line:\n\n${scripts
        .map((s) => `--- @${s.author} ---\n${s.text}`)
        .join('\n\n')}`,
    )
  }
  return parts.join('\n\n')
}
