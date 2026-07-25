import type { VideoMode, ImageResolution } from '../../utils/models'

export type SceneType =
  | 'A-ROLL CHARACTER'
  | 'A-ROLL PRODUCT'
  | 'B-ROLL LIFESTYLE'
  | 'B-ROLL DETAIL'
  | 'B-ROLL REACTION'
  | 'B-ROLL ENVIRONMENT'

// Shot role for a variation. Every scene now gets 4 SILENT b-roll variations,
// each role picked by the LLM per line from the selectable menu (ALL_TAGS), so
// the mix adapts to what each script line earns. No shot speaks — a voiceover is
// laid over the footage in the edit.
//
// DIALOGUE (old talking-head anchor) and STATIC (old locked anchor take) are
// retained in this union so legacy persisted cards still render, but neither is
// offered to the model any more — they're absent from ALL_TAGS.
export type VariationTag =
  | 'DIALOGUE'
  | 'STATIC'
  | 'ACTION'
  | 'EMOTIONAL'
  | 'PRODUCT'
  | 'POV'
  | 'ENVIRONMENT'
  | 'TRANSITION'
  | 'PROOF'

// LLM-emitted hint declaring which reference images this variation needs
// attached when we run image / reference-to-video generation. 'none' = no
// refs (rare — e.g. pure environment beats). 'character' = character only.
// 'product' = product only. 'both' = both refs. The card mirrors this into
// two user-overridable toggle pills (refsCharacter / refsProduct).
export type VariationRefs = 'character' | 'product' | 'both' | 'none'

// Where in the ad's narrative arc this line sits. Drives the LLM's choice
// of shot register (hook = urgent / mechanism = clearest / payoff = warm
// etc) — surfaced on the scene header for the user, otherwise informational.
export type LinePosition = 'hook' | 'reframe' | 'mechanism' | 'payoff' | 'CTA'

export interface PromptVariation {
  id: string
  // Canonical tag for chip coloring + filtering.
  tag: VariationTag
  // Descriptive shot label the LLM picks per the new prompt's menu (e.g.
  // "TALKING-TO-CAMERA / CLOSE-IN", "MIRROR REACTION"). Surfaced under the
  // tag chip so the user sees both the bucket and the actual shot intent.
  label: string
  // Which references the LLM thinks this variation should attach by default.
  // The user can override via the card's refs toggle pills.
  refs: VariationRefs
  prompt: string
}

export interface Scene {
  number: number
  type: SceneType
  scriptLine: string
  // Position of this line in the ad's arc. Informational for now.
  position?: LinePosition
  // LLM's call on whether the product is allowed on-screen for this line.
  // false on hook / reframe lines that should land before the product is
  // named. true once the line earns the product reveal.
  productVisible?: boolean
  variations: PromptVariation[]
}

export interface BrollResult {
  scenes: Scene[]
  // Visual style resolved at generation time (preset hint or the reference
  // brief). Appended as a STYLE block to each image/video prompt at fire time —
  // see applyStyleToPrompt. Optional so rows persisted before styles were wired
  // into Line-by-Line default to the untouched UGC render.
  style?: string
  // True only for the UGC Realism style — the one look that keeps the app's
  // iPhone-realism suffix on. Every stylized style bypasses it. Undefined on
  // legacy rows, which are treated as UGC (stack on, no STYLE appended).
  realism?: boolean
  // The picked style — id (→ friendly label via getContinuousStyle) or, when
  // the look was distilled from reference frames, `styleBrief` set instead.
  // Drives the style pill in the Scenes header (parity with Continuous). Both
  // optional so legacy rows fall back to the UGC Realism label.
  styleId?: string
  styleBrief?: string
  // Display name of a saved custom style, so the Scenes header pill can read
  // "Warm 90s Camcorder" instead of a generic "Custom style".
  styleName?: string
  // One shared voice description for the whole ad's dialogue clips. Auto-written
  // in "With Dialogue" delivery and user-editable; appended to every DIALOGUE
  // card's video prompt at fire time so all talking clips share one voice.
  // Undefined in silent delivery and on legacy rows.
  voiceProfile?: string
}

export interface ReferenceImage {
  dataUrl: string
  label: string
}

export interface BrollInput {
  productId: string | null
  modelId: string | null
  scriptId: string | null
  scriptText: string
  additionalContext: string
  productContext: string
  modelContext: string
  referenceImages: ReferenceImage[]
  // Visual-style pick shared with Continuous mode. `styleBrief` (distilled from
  // reference frames) overrides the preset `styleId` when present.
  styleId: string
  styleBrief?: string
  styleName?: string
  // 'silent'   — every variation is silent b-roll (the default; a voiceover is
  //              laid over in the edit).
  // 'dialogue' — one variation per scene is a talking-to-camera DIALOGUE shot
  //              (the character speaks the exact line); the other three stay
  //              silent b-roll. Reuses OneShotDelivery — see BrollStudio.
  delivery: OneShotDelivery
}

export interface GeneratedImage {
  imageUrl: string
  prompt: string
  // The image model that produced this generation, shown on the gallery tile.
  // Optional because entries persisted before this field existed won't have it.
  modelId?: string
  // Stamped on completion so the modal's right-column gallery can day-bucket
  // images the same way Playground does. Older persisted entries get
  // backfilled to Date.now() during hydrate.
  createdAt: number
}

// A completed video generation kept on the card. Multiple videos can be
// generated per card (regenerate, animate-from-different-stills, etc.) and
// the user picks which one is the "cover" — see CardState.selected.
export interface GeneratedVideo {
  url: string
  modelId: string
  prompt: string
  aspectRatio: string
  durationSeconds: number
  resolution: string
  audio: boolean
  mode: VideoMode
  sourceBRollId?: string
  createdAt: number
}

// Which output the user wants on the scene card's face. When unset, the
// face falls back to the most-recent generation (image preferred).
export interface SelectedOutput {
  kind: 'image' | 'video'
  index: number
}

// An image generation that's currently mid-flight. Stored as an array on
// CardState so the user can fire multiple Generate Image clicks in parallel
// (matches Playground's parallel queue). Each entry survives a refresh via
// usePersistedState; the resume effect picks them up by taskId.
export interface InFlightImage {
  id: string
  taskId: string | null
  modelId: string | null
  startedAt: number
  prompt: string
  aspectRatio: string
  resolution: string
  error?: string | null
}

// An in-flight video generation. Same parallel-queue semantics as images.
export interface InFlightVideo {
  id: string
  taskId: string | null
  modelId: string
  endpoint?: 'veo'
  startedAt: number
  prompt: string
  mode: VideoMode
  aspectRatio: string
  durationSeconds: number
  resolution: string
  audio: boolean
  sourceBRollId?: string
  // The still this clip animates from (asset ref, not a data URI — these
  // entries are persisted). Only set for image/reference-to-video gens, and
  // only so Retry can replay the SAME generation instead of silently falling
  // back to text-to-video.
  startFrameRef?: string
  error?: string | null
}

export interface CardState {
  editablePrompt: string
  // Linear undo/redo history for the prompt. Each entry is a snapshot pushed
  // on Done-after-edit, Enhance, or Regenerate prompt. promptHistoryIndex
  // points at the live entry; Undo decrements, Redo increments. Trimmed of
  // forward branch on new push.
  promptHistory: string[]
  promptHistoryIndex: number
  images: GeneratedImage[]
  currentImageIndex: number
  // Completed videos for this card. The legacy CardState held one `videoUrl`
  // string slot — the sanitize pass migrates that into the first entry here
  // so older sessions don't lose their videos.
  videos: GeneratedVideo[]
  currentVideoIndex: number
  // Which output appears on the scene card's face. Updated when the user
  // clicks a thumbnail in the modal's right column. Null = let the card
  // fall back to whatever generation it has (image preferred).
  selected: SelectedOutput | null
  // Parallel queue of mid-flight image generations. Each Generate Image
  // click pushes an entry; refresh-resume walks this list. On success the
  // entry is removed and the result appended to `images`.
  inFlightImages: InFlightImage[]
  // Same for videos.
  inFlightVideos: InFlightVideo[]
  isGeneratingImage: boolean
  imageError: string | null
  // Per-card image generation settings — owned by each card, not the page.
  // Switches the mini-playground modal's Image tab inputs.
  cardImageAspectRatio: string
  cardImageResolution: ImageResolution
  // Per-card video generation settings.
  cardVideoAspectRatio: string
  cardVideoDurationSeconds: number
  cardVideoResolution: string
  cardVideoAudio: boolean
  // True while the prompt-rewrite LLM call is in flight (Enhance or Regenerate).
  // Drives a "Working…" overlay on the prompt section.
  isPromptWorking?: boolean
  promptError?: string | null
  // In-flight kie taskId persisted across refresh so polling can resume.
  // Cleared once the image lands in `images[]` or when the user resets the card.
  pendingTaskId: string | null
  pendingModelId: string | null
  pendingStartedAt: number | null
  // Per-card manual override of which references attach when the user runs
  // image gen or reference-to-video. Initialised from the variation's `refs`
  // field via refsToToggles(), then preserved across regenerates.
  refsCharacter: boolean
  refsProduct: boolean
  // Video gen state for this card. The card produces at most one video at a time.
  videoStatus: 'idle' | 'generating' | 'error'
  videoUrl: string | null
  videoError: string | null
  videoTaskId: string | null
  videoModelId: string | null
  // 'veo' identifies the Veo custom endpoint so the resume effect picks the
  // right poller. Undefined for the standard createTask/recordInfo pipeline.
  videoEndpoint?: 'veo'
  videoStartedAt: number | null
  // Preserves save-linkage if the card's image was sourced from a bank still.
  videoSourceBRollId?: string
  // Snapshot of constraints used to start the in-flight video, so a resumed
  // history item is byte-identical to one finished in-session.
  videoAspectRatio: string | null
  videoDurationSeconds: number | null
  videoResolution: string | null
  videoAudio: boolean | null
  videoMode: VideoMode | null
  videoPrompt: string | null
}

// ── One Shot mode ──────────────────────────────────────────────
// Instead of splitting the script line-by-line into silent stills, One Shot
// asks the LLM for 4 complete video concepts — each a full master prompt a
// multi-cut-capable model (Seedance 2.0 etc.) renders as ONE ≤15s clip. A
// script longer than the model's max clip splits into sequential segments
// that share identical world/voice blocks so they cut together.

export type BrollMode = 'line' | 'oneshot' | 'continuous'

// 'dialogue' — the character speaks the actual script lines on camera.
// 'silent'   — pure silent b-roll montage; a voiceover is laid over in the
//              edit (the line-by-line mode's posture, at full-clip scale).
export type OneShotDelivery = 'dialogue' | 'silent'

export interface OneShotSegment {
  index: number              // 1-based position within the concept
  scriptExcerpt: string      // the exact script slice this clip covers
  prompt: string             // scene blueprint for this clip (+ VOICE PROFILE when dialogue)
  durationSeconds: number    // snapped UP onto the plan model's duration grid
}

export interface OneShotConcept {
  id: string
  angle: string              // short creative-angle title, e.g. "DEMO-FIRST"
  summary: string            // one-line concept description
  segments: OneShotSegment[]
  // The ONE_SHOT_ANGLES pool entry this concept was generated from. `angle`
  // above is the LLM's own slug and can't be matched back to the pool, so
  // Add-variation reads this to pick a genuinely unused angle. Absent on rows
  // generated before it existed.
  poolAngle?: string
}

export interface OneShotResult {
  concepts: OneShotConcept[]
  delivery: OneShotDelivery
  // Visual style resolved at generation time, appended as a STYLE block to each
  // clip prompt at fire time (see applyStyleToPrompt). Optional — legacy rows
  // and the demo default to the untouched UGC render.
  style?: string
  // True only for UGC Realism (keeps the iPhone-realism stack on). Stylized
  // looks set false; undefined on legacy rows is treated as UGC.
  realism?: boolean
  // Model the segment split was computed against. A later model swap shows a
  // stale-plan hint instead of silently re-splitting.
  modelId: string
  estimatedSeconds: number
  segmentCount: number
  // True when the script needed more than MAX_SEGMENTS clips — the LLM was
  // told to tighten beats rather than drop lines, but the user should trim.
  capped?: boolean
  // Sample data shown when no kie.ai key is set — a preview of the feature,
  // not a real generation. Drives the "sample concepts" banner.
  demo?: boolean
}

// Slim per-segment card state, keyed `${conceptId}:${segmentIndex}`. Reuses
// GeneratedVideo / InFlightVideo verbatim so the resume walker, videoHistory
// push, and asset handling are identical to line-by-line cards.
export interface OneShotCardState {
  editablePrompt: string
  // Undo/redo history for the blueprint, same shape as CardState — pushed on
  // Enhance / Regenerate / commit-after-edit; the index points at the live entry.
  promptHistory: string[]
  promptHistoryIndex: number
  videos: GeneratedVideo[]
  currentVideoIndex: number
  inFlightVideos: InFlightVideo[]
  refsCharacter: boolean
  refsProduct: boolean
  // Follow-up clips (segment index > 1) carry the previous clip's LAST FRAME as
  // a reference image so the setting + character position continue. On by
  // default; the user can toggle it off per clip. Ignored on the first clip and
  // when the previous clip hasn't rendered yet (no frame to grab).
  carryPrevFrame?: boolean
  aspectRatio: string
  resolution: string
  // Seeded from the segment's planned length; user-overridable in the detail
  // modal. Snapped to the active model's grid at fire time.
  durationSeconds: number
  // Kept on even in silent delivery: the prompt's AUDIO rules ban speech and
  // music, but diegetic room tone is wanted footage an editor can always mute.
  audio: boolean
}

// ── Continuous mode (keyframe chain) ─────────────────────────────
// Zack-D-Films-style continuous ads. The script splits into narration scenes;
// every scene has a START keyframe and the NEXT scene's keyframe is
// simultaneously this scene's END state — so each clip is a frames-to-video
// generation (first frame = keyframe N, last frame = keyframe N+1) and the cuts
// are invisible. Frames come as multiple visual CONCEPTS the user picks from
// before any video credits are spent.

// One visual concept for a keyframe — a distinct way to stage the same story
// state. Variations differ in composition/metaphor, never in story state, so
// any pick still chains with the neighbouring frames.
export interface ContinuousConcept {
  id: string
  label: string
  // The concept's shot size, off SHOT_LADDER (medium-wide / medium / close-up /
  // macro). Medium is the default: a keyframe's job is to make the spoken line
  // instantly readable, and anything wider costs the viewer that. No scale
  // mandate across a frame's concepts — they differ by IDEA. Shown as a chip on
  // the card and fed into Enhance/Regenerate so a rewrite holds its size.
  // Absent on legacy sessions and hand-added concepts.
  shot?: string
  prompt: string
  // Which reference images this staging should attach, as decided by the
  // storyboard. Mirrors PromptVariation.refs — the card turns it into the two
  // toggle pills the user can override. Absent on legacy sessions and on
  // hand-added concepts, which fall back to the scene's product visibility.
  refs?: VariationRefs
  // Departure motion for THIS specific staging — how this concept animates
  // forward into the next beat. Motion belongs to the start frame's concept,
  // not the frame pair: picking a concept as the keyframe auto-carries its
  // motion into the clip that starts on it. Absent on final-frame concepts
  // (nothing leaves the last frame) and on legacy sessions.
  motionPrompt?: string
}

// Keyframe slot N (1-based). frames.length === scenes.length + 1 — the last
// frame is the final end-state and starts no scene.
export interface ContinuousFrame {
  index: number
  concepts: ContinuousConcept[]
}

// One narration beat: its script slice and planned length. Motion now lives on
// the start frame's concepts (ContinuousConcept.motionPrompt) so it can be
// staging-specific; `motionPrompt` here survives only as a fallback seed for the
// clip (the first concept's departure motion) and to keep legacy rows rendering.
export interface ContinuousScene {
  index: number
  scriptLine: string
  motionPrompt: string
  // Whether the real product is allowed on screen for this beat. False on lines
  // that attack the category ("stop eating chalky protein bars") — those show an
  // unbranded generic stand-in, and the product reference must NOT attach or the
  // model renders the user's own packaging as the thing being criticised.
  // Absent on legacy sessions, which are treated as visible (the old behaviour).
  productVisible?: boolean
  sfx: string
  // Planned clip length — spoken seconds snapped UP onto the plan model's grid.
  durationSeconds: number
}

export interface ContinuousResult {
  // The storyboard-wide style block, appended to every image/video prompt at
  // fire time (never shown inside the editable per-frame prompt).
  style: string
  styleId: string
  // True only for the UGC Realism style — the one look that keeps the app's
  // iPhone-realism suffix on. Every stylized storyboard bypasses it. Optional
  // so rows persisted before the flag existed default to stylized.
  realism?: boolean
  scenes: ContinuousScene[]
  frames: ContinuousFrame[]
  // Video model the clip durations were planned against.
  modelId: string
  // Sample data shown when no kie.ai key is set.
  demo?: boolean
}

// Which image is the chosen keyframe for a frame slot. Keyed by frame index
// (stringified) in a persisted map. imageIndex points into the chosen
// concept's card images[] (append-only, so indices stay stable).
export interface ContinuousSelection {
  conceptId: string
  imageIndex: number
}

// Per-concept card state, keyed `${frameIndex}:${conceptId}`. Primarily an image
// card (mirrors the Line-by-Line card's image half), plus an optional STANDALONE
// Animate path: the frame modal's Animate tab image-to-video's this frame's
// chosen still on its own (NOT chained into the keyframe sequence).
export interface ContinuousFrameCardState {
  editablePrompt: string
  // Linear undo/redo history, same shape as CardState — pushed on Enhance /
  // Regenerate / commit-after-edit; the index points at the live entry.
  promptHistory: string[]
  promptHistoryIndex: number
  images: GeneratedImage[]
  currentImageIndex: number
  inFlightImages: InFlightImage[]
  // Which references attach on generate. Chain = the previous frame's chosen
  // keyframe as a style/continuity reference (the character-lock protocol).
  // Defaults ON: this is continuous mode, and chaining is what makes the frames
  // feel like one story. It shipped off for a while because all of a frame's
  // concepts then anchor to one image and come back similar, but in practice the
  // continuity is worth more than the spread, and the per-frame pill turns it off.
  chainLink: boolean
  refsCharacter: boolean
  refsProduct: boolean
  aspectRatio: string
  resolution: ImageResolution
  // ── Standalone Animate (frame modal's Animate tab) ──
  // Editable motion for the one-off image-to-video of this frame's still,
  // seeded from the concept's departure motion. Independent of the chained clip.
  animateMotion: string
  videos: GeneratedVideo[]
  currentVideoIndex: number
  inFlightVideos: InFlightVideo[]
  videoDurationSeconds: number
  videoResolution: string
  videoAudio: boolean
}

// Per-clip card state, keyed `c${sceneIndex}`. Video-only — the clip animates
// keyframe N → keyframe N+1 with the scene's motion prompt.
export interface ContinuousClipCardState {
  editablePrompt: string
  // Linear undo/redo history for the motion prompt (Enhance / Regenerate from
  // frame / commit-after-edit), same shape as the frame card.
  promptHistory: string[]
  promptHistoryIndex: number
  // True once the user hand-edits the motion. While false, the clip's motion
  // auto-syncs to its start frame's picked concept; once true, picks stop
  // clobbering the user's text.
  motionEdited: boolean
  videos: GeneratedVideo[]
  currentVideoIndex: number
  inFlightVideos: InFlightVideo[]
  durationSeconds: number
  resolution: string
  audio: boolean
}

// Helpers for translating the LLM's `refs` enum into the two toggle booleans
// the card stores. Kept in this module so OutputPanel + the migration in
// BrollStudio.tsx share the same logic.
export function refsToToggles(refs: VariationRefs): { refsCharacter: boolean; refsProduct: boolean } {
  switch (refs) {
    case 'character': return { refsCharacter: true, refsProduct: false }
    case 'product':   return { refsCharacter: false, refsProduct: true }
    case 'both':      return { refsCharacter: true, refsProduct: true }
    case 'none':      return { refsCharacter: false, refsProduct: false }
  }
}
