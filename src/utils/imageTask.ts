import { pollTask, parseResult, fetchGeneratedAsset, IMAGE_POLL_ATTEMPTS } from './kie'
import { saveAsset } from './assetStore'
import { useSettingsStore } from '../stores/settingsStore'

// Shared tail of every image generation (Playground, B-Roll, Influencers):
// poll the task to completion, take the first result URL, download it, and
// persist it as a local asset. Returns the saved asset id. Callers keep their
// own history-row / usage-ledger side-effects.
//
// The download stays a Blob end to end. It used to be read into a base64
// string (chunked `String.fromCharCode` + `btoa`) and then handed BACK to
// `fetch()` as a data: URL to become a Blob again — three full copies of a
// multi-megabyte PNG built on the main thread, right as the result landed,
// which is the moment every other tile of the batch is still animating.
export async function finishImageAssetTask(
  taskId: string,
  modelId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const record = await pollTask(apiKey, taskId, { signal: opts.signal, maxPollAttempts: IMAGE_POLL_ATTEMPTS })
  const urls = parseResult(record).resultUrls
  if (urls.length === 0) {
    throw new Error(
      `${modelId}: kie.ai returned no resultUrls. taskId=${taskId} record=${JSON.stringify(record).slice(0, 400)}`,
    )
  }
  const res = await fetchGeneratedAsset(urls[0], { signal: opts.signal })
  if (!res.ok) throw new Error(`Failed to download generated asset (${res.status}).`)
  const blob = await res.blob()
  if (blob.size === 0) throw new Error(`kie.ai returned an empty image (0 bytes). url=${urls[0]}`)
  return saveAsset(blob, blob.type || 'image/png')
}
