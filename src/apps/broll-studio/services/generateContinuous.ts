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

import type { ContinuousConcept, ContinuousFrame, ContinuousResult, ContinuousScene, VariationRefs } from '../types'
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
// The style registry, the reference-frame analyser, and brief resolution now
// live in utils/visualStyle.ts — Characters consumes them too, and apps don't
// import from each other. Re-exported here so B-Roll's own call sites (and any
// persisted imports) keep working unchanged.
export {
  type ContinuousStyle,
  CONTINUOUS_STYLES,
  getContinuousStyle,
  styleUsesRealism,
  analyzeStyleReferences,
  styleBriefFor,
} from '../../../utils/visualStyle'
import { styleBriefFor, styleUsesRealism } from '../../../utils/visualStyle'

// ── Prompt assembly at fire time ───────────────────────────────

// Final image/video prompt: the editable scene text plus the storyboard-wide
// style block. The style rides OUTSIDE the editable prompt so the cards stay
// readable and the style can't drift per-frame.
// `world` is the single physical location the whole ad lives in. It rides
// alongside the style for the same reason: told once in the storyboard it drifts
// frame to frame, and the result was scene 1 in a sunlit kitchen and scene 2 in
// a dark void, a chrome surface and a gym — three new sets in one boundary. A
// frame's own description still outranks it on specifics like time of day.
//
// Only IMAGE (keyframe) generation passes it. A clip is an interpolation between
// two fixed frames that already establish the room, and a paragraph of scenery
// works against the motion doctrine's "arrival is motion, never content" rule.
export function buildContinuousPrompt(editable: string, style: string, world?: string): string {
  const parts = [editable.trim()]
  if (world?.trim()) {
    parts.push(
      `WORLD (the one location this ad lives in — this frame is somewhere inside it; where the description above is more specific about light or time of day, that wins): ${world.trim()}`,
    )
  }
  if (style.trim()) parts.push(`STYLE: ${style.trim()}`)
  return parts.join('\n\n')
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
export function buildContinuousPreamble(opts: {
  chain: boolean
  character: boolean
  product: boolean
  extras: number
  // True when a product reference EXISTS but is deliberately withheld from this
  // frame — the beat criticises the category, so the item on screen has to be an
  // unbranded stand-in. Without saying so out loud, a chained previous keyframe
  // that showed the real packaging drags the branding straight back in.
  productExcluded?: boolean
}): string {
  const parts: string[] = []
  if (opts.chain) {
    parts.push(
      'The FIRST attached image is the previous keyframe of this same sequence. Maintain its exact art style, rendering technique, character design, colour palette, material language, and environment continuity — this new frame must look like the very next moment of the same film. This is a DIFFERENT camera setup in the same world: do not reuse its composition, shot size, camera angle, subject placement, or background layout. Build the framing entirely from the scene description below; the reference governs how things look, never where they sit.',
    )
  }
  if (opts.character) {
    // The character reference is almost always a chest-up portrait, and an image
    // model handed a portrait returns the portrait's crop unless it is told not
    // to. Every other reference class here already carries an anti-composition
    // clause; this one didn't, which is why every keyframe came back a centred
    // medium shot of the character no matter what shot the prompt asked for.
    parts.push(
      "Match the character's face, hair, and wardrobe to the character reference image, translated faithfully into the sequence's art style. That image is an IDENTITY card, not a shot: ignore its crop, camera distance, lens height, angle, eyeline, pose, and background completely. The framing comes ONLY from the description below — if it asks for a wide shot, an aerial, a low angle, an over-the-shoulder view, a body part with no face, or the character small inside a large space, render exactly that. Never fall back to a chest-up portrait facing the lens.",
    )
  }
  if (opts.product) {
    parts.push("Match the product's shape, label text, and colours exactly to the product reference image, translated into the sequence's art style.")
  }
  if (opts.productExcluded) {
    parts.push(
      'NO product reference is attached to this frame on purpose: the advertised product must NOT appear here, in any attached image or not. Any product-like object described below is a generic unbranded stand-in — blank or plain packaging, no logo, no brand name, no readable label, and deliberately unlike the advertised product in colour and shape. If a previous keyframe is attached and shows the real packaging, do not carry it into this frame.',
    )
  }
  if (opts.extras > 0) {
    parts.push('Any remaining attached images are additional appearance references — use them for identity and detail only, never for composition.')
  }
  if (parts.length === 0) return ''
  return `REFERENCE USAGE — ${parts.join(' ')}`
}

// ── Shot design ────────────────────────────────────────────────
//
// Round one fixed a real failure — every concept came back a centred medium
// shot of the character — by ASSIGNING each concept slot a shot class (Wide /
// Detail / Character). It worked on framing and broke something else: a
// mandated Wide on an intimate beat gives the model nothing in the scene worth
// shooting wide, so it invents a set to make a wide out of. Combined with three
// other rules that pushed subject variety (see ONE WORLD below), consecutive
// keyframes stopped looking like the same place at all.
//
// So the shot plan is now DYNAMIC — chosen per beat, from the story — and the
// anti-collapse work is done by constraints instead of a rotation:
//   - the three concepts of a frame must sit at three DIFFERENT rungs, and at
//     least one must be medium-wide or wider (the "not too cropped in" floor);
//   - the chest-up-portrait-square-to-the-lens shot is banned outright;
//   - camera position must be stated as geometry, never as a vibe.
// The mechanical fixes from round one all stay: the character reference is an
// identity card whose crop must be ignored, the safe zone is a crop rule and
// never a centring rule, and the boundary anchor holds shape and position but
// not scale.
const SHOT_LADDER = 'aerial · vast wide · wide · medium-wide · medium · close-up · macro'

// Shot labels the parser normalises <SHOT> onto, so the card chip reads
// consistently however the model phrases it. Order matters: longer, more
// specific labels first, or "wide" swallows "medium-wide".
const SHOT_LABELS = ['Aerial', 'Vast wide', 'Medium-wide', 'Wide', 'Medium', 'Close-up', 'Macro']

const SHOT_VOCABULARY = `Pick each concept's shot size off this ladder, and name it in <SHOT>:

${SHOT_LADDER}

Choose from the BEAT, not from a rotation. A reveal wants scale; a confession wants closeness; a texture claim wants a macro. What the three concepts of one frame may never do is share a shot size, and at least one of the three must be medium-wide or wider — an all-tight frame leaves the user no un-cropped option to pick.

Whatever the size, the framing rules are the same. Camera position is geometry: lens height relative to the subject, distance from it, angle. Never a chest-up portrait square to the lens with the character staring down the barrel — that is the one shot this format cannot use; a low angle, an over-the-shoulder, a three-quarter or a through-a-doorway view of the same moment all work.

But the subject stays SAFELY IN FRAME. Hold it in the middle band of the picture — dead centre, or on a third at most — fully inside the frame with clear margin all round, never touching an edge, never bleeding off one, never shoved into a corner. Vertical 9:16 gets cropped and overlaid at the edges, so an edge-weighted composition loses its subject. The variety comes from HOW CLOSE the camera is and WHERE IT SITS, never from pushing things to the side.`

// ── Prompt formats ─────────────────────────────────────────────
//
// One flowing paragraph each, matching Line-by-Line and One-Shot: the labelled
// multi-field structure these used to carry read disjointed and crowded out the
// actual idea. Keyframes keep one extra requirement the clip modes don't need —
// an explicit safe-zone note, because 9:16 platform UI overlays the frame edges.
// That note is a CROP rule only: written as "centre the subject" it quietly
// turned every keyframe into a centred medium shot.

const KEYFRAME_FORMAT = `Every keyframe prompt is ONE flowing paragraph — usually 50-90 words, longer when the idea needs it. Plain, concrete, readable — no labels, no field names, no line breaks, no "Style:" trailer.

Write it like you're describing a still you're looking at right now: what's in frame and in what state (the exact pose, hand position, gaze, and the expression as a real muscle action — "brows drawn together, jaw set", never "looking sad"), the actual space and the two or three specific props that sell it, where the light comes from and its colour, and the materials and textures that make it feel rendered rather than sketched. If there's no character, the hero object and its exact orientation carry the frame.

Always state the framing as three separate things: the SHOT SIZE, taken off this ladder (${SHOT_LADDER}) and matching the concept's declared <SHOT>; the CAMERA POSITION as pure geometry — lens height relative to the subject, distance from it, and angle ("from knee height about four metres back, angled up") — and WHERE IN THE FRAME the subject sits. The camera is a viewpoint, never a prop: never name the filming device (no phone, iPhone, smartphone, front camera, tripod, ring light), not in a hand, not on a table, not in a reflection, and never a mirror selfie.

SAFE FRAMING: the subject sits in the middle band of the frame — dead centre, or on a third at most — fully inside the picture with clear margin on every side, never touching or bleeding off an edge, never pushed into a corner. Platform UI also overlays roughly the top and bottom eighth of a vertical 9:16 frame, so keep faces, readable labels and the boundary anchor out of those bands. What this rule does NOT constrain is how close the camera is or where it sits: it is not an argument for a medium shot, and a wide, an aerial, a macro, a low angle or an over-the-shoulder all satisfy it perfectly. Get the variety from shot size and camera position; keep the subject safe.

Never name the art style, medium, or render technique — the style block is appended separately to every prompt. No captions, subtitles, watermarks, on-screen text, logos, or UI of any kind.`

// The clip is a first-frame/last-frame interpolation: BOTH endpoints are fixed
// images the model has to hit. A prompt describing only the departure leaves it
// with no path to the end frame — it plays the described move, runs out of
// direction, and snaps onto the last image in the closing beats. That snap is
// the hard cut this whole mode exists to avoid. So a motion prompt is a
// TRAJECTORY: what leaves, what carries it across, and how it settles.
//
// The one rule that makes this work: arrival is written as MOVEMENT (what
// decelerates, eases, comes to rest), never as a PICTURE of the end frame.
// Painting the end tableau in words is what makes a model race there and freeze
// for the rest of the clip — the failure the old departure-only rule was
// guarding against. Both failures are avoidable; only one of them needs silence.
function motionFormat(durationSeconds?: number): string {
  const pacing = durationSeconds
    ? `PACING: this clip runs ${durationSeconds} seconds. Spread the movement across all ${durationSeconds} seconds so something is still travelling as the shot settles — a move that finishes early leaves the model idling, and an idling model jumps.`
    : `PACING: the clip runs about as long as its narration line takes to speak (roughly 2.4 words per second, never under three seconds). Spread the movement across that whole span so something is still travelling as the shot settles — a move that finishes early leaves the model idling, and an idling model jumps.`
  return `Every motion prompt is ONE flowing paragraph — usually 45-75 words. No labels, no field names.

The clip opens on a fixed start image and lands on a fixed end image. Your paragraph is the PATH between them, written as one unbroken move in three beats, in order:

1. DEPARTURE — what in the start frame begins to move and in which direction, as a vector ("lifts up and back", "rotates open clockwise", "collapses inward"), and how the camera starts moving: push in, pull back, orbit left, tilt down, track alongside, or hold steady.
2. THE CROSSING — the mechanism that physically carries the shot from the first image to the second: the transformation as it happens ("the powder spills and dissolves into drifting light"), the camera travelling through or around something, one form morphing into another, an object sweeping across the lens. This beat keeps the middle of the clip alive; without it the model runs out of direction and cuts.
3. THE SETTLE — the arrival written as MOVEMENT: what decelerates, what eases open, what comes to rest, where the camera slows and stops.

CRITICAL — arrival is MOTION, never CONTENT. Write how the shot lands: "the push-in decelerates as the raised hand eases to a stop and the light steadies". Never write what it lands ON — the end pose, the end composition, the end tableau as a picture. The end image is already handed to the model as a fixed last frame; describing how it LOOKS makes the model race there and freeze for the rest of the clip. Describe the landing, not the thing landed on.

${pacing}

Never name an edit — no "cut to", "dissolve to", "transition to", "then we see". The entire point is that nothing cuts.

Keep it physical and specific to this one staging — this is transition direction, not a new scene. Close with one sound direction (a soft whoosh, a low building rumble, a gentle pop, or silence). Never write dialogue, narration, or music; a voiceover and a music bed are added later in the edit.`
}

const MOTION_FORMAT = motionFormat()

// ── The storyboard system prompt ───────────────────────────────

const CONTINUOUS_SYSTEM = `# ROLE

You are the creative director of viral explainer ads — the Zack D Films register: short vertical videos that feel like ONE continuous, morphing shot. You storyboard in keyframes: every narration line gets a start image, the next line's image is simultaneously this line's end state, and a video model interpolates the motion between each pair. Because clip N literally ends on clip N+1's first frame, the cuts are invisible.

# YOUR JOB

Turn the user's script into a STORYBOARD:

0. Decide the WORLD — the one physical location the whole ad happens in. Everything else is staged inside it. See ONE WORLD below.
1. Split the script into narration SCENES — see SEGMENTATION below. One scene carries exactly ONE visual idea.
2. For every scene, decide VISIBILITY: whether the advertised product is allowed on screen for that beat — see WHOSE PRODUCT IS ON SCREEN below.
3. For every scene, design its START keyframe. After the last scene, design one FINAL keyframe (the end state the last clip lands on). So there is always exactly ONE more frame than there are scenes.
4. For every scene, declare the TRANSITION that carries its keyframe into the next one — see THE CHAIN below. Design both frames around it.
5. Give every keyframe ${CONCEPTS_PER_FRAME} distinct visual CONCEPTS — each in its ASSIGNED shot class (see CONCEPT VARIATIONS), each declaring the REFERENCE IMAGES it needs.
6. For every CONCEPT of every non-final keyframe, write the MOTION that animates THAT specific staging across into the next beat. Motion belongs to the staging, not the scene — a wide aerial and a macro close-up of the same beat travel differently, so each concept gets its own motion, and each one has to execute the scene's transition. Final-frame concepts get NO motion (nothing leaves the last frame).

# ONE WORLD — THE STORYBOARD IS ONE PLACE

This is a STORY, not a moodboard. The whole ad happens in ONE physical location, and every keyframe is a shot taken somewhere inside it. The camera moves through that place; it never teleports to a new one.

Decide the location first, from the script, and write it into <WORLD>: the actual room or space, its layout, the surfaces and materials in it, where the light comes from and what time of day it is, and the two or three props that recur. A kitchen with morning light through a window camera-left, a marble island, a fruit bowl. A cluttered bathroom counter under warm bulb light. A home gym with rubber flooring and a mirrored wall.

Then hold it. Every frame, every concept:

- Same location, every time. Shot 12 is the same room as shot 1, from a different position in it.
- A metaphor is STAGED IN THE ROOM, never floated in a void. "Tasted like cardboard" becomes a tower of cardboard slabs stacked on that kitchen island, or a cardboard bar on that counter — not a cardboard texture on a black background. Staging the absurd thing in a real, established place is what makes it funny instead of abstract.
- A macro is a macro OF SOMETHING IN THE ROOM, shot at that counter under that light, with a recognisable piece of the space still visible behind it.
- BANNED as backdrops: black or coloured voids, seamless studio infinity walls, abstract gradients, floating objects in undefined space, dark chrome or "premium product shot" sets, and any location the script never implies. These read as stock inserts and they are what breaks the story.
- Light is part of the location. The direction, colour and quality of light stay consistent unless the story explicitly moves time (a night-to-morning payoff), and then it moves ONCE.

If the script genuinely spans two places (at home, then at the gym), <WORLD> may name both AND say which scene the move happens on — one move, on one boundary, and both halves described concretely. Never more than that. The default is one place.

Continuity is not decoration here: the user picks ONE concept per frame and the clip interpolates between the two picks. If frame 2's concepts are three unrelated sets, then whichever they pick, the clip has to travel from a kitchen to a void, and the model hard-cuts.

# SEGMENTATION — ONE SCENE, ONE IDEA

A scene is one keyframe, and one image can only show one thing. So the unit is the IDEA, not the sentence.

- Split any sentence that carries two visual ideas into two scenes. The giveaway is a turn: "but", "though", "however", "until", "then", "so", "and then", "that's why". Each side of the turn gets its own scene. "Most taste like chewed up cardboard, but this one tastes like real cookie dough" is TWO scenes — the complaint, then the fix. Trying to draw both at once produces a muddle that shows neither.
- Also split a sentence that states a problem and its solution, a before and an after, or a claim and its proof.
- Never cut mid-clause. Every scene must be a speakable, self-contained phrase of at least five words; merge anything shorter forward into the next one. Never a standalone scene for "Listen up", "Be honest", "So...", "Right?".
- The <LINE> values are the actual voiceover. Use the script's EXACT words, in the script's order, splitting only at clause boundaries — reading every <LINE> in sequence must reproduce the script. You may drop the connecting word at a split ("but", "so") and nothing else. Never paraphrase, never add words, never reorder.

# WHOSE PRODUCT IS ON SCREEN

The user's own product photo is attached as a reference. Handing it to a shot that criticises the category makes the ad attack its own product — the single worst failure in this mode. So every scene declares VISIBILITY:

- VISIBILITY no — the advertised product may NOT appear anywhere in this scene's frames: not held, not in the background, not blurred, not implied by packaging-coloured objects. This is the default for any line that names the category as the PROBLEM ("stop eating chalky protein bars", "most of them taste like cardboard", "I wasted years on serums that did nothing"), and for hook and reframe lines generally.
- VISIBILITY yes — the product may appear. Any line that points at the product itself ("this one", "this bar", "I tried it", the brand name) is YES regardless of where it sits in the ad, and payoff and CTA lines are almost always yes.

When VISIBILITY is no but the line still needs a category object on screen (the bad bar, the useless serum, the old gadget), that object is a GENERIC STAND-IN, and you must SAY so in the prompt — never just omit the product and hope. Write it in explicitly: a plain unbranded item in blank matte packaging, no logo, no brand name, no readable text, in colours and a shape deliberately unlike the advertised product. "A brittle chalky bar in a plain unmarked grey wrapper, no logo or text anywhere" is right. "A protein bar" is wrong — the model fills that blank with the attached reference.

# REFERENCE IMAGES — PER CONCEPT

Each concept declares REFS: character / product / both / none.

- Attach the CHARACTER reference whenever a person could appear, even just their hands. When unsure, attach it — a missing character reference loses the face.
- The reference is a portrait, so a frame that shows only a body part has to say so: write "only the hands are in frame, no face" (or shoulders, or a silhouette) explicitly. Otherwise the model answers the attached portrait and puts a face back in your macro shot.
- Attach the PRODUCT reference only when the advertised product is actually in the frame. It is a hard exclusion, not a preference: when VISIBILITY is no, REFS may NEVER include product. A generic stand-in gets NO product reference — that is the whole point.
- Use "none" for frames with neither a person nor the product (a bare environment, an abstract insert, a pure metaphor).

# SHOW, DON'T TELL — THIS IS THE WHOLE JOB

Each narration line will be HEARD over the footage. The frames must SHOW what the line means — never a person passively existing while the line plays. Find the strongest image inside the line and put it on screen:

- If the line contains a metaphor, comparison, or vivid image, MAKE IT LITERAL — even when it's absurd. The absurdity is what stops the scroll. "Your brain runs a cleanup cycle at night" → a glowing factory inside the skull, tiny drones sweeping the walkways. "My skin felt like sandpaper" → fingertips dragging across a real sheet of sandpaper.
- If the line describes an act, show the act actually happening — mid-motion, hands busy, real.
- If the line makes a claim, show the evidence.
- If the line is emotional, show the emotion landing inside a real moment — never a face in a void.

When the script points at the product itself, the product IS the visual. When the script attacks the category, the generic stand-in is the visual — never the product. A viewer watching with the sound off should be able to guess the narration.

# ONE SCENE, ONE ACTION — EVERY LINE GETS ITS OWN

Every scene needs its own distinct physical ACTION: something actually happening, caught mid-motion. Not a state, not an arrangement, not a person or an object simply being present. If you cannot say what is MOVING in a frame, it is not finished.

- Name the action as a verb in progress: cardboard slabs toppling off the island, a wrapper being torn open, a bar snapping in half, a hand sweeping a row of old tubs into the bin, powder spilling across the counter, a thumb pressing into the dough. "The character holds the bar" is not an action. "The character's teeth are sinking into the cardboard, fibres peeling away" is.
- Every scene's action is DIFFERENT from every other scene's. Reading the actions in order should feel like a sequence of events, each one advancing, never the same gesture twice with a new prop. If two scenes both end up as "holding it up to the light", one of them is wrong.
- An action does not need a face. Hands, an object under its own momentum, a substance moving, something falling or being knocked over — all actions. This is how a frame stays alive when the character is out of shot.
- The ${CONCEPTS_PER_FRAME} concepts of one frame all show THE SAME action, from ${CONCEPTS_PER_FRAME} different cameras. A wide of the slabs toppling, a macro of the top slab tipping, a shot of the character reacting as they topple — one event, three angles. Never three different events.
- The action is also what the clip has to animate: the motion prompt continues it. A static frame gives the motion nothing to leave from.

The FINAL frame is the exception — it is an end state the last clip settles onto, so it may rest.

# SPECIFICITY

Vague direction renders as generic footage. Every frame names the exact prop, the exact body and hand position, the exact expression, the real light source, and the actual material. Write each keyframe the way you'd describe a still you're looking at, not the way you'd pitch it. If a prompt could describe two visually different images, it isn't finished — add specificity, never another scene. Keep each paragraph tight and readable.

Banned everywhere: "beautiful", "stunning", "modern", "clean", "minimalist", "high quality", "professional", "cinematic vibe", "looking happy/sad/frustrated" (name what the face is actually doing), "using the product" (name the actual action).

# KEYFRAME RULES

- Each keyframe is a single striking image: one clear subject, one readable idea. If a frame needs a sentence of explanation to work, simplify the idea — then describe the simpler idea in full detail.
- SAFE FRAMING: the subject sits in the middle band of the frame (centre, or on a third at most) with clear margin all round — never touching an edge, never bleeding off, never in a corner; and faces, readable labels and the boundary anchor stay out of the top and bottom eighth where platform UI sits. This constrains WHERE the subject is, not how close the camera is: it never argues for a tighter shot.
- THE CAMERA IS A VIEWPOINT, NOT A PROP. Never name the filming device — no phone, iPhone, smartphone, front camera, tripod or ring light; nothing held, propped, or reflected; never a mirror selfie. State camera position as geometry instead: lens height, distance, angle.
- CONTINUITY IS EVERYTHING: consecutive keyframes are two moments in the SAME ROOM. Same location, same character design, same palette, same light direction. Frame N+1 must be a state that frame N can physically morph or move into, and it must carry the boundary's anchor. "The story moves" is not a reason to change location — see ONE WORLD.
- Refer to the on-screen person as "the character" and the advertised product as "the product" — reference images fix their exact look. Never describe the character's identity (gender, age, ethnicity, hair colour, skin tone); pose, expression, gesture, and body language ARE required.
- The words "the product" mean the ADVERTISED product and nothing else. Never use them for a generic stand-in — describe that one physically instead ("a plain unmarked bar in a blank grey wrapper").
- Gender-neutral language only: never he/him/his/she/her, never "subject". Use "the character" or "they/them/their".
- Never mention the art style, medium, or render technique inside a frame prompt — the style is appended separately.

# THE CHAIN — HOW ONE FRAME BECOMES THE NEXT

This is the single most important constraint in the storyboard. Every clip is generated by a model that is handed frame N as its fixed first image and frame N+1 as its fixed last image, and has to invent the path between them. If the two frames share nothing, there IS no path — the model animates for a second and then hard-cuts onto the last image. A beautiful pair that cannot morph is a failure.

So every scene declares a TRANSITION, which is two things in one line:

- The DEVICE that carries the shot across: a match cut on a shared shape, the camera pushing through an object into the next space, one form morphing into another, an object sweeping across the lens as a wipe, a pull-back that reveals the next frame's space around this one, a whip pan that lands in the new place.
- The ANCHOR: one concrete element that is on screen in BOTH frames, in roughly the same region of the frame, so the model has something to hold while everything else changes. A circular glow that becomes a lamp. A hand that stays in the lower third. A vertical column of light that becomes a doorway. Same shape, same place, new meaning.

The anchor belongs to the BOUNDARY, not to one staging: every one of frame N's ${CONCEPTS_PER_FRAME} concepts and every one of frame N+1's ${CONCEPTS_PER_FRAME} concepts must carry that same anchor, in that same region of frame. That is what lets the user pick any concept on either side and still get a seamless clip. Write the anchor into the prompt text of every concept on both sides of the boundary — never leave it implied.

The anchor's SHAPE and POSITION hold; its SCALE does not have to. The anchor may be a small bright dot in a vast wide and fill half the frame in a macro — a push-in or a pull-back is exactly how a clip crosses that difference, and the concept's own motion is where you say so. The anchor is never a reason to keep two concepts at the same shot size: if you catch yourself matching scale to protect the anchor, match the shape and let the motion carry the scale.

Frames may change scale, camera position, and what the camera is pointed at, as long as the anchor survives the change. What they may NOT change is the PLACE — the anchor is not a licence to build a new set around it. "Keep the glow, replace the room" is the exact failure: a golden column of light standing in a dark void technically carries the anchor and destroys the story. Move the camera within the world; transform what is in front of it.

# KEYFRAME PROMPT FORMAT (EVERY CONCEPT)

${KEYFRAME_FORMAT}

# CONCEPT VARIATIONS — THREE CAMERAS, ONE MOMENT, ONE ROOM

The ${CONCEPTS_PER_FRAME} concepts for one keyframe are ${CONCEPTS_PER_FRAME} ways to SHOOT the same moment in the same location — think of three cameras set up in that room, at different distances and angles, and one of them is going to be picked. They are not three different ideas set in three different places. The user picks one per frame and the clip has to travel from their pick to the next frame's pick, so if the three are unrelated worlds, most pairs cannot connect.

What varies between concepts: the shot size, where the camera sits, and what in the room it is pointed at. What does NOT vary: the location, the light, the props on the surfaces, the story state.

${SHOT_VOCABULARY}

The anchors are NOT negotiable. Every concept of a frame carries the incoming boundary's anchor and the outgoing boundary's anchor, in the stated region of frame — at whatever size that concept's scale implies. Each concept carries its OWN motion, matched to its staging and executing its scene's transition, and a concept whose scale differs sharply from its neighbour says so in the motion (the push-in, the pull-back, the travel through). Every concept gets the same depth on both the frame and its motion; a thinner alternative is a failure.

# SHOT RHYTHM ACROSS THE SEQUENCE

Shot size is how you PACE the story, so let the beats drive it: closer as the line gets personal, wider on a reveal or a punchline, a macro when the claim is about a texture or a detail. What you must avoid is a flat sequence of same-size shots — the register lives on scale contrast.

- Consecutive keyframes change shot size by at least one full step on the ladder. Never three frames in a row at the same scale.
- The narration is HEARD, never seen being spoken. Nobody is ever framed as a talking head, and no frame exists just because a person says the line.
- The character does not have to be in every frame — a beat can be carried by what their hands are doing, by the object on the counter, or by the space itself. But when they are absent, the frame is still that same room, shot from somewhere in it. Cutting the person is never a reason to cut the place.
- Don't open on a medium shot of the character facing the lens. Open by establishing the world (a wide of the room) or on a detail inside it.
- At least one keyframe in every sequence is a genuine wide that shows the location — the viewer needs to know where they are, and it gives every later close-up somewhere to belong.

# MOTION PROMPT FORMAT (EVERY SCENE)

${MOTION_FORMAT}

# OUTPUT FORMAT (STRICT)

Wrap your answer in this exact XML envelope. No text outside the tags, no markdown fences.

<STORYBOARD>
<WORLD>One paragraph of 50-90 words naming the ONE location this whole ad happens in: the room or space, its layout, the surfaces and materials, the light source with its direction, colour and time of day, and the two or three props that recur. Concrete and physical — this is a place, not a mood. It is appended to every frame prompt, so no subject matter, no action, and no style words in it. If the script truly needs a second location, name both here and say which scene the single move happens on.</WORLD>
<STYLE>One dense paragraph of 90-150 words locking the visual style for the whole sequence — medium and rendering technique, how forms and figures are treated, the named colour palette, the lighting register, and the camera/finish character. Adapt the style brief you are given to this specific script and product. This paragraph is appended verbatim to every image and video prompt, so it must be pure style direction with no subject matter in it.</STYLE>
<SCENE_1>
<LINE>exact narration slice, one visual idea, in the script's own words</LINE>
<ACTION>the one physical thing happening in this scene, as a verb in progress — e.g. "the stack of cardboard slabs topples off the island edge". Different from every other scene's action; all ${CONCEPTS_PER_FRAME} concepts below show THIS action from different cameras.</ACTION>
<VISIBILITY>yes|no</VISIBILITY>
<TRANSITION>one line: the device carrying this keyframe into the next one, plus the anchor element every concept on BOTH sides must show, in the same region of frame — e.g. "match cut on the circular glow: the temple light becomes the factory's central lamp, held centre-frame, same warm amber, at whatever size each shot implies"</TRANSITION>
<FRAME>
<CONCEPT_1>
<LABEL>2-4 word slug naming the camera, e.g. ACROSS THE ISLAND</LABEL>
<SHOT>one size off the ladder</SHOT>
<REFS>character|product|both|none</REFS>
<PROMPT>one flowing paragraph — this scene's ACTION caught mid-motion, in this location, from this camera, with the boundary anchors written in</PROMPT>
<MOTION>one paragraph: how THIS staging travels across — departure vector and camera move, the crossing mechanism that executes the transition, then the settle. Arrival as movement, never as a picture of the end frame.</MOTION>
</CONCEPT_1>
<CONCEPT_2>the SAME action and the SAME location from a different camera at a different shot size, carrying the same anchors, same depth, with its OWN SHOT, REFS and matched MOTION</CONCEPT_2>
<CONCEPT_3>the same action again from a third camera and a third shot size, carrying the same anchors, same depth, with its OWN SHOT, REFS and matched MOTION</CONCEPT_3>
</FRAME>
</SCENE_1>
(repeat <SCENE_N> for every scene, in script order)
<FINAL_FRAME>
<CONCEPT_1>
<LABEL>2-4 word slug</LABEL>
<SHOT>one size off the ladder</SHOT>
<REFS>character|product|both|none</REFS>
<PROMPT>one flowing paragraph — the still, described, carrying the last boundary's anchor (NO motion; nothing leaves the final frame)</PROMPT>
</CONCEPT_1>
<CONCEPT_2>...</CONCEPT_2>
<CONCEPT_3>...</CONCEPT_3>
</FINAL_FRAME>
</STORYBOARD>`

export interface ContinuousInput {
  scriptText: string
  styleId: string
  // Style paragraph distilled from the user's reference images. When present it
  // replaces the preset brief entirely.
  styleBrief?: string
  modelId: string
  productContext: string
  modelContext: string
  additionalContext: string
}

function buildUserPrompt(input: ContinuousInput): string {
  let prompt = `Storyboard this script as a keyframe-chain ad.\n\nScript:\n${input.scriptText}\n\nSTYLE BRIEF (adapt into the <STYLE> block): ${styleBriefFor(input)}\n`
  if (input.styleBrief?.trim()) {
    prompt += `\nThat style brief was reverse-engineered from reference frames the user supplied. Honour it exactly — it outranks any default look you would otherwise reach for.\n`
  }
  if (input.productContext) {
    prompt += `\n${input.productContext}\nThis is the ADVERTISED product — a photo of it is attached as a reference to any frame whose REFS include product. Decide VISIBILITY per scene: a line that attacks the category shows a generic unbranded stand-in, described as such in the prompt, with no product reference attached.\n`
  }
  if (input.modelContext) {
    prompt += `\n${input.modelContext}\nIMPORTANT: never describe the character's physical appearance — say "the character"; a reference image fixes their look.\n`
  }
  if (input.additionalContext) prompt += `\nAdditional context and instructions:\n${input.additionalContext}\n`
  prompt += `\nWrite the full <STORYBOARD> now. Split any line that carries two visual ideas into two scenes. Every keyframe concept gets the same depth — no thinning out on the later scenes.

Before you answer, run this check and rewrite anything that fails:
1. WORLD — is every single concept of every frame recognisably the same location? Any void, studio backdrop, abstract space, or room the script never implied is a failure. Read the frames in order: it should feel like one continuous take moving through one place.
2. ACTION — does every scene have its own distinct physical action, caught mid-motion, and does every concept of that frame show THAT action from a different camera?
3. SHOT SIZES — within each frame, three different sizes, at least one medium-wide or wider. Across the sequence, consecutive frames change size, and one frame establishes the location as a genuine wide.
4. FRAMING — every subject held in the middle band of the frame with clear margin, nothing at an edge or bleeding off, nothing essential in the top or bottom eighth. No chest-up portrait square to the lens.`
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
    .replace(/<REFS>[\s\S]*?<\/REFS>/gi, '')
    .replace(/<SHOT>[\s\S]*?<\/SHOT>/gi, '')
    .replace(/<ACTION>[\s\S]*?<\/ACTION>/gi, '')
    .replace(/<VISIBILITY>[\s\S]*?<\/VISIBILITY>/gi, '')
    .replace(/<\/?(STORYBOARD|SCENE_\d+|CONCEPT_\d+|FINAL_FRAME|FRAME|PROMPT|LABEL|REFS|SHOT|VISIBILITY|LINE|MOTION|TRANSITION|STYLE|WORLD|ACTION)>/gi, '')
    .trim()
}

// The concept's declared reference set. Undefined when the tag is missing or
// unrecognised, so the card can fall back to the scene's product visibility
// rather than to a wrong-but-confident value.
function parseConceptRefs(raw: string | null): VariationRefs | undefined {
  const v = raw?.trim().toLowerCase()
  return v === 'character' || v === 'product' || v === 'both' || v === 'none' ? v : undefined
}

// The concept's shot size, normalised onto SHOT_LABELS so the card chip reads
// consistently. The size is now the storyboard's own choice per beat (no
// assigned slots), so there is no positional fallback: an omitted <SHOT> just
// leaves the chip off rather than asserting a size the prompt may not match.
function parseConceptShot(raw: string | null): string | undefined {
  const v = raw?.trim()
  if (!v) return undefined
  const lower = v.toLowerCase()
  const matched = SHOT_LABELS.find((label) => lower.includes(label.toLowerCase()))
  if (matched) return matched
  // An off-menu answer is still useful direction — keep it, trimmed to a chip.
  return v.split(/\s+/).slice(0, 3).join(' ')
}

let idCounter = 0
function nextConceptId(): string {
  return `cont-${Date.now()}-${++idCounter}`
}

const MAX_SCENES = 40

function parseConcepts(frameBlock: string, productVisible: boolean | undefined): ContinuousConcept[] {
  const concepts: ContinuousConcept[] = []
  for (let j = 1; j <= CONCEPTS_PER_FRAME + 2; j++) {
    const block = extractTag(frameBlock, `CONCEPT_${j}`)
    if (!block) continue
    // Read MOTION and REFS before cleaning the block, then strip the whole
    // concept down to its PROMPT body (falling back to the block minus its
    // control tags).
    const motion = cleanPromptBody(extractTag(block, 'MOTION') ?? '')
    const declared = parseConceptRefs(extractTag(block, 'REFS'))
    const promptRaw = extractTag(block, 'PROMPT') ?? block
    const prompt = cleanPromptBody(promptRaw)
    if (!prompt) continue
    const shot = parseConceptShot(extractTag(block, 'SHOT'))
    // Visibility is the hard rule, refs are the model's preference — so a scene
    // marked "product must not appear" strips product out of the refs even when
    // the concept asked for it. This is the failure the whole feature exists to
    // stop: attaching the real packaging to a shot that trashes the category.
    const refs = declared && productVisible === false
      ? (declared === 'both' || declared === 'character' ? 'character' : 'none')
      : declared
    concepts.push({
      id: nextConceptId(),
      label: extractTag(block, 'LABEL') ?? `Option ${concepts.length + 1}`,
      ...(shot ? { shot } : {}),
      prompt,
      ...(refs ? { refs } : {}),
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
  // The one location the ad lives in, appended to every frame prompt at fire
  // time. Absent on legacy sessions and on a reply that dropped the tag, in
  // which case nothing is appended and behaviour matches the old build.
  const world = extractTag(body, 'WORLD') ?? undefined

  const scenes: ContinuousScene[] = []
  const frames: ContinuousFrame[] = []
  for (let i = 1; i <= MAX_SCENES; i++) {
    const sceneBlock = extractTag(body, `SCENE_${i}`)
    if (!sceneBlock) break
    const line = extractTag(sceneBlock, 'LINE') ?? ''
    // Only an explicit "no" hides the product — a missing tag leaves visibility
    // undefined, which reads as the old always-attach behaviour.
    const visibilityRaw = extractTag(sceneBlock, 'VISIBILITY')?.trim().toLowerCase()
    const productVisible = visibilityRaw === 'no' ? false : visibilityRaw === 'yes' ? true : undefined
    const frameBlock = extractTag(sceneBlock, 'FRAME') ?? sceneBlock
    const concepts = parseConcepts(frameBlock, productVisible)
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
      ...(productVisible === undefined ? {} : { productVisible }),
      // The boundary's connective device + anchor. Rides as context into every
      // motion rewrite so a regenerated clip still executes the planned link.
      transition: cleanPromptBody(extractTag(sceneBlock, 'TRANSITION') ?? ''),
      // The one physical thing happening in this beat. Rides into every frame
      // rewrite so an Enhance or a fresh concept keeps animating the same event.
      action: cleanPromptBody(extractTag(sceneBlock, 'ACTION') ?? '') || undefined,
      sfx: extractTag(sceneBlock, 'SFX') ?? '',
      durationSeconds: sceneDuration(line || input.scriptText, input.modelId),
    })
  }
  if (scenes.length === 0) return null

  // Final frame — the end state the last clip lands on. If the model dropped
  // it, reuse the last scene frame's concepts (fresh ids) so the chain still
  // has an end anchor rather than a broken last clip.
  // The final frame is the ad's payoff — the product is allowed, so no
  // visibility clamp here.
  const finalBlock = extractTag(body, 'FINAL_FRAME')
  const finalConcepts = finalBlock ? parseConcepts(finalBlock, undefined) : []
  frames.push({
    index: frames.length + 1,
    concepts: finalConcepts.length > 0
      ? finalConcepts
      : frames[frames.length - 1].concepts.map((c) => ({ ...c, id: nextConceptId() })),
  })

  return {
    style,
    ...(world ? { world } : {}),
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
  // The ONE location the ad lives in. Every rewrite has to stay inside it —
  // without this, an Enhance or a fresh concept invents a new set and the clip
  // has to interpolate between two different places.
  world?: string
  // The scene's physical action, so a rewrite keeps animating the same event.
  action?: string
  conceptLabel?: string
  // The concept's assigned shot class. Rides into Enhance and Regenerate so a
  // rewrite stays in its slot instead of sliding back to a medium shot of the
  // character — the collapse this whole slot system exists to stop.
  conceptShot?: string
  scriptLine: string
  inboundMotion?: string
  outboundMotion?: string
  // The connective device + anchor on each side of this frame. A rewrite that
  // drops the anchor breaks the chain, so both ride into every frame tool.
  inboundTransition?: string
  outboundTransition?: string
  // Whether the advertised product may appear in THIS frame (the visibility of
  // the scene it opens). Rides into every rewrite so an Enhance or Regenerate
  // can't quietly put the branded product back into a category-bashing beat.
  productVisible?: boolean
  isFinal: boolean
  isOpening: boolean
  existingLabels: string[]
  productContext?: string
  modelContext?: string
}

export function frameContextFor(
  result: ContinuousResult,
  frameIndex: number,
  ctx: {
    productContext?: string
    modelContext?: string
    conceptLabel?: string
    conceptShot?: string
    // The motions actually in play on the clips either side of this frame —
    // the picked concept's motion, or whatever the user hand-edited. Pass them
    // whenever they're known: `scene.motionPrompt` is only ever the FIRST
    // concept's motion, so grounding a rewrite in it describes a chain the
    // storyboard isn't using once the user picks concept 2 or 3.
    inboundMotion?: string
    outboundMotion?: string
  },
): FrameContext {
  const frame = result.frames.find((f) => f.index === frameIndex)
  const inbound = result.scenes.find((s) => s.index === frameIndex - 1)
  const outbound = result.scenes.find((s) => s.index === frameIndex)
  return {
    style: result.style,
    world: result.world,
    action: outbound?.action,
    conceptLabel: ctx.conceptLabel,
    conceptShot: ctx.conceptShot,
    scriptLine: outbound?.scriptLine ?? '',
    inboundMotion: ctx.inboundMotion?.trim() || inbound?.motionPrompt,
    outboundMotion: ctx.outboundMotion?.trim() || outbound?.motionPrompt,
    inboundTransition: inbound?.transition,
    outboundTransition: outbound?.transition,
    productVisible: outbound?.productVisible,
    isFinal: !outbound,
    isOpening: frameIndex === 1,
    existingLabels: frame?.concepts.map((c) => c.label) ?? [],
    productContext: ctx.productContext,
    modelContext: ctx.modelContext,
  }
}

// A single-card rewrite has to stay at its own shot size — the sizes across a
// frame's concepts are chosen to differ, so a rewrite that drifts to medium
// collapses the choice the user is there to make.
function shotBriefBlock(shot?: string): string {
  const label = shot?.trim()
  if (!label) return ''
  return `\nTHIS CONCEPT'S SHOT SIZE — keep it: ${label}. The other concepts of this frame deliberately sit at other sizes, so do not drift toward a medium shot or a portrait. Restate the size, the camera position as geometry (lens height, distance, angle), and where the subject sits — held in the middle band of the frame with clear margin all round, never at an edge.\n`
}

function frameBriefBlock(ctx: FrameContext, frameIndex: number): string {
  let out = `STYLE (fixed for the sequence — never restate it inside the prompt): ${ctx.style}\n`
  if (ctx.world?.trim()) {
    out += `\nWORLD — the ONE location this whole ad happens in. This frame is a shot taken somewhere INSIDE it, and you may not invent a new place, a void, a studio backdrop, or a different room:\n${ctx.world.trim()}\n`
  }
  if (ctx.action?.trim()) {
    out += `\nTHE ACTION happening in this beat — keep it; the frame shows THIS event caught mid-motion, just from this camera:\n${ctx.action.trim()}\n`
  }
  out += shotBriefBlock(ctx.conceptShot)
  out += ctx.isOpening
    ? '\nThis is the OPENING keyframe of the ad.\n'
    : `\nThe motion ARRIVING at this frame (from the previous keyframe):\n${ctx.inboundMotion || '(not specified)'}\n`
  if (ctx.inboundTransition?.trim()) {
    out += `The transition INTO this frame — the anchor named here must be visible in this frame, in the stated region of frame (at whatever size this concept's shot class implies):\n${ctx.inboundTransition.trim()}\n`
  }
  out += ctx.isFinal
    ? 'This is the FINAL keyframe — the end state the last clip lands on.\n'
    : `The narration line this frame opens: "${ctx.scriptLine}"\nThe motion LEAVING this frame (into the next keyframe):\n${ctx.outboundMotion || '(not specified)'}\n`
  if (!ctx.isFinal && ctx.outboundTransition?.trim()) {
    out += `The transition OUT of this frame — its anchor must also be visible here, in the stated region of frame (at whatever size this concept's shot class implies):\n${ctx.outboundTransition.trim()}\n`
  }
  if (ctx.productContext) {
    out += `\n${ctx.productContext}\n`
    out += ctx.productVisible === false
      ? 'PRODUCT VISIBILITY: NO for this beat — the advertised product must not appear in this frame at all. If the line needs a category object, describe a GENERIC unbranded stand-in explicitly: plain matte packaging, no logo, no brand name, no readable text, colours and shape deliberately unlike the advertised product. Never call it "the product".\n'
      : 'PRODUCT VISIBILITY: the advertised product may appear in this frame.\n'
  }
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

Return ONE flowing paragraph, usually 50-90 words, keeping the safe-zone note as a crop constraint (nothing essential in the top or bottom eighth) — never rewrite it into "the subject is centred". If the draft is a labelled multi-line block (SUBJECT: / SETTING: / ...), that is exactly what you are here to fix: fold it into one readable paragraph, keeping the idea.

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
A fresh idea means a new subject, a new metaphor, or a new camera position — it does NOT mean a new shot size if this card has a shot class above. Keep the class and find a different picture inside it. If this card has no shot class, pick something well away from a centred medium shot of the character.

Return ONE flowing paragraph, usually 50-90 words, including the safe-zone crop note.

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
// The storyboard writes each concept's motion before the user has picked the
// frame it has to land on — so it can only ever be right for one of the next
// frame's concepts. These tools close that gap: given the two ACTUAL rendered
// endpoints, they write the path between the pair the user actually chose.

export interface MotionContext {
  scriptLine: string       // the narration heard over this clip
  nextScriptLine?: string  // where the story goes next (direction, not destination)
  // The boundary's planned device + anchor, from the storyboard.
  transition?: string
  // The clip's real length, so the movement is paced to fill it.
  durationSeconds?: number
}

function motionBriefBlock(ctx: MotionContext): string {
  let out = `The narration heard over this clip: "${ctx.scriptLine}"\n`
  out += ctx.nextScriptLine
    ? `The story then moves toward: "${ctx.nextScriptLine}".\n`
    : 'This is the final beat of the ad.\n'
  if (ctx.transition?.trim()) out += `\nThe planned transition for this boundary — the device to execute and the anchor that carries across:\n${ctx.transition.trim()}\n`
  return out
}

// Fresh motion written from the clip's ACTUAL rendered endpoints. With both
// frames attached this is the real fix for a clip that hard-cuts: the model
// sees what it starts on AND what it must land on, so it can describe a path
// that actually connects them. `endImageDataUri` is optional only because the
// end keyframe may not be picked yet — with one image it falls back to writing
// a departure that heads in the story's direction.
export async function regenerateContinuousMotion(
  frames: { start: string; end?: string },
  ctx: MotionContext,
): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()
  const framing = frames.end
    ? `Two images are attached. The FIRST is this clip's fixed START frame; the SECOND is its fixed END frame. The video model begins exactly on the first and must land exactly on the second, inventing everything in between. Study both, find what they share, and write the path that carries one into the other.`
    : `The attached image is this clip's fixed START frame — the end frame has not been chosen yet. Write the path leaving this frame, headed in the story's direction.`
  const user = `Write the MOTION for one clip of a keyframe-chain ad. ${framing}

${motionBriefBlock(ctx)}
${motionFormat(ctx.durationSeconds)}

${FRAME_ENVELOPE_NOTE}
<MOTION>
one flowing paragraph
</MOTION>`
  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: CONTINUOUS_SYSTEM }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: user },
        { type: 'image_url', image_url: { url: frames.start } },
        ...(frames.end ? [{ type: 'image_url' as const, image_url: { url: frames.end } }] : []),
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
  const user = `Rewrite the motion prompt below to be MORE detailed and specific while keeping the SAME movement, direction, camera move, and sound. Sharpen the motion vectors and the transformation; do not change what happens or add a new beat. If the draft stops at the departure and never crosses or settles, that is exactly what you are here to fix — complete the trajectory.

${motionBriefBlock(ctx)}
${motionFormat(ctx.durationSeconds)}

Current motion:
"""
${draft}
"""

${FRAME_ENVELOPE_NOTE}
<MOTION>
one flowing paragraph
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
  concepts: { label: string; shot: string; prompt: string }[]
}

const DEMO_STYLE =
  'Glossy stylized 3D render in the viral explainer register: soft rounded characters with gently exaggerated proportions and smooth subsurface-scattering skin, forms built from clean bevelled geometry with no hard edges, a palette of deep midnight blue and slate grey lit by warm amber and honey-gold accents, soft volumetric lighting with a gentle rim light separating every subject from its background, shallow atmospheric haze in the deep field, and a high-detail premium-animated-short finish with subtle bloom around light sources. Never photoreal, never live-action, no film grain.'
const DEMO_WORLD =
  'A small lived-in bedroom at night: a low bed against the left wall under a thick quilted duvet, a wooden nightstand beside it holding a paperback and a sweating glass of water, a single window on the far wall with cool blue moonlight raking in from the upper left across the quilting, bare floorboards, everything else falling into unlit blue depth. The ad moves ONCE, on scene 2, from this bedroom into a warm amber cathedral-like space inside the head — arched walkways, glass channels carrying light, the same blue-and-amber palette — and returns to the bedroom for the payoff.'

const DEMO_SCENES = [
  {
    line: 'Your brain never actually switches off at night.',
    action: 'the warm point of light at the sleeping character\'s temple swells and pulses, spilling gold outward across the pillow',
    transition: 'Push through the glow: the warm circular light at the temple holds dead centre at the same scale and becomes the factory hall\'s central lamp as the camera travels into it.',
    motion: 'The amber glow at the sleeping character\'s temple swells and pulses, blooming outward across the pillow as the camera pushes in steadily from outside the window straight toward it. The glow opens and the camera keeps travelling into the light, the bedroom sliding past the edges of frame and dissolving into warm haze, the light widening around the lens until it reads as a room rather than a point. The push decelerates as the space settles open around it. A soft airy whoosh building into a low hum.',
    sfx: 'a soft airy whoosh',
  },
  {
    line: 'While you sleep, it runs a full cleanup cycle, flushing out the waste that builds up all day.',
    action: 'the amber orbs sweep forward down the channels, dragging the loose grey dust with them and flushing it out of the hall',
    transition: 'Morph on the central channel: the vertical stream of amber light stays centred at the same width and becomes the falling column of powder.',
    motion: 'The amber orbs lining the pathways stream forward and converge into the central channel while the loose grey dust lifts and travels with them, the camera orbiting slowly left and drifting down to follow the flow. The channel tightens into a single bright column running up the middle of frame, its edges softening as the surrounding hall falls away and the light thickens into falling grain. The orbit slows and the drift eases to a stop as the column steadies. A shimmering hum with a soft rushing undertone.',
    sfx: 'a gentle shimmering hum',
  },
  {
    line: 'One scoop of this before bed gives that cycle everything it needs.',
    action: 'the scoop tips and the glowing powder spills into the glass, twisting up into a rising spiral',
    transition: 'Pull back on the rising spiral: the amber helix stays centred and lengthens into the aura wrapping the sleeping character.',
    motion: 'The scoop tips and the powder spills, the falling grains catching light and twisting into a rising spiral as the camera pulls back steadily with a slight tilt up. The spiral climbs and widens as the pull-back opens the room around it, its light spreading outward across the bedding and softening at the edges until it wraps rather than rises. The pull-back decelerates and the drifting light eases into stillness. A soft magical pop, then a warm settling chime.',
    sfx: 'a soft magical pop',
  },
]

const DEMO_FRAMES: DemoFrameSpec[] = [
  {
    concepts: [
      {
        label: 'MOONLIT BEDROOM',
        shot: 'Wide',
        prompt: 'A small lived-in bedroom at night seen from outside through the window: the character asleep on their side under a thick quilted duvet, one arm folded beside the pillow, brow completely smooth, the whole bed reading small against the dark room around it. A single warm point of light glows at their temple, pooling gold on the pillow while cool blue moonlight rakes across the quilting from the upper left and picks out a paperback face-down on the nightstand. Wide from second-storey height about four metres back, angled down through the window frame, the bed held centrally with the dark room falling away around it and clear margin on every side.',
      },
      {
        label: 'TEMPLE GLOW MACRO',
        shot: 'Detail',
        prompt: 'Macro on the temple alone — only skin, hair and pillow in frame, no full face and no eyes. A single warm point of light pulses just above the cheekbone, the key source, wrapping the near skin in soft amber and falling off fast across fine hairs while cool moonlight rims the edge behind and separates it from the dark. Individual pillow fibres catch the glow and throw tiny shadows. Framed from pillow height a hand-span away, the glow held just off centre with the pillow weave filling the rest and nothing crucial near an edge.',
      },
      {
        label: 'OVERHEAD SLEEPER',
        shot: 'Character',
        prompt: 'Straight down onto the bed from directly above, two metres up: the character flat on their back, arms relaxed at their sides on top of the duvet, palms open and upward, head turned a few degrees on the pillow. The duvet folds radiate outward from the body like still ripples on water, deep and soft with visible weave. Flat cool blue light fills the room evenly with almost no hard shadow, and a soft amber halo at the temple is the only warm accent, glowing faintly into the pillow. The figure lies diagonally across frame, head in the upper left, the bare floor entering bottom right.',
      },
    ],
  },
  {
    concepts: [
      {
        label: 'NEURAL FACTORY',
        shot: 'Wide',
        prompt: 'The inside of the brain staged as a vast working factory hall: translucent neural pathways running through it as glass tubes carrying streams of small amber orbs, arched walkways branching overhead, a wide floor falling away into haze. Rounded cleanup drones sweep grey dust from the gantries with soft brushes, tiny against the architecture. Warm amber travels through the tubes and underlights everything from within while cool blue ambient falls from above, so the warm streams read bright against a cold room. Vast wide from high on an upper gantry looking down the hall, the lit central channel running up the middle of frame toward the far arches, the roof structure well inside the top margin.',
      },
      {
        label: 'RIVER OF LIGHT',
        shot: 'Detail',
        prompt: 'Macro at the surface of a luminous river of amber particles, close enough that individual grains separate and drift — loose grey motes tumbling among them and being carried away, the current filling the whole frame. Reeds of light break the surface at the near edge, refracting and throwing dancing reflections; thin mist sits just above the water and softens the far grains into bloom. No figure anywhere. Framed from a few centimetres above the surface looking downstream, the bright current running up the centre of frame with the banks holding comfortable margin either side.',
      },
      {
        label: 'CONTROL ROOM',
        shot: 'Character',
        prompt: 'A cosy mission-control room built inside the head, all rounded consoles and padded surfaces. A small rounded robot operator seen from behind and slightly to one side, both hands on a large lever pulled fully down, shoulders leaning into the pull, its single soft-glowing eye reflected in three curved screens showing tidy streams of light flowing outward. Chunky dials and glossy buttons fill the near foreground out of focus; a porthole looks into deep blue beyond, its cool backlight rimming the robot while warm screen amber washes the console. From just above shoulder height a metre behind, the robot held centrally in the lower half with the screens filling the space above it, margin clear all round.',
      },
    ],
  },
  {
    concepts: [
      {
        label: 'GLOW HANDOFF',
        shot: 'Wide',
        prompt: 'The whole bedroom from the far corner: the character\'s hand setting the product down on the nightstand, fingers still resting on the lid, while a ribbon of warm light arcs the length of the room from the product to their head on the pillow, physically connecting the two across the frame. The ribbon is the key source, glowing along its whole length with soft translucent edges, spilling onto the duvet and the back of the hand, while cool moonlight fills everything it does not touch. Faint particles drift along the arc. Wide from standing height three metres back, the bed running away up the middle of frame with the product small and just off centre, everything well inside the margins.',
      },
      {
        label: 'SCOOP POUR',
        shot: 'Detail',
        prompt: 'Macro on a rounded scoop tipping slowly, releasing a stream of glowing powder into a glass of water below, the grains separating in the fall and the water already spiralling with amber light where the stream has entered. Tiny bubbles climb the inside of the glass; light bends and refracts through it, throwing a small warm caustic onto the tabletop. Only glass, scoop and powder in frame, the bedroom behind reduced to unfocused dark blue. Framed at glass height a hand-span away, three-quarter from the left, the glass centred low with the scoop entering just above it, both clear of the edges.',
      },
      {
        label: 'HERO JAR RISE',
        shot: 'Close',
        prompt: 'Close on the product standing upright on the bedside table in the blue night bedroom, lid off beside it, a gentle spiral of glowing powder rising from the open mouth and curling out of the top of frame. A warm amber glow climbs from inside the container and underlights the spiral from below, while cool moonlight from the window rims its left edge and catches a sweating glass of water just behind. The bed and the sleeping figure read as a soft silhouette in the deeper background. From just below the product\'s shoulder height half a metre away, angled up so it reads heroic, the product standing centrally with clear margin on every side.',
      },
    ],
  },
  {
    concepts: [
      {
        label: 'AURA WIDE',
        shot: 'Wide',
        prompt: 'The whole bedroom at dawn seen from the far wall, the character asleep and completely still, small in the frame, wrapped head to toe in an even calm amber aura that follows the contour of their body under the duvet. The aura is the dominant source, lifting the nearby bedding, floor and nightstand out of the dark with a soft graduated falloff and a gentle bloom across the whole room. The window behind is warming toward dawn, its cool-to-warm gradient meeting the aura halfway across the floor. Vast wide from ceiling height four metres back, angled gently down, the bed low in frame with the room open above it.',
      },
      {
        label: 'BRAIN AT PEACE',
        shot: 'Detail',
        prompt: 'Macro on one last amber orb drifting slowly upward, filling the frame, its translucent shell trailing a soft bloom and its interior showing faint moving light. Behind it the factory hall reads only as clean out-of-focus shapes glowing steady even amber — the cleanup drones parked and stowed, no dust anywhere, the earlier cold blue gone to a faint edge. Surfaces catch shallow soft reflections. Framed at orb height a few centimetres away as it rises, the orb held centrally with the blurred arches falling away behind it.',
      },
      {
        label: 'RESTORED MORNING',
        shot: 'Character',
        prompt: 'The same bedroom at sunrise, the character sitting up in bed mid-stretch with both arms raised and elbows bent, back arched, eyes open and face bright with an easy unforced smile, seen in three-quarter profile from across the room. The duvet has fallen to their waist in crisp creases. Warm golden light streams in from the window behind them, rimming hair and shoulders, throwing a long soft shadow across the bed and catching a specular highlight on the product\'s curve on the nightstand beside the now-empty glass. Dust drifts in the sunbeam. From knee height two metres away, angled up, the figure sitting just off centre with the window light spilling across the frame, clear margin above the raised arms.',
      },
    ],
  },
]

export function buildDemoContinuousResult(modelId: string, styleId: string): ContinuousResult {
  let stamp = 0
  return {
    style: DEMO_STYLE,
    world: DEMO_WORLD,
    styleId,
    realism: false,
    modelId,
    demo: true,
    scenes: DEMO_SCENES.map((s, i) => ({
      index: i + 1,
      scriptLine: s.line,
      motionPrompt: s.motion,
      transition: s.transition,
      action: s.action,
      sfx: s.sfx,
      durationSeconds: sceneDuration(s.line, modelId),
    })),
    frames: DEMO_FRAMES.map((f, i) => ({
      index: i + 1,
      concepts: f.concepts.map((c) => ({ id: `demo-cont-${++stamp}`, label: c.label, shot: c.shot, prompt: c.prompt })),
    })),
  }
}
