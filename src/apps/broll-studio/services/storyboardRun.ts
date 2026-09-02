// The storyboard call, run as a JOB rather than as an awaited fetch inside a
// click handler.
//
// TWO REASONS, and both are things every other generation surface in the app
// already got right:
//
// 1. It is VISIBLE. Every other generation pushes an in-flight tile before the
//    network call, so History is the queue view — fire it, switch away, watch
//    the row report progress. Writing the prompts was the one call that showed
//    nothing anywhere until it landed: no row, no chip, nothing in History.
//    The row is now written FIRST, in a 'writing' state, exactly like the Ad
//    Analyzer's 'analyzing' row.
//
// 2. It SURVIVES A RELOAD. A streaming chat request dies with the page, and
//    kie has already been billed for the tokens by the time it does. kie's
//    task transport (createTask → recordInfo) hands back a taskId, which is
//    persisted on the row, so the poll can be re-attached on the next load.
//    Not every chat model in the picker has a job route — a rejected createTask
//    falls back to streaming and logs which path it took. Those runs genuinely
//    cannot be resumed, so a reload STRANDS them (see isStoryboardStranded)
//    rather than leaving a row pulsing "writing" forever.
//
// Module-level, so switching apps mid-write doesn't kill the run — the same
// property analysisQueue.ts has. Unlike that one there's no concurrency cap:
// the panel already refuses a second storyboard while one is in flight.

import {
  createTask,
  pollTask,
  extractChatTaskText,
  chatTaskHitTokenLimit,
  kieChatCompletions,
  TruncatedResponseError,
  CHAT_POLL_ATTEMPTS,
  LONG_CHAT_TIMEOUT_MS,
  type ChatMessage,
} from '../../../utils/kie'
import { getChatTarget, getModel } from '../../../utils/models'
import { useSettingsStore, resolveScriptModel } from '../../../stores/settingsStore'
import { useBankStore } from '../../../stores/bankStore'
import type { BrollHistoryItem } from '../../../stores/types'
import { humanizeError } from '../../../utils/friendlyError'
import type { BrollInput } from '../types'
import { buildBrollMessages, buildBrollResult } from './generateBroll'
import {
  isStoryboardShort,
  sceneCount,
  trimToLastCompleteScene,
  continuationMessages,
  stitchStoryboard,
  MAX_STORYBOARD_CONTINUATIONS,
  type StoryboardMode,
} from './storyboardCompletion'
import {
  buildContinuousMessages,
  parseContinuousResult,
  CONTINUOUS_DEFAULT_MODEL_ID,
  type ContinuousInput,
} from './generateContinuous'

export type StoryboardRequest =
  | { mode: 'line'; input: BrollInput }
  | { mode: 'continuous'; input: ContinuousInput }

// `error: null` means the row was deleted while the call ran — the member
// cancelled it, so there is nothing to tell them.
//
// `warning` is the storyboard that landed but stopped short of the end of the
// script (see storyboardCompletion.ts) and could not be completed by asking for
// the rest. It is deliberately NOT an error: what came back is real work the
// member paid for and the scenes in it are usable, so it is adopted exactly as
// a whole one is — the warning only replaces the "Storyboard ready" toast, so
// nobody is left to discover the missing half by scrolling.
export type StoryboardOutcome =
  | { ok: true; warning?: string }
  | { ok: false; error: string | null }

export const STORYBOARD_INCOMPLETE_WARNING =
  'The storyboard stopped before the end of your script — the model ran out of room. Generate again, or split a long script into two runs.'

type Listener = (rowId: string, outcome: StoryboardOutcome) => void

// A row 'writing' for longer than this isn't coming back: the browser that
// started it is gone, or kie lost the job. Same TTL the history view sweeps
// in-flight image/video entries with, so nothing pulses forever.
export const STORYBOARD_TTL_MS = 30 * 60 * 1000

const running = new Set<string>()
const listeners = new Set<Listener>()

export function onStoryboardSettled(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(rowId: string, outcome: StoryboardOutcome): void {
  for (const l of listeners) l(rowId, outcome)
}

function rowById(rowId: string): BrollHistoryItem | undefined {
  return useBankStore.getState().brollHistory.find((r) => r.id === rowId)
}

// Write onto the row as it stands right now. `upsertBrollHistory` replaces the
// row wholesale, so this reads it back first rather than sending a patch — and
// a row the member deleted mid-call is left deleted.
async function patchRow(rowId: string, patch: Partial<BrollHistoryItem>): Promise<boolean> {
  const prior = rowById(rowId)
  if (!prior) return false
  await useBankStore.getState().upsertBrollHistory({ ...prior, ...patch })
  return true
}

// ── Transport ────────────────────────────────────────────────────────────

// kie's job route names a model by its own slug. For the OpenAI-compatible
// entries the registry id IS that name (the endpoint path carries a variant
// suffix that the job route doesn't want); the Claude and Grok entries carry
// kie's name in `chatSlug`. A model with no job route simply 400s here, which
// is the fallback path — nothing to configure, and nothing to keep in step.
function chatTaskModel(modelId: string): string {
  return getModel(modelId)?.chatSlug ?? modelId
}

// Returns the taskId, or null when this model has to be streamed instead.
async function startChatTask(apiKey: string, modelId: string, messages: ChatMessage[]): Promise<string | null> {
  const taskModel = chatTaskModel(modelId)
  try {
    const taskId = await createTask(apiKey, taskModel, { messages, stream: false })
    if (!taskId) {
      console.warn('[broll] storyboard: createTask returned no taskId, streaming instead')
      return null
    }
    console.info(`[broll] storyboard running as kie task ${taskId} (${taskModel}) — survives a reload`)
    return taskId
  } catch (err) {
    console.warn(
      `[broll] storyboard: no job route for ${taskModel}, streaming instead (this run will not survive a reload)`,
      err,
    )
    return null
  }
}

/**
 * A model's answer, plus whether it stopped because it ran out of output
 * tokens. Both transports can say so — the streaming one throws
 * `TruncatedResponseError` (whose `partial` is exactly this text), the jobs one
 * reports the stop reason on the record — and until this was plumbed through,
 * neither answer reached the storyboard: a cut-off run looked like a short ad.
 */
type ProducedText = { text: string; truncated: boolean }

async function pollChatText(taskId: string): Promise<ProducedText> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const record = await pollTask(apiKey, taskId, { maxPollAttempts: CHAT_POLL_ATTEMPTS })
  const text = extractChatTaskText(record)
  if (!text) {
    throw new Error(
      `Storyboard task ${taskId} succeeded but no text could be extracted. Raw resultJson: ${record.resultJson?.slice(0, 400)}`,
    )
  }
  return { text, truncated: chatTaskHitTokenLimit(record) }
}

// The streaming fallback. `TruncatedResponseError` carries the partial for
// exactly this reason — a cut-off storyboard is salvageable and continuable,
// where re-running it from scratch costs the member the whole call again.
async function streamChatText(apiKey: string, modelId: string, messages: ChatMessage[]): Promise<ProducedText> {
  try {
    const text = await kieChatCompletions(apiKey, getChatTarget(modelId), messages, {
      timeoutMs: LONG_CHAT_TIMEOUT_MS,
    })
    return { text, truncated: false }
  } catch (err) {
    if (err instanceof TruncatedResponseError && err.partial.trim()) {
      return { text: err.partial, truncated: true }
    }
    throw err
  }
}

async function produceText(rowId: string, messages: ChatMessage[]): Promise<ProducedText> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const modelId = resolveScriptModel('broll-studio')
  const taskId = await startChatTask(apiKey, modelId, messages)
  if (taskId) {
    // Persisted BEFORE the poll starts: that write is the entire resume story,
    // and the window it closes is the one where a reload lands seconds after
    // the click.
    await patchRow(rowId, { storyboardTaskId: taskId })
    return pollChatText(taskId)
  }
  return streamChatText(apiKey, modelId, messages)
}

/**
 * A continuation turn. Deliberately does NOT persist its taskId over the first
 * one: a reload mid-continuation would then re-attach to the tail and adopt
 * half a storyboard's second half as the whole thing. Leaving the first task on
 * the row means a reload resumes what it always did — the opening run — which
 * is short but coherent, and says so.
 */
async function continueText(messages: ChatMessage[]): Promise<ProducedText> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const modelId = resolveScriptModel('broll-studio')
  const taskId = await startChatTask(apiKey, modelId, messages)
  return taskId ? pollChatText(taskId) : streamChatText(apiKey, modelId, messages)
}

/**
 * The storyboard, written all the way to the end of the script — asking for the
 * rest when the first answer stops short, rather than rendering half an ad.
 *
 * The loop stops on the first of three things: the answer covers the script,
 * the model has nothing left to add (a continuation that produces no new
 * scene), or we've asked enough times. In every one of those the text we keep
 * is the longest we ever held — a continuation that adds nothing never costs
 * the member what the previous round already wrote.
 */
async function produceStoryboardText(
  rowId: string,
  mode: StoryboardMode,
  scriptText: string,
  messages: ChatMessage[],
): Promise<{ text: string; complete: boolean }> {
  let { text, truncated } = await produceText(rowId, messages)
  const done = () => !truncated && !isStoryboardShort(scriptText, text)

  for (let attempt = 0; attempt < MAX_STORYBOARD_CONTINUATIONS && !done(); attempt++) {
    const head = trimToLastCompleteScene(text, mode)
    // Not one scene closed: there is nothing coherent to continue from, and a
    // fresh ask would just be the same call again.
    if (!head) break
    console.info(
      `[broll] storyboard stopped short (truncated=${truncated}) — asking for the rest (${attempt + 1}/${MAX_STORYBOARD_CONTINUATIONS})`,
    )
    // A failed continuation must never cost the member the storyboard the first
    // call already wrote and already billed for. It ends the loop and the run
    // settles with the scenes in hand, plus the warning saying they stop short.
    let more: ProducedText
    try {
      more = await continueText(continuationMessages(messages, head, mode))
    } catch (err) {
      console.warn('[broll] storyboard continuation failed — keeping what landed', err)
      break
    }
    const next = stitchStoryboard(head, more.text, mode)
    if (sceneCount(next, mode) <= sceneCount(text, mode)) break
    text = next
    truncated = more.truncated
  }

  return { text, complete: done() }
}

// ── Parsing ──────────────────────────────────────────────────────────────

// The response is read against the ROW, never against live panel state: the row
// stamped the delivery, style and video model at Generate, so a storyboard that
// finishes after a reload — or after the member has changed the panel while
// waiting — parses exactly as it would have at the moment it was fired.
function parseStoryboard(row: BrollHistoryItem, text: string): Partial<BrollHistoryItem> {
  if (row.mode === 'continuous') {
    const result = parseContinuousResult(text, {
      scriptText: row.scriptText ?? '',
      styleId: row.styleId ?? '',
      styleBrief: row.styleBrief,
      modelId: row.continuousModelId ?? CONTINUOUS_DEFAULT_MODEL_ID,
      // Prompt-only fields: the messages were built and sent long before this.
      productContext: '',
      modelContext: '',
      additionalContext: '',
    })
    if (!result) throw new Error('The storyboard came back empty. Try again.')
    return { continuousResult: result }
  }
  return {
    result: buildBrollResult(text, {
      delivery: row.lineDelivery ?? 'silent',
      styleId: row.styleId ?? '',
      styleBrief: row.styleBrief,
      styleName: row.styleName,
    }),
    cardStates: {},
  }
}

// ── Running ──────────────────────────────────────────────────────────────

async function runJob(
  rowId: string,
  produce: () => Promise<{ text: string; complete: boolean }>,
): Promise<void> {
  if (running.has(rowId)) return
  running.add(rowId)
  try {
    const { text, complete } = await produce()
    const row = rowById(rowId)
    if (!row) {
      notify(rowId, { ok: false, error: null })
      return
    }
    await patchRow(rowId, {
      ...parseStoryboard(row, text),
      storyboardStatus: undefined,
      storyboardTaskId: undefined,
      storyboardError: undefined,
    })
    notify(rowId, complete ? { ok: true } : { ok: true, warning: STORYBOARD_INCOMPLETE_WARNING })
  } catch (err) {
    // The row only keeps the friendly copy, so without this the raw kie message
    // — the one that says WHICH rejection this was — is gone for good.
    console.error('[broll] storyboard generation failed', err)
    if (!rowById(rowId)) {
      notify(rowId, { ok: false, error: null })
      return
    }
    const message = humanizeError(err, 'Storyboard generation failed. Check your API key and try again.')
    await patchRow(rowId, { storyboardStatus: 'error', storyboardError: message, storyboardTaskId: undefined })
    notify(rowId, { ok: false, error: message })
  } finally {
    running.delete(rowId)
  }
}

/** Fire a storyboard for a row already written in the 'writing' state. */
export function startStoryboard(rowId: string, req: StoryboardRequest): void {
  void runJob(rowId, async () => {
    const messages = req.mode === 'line'
      ? await buildBrollMessages(req.input)
      : await buildContinuousMessages(req.input)
    return produceStoryboardText(rowId, req.mode, req.input.scriptText, messages)
  })
}

/**
 * Re-attach the poll for a row left 'writing' by a previous page load. Returns
 * false when there's nothing to attach to — no taskId (it was streamed) or the
 * job is already running in this tab.
 */
export function resumeStoryboard(row: BrollHistoryItem): boolean {
  const taskId = row.storyboardTaskId
  if (row.storyboardStatus !== 'writing' || !taskId || running.has(row.id)) return false
  console.info(`[broll] resuming storyboard task ${taskId}`)
  // A resumed run cannot be continued: the messages that produced it went down
  // with the previous page, and rebuilding them from the row would drop the
  // product and character context the storyboard was written against. So it is
  // checked and reported rather than repaired — the member is told it stopped
  // short instead of finding out by scrolling.
  void runJob(row.id, async () => {
    const { text, truncated } = await pollChatText(taskId)
    return { text, complete: !truncated && !isStoryboardShort(row.scriptText ?? '', text) }
  })
  return true
}

export function isStoryboardRunning(rowId: string): boolean {
  return running.has(rowId)
}

/**
 * A 'writing' row nothing can finish: it was streamed (no taskId, and that
 * request went down with the page), or it has been writing far longer than any
 * chat call runs. Callers only ever strand rows THIS browser started — a row
 * synced from another device may still be running over there.
 */
export function isStoryboardStranded(row: BrollHistoryItem, now = Date.now()): boolean {
  if (row.storyboardStatus !== 'writing') return false
  if (running.has(row.id)) return false
  if (!row.storyboardTaskId) return true
  return now - (row.updatedAt ?? row.createdAt) > STORYBOARD_TTL_MS
}

/** Flip a stranded row to 'error' and tell whoever was waiting on it. */
export async function strandStoryboard(rowId: string, message: string): Promise<void> {
  if (!(await patchRow(rowId, { storyboardStatus: 'error', storyboardError: message, storyboardTaskId: undefined }))) {
    notify(rowId, { ok: false, error: null })
    return
  }
  notify(rowId, { ok: false, error: message })
}
