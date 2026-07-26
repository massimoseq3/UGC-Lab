import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  ImageIcon,
  Video as VideoIcon,
  Film,
  RefreshCw,
  Loader2,
  AlertCircle,
  Sparkles,
  Undo2,
  Redo2,
  Volume2,
  VolumeX,
  User,
  Package,
  Coins,
  ChevronRight,
  Star,
  Link2,
} from 'lucide-react'
import ModelPicker from '../../../components/ModelPicker'
import ModelSidePanel from '../../../components/ModelSidePanel'
import ProviderLogo from '../../../components/ProviderLogo'
import SavingsPill from '../../../components/SavingsPill'
import AspectIcon from '../../../components/AspectIcon'
import ConstraintChip from '../../../components/ConstraintChip'
import SegmentedToggle from '../../../components/SegmentedToggle'
import type { PromptVariation, CardState, ReferenceImage } from '../types'
import type { BRoll, Product, Model } from '../../../stores/types'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useBankStore } from '../../../stores/bankStore'
import { useAppStore } from '../../../stores/appStore'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import { getDefaultModel, getModel, estimateCredits, formatCredits, videoResolutionLabel, snapVideoDuration, officialSavingsPercent, type ImageResolution } from '../../../utils/models'
import { tagChipStyle, tagLabel } from './variationTags'
import { humanizeError } from '../../../utils/friendlyError'
import { resolveImageModelId } from '../services/generateBroll'
import { productAngleSlots, normalizePhotoSelection } from '../services/productAngles'
import ModelWaitNotice from '../../../components/ModelWaitNotice'
import ExpandTextModal, { ExpandButton } from '../../../components/ExpandableText'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import {
  ModalGallery,
  ReferenceSlotCard,
  ExtraRefsRow,
  ProductPhotoRow,
  StyleNote,
} from './cardDetailParts'
import { appliedStyleNote } from '../services/generateContinuous'

// After deleting tile #removed, shift the saved/saving index sets so they
// still point at the right tiles (indices above the removed one slide down).
function rekeyAfterDelete(set: Set<number>, removed: number): Set<number> {
  const next = new Set<number>()
  for (const i of set) {
    if (i === removed) continue
    next.add(i > removed ? i - 1 : i)
  }
  return next
}

export type Tab = 'video' | 'image' | 'animate'

interface CardDetailModalProps {
  sceneNumber: number
  scriptLine: string
  variation: PromptVariation
  cardState: CardState
  onUpdateState: (updates: Partial<CardState>) => void
  onClose: () => void
  // Which tab to land on. The card face's hover shortcuts pass this so one click
  // gets to Image or Video, instead of opening here and toggling. The modal is
  // conditionally mounted, so this seeds fresh on every open.
  initialTab?: Tab
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
  productPhotos?: string[]
  onChangeStyle?: () => void
  // Full bank entries — rendered as side-by-side slot cards in the modal.
  selectedProduct?: Product | null
  selectedModel?: Model | null
  selectedProductId?: string
  selectedModelId?: string
  selectedScriptId?: string
  // Open the script-level BankPicker (slide-in) when the user clicks a slot.
  onOpenCharacterPicker?: () => void
  onOpenProductPicker?: () => void
  // Additional user-attached reference images (beyond the bank-keyed Influencer
  // / Product pills). Memory-only — owned by VariationCard, fed into gen refs.
  extraRefs?: ReferenceImage[]
  onAddExtraRef?: (ref: ReferenceImage) => void
  onRemoveExtraRef?: (index: number) => void
  handleUndo: () => void
  handleRedo: () => void
  handleCommitDraft: (draft: string) => void
  handleEnhance: () => void
  handleRegeneratePrompt: () => void
  handleGenerateImage: () => void
  // Animate a still (image-to-video). startFrameRef is one of the card's images.
  handleAnimate: (startFrameRef: string | undefined, videoModelId: string | undefined) => void
  handleGenerateVideo: (videoModelId: string | undefined) => void
  // Re-fire / drop a failed in-flight gen surfaced in the gallery.
  handleRetryInFlight: (id: string, isVideo: boolean) => void
  handleDismissInFlight: (id: string, isVideo: boolean) => void
  // Shared voice profile for the ad's dialogue clips (Video/Animate tab, DIALOGUE
  // cards only). Editing it updates the value shared by every dialogue clip.
  voiceProfile?: string
  onUpdateVoiceProfile?: (text: string) => void
  // DIALOGUE cards only: the previous scene's chosen talking-head still. Renders
  // a "Previous cut" reference slot whose toggle is cardState.chainLink.
  chainImageRef?: string
  // The session's visual style, as stamped on the result. Shown read-only at the
  // top of the workspace (StyleNote) because it's appended at fire time, outside
  // the editable prompt below — the same note Continuous' modals carry.
  resultStyle?: string
  resultRealism?: boolean
}

// Playground-faithful per-variation workspace.
// Tab order: Video first, Image second (matches the Playground reflexively
// landing on video gens). Sections in the LEFT column run top-down:
//   1. Model picker + constraint chips
//   2. Reference Images (Character / Product toggle pills, orange)
//   3. Prompt (always editable textarea + Enhance / Undo / Redo / Regenerate)
//   4. Orange Generate pill — non-blocking, allows parallel queueing
// RIGHT column is the per-card masonry gallery (same as Playground's history
// grid). The modal is fixed-height (92vh) so model dropdowns never clip
// when the gallery is empty.
export default function CardDetailModal(props: CardDetailModalProps) {
  const {
    sceneNumber,
    scriptLine,
    variation,
    cardState,
    onUpdateState,
    onClose,
    initialTab,
    selectedProduct,
    selectedModel,
    selectedProductId,
    selectedModelId,
    selectedScriptId,
    characterRef,
    productRef,
    productPhotos,
    onChangeStyle,
    onOpenCharacterPicker,
    onOpenProductPicker,
    extraRefs = [],
    onAddExtraRef,
    onRemoveExtraRef,
    handleUndo,
    handleRedo,
    handleCommitDraft,
    handleEnhance,
    handleRegeneratePrompt,
    handleGenerateImage,
    handleGenerateVideo,
    handleAnimate,
    handleRetryInFlight,
    handleDismissInFlight,
    voiceProfile,
    onUpdateVoiceProfile,
    chainImageRef,
    resultStyle,
    resultRealism,
  } = props

  // What the render will actually append to the prompt below — resolved by the
  // same rule the generation uses, so the note can't promise a look the card
  // won't fire with.
  const styleNote = appliedStyleNote({ style: resultStyle, realism: resultRealism })

  // Video leads: a clip is what the card is ultimately for, and it's the tab
  // members open the card on. Image and Animate follow.
  const [tab, setTab] = useState<Tab>(initialTab ?? 'video')
  // Video-model picker is a slide-in side panel (like the ref-image bank
  // picker) rather than an inline dropdown.
  const [modelPanelOpen, setModelPanelOpen] = useState(false)
  // Animate tab: which still gets animated. Null → fall back to the cover /
  // latest image. Set explicitly when the user clicks "Animate" on a tile.
  const [animateFrameRef, setAnimateFrameRef] = useState<string | null>(null)
  const latestImageRef = cardState.images.length > 0
    ? cardState.images[cardState.images.length - 1].imageUrl
    : undefined
  const selectedImageRef = cardState.selected?.kind === 'image'
    ? cardState.images[cardState.selected.index]?.imageUrl
    : undefined
  const effectiveAnimateFrame = animateFrameRef ?? selectedImageRef ?? latestImageRef
  const animateFrameUrl = useAssetUrl(effectiveAnimateFrame)
  const [draft, setDraft] = useState(cardState.editablePrompt)
  // Local draft for the shared voice profile (DIALOGUE cards) — committed to the
  // shared value on blur so keystrokes don't churn the whole result.
  const [voiceDraft, setVoiceDraft] = useState(voiceProfile ?? '')
  useEffect(() => { setVoiceDraft(voiceProfile ?? '') }, [voiceProfile])
  const isDialogue = variation.tag === 'DIALOGUE'
  // Expand-the-prompt-into-a-modal toggle (parity with Playground / Scripts).
  const [promptExpanded, setPromptExpanded] = useState(false)
  // Per-tile saved/saving sets so the Bookmark button can show a check.
  const [savedImageIdxs, setSavedImageIdxs] = useState<Set<number>>(new Set())
  const [savingImageIdxs, setSavingImageIdxs] = useState<Set<number>>(new Set())

  // Pull cardState.editablePrompt back into the local draft when undo/redo/
  // enhance/regenerate fire. Local edits don't roundtrip through cardState
  // until the textarea blurs (or the user explicitly commits via Enter? we
  // commit on blur via handleCommitDraft so undo/redo history captures it).
  useEffect(() => {
    setDraft(cardState.editablePrompt)
  }, [cardState.editablePrompt])

  useCloseOnEscape(true, onClose)

  // Mounted only while open, so `enabled` is simply true.
  useCloseOnAppSwitch(true, onClose)

  // Backdrop-click closes the modal — but a text-selection drag that STARTS
  // inside the content and releases over the backdrop fires a `click` on their
  // common ancestor (the backdrop), which would wrongly close it. Guard by
  // remembering whether the press began on the backdrop itself.
  const pointerDownOnBackdrop = useRef(false)

  const persistedImageModel = useSettingsStore((s) => s.getAppModel('broll-studio:image:text-to-image'))
  const imageModelId = persistedImageModel ?? getDefaultModel('broll-studio', 'image', 'text-to-image')?.id

  const persistedVideoModel = useSettingsStore((s) => s.getAppModel('broll-studio:video'))
  const videoModelId =
    persistedVideoModel ?? getDefaultModel('broll-studio', 'video')?.id ?? getDefaultModel('playground', 'video')?.id

  const imageConstraints = imageModelId ? getModel(imageModelId)?.imageConstraints : undefined
  const videoConstraints = videoModelId ? getModel(videoModelId)?.videoConstraints : undefined
  // Does the chosen video model accept reference-to-video? When false, the
  // CHARACTER / PRODUCT slot cards dim with an explanatory tooltip — the
  // toggles still flip so the user can pre-arm them for a model swap, but
  // they no longer suggest the refs will be honoured at gen time.
  const videoModelSupportsRefs = videoModelId
    ? (getModel(videoModelId)?.modes ?? []).includes('reference-to-video')
    : false
  const videoModelName = videoModelId ? (getModel(videoModelId)?.displayName ?? videoModelId) : 'This model'
  const videoModelSavings = videoModelId ? officialSavingsPercent(videoModelId) : null
  // The "doesn't support reference images" caveat is about VIDEO models only —
  // image models always accept references (image-to-image), so dim the slots
  // and show the warning solely while the Video tab is active.
  const refsUnsupportedForVideo = tab === 'video' && !videoModelSupportsRefs

  // Is at least one reference image currently armed? When so, the video model
  // picker greys out models that can't take refs so the user can't pick one
  // that would silently drop the character/product.
  const hasActiveRef =
    (!!characterRef && cardState.refsCharacter !== false) ||
    (!!productRef && cardState.refsProduct !== false)

  // Which of the product's photos this card sends, and how many of them fit.
  // The first pick IS the product reference (the state the shot is in); any
  // beyond it ride as angles and fill whatever slots the model has left, so the
  // count is model-dependent — the slot card reports what will really be sent.
  const productActive = !!productRef && cardState.refsProduct !== false
  const photoSelection = normalizePhotoSelection(cardState.productPhotos, productPhotos?.length ?? 0)
  const manualRefCount =
    (characterRef && cardState.refsCharacter !== false ? 1 : 0) +
    (productActive ? 1 : 0) +
    extraRefs.length
  const attachedAngleCount = productActive
    ? productAngleSlots({
        manualCount: manualRefCount,
        angleCount: Math.max(0, photoSelection.length - 1),
        modelId: tab === 'video' ? videoModelId : resolveImageModelId(true),
        reserved: isDialogue && chainImageRef && cardState.chainLink !== false ? 1 : 0,
      })
    : 0

  // Re-clamp per-card settings when the user switches models. For audio:
  // FORCE on whenever the new model supports audio so it's the default for
  // every audio-capable model (only flipped off explicitly via toggle).
  useEffect(() => {
    if (!imageModelId) return
    const m = getModel(imageModelId)
    const tiers = m?.imageConstraints?.resolutions as ImageResolution[] | undefined
    const aspects = m?.imageConstraints?.aspectRatios
    const updates: Partial<CardState> = {}
    if (tiers && tiers.length > 0 && !tiers.includes(cardState.cardImageResolution)) {
      updates.cardImageResolution = tiers[0]
    }
    if (aspects && aspects.length > 0 && !aspects.includes(cardState.cardImageAspectRatio)) {
      updates.cardImageAspectRatio = aspects[0]
    }
    if (Object.keys(updates).length) onUpdateState(updates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageModelId])

  // Tracks the model across effect runs so a genuine model FLIP (vs the
  // modal simply mounting) can snap resolution to the new model's preferred
  // default. On mount we only clamp invalid values — the card's persisted
  // choice survives a close/reopen.
  const prevVideoModelRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const c = videoConstraints
    const modelChanged = prevVideoModelRef.current !== undefined && prevVideoModelRef.current !== videoModelId
    prevVideoModelRef.current = videoModelId
    if (!c) return
    const updates: Partial<CardState> = {}
    if (c.aspectRatios.length > 0 && !c.aspectRatios.includes(cardState.cardVideoAspectRatio)) {
      updates.cardVideoAspectRatio = c.aspectRatios[0]
    }
    const snappedDuration = snapVideoDuration(cardState.cardVideoDurationSeconds, c.durations)
    if (snappedDuration !== cardState.cardVideoDurationSeconds) {
      updates.cardVideoDurationSeconds = snappedDuration
    }
    // On a model flip, a declared default wins outright (Gemini Omni prefers
    // 1080p — same credits as 720p, so 720p would be money left on the
    // table). Otherwise keep a still-valid resolution, clamping only when
    // the current tier doesn't exist on this model.
    const nextRes = modelChanged && c.default
      ? c.default
      : c.resolutions.includes(cardState.cardVideoResolution)
        ? cardState.cardVideoResolution
        : c.default ?? c.resolutions[0] ?? '720p'
    if (nextRes !== cardState.cardVideoResolution) {
      updates.cardVideoResolution = nextRes
    }
    // Audio: default ON for an audio-capable model, but only on a genuine
    // model FLIP — same rule as resolution above. Forcing it on every mount
    // silently undid a Mute the user had set, and audio is a billed tier, so
    // reopening a card to check it re-armed the more expensive generation.
    // A model that can't do audio always clamps off, flip or not.
    const nextAudio = c.supportsAudio === true && (modelChanged || cardState.cardVideoAudio)
    if (nextAudio !== cardState.cardVideoAudio) {
      updates.cardVideoAudio = nextAudio
    }
    if (Object.keys(updates).length) onUpdateState(updates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoModelId])

  const canUndo = cardState.promptHistoryIndex > 0
  const canRedo = cardState.promptHistoryIndex < cardState.promptHistory.length - 1
  const isManual = variation.id.startsWith('manual-') || variation.label === 'Manual Option'

  const handleDraftBlur = () => {
    // Capture the user's typed draft into the prompt history on blur. No
    // explicit Edit/Done toggle anymore — the textarea is always live.
    handleCommitDraft(draft)
  }

  // Credits estimate strings — surfaced in the Generate buttons as "(N credits)".
  const imageCreditsLabel = imageModelId
    ? formatCredits(estimateCredits(imageModelId, { imageCount: 1, resolution: cardState.cardImageResolution }))
    : null
  const videoCreditsLabel = videoModelId
    ? formatCredits(estimateCredits(videoModelId, {
        durationSeconds: cardState.cardVideoDurationSeconds,
        resolution: cardState.cardVideoResolution,
        audio: cardState.cardVideoAudio,
      }))
    : null

  // ─── Per-tile save ─────────────────────────────────────────────────────
  const handleSaveImageTile = async (index: number) => {
    if (savedImageIdxs.has(index) || savingImageIdxs.has(index)) return
    const img = cardState.images[index]
    if (!img) return
    setSavingImageIdxs((prev) => new Set(prev).add(index))
    try {
      await useBankStore.getState().addBRoll({
        imageUrl: img.imageUrl,
        prompt: img.prompt,
        productId: selectedProductId,
        modelId: selectedModelId,
        scriptId: selectedScriptId,
        sourceApp: 'broll-studio',
      } as Omit<BRoll, 'id' | 'createdAt'>)
      setSavedImageIdxs((prev) => new Set(prev).add(index))
    } catch (err) {
      useAppStore.getState().addToast(humanizeError(err, 'Save failed'), 'error')
    } finally {
      setSavingImageIdxs((prev) => {
        const next = new Set(prev)
        next.delete(index)
        return next
      })
    }
  }

  // ─── Per-tile delete (card outputs only) ───────────────────────────────
  const handleDeleteImageTile = (index: number) => {
    const newImages = cardState.images.filter((_, i) => i !== index)
    let nextSelected = cardState.selected
    if (nextSelected?.kind === 'image') {
      if (nextSelected.index === index) {
        nextSelected = newImages.length > 0
          ? { kind: 'image', index: Math.min(nextSelected.index, newImages.length - 1) }
          : (cardState.videos.length > 0 ? { kind: 'video', index: cardState.currentVideoIndex } : null)
      } else if (nextSelected.index > index) {
        nextSelected = { kind: 'image', index: nextSelected.index - 1 }
      }
    }
    onUpdateState({
      images: newImages,
      currentImageIndex: Math.max(0, Math.min(cardState.currentImageIndex, newImages.length - 1)),
      selected: nextSelected,
    })
    setSavedImageIdxs(rekeyAfterDelete(savedImageIdxs, index))
    setSavingImageIdxs(rekeyAfterDelete(savingImageIdxs, index))
  }

  const handleDeleteVideoTile = (index: number) => {
    const newVideos = cardState.videos.filter((_, i) => i !== index)
    let nextSelected = cardState.selected
    if (nextSelected?.kind === 'video') {
      if (nextSelected.index === index) {
        nextSelected = newVideos.length > 0
          ? { kind: 'video', index: Math.min(nextSelected.index, newVideos.length - 1) }
          : (cardState.images.length > 0 ? { kind: 'image', index: cardState.currentImageIndex } : null)
      } else if (nextSelected.index > index) {
        nextSelected = { kind: 'video', index: nextSelected.index - 1 }
      }
    }
    onUpdateState({
      videos: newVideos,
      currentVideoIndex: Math.max(0, Math.min(cardState.currentVideoIndex, newVideos.length - 1)),
      selected: nextSelected,
    })
  }

  // Copy a tile's prompt to the clipboard.
  const handleCopyPrompt = async (text: string) => {
    const trimmed = (text ?? '').trim()
    if (!trimmed) {
      useAppStore.getState().addToast('No prompt to copy', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(trimmed)
      useAppStore.getState().addToast('Prompt copied', 'success')
    } catch {
      useAppStore.getState().addToast('Could not copy the prompt', 'error')
    }
  }

  return createPortal((
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm sm:px-6"
      onMouseDown={(e) => { pointerDownOnBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => { if (e.target === e.currentTarget && pointerDownOnBackdrop.current) onClose() }}
    >
      <button
        type="button"
        onClick={onClose}
        title="Close (Esc)"
        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white transition-colors hover:bg-black/60"
      >
        <X className="h-4 w-4" />
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ink-950/95 shadow-2xl"
      >
        {/* Body — fixed 50/50 grid; content scrolls inside each column. The
            variation's tag + roll/scene line now lives in the right panel
            header (the modal-wide top bar was removed). */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-2">
          {/* LEFT 50% — scrollable body (model + refs + prompt) over a pinned
              footer (output settings + Generate), mirroring the Playground panel. */}
          <div className="col-span-1 flex min-h-0 flex-col border-b border-ink/5 md:border-b-0 md:border-r">
            {/* Sticky header — the Video / Image / Animate toggle, pulled out of
                the scroll area so it stays put while the body scrolls. Mirrors
                the right panel's identity header (same px-5 pt-3, h-12 row, and
                hairline) so the two line up across the modal. Video leads: the
                clip is the deliverable, and it's the landing tab. */}
            <div className="flex flex-col gap-3 px-5 pt-3">
              <div className="flex h-12 items-center">
                <SegmentedToggle<Tab>
                  className="h-10 !p-1"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: 'video', label: 'Video', icon: VideoIcon },
                    { value: 'image', label: 'Image', icon: ImageIcon },
                    { value: 'animate', label: 'Animate', icon: Film },
                  ]}
                />
              </div>
              <div className="-mx-5 -mt-1 border-b border-ink/5" />
            </div>

            {/* Scrollable body */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="flex grow flex-col gap-3 px-5 pb-6 pt-3">
                {/* The session's look, read-only at the top of the workspace —
                    same note Continuous' frame and clip modals carry. It's
                    appended at fire time, outside the editable prompt below, so
                    this is the only place it's visible. On every tab, because
                    both the image and the video gen append it. */}
                <StyleNote style={styleNote.text} label={styleNote.label} onChange={onChangeStyle} />

                {/* Animate tab → Start frame preview. Image/Video tabs →
                    the Influencer / Product reference slot cards + extra refs. */}
                {tab === 'animate' ? (
                  <div>
                    <span className="text-sm font-medium text-ink-200">Start frame</span>
                    <div className="mt-2">
                      {effectiveAnimateFrame && animateFrameUrl ? (
                        <div
                          className="relative max-w-[72px] overflow-hidden rounded-xl border border-ink/10 bg-ink/[0.02]"
                          style={aspectStyle(cardState.cardVideoAspectRatio)}
                        >
                          <img src={animateFrameUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                      ) : (
                        <div className="flex h-40 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/10 bg-ink/[0.02] px-4 text-center">
                          <ImageIcon className="h-6 w-6 text-ink-700" strokeWidth={1.5} />
                          <p className="text-[11px] leading-relaxed text-ink-500">
                            Generate an image in the Image tab first, then click Animate on it.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    {/* Reference images — bank-keyed Influencer / Product slot
                        cards (no heading, Playground style). Click the body to
                        pick from the bank; the tick-circle toggles whether the
                        ref is sent. */}
                    <div className="grid grid-cols-2 gap-2">
                      {/* Previous cut — a DIALOGUE card chains off the last
                          talking-head still so the ad reads as one continuous
                          piece to camera. Image tab only: the chain is applied
                          when the still is rendered, and the clip inherits it by
                          animating that still. */}
                      {isDialogue && chainImageRef && tab === 'image' && (
                        <ReferenceSlotCard
                          icon={<Link2 className="h-4 w-4 text-broll-300" />}
                          accentClass="bg-broll-500/15 text-broll-300"
                          kind="Previous cut"
                          name="Chain link"
                          imageRef={chainImageRef}
                          onClick={() => onUpdateState({ chainLink: cardState.chainLink === false })}
                          active={cardState.chainLink !== false}
                          onToggleActive={() => onUpdateState({ chainLink: cardState.chainLink === false })}
                        />
                      )}
                      <ReferenceSlotCard
                        icon={<User className="h-4 w-4 text-influencers-400 light:text-influencers-600" />}
                        accentClass="bg-influencers-500/15 text-influencers-400 light:text-influencers-600"
                        kind="Character"
                        name={selectedModel?.name}
                        imageRef={selectedModel?.characterImage}
                        onClick={() => onOpenCharacterPicker?.()}
                        active={cardState.refsCharacter !== false}
                        onToggleActive={() => onUpdateState({ refsCharacter: cardState.refsCharacter === false })}
                        dimmed={refsUnsupportedForVideo}
                        dimmedReason={`${videoModelName} doesn't accept reference images. Switch to Veo 3.1 Fast or Seedance 2.0 to use them.`}
                      />
                      <ReferenceSlotCard
                        icon={<Package className="h-4 w-4 text-gold-400 light:text-gold-600" />}
                        accentClass="bg-gold-500/15 text-gold-400 light:text-gold-600"
                        kind="Product"
                        note={attachedAngleCount > 0 ? `+${attachedAngleCount} angle${attachedAngleCount > 1 ? 's' : ''}` : null}
                        name={selectedProduct?.productName}
                        imageRef={productPhotos?.[photoSelection[0]] ?? selectedProduct?.productImage}
                        onClick={() => onOpenProductPicker?.()}
                        active={cardState.refsProduct !== false}
                        onToggleActive={() => onUpdateState({ refsProduct: cardState.refsProduct === false })}
                        dimmed={refsUnsupportedForVideo}
                        dimmedReason={`${videoModelName} doesn't accept reference images. Switch to Veo 3.1 Fast or Seedance 2.0 to use them.`}
                      />
                    </div>
                    {/* Which product photo this shot is built from. Only shown
                        when the bank row holds more than one — see
                        ProductPhotoRow. */}
                    {productActive && (
                      <ProductPhotoRow
                        photos={productPhotos ?? []}
                        selection={photoSelection}
                        onChange={(next) => onUpdateState({ productPhotos: next })}
                        dimmed={refsUnsupportedForVideo}
                      />
                    )}
                    {/* Extra references — keep the bank-keyed pills above, but
                        let the user attach more (a second product, an outfit,
                        a pose) via upload or the bank. */}
                    {onAddExtraRef && onRemoveExtraRef && (
                      <ExtraRefsRow
                        refs={extraRefs}
                        onAdd={onAddExtraRef}
                        onRemove={onRemoveExtraRef}
                        dimmed={refsUnsupportedForVideo}
                      />
                    )}
                    {hasActiveRef && refsUnsupportedForVideo && (
                      <p className="mt-2 text-[11px] leading-relaxed text-gold-400/80 light:text-gold-600/80">
                        {videoModelName} doesn't support reference images — this will generate text-to-video only. Pick Veo 3.1 Fast or Seedance 2.0 to use your character/product.
                      </p>
                    )}
                  </div>
                )}

                {/* Prompt — grows to absorb leftover height. Textarea + footer
                    toolbar (Enhance / Regenerate / Undo / Redo + Expand) inside
                    one rounded box, matching the Playground prompt field. */}
                <div className="flex grow flex-col">
                  <div className="relative flex grow flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.03] transition-colors focus-within:border-ink/20 focus-within:bg-ink/[0.05]">
                    <textarea
                      value={draft}
                      // Mirror the draft into cardState.editablePrompt on every
                      // keystroke (not just on blur) so the Generate button
                      // enables immediately and fires the live prompt. Prompt
                      // history is still only committed on blur (handleDraftBlur).
                      onChange={(e) => { setDraft(e.target.value); onUpdateState({ editablePrompt: e.target.value }) }}
                      onBlur={handleDraftBlur}
                      rows={8}
                      placeholder="Write your custom B-roll prompt here..."
                      className="relative min-h-[180px] w-full grow resize-none border-0 bg-transparent px-3.5 pb-3 pt-3 text-[13px] leading-relaxed text-ink-200 placeholder-ink-600 outline-none"
                    />
                    {/* Footer toolbar — Enhance + Regenerate + Undo/Redo
                        bottom-left; Expand bottom-right; under a hairline. */}
                    <div className="flex items-center justify-between gap-2 border-t border-ink/10 px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          title="Enhance with framework"
                          onClick={handleEnhance}
                          disabled={cardState.isPromptWorking || !draft.trim()}
                          className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:bg-broll-500/10 hover:text-broll-300 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {cardState.isPromptWorking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          Enhance Prompt
                        </button>
                        <button
                          type="button"
                          title={`Regenerate prompt — produces a fresh ${tagLabel(variation.tag)} prompt`}
                          onClick={handleRegeneratePrompt}
                          disabled={cardState.isPromptWorking}
                          className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Regenerate Prompt
                        </button>
                        <button
                          type="button"
                          title="Undo"
                          onClick={handleUndo}
                          disabled={!canUndo || cardState.isPromptWorking}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Undo2 className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title="Redo"
                          onClick={handleRedo}
                          disabled={!canRedo || cardState.isPromptWorking}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Redo2 className="h-3 w-3" />
                        </button>
                      </div>
                      <ExpandButton onClick={() => setPromptExpanded(true)} />
                    </div>
                  </div>

                  {cardState.promptError && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400 light:text-red-600" />
                      <p className="text-[11px] leading-relaxed text-red-300 light:text-red-700">{cardState.promptError}</p>
                    </div>
                  )}
                </div>

                {/* Voice profile — one shared voice for every dialogue clip so
                    the character sounds the same across scenes. Sits below the
                    prompt. Only on the Video / Animate tabs of a DIALOGUE card;
                    edits update the value shared by all dialogue clips. */}
                {isDialogue && onUpdateVoiceProfile && tab !== 'image' && (
                  <div className="rounded-2xl border border-broll-500/20 bg-broll-500/[0.06] px-3 py-2.5">
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <Volume2 className="h-3.5 w-3.5 text-broll-300 light:text-broll-600" />
                      <span className="text-[12px] font-medium text-ink-100">Voice</span>
                      <span className="text-[10px] text-ink-500">shared by every dialogue clip</span>
                    </div>
                    <textarea
                      value={voiceDraft}
                      onChange={(e) => setVoiceDraft(e.target.value)}
                      onBlur={() => onUpdateVoiceProfile(voiceDraft)}
                      rows={3}
                      placeholder="How the character sounds — age, accent, pitch, pace, texture, energy. Written once, applied to every talking clip."
                      className="w-full resize-none rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2 text-[12px] leading-relaxed text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Pinned footer — output settings (resolution / aspect / duration
                / audio) just above the Generate button, separated by a hairline.
                Matches the Playground panel's sticky footer; chips open upward. */}
            <div className="shrink-0 border-t border-ink/5 px-5 py-4">
              {/* Model picker — sits directly above the output chips (Playground
                  style); the picker's own dropdown/panel opens upward here. */}
              <div className="mb-3">
                {tab === 'image' ? (
                  <ModelPicker appId="broll-studio" task="image" mode="text-to-image" />
                ) : (
                  <>
                    {/* Trigger button — opens the slide-in ModelSidePanel.
                        Mirrors ModelPicker's trigger look (provider logo + name
                        + star + "% off"), no heading (Playground style). */}
                    <button
                      type="button"
                      onClick={() => setModelPanelOpen(true)}
                      className="flex h-12 w-full items-center gap-2.5 rounded-full border border-ink/10 bg-ink/[0.02] px-3 text-left transition-colors hover:bg-ink/[0.05]"
                    >
                      {videoModelId ? (
                        <>
                          <ProviderLogo provider={getModel(videoModelId)?.provider ?? ''} />
                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="truncate text-[13px] font-medium text-ink-100">{videoModelName}</span>
                            {getModel(videoModelId)?.tags.includes('recommended') && (
                              <Star className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400 light:fill-yellow-600 light:text-yellow-600" strokeWidth={1.5} />
                            )}
                            {videoModelSavings != null && <SavingsPill pct={videoModelSavings} />}
                          </div>
                        </>
                      ) : (
                        <span className="flex-1 truncate text-sm text-ink-400">Select model</span>
                      )}
                      {/* Chevron signals the slide-in panel; no credits badge
                          here — costs show per-model in the panel. */}
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
                    </button>
                    <ModelSidePanel
                      appId="broll-studio"
                      task="video"
                      isOpen={modelPanelOpen}
                      onClose={() => setModelPanelOpen(false)}
                      requireMode={tab === 'animate' ? undefined : (hasActiveRef ? 'reference-to-video' : undefined)}
                      requireAnyModes={tab === 'animate' ? ['image-to-video', 'reference-to-video'] : undefined}
                      requireModeNote={tab === 'animate'
                        ? "Greyed-out models can't animate a still — they take neither a start frame nor reference images. Pick Seedance 2.0, Veo 3.1 Fast, Gemini Omni, or another still-capable model."
                        : "Greyed-out models don't support reference image-to-video. To use these, generate still frames in the Image tab, then send them to Playground for start/end frames."}
                      costParams={{
                        durationSeconds: cardState.cardVideoDurationSeconds,
                        resolution: cardState.cardVideoResolution,
                        audio: cardState.cardVideoAudio,
                      }}
                    />
                  </>
                )}
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {tab === 'image'
                  ? imageConstraints && (
                      <>
                        {imageConstraints.resolutions && imageConstraints.resolutions.length > 0 && (
                          <ConstraintChip
                            grow
                            openDirection="up"
                            options={imageConstraints.resolutions as string[]}
                            value={cardState.cardImageResolution}
                            onChange={(v) => onUpdateState({ cardImageResolution: v as ImageResolution })}
                            renderOption={(v) => {
                              const credits = formatCredits(estimateCredits(imageModelId ?? '', { imageCount: 1, resolution: v as ImageResolution }))
                              return (
                                <span className="flex w-full items-center justify-between gap-6">
                                  <span>{v}</span>
                                  {credits && <span className="text-ink-500">{credits}</span>}
                                </span>
                              )
                            }}
                          />
                        )}
                        {imageConstraints.aspectRatios && imageConstraints.aspectRatios.length > 0 && (
                          <ConstraintChip
                            grow
                            openDirection="up"
                            options={imageConstraints.aspectRatios}
                            value={cardState.cardImageAspectRatio}
                            onChange={(v) => onUpdateState({ cardImageAspectRatio: v })}
                            render={(v) => (
                              <span className="flex items-center gap-1.5">
                                <AspectIcon ratio={v} />
                                <span>{v}</span>
                              </span>
                            )}
                          />
                        )}
                      </>
                    )
                  : videoConstraints && (
                      <>
                        <ConstraintChip
                          grow
                          openDirection="up"
                          options={videoConstraints.resolutions}
                          value={cardState.cardVideoResolution}
                          onChange={(v) => onUpdateState({ cardVideoResolution: v })}
                          render={videoResolutionLabel}
                        />
                        {/* Image-conditioned models (e.g. Kling 3.0 Turbo) inherit
                            aspect from the input frame and expose no aspect param,
                            so aspectRatios is [] and the chip stays hidden. */}
                        {videoConstraints.aspectRatios.length > 0 && (
                          <ConstraintChip
                            grow
                            openDirection="up"
                            options={videoConstraints.aspectRatios}
                            value={cardState.cardVideoAspectRatio}
                            onChange={(v) => onUpdateState({ cardVideoAspectRatio: v })}
                            render={(v) => (
                              <span className="flex items-center gap-1.5">
                                <AspectIcon ratio={v} />
                                <span>{v}</span>
                              </span>
                            )}
                          />
                        )}
                        {videoConstraints.durations.length > 0 && (
                          <ConstraintChip
                            grow
                            openDirection="up"
                            options={videoConstraints.durations.map(String)}
                            value={String(cardState.cardVideoDurationSeconds)}
                            onChange={(v) => onUpdateState({ cardVideoDurationSeconds: Number(v) })}
                            render={(v) => <span>{v}s</span>}
                          />
                        )}
                        {videoConstraints.supportsAudio && (
                          <ConstraintChip
                            grow
                            openDirection="up"
                            options={['Audio', 'Mute']}
                            value={cardState.cardVideoAudio ? 'Audio' : 'Mute'}
                            onChange={(v) => onUpdateState({ cardVideoAudio: v === 'Audio' })}
                            triggerClassName={cardState.cardVideoAudio
                              ? 'border-broll-500/40 bg-broll-500/15 text-broll-200'
                              : 'border-ink/10 bg-ink/[0.02] text-ink-400 group-hover:bg-ink/[0.05]'}
                            render={(v) => (
                              <span className="flex items-center gap-1.5">
                                {v === 'Audio' ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                                <span>{v}</span>
                              </span>
                            )}
                          />
                        )}
                      </>
                    )}
              </div>

              {/* Generate — accent pill (image / video / animate). */}
              {tab === 'image' ? (
                <button
                  onClick={handleGenerateImage}
                  disabled={!cardState.editablePrompt.trim()}
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-broll-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ImageIcon className="h-4 w-4" />
                  Generate Image
                  {imageCreditsLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
                      <Coins className="h-3 w-3" strokeWidth={2} />
                      {imageCreditsLabel}
                    </span>
                  )}
                </button>
              ) : tab === 'video' ? (
                <button
                  onClick={() => handleGenerateVideo(videoModelId)}
                  disabled={!cardState.editablePrompt.trim()}
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-broll-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <VideoIcon className="h-4 w-4" />
                  Generate Video
                  {videoCreditsLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
                      <Coins className="h-3 w-3" strokeWidth={2} />
                      {videoCreditsLabel}
                    </span>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => handleAnimate(effectiveAnimateFrame, videoModelId)}
                  disabled={!cardState.editablePrompt.trim() || !effectiveAnimateFrame}
                  title={!effectiveAnimateFrame ? 'Generate an image first, then animate it' : undefined}
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-broll-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Film className="h-4 w-4" />
                  Animate
                  {videoCreditsLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
                      <Coins className="h-3 w-3" strokeWidth={2} />
                      {videoCreditsLabel}
                    </span>
                  )}
                </button>
              )}
              {tab === 'image' && <ModelWaitNotice modelId={imageModelId} className="mt-2" />}
            </div>
          </div>

          {/* RIGHT 50% — variation meta header (moved out of the removed top
              bar) + per-card gallery (Playground masonry). */}
          <div className="col-span-1 flex min-h-0 flex-col overflow-hidden">
            <div className="flex flex-col gap-3 px-5 pt-3">
              {/* Identity header — serif scene number, a vertical rule, then the
                  role pill stacked over the script line. Mirrors the main
                  storyboard rows (and the other detail modals) so all four read
                  the same. h-12 matches the left toggle row so the two hairlines
                  land on one line across the modal. */}
              <div className="flex h-12 min-w-0 items-center gap-3.5">
                <span
                  className="shrink-0 text-4xl font-normal italic tabular-nums leading-none text-ink-700"
                  style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
                >
                  {String(sceneNumber).padStart(2, '0')}
                </span>
                <div className="h-8 w-px shrink-0 bg-ink/10" />
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    {isManual ? (
                      <span className="w-fit rounded-full border border-ink/15 bg-ink/10 px-2 py-0.5 text-[10px] font-medium leading-none tracking-tight text-ink-300">
                        Custom
                      </span>
                    ) : (
                      <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none tracking-tight ${tagChipStyle(variation.tag)}`}>
                        {tagLabel(variation.tag)}
                      </span>
                    )}
                  </div>
                  {scriptLine && (
                    <span
                      className="min-w-0 truncate text-[15px] not-italic leading-tight text-ink-300"
                      style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
                      title={scriptLine}
                    >
                      &ldquo;{scriptLine}&rdquo;
                    </span>
                  )}
                </div>
              </div>
              {/* Full-width separator — aligned with the one under the left
                  toggle (same -mt-1) so the line runs across the whole modal. */}
              <div className="-mx-5 -mt-1 border-b border-ink/5" />
            </div>
            <ModalGallery
              cardState={cardState}
              onUpdateState={onUpdateState}
              setTab={setTab}
              savedImageIdxs={savedImageIdxs}
              savingImageIdxs={savingImageIdxs}
              onSaveImage={handleSaveImageTile}
              onDeleteImage={handleDeleteImageTile}
              onDeleteVideo={handleDeleteVideoTile}
              onCopyPrompt={handleCopyPrompt}
              // Image tab only — the Animate bar's whole job is to carry a still
              // over to the Animate tab, so on Animate (and on Video) it points
              // at the tab you're already on.
              onAnimateImage={tab === 'image' ? (index) => {
                const ref = cardState.images[index]?.imageUrl
                if (ref) {
                  setAnimateFrameRef(ref)
                  setTab('animate')
                }
              } : undefined}
              onRetryInFlight={handleRetryInFlight}
              onDismissInFlight={handleDismissInFlight}
            />
          </div>
        </div>
      </div>

      <ExpandTextModal
        open={promptExpanded}
        onClose={() => { setPromptExpanded(false); handleCommitDraft(draft) }}
        value={draft}
        onChange={setDraft}
        title={`Scene ${sceneNumber} — Prompt`}
        placeholder="Write your custom B-roll prompt here..."
        accent="broll"
      />
    </div>
  ), document.body)
}

// Shape the Animate start-frame preview to the chosen video aspect ratio.
function aspectStyle(ar: string): React.CSSProperties {
  const [w, h] = ar.split(':').map(Number)
  if (!w || !h) return { aspectRatio: '9 / 16' }
  return { aspectRatio: `${w} / ${h}` }
}
