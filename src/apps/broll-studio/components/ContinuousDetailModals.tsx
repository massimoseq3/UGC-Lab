import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Image as ImageIcon, Video as VideoIcon, Film, Coins, Volume2, VolumeX, UserRound, Package, Link2, Download, Bookmark, Check, Trash2, Copy, ArrowDown, ChevronRight, Star, Layers, Images,
} from 'lucide-react'
import Spinner from '../../../components/Spinner'
import SectionCard, { SectionLabel, StatusDot } from '../../../components/SectionCard'
import ConstraintChip from '../../../components/ConstraintChip'
import BatchCountStepper from '../../../components/BatchCountStepper'
import { clampBatchCount } from '../../../utils/batchCount'
import { usePersistedState } from '../../../hooks/usePersistedState'
import AspectIcon from '../../../components/AspectIcon'
import ModelPicker from '../../../components/ModelPicker'
import ModelSidePanel from '../../../components/ModelSidePanel'
import SegmentedToggle from '../../../components/SegmentedToggle'
import ProviderLogo from '../../../components/ProviderLogo'
import SavingsPill from '../../../components/SavingsPill'
import ExpandTextModal from '../../../components/ExpandableText'
import PromptToolbar from '../../../components/PromptToolbar'
import { ReferenceSlotCard, ExtraRefsRow, ProductPhotoRow, PendingMediaTile, ModalVideoPlayer, StyleNote, InFlightFailureRow } from './cardDetailParts'
import { ExpandVideoButton } from '../../../components/VideoLightbox'
import type { ContinuousFrameCardState, ContinuousClipCardState, GeneratedVideo, ReferenceImage } from '../types'
import type { Product, Model } from '../../../stores/types'
import { CONTINUOUS_MODEL_IDS } from '../services/generateContinuous'
import { resolveImageModelId } from '../services/generateBroll'
import { productAngleSlots, normalizePhotoSelection } from '../services/productAngles'
import { useAppStore } from '../../../stores/appStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { getUrl } from '../../../utils/assetStore'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import {
  getModel,
  getDefaultModel,
  estimateCredits,
  formatCredits,
  videoResolutionLabel,
  imageResolutionsFor,
  officialSavingsPercent,
  snapVideoDuration,
  type ImageResolution,
} from '../../../utils/models'
import { downloadImage } from '../../../utils/downloadImage'
import { copyToClipboard } from '../../../utils/clipboard'
import { humanizeError } from '../../../utils/friendlyError'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useBackdropClose } from '../../../hooks/useBackdropClose'

// ── Shared modal shell ─────────────────────────────────────────

function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useCloseOnEscape(true, onClose)
  useCloseOnAppSwitch(true, onClose)

  const backdrop = useBackdropClose(onClose)

  return createPortal((
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm sm:px-6"
      {...backdrop}
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
        className="flex h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ink-950/95 shadow-2xl max-md:h-[calc(100dvh-1rem)]"
      >
        {children}
      </div>
    </div>
  ), document.body)
}

// ── Frame modal — keyframe concept workspace ───────────────────

interface ContinuousFrameModalProps {
  frameLabel: string    // "Frame 3" / "Final Frame"
  frameNumber: number   // the frame index, shown as a serif "01" in the header
  conceptLabel: string  // the concept's staging slug
  conceptShot?: string  // its shot size off SHOT_LADDER, shown as a chip
  scriptLine: string    // the narration line this frame opens ('' for final)
  style: string
  cardState: ContinuousFrameCardState
  // The previous frame's chosen keyframe (chain reference), if picked.
  chainImageRef?: string
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
  productPhotos?: string[]
  onChangeStyle?: () => void
  selectedModel?: Model | null
  selectedProduct?: Product | null
  // Extra user-attached reference images (memory-only, like the Line-by-Line
  // card's extraRefs — data: URIs are too big to persist).
  extraRefs: ReferenceImage[]
  onAddExtraRef: (ref: ReferenceImage) => void
  onRemoveExtraRef: (index: number) => void
  // Which image (if any) of THIS concept is the frame's chosen keyframe.
  selectedImageIndex: number | null
  onSelectImage: (index: number) => void
  // Save a generated keyframe still to the B-Rolls bank (reusable start frame).
  onSaveImage: (imageRef: string, prompt: string) => Promise<void>
  onClose: () => void
  onUpdate: (updater: (prev: ContinuousFrameCardState) => Partial<ContinuousFrameCardState>) => void
  onGenerate: () => void
  // Prompt tools — the LLM rewrites (kept in the view so it owns the storyboard
  // context the calls need).
  onEnhancePrompt: () => Promise<string>
  onRegeneratePrompt: () => Promise<string>
  onRetryInFlight: (id: string) => void
  onDismissInFlight: (id: string) => void
  // ── Standalone Animate tab ── image-to-video this frame's chosen still on its
  // own (not chained). The view owns the gen; the modal drives the UI.
  animateModelId: string
  onAnimate: () => void
  onDeleteVideo: (index: number) => void
  onRetryVideoInFlight: (id: string) => void
  onDismissVideoInFlight: (id: string) => void
}

export function ContinuousFrameModal({
  frameLabel,
  frameNumber,
  conceptLabel,
  conceptShot,
  scriptLine,
  style,
  cardState,
  chainImageRef,
  characterRef,
  productRef,
  productPhotos,
  onChangeStyle,
  selectedModel,
  selectedProduct,
  extraRefs,
  onAddExtraRef,
  onRemoveExtraRef,
  selectedImageIndex,
  onSelectImage,
  onSaveImage,
  onClose,
  onUpdate,
  onGenerate,
  onEnhancePrompt,
  onRegeneratePrompt,
  onRetryInFlight,
  onDismissInFlight,
  animateModelId,
  onAnimate,
  onDeleteVideo,
  onRetryVideoInFlight,
  onDismissVideoInFlight,
}: ContinuousFrameModalProps) {
  const [draft, setDraft] = useState(cardState.editablePrompt)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [promptWorking, setPromptWorking] = useState(false)
  // Adjust-during-render sync: external prompt changes (undo, restore) reset
  // the local draft without an effect round-trip.
  const [syncedPrompt, setSyncedPrompt] = useState(cardState.editablePrompt)
  if (syncedPrompt !== cardState.editablePrompt) {
    setSyncedPrompt(cardState.editablePrompt)
    setDraft(cardState.editablePrompt)
  }


  // Image vs standalone-Animate tab. Animate image-to-video's this frame's
  // current still on its own using the storyboard's continuous video model.
  const [frameTab, setFrameTab] = useState<'image' | 'animate'>('image')
  const [animateModelPanelOpen, setAnimateModelPanelOpen] = useState(false)
  // Takes of this concept — shared with the Line-by-Line card modal's count, so
  // "how many takes I want" is one setting across the app rather than one per
  // modal the member has to find twice.
  const [takeCount, setTakeCount] = usePersistedState<number>('ai-ugc-lab:broll:card-takes', 1, {
    sanitize: (v) => clampBatchCount(v),
  })
  const animateModel = getModel(animateModelId)
  const animateConstraints = animateModel?.videoConstraints
  const startImageUrl = useAssetUrl(cardState.images[cardState.currentImageIndex]?.imageUrl)
  // Video has no count dimension in the registry, so a run of N is N × one
  // clip. Null stays null — an unmeasurable price is never printed as zero.
  const animateCreditsFor = (n: number) => {
    if (!animateModel) return null
    const one = estimateCredits(animateModelId, {
      durationSeconds: cardState.videoDurationSeconds,
      resolution: cardState.videoResolution,
      audio: cardState.videoAudio,
    })
    return one === null ? null : one * n
  }
  const animateCredits = formatCredits(animateCreditsFor(takeCount))
  const animateCapable = (animateModel?.modes ?? []).some((m) => m === 'image-to-video' || m === 'reference-to-video')

  // Image model is the app-wide B-Roll pick (same ModelPicker as the
  // Line-by-Line card), so its constraints drive the footer chips.
  const imageModelId = useSettingsStore((s) => s.perAppModel['broll-studio:image:text-to-image'])
    ?? getDefaultModel('broll-studio', 'image', 'text-to-image')?.id
  const imageConstraints = imageModelId ? getModel(imageModelId)?.imageConstraints : undefined

  // Which of the product's photos this frame sends — the storyboard picked the
  // state its staging is in, and the strip below overrides it. The first pick IS
  // the product reference; anything past it fills the slots the image model has
  // left after the chain, character, product and hand-attached refs.
  const photoSelection = normalizePhotoSelection(cardState.productPhotos, productPhotos?.length ?? 0)
  const angleCount = cardState.refsProduct && productRef
    ? productAngleSlots({
        manualCount:
          (chainImageRef && cardState.chainLink ? 1 : 0) +
          (cardState.refsCharacter && characterRef ? 1 : 0) +
          1 +
          extraRefs.length,
        angleCount: Math.max(0, photoSelection.length - 1),
        modelId: resolveImageModelId(true),
      })
    : 0
  // What the References card header reports. The product's extra angles aren't
  // counted — they ride behind the product reference, whose own line says
  // "+2 angles".
  const attachedRefCount =
    (chainImageRef && cardState.chainLink ? 1 : 0) +
    (characterRef && cardState.refsCharacter ? 1 : 0) +
    (productRef && cardState.refsProduct ? 1 : 0) +
    extraRefs.length
  const resolutions = (imageConstraints?.resolutions ?? imageResolutionsFor(imageModelId ?? '')) as ImageResolution[]
  const aspects = imageConstraints?.aspectRatios ?? ['9:16', '1:1', '16:9', '4:3', '3:4']
  const credits = imageModelId
    ? formatCredits(estimateCredits(imageModelId, { imageCount: takeCount, resolution: cardState.resolution }))
    : null

  // ── Prompt history (Enhance / Regenerate / Undo / Redo) ──
  const history = cardState.promptHistory.length > 0 ? cardState.promptHistory : [cardState.editablePrompt]
  const historyIndex = Math.max(0, Math.min(cardState.promptHistoryIndex, history.length - 1))
  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1

  const pushHistory = (next: string) => {
    const trimmed = history.slice(0, historyIndex + 1)
    const updated = [...trimmed, next]
    onUpdate(() => ({ editablePrompt: next, promptHistory: updated, promptHistoryIndex: updated.length - 1 }))
    setDraft(next)
  }
  const commitDraft = () => {
    if (draft === history[historyIndex]) { onUpdate(() => ({ editablePrompt: draft })); return }
    pushHistory(draft)
  }
  const handleUndo = () => {
    if (!canUndo) return
    const i = historyIndex - 1
    onUpdate(() => ({ editablePrompt: history[i], promptHistoryIndex: i }))
    setDraft(history[i])
  }
  const handleRedo = () => {
    if (!canRedo) return
    const i = historyIndex + 1
    onUpdate(() => ({ editablePrompt: history[i], promptHistoryIndex: i }))
    setDraft(history[i])
  }
  const runPromptTool = async (tool: () => Promise<string>, label: string) => {
    if (promptWorking) return
    setPromptWorking(true)
    try {
      const next = await tool()
      if (next.trim()) pushHistory(next.trim())
    } catch (err) {
      useAppStore.getState().addToast(`${label} failed: ${humanizeError(err, `${label} failed.`)}`, 'error')
    } finally {
      setPromptWorking(false)
    }
  }

  return (
    <ModalShell onClose={onClose}>
      {/* One scroller on a phone, two columns on a desktop. Stacked, the two
        halves used to be a pair of ~45dvh scroll windows — the workspace in
        one slot and its own outputs in another, neither tall enough to work
        in. Now the modal is one page: the setup, then what it made. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-2 md:overflow-hidden">
        {/* LEFT — model + refs + prompt over a pinned Generate footer */}
        <div className="col-span-1 flex min-h-0 flex-col border-b border-ink/5 max-md:shrink-0 md:border-b-0 md:border-r">
          <div className="flex min-h-0 flex-1 flex-col max-md:flex-none md:overflow-y-auto">
            <div className="flex grow flex-col gap-3 px-5 pb-1 pt-3">
              {/* Output-type tab — Image builds the keyframe; Animate image-to-
                  video's the chosen still on its own (a standalone clip, not
                  chained into the keyframe sequence). */}
              <div className="flex h-12 items-center">
                <SegmentedToggle<'image' | 'animate'>
                  className="h-10 !p-1"
                  value={frameTab}
                  onChange={setFrameTab}
                  options={[
                    { value: 'image', label: 'Image', icon: ImageIcon },
                    { value: 'animate', label: 'Animate', icon: Film },
                  ]}
                />
              </div>
              <div className="-mx-5 -mt-1 border-b border-ink/5" />

              {frameTab === 'image' && (<>
              <StyleNote style={style} onChange={onChangeStyle} />

              {/* Everything this keyframe is built FROM, in the References card
                  the input panel wears — the chain ref (previous keyframe) is
                  the continuity lock, character/product fix identity, and the
                  photo strip and extra refs belong to the same group. */}
              <SectionCard
                icon={Layers}
                title="References"
                contentClassName="flex flex-col gap-3"
                right={attachedRefCount > 0 ? (
                  <span className="rounded-full bg-ink/[0.03] px-2 py-0.5 text-[10px] tabular-nums text-ink-500">
                    {attachedRefCount} attached
                  </span>
                ) : undefined}
              >
              {(chainImageRef || characterRef || productRef) && (
                <div className="grid grid-cols-2 gap-2">
                  {chainImageRef && (
                    <ReferenceSlotCard
                      icon={<Link2 className="h-4 w-4 text-broll-300" />}
                      accentClass="bg-broll-500/15 text-broll-300"
                      kind="Previous frame"
                      name="Chain link"
                      imageRef={chainImageRef}
                      onClick={() => onUpdate((p) => ({ chainLink: !p.chainLink }))}
                      active={cardState.chainLink}
                      onToggleActive={() => onUpdate((p) => ({ chainLink: !p.chainLink }))}
                    />
                  )}
                  {characterRef && (
                    <ReferenceSlotCard
                      icon={<UserRound className="h-4 w-4 text-influencers-400 light:text-influencers-600" />}
                      accentClass="bg-influencers-500/15 text-influencers-400 light:text-influencers-600"
                      kind="Character"
                      name={selectedModel?.name}
                      imageRef={characterRef.dataUrl}
                      onClick={() => onUpdate((p) => ({ refsCharacter: !p.refsCharacter }))}
                      active={cardState.refsCharacter}
                      onToggleActive={() => onUpdate((p) => ({ refsCharacter: !p.refsCharacter }))}
                    />
                  )}
                  {productRef && (
                    <ReferenceSlotCard
                      icon={<Package className="h-4 w-4 text-gold-400 light:text-gold-600" />}
                      accentClass="bg-gold-500/15 text-gold-400 light:text-gold-600"
                      kind="Product"
                      note={angleCount > 0 ? `+${angleCount} angle${angleCount > 1 ? 's' : ''}` : null}
                      name={selectedProduct?.productName}
                      imageRef={productPhotos?.[photoSelection[0]] ?? productRef.dataUrl}
                      onClick={() => onUpdate((p) => ({ refsProduct: !p.refsProduct }))}
                      active={cardState.refsProduct}
                      onToggleActive={() => onUpdate((p) => ({ refsProduct: !p.refsProduct }))}
                    />
                  )}
                </div>
              )}

              {/* Which product photo this staging is built from — only shown
                  when the bank row holds more than one. See ProductPhotoRow. */}
              {cardState.refsProduct && productRef && (
                <ProductPhotoRow
                  photos={productPhotos ?? []}
                  selection={photoSelection}
                  onChange={(next) => onUpdate(() => ({ productPhotos: next }))}
                />
              )}

              {/* Extra references — attach more (a prop, a location, a pose). */}
              <ExtraRefsRow refs={extraRefs} onAdd={onAddExtraRef} onRemove={onRemoveExtraRef} />
              </SectionCard>

              {/* Prompt — the keyframe description, with the same toolbar the
                  Line-by-Line card carries. Deliberately OUTSIDE the card: it's
                  where you write, not what you attach. */}
              <div className="flex grow flex-col">
                <div className="relative flex grow flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.03] transition-colors focus-within:border-ink/20 focus-within:bg-ink/[0.05]">
                  <textarea
                    value={draft}
                    onChange={(e) => { setDraft(e.target.value); onUpdate(() => ({ editablePrompt: e.target.value })) }}
                    onBlur={commitDraft}
                    rows={10}
                    placeholder="Describe this keyframe as one paragraph: what's in frame, the light, the framing…"
                    className="relative min-h-[200px] w-full grow resize-none border-0 bg-transparent px-3.5 pb-3 pt-3 text-[13px] leading-relaxed text-ink-200 placeholder-ink-600 outline-none"
                  />
                  <PromptToolbar
                    accent="broll"
                    onEnhance={() => void runPromptTool(onEnhancePrompt, 'Enhance')}
                    enhanceTitle="Enhance · same staging, richer detail"
                    enhanceDisabled={!draft.trim()}
                    busy={promptWorking}
                    onRegenerate={() => void runPromptTool(onRegeneratePrompt, 'Regenerate')}
                    regenerateTitle="Regenerate · a fresh staging for this keyframe"
                    onUndo={handleUndo}
                    canUndo={canUndo}
                    onRedo={handleRedo}
                    canRedo={canRedo}
                    onExpand={() => setPromptExpanded(true)}
                  />
                </div>
              </div>
              </>)}

              {frameTab === 'animate' && (
                <>
                  {/* Start frame — the chosen still this animation begins on.
                      The dot is honest: no still means Animate is disabled. */}
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel label="Start frame" filled={!!startImageUrl} required />
                    <div>
                      {startImageUrl ? (
                        <div className="relative max-w-[120px] overflow-hidden rounded-xl border border-ink/10 bg-ink/[0.02]" style={{ aspectRatio: '9 / 16' }}>
                          <img src={startImageUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                      ) : (
                        <div className="flex h-40 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/10 bg-ink/[0.02] px-4 text-center">
                          <ImageIcon className="h-6 w-6 text-ink-700" strokeWidth={1.5} />
                          <p className="text-[11px] leading-relaxed text-ink-500">Generate an image on the Image tab first, then animate it.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Motion — how the still animates (seeded from this frame's
                      departure motion; edit freely). Named, where it used to be
                      an unlabelled box you identified from its placeholder. */}
                  <div className="flex grow flex-col gap-1.5">
                    {/* Neutral when empty, never red: Animate is gated on the
                        still and the model's capability, not on this text. Red
                        means "this is why Generate is grey" and nothing else. */}
                    <SectionLabel label="Motion" filled={cardState.animateMotion.trim().length > 0} />
                    <div className="relative flex grow flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.03] transition-colors focus-within:border-ink/20 focus-within:bg-ink/[0.05]">
                      <textarea
                        value={cardState.animateMotion}
                        onChange={(e) => onUpdate(() => ({ animateMotion: e.target.value }))}
                        rows={6}
                        placeholder="How the shot moves: the camera move, the character's motion, what changes across the clip."
                        className="relative min-h-[140px] w-full grow resize-none border-0 bg-transparent px-3.5 pb-3 pt-3 text-[13px] leading-relaxed text-ink-200 placeholder-ink-600 outline-none"
                      />
                    </div>
                    <p className="mt-1.5 px-1 text-[10px] text-ink-600">
                      {animateModel?.modes?.includes('image-to-video')
                        ? 'The still is used as the start frame.'
                        : animateModel?.modes?.includes('reference-to-video')
                          ? 'The still is used as a reference image (this model has no start-frame mode).'
                          : "This model can't animate a still. Pick another below."}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Pinned footer — output settings + Generate, matching the
              Line-by-Line card modal. */}
          <div className="shrink-0 px-5 pb-4 pt-2">
            {frameTab === 'image' ? (
              <>
                {/* Image model — the same app-wide picker the Line-by-Line card
                    uses, so a model swap applies across the whole storyboard.
                    Sits just above the output chips (opens upward). */}
                <div className="mb-3">
                  <ModelPicker appId="broll-studio" task="image" mode="text-to-image" />
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  {resolutions.length > 0 && (
                    <ConstraintChip
                      grow
                      openDirection="up"
                      options={resolutions as string[]}
                      value={cardState.resolution}
                      onChange={(v) => onUpdate(() => ({ resolution: v as ImageResolution }))}
                      render={(v) => {
                        const c = imageModelId ? formatCredits(estimateCredits(imageModelId, { imageCount: takeCount, resolution: v as ImageResolution })) : null
                        return <span>{v}{c ? ` · ${c}` : ''}</span>
                      }}
                    />
                  )}
                  {aspects.length > 0 && (
                    <ConstraintChip
                      grow
                      openDirection="up"
                      options={aspects}
                      value={cardState.aspectRatio}
                      onChange={(v) => onUpdate(() => ({ aspectRatio: v }))}
                      render={(v) => (
                        <span className="flex items-center gap-1.5">
                          <AspectIcon ratio={v} />
                          <span>{v}</span>
                        </span>
                      )}
                    />
                  )}
                  {/* How many takes of this concept. Three CONCEPTS are three
                      different ideas for the beat; three TAKES are three rolls
                      of the same one, which is the axis this modal was missing. */}
                  <BatchCountStepper
                    grow
                    accent="broll"
                    noun="take"
                    value={takeCount}
                    onChange={setTakeCount}
                    creditsFor={(n) => imageModelId ? estimateCredits(imageModelId, { imageCount: n, resolution: cardState.resolution }) : null}
                  />
                </div>
                <button
                  onClick={() => { for (let i = 0; i < takeCount; i++) onGenerate() }}
                  disabled={!cardState.editablePrompt.trim()}
                  className="flex w-full items-center justify-center gap-2.5 glass-fill glass-fill-soft rounded-full border border-white/15 bg-broll-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] transition-all hover:brightness-110 disabled:hover:brightness-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ImageIcon className="h-4 w-4" />
                  {takeCount === 1 ? 'Generate Image' : `Generate ${takeCount} Images`}
                  {credits && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
                      <Coins className="h-3 w-3" strokeWidth={2} />
                      {credits}
                    </span>
                  )}
                </button>
              </>
            ) : (
              <>
                {/* Video model — its own pick for the standalone animate. The
                    still rides as a start frame or reference depending on what
                    the picked model supports. Sits just above the output chips. */}
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => setAnimateModelPanelOpen(true)}
                    className="flex h-12 w-full items-center gap-2.5 rounded-full border border-ink/10 bg-ink/[0.02] px-3 text-left transition-colors hover:bg-ink/[0.05]"
                  >
                    {animateModel ? (
                      <>
                        <ProviderLogo provider={animateModel.provider ?? ''} />
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-ink-100">{animateModel.displayName}</span>
                          {animateModel.tags.includes('recommended') && (
                            <Star className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400 light:fill-yellow-600 light:text-yellow-600" strokeWidth={1.5} />
                          )}
                          {officialSavingsPercent(animateModelId) != null && <SavingsPill pct={officialSavingsPercent(animateModelId)!} />}
                        </div>
                      </>
                    ) : (
                      <span className="flex-1 truncate text-sm text-ink-400">Select model</span>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
                  </button>
                  <ModelSidePanel
                    appId="broll-studio"
                    task="video"
                    allowedModelIds={CONTINUOUS_MODEL_IDS}
                    requireAnyModes={['image-to-video', 'reference-to-video']}
                    requireModeNote="Greyed-out models can't animate a single still. They take neither a start frame nor reference images."
                    value={animateModelId}
                    onChange={(id) => useSettingsStore.getState().setAppModel('broll-studio:continuous:animate', id)}
                    isOpen={animateModelPanelOpen}
                    onClose={() => setAnimateModelPanelOpen(false)}
                    costParams={{ durationSeconds: cardState.videoDurationSeconds, resolution: cardState.videoResolution, audio: cardState.videoAudio }}
                  />
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  {animateConstraints && (
                    <>
                      <ConstraintChip
                        grow
                        openDirection="up"
                        options={animateConstraints.resolutions}
                        value={cardState.videoResolution}
                        onChange={(v) => onUpdate(() => ({ videoResolution: v }))}
                        render={videoResolutionLabel}
                      />
                      {animateConstraints.durations.length > 0 && (
                        <ConstraintChip
                          grow
                          openDirection="up"
                          options={animateConstraints.durations.map(String)}
                          value={String(cardState.videoDurationSeconds)}
                          onChange={(v) => onUpdate(() => ({ videoDurationSeconds: Number(v) }))}
                          render={(v) => <span>{v}s</span>}
                        />
                      )}
                      {animateConstraints.supportsAudio && (
                        <ConstraintChip
                          grow
                          openDirection="up"
                          options={['Audio', 'Mute']}
                          value={cardState.videoAudio ? 'Audio' : 'Mute'}
                          onChange={(v) => onUpdate(() => ({ videoAudio: v === 'Audio' }))}
                          triggerClassName={cardState.videoAudio
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
                  <BatchCountStepper
                    grow
                    accent="broll"
                    noun="take"
                    value={takeCount}
                    onChange={setTakeCount}
                    creditsFor={animateCreditsFor}
                  />
                </div>
                <button
                  onClick={() => { for (let i = 0; i < takeCount; i++) onAnimate() }}
                  // Not gated on a render in flight — animations queue in
                  // parallel like every other B-Roll generation.
                  disabled={!startImageUrl || !animateCapable}
                  title={!startImageUrl ? 'Generate an image first, then animate it' : !animateCapable ? 'This model can’t animate a single still. Pick another' : undefined}
                  className="flex w-full items-center justify-center gap-2.5 glass-fill glass-fill-soft rounded-full border border-white/15 bg-broll-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] transition-all hover:brightness-110 disabled:hover:brightness-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Film className="h-4 w-4" />
                  {takeCount === 1 ? 'Animate' : `Animate ${takeCount}×`}
                  {animateCredits && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
                      <Coins className="h-3 w-3" strokeWidth={2} />
                      {animateCredits}
                    </span>
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* RIGHT — header + image gallery */}
        <div className="col-span-1 flex min-h-0 flex-col max-md:shrink-0 md:overflow-hidden">
          <div className="flex flex-col gap-3 px-5 pt-3">
            {/* Serif number + a stacked column (concept pill over the quote),
                mirroring the main storyboard rows. h-12 keeps the top bar tight. */}
            <div className="flex h-12 min-w-0 items-center gap-3.5">
              <span
                className="shrink-0 text-4xl font-normal italic tabular-nums leading-none text-ink-700"
                style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
              >
                {String(frameNumber).padStart(2, '0')}
              </span>
              <div className="h-8 w-px shrink-0 bg-ink/10" />
              <div className="flex min-w-0 flex-col gap-1">
                {/* Identity pill, plus the concept's shot class — Enhance and
                    Regenerate are both held to it, so it belongs on screen
                    while the prompt is being edited. */}
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="inline-flex w-fit shrink-0 rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wider text-ink-400">
                    {conceptLabel}
                  </span>
                  {conceptShot && (
                    <span
                      className="inline-flex w-fit shrink-0 rounded-full border border-broll-500/20 bg-broll-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wider text-broll-400"
                      title="This concept's shot class · Enhance and Regenerate keep it"
                    >
                      {conceptShot}
                    </span>
                  )}
                </div>
                <span
                  className="min-w-0 truncate text-[15px] leading-tight text-ink-300"
                  style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
                  title={scriptLine || undefined}
                >
                  {scriptLine ? `“${scriptLine}”` : 'Final frame · the end state the last clip lands on'}
                </span>
              </div>
            </div>
            <div className="-mx-5 -mt-1 border-b border-ink/5" />
          </div>

          <div className="min-h-0 flex-1 px-5 py-4 max-md:flex-none md:overflow-y-auto">
            {frameTab === 'image' ? (
              cardState.images.length === 0 && cardState.inFlightImages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <ImageIcon className="h-9 w-9 text-ink-800" strokeWidth={1.5} />
                  <p className="text-xs text-ink-600">No images yet. Hit Generate, then click one to make it the keyframe.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {cardState.inFlightImages.filter((e) => e.error).map((entry) => (
                    <InFlightFailureRow
                      key={entry.id}
                      error={entry.error}
                      resumable={!!(entry.taskId && entry.modelId)}
                      onRetry={() => onRetryInFlight(entry.id)}
                      onDismiss={() => onDismissInFlight(entry.id)}
                    />
                  ))}
                  <div className="grid grid-cols-2 gap-3">
                    {cardState.inFlightImages.filter((e) => !e.error).map((entry) => (
                      <PendingMediaTile
                        key={entry.id}
                        kind="image"
                        prompt={entry.prompt}
                        modelId={entry.modelId}
                        aspectRatio={entry.aspectRatio}
                        messages={['Sending request...', 'Painting the keyframe...', 'Locking the style...', 'Almost there...']}
                      />
                    ))}
                    {cardState.images.map((image, i) => (
                      <FrameImageTile
                        key={`${image.imageUrl}-${i}`}
                        imageRef={image.imageUrl}
                        prompt={image.prompt}
                        isKeyframe={selectedImageIndex === i}
                        onSelect={() => onSelectImage(i)}
                        onSave={onSaveImage}
                      />
                    ))}
                  </div>
                </div>
              )
            ) : (
              cardState.videos.length === 0 && cardState.inFlightVideos.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <VideoIcon className="h-9 w-9 text-ink-800" strokeWidth={1.5} />
                  <p className="text-xs text-ink-600">No animations yet. Pick a still on the Image tab, then hit Animate.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {cardState.inFlightVideos.filter((e) => e.error).map((entry) => (
                    <InFlightFailureRow
                      key={entry.id}
                      error={entry.error}
                      resumable={!!entry.taskId}
                      onRetry={() => onRetryVideoInFlight(entry.id)}
                      onDismiss={() => onDismissVideoInFlight(entry.id)}
                    />
                  ))}
                  <div className="grid grid-cols-2 gap-3">
                    {cardState.inFlightVideos.filter((e) => !e.error).map((entry) => (
                      <PendingMediaTile
                        key={entry.id}
                        kind="video"
                        prompt={entry.prompt}
                        modelId={entry.modelId}
                        aspectRatio={entry.aspectRatio}
                        messages={['Sending request...', 'Animating the still...', 'Rendering motion...', 'Almost there...']}
                      />
                    ))}
                    {cardState.videos.map((video, i) => (
                      <ClipVideoTile key={`${video.url}-${i}`} video={video} onDelete={() => onDeleteVideo(i)} />
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      <ExpandTextModal
        open={promptExpanded}
        onClose={() => setPromptExpanded(false)}
        value={draft}
        onChange={(v) => { setDraft(v); onUpdate(() => ({ editablePrompt: v })) }}
        title={`${frameLabel} · Keyframe prompt`}
        placeholder="Describe this keyframe…"
        accent="broll"
      />
    </ModalShell>
  )
}

function FrameImageTile({ imageRef, prompt, isKeyframe, onSelect, onSave }: {
  imageRef: string
  prompt: string
  isKeyframe: boolean
  onSelect: () => void
  onSave: (imageRef: string, prompt: string) => Promise<void>
}) {
  const url = useAssetUrl(imageRef)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const resolved = await getUrl(imageRef)
    if (!resolved) { useAppStore.getState().addToast('Could not load the image.', 'error'); return }
    await downloadImage(resolved, 'continuous-keyframe', 'png')
  }
  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (saved || saving) return
    setSaving(true)
    try {
      await onSave(imageRef, prompt)
      setSaved(true)
      useAppStore.getState().addToast('Saved to B-Rolls bank', 'success')
    } catch (err) {
      useAppStore.getState().addToast(humanizeError(err, 'Save failed'), 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div
      onClick={onSelect}
      title={isKeyframe ? 'This is the keyframe' : 'Use as the keyframe'}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border bg-black transition-all ${
        isKeyframe ? 'border-broll-400 ring-2 ring-broll-500/40' : 'border-ink/10 hover:border-ink/25'
      }`}
    >
      {url ? (
        <img src={url} alt="Keyframe option" className="aspect-[9/16] w-full object-cover" />
      ) : (
        <div className="flex aspect-[9/16] w-full items-center justify-center"><Spinner className="h-4 w-4 text-white/40" /></div>
      )}
      {isKeyframe && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-broll-500 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
          <Check className="h-2.5 w-2.5" strokeWidth={3} /> Keyframe
        </span>
      )}
      <div className="pointer-events-none absolute right-1.5 top-1.5 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button type="button" title="Download" onClick={handleDownload} className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"><Download className="h-3.5 w-3.5" /></button>
        <button
          type="button"
          title={saved ? 'Saved to B-Rolls bank' : saving ? 'Saving…' : 'Save to B-Rolls bank'}
          onClick={handleSave}
          className={`pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
            saved ? 'bg-emerald-500/40 text-emerald-100' : 'bg-black/60 text-white hover:bg-black/80'
          }`}
        >
          {saved ? <Check className="h-3.5 w-3.5" /> : saving ? <Spinner className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}

// ── Clip modal — frames-to-video workspace ─────────────────────

interface ContinuousClipModalProps {
  clipLabel: string     // "Clip 2"
  sceneNumber: number   // the scene index, shown as a serif "01" in the header
  scriptLine: string
  style: string
  cardState: ContinuousClipCardState
  modelId: string
  startImageRef?: string
  endImageRef?: string
  onClose: () => void
  onUpdate: (updater: (prev: ContinuousClipCardState) => Partial<ContinuousClipCardState>) => void
  onGenerate: () => void
  // Motion tools — Enhance rewrites the draft richer (text-only); Regenerate
  // writes fresh motion from the ACTUAL rendered keyframes (vision, both ends).
  onEnhanceMotion: () => Promise<string>
  onRegenerateMotion: () => Promise<string>
  // Make a take the clip's cover — what the card face plays and what the
  // download picker pre-ticks for this clip.
  onSelectVideo: (index: number) => void
  onDeleteVideo: (index: number) => void
  onRetryInFlight: (id: string) => void
  onDismissInFlight: (id: string) => void
  // Opens the style popup — the look is session-wide, so a clip modal can
  // change it as readily as the left panel can.
  onChangeStyle?: () => void
}

export function ContinuousClipModal({
  clipLabel,
  sceneNumber,
  scriptLine,
  style,
  onChangeStyle,
  cardState,
  modelId,
  startImageRef,
  endImageRef,
  onClose,
  onUpdate,
  onGenerate,
  onEnhanceMotion,
  onRegenerateMotion,
  onSelectVideo,
  onDeleteVideo,
  onRetryInFlight,
  onDismissInFlight,
}: ContinuousClipModalProps) {
  const [draft, setDraft] = useState(cardState.editablePrompt)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [promptWorking, setPromptWorking] = useState(false)
  // Adjust-during-render sync — same pattern as the frame modal above.
  const [syncedPrompt, setSyncedPrompt] = useState(cardState.editablePrompt)
  if (syncedPrompt !== cardState.editablePrompt) {
    setSyncedPrompt(cardState.editablePrompt)
    setDraft(cardState.editablePrompt)
  }

  const [modelPanelOpen, setModelPanelOpen] = useState(false)

  // ── Motion history (Enhance / Regenerate from frame / Undo / Redo) ──
  // Mirrors the frame modal. Any change here marks the motion user-edited, so the
  // clip stops auto-syncing to keyframe picks and the user's work is preserved.
  const history = cardState.promptHistory.length > 0 ? cardState.promptHistory : [cardState.editablePrompt]
  const historyIndex = Math.max(0, Math.min(cardState.promptHistoryIndex, history.length - 1))
  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1

  const pushHistory = (next: string) => {
    const trimmed = history.slice(0, historyIndex + 1)
    const updated = [...trimmed, next]
    onUpdate(() => ({ editablePrompt: next, promptHistory: updated, promptHistoryIndex: updated.length - 1, motionEdited: true }))
    setDraft(next)
  }
  const commitDraft = () => {
    if (draft === history[historyIndex]) return
    pushHistory(draft)
  }
  const handleUndo = () => {
    if (!canUndo) return
    const i = historyIndex - 1
    onUpdate(() => ({ editablePrompt: history[i], promptHistoryIndex: i, motionEdited: true }))
    setDraft(history[i])
  }
  const handleRedo = () => {
    if (!canRedo) return
    const i = historyIndex + 1
    onUpdate(() => ({ editablePrompt: history[i], promptHistoryIndex: i, motionEdited: true }))
    setDraft(history[i])
  }
  const runPromptTool = async (tool: () => Promise<string>, label: string) => {
    if (promptWorking) return
    setPromptWorking(true)
    try {
      const next = await tool()
      if (next.trim()) pushHistory(next.trim())
    } catch (err) {
      useAppStore.getState().addToast(`${label} failed: ${humanizeError(err, `${label} failed.`)}`, 'error')
    } finally {
      setPromptWorking(false)
    }
  }

  const model = getModel(modelId)
  const constraints = model?.videoConstraints
  const framesReady = !!startImageRef && !!endImageRef
  // Takes of this clip — the same shared count the frame and Line-by-Line
  // modals use. Priced for the whole run: video has no count dimension in the
  // registry, so N clips are N × one, and null stays null.
  const [takeCount, setTakeCount] = usePersistedState<number>('ai-ugc-lab:broll:card-takes', 1, {
    sanitize: (v) => clampBatchCount(v),
  })
  const creditsFor = (n: number) => {
    const one = estimateCredits(modelId, {
      durationSeconds: cardState.durationSeconds,
      resolution: cardState.resolution,
      audio: cardState.audio,
    })
    return one === null ? null : one * n
  }
  const credits = formatCredits(creditsFor(takeCount))

  // Clamp this clip's settings onto the active model's grid whenever the model
  // changes, so the chips never offer something the model can't render.
  const [syncedModel, setSyncedModel] = useState(modelId)
  if (syncedModel !== modelId) {
    setSyncedModel(modelId)
    if (constraints) {
      const updates: Partial<ContinuousClipCardState> = {}
      if (!constraints.resolutions.includes(cardState.resolution)) {
        updates.resolution = constraints.default ?? constraints.resolutions[0]
      }
      const snapped = snapVideoDuration(cardState.durationSeconds, constraints.durations)
      if (snapped !== cardState.durationSeconds) updates.durationSeconds = snapped
      if (Object.keys(updates).length) onUpdate(() => updates)
    }
  }

  return (
    <ModalShell onClose={onClose}>
      {/* One scroller on a phone, two columns on a desktop. Stacked, the two
        halves used to be a pair of ~45dvh scroll windows — the workspace in
        one slot and its own outputs in another, neither tall enough to work
        in. Now the modal is one page: the setup, then what it made. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-2 md:overflow-hidden">
        {/* LEFT — model + endpoints + motion prompt over a pinned Generate footer */}
        <div className="col-span-1 flex min-h-0 flex-col border-b border-ink/5 max-md:shrink-0 md:border-b-0 md:border-r">
          <div className="flex min-h-0 flex-1 flex-col max-md:flex-none md:overflow-y-auto">
            <div className="flex grow flex-col gap-3 px-5 pb-1 pt-3">
              {/* Output-type tab — Continuous clips are videos (frames-to-video
                  between two keyframes). Styled as the Line-by-Line toggle,
                  single option; the h-12 wrapper aligns the separator with the
                  right header so the hairline runs straight across the modal. */}
              <div className="flex h-12 items-center">
                <SegmentedToggle
                  className="h-10 !p-1"
                  value="video"
                  onChange={() => {}}
                  options={[{ value: 'video', label: 'Video', icon: VideoIcon }]}
                />
              </div>
              <div className="-mx-5 -mt-1 border-b border-ink/5" />

              {/* The style note LEADS, as it does in the other two modals — this
                  one opened on its keyframes, so all three B-Roll workspaces
                  started with a different thing. */}
              <StyleNote style={style} onChange={onChangeStyle} />

              {/* Start → end keyframes this clip interpolates between, and the
                  line explaining what's missing, in one card: the two ends ARE a
                  group, and they ARE the gate on Generate. */}
              <SectionCard
                icon={Images}
                title="Keyframes"
                right={(
                  <span className="rounded-full bg-ink/[0.03] px-2 py-0.5 text-[10px] tabular-nums text-ink-500">
                    {(startImageRef ? 1 : 0) + (endImageRef ? 1 : 0)} of 2 picked
                  </span>
                )}
              >
                <div className="flex items-center gap-3">
                  <EndpointThumb label="Start" imageRef={startImageRef} />
                  <ArrowDown className="h-4 w-4 shrink-0 -rotate-90 text-ink-500" />
                  <EndpointThumb label="End" imageRef={endImageRef} />
                </div>
                {!framesReady && (
                  <p className="text-[11px] leading-relaxed text-amber-300 light:text-amber-700">
                    Pick a keyframe for both ends of this clip first. Click an image on each frame card.
                  </p>
                )}
              </SectionCard>

              {/* Motion prompt — how the shot animates from the first frame to
                  the last. Auto-filled from the picked keyframe's own motion.
                  Enhance sharpens it; Regenerate re-reads both rendered frames
                  and rewrites it — on demand, not on every keyframe change. */}
              <div className="flex grow flex-col">
                <div className="relative flex grow flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.03] transition-colors focus-within:border-ink/20 focus-within:bg-ink/[0.05]">
                  <textarea
                    value={draft}
                    onChange={(e) => { setDraft(e.target.value); onUpdate(() => ({ editablePrompt: e.target.value, motionEdited: true })) }}
                    onBlur={commitDraft}
                    rows={8}
                    placeholder="Describe the animation: what moves, how the camera moves, how it comes to rest, and one sound…"
                    className="relative min-h-[160px] w-full grow resize-none border-0 bg-transparent px-3.5 pb-3 pt-3 text-[13px] leading-relaxed text-ink-200 placeholder-ink-600 outline-none"
                  />
                  <PromptToolbar
                    accent="broll"
                    onEnhance={() => void runPromptTool(onEnhanceMotion, 'Enhance')}
                    enhanceTitle="Enhance · same motion, richer detail"
                    enhanceDisabled={!draft.trim()}
                    busy={promptWorking}
                    onRegenerate={() => void runPromptTool(onRegenerateMotion, 'Regenerate')}
                    // The one place the label carries more than the verb: this
                    // Regenerate re-reads the rendered keyframes, and how many it
                    // can see changes what comes back.
                    regenerateLabel={framesReady ? 'From frames' : 'From frame'}
                    regenerateTitle={
                      !startImageRef
                        ? 'Pick a start keyframe first'
                        : framesReady
                          ? 'Rewrite the motion by reading both chosen keyframes'
                          : 'Rewrite the motion from the chosen start keyframe (pick an end keyframe to read both)'
                    }
                    regenerateDisabled={!startImageRef}
                    onUndo={handleUndo}
                    canUndo={canUndo}
                    onRedo={handleRedo}
                    canRedo={canRedo}
                    onExpand={() => setPromptExpanded(true)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 px-5 pb-4 pt-2">
            {/* Video model — sits directly above the output pills it configures
                (frames-to-video capable models only). */}
            <button
              type="button"
              onClick={() => setModelPanelOpen(true)}
              className="mb-3 flex h-12 w-full items-center gap-2.5 rounded-full border border-ink/10 bg-ink/[0.02] px-3 text-left transition-colors hover:bg-ink/[0.05]"
            >
              {model ? (
                <>
                  <ProviderLogo provider={model.provider ?? ''} />
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-ink-100">{model.displayName}</span>
                    {model.tags.includes('recommended') && (
                      <Star className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400 light:fill-yellow-600 light:text-yellow-600" strokeWidth={1.5} />
                    )}
                    {officialSavingsPercent(modelId) != null && <SavingsPill pct={officialSavingsPercent(modelId)!} />}
                  </div>
                </>
              ) : (
                <span className="flex-1 truncate text-sm text-ink-400">Select model</span>
              )}
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
            </button>
            <ModelSidePanel
              appId="broll-studio"
              task="video"
              allowedModelIds={CONTINUOUS_MODEL_IDS}
              value={modelId}
              onChange={(id) => useSettingsStore.getState().setAppModel('broll-studio:continuous:video', id)}
              isOpen={modelPanelOpen}
              onClose={() => setModelPanelOpen(false)}
              requireMode="frames-to-video"
              requireModeNote="Continuous clips interpolate between two keyframes, so only frame-to-frame models are offered."
              costParams={{
                durationSeconds: cardState.durationSeconds,
                resolution: cardState.resolution,
                audio: cardState.audio,
              }}
            />
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {constraints && (
                <>
                  <ConstraintChip
                    grow
                    openDirection="up"
                    options={constraints.resolutions}
                    value={cardState.resolution}
                    onChange={(v) => onUpdate(() => ({ resolution: v }))}
                    render={videoResolutionLabel}
                  />
                  {constraints.durations.length > 0 && (
                    <ConstraintChip
                      grow
                      openDirection="up"
                      options={constraints.durations.map(String)}
                      value={String(cardState.durationSeconds)}
                      onChange={(v) => onUpdate(() => ({ durationSeconds: Number(v) }))}
                      render={(v) => <span>{v}s</span>}
                    />
                  )}
                  {(constraints.supportsAudio ?? false) && (
                    <ConstraintChip
                      grow
                      openDirection="up"
                      options={['Audio', 'Mute']}
                      value={cardState.audio ? 'Audio' : 'Mute'}
                      onChange={(v) => onUpdate(() => ({ audio: v === 'Audio' }))}
                      triggerClassName={cardState.audio
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
              <BatchCountStepper
                grow
                accent="broll"
                noun="take"
                value={takeCount}
                onChange={setTakeCount}
                creditsFor={creditsFor}
              />
            </div>
            <button
              onClick={() => { for (let i = 0; i < takeCount; i++) onGenerate() }}
              // Not gated on a render in flight — clips queue in parallel.
              disabled={!framesReady || !cardState.editablePrompt.trim()}
              className="flex w-full items-center justify-center gap-2.5 glass-fill glass-fill-soft rounded-full border border-white/15 bg-broll-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] transition-all hover:brightness-110 disabled:hover:brightness-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <VideoIcon className="h-4 w-4" />
              {takeCount === 1 ? 'Generate Video' : `Generate ${takeCount} Videos`}
              {credits && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
                  <Coins className="h-3 w-3" strokeWidth={2} />
                  {credits}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* RIGHT — header + video gallery */}
        <div className="col-span-1 flex min-h-0 flex-col max-md:shrink-0 md:overflow-hidden">
          <div className="flex flex-col gap-3 px-5 pt-3">
            {/* Serif scene number + a stacked column (Clip pill over the quote),
                matching the frame modal and the main storyboard rows. */}
            <div className="flex h-12 min-w-0 items-center gap-3.5">
              <span
                className="shrink-0 text-4xl font-normal italic tabular-nums leading-none text-ink-700"
                style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
              >
                {String(sceneNumber).padStart(2, '0')}
              </span>
              <div className="h-8 w-px shrink-0 bg-ink/10" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="inline-flex w-fit rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wider text-ink-400">
                  {clipLabel}
                </span>
                <span
                  className="min-w-0 truncate text-[15px] leading-tight text-ink-300"
                  style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
                  title={scriptLine}
                >
                  &ldquo;{scriptLine}&rdquo;
                </span>
              </div>
            </div>
            <div className="-mx-5 -mt-1 border-b border-ink/5" />
          </div>

          <div className="min-h-0 flex-1 px-5 py-4 max-md:flex-none md:overflow-y-auto">
            {cardState.videos.length === 0 && cardState.inFlightVideos.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <VideoIcon className="h-9 w-9 text-ink-800" strokeWidth={1.5} />
                <p className="text-xs text-ink-600">No videos yet. Hit Generate to animate between the keyframes.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {cardState.inFlightVideos.filter((e) => e.error).map((entry) => (
                  <InFlightFailureRow
                    key={entry.id}
                    error={entry.error}
                    resumable={!!entry.taskId}
                    onRetry={() => onRetryInFlight(entry.id)}
                    onDismiss={() => onDismissInFlight(entry.id)}
                  />
                ))}
                <div className="grid grid-cols-2 gap-3">
                  {cardState.inFlightVideos.filter((e) => !e.error).map((entry) => (
                    <PendingMediaTile
                      key={entry.id}
                      kind="video"
                      prompt={entry.prompt}
                      modelId={entry.modelId}
                      aspectRatio={entry.aspectRatio}
                      messages={['Sending request...', 'Interpolating frames...', 'Rendering motion...', 'Finalizing the clip...']}
                    />
                  ))}
                  {cardState.videos.map((video, i) => (
                    <ClipVideoTile
                      key={`${video.url}-${i}`}
                      video={video}
                      selected={i === Math.min(cardState.currentVideoIndex, cardState.videos.length - 1)}
                      onSelect={() => onSelectVideo(i)}
                      onDelete={() => onDeleteVideo(i)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ExpandTextModal
        open={promptExpanded}
        onClose={() => setPromptExpanded(false)}
        value={draft}
        onChange={(v) => { setDraft(v); onUpdate(() => ({ editablePrompt: v, motionEdited: true })) }}
        title={`${clipLabel} · Motion prompt`}
        placeholder="Describe how the start frame moves, never the end frame…"
        accent="broll"
      />
    </ModalShell>
  )
}

function EndpointThumb({ label, imageRef }: { label: string; imageRef?: string }) {
  const url = useAssetUrl(imageRef ?? '')
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl border border-ink/10 bg-ink/[0.02] p-2">
      {/* The dot rides at the row's own left edge, before the thumbnail, so the
          two endpoints stack into one column you can read without the words.
          Required: an unpicked end is exactly why Generate is grey. */}
      <StatusDot filled={!!imageRef} required />
      {imageRef && url ? (
        <img src={url} alt={label} className="h-14 w-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-14 w-9 shrink-0 items-center justify-center rounded-lg bg-ink/[0.05]">
          <ImageIcon className="h-3.5 w-3.5 text-ink-600" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wider text-ink-500">{label}</p>
        <p className="truncate text-[11px] text-ink-400">{imageRef ? 'Keyframe picked' : 'Not picked yet'}</p>
      </div>
    </div>
  )
}

// One take in a video gallery. In the CLIP modal, clicking it makes that take
// the clip's COVER — what the card face plays, what the card's Download button
// saves, and what the download picker pre-ticks (parity with Line-by-Line's
// VideoTile, which has had cover selection all along). The frame modal's
// Animate tab reuses this tile for standalone animations of a keyframe, where
// nothing consumes a cover — it omits `onSelect` and gets a plain tile.
function ClipVideoTile({
  video,
  selected = false,
  onSelect,
  onDelete,
}: {
  video: GeneratedVideo
  selected?: boolean
  onSelect?: () => void
  onDelete: () => void
}) {
  const url = useAssetUrl(video.url)
  const [copied, setCopied] = useState(false)
  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const resolved = await getUrl(video.url)
    if (!resolved) { useAppStore.getState().addToast('Could not load the video.', 'error'); return }
    await downloadImage(resolved, 'continuous-clip', 'mp4')
  }
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (await copyToClipboard(video.prompt)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }
  }
  return (
    <ModalVideoPlayer
      url={url}
      onClick={onSelect}
      className={selected ? 'border-broll-500/70 ring-2 ring-broll-500/40' : onSelect ? 'border-ink/10 hover:border-ink/30' : 'border-ink/10'}
      actions={
        <div className="pointer-events-none absolute right-1.5 top-1.5 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" title="Download" onClick={handleDownload} className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"><Download className="h-3.5 w-3.5" /></button>
          <button type="button" title="Copy prompt" onClick={handleCopy} className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</button>
          {url && (
            <ExpandVideoButton
              chrome="plain"
              videoUrl={url}
              prompt={video.prompt}
              fileStem="continuous-clip"
              aspectRatio={video.aspectRatio}
            />
          )}
          <button type="button" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete() }} className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-red-500/80"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      }
    >
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-medium tabular-nums text-white backdrop-blur-sm">{video.durationSeconds}s</span>
      {selected && (
        <span className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-broll-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur">
          Cover
        </span>
      )}
    </ModalVideoPlayer>
  )
}
