import type { PromptVariation, CardState, ContinuousConcept, ContinuousScene, ContinuousFrameCardState, ContinuousClipCardState } from './types'
import { refsToToggles } from './types'
import { getDefaultModel, getModel, snapVideoDuration, type ImageResolution } from '../../utils/models'
import { useSettingsStore } from '../../stores/settingsStore'

// Card-state factory + legacy-shape migration. Lives in its own module (not
// inside ScenesView / RightPanel) so those component files only export
// components — keeps React Fast Refresh working when editing the B-Roll UI.

// Constraints of the video model a fresh card will generate with.
function selectedVideoConstraints() {
  const modelId = useSettingsStore.getState().getAppModel('broll-studio:video')
    ?? getDefaultModel('broll-studio', 'video')?.id
  return modelId ? getModel(modelId)?.videoConstraints : undefined
}

// Seed a fresh card's video resolution from the currently-selected B-Roll
// video model. Models that declare a preferred default win (Gemini Omni →
// 1080p, same credits as 720p); otherwise fall back to 720p when supported.
// Without this, a card created while Omni is selected starts at the factory
// 720p and never gets the model's better same-price tier.
function defaultVideoResolution(): string {
  const c = selectedVideoConstraints()
  if (!c) return '720p'
  return c.default ?? (c.resolutions.includes('720p') ? '720p' : c.resolutions[0] ?? '720p')
}

// Same idea for clip length: the card wants 5s, but a model that doesn't offer
// it snaps to the nearest option at or below (Omni [4,6,8,10] → 4s). Seeding
// here rather than leaning on the modal's snap matters because Omni's
// buildVideoInput coerces an off-grid duration to 8s — so a card generated
// straight from the grid, never opened, would otherwise bill double the card
// the user opened first.
function defaultVideoDuration(): number {
  const c = selectedVideoConstraints()
  return c ? snapVideoDuration(5, c.durations) : 5
}

// Initial CardState for a freshly-mounted variation. Per-card settings
// default to 9:16 / 1K / 5s / audio-on — same defaults the old global
// SettingsPopover used as seed values. Video resolution and duration follow
// the selected model's preferred tier (see the two helpers above).
export function createDefaultCardState(variation: PromptVariation): CardState {
  const { refsCharacter, refsProduct } = refsToToggles(variation.refs ?? 'both')
  const initialPrompt = variation.prompt ?? ''
  return {
    editablePrompt: initialPrompt,
    promptHistory: [initialPrompt],
    promptHistoryIndex: 0,
    images: [],
    currentImageIndex: 0,
    videos: [],
    currentVideoIndex: 0,
    selected: null,
    inFlightImages: [],
    inFlightVideos: [],
    isGeneratingImage: false,
    imageError: null,
    pendingTaskId: null,
    pendingModelId: null,
    pendingStartedAt: null,
    refsCharacter,
    refsProduct,
    // Only read by DIALOGUE cards — see CardState.chainLink.
    chainLink: true,
    cardImageAspectRatio: '9:16',
    cardImageResolution: '1K',
    cardVideoAspectRatio: '9:16',
    cardVideoDurationSeconds: defaultVideoDuration(),
    cardVideoResolution: defaultVideoResolution(),
    cardVideoAudio: true,
    isPromptWorking: false,
    promptError: null,
    videoStatus: 'idle',
    videoUrl: null,
    videoError: null,
    videoTaskId: null,
    videoModelId: null,
    videoEndpoint: undefined,
    videoStartedAt: null,
    videoSourceBRollId: undefined,
    videoAspectRatio: null,
    videoDurationSeconds: null,
    videoResolution: null,
    videoAudio: null,
    videoMode: null,
    videoPrompt: null,
  }
}

// Backfill new fields on legacy persisted card entries so older B-Roll runs
// keep working after this rev. Defaults match what createDefaultCardState
// produces for a fresh variation. Exported so BrollStudio's sanitize hook
// shares the same logic when hoisting cardStates up.
export function backfillCardState(card: Partial<CardState> & Record<string, unknown>): CardState {
  const editablePrompt = (card.editablePrompt as string) ?? ''
  const promptHistory = Array.isArray(card.promptHistory) && (card.promptHistory as string[]).length > 0
    ? (card.promptHistory as string[])
    : [editablePrompt]
  const promptHistoryIndex = typeof card.promptHistoryIndex === 'number'
    ? Math.max(0, Math.min(card.promptHistoryIndex as number, promptHistory.length - 1))
    : promptHistory.length - 1

  // Migrate legacy single `videoUrl` → first entry in `videos[]`. Earlier
  // sessions persisted exactly one video per card; on hydrate we lift it
  // into the new array shape so the user doesn't lose anything.
  const persistedVideos = Array.isArray(card.videos) ? (card.videos as CardState['videos']) : []
  const legacyVideoUrl = card.videoUrl as string | null | undefined
  const videos: CardState['videos'] = persistedVideos.length > 0
    ? persistedVideos
    : legacyVideoUrl
      ? [{
          url: legacyVideoUrl,
          modelId: (card.videoModelId as string | null) ?? '',
          prompt: (card.videoPrompt as string | null) ?? editablePrompt,
          aspectRatio: (card.videoAspectRatio as string | null) ?? '9:16',
          durationSeconds: (card.videoDurationSeconds as number | null) ?? 5,
          resolution: (card.videoResolution as string | null) ?? '720p',
          audio: (card.videoAudio as boolean | null) ?? true,
          mode: (card.videoMode as CardState['videoMode']) ?? 'text-to-video',
          sourceBRollId: card.videoSourceBRollId as string | undefined,
          createdAt: (card.videoStartedAt as number | null) ?? Date.now(),
        }]
      : []
  const currentVideoIndex = typeof card.currentVideoIndex === 'number'
    ? Math.max(0, Math.min(card.currentVideoIndex as number, Math.max(0, videos.length - 1)))
    : Math.max(0, videos.length - 1)
  const selected = (card.selected as CardState['selected']) ?? null

  return {
    editablePrompt,
    promptHistory,
    promptHistoryIndex,
    images: ((card.images as CardState['images']) ?? []).map((img) => ({
      ...img,
      // Legacy images persisted before iteration 3 didn't carry createdAt.
      // Backfill with "now" so they all land in the modal's "Today" bucket.
      createdAt: img.createdAt ?? Date.now(),
    })),
    currentImageIndex: (card.currentImageIndex as number) ?? 0,
    // Migrate legacy single-slot pending image into the new in-flight
    // array. Same with the in-flight video slot. After this hop the
    // resume effect drives both as parallel queues.
    inFlightImages: legacyInFlightImages(card),
    inFlightVideos: legacyInFlightVideos(card),
    videos,
    currentVideoIndex,
    selected,
    isGeneratingImage: !!card.isGeneratingImage,
    imageError: (card.imageError as string | null) ?? null,
    pendingTaskId: (card.pendingTaskId as string | null) ?? null,
    pendingModelId: (card.pendingModelId as string | null) ?? null,
    pendingStartedAt: (card.pendingStartedAt as number | null) ?? null,
    refsCharacter: card.refsCharacter !== false,
    refsProduct: card.refsProduct !== false,
    chainLink: card.chainLink !== false,
    cardImageAspectRatio: (card.cardImageAspectRatio as string) ?? '9:16',
    cardImageResolution: (card.cardImageResolution as ImageResolution) ?? '1K',
    cardVideoAspectRatio: (card.cardVideoAspectRatio as string) ?? '9:16',
    cardVideoDurationSeconds: (card.cardVideoDurationSeconds as number) ?? 5,
    cardVideoResolution: (card.cardVideoResolution as string) ?? '720p',
    cardVideoAudio: card.cardVideoAudio !== false,
    isPromptWorking: false,
    promptError: null,
    videoStatus: (card.videoStatus as CardState['videoStatus']) ?? 'idle',
    videoUrl: (card.videoUrl as string | null) ?? null,
    videoError: (card.videoError as string | null) ?? null,
    videoTaskId: (card.videoTaskId as string | null) ?? null,
    videoModelId: (card.videoModelId as string | null) ?? null,
    videoEndpoint: card.videoEndpoint as CardState['videoEndpoint'],
    videoStartedAt: (card.videoStartedAt as number | null) ?? null,
    videoSourceBRollId: card.videoSourceBRollId as string | undefined,
    videoAspectRatio: (card.videoAspectRatio as string | null) ?? null,
    videoDurationSeconds: (card.videoDurationSeconds as number | null) ?? null,
    videoResolution: (card.videoResolution as string | null) ?? null,
    videoAudio: (card.videoAudio as boolean | null) ?? null,
    videoMode: (card.videoMode as CardState['videoMode']) ?? null,
    videoPrompt: (card.videoPrompt as string | null) ?? null,
  }
}

// Migrate the legacy single-slot pending-image fields onto the new
// inFlightImages array, preserving any persisted entries already in the
// new shape. Drops stale entries (>30 min) so refreshing doesn't try to
// resume a long-dead kie task.
function legacyInFlightImages(card: Partial<CardState> & Record<string, unknown>): CardState['inFlightImages'] {
  const STALE_MS = 30 * 60_000
  const persisted = Array.isArray(card.inFlightImages) ? (card.inFlightImages as CardState['inFlightImages']) : []
  const filtered = persisted.filter((e) => Date.now() - (e.startedAt ?? 0) < STALE_MS)
  if (filtered.length > 0) return filtered
  // Promote legacy single-slot pending into the array if it's fresh.
  const taskId = card.pendingTaskId as string | null | undefined
  const modelId = card.pendingModelId as string | null | undefined
  const startedAt = card.pendingStartedAt as number | null | undefined
  if (taskId && modelId && startedAt && Date.now() - startedAt < STALE_MS) {
    return [{
      id: 'legacy-image',
      taskId,
      modelId,
      startedAt,
      prompt: (card.editablePrompt as string) ?? '',
      aspectRatio: (card.cardImageAspectRatio as string) ?? '9:16',
      resolution: (card.cardImageResolution as string) ?? '1K',
    }]
  }
  return []
}

// ── Continuous mode card states ──────────────────────────────────

// Fresh per-concept keyframe card (image-only). Refs come from the storyboard's
// own per-concept call; absent that (legacy rows, hand-added concepts) they fall
// back to the scene's product visibility, and absent that to both on — the view
// drops refs whose bank item is missing at fire time anyway.
export function createDefaultContinuousFrameState(
  concept: ContinuousConcept,
  opts?: { productVisible?: boolean },
): ContinuousFrameCardState {
  const toggles = concept.refs
    ? refsToToggles(concept.refs)
    : { refsCharacter: true, refsProduct: opts?.productVisible !== false }
  return {
    editablePrompt: concept.prompt,
    promptHistory: [concept.prompt],
    promptHistoryIndex: 0,
    images: [],
    currentImageIndex: 0,
    inFlightImages: [],
    // Chaining to the previous keyframe is ON by default. It shipped off for a
    // while — all three of a frame's concepts anchor to the same previous image
    // and come back looking alike, which weakens the pick-a-concept step — but
    // this is continuous mode, and in practice the continuity is worth more than
    // the spread. Off per frame via the row's Chained/Unchained pill.
    chainLink: true,
    ...toggles,
    aspectRatio: '9:16',
    resolution: '1K',
    // Standalone-animate defaults. Motion seeds from the concept's departure
    // motion (final-frame concepts have none → empty, user can write one).
    animateMotion: concept.motionPrompt ?? '',
    videos: [],
    currentVideoIndex: 0,
    inFlightVideos: [],
    videoDurationSeconds: defaultVideoDuration(),
    videoResolution: defaultVideoResolution(),
    videoAudio: true,
  }
}

// Fresh per-clip card. Resolution follows the continuous model's preferred tier;
// duration seeds from the scene's planned length.
export function createDefaultContinuousClipState(scene: ContinuousScene, modelId: string): ContinuousClipCardState {
  const c = getModel(modelId)?.videoConstraints
  const resolution = c
    ? c.default ?? (c.resolutions.includes('720p') ? '720p' : c.resolutions[0] ?? '720p')
    : '720p'
  const durationSeconds = c ? snapVideoDuration(scene.durationSeconds, c.durations) : scene.durationSeconds
  // The motion paragraph ends with its own sound direction. Only append the
  // separate `sfx` field when the model answered without one — matching either
  // a labelled `SFX:` line (legacy responses) or the word appearing in the
  // prose — otherwise the card shows the sound direction twice.
  const motion = scene.motionPrompt.trim()
  const sfx = scene.sfx.trim()
  const alreadyHasSfx = /^SFX:/im.test(motion) || (!!sfx && motion.toLowerCase().includes(sfx.toLowerCase()))
  const editablePrompt = sfx && !alreadyHasSfx ? `${motion} ${sfx}.` : motion
  return {
    editablePrompt,
    promptHistory: [editablePrompt],
    promptHistoryIndex: 0,
    motionEdited: false,
    videos: [],
    currentVideoIndex: 0,
    inFlightVideos: [],
    durationSeconds,
    resolution,
    audio: true,
  }
}

// Defensive hydrate for persisted Continuous frame cards. Drops in-flight image
// entries past the 30-min TTL (image tasks never run longer).
export function backfillContinuousFrameState(raw: Partial<ContinuousFrameCardState> & Record<string, unknown>): ContinuousFrameCardState {
  const STALE_MS = 30 * 60_000
  const images = Array.isArray(raw.images) ? (raw.images as ContinuousFrameCardState['images']) : []
  const inFlight = Array.isArray(raw.inFlightImages) ? (raw.inFlightImages as ContinuousFrameCardState['inFlightImages']) : []
  const editablePrompt = (raw.editablePrompt as string) ?? ''
  const promptHistory = Array.isArray(raw.promptHistory) && (raw.promptHistory as string[]).length > 0
    ? (raw.promptHistory as string[])
    : [editablePrompt]
  return {
    editablePrompt,
    promptHistory,
    promptHistoryIndex: typeof raw.promptHistoryIndex === 'number'
      ? Math.max(0, Math.min(raw.promptHistoryIndex, promptHistory.length - 1))
      : promptHistory.length - 1,
    images: images.map((img) => ({ ...img, createdAt: img.createdAt ?? Date.now() })),
    currentImageIndex: typeof raw.currentImageIndex === 'number'
      ? Math.max(0, Math.min(raw.currentImageIndex, Math.max(0, images.length - 1)))
      : Math.max(0, images.length - 1),
    inFlightImages: inFlight.filter((e) => Date.now() - (e.startedAt ?? 0) < STALE_MS),
    // On unless the row explicitly stored `false` — matching the fresh-card
    // default, so a legacy row that predates the field behaves like a new one
    // and a frame the user unchained stays unchained.
    chainLink: raw.chainLink !== false,
    refsCharacter: raw.refsCharacter !== false,
    refsProduct: raw.refsProduct !== false,
    aspectRatio: (raw.aspectRatio as string) ?? '9:16',
    resolution: (raw.resolution as ImageResolution) ?? '1K',
    // Standalone-animate fields (added later — default for legacy rows). Video
    // TTL matches the clip cards' 60-min window so a refresh resumes recent gens.
    animateMotion: (raw.animateMotion as string) ?? '',
    videos: Array.isArray(raw.videos) ? (raw.videos as ContinuousFrameCardState['videos']) : [],
    currentVideoIndex: typeof raw.currentVideoIndex === 'number'
      ? Math.max(0, Math.min(raw.currentVideoIndex, Math.max(0, (Array.isArray(raw.videos) ? raw.videos.length : 0) - 1)))
      : Math.max(0, (Array.isArray(raw.videos) ? raw.videos.length : 0) - 1),
    inFlightVideos: (Array.isArray(raw.inFlightVideos) ? (raw.inFlightVideos as ContinuousFrameCardState['inFlightVideos']) : [])
      .filter((e) => Date.now() - (e.startedAt ?? 0) < 60 * 60_000),
    videoDurationSeconds: typeof raw.videoDurationSeconds === 'number' ? raw.videoDurationSeconds : 5,
    videoResolution: (raw.videoResolution as string) ?? '720p',
    videoAudio: raw.videoAudio !== false,
  }
}

// Defensive hydrate for persisted Continuous clip cards — same 60-min video TTL
// posture as the other modes.
export function backfillContinuousClipState(raw: Partial<ContinuousClipCardState> & Record<string, unknown>): ContinuousClipCardState {
  const STALE_MS = 60 * 60_000
  const videos = Array.isArray(raw.videos) ? (raw.videos as ContinuousClipCardState['videos']) : []
  const inFlight = Array.isArray(raw.inFlightVideos) ? (raw.inFlightVideos as ContinuousClipCardState['inFlightVideos']) : []
  const editablePrompt = (raw.editablePrompt as string) ?? ''
  const promptHistory = Array.isArray(raw.promptHistory) && (raw.promptHistory as string[]).length > 0
    ? (raw.promptHistory as string[])
    : [editablePrompt]
  return {
    editablePrompt,
    promptHistory,
    promptHistoryIndex: typeof raw.promptHistoryIndex === 'number'
      ? Math.max(0, Math.min(raw.promptHistoryIndex, promptHistory.length - 1))
      : promptHistory.length - 1,
    // Older rows had no auto-sync; treat them as edited so a hydrate never
    // rewrites motion the user may have already tuned.
    motionEdited: raw.motionEdited !== false,
    videos,
    currentVideoIndex: typeof raw.currentVideoIndex === 'number'
      ? Math.max(0, Math.min(raw.currentVideoIndex, Math.max(0, videos.length - 1)))
      : Math.max(0, videos.length - 1),
    inFlightVideos: inFlight.filter((e) => Date.now() - (e.startedAt ?? 0) < STALE_MS),
    durationSeconds: typeof raw.durationSeconds === 'number' ? raw.durationSeconds : 5,
    resolution: (raw.resolution as string) ?? '720p',
    audio: raw.audio !== false,
  }
}

function legacyInFlightVideos(card: Partial<CardState> & Record<string, unknown>): CardState['inFlightVideos'] {
  // 60 min (vs images' 30): a video whose poll budget (~20 min) ran out is kept
  // in-flight so a refresh resumes it, and slow models (Seedance 2 / Veo
  // Quality) can render well past 30 min. Matches Playground's STALE_TASK_MS.
  const STALE_MS = 60 * 60_000
  const persisted = Array.isArray(card.inFlightVideos) ? (card.inFlightVideos as CardState['inFlightVideos']) : []
  const filtered = persisted.filter((e) => Date.now() - (e.startedAt ?? 0) < STALE_MS)
  if (filtered.length > 0) return filtered
  const taskId = card.videoTaskId as string | null | undefined
  const modelId = card.videoModelId as string | null | undefined
  const startedAt = card.videoStartedAt as number | null | undefined
  if (taskId && modelId && startedAt && Date.now() - startedAt < STALE_MS) {
    return [{
      id: 'legacy-video',
      taskId,
      modelId,
      endpoint: card.videoEndpoint as 'veo' | undefined,
      startedAt,
      prompt: (card.videoPrompt as string) ?? (card.editablePrompt as string) ?? '',
      mode: (card.videoMode as CardState['videoMode']) ?? 'text-to-video',
      aspectRatio: (card.videoAspectRatio as string) ?? '9:16',
      durationSeconds: (card.videoDurationSeconds as number) ?? 5,
      resolution: (card.videoResolution as string) ?? '720p',
      audio: (card.videoAudio as boolean) ?? true,
      sourceBRollId: card.videoSourceBRollId as string | undefined,
    }]
  }
  return []
}
