// Structural edits to a Continuous storyboard: change a scene's narration,
// split one beat into two, merge two into one, delete one outright.
//
// Why this exists: the storyboard used to be frozen at generation time. When
// the LLM segmented badly — one line carrying two visual ideas is the classic —
// the only remedy was regenerating the whole thing and losing every rendered
// keyframe. These operations edit the plan in place instead.
//
// The awkward part is that three different maps are keyed by POSITION, not by
// identity: frame cards by `${frameIndex}:${conceptId}`, clip cards by
// `c${sceneIndex}`, keyframe picks by the frame index. Insert or remove a beat
// and every one of those keys downstream is wrong. So each operation states its
// old→new index mapping once and `remapIndexedState` rewrites all three
// together — that way a new operation can't remember two maps and forget the
// third.
//
// Reordering is deliberately absent. Every scene's TRANSITION names an anchor
// shared with its specific neighbours; moving a beat invalidates the framing
// on both sides of both its old and new positions, which is a rewrite, not a
// move.

import type {
  ContinuousResult,
  ContinuousScene,
  ContinuousFrame,
  ContinuousFrameCardState,
  ContinuousClipCardState,
  ContinuousSelection,
} from './types'
import { sceneDuration } from './services/generateContinuous'

// What the view asks for. One union so the plumbing between ContinuousView,
// RightPanel and BrollStudio is a single prop rather than four.
export type ContinuousStoryboardOp =
  | { kind: 'edit'; sceneIndex: number; line: string }
  | { kind: 'split'; sceneIndex: number; at: number }
  | { kind: 'merge'; sceneIndex: number }
  | { kind: 'delete'; sceneIndex: number }

export interface ContinuousBundle {
  result: ContinuousResult
  frameStates: Record<string, ContinuousFrameCardState>
  clipStates: Record<string, ContinuousClipCardState>
  selections: Record<string, ContinuousSelection>
}

// old index → new index, or null when the slot is being removed.
type IndexShift = (old: number) => number | null

function remapIndexedState(
  bundle: ContinuousBundle,
  frameShift: IndexShift,
  sceneShift: IndexShift,
): Pick<ContinuousBundle, 'frameStates' | 'clipStates' | 'selections'> {
  const frameStates: Record<string, ContinuousFrameCardState> = {}
  for (const [key, value] of Object.entries(bundle.frameStates)) {
    const sep = key.indexOf(':')
    if (sep === -1) continue
    const next = frameShift(Number(key.slice(0, sep)))
    if (next === null) continue
    frameStates[`${next}:${key.slice(sep + 1)}`] = value
  }
  const clipStates: Record<string, ContinuousClipCardState> = {}
  for (const [key, value] of Object.entries(bundle.clipStates)) {
    const next = sceneShift(Number(key.slice(1)))
    if (next === null) continue
    clipStates[`c${next}`] = value
  }
  const selections: Record<string, ContinuousSelection> = {}
  for (const [key, value] of Object.entries(bundle.selections)) {
    const next = frameShift(Number(key))
    if (next === null) continue
    selections[String(next)] = value
  }
  return { frameStates, clipStates, selections }
}

// A structural edit changes which two keyframes a clip spans, so its motion —
// written for the old pair — is stale. Dropping `motionEdited`
// re-arms the two-image vision pass, which rewrites the motion from the actual
// endpoints as soon as both are picked again.
function relinkClips(
  clipStates: Record<string, ContinuousClipCardState>,
  sceneIndices: number[],
): Record<string, ContinuousClipCardState> {
  const next = { ...clipStates }
  for (const i of sceneIndices) {
    const existing = next[`c${i}`]
    if (existing) next[`c${i}`] = { ...existing, motionEdited: false }
  }
  return next
}

function renumber(result: ContinuousResult, scenes: ContinuousScene[], frames: ContinuousFrame[]): ContinuousResult {
  return {
    ...result,
    scenes: scenes.map((s, i) => ({ ...s, index: i + 1 })),
    frames: frames.map((f, i) => ({ ...f, index: i + 1 })),
  }
}

function blankFrame(): ContinuousFrame {
  // Index is set by renumber(). A blank concept mirrors the "Add concept" card:
  // no LLM call up front — the user writes the prompt or hits Regenerate, which
  // reads the motions either side so the new frame still chains.
  return { index: 0, concepts: [{ id: `cont-${crypto.randomUUID()}`, label: 'Custom', prompt: '' }] }
}

// ── Operations ─────────────────────────────────────────────────
// Each returns a fresh bundle, or null when the edit doesn't apply (the caller
// should have disabled the control, but the guard keeps the state honest).

// Retype a scene's narration. Purely textual: no frame or clip moves, so no
// remap — only the planned clip length changes, since it's derived from the
// spoken word count.
export function editSceneLine(bundle: ContinuousBundle, sceneIndex: number, line: string): ContinuousBundle | null {
  const text = line.trim()
  if (!text) return null
  const { result } = bundle
  if (!result.scenes.some((s) => s.index === sceneIndex)) return null
  return {
    ...bundle,
    result: {
      ...result,
      scenes: result.scenes.map((s) =>
        s.index === sceneIndex
          ? { ...s, scriptLine: text, durationSeconds: sceneDuration(text, result.modelId) }
          : s,
      ),
    },
  }
}

// Split scene N at a character offset into its narration: N keeps the first
// half, a new scene N+1 takes the second, and a new BLANK keyframe is inserted
// between them for the user to write or regenerate.
//
// The old boundary belonged to the end of the original line, so the new second
// half inherits its motion and sfx; scene N's own motion is
// cleared because its destination — the new frame — doesn't exist yet.
export function splitScene(bundle: ContinuousBundle, sceneIndex: number, at: number): ContinuousBundle | null {
  const { result } = bundle
  const scene = result.scenes.find((s) => s.index === sceneIndex)
  if (!scene) return null
  const head = scene.scriptLine.slice(0, at).trim()
  const tail = scene.scriptLine.slice(at).trim()
  if (!head || !tail) return null

  const first: ContinuousScene = {
    ...scene,
    scriptLine: head,
    motionPrompt: '',
    sfx: '',
    durationSeconds: sceneDuration(head, result.modelId),
  }
  const second: ContinuousScene = {
    ...scene,
    index: scene.index + 1,
    scriptLine: tail,
    durationSeconds: sceneDuration(tail, result.modelId),
  }

  const scenes = [...result.scenes]
  scenes.splice(sceneIndex - 1, 1, first, second)
  const frames = [...result.frames]
  // Frame N stays as scene N's opener; the new frame lands directly after it.
  frames.splice(sceneIndex, 0, blankFrame())

  const shift: IndexShift = (i) => (i <= sceneIndex ? i : i + 1)
  const remapped = remapIndexedState(bundle, shift, shift)
  return {
    result: renumber(result, scenes, frames),
    frameStates: remapped.frameStates,
    // Both halves now span new endpoints.
    clipStates: relinkClips(remapped.clipStates, [sceneIndex, sceneIndex + 1]),
    selections: remapped.selections,
  }
}

// Fold scene N+1 into scene N: one narration line, one clip, and the keyframe
// that used to sit between them is removed.
export function mergeSceneWithNext(bundle: ContinuousBundle, sceneIndex: number): ContinuousBundle | null {
  const { result } = bundle
  const scene = result.scenes.find((s) => s.index === sceneIndex)
  const next = result.scenes.find((s) => s.index === sceneIndex + 1)
  if (!scene || !next) return null

  const line = `${scene.scriptLine.trim()} ${next.scriptLine.trim()}`.trim()
  const merged: ContinuousScene = {
    ...scene,
    scriptLine: line,
    // The merged beat now ends where the second one ended, so it takes the
    // second's outbound boundary wholesale.
    motionPrompt: next.motionPrompt,
    sfx: next.sfx,
    durationSeconds: sceneDuration(line, result.modelId),
  }

  const scenes = result.scenes.filter((s) => s.index !== sceneIndex + 1).map((s) => (s.index === sceneIndex ? merged : s))
  const frames = result.frames.filter((f) => f.index !== sceneIndex + 1)

  const shift: IndexShift = (i) => (i <= sceneIndex ? i : i === sceneIndex + 1 ? null : i - 1)
  const remapped = remapIndexedState(bundle, shift, shift)
  return {
    result: renumber(result, scenes, frames),
    frameStates: remapped.frameStates,
    clipStates: relinkClips(remapped.clipStates, [sceneIndex]),
    selections: remapped.selections,
  }
}

// Drop scene N and the keyframe it opens. The previous scene then lands on what
// used to be frame N+1, so its clip is re-armed.
export function deleteScene(bundle: ContinuousBundle, sceneIndex: number): ContinuousBundle | null {
  const { result } = bundle
  if (result.scenes.length <= 1) return null
  if (!result.scenes.some((s) => s.index === sceneIndex)) return null

  const scenes = result.scenes.filter((s) => s.index !== sceneIndex)
  const frames = result.frames.filter((f) => f.index !== sceneIndex)

  const shift: IndexShift = (i) => (i === sceneIndex ? null : i < sceneIndex ? i : i - 1)
  const remapped = remapIndexedState(bundle, shift, shift)
  return {
    result: renumber(result, scenes, frames),
    frameStates: remapped.frameStates,
    clipStates: relinkClips(remapped.clipStates, [sceneIndex - 1]),
    selections: remapped.selections,
  }
}
