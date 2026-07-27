// Module-level analysis queue. Survives React unmounts (so a user switching
// to another app mid-bulk doesn't kill the in-flight requests). With the
// createTask transport, jobs can also survive a page refresh — the taskId of
// whichever pass is in flight is persisted on the history row, and pass 1's
// output (`perception`) is persisted between passes, so `resumeAnalysis`
// re-attaches at the right stage. Pass 2 is text-only, so it can even be
// restarted from scratch after a refresh (no source file needed). Rows that
// fell back to the streaming transport during pass 1 still can't be resumed;
// the mount-time reconciler flips those to 'error'.

import {
  startPerceptionTask,
  pollPerceptionTask,
  streamPerceptionFallback,
  startSynthesisTask,
  pollSynthesisTask,
  streamSynthesisFallback,
  type PerceptionParseOutcome,
} from './analyzeAd'
import { captureFirstFrame } from '../utils/captureFirstFrame'
import { extractCutKeyframes, type Keyframe } from '../utils/extractKeyframes'
import { isPollTimeout } from '../../../utils/kie'
import { saveAsset, deleteAsset } from '../../../utils/assetStore'
// `deleteAsset` is still used by applyFailure below.
import { useBankStore } from '../../../stores/bankStore'
import type { AnalysisResult, PerceptionResult } from '../types'
import type { AdAnatomyHistoryItem } from '../../../stores/types'
import { humanizeError } from '../../../utils/friendlyError'

const MAX_CONCURRENT = 5

let running = 0
const queue: Array<() => Promise<void>> = []

function pump(): void {
  while (running < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!
    running++
    job().finally(() => {
      running--
      pump()
    })
  }
}

function deriveFallbackTitle(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const cleaned = stem.replace(/[_-]+/g, ' ').trim()
  return cleaned || 'Untitled ad'
}

async function applySuccess(historyId: string, analysis: AnalysisResult, fileName: string) {
  const { updateAdAnatomyHistory, getAdAnatomyHistoryById } = useBankStore.getState()
  const current = getAdAnatomyHistoryById(historyId)
  if (!current) return // row was deleted while we were polling
  const adTitle = analysis.adTitle?.trim() || deriveFallbackTitle(fileName)
  // Keep `uploadedRef` so the results view can play back the source. It's
  // local-only (saveAsset is called with skipCloud), and a mount-time TTL
  // sweep in AdAnatomy.tsx evicts it after 14 days.
  await updateAdAnatomyHistory(historyId, {
    status: 'complete',
    adTitle,
    result: analysis,
    taskId: undefined,
    perception: undefined,
  })
}

async function applyFailure(historyId: string, err: unknown) {
  const { updateAdAnatomyHistory, getAdAnatomyHistoryById } = useBankStore.getState()
  const current = getAdAnatomyHistoryById(historyId)
  if (!current) return
  // The row only ever keeps the friendly copy, so without this the raw kie
  // message — the one that says WHICH rejection this was — is gone for good.
  console.error('[ad-anatomy] analysis failed', err)
  const errorMessage = humanizeError(err, 'Analysis failed.')
  await updateAdAnatomyHistory(historyId, {
    status: 'error',
    errorMessage,
    uploadedRef: undefined,
    taskId: undefined,
    perception: undefined,
  })
  if (current.uploadedRef) {
    deleteAsset(current.uploadedRef).catch(() => {})
  }
}

function rowExists(historyId: string): boolean {
  return !!useBankStore.getState().getAdAnatomyHistoryById(historyId)
}

// Persist pass-1 output and hand off to pass 2. `perception` on the row is
// what lets a refresh restart pass 2 without the source file.
async function completePerception(historyId: string, outcome: PerceptionParseOutcome, fileName: string): Promise<void> {
  if (!rowExists(historyId)) return
  if (outcome.kind === 'legacy') {
    // Task from the pre-two-pass build — it already holds the full analysis.
    await applySuccess(historyId, outcome.analysis, fileName)
    return
  }
  await useBankStore.getState().updateAdAnatomyHistory(historyId, {
    perception: outcome.perception,
    taskId: undefined,
  })
  await runSynthesis(historyId, outcome.perception, fileName)
}

// Pass 1 — createTask first (refresh-safe), streaming fallback otherwise.
async function runPerception(historyId: string, file: File, keyframes: Keyframe[]): Promise<PerceptionParseOutcome | null> {
  const { updateAdAnatomyHistory } = useBankStore.getState()
  const started = await startPerceptionTask(file, keyframes)
  if (!rowExists(historyId)) return null

  if (started.kind === 'task') {
    await updateAdAnatomyHistory(historyId, { taskId: started.taskId })
    return pollPerceptionTask(started.taskId)
  }
  // Streaming fallback — can't resume across refresh.
  return streamPerceptionFallback(file, keyframes)
}

// Keyframes are declared best-effort by their own extractor, but attaching
// them makes pass 1's request several MB heavier and its media-part count ~20×
// bigger — enough for the model to reject the whole call. So a failure with
// frames attached costs one video-only retry rather than the whole analysis.
// Skipped when the failure is clearly about the account or the clock, since
// neither changes on a second identical call.
const ACCOUNT_ERROR = /\b(401|402|403|433)\b|api key|insufficient credit|usage limit/i

function worthRetryingWithoutKeyframes(err: unknown): boolean {
  if (isPollTimeout(err)) return false
  const raw = err instanceof Error ? err.message : String(err)
  return !ACCOUNT_ERROR.test(raw)
}

// Pass 2 — createTask first (refresh-safe), streaming fallback otherwise.
// Runs inside the caller's queue slot; never enqueues a second job.
async function runSynthesis(historyId: string, perception: PerceptionResult, fileName: string): Promise<void> {
  const { updateAdAnatomyHistory } = useBankStore.getState()
  const outcome = await startSynthesisTask(perception)
  if (!rowExists(historyId)) return

  if (outcome.kind === 'task') {
    await updateAdAnatomyHistory(historyId, { taskId: outcome.taskId })
    const analysis = await pollSynthesisTask(outcome.taskId, perception)
    await applySuccess(historyId, analysis, fileName)
  } else {
    const analysis = await streamSynthesisFallback(perception)
    await applySuccess(historyId, analysis, fileName)
  }
}

// Enqueue a new analysis. History row should already be in the bank with
// status: 'analyzing' and uploadedRef pointing at the source asset.
export function enqueueAnalysis(historyId: string, file: File): void {
  queue.push(async () => {
    const { updateAdAnatomyHistory } = useBankStore.getState()

    // Bail if the user deleted the row before we got a slot.
    if (!rowExists(historyId)) return

    // Best-effort thumbnail capture — never blocks the analysis.
    try {
      const frame = await captureFirstFrame(file)
      const thumbnailRef = await saveAsset(frame, frame.type || 'image/jpeg')
      if (rowExists(historyId)) {
        await updateAdAnatomyHistory(historyId, { thumbnailRef })
      } else {
        deleteAsset(thumbnailRef).catch(() => {})
      }
    } catch (e) {
      console.warn('[ad-anatomy] thumbnail capture failed', e)
    }

    // Cut-point keyframes for pass 1 — best-effort (returns [] on failure,
    // and images skip it entirely inside the extractor).
    const keyframes = await extractCutKeyframes(file)
    if (!rowExists(historyId)) return

    try {
      let outcome: PerceptionParseOutcome | null
      try {
        outcome = await runPerception(historyId, file, keyframes)
      } catch (err) {
        if (keyframes.length === 0 || !worthRetryingWithoutKeyframes(err)) throw err
        console.warn('[ad-anatomy] pass 1 failed with keyframes attached — retrying video-only', err)
        outcome = await runPerception(historyId, file, [])
      }
      if (!outcome) return // row was deleted mid-flight
      await completePerception(historyId, outcome, file.name)
    } catch (err) {
      await applyFailure(historyId, err)
    }
  })
  pump()
}

// Re-attach an in-flight row after a refresh. Which stage to resume is read
// off the row itself:
//   taskId + no perception → pass-1 task still running
//   taskId + perception    → pass-2 task still running
//   perception, no taskId  → died between passes (or pass 2 was streaming) —
//                            restart pass 2 from the stored perception
export function resumeAnalysis(item: AdAnatomyHistoryItem): void {
  const { id: historyId, fileName } = item
  const taskId = item.taskId
  const perception = (item.perception as PerceptionResult | undefined) ?? undefined

  queue.push(async () => {
    if (!rowExists(historyId)) return
    try {
      if (perception) {
        if (taskId) {
          const analysis = await pollSynthesisTask(taskId, perception)
          await applySuccess(historyId, analysis, fileName)
        } else {
          await runSynthesis(historyId, perception, fileName)
        }
      } else if (taskId) {
        const outcome = await pollPerceptionTask(taskId)
        await completePerception(historyId, outcome, fileName)
      }
    } catch (err) {
      await applyFailure(historyId, err)
    }
  })
  pump()
}
