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

import type { ContinuousConcept, ContinuousFrame, ContinuousResult, ContinuousScene, ReferenceImage, VariationRefs } from '../types'
import { useSettingsStore, resolveScriptModel } from '../../../stores/settingsStore'
import { kieChatCompletions, LONG_CHAT_TIMEOUT_MS, type ChatMessage } from '../../../utils/kie'
import { getChatTarget, type ChatTarget } from '../../../utils/models'
import { autoClipSeconds } from './clipDuration'
import { IPHONE_REALISM_SUFFIX, NO_ON_SCREEN_TEXT_SUFFIX } from './realism'
import { extractBlock, extractNumberedBlock } from './xmlBlocks'
import { parsePhotoPick, productPhotoDataUris, productPhotoInstruction } from './productAngles'

// Models LISTED in the Continuous picker. The whole mode is first/last-frame
// interpolation, so only frames-to-video models are actually selectable — the
// panel greys the rest via requireMode='frames-to-video' so the user can see
// (and understand) why they're unavailable. Image-only (Kling Turbo) and
// frame-less (Gemini Omni 1.0, Grok, Seedance 2.5) models are listed but land
// greyed — Omni Flash 1.1 is the one in that family with real frame fields, so
// it is selectable here.
// Seedance 1.5 Pro is the default — first/last-frame native and materially
// cheaper per clip than the 2.0 family, at a quality that holds up for this
// style. The picker lives in the CLIP modal, not the left panel: the model
// only matters once there are keyframes to animate.
export const CONTINUOUS_MODEL_IDS = [
  'bytedance/seedance-2-5',
  'bytedance/seedance-2',
  'bytedance/seedance-2-fast',
  'bytedance/seedance-2-mini',
  'bytedance/seedance-1.5-pro',
  'minimax-h3',
  'kling-3.0/video',
  'kling-3.0-omni',
  'grok-imagine-video-1-5-preview',
  'wan/3-0-video',
  'wan/3-0-video-prime',
  'wan/2-7',
  'kling/v3-turbo-image-to-video',
  'google/gemini-omni-flash-1-1',
  'gemini-omni-video',
]

export const CONTINUOUS_DEFAULT_MODEL_ID = 'bytedance/seedance-1.5-pro'

// How many visual concepts each keyframe fans out into. More live in the
// per-frame "Add concept" button.
export const CONCEPTS_PER_FRAME = 3

// Clip length for one scene's narration slice. The estimator itself now lives
// in services/clipDuration, shared with Line-by-Line — the two modes cut the
// same script into the same beats, so they had no business disagreeing about
// how long a line takes to say. What's local is the floor: these clips are
// quick, punchy beats, so a five-word line still gets a real move at 3s rather
// than the 4s a talking-head card wants.
export function sceneDuration(scriptLine: string, modelId: string): number {
  return autoClipSeconds(scriptLine, modelId, { min: 3 })
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

// Every chat call Continuous makes — the storyboard, frame Enhance/Regenerate,
// motion Enhance/Regenerate — runs on the model picked in B-Roll's left panel.
// Same slot Line-by-Line reads, since they're one app to the member.
function chatTarget(): ChatTarget {
  return getChatTarget(resolveScriptModel('broll-studio'))
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

// Fire-time style treatment for Line-by-Line results (the shared
// counterpart of buildContinuousPrompt). Only an explicitly stylized look
// (realism === false — e.g. 3D Animated, Anime, or a custom brief distilled
// from reference frames) actually restyles the render: its STYLE block is
// appended to the prompt and the app's iPhone-realism stack is switched off (the
// two fight each other). UGC Realism (realism === true) and legacy results
// (realism undefined) are left exactly as before — same prompt, realism stack on
// — so today's default output is unchanged until a style is picked. Kept in one
// place so both modes stay consistent.
export function applyStyleToPrompt(
  editablePrompt: string,
  style: { style?: string; realism?: boolean } | null | undefined,
): { prompt: string; noRealism: boolean } {
  const stylized = !!style && style.realism === false && !!style.style?.trim()
  if (!stylized) return { prompt: editablePrompt, noRealism: false }
  return { prompt: `${editablePrompt.trim()}\n\nSTYLE: ${style!.style!.trim()}`, noRealism: true }
}

// What a Line-by-Line render actually bolts onto the prompt, for the read-only
// note at the top of a card's workspace. Both of these ride OUTSIDE the
// editable prompt so they can't be forked per card — which also means that note
// is the only place a member can read them.
//
// It mirrors applyStyleToPrompt deliberately, so the note can never claim
// something the render won't do: a stylized look appends its STYLE block and
// drops the realism stack, while UGC Realism (and legacy results, whose
// `realism` is undefined) keep the stack and append nothing. Keep the two in
// step. Continuous doesn't need this — it appends the brief unconditionally, so
// its modals show `result.style` directly.
export function appliedStyleNote(
  style: { style?: string; realism?: boolean } | null | undefined,
): { label: string; text: string } {
  // The no-text guarantee rides on EVERY render, stylized or not (see
  // withNoOnScreenText), so it joins both branches rather than one.
  if (style?.realism === false && style.style?.trim()) {
    return { label: 'Style (applied automatically)', text: `${style.style.trim()} ${NO_ON_SCREEN_TEXT_SUFFIX}` }
  }
  return { label: 'Realism (applied automatically)', text: `${IPHONE_REALISM_SUFFIX} ${NO_ON_SCREEN_TEXT_SUFFIX}` }
}

// Reference preamble for keyframe image generation. The chain reference (the
// previous frame's chosen keyframe) is the character-lock protocol: it fixes
// style/character/environment continuity without inheriting composition.
export function buildContinuousPreamble(opts: {
  chain: boolean
  character: boolean
  product: boolean
  // How many of the product's extra bank angles ride along with the hero shot.
  productAngles?: number
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
    if ((opts.productAngles ?? 0) > 0) {
      // One object, several shots — see productAnglesClause in generateBroll.
      parts.push(
        'Several product photos are attached: they are ONE single product shot from different angles and in different states (in and out of its packaging, opened, from the back) — never several products, never a multipack. EXACTLY ONE of the product appears in the frame you render, in the state the scene below calls for; the other photos exist only to get that state right. Never draw a second copy of it anywhere in shot.',
      )
    }
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
// Tuned across three rounds, and the useful summary is what NOT to do:
//   - Round one: "the subject is centred with comfortable margins" made every
//     frame a centred medium shot of the character, so assigned Wide/Detail/
//     Character slots forced scale variety.
//   - Round two: the slots plus a push for subject variety made the frames stop
//     looking like the same ad, and rewriting the margin rule to *encourage*
//     off-centre framing pushed subjects off the 9:16 edges.
//   - Now: the job of a keyframe is to make the spoken line instantly readable.
//     MEDIUM is the home base; go tighter for a detail, slightly wider when the
//     action needs room, and never so wide that the viewer has to hunt for the
//     subject. No aerials, no vast establishing shots.
// So there is no scale mandate at all any more. What survives are the framing
// guardrails that were doing real work: the character reference is an identity
// card whose crop must be ignored, the subject sits safely in frame, camera
// position is geometry, and the chest-up-portrait-square-to-the-lens shot stays
// banned. Variety between concepts comes from the IDEA, not from forced scale.
const SHOT_LADDER = 'medium-wide · medium · close-up · macro'

// Shot labels the parser normalises <SHOT> onto for the card chip. Order
// matters: 'medium-wide' before 'medium', or the shorter one swallows it.
const SHOT_LABELS = ['Medium-wide', 'Medium', 'Close-up', 'Macro']

const SHOT_VOCABULARY = `Name each concept's shot size in <SHOT>, off this short ladder:

${SHOT_LADDER}

MEDIUM is the default and the safest answer. This frame has one job — a viewer scrolling with the sound off should read what the line means in an instant — and a medium shot is what makes a person, their hands, and the thing they are dealing with all legible at once. Move off medium only when the line asks for it: close-up or macro when the claim is about a texture, a detail, or a small thing; medium-wide when the action genuinely needs floor space.

Never go wider than medium-wide. No aerials, no vast establishing shots, no compositions where the subject is a small figure in a large room — they look impressive and they cost the viewer the very thing this frame exists to deliver.

Camera position is geometry: lens height relative to the subject, distance from it, angle. Never a chest-up portrait square to the lens with the character staring down the barrel — that is the one shot this format cannot use; a slight low angle, a three-quarter, an over-the-shoulder or a view past something in the foreground all read better and stay just as clear.

And the subject stays SAFELY IN FRAME: held in the middle band of the picture — dead centre, or on a third at most — fully inside it with clear margin all round, never touching or bleeding off an edge, never shoved into a corner. Vertical 9:16 crops and overlays at the edges, so an edge-weighted composition loses its subject.`

// ── Prompt formats ─────────────────────────────────────────────
//
// One flowing paragraph each, matching Line-by-Line: the labelled
// multi-field structure these used to carry read disjointed and crowded out the
// actual idea. Keyframes keep two extra requirements the clip modes don't need —
// an explicit safe-zone note, because 9:16 platform UI overlays the frame edges
// (a CROP rule only: written as "centre the subject" it quietly turned every
// keyframe into a centred medium shot), and the START-FRAME rule below.
//
// The start-frame rule exists because "an ACTION, caught mid-motion" was read as
// "draw the action at its peak" — frames came back with the bite already taken
// and the powder already poured, which is the END of the beat. The clip then has
// nowhere to travel: the model either holds the frame still or races past it and
// freezes. A keyframe is frame ONE of the clip, so it has to hold the action
// back at its first instant with the whole move still ahead of it.

const KEYFRAME_FORMAT = `Every keyframe prompt is ONE flowing paragraph. There is NO word limit and no target length — write as long as it takes to pin the image down completely, and never drop a detail to keep it short. Vagueness is the only failure; length is not. Plain, concrete, readable — no labels, no field names, no line breaks, no "Style:" trailer.

THIS IS A START FRAME. Each keyframe is the FIRST frame of the clip that follows it, and a video model animates forward from it. So describe the action at its OPENING INSTANT — the moment it has only just begun, with nearly all of it still to come: weight shifted but the step not landed, the wrapper gripped and the tear an inch long, the scoop tipped just past level with the first grains leaving the edge, teeth touching the surface but not yet through it, the mouth beginning to open on the reaction. NEVER the middle of the action and never its aftermath — a frame that already shows the bite taken, the powder poured, the door shut, or the expression fully landed leaves the clip nothing to perform. Before you finish a frame, ask: is there a whole action still left to play out from here? If not, wind it back to its first instant.

Write it like you're describing a still you're looking at right now: what's in frame and in what state (the exact pose, hand position, gaze, and the expression as a real muscle action — "brows drawn together, jaw set", never "looking sad"), the actual space and the two or three specific props that sell it, where the light comes from and its colour, and the materials and textures that make it feel rendered rather than sketched. If there's no character, the hero object and its exact orientation carry the frame.

Always state the framing as three separate things: the SHOT SIZE, taken off this ladder (${SHOT_LADDER}) and matching the concept's declared <SHOT>; the CAMERA POSITION as pure geometry — lens height relative to the subject, distance from it, and angle ("from knee height about four metres back, angled up") — and WHERE IN THE FRAME the subject sits. The camera is a viewpoint, never a prop: never name the filming device (no phone, iPhone, smartphone, front camera, tripod, ring light), not in a hand, not on a table, not in a reflection, and never a mirror selfie.

SAFE FRAMING: the subject sits in the middle band of the frame — dead centre, or on a third at most — fully inside the picture with clear margin on every side, never touching or bleeding off an edge, never pushed into a corner. Platform UI also overlays roughly the top and bottom eighth of a vertical 9:16 frame, so keep faces and readable labels out of those bands.

Never name the art style, medium, or render technique — the style block is appended separately to every prompt. No captions, subtitles, watermarks, on-screen text, logos, or UI of any kind.`

// The clip is handed the start and end keyframes and invents the middle. All
// this prompt has to do is describe that movement and name a sound.
//
// It has been through a three-beat scaffold (DEPARTURE / CROSSING / SETTLE) with
// a boundary "transition device + anchor" riding alongside it. Both are gone:
// they were a lot of ceremony for a prompt whose whole job is "say what moves".
// One line from that era earns its place and stays — describe the movement, not
// a picture of the end frame, because painting the final tableau makes the model
// race there and freeze for the rest of the clip.
function motionFormat(durationSeconds?: number): string {
  const pacing = durationSeconds
    ? `The clip runs ${durationSeconds} seconds — spread the movement across all of it.`
    : 'Spread the movement across the whole clip (roughly as long as the line takes to speak, never under three seconds).'
  return `Describe the motion, simply and clearly, in ONE paragraph. No labels, no field names, no word limit — say everything the movement needs, and nothing it doesn't.

The clip opens on a frame where the action has only just begun, so this is where that action actually plays out. Say what starts moving in the frame and in which direction, and how the camera moves — push in, pull back, orbit, tilt, track alongside, or hold steady. Keep it physical and specific to this staging. ${pacing}

Write the MOVEMENT, not a description of the end frame: "the push-in slows as the hand eases to a stop" is right, painting the final pose as a picture is not. Never name an edit — no "cut to", "dissolve to", "then we see".

Finish with one sound direction — a soft whoosh, a low rumble, a gentle pop, a dry crunch, or silence. Never write dialogue, narration, or music; a voiceover and a music bed are added later in the edit.`
}

const MOTION_FORMAT = motionFormat()

// ── The storyboard system prompt ───────────────────────────────

// Exported so the Import-prompts brief can hand an outside model the EXACT
// rules this mode generates against — one source of truth, no drift.
export const CONTINUOUS_SYSTEM = `# ROLE

You are the creative director of viral explainer ads — the Zack D Films register: short vertical videos that feel like ONE continuous, morphing shot. You storyboard in keyframes: every narration line gets a start image, the next line's image is simultaneously this line's end state, and a video model interpolates the motion between each pair. Because clip N literally ends on clip N+1's first frame, the cuts are invisible.

# YOUR JOB

Turn the user's script into a STORYBOARD:

1. Take the script's lines as the SCENES, one per line, verbatim — see SCENES below. Never split or merge them.
2. For every scene, decide VISIBILITY: whether the advertised product is allowed on screen for that beat — see WHOSE PRODUCT IS ON SCREEN below.
3. For every scene, design its START keyframe — literally the first frame of that scene's clip, so its action must be caught at the instant it BEGINS with the whole move still to come. After the last scene, design one FINAL keyframe (the end state the last clip lands on). So there is always exactly ONE more frame than there are scenes.
4. Give every keyframe ${CONCEPTS_PER_FRAME} distinct visual CONCEPTS — ${CONCEPTS_PER_FRAME} different ideas for showing that line, each declaring its shot size and the REFERENCE IMAGES it needs.
5. For every CONCEPT of every non-final keyframe, write the MOTION that animates THAT staging into the next beat. Motion belongs to the staging, not the scene — two different ideas for the same beat travel differently —. Final-frame concepts get NO motion (nothing leaves the last frame).

# SCENES COME FROM THE SCRIPT'S OWN LINES — DO NOT SEGMENT

The user's script is already broken into lines, and those lines ARE the scenes. You get them numbered. Produce exactly one <SCENE_N> per numbered line, in order, and set <LINE> to that line VERBATIM — every word, same order, nothing added, nothing dropped, nothing reworded.

Do NOT split a line, however many visual ideas you think it carries. Do NOT merge a short line into its neighbour. Do NOT reorder, and do not invent a scene the script does not have. If a line holds two ideas, pick the one image that best carries the whole line and commit to it — the user can split that scene themselves afterwards if they want to, and that is their call, not yours.

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
- If the line makes a claim, show the evidence — and the evidence is the outcome turning up in a life, never the spec that causes it: the bottle scraped empty after a month, not the ingredient list on its back.
- If the line is emotional, show the emotion landing inside a real moment — never a face in a void.

When the script points at the product itself, the product IS the visual. When the script attacks the category, the generic stand-in is the visual — never the product. A viewer watching with the sound off should be able to guess the narration.

A BENEFIT IS A PICTURE, A SPEC IS NOT. When a line makes a promise, show the promise KEPT inside a life — the gym bag already by the door at six in the morning, the jeans that button — never the object that produces it turned round to its ingredient list. And when the product IS the visual, it is the product being USED or the result it left behind, never presented to camera and never its packaging read like a spec sheet. The specs in the product context exist to tell you which outcome is worth showing: never draw one, as a badge, a panel, a printed claim, or numbers anywhere in frame.

# THE ONE RULE — AN ACTION THAT SHOWS THE LINE, CAUGHT AT ITS FIRST INSTANT

If you remember one thing: every keyframe is an ACTION that shows what its line SAYS, frozen at the moment that action BEGINS, and each scene gets ${CONCEPTS_PER_FRAME} different ways to do it.

- ACTION, not a state. Something is physically happening: cardboard slabs going over the edge of the counter, a wrapper tearing, a bar bending toward the snap, powder starting to spill, a thumb pressing into dough. "The character holds the bar" is not an action.
- CAUGHT AT ITS FIRST INSTANT. This frame is the clip's FIRST frame, so the action must still be almost entirely ahead of it: the slabs have just tipped and not yet fallen, the tear is an inch long, the bar is bowed with the first crack showing, the teeth are touching the cardboard but haven't gone through. If the frame shows the action finished — bite taken, powder poured, reaction fully landed — the clip has nowhere to go and the video model either holds still or jumps. Write the beginning, never the peak or the aftermath.
- It SHOWS THE LINE. The one test that matters: someone watching with the sound off should be able to guess the narration from the picture. If the frame does not visibly say what the line says, nothing else about it can save it.
- ${CONCEPTS_PER_FRAME} DIFFERENT ways. The concepts of a frame are genuinely different ideas for showing that same line — a different action, a different object, a different way of picturing it — not one idea shot from ${CONCEPTS_PER_FRAME} angles. The user is choosing between real alternatives.
- Keep it READABLE. This is a scrolling viewer with no sound; the frame has to land instantly. One clear subject, one clear action, no puzzle. Clarity beats cleverness every time.

The FINAL frame is the only exception — it is an end state the last clip settles onto, nothing animates out of it, so it may rest and it may show an action completed.

# SPECIFICITY

Vague direction renders as generic footage. Every frame names the exact prop, the exact body and hand position, the exact expression, the real light source, and the actual material. Write each keyframe the way you'd describe a still you're looking at, not the way you'd pitch it. If a prompt could describe two visually different images, it isn't finished — add specificity, never another scene. Take all the words you need: nothing here is scored on brevity, and a detail cut for length is a detail the model invents for you.

Banned everywhere: "beautiful", "stunning", "modern", "clean", "minimalist", "high quality", "professional", "cinematic vibe", "looking happy/sad/frustrated" (name what the face is actually doing), "using the product" (name the actual action).

# KEYFRAME RULES

- Each keyframe is a single striking image: one clear subject, one readable idea. If a frame needs a sentence of explanation to work, simplify the idea — then describe the simpler idea in full detail.
- SAFE FRAMING: the subject sits in the middle band of the frame (centre, or on a third at most) with clear margin all round — never touching an edge, never bleeding off, never in a corner; and faces and readable labels stay out of the top and bottom eighth where platform UI sits.
- THE CAMERA IS A VIEWPOINT, NOT A PROP. Never name the filming device — no phone, iPhone, smartphone, front camera, tripod or ring light; nothing held, propped, or reflected; never a mirror selfie. State camera position as geometry instead: lens height, distance, angle.
- CONTINUITY IS EVERYTHING: consecutive keyframes must read as two moments of the same film. Same character design, same palette, and the same setting unless the line itself moves somewhere else. Frame N+1 must be a state that frame N can physically morph or move into.
- Refer to the on-screen person as "the character" and the advertised product as "the product" — reference images fix their exact look. Never describe the character's identity (gender, age, ethnicity, hair colour, skin tone); pose, expression, gesture, and body language ARE required.
- The words "the product" mean the ADVERTISED product and nothing else. Never use them for a generic stand-in — describe that one physically instead ("a plain unmarked bar in a blank grey wrapper").
- Gender-neutral language only: never he/him/his/she/her, never "subject". Use "the character" or "they/them/their".
- Never mention the art style, medium, or render technique inside a frame prompt — the style is appended separately.

# CONSECUTIVE FRAMES HAVE TO CONNECT

Every clip is generated by a model handed frame N as its fixed first image and frame N+1 as its fixed last image, and it has to invent the movement between them. So frame N+1 must be a state frame N could plausibly move or morph into — a later moment of the same situation, not an unrelated picture. Two frames that share nothing leave no path between them, and the model animates for a second and then hard-cuts onto the last image.

This is also why every frame holds its action back to the first instant. Frame N opens scene N's action and frame N+1 opens scene N+1's, so scene N's clip is exactly the span where scene N's action plays out. A frame drawn at the peak of its action has already spent the clip that was supposed to perform it.

Beyond that, keep it simple: same character, same look, and a change the eye can follow.

# KEYFRAME PROMPT FORMAT (EVERY CONCEPT)

${KEYFRAME_FORMAT}

# CONCEPT VARIATIONS

The ${CONCEPTS_PER_FRAME} concepts for one keyframe are ${CONCEPTS_PER_FRAME} genuinely different ideas for showing that line — different actions, different objects, different pictures — each one readable on its own. Vary the idea first; let the shot size follow from what each idea needs rather than shuffling scales for their own sake. Two concepts that differ only in how far away the camera is are not two ideas.

${SHOT_VOCABULARY}

Each concept carries its OWN motion, matched to its staging. Every concept gets the same depth on both the frame and its motion; a thinner alternative is a failure.

# MOTION PROMPT FORMAT (EVERY SCENE)

${MOTION_FORMAT}

# OUTPUT FORMAT (STRICT)

Wrap your answer in this exact XML envelope. No text outside the tags, no markdown fences.

<STORYBOARD>
<STYLE>One dense paragraph of 90-150 words locking the visual style for the whole sequence — medium and rendering technique, how forms and figures are treated, the named colour palette, the lighting register, and the camera/finish character. Adapt the style brief you are given to this specific script and product. This paragraph is appended verbatim to every image and video prompt, so it must be pure style direction with no subject matter in it.</STYLE>
<SCENE_1>
<LINE>exact narration slice, one visual idea, in the script's own words</LINE>
<VISIBILITY>yes|no</VISIBILITY>
<FRAME>
<CONCEPT_1>
<LABEL>2-4 word slug naming the camera, e.g. ACROSS THE ISLAND</LABEL>
<SHOT>one size off the ladder</SHOT>
<REFS>character|product|both|none</REFS>
<PROMPT>one flowing paragraph, as long as it needs — an action that shows what this line says, caught at the instant it begins</PROMPT>
<MOTION>one paragraph: what moves and in which direction, how the camera moves, and one sound direction. Movement, never a picture of the end frame.</MOTION>
</CONCEPT_1>
<CONCEPT_2>a DIFFERENT idea for showing the same line, same depth, with its OWN SHOT, REFS and matched MOTION</CONCEPT_2>
<CONCEPT_3>a third DIFFERENT idea for the same line, same depth, with its OWN SHOT, REFS and matched MOTION</CONCEPT_3>
</FRAME>
</SCENE_1>
(repeat <SCENE_N> for every scene, in script order)
<FINAL_FRAME>
<CONCEPT_1>
<LABEL>2-4 word slug</LABEL>
<SHOT>one size off the ladder</SHOT>
<REFS>character|product|both|none</REFS>
<PROMPT>one flowing paragraph, as long as it needs — the still, described (NO motion; nothing leaves the final frame, so this one may rest)</PROMPT>
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
  // Every photo the product bank row holds, hero first. More than one and they
  // ride along as numbered vision inputs so each concept can name the state its
  // shot needs — see productPhotoInstruction.
  productPhotos?: ReferenceImage[]
  // Scene staging for the picked Script Style, when that style is a FORMAT.
  // Same block Scripts stages a blueprint with — see BrollInput.sceneStaging.
  sceneStaging?: string
}

// The storyboard's system half. `productPhotoCount` is how many photos the
// product bank row holds — more than one and the model is shown all of them and
// asked to name which each concept needs, so a frame can't be handed the sealed
// wrapper AND the unwrapped bar and draw both. Exported so the Import-prompts
// brief carries the same rules.
export function continuousSystemInstruction(productPhotoCount = 0): string {
  return productPhotoCount > 1
    ? CONTINUOUS_SYSTEM + productPhotoInstruction(productPhotoCount, 'concept')
    : CONTINUOUS_SYSTEM
}

// The script's own lines are the scenes — see the SCENES section of the system
// prompt. Numbering them here (rather than pasting the raw block and hoping)
// makes the one-scene-per-line contract explicit and gives the model the exact
// count to hit.
export function scriptLines(scriptText: string): string[] {
  return scriptText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
}

export function buildContinuousUserPrompt(input: ContinuousInput): string {
  const lines = scriptLines(input.scriptText)
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
  let prompt = `Storyboard this script as a keyframe-chain ad.\n\nThe script's ${lines.length} line${lines.length === 1 ? '' : 's'}, which are the scenes — produce exactly ${lines.length} scene${lines.length === 1 ? '' : 's'}, one per numbered line, each <LINE> verbatim:\n${numbered}\n\nSTYLE BRIEF (adapt into the <STYLE> block): ${styleBriefFor(input)}\n`
  if (input.styleBrief?.trim()) {
    prompt += `\nThat style brief was reverse-engineered from reference frames the user supplied. Honour it exactly — it outranks any default look you would otherwise reach for.\n`
  }
  if (input.productContext) {
    prompt += `\n${input.productContext}\nThis is the ADVERTISED product — a photo of it is attached as a reference to any frame whose REFS include product. Decide VISIBILITY per scene: a line that attacks the category shows a generic unbranded stand-in, described as such in the prompt, with no product reference attached.\n`
  }
  if (input.modelContext) {
    prompt += `\n${input.modelContext}\nIMPORTANT: never describe the character's physical appearance — say "the character"; a reference image fixes their look.\n`
  }
  // The picked format's staging, when it has one. Structures carry none — an
  // argument doesn't imply a camera position. The token guard is because the
  // block writes [CHARACTER] / [PRODUCT] for a format with reference slots, and
  // a keyframe prompt is plain prose an image model reads literally.
  if (input.sceneStaging) {
    prompt += `\n${input.sceneStaging}\nStage every keyframe concept this way. Never write the words "[CHARACTER]" or "[PRODUCT]" in a prompt — say "the character" and name the product in plain words; the app attaches the real reference images at render time.\n`
  }
  if (input.additionalContext) prompt += `\nAdditional context and instructions:\n${input.additionalContext}\n`
  prompt += `\nWrite the full <STORYBOARD> now — exactly ${lines.length} scene${lines.length === 1 ? '' : 's'}, one per numbered line above, each <LINE> reproduced word for word. Every keyframe concept gets the same depth — no thinning out on the later scenes.

Before you answer, run this check and rewrite anything that fails:
1. Does every keyframe show an ACTION — something physically happening — that visibly says what its line says? Sound off, could a viewer guess the narration?
2. Is every keyframe (except the final one) caught at the FIRST INSTANT of that action, with the whole move still ahead of it? Any frame showing the action finished — bite taken, powder poured, reaction landed — must be wound back to its opening moment.
3. Are the ${CONCEPTS_PER_FRAME} concepts of each frame ${CONCEPTS_PER_FRAME} genuinely different ideas, not one idea at three distances?
4. Is every shot medium by default, no wider than medium-wide, with the subject held in the middle band of the frame and clear margin all round? No chest-up portrait square to the lens.
5. Is there exactly one scene per script line, with each <LINE> verbatim and nothing split or merged?`
  return prompt
}

// ── Parser ─────────────────────────────────────────────────────

// Leaf-field read. Tolerant of a missing closing tag — see xmlBlocks.ts.
function extractTag(source: string, tag: string): string | null {
  return extractBlock(source, tag)
}

// Strip straggler control tags from a prompt body so a misformed response never
// pastes raw XML into an editable field.
function cleanPromptBody(text: string): string {
  return text
    .replace(/<LABEL>[\s\S]*?<\/LABEL>/gi, '')
    .replace(/<REFS>[\s\S]*?<\/REFS>/gi, '')
    .replace(/<PHOTOS>[\s\S]*?<\/PHOTOS>/gi, '')
    .replace(/<SHOT>[\s\S]*?<\/SHOT>/gi, '')
    .replace(/<VISIBILITY>[\s\S]*?<\/VISIBILITY>/gi, '')
    .replace(/<\/?(STORYBOARD|SCENE_\d+|CONCEPT_\d+|FINAL_FRAME|FRAME|PROMPT|LABEL|REFS|PHOTOS|SHOT|VISIBILITY|LINE|MOTION|STYLE)>/gi, '')
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
    const block = extractNumberedBlock(frameBlock, 'CONCEPT', j)
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
    // Which product photo this staging needs (sealed wrapper / unwrapped / open
    // box). Absent → the card falls back to the hero photo alone.
    const productPhotos = parsePhotoPick(extractTag(block, 'PHOTOS'))
    concepts.push({
      id: nextConceptId(),
      label: extractTag(block, 'LABEL') ?? `Option ${concepts.length + 1}`,
      ...(shot ? { shot } : {}),
      prompt,
      ...(refs ? { refs } : {}),
      ...(productPhotos ? { productPhotos } : {}),
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
    const sceneBlock = extractNumberedBlock(body, 'SCENE', i)
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
      sfx: extractTag(sceneBlock, 'SFX') ?? '',
      durationSeconds: sceneDuration(line || input.scriptText, input.modelId),
    })
  }
  if (scenes.length === 0) return null

  // Final frame — the end state the last clip lands on. If the model dropped
  // it, reuse the last scene frame's concepts (fresh ids) so the chain still
  // has an end frame rather than a broken last clip.
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
    styleId: input.styleId,
    realism: styleUsesRealism(input.styleId, !!input.styleBrief?.trim()),
    scenes,
    frames,
    modelId: input.modelId,
  }
}

// ── Entry points ───────────────────────────────────────────────

/**
 * The keyframe-chain storyboard call's messages. Split out from the call for
 * the same reason as Line-by-Line's (see buildBrollMessages): the storyboard
 * runs as a resumable job now, and the transport is chosen in one place —
 * services/storyboardRun.ts.
 */
export async function buildContinuousMessages(input: ContinuousInput): Promise<ChatMessage[]> {
  const photoUris = await productPhotoDataUris(input.productPhotos)
  return [
    { role: 'system', content: [{ type: 'text', text: continuousSystemInstruction(photoUris.length) }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: buildContinuousUserPrompt(input) },
        ...photoUris.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ],
    },
  ]
}

// Shared context for the per-frame prompt tools (Add concept / Enhance /
// Regenerate) — everything the LLM needs to write a frame that still chains.
export interface FrameContext {
  style: string
  conceptLabel?: string
  // The concept's assigned shot class. Rides into Enhance and Regenerate so a
  // rewrite stays in its slot instead of sliding back to a medium shot of the
  // character — the collapse this whole slot system exists to stop.
  conceptShot?: string
  scriptLine: string
  inboundMotion?: string
  outboundMotion?: string
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
    conceptLabel: ctx.conceptLabel,
    conceptShot: ctx.conceptShot,
    scriptLine: outbound?.scriptLine ?? '',
    inboundMotion: ctx.inboundMotion?.trim() || inbound?.motionPrompt,
    outboundMotion: ctx.outboundMotion?.trim() || outbound?.motionPrompt,
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
  out += shotBriefBlock(ctx.conceptShot)
  out += ctx.isOpening
    ? '\nThis is the OPENING keyframe of the ad.\n'
    : `\nThe motion ARRIVING at this frame (from the previous keyframe):\n${ctx.inboundMotion || '(not specified)'}\n`
  out += ctx.isFinal
    ? 'This is the FINAL keyframe — the end state the last clip lands on. Nothing animates out of it, so this is the one frame that may rest or show an action completed.\n'
    : `The narration line this frame opens: "${ctx.scriptLine}"\nThe motion LEAVING this frame (into the next keyframe):\n${ctx.outboundMotion || '(not specified)'}\nTHIS IS A START FRAME — the first frame of that clip. Catch its action at the instant it BEGINS, with the whole move still ahead of it. Never the peak of the action and never its aftermath; a frame that shows the action already done leaves the clip nothing to perform.\n`
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
  const endpoint = chatTarget()
  const user = `Rewrite the keyframe prompt below to be MORE detailed and specific while keeping the SAME staging, shot size, camera angle, and story state. Sharpen every field — the exact pose and hand position, the named props, the real light source and its colour, the material textures — and fill any of the five fields the draft never covered. Do not change what the image is of.

${frameBriefBlock(ctx, frameIndex)}
${ctx.conceptLabel ? `\nThis concept's staging: ${ctx.conceptLabel}\n` : ''}
Current prompt:
"""
${draft}
"""

Return ONE flowing paragraph with NO word limit — enhance means the prompt comes back richer and longer than it went in, never trimmed to a length. Keep the safe-zone note as a crop constraint (nothing essential in the top or bottom eighth) — never rewrite it into "the subject is centred". If the draft is a labelled multi-line block (SUBJECT: / SETTING: / ...), that is exactly what you are here to fix: fold it into one readable paragraph, keeping the idea.

${FRAME_ENVELOPE_NOTE}
<PROMPT>
one flowing paragraph
</PROMPT>`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: CONTINUOUS_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: user }] },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages, { timeoutMs: LONG_CHAT_TIMEOUT_MS })
  return cleanPromptBody(extractTag(responseText, 'PROMPT') ?? responseText)
}

// Fresh take on the same keyframe slot — a different staging entirely.
export async function regenerateContinuousFrame(ctx: FrameContext, frameIndex: number): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = chatTarget()
  const user = `Write a FRESH prompt for this keyframe — a genuinely different staging from any previous version, same story state.

${frameBriefBlock(ctx, frameIndex)}
${ctx.existingLabels.length ? `\nStagings already used on this frame: ${ctx.existingLabels.join(' · ')}\n` : ''}
A fresh idea means a new subject, a new metaphor, or a new camera position — it does NOT mean a new shot size if this card has a shot class above. Keep the class and find a different picture inside it. If this card has no shot class, pick something well away from a centred medium shot of the character.

Return ONE flowing paragraph with NO word limit — as long as it takes to pin the image down — including the safe-zone crop note.

${FRAME_ENVELOPE_NOTE}
<PROMPT>
one flowing paragraph
</PROMPT>`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: CONTINUOUS_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: user }] },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages, { timeoutMs: LONG_CHAT_TIMEOUT_MS })
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
  // The clip's real length, so the movement is paced to fill it.
  durationSeconds?: number
}

function motionBriefBlock(ctx: MotionContext): string {
  let out = `The narration heard over this clip: "${ctx.scriptLine}"\n`
  out += ctx.nextScriptLine
    ? `The story then moves toward: "${ctx.nextScriptLine}".\n`
    : 'This is the final beat of the ad.\n'
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
  const endpoint = chatTarget()
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
  const responseText = await kieChatCompletions(apiKey, endpoint, messages, { timeoutMs: LONG_CHAT_TIMEOUT_MS })
  return cleanPromptBody(extractTag(responseText, 'MOTION') ?? responseText)
}

// Rewrite the user's draft motion richer — same movement, sharper detail.
export async function enhanceContinuousMotion(draft: string, ctx: MotionContext): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = chatTarget()
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
  const responseText = await kieChatCompletions(apiKey, endpoint, messages, { timeoutMs: LONG_CHAT_TIMEOUT_MS })
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
const DEMO_SCENES = [
  {
    line: 'Your brain never actually switches off at night.',
    motion: 'The amber glow at the sleeping character\'s temple swells and pulses, spilling gold outward across the pillow as the camera pushes in steadily toward it. The push decelerates and the light steadies. A soft airy whoosh building into a low hum.',
    sfx: 'a soft airy whoosh',
  },
  {
    line: 'While you sleep, it runs a full cleanup cycle, flushing out the waste that builds up all day.',
    motion: 'The amber orbs stream forward down the channels, dragging the loose grey dust along with them, as the camera orbits slowly left and drifts down to follow the flow. The orbit slows to a stop. A shimmering hum with a soft rushing undertone.',
    sfx: 'a gentle shimmering hum',
  },
  {
    line: 'One scoop of this before bed gives that cycle everything it needs.',
    motion: 'The scoop tips and the glowing powder spills, the falling grains catching light and twisting upward as the camera pulls back steadily with a slight tilt up. The pull-back eases to a rest. A soft magical pop, then a warm settling chime.',
    sfx: 'a soft magical pop',
  },
]

const DEMO_FRAMES: DemoFrameSpec[] = [
  {
    concepts: [
      {
        label: 'MOONLIT BEDROOM',
        shot: 'Medium-wide',
        prompt: 'A small lived-in bedroom at night seen from outside through the window: the character asleep on their side under a thick quilted duvet, one arm folded beside the pillow, brow completely smooth, the whole bed reading small against the dark room around it. A single warm point of light glows at their temple, pooling gold on the pillow while cool blue moonlight rakes across the quilting from the upper left and picks out a paperback face-down on the nightstand. Medium-wide from just outside the window at bed height, angled slightly down through the window frame, the bed and nightstand filling most of the frame with the character centred and clear margin all round.',
      },
      {
        label: 'TEMPLE GLOW MACRO',
        shot: 'Macro',
        prompt: 'Macro on the temple alone — only skin, hair and pillow in frame, no full face and no eyes. A single warm point of light pulses just above the cheekbone, the key source, wrapping the near skin in soft amber and falling off fast across fine hairs while cool moonlight rims the edge behind and separates it from the dark. Individual pillow fibres catch the glow and throw tiny shadows. Framed from pillow height a hand-span away, the glow held just off centre with the pillow weave filling the rest and nothing crucial near an edge.',
      },
      {
        label: 'OVERHEAD SLEEPER',
        shot: 'Medium',
        prompt: 'Straight down onto the bed from directly above, two metres up: the character flat on their back, arms relaxed at their sides on top of the duvet, palms open and upward, head turned a few degrees on the pillow. The duvet folds radiate outward from the body like still ripples on water, deep and soft with visible weave. Flat cool blue light fills the room evenly with almost no hard shadow, and a soft amber halo at the temple is the only warm accent, glowing faintly into the pillow. The figure lies diagonally across frame, head in the upper left, the bare floor entering bottom right.',
      },
    ],
  },
  {
    concepts: [
      {
        label: 'NEURAL FACTORY',
        shot: 'Medium-wide',
        prompt: 'The inside of the brain staged as a vast working factory hall: translucent neural pathways running through it as glass tubes carrying streams of small amber orbs, arched walkways branching overhead, a wide floor falling away into haze. Rounded cleanup drones sweep grey dust from the gantries with soft brushes, tiny against the architecture. Warm amber travels through the tubes and underlights everything from within while cool blue ambient falls from above, so the warm streams read bright against a cold room. Medium-wide from walkway height a few metres back, the lit central channel running up the middle of frame with two drones working at its edge, the arches reading close overhead.',
      },
      {
        label: 'RIVER OF LIGHT',
        shot: 'Macro',
        prompt: 'Macro at the surface of a luminous river of amber particles, close enough that individual grains separate and drift — loose grey motes tumbling among them and being carried away, the current filling the whole frame. Reeds of light break the surface at the near edge, refracting and throwing dancing reflections; thin mist sits just above the water and softens the far grains into bloom. No figure anywhere. Framed from a few centimetres above the surface looking downstream, the bright current running up the centre of frame with the banks holding comfortable margin either side.',
      },
      {
        label: 'CONTROL ROOM',
        shot: 'Medium',
        prompt: 'A cosy mission-control room built inside the head, all rounded consoles and padded surfaces. A small rounded robot operator seen from behind and slightly to one side, both hands on a large lever pulled fully down, shoulders leaning into the pull, its single soft-glowing eye reflected in three curved screens showing tidy streams of light flowing outward. Chunky dials and glossy buttons fill the near foreground out of focus; a porthole looks into deep blue beyond, its cool backlight rimming the robot while warm screen amber washes the console. From just above shoulder height a metre behind, the robot held centrally in the lower half with the screens filling the space above it, margin clear all round.',
      },
    ],
  },
  {
    concepts: [
      {
        label: 'GLOW HANDOFF',
        shot: 'Medium-wide',
        prompt: 'The whole bedroom from the far corner: the character\'s hand setting the product down on the nightstand, fingers still resting on the lid, while a ribbon of warm light arcs the length of the room from the product to their head on the pillow, physically connecting the two across the frame. The ribbon is the key source, glowing along its whole length with soft translucent edges, spilling onto the duvet and the back of the hand, while cool moonlight fills everything it does not touch. Faint particles drift along the arc. Medium-wide from table height a couple of metres back, the product standing just off centre in the near foreground with the ribbon of light running back to the bed behind, everything well inside the margins.',
      },
      {
        label: 'SCOOP POUR',
        shot: 'Macro',
        prompt: 'Macro on a rounded scoop tipping slowly, releasing a stream of glowing powder into a glass of water below, the grains separating in the fall and the water already spiralling with amber light where the stream has entered. Tiny bubbles climb the inside of the glass; light bends and refracts through it, throwing a small warm caustic onto the tabletop. Only glass, scoop and powder in frame, the bedroom behind reduced to unfocused dark blue. Framed at glass height a hand-span away, three-quarter from the left, the glass centred low with the scoop entering just above it, both clear of the edges.',
      },
      {
        label: 'HERO JAR RISE',
        shot: 'Close-up',
        prompt: 'Close on the product standing upright on the bedside table in the blue night bedroom, lid off beside it, a gentle spiral of glowing powder rising from the open mouth and curling out of the top of frame. A warm amber glow climbs from inside the container and underlights the spiral from below, while cool moonlight from the window rims its left edge and catches a sweating glass of water just behind. The bed and the sleeping figure read as a soft silhouette in the deeper background. From just below the product\'s shoulder height half a metre away, angled up so it reads heroic, the product standing centrally with clear margin on every side.',
      },
    ],
  },
  {
    concepts: [
      {
        label: 'AURA WIDE',
        shot: 'Medium-wide',
        prompt: 'The whole bedroom at dawn seen from the far wall, the character asleep and completely still, small in the frame, wrapped head to toe in an even calm amber aura that follows the contour of their body under the duvet. The aura is the dominant source, lifting the nearby bedding, floor and nightstand out of the dark with a soft graduated falloff and a gentle bloom across the whole room. The window behind is warming toward dawn, its cool-to-warm gradient meeting the aura halfway across the floor. Medium-wide from standing height a couple of metres back, angled gently down, the bed filling the lower half of frame with the glowing figure centred.',
      },
      {
        label: 'BRAIN AT PEACE',
        shot: 'Macro',
        prompt: 'Macro on one last amber orb drifting slowly upward, filling the frame, its translucent shell trailing a soft bloom and its interior showing faint moving light. Behind it the factory hall reads only as clean out-of-focus shapes glowing steady even amber — the cleanup drones parked and stowed, no dust anywhere, the earlier cold blue gone to a faint edge. Surfaces catch shallow soft reflections. Framed at orb height a few centimetres away as it rises, the orb held centrally with the blurred arches falling away behind it.',
      },
      {
        label: 'RESTORED MORNING',
        shot: 'Medium',
        prompt: 'The same bedroom at sunrise, the character sitting up in bed mid-stretch with both arms raised and elbows bent, back arched, eyes open and face bright with an easy unforced smile, seen in three-quarter profile from across the room. The duvet has fallen to their waist in crisp creases. Warm golden light streams in from the window behind them, rimming hair and shoulders, throwing a long soft shadow across the bed and catching a specular highlight on the product\'s curve on the nightstand beside the now-empty glass. Dust drifts in the sunbeam. From knee height two metres away, angled up, the figure sitting just off centre with the window light spilling across the frame, clear margin above the raised arms.',
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
      concepts: f.concepts.map((c) => ({ id: `demo-cont-${++stamp}`, label: c.label, shot: c.shot, prompt: c.prompt })),
    })),
  }
}
