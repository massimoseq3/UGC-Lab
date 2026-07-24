// One Shot mode: the whole script → 4 complete video concepts, each a full
// master prompt a multi-cut-capable model (Seedance 2.0 etc.) renders as ONE
// generation. No image step — the concept goes straight to video.
//
// Segment math is deterministic and client-side: we estimate spoken seconds
// from word count (~2.4 words/sec, matching Scripts' WRITE_LENGTH_BUDGET),
// divide by the selected model's longest clip, and tell the LLM exactly how
// many segments to write. The LLM never does arithmetic — it only picks the
// natural sentence boundaries.

import type { OneShotConcept, OneShotDelivery, OneShotResult, OneShotSegment } from '../types'
import { useSettingsStore } from '../../../stores/settingsStore'
import { kieChatCompletions, type ChatMessage } from '../../../utils/kie'
import { getChatEndpointPath, getModel, snapVideoDurationUp } from '../../../utils/models'
import { styleBriefFor, styleUsesRealism } from './generateContinuous'

// Models LISTED in the One Shot picker — every standard B-Roll video model, so
// the user can see the full lineup. Only ONE_SHOT_ENABLED_MODEL_IDS are
// actually selectable; the rest (Veo, Wan, Seedance 1.5) show greyed because
// they can't do the ref+audio multi-cut this mode is built around — they'd drop
// the refs and render a plain clip.
export const ONE_SHOT_MODEL_IDS = [
  'bytedance/seedance-2',
  'bytedance/seedance-2-fast',
  'bytedance/seedance-2-mini',
  'kling-3.0/video',
  'grok-imagine-video-1-5-preview',
  'gemini-omni-video',
  'bytedance/seedance-1.5-pro',
  'veo3_fast',
  'veo3_lite',
  'veo3',
  'wan/2-7',
]

// The subset actually built for One Shot — selectable in the picker; every
// other listed model lands greyed. Kling 3.0 is deliberately in despite taking
// no reference images: the UI warns refs are dropped (prompt-only likeness),
// and it gets multi_shots:true so the model still bakes the cuts in. Grok does
// text-to-video (and reference-to-video), so it runs the multi-cut too.
export const ONE_SHOT_ENABLED_MODEL_IDS = [
  'bytedance/seedance-2',
  'bytedance/seedance-2-fast',
  'bytedance/seedance-2-mini',
  'kling-3.0/video',
  'grok-imagine-video-1-5-preview',
  'gemini-omni-video',
]

export const ONE_SHOT_DEFAULT_MODEL_ID = 'bytedance/seedance-2'

// ~2.4 words/sec on-camera pace — same assumption as Scripts' length budgets.
const WORDS_PER_SECOND = 2.4
// Hard ceiling on clips per concept. A script needing more than 4 clips is a
// 60s+ read — that's Line by Line territory, and we warn instead of chaining.
export const MAX_SEGMENTS = 4

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function estimateSpokenSeconds(script: string): number {
  return Math.ceil(wordCount(script) / WORDS_PER_SECOND)
}

export interface SegmentPlan {
  count: number
  maxClipSeconds: number
  capped: boolean
}

// How many sequential clips this script needs on this model. Falls back to
// 15s when the model has no duration grid (shouldn't happen for the allowlist).
export function planSegments(estimatedSeconds: number, modelId: string): SegmentPlan {
  const durations = getModel(modelId)?.videoConstraints?.durations ?? []
  const maxClipSeconds = durations.length > 0 ? durations[durations.length - 1] : 15
  const ideal = Math.max(1, Math.ceil(estimatedSeconds / maxClipSeconds))
  return {
    count: Math.min(MAX_SEGMENTS, ideal),
    maxClipSeconds,
    capped: ideal > MAX_SEGMENTS,
  }
}

// Snapped-up clip length for one segment's excerpt. Dialogue gets 10%
// breathing room for natural delivery pauses; silent footage just needs to
// cover the voiceover span.
function segmentDuration(excerpt: string, delivery: OneShotDelivery, modelId: string): number {
  const durations = getModel(modelId)?.videoConstraints?.durations ?? []
  const buffer = delivery === 'dialogue' ? 1.1 : 1
  const raw = Math.max(2, Math.ceil((wordCount(excerpt) / WORDS_PER_SECOND) * buffer))
  return durations.length > 0 ? snapVideoDurationUp(raw, durations) : raw
}

// ── The system prompt ──────────────────────────────────────────
//
// Each clip is a scene-by-scene BLUEPRINT — timestamped
// `--- Scene N (MM:SS-MM:SS) ---` headers, ONE flowing paragraph per scene
// (the old labelled SETTING/CAMERA/... fields read disjointed and crowded out
// the idea), plus a VOICE PROFILE block for dialogue delivery. The prompt goes
// straight to a video model with reference images attached, so it carries
// [CHARACTER] / [PRODUCT] tokens (resolved to plain words at generation time,
// see resolveOneShotTokens). withIphoneRealism still appends the deterministic
// quality stack at request time.

const SCENE_PARAGRAPH = `Below each scene header, write ONE flowing paragraph (2-4 sentences) directing that shot — no labelled fields, no SETTING:/CAMERA:/LIGHTING: prefixes. Weave into natural prose: where we are and what's actually visible, what [CHARACTER] physically does (the exact gesture, gaze, micro-expression — a movement, never a mood word), the real light source, and the natural sound of the moment. State the camera only as a position when it matters ("framed from chest height an arm's length away", "from directly above") — NEVER name a filming device (no phone, iPhone, front camera, tripod, ring light): a named device gets drawn into the frame. No mirror selfies.
__DIALOGUE_RULE__
Sound: __AUDIO_RULE__ NEVER background music, NEVER a soundtrack or score, NEVER a separate voiceover track (music is added later in editing).`

const TOKENS_BLOCK = `TOKENS — CRITICAL:
- Use the literal token [CHARACTER] for the on-camera person in ALL visual direction. NEVER describe their identity or appearance — gender, age, ethnicity, hair, body, wardrobe colour. Emotional state, gaze, gesture, and body language ARE allowed. A reference image fixes their look.
- Use the literal token [PRODUCT] for the product in visual direction. NEVER describe its packaging, label, container, or brand there. A reference image fixes it.
- EXCEPTION — spoken dialogue: inside a quoted spoken line, name the product in plain words the way a real person would — its ACTUAL name (from the product context) at most twice across the whole ad, and "this thing" / "it" / the category everywhere else. NEVER put [PRODUCT] or [CHARACTER] inside a spoken line — a voice model reads the token out literally.`

const DIALOGUE_RULES = {
  dialogueLine: 'When a script line is spoken in this scene, quote it inside the paragraph exactly as: [CHARACTER] says: "the exact spoken line" — the script\'s words verbatim, [CHARACTER] only before "says", never inside the quotes. While speaking, [CHARACTER] should also be DOING or SHOWING what the line is about whenever the line allows it — telling while showing.',
  audioLine: 'the character\'s spoken voice plus the natural diegetic sound of the scene (room tone, fabric, taps).',
  voiceBlock: `\n\nAfter the last scene of the clip, add a blank line, then this block EXACTLY — repeat it word-for-word identical in every clip of this concept so all clips share one on-camera voice:
=== VOICE PROFILE (same voice in every clip) ===
VOICE — describe, in rich and reproducible detail, HOW the character sounds: perceived age and gender of the voice, accent / region, pitch, pace, texture (warm, raspy, breathy, smooth), energy, and 1-2 signature quirks (uptalk, slight vocal fry, a laugh living in the voice). One dense paragraph you could hand to a TTS engine and get the same person every time. Describe ONLY the sound, never appearance.`,
  deliveryNote: `DELIVERY — WITH DIALOGUE. This is an on-camera ad: [CHARACTER] speaks the script out loud. Each scene's paragraph states the line spoken in it, verbatim from the script, spread naturally across the scenes so nothing is dropped. Cutaway scenes (hands, product, environment) carry no spoken line of their own while the voice continues over them. Scene 1 opens on the hook line.`,
}

const SILENT_RULES = {
  dialogueLine: 'No one speaks in any scene — never write speech or mouthed words into a paragraph.',
  audioLine: 'the diegetic sound of the scene only (room tone, fabric, taps, streets) — no dialogue.',
  voiceBlock: '',
  deliveryNote: `DELIVERY — B-ROLL CLIPS. No one speaks in any scene: a finished voiceover is laid over this footage in the edit, and there is NO VOICE PROFILE block. Each scene SHOWS what the matching script beat says — the act happening, the metaphor made literal, the proof on screen, the reaction landing — never a person idling while the line plays. A viewer should be able to guess the beat from the footage alone.`,
}

function oneShotSystem(delivery: OneShotDelivery): string {
  const rules = delivery === 'dialogue' ? DIALOGUE_RULES : SILENT_RULES
  const sceneFields = SCENE_PARAGRAPH
    .replace('__DIALOGUE_RULE__', rules.dialogueLine)
    .replace('__AUDIO_RULE__', rules.audioLine)

  return `# ROLE

You are an elite UGC creative director. You turn a script into a complete, ready-to-generate video ad written as a scene-by-scene BLUEPRINT — the kind an AI video model (Seedance, Kling, Gemini) renders in ONE generation containing multiple internal cuts. You have shipped thousands of paid UGC ads. Everything you write must look like real, unpolished creator footage — the look of a phone camera, never the sight of one.

# YOUR JOB

Design ONE complete video concept for the user's script, following the creative angle they give you. The concept is delivered as one or more CLIPS (the user tells you exactly how many, and the length of each). Each clip is its own scene blueprint: cut it into internal scenes/shots and direct each as one flowing paragraph, per the format below. The clip's scene timestamps start at 00:00, are contiguous, and end at the clip's length.

# HOW TO WRITE A CLIP

This clip renders as ONE video with the cuts baked in — the model performs every scene transition internally, so direct it like a mini-edit, not one long take. Break the clip into several internal scenes/cuts, roughly one every 2-4 seconds: a ~15s clip is typically 4-6 distinct scenes, a ~10s clip 3-4, a ~6s clip 2-3. Only a very short clip is a single scene. Scene 1 is a pattern interrupt — motion, tension, or a face mid-reaction — never a calm establishing wide.

SHOW, DON'T TELL. Every scene must put the matching script beat's meaning ON SCREEN — the act happening, the claim's proof, a metaphor made literal (even absurdly: "tasted like cardboard" → a deadpan bite of actual cardboard) — so the viewer sees each sentence as they hear it. Never a scene of someone passively existing while a line plays.

Detail is what separates a winning clip from generic stock: name the exact prop, the exact body position and hand placement, the exact micro-expression, the real light source. Vague direction ("she looks happy", "nice lighting", "using the product") renders as generic footage — write each scene the way you'd describe a shot you already filmed. When in doubt, add specificity, not another scene. Keep each paragraph tight and readable.

Hold that depth all the way through: the last scene of the last clip gets the same detail as Scene 1, and a two-clip concept never thins out in clip 2. If a scene could describe two visually different shots, rewrite it.

Banned everywhere: "beautiful", "stunning", "modern", "clean", "minimalist", "aesthetic", "high quality", "professional", "vibe", "looking happy/sad/frustrated" (name what the face is actually doing), "using the product" (name the actual action). They describe nothing a model can render.

Every scene starts with a header EXACTLY in this form:
--- Scene N: <short label> (MM:SS-MM:SS) ---

${sceneFields}

${TOKENS_BLOCK}

${rules.deliveryNote}

# HARD RULES
- UGC realism is the whole aesthetic. Anything that reads as "commercial", "cinematic", "studio", or "polished" is a failure.
- [CHARACTER] looks like the after, not the before: no visible blemishes, frizz, redness, or tiredness — they are the testimonial, not the case study.
- Constant motion: every scene has movement in the frame or the subject. No locked-off still-life.
- [PRODUCT] appears only once the script has earned it — never in Scene 1 unless the script opens on it.
- No captions, subtitles, watermarks, or on-screen text of any kind.
- Specificity over completeness: exact body position, hand position, gaze, micro-expression, real light sources, real props. If a scene could describe two different shots, rewrite it.

# OUTPUT FORMAT (STRICT)

Wrap your answer in this exact XML envelope. No text outside the tags, no markdown fences. Each <PROMPT> body is the full scene blueprint for that clip: its scenes in order${delivery === 'dialogue' ? ', then the VOICE PROFILE block' : ''}.

<CONCEPT>
<ANGLE>2-4 word slug naming the creative angle</ANGLE>
<SUMMARY>ONE plain-language sentence a total non-expert can read to instantly picture how this ad looks and feels — name the shooting style in everyday words (e.g. "a selfie-style talking-head", "a get-ready-with-me morning montage", "a hands-only product demo", "an unboxing on camera") and the vibe. No insider jargon, no restating the product's benefits.</SUMMARY>
<SEGMENT_1>
<EXCERPT>the exact, verbatim script slice this clip covers</EXCERPT>
<PROMPT>
--- Scene 1: <label> (00:00-00:04) ---
One flowing paragraph directing this shot.

--- Scene 2: <label> (00:04-00:08) ---
...${delivery === 'dialogue' ? '\n\n=== VOICE PROFILE (same voice in every clip) ===\nVOICE — ...' : ''}
</PROMPT>
</SEGMENT_1>
(repeat <SEGMENT_N> for every clip requested, in order)
</CONCEPT>`
}

// [CHARACTER] / [PRODUCT] tokens keep the prompt readable and reference-driven
// while it's edited, but a video model reads them literally — so resolve them
// to plain words the instant before sending. Mirrors the Scripts→Playground
// @INFLUENCER / @PRODUCT resolution.
export function resolveOneShotTokens(prompt: string, productName?: string): string {
  return prompt
    .replace(/\[CHARACTER\]/gi, 'the character')
    .replace(/\[PRODUCT\]/gi, productName?.trim() || 'the product')
}

// Deliberately different UGC worlds — real alternatives, not flavours of one
// idea. The first four fan out on every generate; the rest feed the "Add
// variation" button so a fifth+ card is a genuinely fresh angle, not a repeat.
// The UGC counterpart of Scripts' WRITE_PROMPT_TAKE_INSTRUCTION.
const ONE_SHOT_ANGLES: string[] = [
  'THIS CONCEPT — DIRECT CONFESSION: straight-to-camera storytime energy. One location, the character close and personal, escalating intimacy as the script builds. The classic "okay I have to tell you about this" register.',
  'THIS CONCEPT — DAY IN THE LIFE: the script carried across a real routine — morning counter, commute, desk, evening wind-down. The product is met naturally mid-day, never presented. Movement between micro-moments gives the cuts.',
  'THIS CONCEPT — DEMO FIRST: hands and product do the talking. Close-in inserts, textures, the actual use of the thing, the visible result. The character orbits the demonstration rather than fronting it.',
  'THIS CONCEPT — REACTION & DISCOVERY: the character encountering the product or its result — skeptical first beat, the try, the genuine reaction. The arc is doubt → surprise → sold.',
  'THIS CONCEPT — PROBLEM / AGITATE / SOLVE: open on the frustration in vivid, specific detail, twist the knife a beat longer than feels comfortable, then let the product land as the release. The arc is pain → relief.',
  'THIS CONCEPT — UNBOXING / FIRST TRY: the parcel, the reveal, the very first use on camera narrated as it happens. Fresh-discovery energy, nothing rehearsed.',
  'THIS CONCEPT — TEXT-A-FRIEND: the register of telling one close friend about a find — casual, low-production, phone-propped-somewhere intimacy, "you genuinely need to try this".',
  'THIS CONCEPT — BEFORE / AFTER CONTRAST: cut hard between the old way and the new result, the product as the visible pivot between them.',
]

// How many angles the initial Generate fans out on. The rest of the pool is
// reserved for Add-variation.
const INITIAL_ANGLE_COUNT = 4

export interface OneShotInput {
  scriptText: string
  delivery: OneShotDelivery
  modelId: string
  productContext: string
  modelContext: string
  additionalContext: string
  // Visual-style pick shared with Continuous mode. `styleBrief` (distilled from
  // reference frames) overrides the preset `styleId` when present. Appended to
  // each clip prompt at fire time, not baked into the LLM blueprint.
  styleId: string
  styleBrief?: string
}

const MULTI_CLIP_RULE = `MULTIPLE CLIPS — THESE RENDER SEPARATELY BUT CUT TOGETHER INTO ONE AD. Clip 1 establishes the world; every later clip continues it seamlessly:
- Keep [CHARACTER]'s wardrobe and emotional continuity, the same location and time of day, and the same lighting across every clip — no wardrobe changes, no day→night jumps, no location moves unless the script demands one.
- Repeat the VOICE PROFILE block VERBATIM in every clip so all clips are read by the same voice.
- Each clip's scene timestamps restart at 00:00 (every clip renders independently).`

function buildUserPrompt(input: OneShotInput, plan: SegmentPlan, angle: string): string {
  const est = estimateSpokenSeconds(input.scriptText)
  const words = wordCount(input.scriptText)
  const perClipWords = Math.ceil(words / plan.count)
  const perClipSeconds = Math.min(plan.maxClipSeconds, Math.ceil(est / plan.count))

  let prompt = `Design one complete video concept for this script.\n\nScript:\n${input.scriptText}\n\n${angle}\n\n`

  if (plan.count === 1) {
    prompt += `CLIPS: this is ONE clip covering the whole script, ≈ ${Math.max(est, 4)}s long. Break it into internal scenes with contiguous timestamps from 00:00 to about ${Math.max(est, 4)}s. Output exactly one <SEGMENT_1> whose <EXCERPT> is the full script.\n`
  } else {
    prompt += `CLIPS: split the script into exactly ${plan.count} sequential clips at natural sentence boundaries — never mid-clause. Each clip is ≈ ${perClipSeconds}s (~${perClipWords} words) and holds its own internal scenes timestamped 00:00 to about ${perClipSeconds}s. Cover every script line across the clips; do not drop or compress anything. Output <SEGMENT_1> … <SEGMENT_${plan.count}> in script order.\n\n${MULTI_CLIP_RULE}\n`
  }
  if (plan.capped) {
    prompt += `NOTE: the script runs long for ${plan.count} clips — keep scene descriptions tight, but still cover every line.\n`
  }

  if (input.productContext) {
    prompt += `\n${input.productContext}\n`
  }
  if (input.modelContext) {
    prompt += `\n${input.modelContext}\nIMPORTANT: never describe the character's physical appearance. Refer to them as "the character" — a visual reference image will be attached to fix their exact look.\n`
  }
  if (input.additionalContext) {
    prompt += `\nAdditional context and instructions:\n${input.additionalContext}\n`
  }

  prompt += `\nWrite the full <CONCEPT> now.`
  return prompt
}

// ── Parser ─────────────────────────────────────────────────────

function extractTag(source: string, tag: string): string | null {
  const m = source.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

let conceptCounter = 0
function nextConceptId() {
  return `oneshot-${Date.now()}-${++conceptCounter}`
}

// Tolerant parse of one LLM response into a concept. Returns null only when
// nothing usable came back (treated as a failed call by the caller).
export function parseOneShotConcept(
  responseText: string,
  input: OneShotInput,
): OneShotConcept | null {
  const body = extractTag(responseText, 'CONCEPT') ?? responseText
  const angle = extractTag(body, 'ANGLE') ?? 'CONCEPT'
  const summary = extractTag(body, 'SUMMARY') ?? ''

  const segments: OneShotSegment[] = []
  for (let i = 1; i <= MAX_SEGMENTS; i++) {
    const seg = extractTag(body, `SEGMENT_${i}`)
    if (!seg) continue
    const prompt = extractTag(seg, 'PROMPT') ?? ''
    if (!prompt.trim()) continue
    const excerpt = extractTag(seg, 'EXCERPT') ?? ''
    segments.push({
      index: segments.length + 1,
      scriptExcerpt: excerpt,
      prompt: prompt.trim(),
      durationSeconds: 0, // filled below once excerpts are settled
    })
  }

  // No segment tags at all → treat the whole body as a single-segment prompt
  // (the model answered with a bare master prompt).
  if (segments.length === 0) {
    const bare = body.replace(/<[^>]+>/g, '').trim()
    if (!bare) return null
    segments.push({ index: 1, scriptExcerpt: input.scriptText, prompt: bare, durationSeconds: 0 })
  }

  // Missing excerpts get an even word split of the script so duration math
  // still has something honest to chew on.
  const missing = segments.filter((s) => !s.scriptExcerpt.trim())
  if (missing.length > 0) {
    const words = input.scriptText.trim().split(/\s+/)
    const per = Math.ceil(words.length / segments.length)
    segments.forEach((s, i) => {
      if (!s.scriptExcerpt.trim()) {
        s.scriptExcerpt = words.slice(i * per, (i + 1) * per).join(' ')
      }
    })
  }

  for (const s of segments) {
    s.durationSeconds = segmentDuration(s.scriptExcerpt, input.delivery, input.modelId)
  }

  return { id: nextConceptId(), angle, summary, segments }
}

// ── Entry point ────────────────────────────────────────────────

// One LLM call → one parsed concept for the given creative angle. Shared by
// the initial fan-out and the Add-variation button so both produce identical
// concept shapes.
async function generateConceptForAngle(
  apiKey: string,
  endpoint: string,
  system: string,
  input: OneShotInput,
  plan: SegmentPlan,
  angle: string,
): Promise<OneShotConcept | null> {
  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: system }] },
    { role: 'user', content: [{ type: 'text', text: buildUserPrompt(input, plan, angle) }] },
  ]
  const response = await kieChatCompletions(apiKey, endpoint, messages)
  const concept = parseOneShotConcept(response, input)
  // Stamp which pool angle produced this concept. `concept.angle` is the LLM's
  // own 2-4 word slug (it's what the row label shows), so it can't be matched
  // back against the pool — Add-variation needs this to know what's taken.
  return concept ? { ...concept, poolAngle: angle } : null
}

// Four parallel calls, one per creative angle — mirrors the cinematic
// pipeline's fan-out. Partial failures keep whatever parsed; only a total
// wipe-out throws (the first rejection's error, for humanizeError upstream).
export async function generateOneShot(input: OneShotInput): Promise<OneShotResult> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()

  const estimatedSeconds = estimateSpokenSeconds(input.scriptText)
  const plan = planSegments(estimatedSeconds, input.modelId)
  const system = oneShotSystem(input.delivery)

  const settled = await Promise.allSettled(
    ONE_SHOT_ANGLES.slice(0, INITIAL_ANGLE_COUNT).map((angle) =>
      generateConceptForAngle(apiKey, endpoint, system, input, plan, angle),
    ),
  )

  const concepts: OneShotConcept[] = []
  for (const result of settled) {
    if (result.status !== 'fulfilled' || !result.value) continue
    concepts.push(result.value)
  }

  if (concepts.length === 0) {
    const firstError = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    throw firstError ? firstError.reason : new Error('No concepts could be generated')
  }

  return {
    concepts,
    delivery: input.delivery,
    modelId: input.modelId,
    estimatedSeconds,
    segmentCount: plan.count,
    capped: plan.capped,
    // Style rides on the result and is appended to each clip's prompt at fire
    // time (added-variation concepts inherit it from this same result object).
    style: styleBriefFor({ styleId: input.styleId, styleBrief: input.styleBrief }),
    realism: styleUsesRealism(input.styleId, !!input.styleBrief?.trim()),
  }
}

// One more variation on demand (the grid's "Add variation" card). Picks the
// next unused angle from the pool so a fifth+ card is a fresh creative world,
// wrapping the pool if the user keeps adding. Planned against the SAME model
// the existing result used (passed in via input.modelId) so its clip split
// matches the other variations and they stay comparable.
export async function generateOneShotVariation(
  input: OneShotInput,
  // The pool angles already on screen. Indexing by COUNT instead meant a
  // partial fan-out (one of the initial four failing) left a gap, and the next
  // add landed on an angle the user could already see.
  usedAngles: string[],
  // Concepts on screen, including any predating `poolAngle`. Only used to place
  // legacy rows, where the pool angles aren't recorded.
  existingCount: number,
): Promise<OneShotConcept> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()
  const plan = planSegments(estimateSpokenSeconds(input.scriptText), input.modelId)
  const system = oneShotSystem(input.delivery)
  // A row generated before poolAngle existed reports nothing used — assume the
  // fan-out's own order (the first N of the pool), which is how it ran.
  const used = new Set(
    usedAngles.length > 0 ? usedAngles : ONE_SHOT_ANGLES.slice(0, existingCount),
  )
  const angle = ONE_SHOT_ANGLES.find((a) => !used.has(a))
    // Pool exhausted — wrap, which is the only way to keep adding.
    ?? ONE_SHOT_ANGLES[existingCount % ONE_SHOT_ANGLES.length]
  const concept = await generateConceptForAngle(apiKey, endpoint, system, input, plan, angle)
  if (!concept) throw new Error('Could not generate another variation')
  return concept
}

// ── Per-clip Enhance / Regenerate ──────────────────────────────
//
// Powers the blueprint toolbar in OneShotDetailModal (mirrors the Line-by-Line
// card's Enhance / Regenerate). Both return ONE clip's blueprint body — the
// scenes (+ VOICE PROFILE for dialogue) — with no <CONCEPT>/<SEGMENT> wrapper.

export interface ClipContext {
  angle: string
  excerpt: string
  delivery: OneShotDelivery
  productContext?: string
  modelContext?: string
}

const CLIP_ENVELOPE_NOTE =
  'Return ONLY this one clip\'s scene blueprint wrapped in a single <PROMPT>…</PROMPT> tag — no <CONCEPT>, no <SEGMENT>, no <ANGLE>, no text outside the tag.'

function clipContextBlock(ctx: ClipContext): string {
  let out = ''
  if (ctx.productContext) out += `\n${ctx.productContext}\n`
  if (ctx.modelContext) out += `\n${ctx.modelContext}\nIMPORTANT: never describe the character's physical appearance — use the token [CHARACTER]; a reference image fixes their look.\n`
  return out
}

// Extract the blueprint body from an LLM reply, tolerating a missing tag.
function extractPromptBody(responseText: string): string {
  const m = responseText.match(/<PROMPT>([\s\S]*?)<\/PROMPT>/i)
  const body = (m ? m[1] : responseText).trim()
  return body.replace(/<\/?(CONCEPT|SEGMENT_\d+|EXCERPT|ANGLE|SUMMARY|PROMPT)>/gi, '').trim()
}

export async function enhanceOneShotClip(currentPrompt: string, ctx: ClipContext): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()
  const system = oneShotSystem(ctx.delivery)
  const user = `Here is the scene blueprint for ONE clip of a UGC ad. Rewrite it to be MORE vivid while keeping the EXACT same format (same scene headers and timestamps, one flowing paragraph per scene${ctx.delivery === 'dialogue' ? ', the same VOICE PROFILE block' : ''}) and the same spoken lines. If a scene still uses labelled fields (SETTING:/CAMERA:/...), fold them into one readable paragraph. Sharpen every scene — more specific props, exact body position and hand placement, the real light source, precise micro-expressions, and a stronger show-don't-tell visual for the beat — without changing what happens or padding it with extra scenes.

Enhance means ADD DETAIL, not rephrase: every scene comes back richer than it went in. Never return a blueprint shorter than the one you were given.

CONCEPT ANGLE: ${ctx.angle}

Current blueprint:
${currentPrompt}
${clipContextBlock(ctx)}
${CLIP_ENVELOPE_NOTE}`
  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: system }] },
    { role: 'user', content: [{ type: 'text', text: user }] },
  ]
  return extractPromptBody(await kieChatCompletions(apiKey, endpoint, messages))
}

export async function regenerateOneShotClip(ctx: ClipContext): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()
  const system = oneShotSystem(ctx.delivery)
  const user = `Write a FRESH scene blueprint for ONE clip of a UGC ad in the concept angle below — a genuinely different take from any previous version, same script.

CONCEPT ANGLE: ${ctx.angle}

The exact script this clip covers (verbatim, spread across its scenes):
${ctx.excerpt}
${clipContextBlock(ctx)}
Break it into internal scenes with contiguous timestamps starting at 00:00. ${CLIP_ENVELOPE_NOTE}`
  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: system }] },
    { role: 'user', content: [{ type: 'text', text: user }] },
  ]
  return extractPromptBody(await kieChatCompletions(apiKey, endpoint, messages))
}

// ── Demo / preview data ────────────────────────────────────────
//
// Shown when no kie.ai key is set so a member (or the operator) can see what
// One Shot produces before wiring up billing. Real, plausible concepts for a
// hair-serum ad — a mix of single- and two-clip concepts so the split UI,
// "Generate all", and per-clip controls are all on screen. Durations snap to
// whatever model is selected, exactly like a live result, so the credit chips
// and duration badges look right.

interface DemoScene {
  label: string
  setting: string
  camera: string
  lighting?: string // continuation scenes reuse the clip's established light
  action: string
  spoken?: string // the on-camera line for this scene, dialogue delivery only
  audioTail?: string // extra diegetic sound for this scene
}

interface DemoSegmentSpec {
  excerpt: string
  scenes: DemoScene[]
}

interface DemoConceptSpec {
  angle: string
  summary: string
  voice: string // reused verbatim across a concept's clips (dialogue only)
  segments: DemoSegmentSpec[]
}

function fmtTs(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Build a scene-blueprint prompt for one demo clip: distribute the clip's
// duration evenly across its scenes, stamp contiguous timestamps, and append
// the VOICE PROFILE block for dialogue clips. One flowing paragraph per scene,
// matching the live format.
function assembleDemoPrompt(spec: DemoSegmentSpec, voice: string, delivery: OneShotDelivery, durationSeconds: number): string {
  const n = spec.scenes.length
  const step = durationSeconds / n
  const blocks = spec.scenes.map((sc, i) => {
    const start = fmtTs(Math.round(i * step))
    const end = fmtTs(i === n - 1 ? durationSeconds : Math.round((i + 1) * step))
    const sentences = [sc.setting, sc.camera]
    if (sc.lighting) sentences.push(sc.lighting)
    sentences.push(sc.action)
    if (delivery === 'dialogue' && sc.spoken) {
      sentences.push(`[CHARACTER] says: "${sc.spoken}"`)
    }
    sentences.push(
      delivery === 'dialogue'
        ? `The only sound is the character's voice and soft room tone${sc.audioTail ? ` (${sc.audioTail})` : ''} — no music.`
        : `The only sound is the room itself${sc.audioTail ? ` (${sc.audioTail})` : ''} — no dialogue, no music, no voiceover.`,
    )
    return `--- Scene ${i + 1}: ${sc.label} (${start}-${end}) ---\n${sentences.join(' ')}`
  })
  let out = blocks.join('\n\n')
  if (delivery === 'dialogue') {
    out += `\n\n=== VOICE PROFILE (same voice in every clip) ===\nVOICE — ${voice}`
  }
  return out
}

const DEMO_CONCEPTS: DemoConceptSpec[] = [
  {
    angle: 'DIRECT CONFESSION',
    summary: 'A selfie-style talking-head — she speaks straight to the phone the whole time, like she\'s telling a close friend about something she loves.',
    voice: 'Warm mid-pitch female voice, late twenties, light American accent, unhurried and conversational with a small laugh living just under the words and a habit of trailing off softly at the end of a thought.',
    segments: [
      {
        excerpt: 'I used to spend two hours every morning fighting my frizzy hair — then my sister left this little bottle at my place.',
        scenes: [
          {
            label: 'Confession',
            setting: 'A real lived-in bathroom, morning, a toothbrush cup and a folded towel on the counter.',
            camera: 'Medium close-up on [CHARACTER], framed from just below chin height about an arm\'s length away, tilted slightly up. Natural handheld drift. Modern iPhone camera quality, sharp across the frame, zero bokeh.',
            lighting: 'Soft daylight through a frosted window camera-left, one warm bulb over the mirror. Naturalistic, no glam.',
            action: '[CHARACTER] leans toward the mirror, pushes a hand back through damp hair, lets out a tired little breath.',
            spoken: 'I used to spend two hours every morning fighting this hair.',
            audioTail: 'a running tap in the next room',
          },
          {
            label: 'The bottle',
            setting: 'Same counter, [PRODUCT] sitting by the sink.',
            camera: 'Tighter insert from chest height as the hand comes into frame; slight push-in. Handheld.',
            action: '[CHARACTER] picks up [PRODUCT], turns it once in the light, a small resigned smile building.',
            spoken: 'Then my sister left this at my place.',
            audioTail: 'the soft set-down of glass on stone',
          },
        ],
      },
    ],
  },
  {
    angle: 'DAY IN THE LIFE',
    summary: 'A get-ready-with-me morning montage — quick cuts between real moments (sink, mirror, desk) with the product woven in naturally.',
    voice: 'Warm mid-pitch female voice, late twenties, light American accent, easy and bright, clipped consonants, a smile you can hear.',
    segments: [
      {
        excerpt: 'Thirty seconds after rinsing I could run my fingers through my hair without snagging once.',
        scenes: [
          {
            label: 'At the sink',
            setting: 'Over the bathroom sink, morning, water running.',
            camera: 'Close insert from chest height looking down at the hands and hair. Handheld. iPhone quality, sharp, no bokeh.',
            lighting: 'Flat daylight from the window, natural.',
            action: '[CHARACTER] rinses, squeezes the water out, breathes in.',
            spoken: 'Thirty seconds after rinsing,',
            audioTail: 'running water, the squeak of wet hair',
          },
          {
            label: 'The finger-run',
            setting: 'Same sink, [CHARACTER] straightening up to the mirror.',
            camera: 'Step back to a waist-up, eye level, handheld with a slow drift.',
            action: '[CHARACTER] runs fingers cleanly from root to tip, eyebrows lifting in surprise.',
            spoken: 'I could run my fingers right through it without snagging once.',
            audioTail: 'a soft laugh',
          },
        ],
      },
      {
        excerpt: 'Three weeks in and people at work keep asking what I changed.',
        scenes: [
          {
            label: 'Office kitchen',
            setting: 'A bright office kitchen, a coworker nearby filling a mug.',
            camera: 'Medium from eye level across the counter, a slight rack toward [CHARACTER]. Handheld.',
            lighting: 'Overhead office light softened by a big window. Natural.',
            action: '[CHARACTER] fills a mug; a coworker gestures at their hair; [CHARACTER] laughs and touches it, shrugging.',
            spoken: 'Three weeks in and people keep asking what I changed.',
            audioTail: 'kitchen chatter, a kettle',
          },
        ],
      },
    ],
  },
  {
    angle: 'DEMO FIRST',
    summary: 'A hands-and-product close-up demo — tight shots of the actual routine and the visible result, barely showing her face.',
    voice: 'Warm mid-pitch female voice, calm and instructional, unrushed, a touch of vocal fry at the end of lines.',
    segments: [
      {
        excerpt: 'One pump, smooth it through damp hair, and that\'s the whole routine.',
        scenes: [
          {
            label: 'One pump',
            setting: 'A countertop, top-down, [PRODUCT] and a folded towel in frame.',
            camera: 'Overhead macro on the open palm. Tight, handheld. iPhone quality, sharp across the frame.',
            lighting: 'Bright even daylight from above. Natural.',
            action: 'A hand presses one pump of [PRODUCT] into the palm, then rubs the hands together.',
            spoken: 'One pump,',
            audioTail: 'the click of the pump',
          },
          {
            label: 'Smoothing through',
            setting: 'Same counter, [CHARACTER] now leaning toward the mirror.',
            camera: 'Three-quarter in-hand shot from the side as the hands go into the hair. Handheld.',
            action: '[CHARACTER] smooths the product through the mid-lengths, then sets [PRODUCT] back down.',
            spoken: 'smooth it through, and that\'s the whole routine.',
            audioTail: 'the soft set-down of the bottle',
          },
        ],
      },
    ],
  },
  {
    angle: 'REACTION & DISCOVERY',
    summary: 'A skeptic-to-believer arc — she doubts it on camera, tries it, and you watch her genuinely change her mind.',
    voice: 'Warm mid-pitch female voice, dry and a little skeptical at first, opening up as it goes, a real laugh on the turn.',
    segments: [
      {
        excerpt: 'Honestly I didn\'t think a twelve dollar serum would do anything.',
        scenes: [
          {
            label: 'The doubt',
            setting: 'Sitting on the edge of a bed, [PRODUCT] in hand.',
            camera: 'Medium from chest height, an arm\'s length away, tilted very slightly up. Handheld.',
            lighting: 'Warm bedroom lamp plus soft window light. Natural.',
            action: '[CHARACTER] holds [PRODUCT] up doubtfully, reads the label, one eyebrow raised, glances at the lens.',
            spoken: 'Honestly? I didn\'t think a twelve dollar serum would do anything.',
            audioTail: 'quiet bedroom room tone',
          },
        ],
      },
      {
        excerpt: 'Grab one before they sell out again.',
        scenes: [
          {
            label: 'The reveal',
            setting: 'Back at the bathroom mirror, hair now smooth and finished.',
            camera: 'Medium close-up from eye level, a step back, handheld.',
            lighting: 'Soft daylight from the window. Natural.',
            action: '[CHARACTER] runs a hand down the smooth finished hair, a genuine surprised smile breaking.',
            spoken: 'Okay, I get it now.',
            audioTail: 'a soft delighted exhale',
          },
          {
            label: 'Sign-off',
            setting: 'Same mirror, [PRODUCT] lifted beside the face.',
            camera: 'Holds the medium close-up, [CHARACTER] bringing [PRODUCT] up beside their cheek. Handheld.',
            action: '[CHARACTER] lifts [PRODUCT] beside their cheek and gives a small nod to the lens.',
            spoken: 'Grab one before they sell out again.',
            audioTail: 'room tone',
          },
        ],
      },
    ],
  },
]

export function buildDemoOneShotResult(modelId: string, delivery: OneShotDelivery): OneShotResult {
  const durations = getModel(modelId)?.videoConstraints?.durations ?? []
  const buffer = delivery === 'dialogue' ? 1.1 : 1
  let stamp = 0
  const concepts: OneShotConcept[] = DEMO_CONCEPTS.map((spec) => ({
    id: `demo-${++stamp}`,
    angle: spec.angle,
    summary: spec.summary,
    segments: spec.segments.map((seg, i) => {
      const raw = Math.max(2, Math.ceil((wordCount(seg.excerpt) / WORDS_PER_SECOND) * buffer))
      const durationSeconds = durations.length > 0 ? snapVideoDurationUp(raw, durations) : raw
      return {
        index: i + 1,
        scriptExcerpt: seg.excerpt,
        prompt: assembleDemoPrompt(seg, spec.voice, delivery, durationSeconds),
        durationSeconds,
      }
    }),
  }))
  // One ad's length — the first concept's clip run, matching the header quote
  // (which is reconstructed from that concept's excerpts). Summing ALL concepts
  // would report ~4× the real ad length in the header.
  const estimatedSeconds = concepts[0]?.segments.reduce((s, seg) => s + seg.durationSeconds, 0) ?? 0
  return {
    concepts,
    delivery,
    modelId,
    estimatedSeconds,
    segmentCount: concepts[0]?.segments.length ?? 1,
    demo: true,
  }
}
