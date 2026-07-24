// Continuous mode: keyframe-chain ads (the Zack D Films register). One LLM call
// turns the script into a STORYBOARD — N narration scenes plus N+1 keyframes,
// where keyframe N+1 is simultaneously scene N's end state and scene N+1's start
// state. Each keyframe ships as several distinct visual CONCEPTS the user picks
// from (images are cheap; video credits only burn once the chain is locked).
// Clips are frames-to-video generations: first frame = chosen keyframe N, last
// frame = chosen keyframe N+1, prompt = the scene's motion + SFX.
//
// Style is storyboard-wide and rides OUTSIDE the editable prompts (appended at
// fire time by buildContinuousPrompt) so it can't drift frame to frame. Every
// style except UGC Realism bypasses the app's deterministic iPhone-realism
// stack — "unedited photorealism, zero bokeh" actively fights a 3D render.

import type { ContinuousConcept, ContinuousFrame, ContinuousResult, ContinuousScene } from '../types'
import { useSettingsStore } from '../../../stores/settingsStore'
import { kieChatCompletions, type ChatMessage } from '../../../utils/kie'
import { getChatEndpointPath, getModel, snapVideoDurationUp } from '../../../utils/models'

// Models LISTED in the Continuous picker. The whole mode is first/last-frame
// interpolation, so only frames-to-video models are actually selectable — the
// panel greys the rest via requireMode='frames-to-video' so the user can see
// (and understand) why they're unavailable. Image-only (Kling Turbo) and
// frame-less (Gemini Omni, Grok) models are listed but land greyed.
// Seedance 1.5 Pro is the default — first/last-frame native and materially
// cheaper per clip than the 2.0 family, at a quality that holds up for this
// style. The picker lives in the CLIP modal, not the left panel: the model
// only matters once there are keyframes to animate.
export const CONTINUOUS_MODEL_IDS = [
  'bytedance/seedance-2',
  'bytedance/seedance-2-fast',
  'bytedance/seedance-2-mini',
  'bytedance/seedance-1.5-pro',
  'kling-3.0/video',
  'grok-imagine-video-1-5-preview',
  'veo3_fast',
  'veo3_lite',
  'veo3',
  'wan/2-7',
  'kling/v3-turbo-image-to-video',
  'gemini-omni-video',
]

export const CONTINUOUS_DEFAULT_MODEL_ID = 'bytedance/seedance-1.5-pro'

// How many visual concepts each keyframe fans out into. More live in the
// per-frame "Add concept" button.
export const CONCEPTS_PER_FRAME = 3

// ~2.4 words/sec narration pace — same assumption as Scripts / One-Shot.
const WORDS_PER_SECOND = 2.4

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// Clip length for one scene's narration slice. These clips are quick, punchy
// beats — floor at 3s so a five-word line still gets a real transition.
export function sceneDuration(scriptLine: string, modelId: string): number {
  const durations = getModel(modelId)?.videoConstraints?.durations ?? []
  const raw = Math.max(3, Math.ceil(wordCount(scriptLine) / WORDS_PER_SECOND))
  return durations.length > 0 ? snapVideoDurationUp(raw, durations) : raw
}

// ── Visual styles ──────────────────────────────────────────────
// The preset seeds the LLM's STYLE block; the LLM adapts it to the product and
// script. The chain mechanic works for any aesthetic — 3D is just the default.

export interface ContinuousStyle {
  id: string
  label: string
  hint: string
  // True only for the live-action UGC style: it KEEPS the app's deterministic
  // iPhone-realism stack switched on. Every stylized style bypasses it.
  realism?: boolean
}

export const CONTINUOUS_STYLES: ContinuousStyle[] = [
  {
    id: 'zack-3d',
    label: '3D Animated',
    hint: 'Glossy stylized 3D render in the viral explainer register: soft rounded character shapes with slightly exaggerated proportions, vivid saturated colors, clean smooth surfaces, soft volumetric lighting with gentle rim light, high-detail render like a premium animated short. Never photoreal, never live-action.',
  },
  {
    id: 'clay',
    label: 'Claymation',
    hint: 'Handcrafted stop-motion claymation: visible fingerprints and tool marks in the clay, slightly imperfect handmade shapes, miniature-set depth, warm practical lighting on a physical diorama.',
  },
  {
    id: 'paper',
    label: 'Papercraft',
    hint: 'Layered paper-cutout diorama: crisp cut edges, subtle drop shadows between paper layers, flat colors with visible paper texture, everything staged like a handmade pop-up book scene.',
  },
  {
    id: 'anime',
    label: 'Anime',
    hint: 'Clean 2D anime cel style: bold linework, flat cel shading with two-tone shadows, expressive faces, painterly backgrounds with soft light bloom.',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    hint: 'Photoreal cinematic live-action: filmic color grade, shallow-but-controlled depth, deliberate camera language, commercial-grade art direction. Polished on purpose — the one style where gloss is the goal.',
  },
  {
    id: 'ugc',
    label: 'UGC Realism',
    hint: 'Real, unpolished creator footage shot on a modern phone: casual unstaged framing, natural available light from a real source, zero bokeh and sharp focus across the frame, no colour grade and no commercial gloss. The look of a phone camera, never the sight of one — never name or show a phone, camera, tripod, or ring light anywhere in frame, and never stage a mirror selfie. People look like they just decided to film this.',
    realism: true,
  },
]

export function getContinuousStyle(id: string): ContinuousStyle {
  return CONTINUOUS_STYLES.find((s) => s.id === id) ?? CONTINUOUS_STYLES[0]
}

// Whether this storyboard keeps the app-wide iPhone-realism suffix. A style
// analysed from reference images is stylized by assumption — the user picks
// UGC Realism explicitly when they want the live-action stack.
export function styleUsesRealism(styleId: string, hasCustomBrief: boolean): boolean {
  if (hasCustomBrief) return false
  return getContinuousStyle(styleId).realism === true
}

// ── Style from reference images ────────────────────────────────
// The user drops in frames of an ad whose look they want. A vision pass distils
// the AESTHETIC ONLY — never the subjects, products, or scenes in them — into a
// STYLE paragraph that then drives every keyframe and clip.

const STYLE_ANALYSIS_SYSTEM = `You are an art director reverse-engineering a visual style from reference frames.

Your ONLY job is to describe HOW these images look, never WHAT is in them. Your output is appended to unrelated image and video prompts for a completely different script, so any subject matter you carry over is a bug: no characters, no products, no locations, no story, no specific objects from these references.

Describe, in ONE dense paragraph of 90-150 words:
- MEDIUM & RENDER: the technique (3D render, 2D cel animation, claymation, papercraft, live-action photography, mixed media), how stylized vs photoreal it is, surface quality (glossy, matte, grainy, painterly), and the apparent render engine or film-stock character.
- FORMS: how shapes and figures are treated — proportions (realistic vs exaggerated), edge quality (hard linework, soft rounded, cut-paper crisp), geometric detail level, texture density.
- PALETTE: the actual dominant colours and their relationships (name the colours; never just "vibrant"), saturation, contrast, and any consistent grade or tint.
- LIGHT: the lighting register — sources, softness, direction tendencies, rim and volumetric effects, shadow depth, bloom or haze.
- CAMERA & FINISH: typical framing and lens character, depth-of-field behaviour, grain or noise, and any post treatment (vignette, chromatic aberration, halation).

Write it as direct style direction an image model can act on, present tense, one flowing paragraph. Name concrete visual qualities, never vague praise ("beautiful", "high quality", "professional"). If the references disagree, describe the dominant look and ignore the outlier.

Output ONLY the paragraph. No preamble, no headings, no bullets, no markdown.`

// `images` are data URIs (the uploader converts on attach). Returns the style
// paragraph, which replaces the preset hint for this storyboard.
export async function analyzeStyleReferences(images: string[]): Promise<string> {
  if (images.length === 0) throw new Error('Attach at least one reference image first.')
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: STYLE_ANALYSIS_SYSTEM }] },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Describe the visual STYLE shared by ${images.length === 1 ? 'this reference frame' : `these ${images.length} reference frames`}. Style only — carry over no subjects, products, locations, or story from the images.`,
        },
        ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ],
    },
  ]

  const responseText = await kieChatCompletions(apiKey, endpoint, messages, {
    timeoutMs: 180_000,
    reasoningEffort: 'high',
  })
  const cleaned = responseText.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()
  if (!cleaned) throw new Error('The style analysis came back empty. Try again.')
  return cleaned
}

// ── Prompt assembly at fire time ───────────────────────────────

// Final image/video prompt: the editable scene text plus the storyboard-wide
// style block. The style rides OUTSIDE the editable prompt so the cards stay
// readable and the style can't drift per-frame.
export function buildContinuousPrompt(editable: string, style: string): string {
  const trimmed = editable.trim()
  if (!style.trim()) return trimmed
  return `${trimmed}\n\nSTYLE: ${style.trim()}`
}

// Fire-time style treatment for Line-by-Line and One-Shot results (the shared
// counterpart of buildContinuousPrompt). Only an explicitly stylized look
// (realism === false — e.g. 3D Animated, Anime, or a custom brief distilled
// from reference frames) actually restyles the render: its STYLE block is
// appended to the prompt and the app's iPhone-realism stack is switched off (the
// two fight each other). UGC Realism (realism === true) and legacy results
// (realism undefined) are left exactly as before — same prompt, realism stack on
// — so today's default output is unchanged until a style is picked. Kept in one
// place so all three modes stay consistent.
export function applyStyleToPrompt(
  editablePrompt: string,
  style: { style?: string; realism?: boolean } | null | undefined,
): { prompt: string; noRealism: boolean } {
  const stylized = !!style && style.realism === false && !!style.style?.trim()
  if (!stylized) return { prompt: editablePrompt, noRealism: false }
  return { prompt: `${editablePrompt.trim()}\n\nSTYLE: ${style!.style!.trim()}`, noRealism: true }
}

// Reference preamble for keyframe image generation. The chain reference (the
// previous frame's chosen keyframe) is the character-lock protocol: it fixes
// style/character/environment continuity without inheriting composition.
export function buildContinuousPreamble(opts: { chain: boolean; character: boolean; product: boolean; extras: number }): string {
  const parts: string[] = []
  if (opts.chain) {
    parts.push(
      'The FIRST attached image is the previous keyframe of this same sequence. Maintain its exact art style, rendering technique, character design, colour palette, material language, and environment continuity — this new frame must look like the very next moment of the same film. Do NOT copy its composition, camera angle, or framing: build the new shot entirely from the scene description below.',
    )
  }
  if (opts.character) {
    parts.push("Match the character's face, hair, and wardrobe to the character reference image, translated faithfully into the sequence's art style.")
  }
  if (opts.product) {
    parts.push("Match the product's shape, label text, and colours exactly to the product reference image, translated into the sequence's art style.")
  }
  if (opts.extras > 0) {
    parts.push('Any remaining attached images are additional appearance references — use them for identity and detail only, never for composition.')
  }
  if (parts.length === 0) return ''
  return `REFERENCE USAGE — ${parts.join(' ')}`
}

// ── Prompt formats ─────────────────────────────────────────────
//
// One flowing paragraph each, matching Line-by-Line and One-Shot: the labelled
// multi-field structure these used to carry read disjointed and crowded out the
// actual idea. Keyframes keep one extra requirement the clip modes don't need —
// an explicit safe-zone framing note, because 9:16 platform UI overlays the
// frame edges and a keyframe that crops is unusable as a chain anchor.

const KEYFRAME_FORMAT = `Every keyframe prompt is ONE flowing paragraph — usually 50-90 words, longer when the idea needs it. Plain, concrete, readable — no labels, no field names, no line breaks, no "Style:" trailer.

Write it like you're describing a still you're looking at right now: what's in frame and in what state (the exact pose, hand position, gaze, and the expression as a real muscle action — "brows drawn together, jaw set", never "looking sad"), the actual space and the two or three specific props that sell it, where the light comes from and its colour, and the materials and textures that make it feel rendered rather than sketched. If there's no character, the hero object and its exact orientation carry the frame.

Always state the framing: the shot size (macro / close-up / medium / wide / overhead / aerial), roughly where the camera sits, and — this one is non-negotiable — that the subject is centred with comfortable margins so nothing crucial touches the frame edge. Platform UI overlays the edges of a vertical 9:16 video.

Never name the art style, medium, or render technique — the style block is appended separately to every prompt. No captions, subtitles, watermarks, on-screen text, logos, or UI of any kind.`

const MOTION_FORMAT = `Every motion prompt is ONE short flowing paragraph — usually 35-60 words. No labels, no field names.

Describe ONLY the motion that LEAVES this exact start frame: what in the frame begins to move and in which direction, as a vector ("lifts up and back", "rotates open clockwise", "collapses inward"), the transformation as it starts happening ("the powder begins to spill and dissolve"), then how the camera itself moves — push in, pull back, orbit left, tilt down, track alongside, or hold steady — and how fast. End with one transitional sound direction (a soft whoosh, a low building rumble, a gentle pop, or silence).

CRITICAL — describe the DEPARTURE, never the destination. The end frame is handed to the video model as a fixed last image, so where the clip lands is already locked. If you describe the end composition in words, the model races there and freezes early, killing the middle of the clip. So never paint the end tableau, the final pose, or the arrival state — write only the movement outward from this start frame, present tense, as motion in progress.

Keep it physical and simple — this is interpolation direction for one specific staging, not a new scene. Never write dialogue, narration, or music; a voiceover and a music bed are added later in the edit.`

// ── The storyboard system prompt ───────────────────────────────

const CONTINUOUS_SYSTEM = `# ROLE

You are the creative director of viral explainer ads — the Zack D Films register: short vertical videos that feel like ONE continuous, morphing shot. You storyboard in keyframes: every narration line gets a start image, the next line's image is simultaneously this line's end state, and a video model interpolates the motion between each pair. Because clip N literally ends on clip N+1's first frame, the cuts are invisible.

# YOUR JOB

Turn the user's script into a STORYBOARD:

1. Split the script into narration SCENES (complete sentences — never cut mid-clause; merge any fragment of four words or fewer forward into the next sentence).
2. For every scene, design its START keyframe. After the last scene, design one FINAL keyframe (the end state the last clip lands on). So there is always exactly ONE more frame than there are scenes.
3. Give every keyframe ${CONCEPTS_PER_FRAME} distinct visual CONCEPTS.
4. For every CONCEPT of every non-final keyframe, write the MOTION that animates THAT specific staging forward into the next beat. Motion belongs to the staging, not the scene — a wide aerial and a macro close-up of the same beat move differently, so each concept gets its own departure motion. Final-frame concepts get NO motion (nothing leaves the last frame).

# SHOW, DON'T TELL — THIS IS THE WHOLE JOB

Each narration line will be HEARD over the footage. The frames must SHOW what the line means — never a person passively existing while the line plays. Find the strongest image inside the line and put it on screen:

- If the line contains a metaphor, comparison, or vivid image, MAKE IT LITERAL — even when it's absurd. The absurdity is what stops the scroll. "Your brain runs a cleanup cycle at night" → a glowing factory inside the skull, tiny drones sweeping the walkways. "My skin felt like sandpaper" → fingertips dragging across a real sheet of sandpaper.
- If the line describes an act, show the act actually happening — mid-motion, hands busy, real.
- If the line makes a claim, show the evidence.
- If the line is emotional, show the emotion landing inside a real moment — never a face in a void.

When the script names the product, the product IS the visual. A viewer watching with the sound off should be able to guess the narration.

# SPECIFICITY

Vague direction renders as generic footage. Every frame names the exact prop, the exact body and hand position, the exact expression, the real light source, and the actual material. Write each keyframe the way you'd describe a still you're looking at, not the way you'd pitch it. If a prompt could describe two visually different images, it isn't finished — add specificity, never another scene. Keep each paragraph tight and readable.

Banned everywhere: "beautiful", "stunning", "modern", "clean", "minimalist", "high quality", "professional", "cinematic vibe", "looking happy/sad/frustrated" (name what the face is actually doing), "using the product" (name the actual action).

# KEYFRAME RULES

- Each keyframe is a single striking image: one clear subject, one readable idea. If a frame needs a sentence of explanation to work, simplify the idea — then describe the simpler idea in full detail.
- SAFE FRAMING: vertical 9:16 with platform UI overlaying the edges — keep the subject centred with comfortable margins, never so zoomed that crucial elements touch the frame edge.
- CONTINUITY IS EVERYTHING: consecutive keyframes must read as two moments of the same world. Same character design, same palette, same environment unless the story moves. Frame N+1 must be a state that frame N can physically morph or move into.
- Refer to the on-screen person as "the character" and the product as "the product" — reference images fix their exact look. Never describe the character's identity (gender, age, ethnicity, hair colour, skin tone); pose, expression, gesture, and body language ARE required.
- Gender-neutral language only: never he/him/his/she/her, never "subject". Use "the character" or "they/them/their".
- Never mention the art style, medium, or render technique inside a frame prompt — the style is appended separately.

# KEYFRAME PROMPT FORMAT (EVERY CONCEPT)

${KEYFRAME_FORMAT}

# CONCEPT VARIATIONS

The ${CONCEPTS_PER_FRAME} concepts for one keyframe are ${CONCEPTS_PER_FRAME} genuinely DIFFERENT ideas for picturing that same story state — a different visual metaphor, a different subject, a different scale — not one idea framed three ways. A macro close-up, a wide aerial, and an inside-the-object view of the same beat. Whichever concept the user picks, the sequence must still connect: every concept of frame N must work as the end of frame N-1's motion. Each concept carries its OWN departure motion, matched to its staging. Every concept gets the same depth on both the frame and its motion; a thinner alternative is a failure.

# MOTION PROMPT FORMAT (EVERY SCENE)

${MOTION_FORMAT}

# OUTPUT FORMAT (STRICT)

Wrap your answer in this exact XML envelope. No text outside the tags, no markdown fences.

<STORYBOARD>
<STYLE>One dense paragraph of 90-150 words locking the visual style for the whole sequence — medium and rendering technique, how forms and figures are treated, the named colour palette, the lighting register, and the camera/finish character. Adapt the style brief you are given to this specific script and product. This paragraph is appended verbatim to every image and video prompt, so it must be pure style direction with no subject matter in it.</STYLE>
<SCENE_1>
<LINE>exact narration slice, a complete sentence</LINE>
<FRAME>
<CONCEPT_1>
<LABEL>2-4 word slug naming the actual idea, e.g. INSIDE THE BOTTLE</LABEL>
<PROMPT>one flowing paragraph — the still, described</PROMPT>
<MOTION>one short paragraph: how THIS staging animates forward — what moves and where, how the camera moves, then the transitional sound. Departure only, never the end state.</MOTION>
</CONCEPT_1>
<CONCEPT_2>a DIFFERENT idea for the same story state, same depth, with its OWN matched MOTION</CONCEPT_2>
<CONCEPT_3>a DIFFERENT idea again, same depth, with its OWN matched MOTION</CONCEPT_3>
</FRAME>
</SCENE_1>
(repeat <SCENE_N> for every scene, in script order)
<FINAL_FRAME>
<CONCEPT_1>
<LABEL>2-4 word slug</LABEL>
<PROMPT>one flowing paragraph — the still, described (NO motion; nothing leaves the final frame)</PROMPT>
</CONCEPT_1>
<CONCEPT_2>...</CONCEPT_2>
<CONCEPT_3>...</CONCEPT_3>
</FINAL_FRAME>
</STORYBOARD>`

export interface ContinuousInput {
  scriptText: string
  styleId: string
  // Style paragraph distilled from the user's reference images. When present it
  // replaces the preset hint entirely.
  styleBrief?: string
  modelId: string
  productContext: string
  modelContext: string
  additionalContext: string
}

// The style paragraph a mode fires with: the reverse-engineered reference brief
// when the user supplied one, otherwise the selected preset's hint. Shared by
// all three modes (structural type so each mode's own input satisfies it).
export function styleBriefFor(input: { styleId: string; styleBrief?: string }): string {
  return input.styleBrief?.trim() || getContinuousStyle(input.styleId).hint
}

function buildUserPrompt(input: ContinuousInput): string {
  let prompt = `Storyboard this script as a keyframe-chain ad.\n\nScript:\n${input.scriptText}\n\nSTYLE BRIEF (adapt into the <STYLE> block): ${styleBriefFor(input)}\n`
  if (input.styleBrief?.trim()) {
    prompt += `\nThat style brief was reverse-engineered from reference frames the user supplied. Honour it exactly — it outranks any default look you would otherwise reach for.\n`
  }
  if (input.productContext) prompt += `\n${input.productContext}\n`
  if (input.modelContext) {
    prompt += `\n${input.modelContext}\nIMPORTANT: never describe the character's physical appearance — say "the character"; a reference image fixes their look.\n`
  }
  if (input.additionalContext) prompt += `\nAdditional context and instructions:\n${input.additionalContext}\n`
  prompt += `\nWrite the full <STORYBOARD> now. Every keyframe concept gets the same depth — no thinning out on the later scenes.`
  return prompt
}

// ── Parser ─────────────────────────────────────────────────────

function extractTag(source: string, tag: string): string | null {
  const m = source.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

// Strip straggler control tags from a prompt body so a misformed response never
// pastes raw XML into an editable field.
function cleanPromptBody(text: string): string {
  return text
    .replace(/<LABEL>[\s\S]*?<\/LABEL>/gi, '')
    .replace(/<\/?(STORYBOARD|SCENE_\d+|CONCEPT_\d+|FINAL_FRAME|FRAME|PROMPT|LABEL|LINE|MOTION|STYLE)>/gi, '')
    .trim()
}

let idCounter = 0
function nextConceptId(): string {
  return `cont-${Date.now()}-${++idCounter}`
}

const MAX_SCENES = 40

function parseConcepts(frameBlock: string): ContinuousConcept[] {
  const concepts: ContinuousConcept[] = []
  for (let j = 1; j <= CONCEPTS_PER_FRAME + 2; j++) {
    const block = extractTag(frameBlock, `CONCEPT_${j}`)
    if (!block) continue
    // Read MOTION before cleaning the block, then strip the whole concept down to
    // its PROMPT body (falling back to the block minus its control tags).
    const motion = cleanPromptBody(extractTag(block, 'MOTION') ?? '')
    const promptRaw = extractTag(block, 'PROMPT') ?? block
    const prompt = cleanPromptBody(promptRaw)
    if (!prompt) continue
    concepts.push({
      id: nextConceptId(),
      label: extractTag(block, 'LABEL') ?? `Option ${concepts.length + 1}`,
      prompt,
      ...(motion ? { motionPrompt: motion } : {}),
    })
  }
  return concepts
}

// Tolerant parse of the storyboard response. Returns null only when nothing
// usable came back.
export function parseContinuousResult(responseText: string, input: ContinuousInput): ContinuousResult | null {
  const body = extractTag(responseText, 'STORYBOARD') ?? responseText
  const style = extractTag(body, 'STYLE') ?? styleBriefFor(input)

  const scenes: ContinuousScene[] = []
  const frames: ContinuousFrame[] = []
  for (let i = 1; i <= MAX_SCENES; i++) {
    const sceneBlock = extractTag(body, `SCENE_${i}`)
    if (!sceneBlock) break
    const line = extractTag(sceneBlock, 'LINE') ?? ''
    const frameBlock = extractTag(sceneBlock, 'FRAME') ?? sceneBlock
    const concepts = parseConcepts(frameBlock)
    if (concepts.length === 0) continue
    frames.push({ index: frames.length + 1, concepts })
    // Motion now rides on each concept (per-staging departure motion). The scene
    // keeps a motionPrompt only as a fallback seed for the clip — the first
    // concept's motion — plus a tolerance read of a scene-level <MOTION>/<SFX>
    // for older or looser responses that put it outside the concepts.
    const conceptMotion = concepts.find((c) => c.motionPrompt?.trim())?.motionPrompt ?? ''
    const sceneMotion = conceptMotion || cleanPromptBody(extractTag(sceneBlock, 'MOTION') ?? '')
    scenes.push({
      index: scenes.length + 1,
      scriptLine: line,
      motionPrompt: sceneMotion,
      sfx: extractTag(sceneBlock, 'SFX') ?? '',
      durationSeconds: sceneDuration(line || input.scriptText, input.modelId),
    })
  }
  if (scenes.length === 0) return null

  // Final frame — the end state the last clip lands on. If the model dropped
  // it, reuse the last scene frame's concepts (fresh ids) so the chain still
  // has an end anchor rather than a broken last clip.
  const finalBlock = extractTag(body, 'FINAL_FRAME')
  const finalConcepts = finalBlock ? parseConcepts(finalBlock) : []
  frames.push({
    index: frames.length + 1,
    concepts: finalConcepts.length > 0
      ? finalConcepts
      : frames[frames.length - 1].concepts.map((c) => ({ ...c, id: nextConceptId() })),
  })

  return {
    style,
    styleId: input.styleId,
    realism: styleUsesRealism(input.styleId, !!input.styleBrief?.trim()),
    scenes,
    frames,
    modelId: input.modelId,
  }
}

// ── Entry points ───────────────────────────────────────────────

export async function generateContinuous(input: ContinuousInput): Promise<ContinuousResult> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()
  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: CONTINUOUS_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: buildUserPrompt(input) }] },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages)
  const result = parseContinuousResult(responseText, input)
  if (!result) throw new Error('The storyboard came back empty. Try again.')
  return result
}

// Shared context for the per-frame prompt tools (Add concept / Enhance /
// Regenerate) — everything the LLM needs to write a frame that still chains.
export interface FrameContext {
  style: string
  conceptLabel?: string
  scriptLine: string
  inboundMotion?: string
  outboundMotion?: string
  isFinal: boolean
  isOpening: boolean
  existingLabels: string[]
  productContext?: string
  modelContext?: string
}

export function frameContextFor(
  result: ContinuousResult,
  frameIndex: number,
  ctx: { productContext?: string; modelContext?: string; conceptLabel?: string },
): FrameContext {
  const frame = result.frames.find((f) => f.index === frameIndex)
  const inbound = result.scenes.find((s) => s.index === frameIndex - 1)
  const outbound = result.scenes.find((s) => s.index === frameIndex)
  return {
    style: result.style,
    conceptLabel: ctx.conceptLabel,
    scriptLine: outbound?.scriptLine ?? '',
    inboundMotion: inbound?.motionPrompt,
    outboundMotion: outbound?.motionPrompt,
    isFinal: !outbound,
    isOpening: frameIndex === 1,
    existingLabels: frame?.concepts.map((c) => c.label) ?? [],
    productContext: ctx.productContext,
    modelContext: ctx.modelContext,
  }
}

function frameBriefBlock(ctx: FrameContext, frameIndex: number): string {
  let out = `STYLE (fixed for the sequence — never restate it inside the prompt): ${ctx.style}\n`
  out += ctx.isOpening
    ? '\nThis is the OPENING keyframe of the ad.\n'
    : `\nThe motion ARRIVING at this frame (from the previous keyframe):\n${ctx.inboundMotion || '(not specified)'}\n`
  out += ctx.isFinal
    ? 'This is the FINAL keyframe — the end state the last clip lands on.\n'
    : `The narration line this frame opens: "${ctx.scriptLine}"\nThe motion LEAVING this frame (into the next keyframe):\n${ctx.outboundMotion || '(not specified)'}\n`
  if (ctx.productContext) out += `\n${ctx.productContext}\n`
  if (ctx.modelContext) out += `\n${ctx.modelContext}\nNever describe the character's appearance — say "the character".\n`
  out += `\nThis is keyframe ${frameIndex} of the sequence, and it must still connect with the motions above whichever way the neighbouring frames are staged.`
  return out
}

const FRAME_ENVELOPE_NOTE =
  'Respond with ONLY this envelope — no markdown, no commentary, nothing outside the tags:'

// Rewrite the user's draft keyframe prompt richer, same staging.
export async function enhanceContinuousFrame(draft: string, ctx: FrameContext, frameIndex: number): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()
  const user = `Rewrite the keyframe prompt below to be MORE detailed and specific while keeping the SAME staging, shot size, camera angle, and story state. Sharpen every field — the exact pose and hand position, the named props, the real light source and its colour, the material textures — and fill any of the five fields the draft never covered. Do not change what the image is of.

${frameBriefBlock(ctx, frameIndex)}
${ctx.conceptLabel ? `\nThis concept's staging: ${ctx.conceptLabel}\n` : ''}
Current prompt:
"""
${draft}
"""

Return ONE flowing paragraph, usually 50-90 words, keeping the safe-zone framing note. If the draft is a labelled multi-line block (SUBJECT: / SETTING: / ...), that is exactly what you are here to fix: fold it into one readable paragraph, keeping the idea.

${FRAME_ENVELOPE_NOTE}
<PROMPT>
one flowing paragraph
</PROMPT>`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: CONTINUOUS_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: user }] },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages)
  return cleanPromptBody(extractTag(responseText, 'PROMPT') ?? responseText)
}

// Fresh take on the same keyframe slot — a different staging entirely.
export async function regenerateContinuousFrame(ctx: FrameContext, frameIndex: number): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()
  const user = `Write a FRESH prompt for this keyframe — a genuinely different staging from any previous version, same story state.

${frameBriefBlock(ctx, frameIndex)}
${ctx.existingLabels.length ? `\nStagings already used on this frame: ${ctx.existingLabels.join(' · ')}\n` : ''}
Return ONE flowing paragraph, usually 50-90 words, including the safe-zone framing note.

${FRAME_ENVELOPE_NOTE}
<PROMPT>
one flowing paragraph
</PROMPT>`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: CONTINUOUS_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: user }] },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages)
  return cleanPromptBody(extractTag(responseText, 'PROMPT') ?? responseText)
}

// ── Clip motion tools ──────────────────────────────────────────
// The motion prompt is departure-framed (see MOTION_FORMAT): it describes how
// the START keyframe animates forward, and deliberately never paints the end
// frame — the end image is a hard last-frame constraint, so re-describing it in
// words makes the model arrive early and freeze. Both tools honour that.

export interface MotionContext {
  scriptLine: string       // the narration heard over this clip
  nextScriptLine?: string  // where the story goes next (direction, not destination)
}

// Fresh motion written from the clip's ACTUAL chosen start keyframe image — the
// vision escape hatch for when the rendered frame diverged from the concept
// text. `startImageDataUri` is a data: URI (the view converts the asset ref).
export async function regenerateContinuousMotion(startImageDataUri: string, ctx: MotionContext): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()
  const user = `Write the MOTION for one clip of a keyframe-chain ad. The attached image is this clip's START frame — the fixed first frame the video begins on. Describe only how THIS frame animates forward.

The narration heard over this clip: "${ctx.scriptLine}"
${ctx.nextScriptLine ? `The story then moves toward: "${ctx.nextScriptLine}" — head the motion in that direction, but do NOT describe that end state.` : 'This is the final beat of the ad.'}

${MOTION_FORMAT}

${FRAME_ENVELOPE_NOTE}
<MOTION>
one short flowing paragraph
</MOTION>`
  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: CONTINUOUS_SYSTEM }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: user },
        { type: 'image_url', image_url: { url: startImageDataUri } },
      ],
    },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages)
  return cleanPromptBody(extractTag(responseText, 'MOTION') ?? responseText)
}

// Rewrite the user's draft motion richer — same movement, sharper detail.
export async function enhanceContinuousMotion(draft: string, ctx: MotionContext): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()
  const user = `Rewrite the motion prompt below to be MORE detailed and specific while keeping the SAME movement, direction, camera move, and sound. Sharpen the motion vectors and the transformation; do not change what happens or add a new beat.

The narration heard over this clip: "${ctx.scriptLine}"

${MOTION_FORMAT}

Current motion:
"""
${draft}
"""

${FRAME_ENVELOPE_NOTE}
<MOTION>
one short flowing paragraph
</MOTION>`
  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: CONTINUOUS_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: user }] },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages)
  return cleanPromptBody(extractTag(responseText, 'MOTION') ?? responseText)
}

// ── Demo / preview data ────────────────────────────────────────
// Shown when no kie.ai key is set so a member can see what the storyboard
// produces before wiring billing. Written in the real paragraph format at the
// real depth, so the preview doesn't undersell the output.

interface DemoFrameSpec {
  concepts: { label: string; prompt: string }[]
}

const DEMO_STYLE =
  'Glossy stylized 3D render in the viral explainer register: soft rounded characters with gently exaggerated proportions and smooth subsurface-scattering skin, forms built from clean bevelled geometry with no hard edges, a palette of deep midnight blue and slate grey lit by warm amber and honey-gold accents, soft volumetric lighting with a gentle rim light separating every subject from its background, shallow atmospheric haze in the deep field, and a high-detail premium-animated-short finish with subtle bloom around light sources. Never photoreal, never live-action, no film grain.'
const DEMO_SCENES = [
  {
    line: 'Your brain never actually switches off at night.',
    motion: 'The amber glow at the sleeping character\'s temple begins to swell and pulse, brightening as it starts to bloom outward across the pillow. The camera pushes in slowly and steadily from outside the window toward that glow. A soft airy whoosh building into a low hum.',
    sfx: 'a soft airy whoosh',
  },
  {
    line: 'While you sleep, it runs a full cleanup cycle, flushing out the waste that builds up all day.',
    motion: 'The amber orbs lining the pathways start streaming forward and converging toward one central channel, the loose grey dust lifting and beginning to travel with them. The camera orbits slowly left and drifts gently down to follow the flow. A shimmering hum with a soft rushing undertone.',
    sfx: 'a gentle shimmering hum',
  },
  {
    line: 'One scoop of this before bed gives that cycle everything it needs.',
    motion: 'The scoop tips and the powder begins to spill, the falling grains catching light and starting to twist into a rising spiral. The camera pulls back steadily with a slight tilt up as the spiral climbs. A soft magical pop, then a warm settling chime.',
    sfx: 'a soft magical pop',
  },
]

const DEMO_FRAMES: DemoFrameSpec[] = [
  {
    concepts: [
      {
        label: 'MOONLIT BEDROOM',
        prompt: 'A small lived-in bedroom at night seen from just outside the window, the character asleep on their side under a thick quilted duvet, one arm folded beside the pillow, lips slightly parted, brow completely smooth. A single warm point of light glows at their temple, pooling gold on the pillow beneath while cool blue moonlight rakes across the quilting from the upper left. A paperback lies face-down on the nightstand beside a sweating glass of water. Medium-wide from just above the sleeping figure, angled down through the window frame, the character centred with generous headroom and clear side margins so nothing crucial touches the edge.',
      },
      {
        label: 'OVERHEAD SLEEPER',
        prompt: 'Straight down onto the bed from directly above: the character flat on their back, arms relaxed at their sides on top of the duvet, palms open and upward, head turned a few degrees on the pillow. The duvet folds radiate outward from the body like still ripples on water, deep and soft with visible weave. Flat cool blue light fills the room evenly with almost no hard shadow, and a soft amber halo around the head is the only warm accent, glowing faintly into the pillow. The figure runs vertically up the centre of the frame with comfortable margin at head and foot.',
      },
      {
        label: 'TEMPLE GLOW MACRO',
        prompt: 'Very close on the sleeping character\'s face resting on the pillow, three-quarter profile, eyes gently closed with lashes clearly defined, mouth relaxed, one hand curled loosely near the chin. A single warm point of light pulses at the temple just above the cheekbone — it is the key light, wrapping the near cheek in soft amber and falling off fast, while cool moonlight rims the back of the head and separates it from the dark. Pillow fibres catch the glow; the room behind falls away into unlit depth. Framed from pillow height, the face centred and slightly low with clear room above.',
      },
    ],
  },
  {
    concepts: [
      {
        label: 'NEURAL FACTORY',
        prompt: 'The inside of the brain staged as a vast working factory hall: translucent neural pathways running through it as glass tubes carrying streams of small amber orbs, arched walkways branching overhead, a wide central floor. A handful of rounded cleanup drones sweep grey dust from the gantries with soft brushes, their matte shells catching the light. Warm amber travels through the tubes and underlights everything from within while cool blue ambient falls from above, so the warm streams read bright against a cold room. Wide establishing shot from walkway height looking down the hall, the central channel running up the middle with clear headroom above the arches.',
      },
      {
        label: 'RIVER OF LIGHT',
        prompt: 'A luminous river of amber particles winding through a deep blue cavern, carrying loose grey motes away downstream — the river itself is the subject, no figure anywhere. The cavern walls are formed from soft neuron trees with branching rounded canopies, reeds of light lining the near bank, the water rippling and throwing dancing reflections up onto the underside of the canopy. Mist hangs just above the surface. Framed low from barely above the water looking upstream so the current flows toward and past the lens, the river running up the centre of the frame with the banks holding comfortable margin on both sides.',
      },
      {
        label: 'CONTROL ROOM',
        prompt: 'A cosy mission-control room built inside the head, all rounded consoles and padded surfaces. A small rounded robot operator stands at the console, both hands on a large lever pulled fully down, posture leaning into the pull, its single soft-glowing eye fixed on three curved screens showing tidy streams of light flowing outward. Chunky dials and glossy buttons fill the foreground; a porthole looks out into deep blue behind, its cool backlight rimming the robot\'s shoulders while warm amber from the screens washes its front. Medium shot from slightly below the robot\'s eye line, angled up, the robot centred with clear margin around the console edges.',
      },
    ],
  },
  {
    concepts: [
      {
        label: 'HERO JAR RISE',
        prompt: 'The product standing upright and centred on a bedside table in the blue night bedroom, lid off beside it, a gentle spiral of glowing powder rising from the open mouth and curling toward the top of frame. A warm amber glow climbs from inside the container and underlights the spiral from below, while cool moonlight from the window rims its left edge and catches a sweating glass of water behind. The bed and the sleeping figure read as a soft silhouette in the deeper background. Framed from just below the product\'s shoulder height, angled slightly up so it reads heroic, with clear margin on every side.',
      },
      {
        label: 'SCOOP POUR',
        prompt: 'Macro on a rounded scoop tipping slowly, releasing a stream of glowing powder into a glass of water below, the grains separating in the fall and the water already spiralling with amber light where the stream has entered. Tiny bubbles rise; light bends and refracts through the glass, throwing a small warm caustic onto the tabletop beside it. The product stands tall just behind with its lid resting alongside, the bedroom reduced to dark blue shapes. Framed at glass height, very close, three-quarter from the left, the glass centred and low with the scoop entering from the upper right, both well inside the edges.',
      },
      {
        label: 'GLOW HANDOFF',
        prompt: 'The character\'s hand setting the product down on the nightstand, fingers still resting on the lid, while a ribbon of warm light arcs from the product across the frame to their head on the pillow, physically connecting the two. The ribbon is the key source, glowing along its whole length with soft translucent edges, spilling onto the duvet beneath and the back of the hand, while cool moonlight fills everything it does not touch. Faint particles drift along the arc. Wide from table height angled along the length of the bed, the ribbon running diagonally with the product low-left and the head upper-right, both held inside the safe margin.',
      },
    ],
  },
  {
    concepts: [
      {
        label: 'RESTORED MORNING',
        prompt: 'The same bedroom at sunrise, the character sitting up in bed mid-stretch with both arms raised and elbows bent, back slightly arched, eyes open and face bright with an easy unforced smile. The duvet has fallen to their waist in crisp creases. Warm golden light streams in from the window camera-right, wrapping their face and shoulders, rimming the hair, throwing a long soft shadow across the bed and catching a specular highlight on the product\'s curve on the nightstand beside the now-empty glass. Dust drifts in the sunbeam. Medium shot from just below eye level, straight on, with clear headroom above the raised arms.',
      },
      {
        label: 'AURA WIDE',
        prompt: 'The character asleep and completely still, now wrapped head to toe in an even calm amber aura that follows the contour of their body under the duvet, face smooth and untroubled. The aura is the dominant source, glowing outward and lifting the nearby bedding, floor and nightstand out of the dark with a soft graduated falloff at its outer edge and a gentle bloom over the whole frame. The window behind is warming toward dawn, its cool-to-warm gradient meeting the aura halfway across the room. Wide from slightly above the bed angled gently down, the figure running across the middle with generous space above and below.',
      },
      {
        label: 'BRAIN AT PEACE',
        prompt: 'The factory hall from before, now spotless and dim: the cleanup drones parked in a neat row along the left wall with their brushes stowed, one last amber orb drifting slowly upward through the centre trailing a soft bloom. The arched pathways are clear of dust and glow a steady even amber that washes the whole hall in warm light, the earlier cold blue faded to a faint edge along the far arches. Surfaces read clean and reflective, shadows shallow and soft. Wide from walkway height looking down the hall — deliberately the same geometry as the earlier factory frame — the rising orb centred with clear headroom above.',
      },
    ],
  },
]

export function buildDemoContinuousResult(modelId: string, styleId: string): ContinuousResult {
  let stamp = 0
  return {
    style: DEMO_STYLE,
    styleId,
    realism: false,
    modelId,
    demo: true,
    scenes: DEMO_SCENES.map((s, i) => ({
      index: i + 1,
      scriptLine: s.line,
      motionPrompt: s.motion,
      sfx: s.sfx,
      durationSeconds: sceneDuration(s.line, modelId),
    })),
    frames: DEMO_FRAMES.map((f, i) => ({
      index: i + 1,
      concepts: f.concepts.map((c) => ({ id: `demo-cont-${++stamp}`, label: c.label, prompt: c.prompt })),
    })),
  }
}
