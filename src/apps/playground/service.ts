// Per-modality generation orchestration for Playground.
//
// Each generation is split into a `startX` phase (resolves refs, builds the
// kie body, POSTs createTask, returns the taskId) and a `finishX` phase
// (polls the taskId, downloads the result, persists it as an asset, pushes
// a row into the right bank slice). This shape lets Playground.tsx persist
// the in-flight taskId between phases via usePersistedState so a tab
// refresh / app switch can resume polling.
//
// Errors are propagated raw — the project convention is to surface kie.ai's
// error messages directly, no wrapping.

import { useSettingsStore } from '../../stores/settingsStore'
import { useBankStore } from '../../stores/bankStore'
import {
  createTask,
  kieVeoCreate,
  kieMusicGenerate,
  pollMusicTask,
  kieOmniCharacterCreate,
  ensureHostedUrl,
} from '../../utils/kie'
import { finishImageAssetTask } from '../../utils/imageTask'
import { finishVideoAssetTask } from '../../utils/videoTask'
import {
  buildImageInput,
  buildVideoInput,
  buildMusicInput,
  resolveVideoModelSlug,
  getModel,
  type AspectRatio,
  type ImageResolution,
  type VideoMode,
} from '../../utils/models'
import { saveAsset, isAssetRef, getAsBase64 } from '../../utils/assetStore'
import { kieChatCompletions, fetchGeneratedAsset, type ChatMessage } from '../../utils/kie'
import { getChatTarget } from '../../utils/models'
import type { ImageHistoryItem, MusicHistoryItem, VideoHistoryItem } from '../../stores/types'
import type { PlaygroundMode } from './types'

// ── Prompt enhance ─────────────────────────────────────────────────
//
// Rewrites the user's freeform draft into a stronger, more specific prompt for
// the active modality, keeping their intent. Mirrors the B-Roll "Enhance
// Prompt" affordance but generic (no scene/variation framework). Returns the
// rewritten prompt text only — the caller owns undo/redo history.

const ENHANCE_SYSTEM = `You are a senior prompt engineer for AI image, video and music models. You rewrite a user's rough prompt into a single, vivid, production-ready prompt that the model can render well. You KEEP the user's intent and subject. You never invent a different concept. You make it concrete and specific, not longer for its own sake.`

// Per-modality guidance — what "good" looks like for each generator.
const ENHANCE_MODE_GUIDE: Record<PlaygroundMode, string> = {
  image: 'Target: a text-to-image model. Add concrete visual specifics: subject, composition/shot size, lighting, lens/mood, setting, materials, color. Photoreal and grounded unless the draft asks otherwise. One flowing paragraph, no lists, no "Style:" headers.',
  video: 'Target: a text-to-video model. Describe the subject, the action/motion over the shot, camera movement and shot size, setting, lighting and mood as one flowing paragraph. Keep it to a single coherent shot unless the draft implies cuts. No lists, no timestamps.',
  music: 'Target: a music model. Specify genre, mood, tempo feel, key instruments, and energy arc in one tight sentence or two. No lyrics unless the draft asks for them.',
}

// Preserve any @mention tokens (e.g. @Product, @Influencer) and [bracketed]
// placeholders verbatim — they resolve to bank refs downstream.
export async function enhancePlaygroundPrompt(draft: string, mode: PlaygroundMode): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatTarget()

  const userMessage = `Rewrite the draft prompt below so it produces a much better result. Keep the user's intent and subject; make it concrete and specific.

${ENHANCE_MODE_GUIDE[mode]}

Rules:
- Preserve any @mention tokens (like @Product or @Influencer) and any [bracketed] placeholders EXACTLY as written, in place.
- Return ONLY the rewritten prompt as plain text. No preamble, no quotes, no markdown, no "Here is".

Draft:
"""
${draft}
"""`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: ENHANCE_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: userMessage }] },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages)
  return responseText
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*["']|["']\s*$/g, '')
    .trim()
}

// ── Image ──────────────────────────────────────────────────────────

export interface PlaygroundImageStartInput {
  prompt: string
  modelId: string
  aspectRatio: AspectRatio
  resolution?: ImageResolution
  // Already-hosted-or-resolvable refs. data: / http(s) / asset:// all welcome.
  referenceUrls?: string[]
}

export async function startPlaygroundImageTask(
  input: PlaygroundImageStartInput,
): Promise<{ taskId: string }> {
  const apiKey = useSettingsStore.getState().getKieApiKey()

  const inputUrls: string[] = []
  for (const ref of input.referenceUrls ?? []) {
    let source = ref
    if (isAssetRef(ref)) {
      const asset = await getAsBase64(ref)
      if (!asset) continue
      source = `data:${asset.mimeType};base64,${asset.base64}`
    }
    inputUrls.push(await ensureHostedUrl(apiKey, source))
  }

  const body = buildImageInput(input.modelId, {
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    inputUrls: inputUrls.length > 0 ? inputUrls : undefined,
  })
  const taskId = await createTask(apiKey, input.modelId, body)
  return { taskId }
}

export interface PlaygroundImageFinishInput {
  prompt: string
  aspectRatio: AspectRatio
  resolution?: ImageResolution
}

export async function finishPlaygroundImageTask(
  taskId: string,
  modelId: string,
  params: PlaygroundImageFinishInput,
): Promise<ImageHistoryItem> {
  const assetId = await finishImageAssetTask(taskId, modelId)

  const item: ImageHistoryItem = {
    id: crypto.randomUUID(),
    modelId,
    prompt: params.prompt,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
    imageUrl: assetId,
    createdAt: Date.now(),
  }
  await useBankStore.getState().addImageHistory(item)
  return item
}

// Marker stamped on every record this service produces so the B-Roll tab's
// Gallery view can filter Playground gens out — see types.ts BRoll/VideoHistoryItem.
const PLAYGROUND_SOURCE = 'playground' as const

// ── Gemini Omni characters ─────────────────────────────────────────

// Returns the bank model's persistent Omni character id, minting one via
// kie's /omni/character/create on first use and stamping it back onto the
// bank row. Idempotent — subsequent generations reuse the stored id.
export async function ensureOmniCharacterId(bankModelId: string): Promise<string> {
  const bank = useBankStore.getState()
  const model = bank.models.find((m) => m.id === bankModelId)
  if (!model) throw new Error('Character not found in bank. It may have been deleted.')
  if (model.omniCharacterId) return model.omniCharacterId

  const apiKey = useSettingsStore.getState().getKieApiKey()

  let source = model.characterImage
  if (isAssetRef(source)) {
    const asset = await getAsBase64(source)
    if (!asset) throw new Error(`Couldn't load the image for "${model.name}". Its asset is missing.`)
    source = `data:${asset.mimeType};base64,${asset.base64}`
  }
  const imageUrl = await ensureHostedUrl(apiKey, source)

  // Character description: name + notes + the DNA profile JSON, clamped to
  // kie's 20k-char limit. The profile is the richest signal we have.
  const parts = [model.name, model.notes, model.jsonProfile ? JSON.stringify(model.jsonProfile) : '']
  const descriptions = parts.filter(Boolean).join('\n\n').slice(0, 20_000) || model.name

  const created = await kieOmniCharacterCreate(apiKey, {
    imageUrl,
    descriptions,
    characterName: model.name.slice(0, 100) || undefined,
  })
  if (!created.characterId) {
    throw new Error(`Omni character creation returned no characterId for "${model.name}".`)
  }
  await bank.updateModel(bankModelId, { omniCharacterId: created.characterId })
  return created.characterId
}

// Mints a one-off Omni character id from an uploaded image (no bank row). The
// image is hosted, then /omni/character/create returns a reusable id we attach
// straight to the ref — mirrors ensureOmniCharacterId minus the bank stamping.
export async function createOmniCharacterFromImage(dataUri: string, name?: string): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const imageUrl = await ensureHostedUrl(apiKey, dataUri)
  const created = await kieOmniCharacterCreate(apiKey, {
    imageUrl,
    descriptions: name || 'Uploaded character',
    characterName: (name || 'Character').slice(0, 100),
  })
  if (!created.characterId) {
    throw new Error('Omni character creation returned no characterId.')
  }
  return created.characterId
}

// ── Video ──────────────────────────────────────────────────────────

export interface PlaygroundVideoStartInput {
  prompt: string
  modelId: string
  mode: VideoMode
  aspectRatio: string
  durationSeconds: number
  resolution: string
  audio: boolean
  // data: URIs / asset:// refs / http(s) — we resolve them here.
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  // Seedance 2 family — reference audio (≤15s total) and video (≤15s total)
  // clips. Sent regardless of the image mode; they're orthogonal inputs.
  referenceAudioUrls?: string[]
  referenceVideoUrls?: string[]
  // Gemini Omni — bank model ids to attach as persistent characters (the
  // omni id is minted lazily via ensureOmniCharacterId), designed voice ids,
  // and an optional trimmed source clip.
  omniCharacterBankIds?: string[]
  // Pre-minted Omni character ids from uploaded images (no bank row) — merged
  // with the bank-resolved ids above.
  omniCharacterIds?: string[]
  omniAudioIds?: string[]
  videoClip?: { url: string; start: number; ends: number }
  // Kling Motion Control — the reference character image + driving video
  // (data: / asset:// / http(s), resolved + hosted here) and the orientation.
  motionImageUrl?: string
  motionVideoUrl?: string
  characterOrientation?: 'image' | 'video'
}

export async function startPlaygroundVideoTask(
  input: PlaygroundVideoStartInput,
): Promise<{ taskId: string; videoEndpoint?: 'veo' }> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const model = getModel(input.modelId)
  if (!model) throw new Error(`Model not found: ${input.modelId}`)

  async function hosted(ref: string | undefined): Promise<string | undefined> {
    if (!ref) return undefined
    let source = ref
    if (isAssetRef(ref)) {
      const asset = await getAsBase64(ref)
      if (!asset) return undefined
      source = `data:${asset.mimeType};base64,${asset.base64}`
    }
    return ensureHostedUrl(apiKey, source)
  }

  let imageUrl: string | undefined
  let firstFrameUrl: string | undefined
  let lastFrameUrl: string | undefined
  let referenceImageUrls: string[] | undefined

  if (input.mode === 'image-to-video') {
    imageUrl = await hosted(input.firstFrameUrl)
  } else if (input.mode === 'frames-to-video') {
    firstFrameUrl = await hosted(input.firstFrameUrl)
    lastFrameUrl = await hosted(input.lastFrameUrl)
  }
  // Reference images are hosted whenever the caller passes them, NOT only in
  // reference mode — the same rule the audio/video strips below already follow.
  // The `else if` this replaced meant a model that takes frames AND references
  // in one request (Gemini Omni, Grok — see mixedImageInputPolicy) had its
  // references dropped here, one layer below the code that decided to send
  // them. Whether the pair is legal at all is the CALLER's call, since only it
  // knows the policy; this function's job is to host what it was handed.
  if (input.referenceImageUrls?.length) {
    referenceImageUrls = []
    for (const r of input.referenceImageUrls) {
      const h = await hosted(r)
      if (h) referenceImageUrls.push(h)
    }
  }

  // Media references are orthogonal to the image mode — host them whenever
  // present (data URIs from uploads get pushed to kie's file host).
  async function hostedList(refs: string[] | undefined): Promise<string[] | undefined> {
    if (!refs?.length) return undefined
    const out: string[] = []
    for (const r of refs) {
      const h = await hosted(r)
      if (h) out.push(h)
    }
    return out.length > 0 ? out : undefined
  }
  const referenceAudioUrls = await hostedList(input.referenceAudioUrls)
  const referenceVideoUrls = await hostedList(input.referenceVideoUrls)

  let videoClip: { url: string; start: number; ends: number } | undefined
  if (input.videoClip) {
    const url = await hosted(input.videoClip.url)
    if (!url) throw new Error('The source video clip could not be loaded. Re-attach it and try again.')
    videoClip = { url, start: input.videoClip.start, ends: input.videoClip.ends }
  }

  // Omni characters: resolve each attached bank influencer to its persistent
  // character id, minting on first use.
  let omniCharacterIds: string[] | undefined
  if (input.omniCharacterBankIds?.length || input.omniCharacterIds?.length) {
    omniCharacterIds = []
    for (const bankId of input.omniCharacterBankIds ?? []) {
      omniCharacterIds.push(await ensureOmniCharacterId(bankId))
    }
    // Uploaded characters were already minted at attach time.
    if (input.omniCharacterIds?.length) omniCharacterIds.push(...input.omniCharacterIds)
  }

  // Motion Control: host the reference image + driving video. The video is
  // typically a large data: URI (an uploaded clip) that ensureHostedUrl pushes
  // to kie's file host.
  let motionImageUrl: string | undefined
  let motionVideoUrl: string | undefined
  if (input.mode === 'motion-control') {
    motionImageUrl = await hosted(input.motionImageUrl)
    motionVideoUrl = await hosted(input.motionVideoUrl)
    if (!motionImageUrl || !motionVideoUrl) {
      throw new Error('Motion Control needs both a character image and a driving video. Re-attach them and try again.')
    }
  }

  const buildOpts = {
    prompt: input.prompt,
    mode: input.mode,
    aspectRatio: input.aspectRatio,
    duration: input.durationSeconds,
    resolution: input.resolution,
    audio: input.audio,
    imageUrl,
    firstFrameUrl,
    lastFrameUrl,
    referenceImageUrls,
    referenceAudioUrls,
    referenceVideoUrls,
    omniCharacterIds,
    omniAudioIds: input.omniAudioIds?.length ? input.omniAudioIds : undefined,
    videoClip,
    motionImageUrl,
    motionVideoUrl,
    characterOrientation: input.characterOrientation,
  }
  const body = buildVideoInput(input.modelId, buildOpts)

  if (model.videoEndpoint === 'veo') {
    const taskId = await kieVeoCreate(apiKey, body)
    return { taskId, videoEndpoint: 'veo' }
  }

  const apiSlug = resolveVideoModelSlug(input.modelId, buildOpts)
  const taskId = await createTask(apiKey, apiSlug, body)
  return { taskId }
}

export interface PlaygroundVideoFinishInput {
  prompt: string
  mode: VideoMode
  aspectRatio: string
  durationSeconds: number
  resolution: string
  audio: boolean
}

export async function finishPlaygroundVideoTask(
  taskId: string,
  modelId: string,
  videoEndpoint: 'veo' | undefined,
  params: PlaygroundVideoFinishInput,
): Promise<VideoHistoryItem> {
  const assetId = await finishVideoAssetTask(taskId, modelId, videoEndpoint)

  const historyEntry: VideoHistoryItem = {
    id: crypto.randomUUID(),
    modelId,
    prompt: params.prompt,
    mode: params.mode,
    aspectRatio: params.aspectRatio,
    durationSeconds: params.durationSeconds,
    resolution: params.resolution,
    audio: params.audio,
    videoUrl: assetId,
    sourceApp: PLAYGROUND_SOURCE,
    createdAt: Date.now(),
  }
  await useBankStore.getState().addVideoHistory(historyEntry)
  return historyEntry
}

// ── Music ──────────────────────────────────────────────────────────

export interface PlaygroundMusicStartInput {
  prompt: string
  modelId: string
  instrumental: boolean
}

export async function startPlaygroundMusicTask(
  input: PlaygroundMusicStartInput,
): Promise<{ taskId: string }> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const body = buildMusicInput(input.modelId, {
    prompt: input.prompt,
    instrumental: input.instrumental,
  })
  const taskId = await kieMusicGenerate(apiKey, body)
  return { taskId }
}

export interface PlaygroundMusicFinishInput {
  prompt: string
  instrumental: boolean
}

export async function finishPlaygroundMusicTask(
  taskId: string,
  modelId: string,
  params: PlaygroundMusicFinishInput,
): Promise<MusicHistoryItem> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const record = await pollMusicTask(apiKey, taskId)

  // sunoData[] holds up to two tracks. We grab the first track here; future
  // could split into a stereo "pair tile". The streamUrl is preferred when
  // present because the regular audioUrl can lag a few seconds for v5 tracks.
  const track = record.response?.sunoData?.[0]
  if (!track?.audioUrl) {
    throw new Error(
      `${modelId}: Suno returned SUCCESS but no audioUrl. record=${JSON.stringify(record).slice(0, 400)}`,
    )
  }

  const dlUrl = track.audioUrl
  const res = await fetchGeneratedAsset(dlUrl)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `Failed to download generated audio (${res.status} ${res.statusText}). url=${dlUrl} body=${body.slice(0, 200)}`,
    )
  }
  const blob = await res.blob()
  const audioRef = await saveAsset(blob, blob.type || 'audio/mpeg')

  let coverImageRef: string | undefined
  if (track.imageUrl) {
    try {
      const coverRes = await fetchGeneratedAsset(track.imageUrl)
      if (coverRes.ok) {
        const coverBlob = await coverRes.blob()
        coverImageRef = await saveAsset(coverBlob, coverBlob.type || 'image/jpeg')
      }
    } catch {
      // Cover is optional — never block the track on it.
    }
  }

  const item: MusicHistoryItem = {
    id: crypto.randomUUID(),
    modelId,
    prompt: params.prompt,
    instrumental: params.instrumental,
    audioRef,
    coverImageRef,
    title: track.title,
    durationSeconds: track.duration,
    createdAt: Date.now(),
  }
  await useBankStore.getState().addMusicHistory(item)
  return item
}
