// Module-level analysis queue. Survives React unmounts (so a user switching
// to another app mid-bulk doesn't kill the in-flight requests). With the
// createTask transport, jobs can also survive a page refresh — the taskId is
// persisted on the history row, so `resumeAnalysis` re-attaches the poll.
// Rows that fell back to the streaming transport still can't be resumed; the
// mount-time reconciler flips those to 'error'.

import { startAnalysisTask, pollAnalysisTask, streamAnalysisFallback, INLINE_VIDEO_BUDGET_BYTES } from './analyzeAd'
import { captureFirstFrame } from '../utils/captureFirstFrame'
import { compressVideoForAnalysis } from '../utils/compressVideo'
import { saveAsset, deleteAsset, getBlob } from '../../../utils/assetStore'
// `deleteAsset` is still used for the thumbnail cleanup below.
import { useBankStore } from '../../../stores/bankStore'
import type { AnalysisResult } from '../types'
import type { AdAnatomyHistoryItem } from '../../../stores/types'
import { humanizeError, FriendlyError } from '../../../utils/friendlyError'

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

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// The whole clip rides inline in the request, so anything over the transport's
// budget is re-encoded here before it is ever sent — that oversized body is the
// 400 members were hitting on ads the upload screen had already accepted.
// Everything under budget is passed through untouched: re-encoding costs a
// realtime pass and a generation of quality, and neither is worth paying for a
// file that already fits.
//
// A failure here is FINAL for this run: the compressor's messages all name what
// the member should do next, so they are rethrown as-is rather than swallowed
// into a retry that would send the same oversized body.
async function fitForInlineRequest(historyId: string, file: File): Promise<File> {
  if (file.size <= INLINE_VIDEO_BUDGET_BYTES) return file
  if (!file.type.startsWith('video/')) {
    throw new FriendlyError(
      `This image is ${mb(file.size)}, over the ${mb(INLINE_VIDEO_BUDGET_BYTES)} the analyser can send. Export it smaller and try again.`,
    )
  }

  const { updateAdAnatomyHistory } = useBankStore.getState()
  // The analysing screen reads this: a realtime re-encode is a wait BEFORE the
  // analysis starts, and an unexplained one on top of an already-long call is
  // what reads as a hung page.
  await updateAdAnatomyHistory(historyId, { compressing: true })
  console.log(`[ad-anatomy] ${file.name} is ${mb(file.size)} — compressing to fit ${mb(INLINE_VIDEO_BUDGET_BYTES)}`)
  const result = await compressVideoForAnalysis(file, INLINE_VIDEO_BUDGET_BYTES)
    .finally(() => {
      if (rowExists(historyId)) void updateAdAnatomyHistory(historyId, { compressing: undefined })
    })
  console.log(`[ad-anatomy] compressed ${mb(result.originalBytes)} → ${mb(result.compressedBytes)}`)

  // An encoder that missed the budget has produced a body that will be rejected
  // anyway. Say so here, where we still know the numbers, rather than letting
  // kie say it in its own words after another upload.
  if (result.compressedBytes > INLINE_VIDEO_BUDGET_BYTES) {
    throw new FriendlyError(
      `This ad is still ${mb(result.compressedBytes)} after compressing, over the ${mb(INLINE_VIDEO_BUDGET_BYTES)} the analyser can send. Trim it shorter or export it at a lower resolution and try again.`,
    )
  }
  return result.file
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
  // `uploadedRef` SURVIVES a failure. It used to be dropped and the asset
  // deleted, which turned every transient rejection into "find that 50MB file
  // and drag it in again" — so Retry now re-runs from the stored source with
  // one click. The mount-time TTL sweep evicts it on the same 14-day rule as a
  // completed row, and deleting the row purges it outright.
  await updateAdAnatomyHistory(historyId, {
    status: 'error',
    errorMessage,
    taskId: undefined,
    compressing: undefined,
    perception: undefined,
  })
}

function rowExists(historyId: string): boolean {
  return !!useBankStore.getState().getAdAnatomyHistoryById(historyId)
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

    try {
      // Thumbnail and cost estimate come off the ORIGINAL; only the copy that
      // goes over the wire is re-encoded.
      const payload = await fitForInlineRequest(historyId, file)
      if (!rowExists(historyId)) return
      const started = await startAnalysisTask(payload)
      if (!rowExists(historyId)) return

      let analysis: AnalysisResult
      if (started.kind === 'task') {
        await updateAdAnatomyHistory(historyId, { taskId: started.taskId })
        analysis = await pollAnalysisTask(started.taskId)
      } else {
        // Streaming fallback — can't resume across refresh.
        analysis = await streamAnalysisFallback(payload)
      }
      await applySuccess(historyId, analysis, file.name)
    } catch (err) {
      await applyFailure(historyId, err)
    }
  })
  pump()
}

// Re-run an errored row from its retained source. This is the answer to the
// two ways an analysis dies without a result the member can use: a refresh
// landing in the window BEFORE kie handed back a taskId (nothing to re-attach
// to — the request went down with the page), and an outright failure. Both keep
// `uploadedRef`, so retrying costs a click rather than another upload.
//
// Returns false when the source is gone (TTL-swept, or a pre-fix row that had
// its ref dropped) — the caller falls back to asking for the file again.
export async function retryAnalysis(item: AdAnatomyHistoryItem): Promise<boolean> {
  const { updateAdAnatomyHistory } = useBankStore.getState()
  if (!item.uploadedRef) return false

  const blob = await getBlob(item.uploadedRef).catch(() => null)
  if (!blob) return false

  const file = new File([blob], item.fileName, { type: blob.type || 'video/mp4' })
  await updateAdAnatomyHistory(item.id, {
    status: 'analyzing',
    errorMessage: undefined,
    taskId: undefined,
    compressing: undefined,
  })
  enqueueAnalysis(item.id, file)
  return true
}

// Re-attach an in-flight row after a refresh — only rows that got a taskId
// (the createTask transport) can be resumed.
export function resumeAnalysis(item: AdAnatomyHistoryItem): void {
  const { id: historyId, fileName, taskId } = item
  if (!taskId) return

  queue.push(async () => {
    if (!rowExists(historyId)) return
    try {
      const analysis = await pollAnalysisTask(taskId)
      await applySuccess(historyId, analysis, fileName)
    } catch (err) {
      await applyFailure(historyId, err)
    }
  })
  pump()
}
