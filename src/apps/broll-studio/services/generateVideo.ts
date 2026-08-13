// Two-phase video generation for B-Roll cards.
//
//   startVideoTask : resolves data URIs to hosted URLs, builds the kie body,
//                    POSTs createTask (or kieVeoCreate), returns the taskId.
//   finishVideoTask: polls the taskId, downloads the result, saves the asset.
//
// Moved verbatim from the deleted video-studio app. OutputPanel persists the
// in-flight taskId between phases via usePersistedState so a tab refresh can
// resume polling. Mirrors playground/service.ts.

import { useSettingsStore } from '../../../stores/settingsStore'
import {
  createTask,
  kieVeoCreate,
  ensureHostedUrl,
} from '../../../utils/kie'
import { finishVideoAssetTask } from '../../../utils/videoTask'
import { buildVideoInput, getModel, resolveVideoModelSlug, type VideoMode } from '../../../utils/models'
import { withIphoneRealism, withNoOnScreenText } from './realism'

export interface VideoGenInput {
  prompt: string
  mode: VideoMode
  aspectRatio: string
  durationSeconds: number
  resolution: string
  audio?: boolean
  modelId: string
  firstFrameDataUri?: string
  lastFrameDataUri?: string
  referenceDataUris?: string[]
  // Kling 3.0: allow multi-cut inside one generation. Unused today — every
  // B-Roll clip is a single continuous take.
  multiShots?: boolean
  // Continuous mode: skip the iPhone-realism suffix — the stylized aesthetic is
  // the opposite of the UGC stack (the style block rides in the prompt itself).
  noRealism?: boolean
}

export interface VideoGenResult {
  assetId: string
  durationSeconds: number
  aspectRatio: string
}

export async function startVideoTask(
  input: VideoGenInput,
  signal?: AbortSignal,
): Promise<{ taskId: string; videoEndpoint?: 'veo' }> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const model = getModel(input.modelId)
  if (!model) throw new Error(`Model not found: ${input.modelId}`)

  let imageUrl: string | undefined
  let firstFrameUrl: string | undefined
  let lastFrameUrl: string | undefined
  let referenceImageUrls: string[] | undefined

  if (input.firstFrameDataUri && input.mode === 'image-to-video') {
    imageUrl = await ensureHostedUrl(apiKey, input.firstFrameDataUri)
  }
  if (input.firstFrameDataUri && input.mode === 'frames-to-video') {
    firstFrameUrl = await ensureHostedUrl(apiKey, input.firstFrameDataUri)
  }
  if (input.lastFrameDataUri && input.mode === 'frames-to-video') {
    lastFrameUrl = await ensureHostedUrl(apiKey, input.lastFrameDataUri)
  }
  if (input.referenceDataUris?.length && input.mode === 'reference-to-video') {
    referenceImageUrls = []
    for (const uri of input.referenceDataUris) {
      referenceImageUrls.push(await ensureHostedUrl(apiKey, uri))
    }
  }

  const buildOpts = {
    // Same rule as the stills: the character speaks the line, the clip never
    // writes it. Captions belong in Edit, over finished footage.
    prompt: withNoOnScreenText(input.noRealism ? input.prompt.trim() : withIphoneRealism(input.prompt)),
    mode: input.mode,
    aspectRatio: input.aspectRatio,
    duration: input.durationSeconds,
    resolution: input.resolution,
    audio: input.audio,
    imageUrl,
    firstFrameUrl,
    lastFrameUrl,
    referenceImageUrls,
    multiShots: input.multiShots,
  }
  const body = buildVideoInput(input.modelId, buildOpts)

  if (model.videoEndpoint === 'veo') {
    const taskId = await kieVeoCreate(apiKey, body, signal)
    return { taskId, videoEndpoint: 'veo' }
  }

  const apiSlug = resolveVideoModelSlug(input.modelId, buildOpts)
  const taskId = await createTask(apiKey, apiSlug, body, signal)
  return { taskId }
}

export async function finishVideoTask(
  taskId: string,
  modelId: string,
  videoEndpoint: 'veo' | undefined,
  durationSeconds: number,
  aspectRatio: string,
  signal?: AbortSignal,
): Promise<VideoGenResult> {
  const assetId = await finishVideoAssetTask(taskId, modelId, videoEndpoint, { signal })
  return {
    assetId,
    durationSeconds,
    aspectRatio,
  }
}
