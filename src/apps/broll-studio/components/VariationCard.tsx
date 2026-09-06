import { useState, useEffect, useRef } from 'react'
import {
  ImageIcon, Video as VideoIcon, AlertCircle, Play, Pause, Volume2, VolumeX, Bookmark, Check, Copy, Download, Film,
} from 'lucide-react'
import Spinner from '../../../components/Spinner'
import { TileActionStack, TileActionButton, TileDeleteButton } from '../../../components/tileActions'
import { ExpandVideoButton } from '../../../components/VideoLightbox'
import ModelPill from '../../../components/ModelPill'
import { useShowGenerationInfo } from '../../../stores/generationInfoStore'
import { useInlineVideo } from '../../../hooks/useInlineVideo'
import { GeneratingMediaFill } from '../../../components/GeneratingMedia'
import { ANIMATE_MESSAGES } from '../../../components/generatingMessages'
import type { PromptVariation, CardState, GeneratedImage, ReferenceImage, BatchVideoSettings } from '../types'
import type { VideoHistoryItem, Product, Model, BRoll } from '../../../stores/types'
import { enhanceVariationPrompt, generateNewVariation, startImageTask, finishImageTask, buildDialogueChainPreamble, resolveImageModelId } from '../services/generateBroll'
import { withLockedCamera } from '../services/realism'
import { attachProductAngles, productRefsForSelection } from '../services/productAngles'
import { applyStyleToPrompt } from '../services/generateContinuous'
import { startVideoTask, finishVideoTask } from '../services/generateVideo'
import { cardClipSeconds } from '../services/clipDuration'
import { claimTask, releaseTask } from '../services/taskRegistry'
import { isPollTimeout } from '../../../utils/kie'
import { useBankStore } from '../../../stores/bankStore'
import { useAppStore } from '../../../stores/appStore'
import { useAssetUrl, useAssetPoster, posterVideoProps, posterPending } from '../../../hooks/useAssetUrl'
import { getAsBase64, getUrl, isAssetRef } from '../../../utils/assetStore'
import { getModel, getDefaultModel, type VideoMode, type ImageResolution } from '../../../utils/models'
import { useSettingsStore } from '../../../stores/settingsStore'
import CardDetailModal, { type Tab as DetailTab } from './CardDetailModal'
import { humanizeError } from '../../../utils/friendlyError'
import { rollTypeForTag, tagLabel, tagChipStyle } from './variationTags'
import { downloadImage } from '../../../utils/downloadImage'
import { copyToClipboard } from '../../../utils/clipboard'

// The three tabs the card's own hover row can open the detail modal on, in the
// order the work happens: the still first, then the clip, then animating that
// still. Module scope so the row below is one map rather than three
// near-identical buttons that had already drifted once.
const DETAIL_SHORTCUTS: Array<{ tab: DetailTab; label: string; icon: typeof ImageIcon }> = [
  { tab: 'image', label: 'Image', icon: ImageIcon },
  { tab: 'video', label: 'Video', icon: VideoIcon },
  { tab: 'animate', label: 'Animate', icon: Film },
]

interface VariationCardProps {
  sceneNumber: number
  scriptLine: string
  variation: PromptVariation
  cardState: CardState
  onUpdateState: (updates: Partial<CardState>) => void
  // Functional setter — handed the latest cardState, returns a partial.
  // Used for atomic array updates so parallel Generate clicks don't clobber
  // each other's `inFlightImages` / `inFlightVideos` entries.
  onUpdateStateFn: (updater: (prev: CardState) => Partial<CardState>) => void
  onDelete: () => void
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
  // Every photo the product bank row holds, hero first. The card sends the
  // one(s) its scene actually needs — see CardState.productPhotos.
  productPhotos?: string[]
  onChangeStyle?: () => void
  selectedProduct?: Product | null
  selectedModel?: Model | null
  selectedProductId?: string
  selectedModelId?: string
  selectedScriptId?: string
  productContext?: string
  modelContext?: string
  onOpenCharacterPicker?: () => void
  onOpenProductPicker?: () => void
  // Batch trigger. Each increment (from a Generate-all action) fires one image
  // generation. Undefined = no batch.
  generateImageToken?: number
  // Settings the active batch run chose (model is global; these override the
  // card's own aspect/resolution for the batched gen only).
  batchImageOverride?: { aspectRatio: string; resolution?: ImageResolution } | null
  // Same idea for video. Each increment of the token fires one clip: the card's
  // cover still animated when it has one, otherwise a reference-/text-to-video
  // off the prompt. Undefined = no batch.
  generateVideoToken?: number
  batchVideoOverride?: BatchVideoSettings | null
  // Visual style resolved on the result. Only a stylized look (realism === false)
  // appends a STYLE block to the prompt and drops the iPhone-realism stack; UGC
  // Realism / legacy leave the render untouched. See applyStyleToPrompt.
  resultStyle?: string
  resultRealism?: boolean
  // One shared voice description for the ad's dialogue clips. Only DIALOGUE
  // cards use it — appended to their video prompt at fire time so every talking
  // clip shares one voice. Editing it (via the modal) updates the shared value.
  voiceProfile?: string
  onUpdateVoiceProfile?: (text: string) => void
  // DIALOGUE cards only: the previous scene's chosen talking-head still (asset
  // ref). Attached first when `cardState.chainLink` is on, so every talking cut
  // holds the same character, room and camera setup. Undefined on the ad's first
  // dialogue card and on any card generated before an earlier one has an image.
  chainImageRef?: string
}

export default function VariationCard(props: VariationCardProps) {
  const {
    sceneNumber,
    scriptLine,
    variation,
    cardState,
    onUpdateState,
    onUpdateStateFn,
    onDelete,
    characterRef,
    productRef,
    productPhotos,
    onChangeStyle,
    selectedProduct,
    selectedModel,
    selectedProductId,
    selectedModelId,
    selectedScriptId,
    productContext,
    modelContext,
    onOpenCharacterPicker,
    onOpenProductPicker,
    generateImageToken,
    batchImageOverride,
    generateVideoToken,
    batchVideoOverride,
    resultStyle,
    resultRealism,
    voiceProfile,
    onUpdateVoiceProfile,
    chainImageRef,
  } = props

  // Is this card chaining off the previous scene's talking-head still? Only a
  // DIALOGUE card ever does — a b-roll card that inherited a previous shot's
  // staging would defeat the point of three different lenses.
  const isDialogue = variation.tag === 'DIALOGUE'
  const chainRef: ReferenceImage | null =
    isDialogue && chainImageRef && cardState.chainLink !== false
      ? { dataUrl: chainImageRef, label: 'previous-cut' }
      : null

  const hasImages = cardState.images.length > 0
  const hasVideos = cardState.videos.length > 0
  // Resolve the cover output for the scene card face. If `selected` points
  // at a valid generation, that wins; otherwise fall back to the most-recent
  // image, then video, then nothing.
  const coverKind: 'image' | 'video' | null = (() => {
    const sel = cardState.selected
    if (sel?.kind === 'image' && cardState.images[sel.index]) return 'image'
    if (sel?.kind === 'video' && cardState.videos[sel.index]) return 'video'
    if (hasImages) return 'image'
    if (hasVideos) return 'video'
    return null
  })()
  const coverImage = coverKind === 'image'
    ? cardState.images[cardState.selected?.kind === 'image' ? cardState.selected.index : cardState.currentImageIndex]
    : null
  const coverVideo = coverKind === 'video'
    ? cardState.videos[cardState.selected?.kind === 'video' ? cardState.selected.index : cardState.currentVideoIndex]
    : null
  const resolvedImageUrl = useAssetUrl(coverImage?.imageUrl)
  const resolvedVideoUrl = useAssetUrl(coverVideo?.url)
  // The card face is the clip's poster until it's hovered — a storyboard is a
  // row of these, and a <video> each with a decoder each is what Safari parks.
  const coverPoster = useAssetPoster(coverVideo?.url)
  const [detailOpen, setDetailOpen] = useState(false)
  // Which tab the modal lands on. The card body opens on Image — the still is
  // the first thing the card needs — and the hover shortcuts jump to any tab.
  const [detailTab, setDetailTab] = useState<DetailTab>('image')
  const openDetail = (tab: DetailTab) => {
    setDetailTab(tab)
    setDetailOpen(true)
  }
  // Extra user-attached reference images (beyond the bank-keyed character /
  // product refs). Memory-only — data: URIs are too big for the persisted card,
  // and they reset on a full refresh (same trade-off as the Influencers editor).
  const [extraRefs, setExtraRefs] = useState<ReferenceImage[]>([])
  // Two-click confirm for the card-face trash icon. First click flips this
  // flag (icon styling switches to red); second click within ~3s actually
  // calls onDelete. Matches the old modal-footer Delete behaviour.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Card-face quick save: bookmarks the cover output to the B-Rolls bank.
  const [savingCover, setSavingCover] = useState(false)
  const [savedCover, setSavedCover] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  // Inline video playback on the card face — one clip plays app-wide, so
  // starting this one stops whatever was running (see useInlineVideo).
  const cardVideo = useInlineVideo()
  const cardVideoPlaying = cardVideo.playing
  const cardVideoUnmuted = cardVideo.unmuted
  const showGenerationInfo = useShowGenerationInfo()

  // Drive the in-flight indicator off the parallel-queue array — the legacy
  // single-slot `videoStatus` field is no longer written by runVideoTask so
  // it stayed permanently 'idle', making the card face look idle even mid-gen.
  // Errored entries linger in the queue so the gallery can offer Retry — they
  // must NOT count as "still generating" or the card face spins forever.
  const activeInFlightVideos = cardState.inFlightVideos.filter((e) => !e.error)
  const isGeneratingVideo = activeInFlightVideos.length > 0
  const generatingVideoMode = activeInFlightVideos[0]?.mode
  const isAnimating = isGeneratingVideo && generatingVideoMode === 'image-to-video'
  const hasFailedInFlight =
    cardState.inFlightImages.some((e) => e.error) || cardState.inFlightVideos.some((e) => e.error)
  const activeInFlightImages = cardState.inFlightImages.filter((e) => !e.error)
  const isGeneratingImageInFlight = activeInFlightImages.length > 0
  // An image entry only learns its model once createTask returns, so name the
  // configured one until then — otherwise the label pops in a beat late and the
  // generating face jumps.
  const persistedImageModel = useSettingsStore((s) => s.getAppModel('broll-studio:image:text-to-image'))
  const imageModelId = persistedImageModel ?? getDefaultModel('broll-studio', 'image', 'text-to-image')?.id

  // ────────────────────────────────────────────────────────────────────────
  // Action handlers — owned here so both the modal (rendered as a child)
  // and any future face-level quick action use the same code path. The
  // current iteration only renders these actions inside the modal.
  // ────────────────────────────────────────────────────────────────────────

  // Attach script-level refs respecting the per-card on/off toggles
  // (cardState.refsCharacter / refsProduct), which the user controls via
  // the tick-circle button in each ReferenceSlotCard.
  //
  // Which of the product's photos this card sends. The storyboard picked the
  // state the shot is in (sealed wrapper / unwrapped / open box); the member can
  // re-tick it in the modal's photo strip. First pick is THE product reference,
  // any others ride behind it as angles.
  const { product: pickedProductRef, angles: pickedAngles } = productRefsForSelection(
    productPhotos ?? [],
    cardState.productPhotos,
  )

  // `modelId` is the model the request will really run on — it decides how many
  // of the extra angles fit. Omitted (image gens) → the resolved image model.
  // Nothing the user chose is ever dropped; only the auto angles are clamped.
  const buildCardRefs = (modelId?: string): ReferenceImage[] => {
    const out: ReferenceImage[] = []
    const productOn = !!productRef && cardState.refsProduct !== false
    if (characterRef && cardState.refsCharacter !== false) out.push(characterRef)
    if (productOn && pickedProductRef) out.push(pickedProductRef)
    // Any extra references the user attached in the modal ride along too.
    out.push(...extraRefs)
    return attachProductAngles({
      manual: out,
      angles: productOn ? pickedAngles : [],
      modelId: modelId ?? resolveImageModelId(true),
      // A chained DIALOGUE card prepends the previous cut at fire time.
      reserved: chainRef ? 1 : 0,
    })
  }

  // Push a new entry onto the prompt undo/redo stack, trimming any forward
  // redo branch. Reads the card's LIVE history rather than this render's copy:
  // the textarea stays editable during Enhance / Regenerate, so a snapshot
  // captured at click time truncated away anything the user committed while the
  // LLM was working, with no Undo path back to it.
  const pushPromptHistory = (newPrompt: string) => {
    onUpdateStateFn((prev) => {
      const truncated = prev.promptHistory.slice(0, prev.promptHistoryIndex + 1)
      const nextHistory = [...truncated, newPrompt]
      return {
        editablePrompt: newPrompt,
        promptHistory: nextHistory,
        promptHistoryIndex: nextHistory.length - 1,
      }
    })
  }

  const handleUndo = () => {
    if (cardState.promptHistoryIndex <= 0) return
    const nextIndex = cardState.promptHistoryIndex - 1
    onUpdateState({
      editablePrompt: cardState.promptHistory[nextIndex],
      promptHistoryIndex: nextIndex,
    })
  }
  const handleRedo = () => {
    if (cardState.promptHistoryIndex >= cardState.promptHistory.length - 1) return
    const nextIndex = cardState.promptHistoryIndex + 1
    onUpdateState({
      editablePrompt: cardState.promptHistory[nextIndex],
      promptHistoryIndex: nextIndex,
    })
  }

  // Commit the current textarea draft into history (used when the user
  // clicks Done after typing into the prompt textarea). Skips if the value
  // hasn't changed from the most recent history entry.
  const handleCommitDraft = (draft: string) => {
    const last = cardState.promptHistory[cardState.promptHistoryIndex]
    if (draft === last) {
      onUpdateState({ editablePrompt: draft })
      return
    }
    pushPromptHistory(draft)
  }

  const handleEnhance = async () => {
    if (cardState.isPromptWorking) return
    onUpdateState({ isPromptWorking: true, promptError: null })
    try {
      const rewritten = await enhanceVariationPrompt(
        cardState.editablePrompt,
        { number: sceneNumber, scriptLine },
        { tag: variation.tag, label: variation.label ?? '' },
        productContext,
        modelContext,
      )
      pushPromptHistory(rewritten)
      onUpdateState({ isPromptWorking: false, promptError: null })
    } catch (err) {
      const msg = humanizeError(err, 'Enhance failed.')
      onUpdateState({ isPromptWorking: false, promptError: msg })
      useAppStore.getState().addToast(msg, 'error')
    }
  }

  const handleRegeneratePrompt = async () => {
    if (cardState.isPromptWorking) return
    onUpdateState({ isPromptWorking: true, promptError: null })
    try {
      const fresh = await generateNewVariation(
        sceneNumber,
        scriptLine,
        scriptLine,
        variation.tag,
        productContext,
        modelContext,
      )
      pushPromptHistory(fresh.prompt)
      // A regenerate is a different shot, so the motion written for the old one
      // no longer describes anything on screen. Only overwritten when the model
      // actually returned one — a response that skipped the field leaves the
      // card's existing motion rather than blanking it.
      onUpdateState({
        isPromptWorking: false,
        promptError: null,
        ...(fresh.motionPrompt ? { animateMotion: fresh.motionPrompt } : {}),
      })
    } catch (err) {
      const msg = humanizeError(err, 'Regenerate failed.')
      onUpdateState({ isPromptWorking: false, promptError: msg })
      useAppStore.getState().addToast(msg, 'error')
    }
  }

  // Non-blocking parallel image generation. Each call pushes a new entry onto
  // `inFlightImages`; the button never disables. Completion removes the entry
  // and appends to `images`; failure leaves the entry with an `error` so the
  // gallery renders a Retry tile. Params are explicit so a retry re-runs the
  // failed entry's exact prompt/settings.
  const runImageGen = async (
    promptText: string,
    imageAspectRatio: string,
    imageResolution: ImageResolution | undefined,
    refs: ReferenceImage[],
  ) => {
    const inFlightId = crypto.randomUUID()

    // Push the in-flight entry immediately so the gallery shows the tile.
    onUpdateStateFn((prev) => ({
      inFlightImages: [
        ...prev.inFlightImages,
        {
          id: inFlightId,
          taskId: null,
          modelId: null,
          startedAt: Date.now(),
          prompt: promptText,
          aspectRatio: imageAspectRatio,
          resolution: imageResolution ?? '',
        },
      ],
    }))

    let taskId: string
    let modelId: string
    try {
      // Restyle at fire time: a stylized pick appends its STYLE block and drops
      // the iPhone-realism stack; UGC / legacy pass through untouched. The card's
      // stored prompt stays clean — the style rides outside it, like Continuous.
      const { prompt: styledPrompt, noRealism } = applyStyleToPrompt(promptText, {
        style: resultStyle,
        realism: resultRealism,
      })
      // A chained DIALOGUE card leads with the previous scene's talking-head
      // still and swaps in the preamble that tells the model to KEEP its staging
      // — the opposite of the identity-only scoping every other card gets.
      const finalRefs = chainRef ? [chainRef, ...refs] : refs
      const started = await startImageTask(styledPrompt, finalRefs, imageAspectRatio, imageResolution, {
        inheritReference: variation.tag === 'STATIC',
        noRealism,
        ...(chainRef ? { preambleOverride: buildDialogueChainPreamble(finalRefs) } : {}),
      })
      taskId = started.taskId
      modelId = started.modelId
      onUpdateStateFn((prev) => ({
        inFlightImages: prev.inFlightImages.map((e) =>
          e.id === inFlightId ? { ...e, taskId, modelId } : e,
        ),
      }))
    } catch (err) {
      const msg = humanizeError(err, 'Image generation failed. Try again.')
      onUpdateStateFn((prev) => ({
        inFlightImages: prev.inFlightImages.map((e) =>
          e.id === inFlightId ? { ...e, error: msg } : e,
        ),
      }))
      useAppStore.getState().addToast(msg, 'error')
      return
    }

    // Own this poll before the taskId lands in persisted state, so a resume
    // walker on a remounted view can't start a second poll for the same task.
    if (!claimTask('image', taskId)) return
    try {
      const imageUrl = await finishImageTask(taskId, modelId, imageResolution)
      const newImage: GeneratedImage = { imageUrl, prompt: promptText, modelId, createdAt: Date.now() }
      onUpdateStateFn((prev) => {
        const newImages = [...prev.images, newImage]
        return {
          images: newImages,
          currentImageIndex: newImages.length - 1,
          selected: { kind: 'image', index: newImages.length - 1 },
          inFlightImages: prev.inFlightImages.filter((e) => e.id !== inFlightId),
        }
      })
    } catch (err) {
      const msg = humanizeError(err, 'Image generation failed. Try again.')
      onUpdateStateFn((prev) => ({
        inFlightImages: prev.inFlightImages.map((e) =>
          e.id === inFlightId ? { ...e, error: msg } : e,
        ),
      }))
      useAppStore.getState().addToast(msg, 'error')
    } finally {
      releaseTask('image', taskId)
    }
  }

  const handleGenerateImage = () =>
    runImageGen(
      cardState.editablePrompt,
      cardState.cardImageAspectRatio,
      cardState.cardImageResolution,
      buildCardRefs(),
    )

  // Batch trigger. When the parent bumps `generateImageToken` (Generate-all),
  // fire one image gen with the card's current prompt/settings. The ref guard
  // means it never fires on mount or re-renders — only on a real increment —
  // and prompt-less cards are skipped.
  const lastImageTokenRef = useRef(generateImageToken ?? 0)
  useEffect(() => {
    const tok = generateImageToken ?? 0
    if (tok === lastImageTokenRef.current) return
    lastImageTokenRef.current = tok
    if (!cardState.editablePrompt.trim()) return
    // A batch run picks the model (global) + resolution + aspect once for the
    // whole run; honour those instead of each card's own settings. No override
    // (shouldn't happen) → fall back to the card's settings.
    if (batchImageOverride) {
      void runImageGen(
        cardState.editablePrompt,
        batchImageOverride.aspectRatio,
        batchImageOverride.resolution,
        buildCardRefs(),
      )
    } else {
      void handleGenerateImage()
    }
    // Intentionally only react to the token; the rest is read fresh from this
    // render's closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generateImageToken])

  // Card-face quick save — bookmarks the current cover STILL to the B-Rolls
  // bank. Only images are saveable (they're reusable as start frames); videos
  // are download-only, so the save button is hidden when the cover is a video.
  const handleSaveCover = async () => {
    if (savedCover || savingCover) return
    if (coverKind !== 'image' || !coverImage) return
    setSavingCover(true)
    try {
      await useBankStore.getState().addBRoll({
        imageUrl: coverImage.imageUrl,
        prompt: coverImage.prompt,
        productId: selectedProductId,
        modelId: selectedModelId,
        scriptId: selectedScriptId,
        sourceApp: 'broll-studio',
      } as Omit<BRoll, 'id' | 'createdAt'>)
      setSavedCover(true)
      useAppStore.getState().addToast('Saved to B-Rolls bank', 'success')
    } catch (err) {
      useAppStore.getState().addToast(humanizeError(err, 'Save failed'), 'error')
    } finally {
      setSavingCover(false)
    }
  }

  // Card-face download — saves the current cover (image or video) to disk.
  const handleDownloadCover = async () => {
    const ref = coverKind === 'image' ? coverImage?.imageUrl : coverVideo?.url
    if (!ref) return
    const url = await getUrl(ref)
    if (!url) {
      useAppStore.getState().addToast('Could not load the file.', 'error')
      return
    }
    await downloadImage(url, `broll-scene-${sceneNumber}`, coverKind === 'image' ? 'png' : 'mp4')
  }

  // Card-face copy — puts the card's current prompt on the clipboard.
  const handleCopyPrompt = async () => {
    const text = cardState.editablePrompt.trim()
    if (!text) return
    if (await copyToClipboard(text)) {
      setCopiedPrompt(true)
      window.setTimeout(() => setCopiedPrompt(false), 1600)
    }
  }

  const toDataUri = async (ref: string): Promise<string | null> => {
    if (!isAssetRef(ref)) return ref
    const asset = await getAsBase64(ref)
    if (!asset) return null
    return `data:${asset.mimeType};base64,${asset.base64}`
  }

  // Non-blocking parallel video generation. Same shape as image gen — push
  // to `inFlightVideos`, fire-and-forget, completion appends to `videos`.
  const runVideoTask = async (
    mode: VideoMode,
    firstFrameDataUri: string | undefined,
    referenceDataUris: string[] | undefined,
    videoModelId: string | undefined,
    // Asset ref behind firstFrameDataUri / a single-still reference, recorded
    // on the in-flight entry so Retry can replay the same generation.
    startFrameRef?: string,
    // A batch run's shared resolution/duration, standing in for the card's own.
    // The card's persisted settings are left untouched, exactly as the image
    // batch does — the run is one-off, not a new default for the card. An
    // absent `durationSeconds` is the dialog's Auto length: each card keeps its
    // own per-line estimate.
    batchSettings?: { resolution: string; durationSeconds?: number },
    // Set only when this run is ANIMATING a still, and it carries the card's
    // MOTION — one or two sentences of movement. The clip opens ON that still,
    // so handing a video model the still's own paragraph again reads as "draw
    // this picture" rather than "play this out", which is why those clips came
    // back barely moving. The from-scratch paths (text- and reference-to-video)
    // leave it undefined: they have no frame, so they need the picture
    // described and the still prompt is the right thing to send. Its presence
    // is also what arms the locked-camera clause below, for the same reason —
    // there is only a frame to hold still when there is a start frame.
    motionPrompt?: string,
  ) => {
    if (!videoModelId) {
      useAppStore.getState().addToast('No video model configured.', 'error')
      return
    }
    const model = getModel(videoModelId)
    if (!model) {
      useAppStore.getState().addToast(`Unknown video model: ${videoModelId}`, 'error')
      return
    }

    let effectiveMode = mode
    if (!model.modes?.includes(effectiveMode)) {
      // The model can't honour the requested mode. We deliberately do NOT
      // promote the reference image into a first-frame seed (that hijack
      // produced distorted clips) and we don't silently swap models. When the
      // chosen model can't take refs as refs, drop them and run text-to-video
      // — the picker greys these models out and the Reference Images note
      // tells the user this will be text-to-video only.
      // model.modes is the broader Mode union (also includes image modes);
      // narrow to VideoMode before consuming.
      const VIDEO_MODES: VideoMode[] = ['text-to-video', 'image-to-video', 'frames-to-video', 'reference-to-video']
      const videoModes = (model.modes ?? []).filter((m): m is VideoMode =>
        (VIDEO_MODES as string[]).includes(m),
      )
      const fallback: VideoMode | undefined = videoModes.includes('text-to-video')
        ? 'text-to-video'
        : videoModes[0]
      if (!fallback) {
        useAppStore.getState().addToast('Video model has no supported modes.', 'error')
        return
      }
      if (effectiveMode === 'reference-to-video' && referenceDataUris?.length) {
        useAppStore.getState().addToast(
          `${model.displayName} doesn't support reference images. Generating text-to-video only.`,
          'error',
        )
      }
      if (effectiveMode === 'image-to-video' && firstFrameDataUri) {
        // Animate on a model with no image-to-video mode. Without this the
        // still is dropped and the clip renders from the prompt alone — a
        // text-to-video that silently ignores the frame the user picked to
        // animate.
        //
        // No model named in the copy: this used to send members to "Seedance
        // 2.0 or Gemini Omni", and Gemini Omni is one of the models that CAN'T
        // take a start frame (it has no image-to-video mode — it's how a still
        // reaches it as a reference instead). The picker greys the ones that
        // can't, which is a list that stays true as models come and go.
        useAppStore.getState().addToast(
          `${model.displayName} can't animate a still. Open the model picker. The ones that can't take a still are greyed out.`,
          'error',
        )
        return
      }
      referenceDataUris = undefined
      firstFrameDataUri = undefined
      effectiveMode = fallback
    }

    const inFlightId = crypto.randomUUID()
    const isAnimating = motionPrompt !== undefined
    const promptText = motionPrompt ?? cardState.editablePrompt
    const videoAspectRatio = cardState.cardVideoAspectRatio
    // A talking card's clip has to hold its spoken line: unless the run pins one
    // length for everything, the length is derived per card (the line's own
    // estimate while it's Auto, the member's pick otherwise) and snapped onto
    // THIS model's ladder — the card may have been seeded against a different
    // one. A silent card has no words to fit and keeps the flat default.
    const videoDurationSeconds = batchSettings?.durationSeconds
      ?? cardClipSeconds(cardState, scriptLine, videoModelId, { spoken: isDialogue })
    const videoResolution = batchSettings?.resolution ?? cardState.cardVideoResolution
    const videoAudio = cardState.cardVideoAudio
    const sourceBRollId = cardState.videoSourceBRollId

    onUpdateStateFn((prev) => ({
      inFlightVideos: [
        ...prev.inFlightVideos,
        {
          id: inFlightId,
          taskId: null,
          modelId: videoModelId,
          startedAt: Date.now(),
          prompt: promptText,
          mode: effectiveMode,
          aspectRatio: videoAspectRatio,
          durationSeconds: videoDurationSeconds,
          resolution: videoResolution,
          audio: videoAudio,
          sourceBRollId,
          startFrameRef,
        },
      ],
    }))

    let claimedTaskId: string | null = null
    try {
      // Same fire-time restyle as image gen — STYLE block + realism-stack toggle
      // for a stylized pick; the persisted prompt/history stay unstyled.
      const { prompt: styledPrompt, noRealism } = applyStyleToPrompt(promptText, {
        style: resultStyle,
        realism: resultRealism,
      })
      // A DIALOGUE card gets the shared voice profile appended at fire time so
      // every talking clip is read by the same voice. Like the STYLE block, it
      // rides outside the persisted prompt (promptText stays clean).
      const withVoice = variation.tag === 'DIALOGUE' && voiceProfile?.trim()
        ? `${styledPrompt}\n\n=== VOICE PROFILE (same voice in every dialogue clip) ===\n${voiceProfile.trim()}`
        : styledPrompt
      // Animating a still holds the frame it opens on — appended here rather
      // than written into the motion, so the box stays about what MOVES and the
      // persisted prompt (promptText) stays clean. See realism.ts.
      const finalPrompt = isAnimating ? withLockedCamera(withVoice) : withVoice
      const { taskId, videoEndpoint } = await startVideoTask({
        prompt: finalPrompt,
        mode: effectiveMode,
        firstFrameDataUri,
        referenceDataUris,
        aspectRatio: videoAspectRatio,
        durationSeconds: videoDurationSeconds,
        resolution: videoResolution,
        audio: videoAudio,
        modelId: videoModelId,
        noRealism,
      })
      onUpdateStateFn((prev) => ({
        inFlightVideos: prev.inFlightVideos.map((e) =>
          e.id === inFlightId ? { ...e, taskId, endpoint: videoEndpoint } : e,
        ),
      }))

      // Own this poll before the taskId is persisted — see taskRegistry.
      if (!claimTask('video', taskId)) return
      claimedTaskId = taskId

      const res = await finishVideoTask(
        taskId,
        videoModelId,
        videoEndpoint,
        videoDurationSeconds,
        videoAspectRatio,
      )

      const assetRef = `asset://${res.assetId}`
      const newVideo = {
        url: assetRef,
        modelId: videoModelId,
        prompt: promptText,
        aspectRatio: res.aspectRatio,
        durationSeconds: res.durationSeconds,
        resolution: videoResolution,
        audio: videoAudio,
        mode: effectiveMode,
        sourceBRollId,
        createdAt: Date.now(),
      }
      onUpdateStateFn((prev) => {
        const newVideos = [...prev.videos, newVideo]
        return {
          videos: newVideos,
          currentVideoIndex: newVideos.length - 1,
          selected: { kind: 'video', index: newVideos.length - 1 },
          inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== inFlightId),
        }
      })

      const historyEntry: VideoHistoryItem = {
        id: crypto.randomUUID(),
        modelId: videoModelId,
        prompt: promptText,
        mode: effectiveMode,
        aspectRatio: res.aspectRatio,
        durationSeconds: res.durationSeconds,
        resolution: videoResolution,
        audio: videoAudio,
        videoUrl: assetRef,
        sourceBRollId,
        sourceApp: 'broll-studio',
        createdAt: Date.now(),
      }
      await useBankStore.getState().addVideoHistory(historyEntry)
      useAppStore.getState().addToast('B-Roll video ready', 'success')
    } catch (err) {
      if (isPollTimeout(err)) {
        // The poll budget ran out but kie may still be rendering (Seedance 2 /
        // Veo Quality routinely exceed it). Leave the entry in-flight and
        // persisted — the resume effect picks it up on the next refresh, and
        // the staleness filter evicts it only once it's genuinely too old.
        // Marking it "Failed" here would hand the user a Retry that
        // double-charges credits for a clip that's still on its way.
        return
      }
      // The entry only keeps the friendly copy, so without this the raw
      // message — the one that says WHICH failure this was (a stalled CDN
      // download, a blob the browser wouldn't decode, a dead connection) — is
      // gone, and every one of those reads the same on the tile.
      console.error('[broll] video generation failed', err)
      const msg = humanizeError(err, 'Video generation failed.')
      onUpdateStateFn((prev) => ({
        inFlightVideos: prev.inFlightVideos.map((e) =>
          e.id === inFlightId ? { ...e, error: msg } : e,
        ),
      }))
      useAppStore.getState().addToast(msg, 'error')
    } finally {
      if (claimedTaskId) releaseTask('video', claimedTaskId)
    }
  }

  // What every Animate fires: the card's MOTION prompt, falling back to the
  // still prompt when it has none. A card only has none when the storyboard that
  // wrote it predates the field (a session from before this shipped, or an
  // import written against the old envelope) — and firing nothing there would
  // take Animate away from those sessions entirely, where the old behaviour at
  // least produced a clip.
  const animatePrompt = cardState.animateMotion.trim() || cardState.editablePrompt

  // Animate a still into a video (image-to-video) from inside the modal's
  // Animate tab. The start frame is one of this card's generated images,
  // converted to a data URI the model can seed from.
  const handleAnimate = async (
    startFrameRef: string | undefined,
    videoModelId: string | undefined,
    batchSettings?: { resolution: string; durationSeconds?: number },
  ) => {
    if (!startFrameRef) {
      useAppStore.getState().addToast('Generate or pick an image to animate first.', 'error')
      return
    }
    const dataUri = await toDataUri(startFrameRef)
    if (!dataUri) {
      useAppStore.getState().addToast('Could not load the start frame.', 'error')
      return
    }
    // Use the image however the picked model can: as a true start frame when it
    // supports image-to-video, otherwise as a reference image for a
    // reference-to-video model. Either way the chosen still drives the clip.
    const modes = (videoModelId ? getModel(videoModelId)?.modes : undefined) ?? []
    if (modes.includes('image-to-video')) {
      await runVideoTask('image-to-video', dataUri, undefined, videoModelId, startFrameRef, batchSettings, animatePrompt)
    } else if (modes.includes('reference-to-video')) {
      await runVideoTask('reference-to-video', undefined, [dataUri], videoModelId, startFrameRef, batchSettings, animatePrompt)
    } else {
      useAppStore.getState().addToast("This model can't animate a still. Pick one that takes a start frame or reference images.", 'error')
    }
  }

  const handleGenerateVideo = async (
    videoModelId: string | undefined,
    batchSettings?: { resolution: string; durationSeconds?: number },
  ) => {
    const refs = buildCardRefs(videoModelId)
    const referenceDataUris: string[] = []
    for (const r of refs) {
      const uri = await toDataUri(r.dataUrl)
      if (uri) referenceDataUris.push(uri)
    }
    await runVideoTask(
      referenceDataUris.length > 0 ? 'reference-to-video' : 'text-to-video',
      undefined,
      referenceDataUris.length > 0 ? referenceDataUris : undefined,
      videoModelId,
      undefined,
      batchSettings,
    )
  }

  // Batch trigger. Same shape as the image one above: the parent bumps
  // `generateVideoToken` and the card fires exactly one clip. A card that has a
  // still animates it — that's what "Generate all videos" means after a
  // Generate-all-images pass — and a card with no image yet renders from its
  // prompt instead, so a text-to-video-only session isn't left out.
  const lastVideoTokenRef = useRef(generateVideoToken ?? 0)
  useEffect(() => {
    const tok = generateVideoToken ?? 0
    if (tok === lastVideoTokenRef.current) return
    lastVideoTokenRef.current = tok
    // A card with a still animates and a card without renders from its prompt,
    // so the gate is whichever of the two this card is about to send.
    const startFrame = coverKind === 'image' ? coverImage?.imageUrl : undefined
    if (!(startFrame ? animatePrompt : cardState.editablePrompt).trim()) return
    const batchSettings = batchVideoOverride
      ? { resolution: batchVideoOverride.resolution, durationSeconds: batchVideoOverride.durationSeconds }
      : undefined
    const modelId = batchVideoOverride?.modelId
    if (startFrame) void handleAnimate(startFrame, modelId, batchSettings)
    else void handleGenerateVideo(modelId, batchSettings)
    // Intentionally only react to the token; everything else is read fresh from
    // this render's closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generateVideoToken])

  // Re-enter the FINISH half of a generation we still hold a kie taskId for:
  // poll (a finished task answers on the first read) and download again. No new
  // submission, so no second charge — which is the whole point. The failure this
  // exists for is the download stalling on a clip kie has already rendered and
  // billed: the biggest files in the app (Seedance 2.5 at 720p with audio) were
  // timing out on the CDN hop and the only button on offer re-ran the whole
  // generation at full price. kie's result URLs live 3 days, so a resume is
  // free and usually instant.
  const resumeInFlightVideo = async (entry: CardState['inFlightVideos'][number]) => {
    const taskId = entry.taskId
    if (!taskId) return
    onUpdateStateFn((prev) => ({
      inFlightVideos: prev.inFlightVideos.map((e) => (e.id === entry.id ? { ...e, error: null } : e)),
    }))
    // Whoever already owns this poll is doing the same work — don't double it.
    if (!claimTask('video', taskId)) return
    try {
      const res = await finishVideoTask(taskId, entry.modelId, entry.endpoint, entry.durationSeconds, entry.aspectRatio)
      const assetRef = `asset://${res.assetId}`
      const newVideo = {
        url: assetRef,
        modelId: entry.modelId,
        prompt: entry.prompt,
        aspectRatio: res.aspectRatio,
        durationSeconds: res.durationSeconds,
        resolution: entry.resolution,
        audio: entry.audio,
        mode: entry.mode,
        sourceBRollId: entry.sourceBRollId,
        createdAt: Date.now(),
      }
      onUpdateStateFn((prev) => {
        const newVideos = [...prev.videos, newVideo]
        return {
          videos: newVideos,
          currentVideoIndex: newVideos.length - 1,
          selected: { kind: 'video' as const, index: newVideos.length - 1 },
          inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== entry.id),
        }
      })
      const historyEntry: VideoHistoryItem = {
        id: crypto.randomUUID(),
        modelId: entry.modelId,
        prompt: entry.prompt,
        mode: entry.mode,
        aspectRatio: res.aspectRatio,
        durationSeconds: res.durationSeconds,
        resolution: entry.resolution,
        audio: entry.audio,
        videoUrl: assetRef,
        sourceBRollId: entry.sourceBRollId,
        sourceApp: 'broll-studio',
        createdAt: Date.now(),
      }
      await useBankStore.getState().addVideoHistory(historyEntry)
      useAppStore.getState().addToast('B-Roll video ready', 'success')
    } catch (err) {
      // Same rule as the generate path: a poll timeout means it's STILL
      // rendering, so leave the entry in flight rather than offering a retry.
      if (isPollTimeout(err)) return
      console.error('[broll] video resume failed', err)
      const msg = humanizeError(err, 'Video generation failed.')
      onUpdateStateFn((prev) => ({
        inFlightVideos: prev.inFlightVideos.map((e) => (e.id === entry.id ? { ...e, error: msg } : e)),
      }))
      useAppStore.getState().addToast(msg, 'error')
    } finally {
      releaseTask('video', taskId)
    }
  }

  // The image half of the same idea.
  const resumeInFlightImage = async (entry: CardState['inFlightImages'][number]) => {
    const taskId = entry.taskId
    const modelId = entry.modelId
    if (!taskId || !modelId) return
    onUpdateStateFn((prev) => ({
      inFlightImages: prev.inFlightImages.map((e) => (e.id === entry.id ? { ...e, error: null } : e)),
    }))
    if (!claimTask('image', taskId)) return
    try {
      const imageUrl = await finishImageTask(taskId, modelId, entry.resolution || undefined)
      const newImage = { imageUrl, prompt: entry.prompt, modelId, createdAt: Date.now() }
      onUpdateStateFn((prev) => {
        const newImages = [...prev.images, newImage]
        return {
          images: newImages,
          currentImageIndex: newImages.length - 1,
          selected: { kind: 'image' as const, index: newImages.length - 1 },
          inFlightImages: prev.inFlightImages.filter((e) => e.id !== entry.id),
        }
      })
    } catch (err) {
      if (isPollTimeout(err)) return
      const msg = humanizeError(err, 'Image generation failed. Try again.')
      onUpdateStateFn((prev) => ({
        inFlightImages: prev.inFlightImages.map((e) => (e.id === entry.id ? { ...e, error: msg } : e)),
      }))
      useAppStore.getState().addToast(msg, 'error')
    } finally {
      releaseTask('image', taskId)
    }
  }

  // Retry a failed in-flight gen. A generation that got as far as a kie taskId
  // is already paid for, so it RESUMES (above) instead of firing a second one.
  // Only a gen that never reached kie — no taskId — is re-fired: a clip that
  // animated a still retries as that animation, since routing it through
  // handleGenerateVideo instead silently rebuilt it as a reference-/text-to-video
  // from the current toggles, so the user paid again for a different clip than
  // the one that failed. (The prompt is read live, so a retry after editing the
  // prompt still picks up the edit.)
  const handleRetryInFlight = (id: string, isVideo: boolean) => {
    if (isVideo) {
      const failed = cardState.inFlightVideos.find((e) => e.id === id)
      if (!failed) return
      if (failed.taskId) { void resumeInFlightVideo(failed); return }
      onUpdateStateFn((prev) => ({ inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== id) }))
      if (failed.startFrameRef) {
        void handleAnimate(failed.startFrameRef, failed.modelId)
      } else {
        void handleGenerateVideo(failed.modelId)
      }
    } else {
      const failed = cardState.inFlightImages.find((e) => e.id === id)
      if (!failed) return
      if (failed.taskId && failed.modelId) { void resumeInFlightImage(failed); return }
      onUpdateStateFn((prev) => ({ inFlightImages: prev.inFlightImages.filter((e) => e.id !== id) }))
      void runImageGen(failed.prompt, failed.aspectRatio, failed.resolution as ImageResolution, buildCardRefs())
    }
  }

  const handleDismissInFlight = (id: string, isVideo: boolean) => {
    if (isVideo) {
      onUpdateStateFn((prev) => ({ inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== id) }))
    } else {
      onUpdateStateFn((prev) => ({ inFlightImages: prev.inFlightImages.filter((e) => e.id !== id) }))
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Face
  // ────────────────────────────────────────────────────────────────────────

  const isManual = variation.id.startsWith('manual-') || variation.label === 'Manual Option'
  // "Has any video at all" — drives the small video count badge on cards
  // whose cover is the image.
  const showVideoBadge =
    hasVideos &&
    coverKind === 'image' &&
    !hasFailedInFlight &&
    !cardState.isGeneratingImage &&
    !isGeneratingImageInFlight &&
    !isGeneratingVideo
  // Hoisted out of the JSX because the hover shortcut row also needs it — the
  // error banner owns the bottom strip, so the row has to sit above it.
  const showImageError = !!cardState.imageError && !hasImages && !cardState.isGeneratingImage
  // True while the mute button is out beside play. The pair reaches 76px into
  // the top strip, but the centred chip's inset shrinks with the card (~59px at
  // a 194px face), so on a narrow card they'd collide. Hover already clears the
  // chip; this covers the case hover doesn't — a card played WITH SOUND keeps
  // playing after the mouse leaves, so its mute button outlives the hover.
  const videoControlsExpanded = coverKind === 'video' && (cardVideoPlaying || cardVideoUnmuted)
  const tagText = tagLabel(variation.tag)
  const rollText = rollTypeForTag(variation.tag)
  // Which model drew what the face is showing. `ModelPill` gates itself on the
  // member's generation-info switch, but the caption's separator dot has to
  // know whether the pill will render at all — a lone "·" after A-Roll is
  // worse than no dot.
  const coverModelId = coverKind === 'video' ? coverVideo?.modelId : coverImage?.modelId
  const showCoverModel = showGenerationInfo && !!coverModelId

  return (
    <>
      <div className="group flex flex-col gap-1.5">
        <div
          onClick={() => openDetail('image')}
          {...cardVideo.hoverProps}
          className="relative aspect-[9/16] cursor-pointer overflow-hidden rounded-xl border border-ink/[0.08] bg-ink/[0.02] transition-all hover:border-ink/15 hover:-translate-y-px card-soft-shadow"
        >
          {cardState.isGeneratingImage || isGeneratingImageInFlight ? (
            <GeneratingMediaFill
              kind="image"
              modelId={activeInFlightImages[0]?.modelId ?? imageModelId}
              prompt={cardState.editablePrompt}
            />
          ) : isGeneratingVideo ? (
            <GeneratingMediaFill
              kind="video"
              modelId={activeInFlightVideos[0]?.modelId}
              prompt={cardState.editablePrompt}
              messages={isAnimating ? ANIMATE_MESSAGES : undefined}
            />
          ) : coverKind === 'video' && resolvedVideoUrl ? (
            <>
              {/* Hover (on the frame, not the element — the buttons sit on top
                  of it) autoplays muted; the play button takes over with sound
                  and isn't reset when the mouse leaves. */}
              <video
                {...cardVideo.videoProps}
                {...posterVideoProps(resolvedVideoUrl, coverPoster)}
                className="absolute inset-0 h-full w-full object-cover"
              />
              {posterPending(coverPoster) && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <Spinner className="h-5 w-5 text-white/50" />
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />
              {/* Always-visible play/pause — top-left, the corner the type chip
                  vacated when it moved to centre. On click, plays with audio in
                  place (stopPropagation keeps the detail modal from opening). */}
              <button
                type="button"
                title={cardVideo.watching ? 'Pause' : 'Play with sound'}
                onClick={cardVideo.togglePlay}
                className="absolute left-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
              >
                {cardVideo.watching ? <Pause className="h-3.5 w-3.5 fill-white" /> : <Play className="h-3.5 w-3.5 fill-white" />}
              </button>
              {(cardVideoPlaying || cardVideoUnmuted) && (
                <button
                  type="button"
                  title={cardVideoUnmuted ? 'Mute' : 'Unmute'}
                  onClick={cardVideo.toggleMute}
                  className="absolute left-11 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
                >
                  {cardVideoUnmuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                </button>
              )}
            </>
          ) : coverKind === 'image' && coverImage ? (
            <>
              <img
                src={resolvedImageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />
            </>
          ) : cardState.editablePrompt.trim() ? (
            // No image/video yet — show the prompt itself so every scene's
            // direction is glanceable without opening the card. Mirrors the
            // Script Bank card: text fills the face and fades out at the
            // bottom. The mask fades the text to transparent regardless of the
            // translucent card background behind it. The top padding clears
            // the type chip, and the two numbers are a PAIR — the chip sat a
            // row lower on touch for a while and this padding had to follow it
            // down; both are back on the top row now (see its note below), so
            // change one and check the other.
            <>
              <div className="flex h-full w-full flex-col px-3 pb-3 pt-9">
                <p
                  className="flex-1 overflow-hidden whitespace-pre-wrap text-[11px] leading-relaxed tracking-tight text-ink-400"
                  style={{
                    maskImage: 'linear-gradient(to bottom, #000 72%, transparent)',
                    WebkitMaskImage: 'linear-gradient(to bottom, #000 72%, transparent)',
                  }}
                >
                  {cardState.editablePrompt}
                </p>
              </div>
              {/* Nudge for the not-yet-generated card: the prompt is scripted
                  but no image/video exists — spell out that the card opens for
                  setup, sitting in the faded bottom-left so it clears the text.
                  Fades on hover: the full-width shortcut row lands on this exact
                  strip and IS the answer to "set up", so the two never share it. */}
              <p className="pointer-events-none absolute bottom-2 left-3 z-10 text-[10px] font-medium tracking-tight text-ink-500 transition-opacity group-hover:opacity-0">
                Click to set up
              </p>
            </>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
              <ImageIcon className="h-7 w-7 text-ink-700" strokeWidth={1.5} />
              <p className="text-[11px] text-ink-500">Click to set up</p>
            </div>
          )}

          {/* Top-centre chip — the scene type (Dialogue / Action / …) for
              generated variations, or a neutral "Custom" tag for a manually
              added option. Centred so the top-left corner belongs to a video
              cover's play/mute controls; fades on hover because the top-right
              action stack and (when playing) the mute button both reach into
              its lane on a narrow card.

              It stays on the TOP row on a touch screen too. It dropped to
              `touch:top-11` for a three-across phone storyboard, where the play
              button, this chip and the permanent action doorway were three
              things sharing one 103px strip — but the phone grid is two across
              (`grid-cols-2`), which leaves the chip a clear lane between the
              two corner buttons. A row down it read as floating in the middle
              of the still instead of labelling it. The prompt face's `pt-9`
              is the pair to this and moved back with it. */}
          {isManual ? (
            // No `light:` override here: the ink ramp already mirrors per theme,
            // so ink-300 is the readable tint in both. Adding light:text-ink-700
            // double-flipped it to near-white on the pale pill and the word
            // vanished in light mode.
            <span className={`pointer-events-none absolute left-1/2 top-2 z-10 max-w-[60%] -translate-x-1/2 truncate rounded-full border border-ink/15 bg-ink/10 px-2 py-0.5 text-[10px] font-medium tracking-tight text-ink-300 transition-opacity ${videoControlsExpanded ? 'opacity-0' : ''}`}>
              Custom
            </span>
          ) : (
            <span
              className={`pointer-events-none absolute left-1/2 top-2 z-10 max-w-[60%] -translate-x-1/2 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-tight transition-opacity ${videoControlsExpanded ? 'opacity-0' : ''} ${tagChipStyle(variation.tag)}`}
            >
              {tagText}
            </span>
          )}

          {/* Top-right status badges — small "Video N" indicator when the
              cover is the image but the card also has video gens. */}
          {/* Top-right status badges fade out on hover so the action stack
              (same corner) reads cleanly. */}
          {showVideoBadge && (
            <span className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-full border border-purple-400/30 bg-purple-500/30 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-purple-100 transition-opacity group-hover:opacity-0">
              <Play className="h-2.5 w-2.5 fill-current" />
              {cardState.videos.length > 1 ? `${cardState.videos.length} videos` : 'Video'}
            </span>
          )}
          {hasFailedInFlight && !isGeneratingVideo && !isGeneratingImageInFlight && !cardState.isGeneratingImage && (
            <span className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-full border border-red-400/40 bg-red-500/30 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-red-100 transition-opacity group-hover:opacity-0">
              <AlertCircle className="h-2.5 w-2.5" />
              Failed
            </span>
          )}
          {cardState.videoStatus === 'error' && (
            <span className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-full border border-red-400/40 bg-red-500/30 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-red-100 transition-opacity group-hover:opacity-0">
              <AlertCircle className="h-2.5 w-2.5" />
              Video error
            </span>
          )}

          {/* Hover-reveal action stack (components/tileActions) — app-wide
              standard order: download · save (stills only) · copy · expand
              (videos only) · delete. The card body stays clickable
              to open the detail modal. It does NOT step aside while the clip
              plays with sound: watching a take is exactly when you decide to
              keep it, and having Download / Save / Copy vanish under the
              pointer meant pausing first to reach them. It's top-right, clear
              of the play/mute buttons on the left, and still hover-only. */}
          <TileActionStack forceVisible={confirmingDelete}>
            {coverKind && (
              <>
                <TileActionButton
                  title={coverKind === 'image' ? 'Download image' : 'Download video'}
                  onClick={() => { void handleDownloadCover() }}
                >
                  <Download className="h-4 w-4" />
                </TileActionButton>
                {/* Save-to-bank is stills-only — videos are download-only. */}
                {coverKind === 'image' && (
                  <TileActionButton
                    title={savedCover ? 'Saved to B-Rolls bank' : savingCover ? 'Saving…' : 'Save to B-Rolls bank'}
                    tone={savedCover ? 'saved' : 'default'}
                    onClick={() => { void handleSaveCover() }}
                  >
                    {savedCover ? <Check className="h-4 w-4" /> : savingCover ? <Spinner className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                  </TileActionButton>
                )}
                <TileActionButton
                  title={copiedPrompt ? 'Prompt copied' : 'Copy prompt'}
                  onClick={() => { void handleCopyPrompt() }}
                >
                  {copiedPrompt ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                </TileActionButton>
                {coverKind === 'video' && resolvedVideoUrl && (
                  <ExpandVideoButton
                    videoUrl={resolvedVideoUrl}
                    prompt={coverVideo?.prompt ?? cardState.editablePrompt}
                    fileStem={`broll-scene-${sceneNumber}`}
                    aspectRatio={coverVideo?.aspectRatio}
                  />
                )}
              </>
            )}
            <TileDeleteButton title="Delete variation" onDelete={onDelete} onArmedChange={setConfirmingDelete} />
          </TileActionStack>

          {showImageError && (
            <div className="absolute inset-x-2 bottom-2 flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/15 px-2 py-1.5 backdrop-blur">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-300 light:text-red-700" />
              <p className="line-clamp-2 text-[10px] leading-relaxed text-red-200 light:text-red-800">{cardState.imageError}</p>
            </div>
          )}

          {/* Hover shortcuts into the card's workspace — one per tab, in the
              modal's own tab order (Image, Video, Animate), so a tap lands on
              the control it names. Clicking the card face itself opens Image.
              Full-bleed row split three ways, with the modal's own tab icons and
              labels so each button reads as the control it lands on.
              The row spans the whole width, so it can't sit beside anything
              else on the bottom strip — it raises above the image-error banner
              rather than covering it, since hover is exactly when that needs to
              stay readable. Video play/mute used to force the same dodge; they
              live top-left now, so a video cover keeps the row at its usual
              height. Stays put while the clip plays with sound, for the same
              reason as the action stack above — deciding what to do with a take
              is what you're doing while you watch it.
              Solid `bg-black/60` scrim, NO backdrop-blur — the same rule
              `TileActionStack` follows, and it bites hardest right here. This
              row fades its opacity in on hover, and a backdrop-filter animated
              under an opacity transition re-samples the backdrop every frame:
              on a card holding a real generated still that's three blurred
              regions over a photo, and the hover visibly stuttered. An empty
              card never showed it, because a flat card face is nothing to blur.
              Every chip on this face that fades (the tag, the status badges)
              dropped its blur for the same reason. */}
          <div
            className={`absolute inset-x-2 z-10 flex h-9 items-stretch overflow-hidden rounded-full border border-white/25 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 ${
              showImageError ? 'bottom-14' : 'bottom-2'
            }`}
          >
            {/* ONE pill, three segments, split by DASHED hairlines (Massimo's
                call, September 2026). Three separate pills each carried their
                own rim and their own 6px of gap, which on a 110px card is more
                chrome than label — this is the same row with one rim around
                the lot and the gaps spent on the words instead. The dashed
                divider is what keeps it reading as three targets rather than
                as one long button: a solid rule would read as a seam between
                two controls, a dash reads as a perforation in one.

                Each segment lights on ITS OWN hover, so the side you are over
                is the side that will open — the control answers "which tab am I
                about to land on?" before the click, which is the whole reason
                the three labels are here rather than one "Open" button.

                That hover is the HOUSE MENU ROW's, not an accent fill: a dim
                label going bright over a faint wash, the same move `MenuItem`
                makes (Massimo's call, September 2026 — it was a solid
                `bg-broll-500`, which lit a third of the pill up like a picked
                state rather than a pointed-at one, and put a saturated block on
                top of the still the row is sitting on). The tokens are literal
                white here because this is over generated media, which is the
                documented exception to the semantic-token rule — `bg-white/15`
                is `bg-ink/[0.06]`'s job done in a place ink can't go. */}
            {DETAIL_SHORTCUTS.map(({ tab, label, icon: Icon }, i) => (
              <button
                key={tab}
                type="button"
                title={`Open this card on the ${label} tab`}
                onClick={(e) => { e.stopPropagation(); openDetail(tab) }}
                className={`flex flex-1 items-center justify-center gap-1 self-stretch text-[11px] font-semibold text-white/85 transition-colors hover:bg-white/15 hover:text-white ${
                  i > 0 ? 'border-l border-dashed border-white/30' : ''
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Bottom caption — roll type, then which model drew the cover.
            Centred + small so it reads as a quiet label.
            The model used to sit ON the picture as a `media` pill, bottom-left
            over the scrim: a white-on-black chip is the loudest thing on a
            still whose whole job is to be judged, and it had to fade on hover
            anyway because the three-way shortcut row lands on that exact strip.
            Down here it's the `quiet` variant — bare dim text, no pill — beside
            the label it belongs with, and nothing covers the shot. */}
        {(!isManual || showCoverModel) && (
          <div className="flex min-w-0 items-center justify-center gap-1.5 px-1">
            {!isManual && (
              <span className="shrink-0 text-[10px] font-medium tracking-wider text-ink-500">{rollText}</span>
            )}
            {!isManual && showCoverModel && <span aria-hidden className="text-[10px] leading-none text-ink-700">·</span>}
            <ModelPill variant="quiet" modelId={coverModelId} className="min-w-0" />
          </div>
        )}
      </div>

      {detailOpen && (
        <CardDetailModal
          sceneNumber={sceneNumber}
          scriptLine={scriptLine}
          variation={variation}
          cardState={cardState}
          onUpdateState={onUpdateState}
          onClose={() => setDetailOpen(false)}
          initialTab={detailTab}
          resultStyle={resultStyle}
          resultRealism={resultRealism}
          characterRef={characterRef}
          productRef={productRef}
          productPhotos={productPhotos}
          onChangeStyle={onChangeStyle}
          selectedProduct={selectedProduct}
          selectedModel={selectedModel}
          selectedProductId={selectedProductId}
          selectedModelId={selectedModelId}
          selectedScriptId={selectedScriptId}
          onOpenCharacterPicker={onOpenCharacterPicker}
          onOpenProductPicker={onOpenProductPicker}
          extraRefs={extraRefs}
          onAddExtraRef={(r) => setExtraRefs((prev) => (prev.length >= 4 ? prev : [...prev, r]))}
          onRemoveExtraRef={(i) => setExtraRefs((prev) => prev.filter((_, idx) => idx !== i))}
          handleUndo={handleUndo}
          handleRedo={handleRedo}
          handleCommitDraft={handleCommitDraft}
          handleEnhance={handleEnhance}
          handleRegeneratePrompt={handleRegeneratePrompt}
          handleGenerateImage={handleGenerateImage}
          handleGenerateVideo={handleGenerateVideo}
          handleAnimate={handleAnimate}
          handleRetryInFlight={handleRetryInFlight}
          handleDismissInFlight={handleDismissInFlight}
          voiceProfile={voiceProfile}
          onUpdateVoiceProfile={onUpdateVoiceProfile}
          chainImageRef={isDialogue ? chainImageRef : undefined}
        />
      )}
    </>
  )
}
