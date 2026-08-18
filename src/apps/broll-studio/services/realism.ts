// Deterministic iPhone-realism trailer for every B-Roll generation.
//
// The LLM system prompt already asks for the realism stack to be woven into
// the prose, but that's probabilistic — and users can hand-edit prompts.
// Appending here (at generation time, in startImageTask / startVideoTask)
// guarantees every image and video request ends with the stack without
// polluting the editable prompt text shown on the card.
export const IPHONE_REALISM_SUFFIX =
  'Modern iPhone camera quality, unedited photorealism, matching A-roll lighting, zero bokeh, zero depth of field, sharp focus across entire frame.'

// The CAMERA line of a structured prompt (SETTING / CAMERA / LIGHTING / ACTION
// / DIALOGUE / AUDIO). That field owns the quality register, so the stack lands
// there rather than after the final field.
const CAMERA_FIELD = /^CAMERA:.*$/m

function append(text: string): string {
  const sep = /[.!?]$/.test(text.trim()) ? ' ' : '. '
  return `${text.trim()}${sep}${IPHONE_REALISM_SUFFIX}`
}

export function withIphoneRealism(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) return trimmed
  // Don't double-append if the exact stack is already present (e.g. a retry
  // of a prompt that was persisted post-suffix).
  if (trimmed.toLowerCase().includes(IPHONE_REALISM_SUFFIX.toLowerCase())) return trimmed
  // Structured prompts end on AUDIO, so appending to the whole string would file
  // "zero bokeh, sharp focus" under what the clip SOUNDS like. Put it in CAMERA,
  // the field that owns the quality register, and fall back to a plain trailing
  // sentence for unlabelled prompts (hand-written or pre-format sessions).
  if (CAMERA_FIELD.test(trimmed)) return trimmed.replace(CAMERA_FIELD, (line) => append(line))
  return append(trimmed)
}

// ── No on-screen text ──────────────────────────────────────────
//
// "No captions, subtitles, or on-screen text" has always been a rule in the
// prompt-WRITING instructions — but that's a rule the chat model has to obey
// while writing, and the image model never sees it. Everything downstream of
// the storyboard call (the render itself, a hand-edited prompt, an imported
// storyboard) was uncovered, so the guarantee lives here instead, appended at
// request time exactly like the realism stack.
//
// It matters most under With Dialogue, where the prompt by design carries the
// spoken line verbatim inside double quotes — and an image model handed a
// quoted string draws it. That is how a talking-head still came back with its
// own line burned across the frame as a TikTok caption. The words are AUDIO:
// spoken in the clip, laid over as real captions later in Edit, never rendered
// into the picture.
export const NO_ON_SCREEN_TEXT_SUFFIX =
  'No captions, subtitles, watermarks, logos, or on-screen text of any kind anywhere in the frame.'

// The extra half-sentence a prompt carrying quoted speech needs: without it,
// "says: \"…\"" reads to an image model as a request to render those words.
const SPOKEN_NOT_WRITTEN =
  'Any words in double quotes are SPOKEN ALOUD by the character — render them as a mouth caught mid-word, never as text on screen.'

// Does this prompt quote something? Curly quotes included; a 3-char floor so a
// stray inch mark or an emphasised single word doesn't trip it.
const QUOTED_SPEECH = /["“][^"”]{3,}["”]/

/**
 * Append the no-on-screen-text guarantee. Runs on every B-Roll image and video
 * request in both modes, and unconditionally — a claymation ad has no more
 * business carrying burned-in subtitles than a UGC one, so this is deliberately
 * NOT gated on `noRealism` the way the iPhone stack is.
 */
export function withNoOnScreenText(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) return trimmed
  if (trimmed.includes(NO_ON_SCREEN_TEXT_SUFFIX)) return trimmed
  const clause = QUOTED_SPEECH.test(trimmed)
    ? `${NO_ON_SCREEN_TEXT_SUFFIX} ${SPOKEN_NOT_WRITTEN}`
    : NO_ON_SCREEN_TEXT_SUFFIX
  const sep = /[.!?]$/.test(trimmed) ? ' ' : '. '
  return `${trimmed}${sep}${clause}`
}

// ── One frame, one take ────────────────────────────────────────
//
// The writer-side rule ("ONE FRAME, ONE ACTION" in the storyboard system
// prompt) is a rule the CHAT model obeys while writing, and the image and
// video models never see it. Everything downstream is uncovered — a prompt the
// member hand-edited, an imported storyboard, a card written before that rule
// existed, a session resumed from history — so the guarantee lives here too,
// appended at request time exactly like the realism stack and the no-text
// clause.
//
// The failure it prevents: a prompt carrying two or three beats ("the drawer
// slides open ... the hand sweeps the pile out ... the drawer knocks shut")
// comes back as a contact sheet — a strip of stacked panels, a split screen, a
// before-and-after, or one impossible frame with three pairs of hands in it —
// instead of a single still that can be animated into a clip.
export const SINGLE_FRAME_SUFFIX =
  'One single photographic frame filling the whole image: one continuous moment seen from one camera. No collage, no grid, no split screen, no stacked or side-by-side panels, no comic strip, no before-and-after, no inset or picture-in-picture, no repeated subject — render only the one instant described, never a sequence of moments.'

// The video half of the same rule. A clip has time, so it may show its one
// action play out — what it may not do is cut. B-Roll has never sent
// `multiShots` (see generateVideo.ts): every clip in both modes is a single
// continuous take, and a multi-beat prompt otherwise comes back as a montage.
export const SINGLE_TAKE_SUFFIX =
  'One continuous unbroken take from a single camera, filling the whole frame — no cuts, no montage, no split screen, no stacked or side-by-side panels, no inset or picture-in-picture.'

function appendClause(prompt: string, clause: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) return trimmed
  if (trimmed.includes(clause)) return trimmed
  const sep = /[.!?]$/.test(trimmed) ? ' ' : '. '
  return `${trimmed}${sep}${clause}`
}

/**
 * Append the single-frame guarantee. Runs on every B-Roll image request in both
 * modes, and unconditionally — a keyframe in a stylized Continuous chain is a
 * single frame for exactly the same reason a UGC still is, so this is
 * deliberately NOT gated on `noRealism` the way the iPhone stack is.
 */
export function withSingleFrame(prompt: string): string {
  return appendClause(prompt, SINGLE_FRAME_SUFFIX)
}

/** Append the single-take guarantee. Every B-Roll video request, both modes. */
export function withSingleTake(prompt: string): string {
  return appendClause(prompt, SINGLE_TAKE_SUFFIX)
}
