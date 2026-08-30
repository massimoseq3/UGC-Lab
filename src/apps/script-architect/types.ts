import type { Product } from '../../stores/types'

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
const SCENE_HEADER_RE = /^(?:---\s*)?scene\s*\d+\s*[—:–-]/im

// The "=== MASTER … ===" blocks the Ad Analyzer puts in front of its scenes
// (and the "=== VOICE PROFILE … ===" our own blueprint prompts append after
// them) identify a blueprint on their own: nothing else in the app writes that
// marker, and a spoken transcript never carries one. They're matched alongside
// the headers because a blueprint can reach this box with its headers already
// lost — a single-scene handoff saved to the Script Bank before the Ad
// Analyzer started headering a lone scene, or a hand-copied paste. Without
// this those sources were remixed as plain scripts: no scene rewrite, and no
// voice profile in the output, which is the shape members reported.
const BLUEPRINT_MARKER_RE = /^\s*=+\s*(?:MASTER\s+(?:VISUAL STYLE|VOICE PROFILE)|VOICE PROFILE)\b/im

export function detectSceneBlueprint(source: string): boolean {
  return SCENE_HEADER_RE.test(source) || BLUEPRINT_MARKER_RE.test(source)
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
//
// Two kinds of style share one picker. A STRUCTURE is the persuasion mechanic
// the script runs on (how the argument is built). A FORMAT is the kind of
// organic content the ad is disguised as — a podcast clip, a street interview,
// a comment reply — which decides how it's staged as much as what it says.
// Formats are the higher-converting half in practice: the ad reads as content
// the viewer already watches, so the sell lands before the scroll reflex does.
// Both flow into the same style instruction, but only formats carry scene
// staging (see WRITE_STYLE_SCENE_DIRECTION in the service), because a
// structure leaves the shots free while a format IS the shots.
export type WriteStyleGroup = 'structure' | 'format'

export type WriteStyle =
  // Structures
  | 'pas'
  | 'story'
  | 'listicle'
  | 'callout'
  | 'curiosity'
  | 'before-after'
  | 'demo'
  | 'comparison'
  | 'objection'
  | 'founder'
  // Formats
  | 'podcast'
  | 'interview'
  | 'green-screen'
  | 'reply'
  | 'expert'
  | 'tutorial'
  | 'grwm'

// 'script' → spoken words only (→ Voiceovers). 'hooks' → a pack of 10
// standalone opening lines built on the 7 viral-hook formula families (each
// line tagged with its family; no length/style controls). 'scenes' →
// scene-by-scene visual blueprint with the dialogue embedded
// ([CHARACTER]/[PRODUCT] tokens, same format the Remix Scenes pipeline emits
// → B-Roll / Playground).
//
// A retired 'prompt' (Cinematic) format is still persisted on older history
// rows — see ScriptHistoryItem.writeFormat. It has no generation path anymore;
// isWriteFormat coerces it back to 'script' wherever a row is restored.
export type WriteFormat = 'script' | 'hooks' | 'scenes'

// Guards persisted / history-restored formats. Formats get retired (Cinematic
// was), so a value read from localStorage or a history row may no longer be a
// live one — callers coerce a miss back to 'script'.
export const isWriteFormat = (value: unknown): value is WriteFormat =>
  value === 'script' || value === 'hooks' || value === 'scenes'

export type WriteLength = 10 | 15 | 20 | 30 | 60 | 90
export const WRITE_LENGTHS: WriteLength[] = [10, 15, 20, 30, 60, 90]

// Guards persisted / history-restored lengths. The list has grown once (20s was
// added after launch), so callers coerce a miss back to the default instead of
// hand-listing the members at every read site.
export const isWriteLength = (value: unknown): value is WriteLength =>
  WRITE_LENGTHS.includes(value as WriteLength)

// Remix rewrites an ad that already has a length, so unlike Write New it has a
// "leave it alone" option — 'default' keeps the source's own pacing and beat
// count, which is what remixing a winning ad usually wants. It leads the list
// and is the default pick; the numbers re-cut the source to a target duration.
export type RemixLength = WriteLength | 'default'
export const REMIX_LENGTHS: RemixLength[] = ['default', ...WRITE_LENGTHS]
export const DEFAULT_REMIX_LENGTH: RemixLength = 'default'

export const isRemixLength = (value: unknown): value is RemixLength =>
  value === 'default' || isWriteLength(value)

export const WRITE_STYLE_GROUP_META: Record<WriteStyleGroup, { label: string; hint: string }> = {
  structure: { label: 'Structures', hint: 'How the argument is built' },
  format: { label: 'Formats', hint: 'The kind of content the ad is disguised as' },
}

export const WRITE_STYLE_META: Record<WriteStyle, { label: string; hint: string; group: WriteStyleGroup }> = {
  pas: { label: 'Problem–Agitate–Solution', hint: 'Name the pain, twist it, product as relief', group: 'structure' },
  story: { label: 'Story / Testimonial', hint: '"I almost returned this..." storytime', group: 'structure' },
  listicle: { label: '3 Reasons', hint: 'Fast numbered list, strongest reason last', group: 'structure' },
  callout: { label: 'Negative / Callout', hint: '"Stop buying X" pattern interrupt', group: 'structure' },
  curiosity: { label: 'Curiosity Hook', hint: '"Why is nobody talking about this"', group: 'structure' },
  'before-after': { label: 'Before & After', hint: 'Transformation with a real timeframe', group: 'structure' },
  demo: { label: 'Unboxing / Demo', hint: 'First-impressions reaction energy', group: 'structure' },
  comparison: { label: 'Us vs Them', hint: 'The usual stuff vs this one', group: 'structure' },
  objection: { label: 'Objection Crusher', hint: '"$40 for this? okay, hear me out"', group: 'structure' },
  founder: { label: 'Founder Story', hint: '"I made this because nothing worked"', group: 'structure' },
  podcast: { label: 'Podcast Clip', hint: 'The host asks, the expert answers', group: 'format' },
  interview: { label: 'Street Interview', hint: 'Different strangers, doubtful then sold', group: 'format' },
  'green-screen': { label: 'Green Screen Reaction', hint: 'Reacting to a review, comment or headline', group: 'format' },
  reply: { label: 'Comment Reply', hint: 'The comment on screen, answered', group: 'format' },
  expert: { label: 'Expert Explainer', hint: '"I do this for a living, so listen"', group: 'format' },
  tutorial: { label: 'How-To / Tutorial', hint: 'Teach the steps, product is step two', group: 'format' },
  grwm: { label: 'GRWM / Routine', hint: 'Inside a real routine, sold on the way past', group: 'format' },
}

// Picker order within a section. Object key order IS the order, so a style
// moves by moving its entry above.
export const writeStylesInGroup = (group: WriteStyleGroup): WriteStyle[] =>
  (Object.keys(WRITE_STYLE_META) as WriteStyle[]).filter((s) => WRITE_STYLE_META[s].group === group)

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
  // Leads the list deliberately. Of the 22 hook patterns tagged across the
  // transcript corpus, this is the ONLY one whose engagement lift survived a
  // bootstrap CI (1.71x, 95% CI [1.09, 2.09], n=32 across 32 distinct
  // creators) and a within-category control. Every other family here is
  // inherited from the source PDF's own grouping and carries no such evidence.
  | 'curiosity-gap'
  | 'educational'
  | 'comparison'
  | 'myth-busting'
  | 'storytelling'
  | 'authority'
  | 'day-in-the-life'
  | 'pattern-interrupt'

export type HookCategoryChoice = 'auto' | HookCategory

// How many hooks a Hooks generate returns. User-picked like the take count,
// but its own list and its own slot: hooks are one-liners off a single call, so
// 50 of them cost what 50 scripts never could, and 10 stays the default the
// prompt was written around.
export const HOOK_COUNTS = [10, 20, 50] as const
export type HookCount = (typeof HOOK_COUNTS)[number]
export const DEFAULT_HOOK_COUNT: HookCount = 10

export function isHookCount(v: unknown): v is HookCount {
  return HOOK_COUNTS.includes(v as HookCount)
}

// How many takes a Script / Scenes / Remix generate returns.
// User-picked, defaulting to 3: five parallel takes off one brief crowded each
// other, and three long scripts is what most people actually read before
// picking. 10 is there for when you want a wide net and don't mind the credits.
// Hooks are exempt (HOOK_COUNTS) — those are one-liners, not scripts.
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
  auto: { label: 'Best Mix', hint: 'The model picks the strongest angles across all 8 families' },
  'curiosity-gap': { label: 'Curiosity Gap', hint: 'Name the specific thing they can\'t resolve without watching' },
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

// ── Labelled lines → what a voice actually reads ──
//
// Four Script Style FORMATS put something in a plain script that nobody speaks:
// a podcast clip carries HOST: / GUEST: turns, a street interview carries
// INTERVIEWER: and PERSON N:, and the comment reply and green-screen reaction
// carry the exact on-screen wording on ON SCREEN: lines. That copy has to reach
// the creator — it is what gets typed into the overlay, and the reply cannot be
// shot without it — but Voiceovers hands the script to a single TTS speaker as
// one blob, so sent raw it reads "HOST colon" out loud and then reads the
// comment card as if it were dialogue.
//
// So the handoff strips the labels and drops the lines that are pictures, not
// speech. It deliberately does NOT try to pick one speaker: a two-hander read by
// one voice is a draft the member can hear and edit, where a script silently
// missing half its lines is not. The label test is a SHORT all-caps token (up to
// three words) followed by a colon, which covers the vocabulary the prompts name
// plus anything a member types in the same shape, and can't reach a normal
// spoken line — those are lower case by every rule in the writing prompts.
const LINE_LABEL_RE = /^([A-Z][A-Z0-9]*(?:[ -][A-Z0-9]+){0,2}):\s*/
const ON_SCREEN_LABEL_RE = /^ON[ -]SCREEN\b/

export function spokenLinesOnly(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const label = LINE_LABEL_RE.exec(line.trim())
      if (!label) return line
      // On-screen copy is a graphic, never a spoken word — the whole line goes.
      if (ON_SCREEN_LABEL_RE.test(label[1])) return null
      return line.trim().slice(label[0].length)
    })
    .filter((line): line is string => line !== null)
    .join('\n')
    // A dropped on-screen line can leave the run of blank lines around it.
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// The inverse of parseHooks — rebuilds the tagged text a pack is stored as, so
// editing ONE line in place can be written back without disturbing the others.
// The tag round-trips through parseHooks' own slug rule ('myth-busting' →
// <MYTH BUSTING>), and a hook that arrived untagged stays untagged.
export function hooksToText(hooks: ParsedHook[]): string {
  return hooks
    .map((h) => (h.category ? `<${h.category.replace(/-/g, ' ').toUpperCase()}> ${h.text}` : h.text))
    .join('\n')
}

export interface EditableProductContext {
  productName: string
  productDescription: string
  targetMarket: string
  painPoints: string
  usps: string
  benefits: string
  keySpecs: string
  objections: string
  offer: string
  cta: string
}

// A product bank row as the script writer sees it. Lives here rather than in
// the input panel so the shape is the service's, not one screen's.
export function createEditableContext(product: Product): EditableProductContext {
  return {
    productName: product.productName,
    productDescription: product.productDescription,
    targetMarket: product.targetMarket,
    painPoints: product.painPoints,
    usps: product.usps,
    benefits: product.benefits,
    keySpecs: product.keySpecs ?? '',
    objections: product.objections ?? '',
    offer: product.offer,
    cta: product.cta,
  }
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
  // Remix mode: the target duration to re-cut the source ad to. Omitted → the
  // remix keeps the source's own length and beat count (the 'default' pick).
  remixLength?: WriteLength
  // Hooks format only: which formula family the hooks draw from.
  hookCategory?: HookCategoryChoice
  // Hooks format only: how many hooks to return. Omitted → DEFAULT_HOOK_COUNT.
  hookCount?: HookCount
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
