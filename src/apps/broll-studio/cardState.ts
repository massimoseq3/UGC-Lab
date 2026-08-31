import type { PromptVariation, CardState, ContinuousConcept, ContinuousScene, ContinuousFrameCardState, ContinuousClipCardState } from './types'
import { refsToToggles } from './types'
import { getDefaultModel, getModel, snapVideoDuration, type ImageResolution } from '../../utils/models'
import { useSettingsStore } from '../../stores/settingsStore'
import { autoClipSeconds, speaksItsLine, DEFAULT_CLIP_SECONDS } from './services/clipDuration'

// Card-state factory + legacy-shape migration. Lives in its own module (not
// inside ScenesView / RightPanel) so those component files only export
// components — keeps React Fast Refresh working when editing the B-Roll UI.

// The video model a fresh card will generate with.
function selectedVideoModelId(): string | undefined {
  return useSettingsStore.getState().getAppModel('broll-studio:video')
    ?? getDefaultModel('broll-studio', 'video')?.id
}

// Constraints of the video model a fresh card will generate with.
function selectedVideoConstraints() {
  const modelId = selectedVideoModelId()
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

// Clip length. When the card SPEAKS a line we know how long the words take, so
// the length is that line's own estimate (see services/clipDuration) — a
// dialogue card is Auto until the member picks a number in its modal. Every
// other card (a silent B-Roll Clips variation, a hand-added option, a
// placeholder) falls back to the app-wide 5s, snapped to the nearest option at
// or below on a model that doesn't offer it (Omni [4,6,8,10] → 4s). Seeding
// here rather than leaning on the modal's snap matters because Omni's
// buildVideoInput coerces an off-grid duration to 8s — so a card generated
// straight from the grid, never opened, would otherwise bill double the card
// the user opened first.
function defaultVideoDuration(spokenLine?: string): number {
  if (spokenLine?.trim()) return autoClipSeconds(spokenLine, selectedVideoModelId())
  const c = selectedVideoConstraints()
  return c ? snapVideoDuration(DEFAULT_CLIP_SECONDS, c.durations) : DEFAULT_CLIP_SECONDS
}

// Initial CardState for a freshly-mounted variation. Per-card settings
// default to 9:16 / 1K / audio-on — same defaults the old global
// SettingsPopover used as seed values. Video resolution follows the selected
// model's preferred tier, and clip length follows the scene's own line on a
// card that speaks it (see the two helpers above).
export function createDefaultCardState(variation: PromptVariation, scriptLine?: string): CardState {
  const { refsCharacter, refsProduct } = refsToToggles(variation.refs ?? 'both')
  const initialPrompt = variation.prompt ?? ''
  const spoken = speaksItsLine(variation)
  return {
    editablePrompt: initialPrompt,
    promptHistory: [initialPrompt],
    promptHistoryIndex: 0,
    // What the still DOES, written by the storyboard alongside it. Empty on a
    // variation that carries none (a legacy session, an import, a hand-added
    // option) — the Animate tab falls back to the still prompt there.
    animateMotion: variation.motionPrompt ?? '',
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
    // The product photo(s) the storyboard picked for this shot — the state it's
    // actually in. Absent → the card falls back to the hero packshot alone.
    ...(variation.productPhotos ? { productPhotos: variation.productPhotos } : {}),
    // ON, but it only ever bites on the ANCHOR card — the first DIALOGUE
    // variation of each scene, which is the only card `dialogueChainRefs` hands
    // a `chainImageRef` to. Every other card has nothing to chain from, so this
    // flag is inert there (no reference attached, no "Previous cut" slot, and
    // it can't join the batch's sequential queue, which filters `dialogueKeys`).
    //
    // The anchor column is one continuous sitting held across the whole ad, and
    // prose alone can't hold a room across four separate image generations —
    // the previous cut's still is what actually keeps the place, the light and
    // the camera position from drifting. The two alternative cards stay free to
    // be different situations, which is what they're written for.
    chainLink: true,
    cardImageAspectRatio: '9:16',
    cardImageResolution: '1K',
    cardVideoAspectRatio: '9:16',
    cardVideoDurationSeconds: defaultVideoDuration(spoken ? scriptLine : undefined),
    // Auto on a DIALOGUE card until the member picks a length in its modal: the
    // clip has to hold this scene's spoken line, and the line is the only thing
    // that knows how long that is. Stays true through a model swap so the
    // estimate re-snaps onto the new model's ladder rather than keeping the old
    // one's number. A silent card gets no Auto at all — see clipDuration.
    cardVideoDurationAuto: spoken,
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

// The only clip lengths the pre-Auto seeder could produce: the app-wide 5s, and
// the 4s it snapped down to on a model whose ladder skips 5 (Gemini Omni,
// Seedance 1.5 Pro). See the note on cardVideoDurationAuto below.
const SEEDED_DURATIONS = [4, 5]

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
    // Cards persisted before the storyboard wrote a motion have none, and there
    // is nothing to derive one from — the animate path reads the still prompt
    // when this is empty, which is what those sessions have always fired.
    animateMotion: (card.animateMotion as string) ?? '',
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
    // An older "Dialogue Clips" session wrote an explicit `true` here, so it
    // keeps its chain; anything generated since writes an explicit `false`. Only
    // a card from before the field existed lands on the `true` fallback, and
    // those sessions were all chained.
    chainLink: card.chainLink !== false,
    cardImageAspectRatio: (card.cardImageAspectRatio as string) ?? '9:16',
    cardImageResolution: (card.cardImageResolution as ImageResolution) ?? '1K',
    cardVideoAspectRatio: (card.cardVideoAspectRatio as string) ?? '9:16',
    cardVideoDurationSeconds: (card.cardVideoDurationSeconds as number) ?? 5,
    // Cards persisted before the flag existed all stored a number whether or
    // not anyone chose it, so "a stored value is a real pick" — the rule the
    // rest of the app goes by — doesn't hold here. What does hold is that the
    // old seeder could only ever produce SEEDED_DURATIONS: anything else in
    // this slot was typed by a member and stays theirs, and those two values
    // are exactly the "nobody picked this" case. A member who really did pick
    // 4s or 5s loses nothing worth keeping — a short line estimates back to the
    // same number, and a long one gets the fix.
    //
    // This resolves "did anybody pick this length", not "is this card Auto":
    // on a silent card the flag only says whether the stored number is the
    // member's or the default's (`silentClipSeconds`), since Auto never
    // applies there.
    cardVideoDurationAuto: (card.cardVideoDurationAuto as boolean | undefined)
      ?? SEEDED_DURATIONS.includes((card.cardVideoDurationSeconds as number) ?? 5),
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

// How long a persisted in-flight entry survives a reload — and there are TWO
// answers, told apart by one field: does it still hold a kie taskId?
//
// WITH a taskId, the generation already happened and was already billed for,
// and kie keeps a result for 3 days. So the entry is kept for 3 days too, and
// every reload inside that window is another chance for the resume pass to go
// and fetch the file. Sweeping those after 30/60 minutes is what turned "the
// Wi-Fi died while the clip was downloading" into a clip the member paid for
// and could never get back: the sweep ran before any resume could, so by the
// time they looked there was nothing left to retry.
//
// WITHOUT one, the generation never reached kie. There is nothing to go back
// for, so the short sweep still applies — otherwise a phantom spinner sits in
// the gallery for days.
const RESUMABLE_TTL_MS = 3 * 24 * 60 * 60_000

function keepInFlight(entry: { startedAt?: number; taskId?: string | null }, unresumableTtlMs: number): boolean {
  const age = Date.now() - (entry.startedAt ?? 0)
  return age < (entry.taskId ? RESUMABLE_TTL_MS : unresumableTtlMs)
}

// Migrate the legacy single-slot pending-image fields onto the new
// inFlightImages array, preserving any persisted entries already in the
// new shape. Drops stale entries so refreshing doesn't try to resume a
// long-dead kie task — see keepInFlight for the two budgets.
function legacyInFlightImages(card: Partial<CardState> & Record<string, unknown>): CardState['inFlightImages'] {
  const STALE_MS = 30 * 60_000
  const persisted = Array.isArray(card.inFlightImages) ? (card.inFlightImages as CardState['inFlightImages']) : []
  const filtered = persisted.filter((e) => keepInFlight(e, STALE_MS))
  if (filtered.length > 0) return filtered
  // Promote legacy single-slot pending into the array if it's fresh.
  const taskId = card.pendingTaskId as string | null | undefined
  const modelId = card.pendingModelId as string | null | undefined
  const startedAt = card.pendingStartedAt as number | null | undefined
  if (taskId && modelId && startedAt && keepInFlight({ startedAt, taskId }, STALE_MS)) {
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
    ...(concept.productPhotos ? { productPhotos: concept.productPhotos } : {}),
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
    inFlightImages: inFlight.filter((e) => keepInFlight(e, STALE_MS)),
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
    inFlightVideos: inFlight.filter((e) => keepInFlight(e, STALE_MS)),
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
  const filtered = persisted.filter((e) => keepInFlight(e, STALE_MS))
  if (filtered.length > 0) return filtered
  const taskId = card.videoTaskId as string | null | undefined
  const modelId = card.videoModelId as string | null | undefined
  const startedAt = card.videoStartedAt as number | null | undefined
  if (taskId && modelId && startedAt && keepInFlight({ startedAt, taskId }, STALE_MS)) {
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
