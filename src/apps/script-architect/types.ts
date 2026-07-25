// The pipeline discriminator. Persisted in scriptHistory rows and dispatched
// on by the service, so all three values stay — but the UI only exposes two
// modes ('remix' | 'write'); the remix source's format picks between the
// 'remix' and 'reverse-engineer' pipelines at generate time.
export type ScriptMode = 'write' | 'remix' | 'reverse-engineer'

// What the left-panel mode toggle actually offers.
export type ScriptUiMode = 'remix' | 'write'

// A scene blueprint (Ad Analyzer output / a Scenes bank item) is machine-
// written with rigid "--- Scene N: <label> (MM:SS-MM:SS) ---" headers, so the
// remix source's format is detectable: blueprint → scene-rewrite pipeline,
// plain text → 3 remixed script variations. Also matches the looser
// hand-written shape (a line starting "SCENE 1 —" / "Scene 2:") so pasted
// blueprints that skip the divider dashes still route correctly; a spoken
// transcript never opens a line with a numbered scene header.
export function detectSceneBlueprint(source: string): boolean {
  return /^(?:---\s*)?scene\s*\d+\s*[—:–-]/im.test(source)
}

export type RemixAngle =
  | 'hook-led'
  | 'pain-point-led'
  | 'curiosity-led'
  | 'story-led'
  | 'proof-led'
  // Added when the batch size became user-picked — a 10-variation remix needs
  // ten genuinely different persuasion mechanisms, not five run twice.
  | 'objection-led'
  | 'comparison-led'
  | 'mistake-led'
  | 'social-proof-led'
  | 'routine-led'

// ── Write New (from-scratch) mode ──
export type WriteStyle =
  | 'pas'
  | 'story'
  | 'listicle'
  | 'callout'
  | 'curiosity'
  | 'before-after'
  | 'demo'
  | 'comparison'

// 'script' → spoken words only (→ Voiceovers). 'hooks' → a pack of 10
// standalone opening lines built on the 7 viral-hook formula families (each
// line tagged with its family; no length/style controls). 'scenes' →
// scene-by-scene visual blueprint with the dialogue embedded
// ([CHARACTER]/[PRODUCT] tokens, same format the Remix Scenes pipeline emits
// → B-Roll / Playground). 'prompt' → ONE structured cinematic master prompt
// for a single premium AI commercial (STYLE/ENVIRONMENT/.../TIMELINE), with
// @INFLUENCER / @PRODUCT reference tokens → Playground video mode.
export type WriteFormat = 'script' | 'hooks' | 'scenes' | 'prompt'

export type WriteLength = 10 | 15 | 30 | 60
export const WRITE_LENGTHS: WriteLength[] = [10, 15, 30, 60]

export const WRITE_STYLE_META: Record<WriteStyle, { label: string; hint: string }> = {
  pas: { label: 'Problem–Agitate–Solution', hint: 'Name the pain, twist it, product as relief' },
  story: { label: 'Story / Testimonial', hint: '"I almost returned this..." storytime' },
  listicle: { label: '3 Reasons', hint: 'Fast numbered list, strongest reason last' },
  callout: { label: 'Negative / Callout', hint: '"Stop buying X" pattern interrupt' },
  curiosity: { label: 'Curiosity Hook', hint: '"Why is nobody talking about this"' },
  'before-after': { label: 'Before & After', hint: 'Transformation with a real timeframe' },
  demo: { label: 'Unboxing / Demo', hint: 'First-impressions reaction energy' },
  comparison: { label: 'Us vs Them', hint: 'The usual stuff vs this one' },
}

// Guards persisted / handed-off style slugs: styles get trimmed over time
// (see #211), so a value read from localStorage or history may no longer be a
// live key. Callers coerce misses back to a default rather than dereferencing
// WRITE_STYLE_META[missing] and crashing.
export const isWriteStyle = (value: unknown): value is WriteStyle =>
  typeof value === 'string' && value in WRITE_STYLE_META

// ── Hooks format ──
//
// The 7 formula families distilled from the "1,000 Viral Hooks" swipe file the
// generation prompt is trained on. 'auto' lets the model pick the mix that
// fits the product; a specific category locks all 10 hooks to that family.
export type HookCategory =
  | 'educational'
  | 'comparison'
  | 'myth-busting'
  | 'storytelling'
  | 'authority'
  | 'day-in-the-life'
  | 'pattern-interrupt'

export type HookCategoryChoice = 'auto' | HookCategory

export const HOOK_COUNT = 10

// How many takes a Script / Scenes / Cinematic / Remix generate returns.
// User-picked, defaulting to 3: five parallel takes off one brief crowded each
// other, and three long scripts is what most people actually read before
// picking. 10 is there for when you want a wide net and don't mind the credits.
// Hooks are exempt (HOOK_COUNT) — those are one-liners, not scripts.
//
// Every angle list below is ordered BEST-FIRST and sliced to the chosen count,
// so picking 3 gives the three strongest angles rather than an arbitrary three.
export const VARIATION_COUNTS = [3, 5, 10] as const
export type VariationCount = (typeof VARIATION_COUNTS)[number]
export const DEFAULT_VARIATION_COUNT: VariationCount = 3

export function isVariationCount(v: unknown): v is VariationCount {
  return VARIATION_COUNTS.includes(v as VariationCount)
}

export const HOOK_CATEGORY_META: Record<HookCategoryChoice, { label: string; hint: string }> = {
  auto: { label: 'Best Mix', hint: 'The model picks the strongest angles across all 7 families' },
  educational: { label: 'Educational', hint: '"Here\'s exactly how much X you need to get Y"' },
  comparison: { label: 'Comparison', hint: 'This vs that — same price, wildly different result' },
  'myth-busting': { label: 'Myth Busting', hint: '"Let me de-influence you" — call out the common belief' },
  storytelling: { label: 'Storytelling', hint: '"2 years ago I..." — drop in mid-story, no warm-up' },
  authority: { label: 'Authority', hint: 'Receipts and transformations — "I went from this to this"' },
  'day-in-the-life': { label: 'Day in the Life', hint: '"Come to work with me as a..." POV energy' },
  'pattern-interrupt': { label: 'Pattern Interrupt', hint: 'Challenges, absurd stakes, "they didn\'t sponsor this"' },
}

export const isHookCategoryChoice = (value: unknown): value is HookCategoryChoice =>
  typeof value === 'string' && value in HOOK_CATEGORY_META

export interface ParsedHook {
  // null when a line arrives without a recognisable <FAMILY> tag — the hook
  // still renders, just without a category chip.
  category: HookCategory | null
  text: string
}

// Parses the hooks pipeline's "<FAMILY> hook text" lines. Tolerates missing /
// unknown tags so a slightly off-format model reply still renders every hook.
export function parseHooks(text: string): ParsedHook[] {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/^\d+[.)]\s*/, ''))
    .filter(Boolean)
    .map((line) => {
      const match = /^<([^>]+)>\s*(.*)$/.exec(line)
      if (!match || !match[2]) return { category: null, text: line }
      const slug = match[1].trim().toLowerCase().replace(/[^a-z]+/g, '-')
      return {
        category: slug !== 'auto' && isHookCategoryChoice(slug) ? (slug as HookCategory) : null,
        text: match[2].trim(),
      }
    })
    .filter((h) => h.text.length > 0)
}

// The clean spoken lines — what copy / save-to-bank should produce (the
// <FAMILY> tags are UI metadata, not script text).
export function hooksPlainText(text: string): string {
  return parseHooks(text).map((h) => h.text).join('\n')
}

export interface EditableProductContext {
  productName: string
  productDescription: string
  targetMarket: string
  painPoints: string
  usps: string
  benefits: string
  keySpecs: string
  customerLanguage: string
  objections: string
  offer: string
  cta: string
}

export interface GenerateScriptInput {
  mode: ScriptMode
  winningTranscript: string
  reversePrompt: string
  // Write New mode inputs
  brief: string
  writeStyle?: WriteStyle
  writeFormat?: WriteFormat
  writeLength?: WriteLength
  // Hooks format only: which formula family the 10 hooks draw from.
  hookCategory?: HookCategoryChoice
  // How many takes to return. Omitted → DEFAULT_VARIATION_COUNT.
  variationCount?: VariationCount
  productId: string | null
  // The raw bank name. What the model is SHOWN is productContext.productName
  // (user-editable in the form); this is the fallback when that's blank — see
  // spokenProductName in the service.
  productName?: string
  productContext?: EditableProductContext | null
  additionalContext: string
}

export interface GeneratedScript {
  variations: string[]
  // Remix only: the angles used, in card order. Stamped onto the history row so
  // a saved session labels its cards from what actually ran rather than from a
  // list that may have been reordered since.
  angles?: RemixAngle[]
}

export const REMIX_ANGLE_LABEL: Record<RemixAngle, string> = {
  'hook-led': 'Hook-led',
  'pain-point-led': 'Pain-point-led',
  'curiosity-led': 'Curiosity-led',
  'story-led': 'Story-led',
  'proof-led': 'Proof-led',
  'objection-led': 'Objection-led',
  'comparison-led': 'Comparison-led',
  'mistake-led': 'Mistake-led',
  'social-proof-led': 'Social-proof-led',
  'routine-led': 'Routine-led',
}

// Remix angles in card order, STRONGEST FIRST — a remix takes the first N.
// Each is a different persuasion mechanism, not a different flavour of one:
// feel the problem / need to know / see the result, then the objection, the
// switch, the mistake, the recommendation, the moment it bites. 'hook-led' sits
// last because it's the weakest as an *angle* — every script already runs the
// global hook rules, so on its own it mostly restates the house style.
export const REMIX_ANGLES: RemixAngle[] = [
  'pain-point-led',
  'curiosity-led',
  'proof-led',
  'story-led',
  'objection-led',
  'comparison-led',
  'mistake-led',
  'social-proof-led',
  'routine-led',
  'hook-led',
]

// Sessions generated before the count was user-picked always produced five, in
// a different order to today's first five. Those rows are still in Script
// History and carry no stamped angle list, so they're matched by shape here
// rather than mislabelled by slicing the current list.
const LEGACY_REMIX_ANGLES: RemixAngle[] = [
  'hook-led',
  'pain-point-led',
  'curiosity-led',
  'story-led',
  'proof-led',
]

// Angle list for a remix row that didn't stamp its own. Only legacy rows land
// here; anything generated since stamps `remixAngles` and uses that verbatim.
// Returns null for a count we can't attribute — the caller drops the label
// rather than guessing, since a wrong angle label is worse than none.
export function remixAnglesForCount(count: number): RemixAngle[] | null {
  if (count === LEGACY_REMIX_ANGLES.length) return LEGACY_REMIX_ANGLES
  if (count > 0 && count <= REMIX_ANGLES.length) return REMIX_ANGLES.slice(0, count)
  return null
}
