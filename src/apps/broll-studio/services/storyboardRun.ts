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
  kieChatCompletions,
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
export type StoryboardOutcome = { ok: true } | { ok: false; error: string | null }

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

async function pollChatText(taskId: string): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const record = await pollTask(apiKey, taskId, { maxPollAttempts: CHAT_POLL_ATTEMPTS })
  const text = extractChatTaskText(record)
  if (!text) {
    throw new Error(
      `Storyboard task ${taskId} succeeded but no text could be extracted. Raw resultJson: ${record.resultJson?.slice(0, 400)}`,
    )
  }
  return text
}

async function produceText(rowId: string, messages: ChatMessage[]): Promise<string> {
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
  return kieChatCompletions(apiKey, getChatTarget(modelId), messages, { timeoutMs: LONG_CHAT_TIMEOUT_MS })
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

async function runJob(rowId: string, produce: () => Promise<string>): Promise<void> {
  if (running.has(rowId)) return
  running.add(rowId)
  try {
    const text = await produce()
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
    notify(rowId, { ok: true })
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
    return produceText(rowId, messages)
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
  void runJob(row.id, () => pollChatText(taskId))
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
