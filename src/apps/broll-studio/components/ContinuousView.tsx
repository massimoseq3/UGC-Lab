import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Box, AlertCircle, Sparkles, Image as ImageIcon, Video as VideoIcon, Play, Pause, Volume2, VolumeX, Plus, Coins, Check, X, ArrowRight, Download, Copy, Bookmark, Film, ChevronRight, Star, Link2, Link2Off, RefreshCw, Pencil, SplitSquareVertical, Merge, Trash2, Palette,
} from 'lucide-react'
import Spinner from '../../../components/Spinner'
import GenerationProgress from '../../../components/GenerationProgress'
import { GeneratingMediaFill } from '../../../components/GeneratingMedia'
import { KEYFRAME_MESSAGES, INTERPOLATE_MESSAGES } from '../../../components/generatingMessages'
import ModelPicker from '../../../components/ModelPicker'
import ModelPickerModal from '../../../components/ModelPickerModal'
import ProviderLogo from '../../../components/ProviderLogo'
import SavingsPill from '../../../components/SavingsPill'
import ConstraintChip from '../../../components/ConstraintChip'
import AspectIcon from '../../../components/AspectIcon'
import { ContinuousFrameModal, ContinuousClipModal } from './ContinuousDetailModals'
import type {
  ContinuousResult,
  ContinuousConcept,
  ContinuousFrame,
  ContinuousScene,
  ContinuousSelection,
  ContinuousFrameCardState,
  ContinuousClipCardState,
  GeneratedImage,
  GeneratedVideo,
  ReferenceImage,
} from '../types'
import type { Product, Model, VideoHistoryItem, BRoll } from '../../../stores/types'
import { createDefaultContinuousFrameState, createDefaultContinuousClipState } from '../cardState'
import { startImageTask, finishImageTask, resolveImageModelId } from '../services/generateBroll'
import { attachProductAngles, countProductAngles, productRefsForSelection } from '../services/productAngles'
import { startVideoTask, finishVideoTask } from '../services/generateVideo'
import { claimTask, releaseTask } from '../services/taskRegistry'
import { useReconnectTick } from '../../../hooks/useReconnectTick'
import {
  buildContinuousPrompt,
  buildContinuousPreamble,
  getContinuousStyle,
  frameContextFor,
  enhanceContinuousFrame,
  regenerateContinuousFrame,
  enhanceContinuousMotion,
  regenerateContinuousMotion,
  CONTINUOUS_DEFAULT_MODEL_ID,
  CONTINUOUS_MODEL_IDS,
} from '../services/generateContinuous'
import { isPollTimeout } from '../../../utils/kie'
import { useBankStore } from '../../../stores/bankStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useAppStore } from '../../../stores/appStore'
import { useCreditsStore } from '../../../stores/creditsStore'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import { useInlineVideo } from '../../../hooks/useInlineVideo'
import { TileActionStack, TileActionButton } from '../../../components/tileActions'
import ModelPill from '../../../components/ModelPill'
import { ExpandVideoButton } from '../../../components/VideoLightbox'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { getAsBase64, getUrl, isAssetRef } from '../../../utils/assetStore'
import { getModel, getDefaultModel, snapVideoDurationUp, estimateCredits, formatCredits, officialSavingsPercent, type VideoMode, type ImageResolution } from '../../../utils/models'
import { humanizeError } from '../../../utils/friendlyError'
import { downloadImage } from '../../../utils/downloadImage'
import ClipDownloadModal, { type ClipDownloadEntry } from '../../../components/ClipDownloadModal'
import { copyToClipboard } from '../../../utils/clipboard'
import { sendClipToPlayground } from '../services/sendClipToPlayground'
import type { ContinuousStoryboardOp } from '../continuousEdits'
import { useBackdropClose } from '../../../hooks/useBackdropClose'

// Every clip is silent narration-wise — the voiceover and music land in the
// edit. Appended to the motion prompt at fire time so hand-edits can't drop it.
const CLIP_AUDIO_RULE = 'No dialogue, no narration, no music. Only the named sound effect and natural ambience.'

function frameKey(frameIndex: number, conceptId: string): string {
  return `${frameIndex}:${conceptId}`
}
function clipKey(sceneIndex: number): string {
  return `c${sceneIndex}`
}

interface ContinuousViewProps {
  result: ContinuousResult | null
  isGenerating?: boolean
  error?: string | null
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
  productPhotos?: string[]
  onChangeStyle?: () => void
  selectedModel?: Model | null
  selectedProduct?: Product | null
  // Plain-text context strings — ground the per-frame Enhance / Regenerate.
  productContext?: string
  modelContext?: string
  continuousModelId: string
  frameStates: Record<string, ContinuousFrameCardState>
  setFrameStates: React.Dispatch<React.SetStateAction<Record<string, ContinuousFrameCardState>>>
  clipStates: Record<string, ContinuousClipCardState>
  setClipStates: React.Dispatch<React.SetStateAction<Record<string, ContinuousClipCardState>>>
  selections: Record<string, ContinuousSelection>
  setSelections: React.Dispatch<React.SetStateAction<Record<string, ContinuousSelection>>>
  // Appends one fresh concept to a frame (BrollStudio owns the result state).
  onAddConcept: (frameIndex: number) => void
  // Structural storyboard edits — retype / split / merge / delete a scene.
  // Applied in BrollStudio because they reindex the frame, clip and selection
  // maps together.
  onEditStoryboard: (op: ContinuousStoryboardOp) => void
}

// Right-panel view for Continuous mode: one row per scene (its keyframe's
// concept cards + the clip card that animates into the next keyframe), plus a
// final-frame row. Image chain: generating frame N attaches frame N-1's chosen
// keyframe as a continuity reference; the clips are frames-to-video between
// the two chosen keyframes, so the cuts are invisible.
export default function ContinuousView({
  result,
  isGenerating,
  error,
  characterRef,
  productRef,
  productPhotos,
  onChangeStyle,
  selectedModel,
  selectedProduct,
  productContext,
  modelContext,
  continuousModelId,
  frameStates,
  setFrameStates,
  clipStates,
  setClipStates,
  selections,
  setSelections,
  onAddConcept,
  onEditStoryboard,
}: ContinuousViewProps) {
  // Open modal: a frame concept ("3:cont-xxx") or a clip ("c2").
  const [openFrameKey, setOpenFrameKey] = useState<string | null>(null)
  const [openClipKey, setOpenClipKey] = useState<string | null>(null)
  // Scene index whose edit dialog is open (retype / split / merge / delete).
  const [editingScene, setEditingScene] = useState<number | null>(null)
  // Extra user-attached reference images per frame card (memory-only, like the
  // Line-by-Line card's extraRefs — data: URIs are too big to persist).
  const [extraRefs, setExtraRefs] = useState<Record<string, ReferenceImage[]>>({})
  // Pending generate request awaiting cost confirmation.
  const [confirmGen, setConfirmGen] = useState<
    | { kind: 'clips'; sceneIndices: number[]; scope: string }
    | { kind: 'frames'; fresh: number[]; done: number[] }
    | null
  >(null)
  const confirmBackdrop = useBackdropClose(() => setConfirmGen(null))
  // Frames branch only: opt into regenerating frames that already have a picked
  // keyframe (mirrors Line-by-Line's "also regenerate" toggle).
  const [includeExisting, setIncludeExisting] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  // Video-model picker opened from inside the batch-generate dialog.
  const [confirmModelPanelOpen, setConfirmModelPanelOpen] = useState(false)
  const balance = useCreditsStore((s) => s.balance)
  useCloseOnAppSwitch(!!confirmGen, () => setConfirmGen(null))
  useCloseOnEscape(!!confirmGen, () => setConfirmGen(null))

  // Keyframes are images, so the frame-batch confirm dialog mirrors Line-by-
  // Line's "Generate images" dialog: the shared B-Roll image model plus a
  // resolution + aspect chosen for the whole run, priced against the balance.
  const frameImageModelId =
    useSettingsStore((s) => s.perAppModel['broll-studio:image:text-to-image']) ??
    getDefaultModel('broll-studio', 'image', 'text-to-image')?.id
  const [framesResolution, setFramesResolution] = useState<ImageResolution | undefined>(undefined)
  const [framesAspect, setFramesAspect] = useState<string | undefined>(undefined)

  // Standalone-Animate video model — its own pick (separate from the clip's
  // frames-to-video model, since animating a single still is image-to-video or
  // reference-to-video). Defaults to the clip model, Seedance 1.5 Pro: it does
  // image-to-video (not reference-to-video), which is the branch runFrameAnimate
  // prefers anyway, so one still animates from the chosen keyframe directly.
  const continuousAnimateModelId = useSettingsStore((s) => s.perAppModel['broll-studio:continuous:animate']) ?? CONTINUOUS_DEFAULT_MODEL_ID

  // Fresh reads inside async chains (the sequential frame walk sets a
  // selection, then the next iteration must see it).
  const selectionsRef = useRef(selections)
  useEffect(() => { selectionsRef.current = selections }, [selections])
  const frameStatesRef = useRef(frameStates)
  useEffect(() => { frameStatesRef.current = frameStates }, [frameStates])

  // Seed card state for every concept + clip when a result lands (history
  // restore included). Existing entries win — they hold edits and outputs.
  useEffect(() => {
    if (!result) return
    setFrameStates((prev) => {
      const next: Record<string, ContinuousFrameCardState> = {}
      for (const frame of result.frames) {
        // Frame N opens scene N (the final frame opens none), so that scene's
        // product visibility is this frame's — the fallback for concepts the
        // storyboard gave no refs of its own.
        const productVisible = result.scenes.find((s) => s.index === frame.index)?.productVisible
        for (const concept of frame.concepts) {
          const key = frameKey(frame.index, concept.id)
          next[key] = prev[key] ?? createDefaultContinuousFrameState(concept, { productVisible })
        }
      }
      return next
    })
    setClipStates((prev) => {
      const next: Record<string, ContinuousClipCardState> = {}
      for (const scene of result.scenes) {
        const key = clipKey(scene.index)
        next[key] = prev[key] ?? createDefaultContinuousClipState(scene, result.modelId)
      }
      return next
    })
  }, [result, setFrameStates, setClipStates])

  const updateFrame = (key: string, updater: (prev: ContinuousFrameCardState) => Partial<ContinuousFrameCardState>) => {
    setFrameStates((prev) => {
      const existing = prev[key]
      if (!existing) return prev
      return { ...prev, [key]: { ...existing, ...updater(existing) } }
    })
  }
  const updateClip = (key: string, updater: (prev: ContinuousClipCardState) => Partial<ContinuousClipCardState>) => {
    setClipStates((prev) => {
      const existing = prev[key]
      if (!existing) return prev
      return { ...prev, [key]: { ...existing, ...updater(existing) } }
    })
  }

  // ── Row-level chain control ──────────────────────────────────
  // The chain (frame N generating with frame N-1's picked keyframe attached) is
  // what holds the look together, so it stays on by default. But when the user
  // wants a genuinely different shot of the same moment, the previous frame is
  // the enemy: every concept anchors to it and the three "variations" come back
  // as three near-copies. Per-concept toggles exist in the frame modal; this
  // flips the whole frame at once, next to the button that actually fires it.
  const frameChainOn = (frame: ContinuousFrame): boolean =>
    frame.concepts.every((c) => frameStates[frameKey(frame.index, c.id)]?.chainLink !== false)

  const toggleFrameChain = (frame: ContinuousFrame) => {
    const on = !frameChainOn(frame)
    setFrameStates((prev) => {
      const next = { ...prev }
      for (const c of frame.concepts) {
        const key = frameKey(frame.index, c.id)
        if (next[key]) next[key] = { ...next[key], chainLink: on }
      }
      return next
    })
  }

  // Motion-tool context for a clip: its narration line, where the story goes
  // next, and the clip's real length (motion
  // that finishes early leaves the model idling, and an idling model jumps).
  const motionContextFor = (sceneIndex: number) => {
    const scene = result?.scenes.find((s) => s.index === sceneIndex)
    return {
      scriptLine: scene?.scriptLine ?? '',
      nextScriptLine: result?.scenes.find((s) => s.index === sceneIndex + 1)?.scriptLine,
      durationSeconds: clipStates[clipKey(sceneIndex)]?.durationSeconds ?? scene?.durationSeconds,
    }
  }

  // Vision rewrite from the clip's ACTUAL rendered endpoints — both frames when
  // the end keyframe is picked, which is what lets the model describe a path
  // that reaches it instead of a departure that snaps.
  const regenerateMotionFromFrame = async (sceneIndex: number): Promise<string> => {
    const startRef = keyframeRef(sceneIndex)
    if (!startRef) throw new Error('Pick a start keyframe for this clip first.')
    const endRef = keyframeRef(sceneIndex + 1)
    const [start, end] = await Promise.all([toDataUri(startRef), endRef ? toDataUri(endRef) : null])
    if (!start) throw new Error('Could not load the start keyframe image.')
    return regenerateContinuousMotion({ start, end: end ?? undefined }, motionContextFor(sceneIndex))
  }

  const guardDemo = (): boolean => {
    if (result?.demo) {
      useAppStore.getState().addToast('This is a sample storyboard. Add your kie.ai key in Settings to generate', 'info')
      return true
    }
    return false
  }

  const lookupKeyframe = (
    frameIndex: number,
    sels: Record<string, ContinuousSelection>,
    states: Record<string, ContinuousFrameCardState>,
  ): string | undefined => {
    const sel = sels[String(frameIndex)]
    if (!sel) return undefined
    return states[frameKey(frameIndex, sel.conceptId)]?.images[sel.imageIndex]?.imageUrl
  }

  // The chosen keyframe image ref for a frame slot, read through the refs.
  // ONLY for async chains — the sequential frame walk sets a selection and the
  // next iteration must see it before React has re-rendered.
  const keyframeRef = (frameIndex: number): string | undefined =>
    lookupKeyframe(frameIndex, selectionsRef.current, frameStatesRef.current)

  // Render-time version. The refs above are synced in effects, so during the
  // render that a pick triggers they still hold the PREVIOUS values — reading
  // them here left "Generate all videos" one pick behind (picking the final
  // frame last would leave the last clip out of the batch, or the button
  // disabled while the clip card beside it already read "Keyframes ready").
  const keyframeRefLive = (frameIndex: number): string | undefined =>
    lookupKeyframe(frameIndex, selections, frameStates)

  // The aspect a frame's keyframe images were actually generated at. Clips must
  // follow it: the frame modal offers the image model's full aspect list, so a
  // storyboard shot 16:9 used to be animated into a hardcoded 9:16 canvas, and
  // the fixed first/last frames arrived cropped or letterboxed — discovered
  // only after the video credits were spent.
  const keyframeAspect = (frameIndex: number): string => {
    const sel = selectionsRef.current[String(frameIndex)]
    if (!sel) return '9:16'
    return frameStatesRef.current[frameKey(frameIndex, sel.conceptId)]?.aspectRatio ?? '9:16'
  }

  const toDataUri = async (ref: string): Promise<string | null> => {
    if (!isAssetRef(ref)) return ref
    const asset = await getAsBase64(ref)
    if (!asset) return null
    return `data:${asset.mimeType};base64,${asset.base64}`
  }

  // ── Clip motion: seeded from the picked keyframe ─────────────
  // The storyboard writes a motion per concept, so picking a keyframe on frame N
  // drops that staging's own motion into clip N and the card is never empty.
  //
  // There used to be a second stage here: once both endpoints were picked, a
  // two-image vision pass rewrote the motion from the two ACTUAL rendered frames,
  // and re-picking either end re-ran it. It was removed deliberately — every
  // keyframe change kicked off an LLM round-trip, which made picking slow and
  // made the motion feel like it was fighting the user. The same pass is still
  // one click away as "Regenerate from frames" in the clip modal, which is where
  // it belongs: on demand, for the clip that actually needs it.
  //
  // The seed stands down the moment the user hand-edits the motion.
  useEffect(() => {
    if (!result) return
    setClipStates((prev) => {
      let changed = false
      const next = { ...prev }
      for (const scene of result.scenes) {
        const key = clipKey(scene.index)
        const clip = next[key]
        if (!clip || clip.motionEdited) continue
        const sel = selections[String(scene.index)]
        if (!sel) continue
        const concept = result.frames
          .find((f) => f.index === scene.index)?.concepts
          .find((c) => c.id === sel.conceptId)
        const motion = concept?.motionPrompt?.trim()
        if (!motion || motion === clip.editablePrompt.trim()) continue
        next[key] = { ...clip, editablePrompt: motion, promptHistory: [motion], promptHistoryIndex: 0 }
        changed = true
      }
      return changed ? next : prev
    })
  }, [result, selections, setClipStates])

  // ── Keyframe image generation ────────────────────────────────
  // Resolves to the new image's index in the card's images[], or null if
  // nothing rendered. The index matters to the batch runner: it picks the
  // keyframe deterministically afterwards rather than letting whichever
  // parallel generation finished first win.
  const runFrameImage = async (
    key: string,
    override?: { aspectRatio: string; resolution: ImageResolution },
    repick = false,
    // The batch runner picks for the whole frame once its concepts have all
    // landed, so it suppresses the per-image auto-pick.
    opts?: { autoPick?: boolean },
  ): Promise<number | null> => {
    if (!result || guardDemo()) return null
    const card = frameStatesRef.current[key]
    if (!card) return null
    if (!card.editablePrompt.trim()) {
      useAppStore.getState().addToast('Write or generate a prompt for this concept first.', 'info')
      return null
    }
    const frameIndex = Number(key.split(':')[0])
    // Batch runs choose one resolution/aspect for the whole chain; a single-card
    // generate (from the modal) passes no override and keeps the card's own.
    const aspectRatio = override?.aspectRatio ?? card.aspectRatio
    const resolution = override?.resolution ?? card.resolution

    // Chain reference: the previous frame's chosen keyframe. First in the ref
    // list so the preamble's "FIRST attached image" clause holds.
    const chainRefUrl = card.chainLink && frameIndex > 1 ? keyframeRef(frameIndex - 1) : undefined
    // Generating a middle frame before the one it chains from is allowed (the
    // per-row button only disables once THIS frame is picked), but it silently
    // loses the character/style lock — say so, since the drift only becomes
    // visible once the image lands.
    if (card.chainLink && frameIndex > 1 && !chainRefUrl) {
      useAppStore.getState().addToast(
        `No keyframe picked for Frame ${frameIndex - 1} yet. Generating Frame ${frameIndex} without the continuity reference.`,
        'info',
      )
    }
    const cardExtras = extraRefs[key] ?? []
    const productOn = !!(card.refsProduct && productRef)
    // The photos this frame's staging needs: the storyboard named the state
    // (sealed / unwrapped / open box) and the member can re-tick it in the
    // frame modal. First pick is THE product reference; any others ride behind.
    const picked = productRefsForSelection(productPhotos ?? [], card.productPhotos)
    const refs: ReferenceImage[] = attachProductAngles({
      manual: [
        ...(chainRefUrl ? [{ dataUrl: chainRefUrl, label: 'style' }] : []),
        ...(card.refsCharacter && characterRef ? [characterRef] : []),
        ...(productOn && picked.product ? [picked.product] : []),
        ...cardExtras,
      ],
      angles: productOn ? picked.angles : [],
      modelId: resolveImageModelId(true),
    })
    // A product exists in the bank but this frame is not attaching it — the
    // beat criticises the category, so the preamble has to name the exclusion
    // out loud. Otherwise a chained previous keyframe carries the real
    // packaging back in through the side door.
    const productExcluded = !!productRef && !card.refsProduct
    const preamble = refs.length > 0
      ? buildContinuousPreamble({
          chain: !!chainRefUrl,
          character: !!(card.refsCharacter && characterRef),
          product: productOn,
          productAngles: countProductAngles(refs),
          extras: cardExtras.length,
          productExcluded,
        })
      : undefined
    const promptText = buildContinuousPrompt(card.editablePrompt, result.style)

    const inFlightId = crypto.randomUUID()
    updateFrame(key, (prev) => ({
      inFlightImages: [
        ...prev.inFlightImages,
        { id: inFlightId, taskId: null, modelId: null, startedAt: Date.now(), prompt: promptText, aspectRatio, resolution },
      ],
    }))

    let taskId: string
    let modelId: string
    try {
      // noRealism unless the storyboard is the UGC Realism style — that's the
      // one look that wants the app's iPhone-realism stack kept on.
      const started = await startImageTask(promptText, refs.length > 0 ? refs : undefined, aspectRatio, resolution, {
        noRealism: !result.realism,
        preambleOverride: preamble,
      })
      taskId = started.taskId
      modelId = started.modelId
      updateFrame(key, (prev) => ({
        inFlightImages: prev.inFlightImages.map((e) => (e.id === inFlightId ? { ...e, taskId, modelId } : e)),
      }))
    } catch (err) {
      const msg = humanizeError(err, 'Image generation failed. Try again.')
      updateFrame(key, (prev) => ({
        inFlightImages: prev.inFlightImages.map((e) => (e.id === inFlightId ? { ...e, error: msg } : e)),
      }))
      useAppStore.getState().addToast(msg, 'error')
      return null
    }

    // Own this poll before the taskId is persisted — see taskRegistry.
    if (!claimTask('image', taskId)) return null
    try {
      const imageUrl = await finishImageTask(taskId, modelId, resolution)
      const newImage: GeneratedImage = { imageUrl, prompt: promptText, modelId, createdAt: Date.now() }
      let newIndex = 0
      updateFrame(key, (prev) => {
        const newImages = [...prev.images, newImage]
        newIndex = newImages.length - 1
        return { images: newImages, currentImageIndex: newIndex, inFlightImages: prev.inFlightImages.filter((e) => e.id !== inFlightId) }
      })
      // Auto-pick the first image a frame produces as its keyframe — the user
      // can always click a different one. `repick` (a regenerate of an already-
      // picked frame) moves the keyframe onto the freshly generated image.
      // Suppressed for batch runs, which pick once all of a frame's concepts
      // have landed so the choice isn't a race between parallel generations.
      if (opts?.autoPick !== false) {
        setSelections((prev) => {
          if (!repick && prev[String(frameIndex)]) return prev
          return { ...prev, [String(frameIndex)]: { conceptId: key.slice(key.indexOf(':') + 1), imageIndex: newIndex } }
        })
      }
      return newIndex
    } catch (err) {
      const msg = humanizeError(err, 'Image generation failed. Try again.')
      updateFrame(key, (prev) => ({
        inFlightImages: prev.inFlightImages.map((e) => (e.id === inFlightId ? { ...e, error: msg } : e)),
      }))
      useAppStore.getState().addToast(msg, 'error')
      return null
    } finally {
      releaseTask('image', taskId)
    }
  }

  // Batch keyframe generate. Skips frames that already have a picked keyframe.
  const [chainRunning, setChainRunning] = useState(false)
  // Where a SEQUENTIAL walk has got to. Only meaningful when frames are chained
  // (each waits on the previous one's chosen image); a parallel run leaves it
  // null because there is no meaningful "step N of M".
  const [chainAt, setChainAt] = useState<{ step: number; of: number } | null>(null)

  // Concepts of a frame that a batch run would actually fire — every one with a
  // prompt written. The batch used to render `concepts[0]` only, which left the
  // other two cards as plain text and auto-picked the keyframe for the user:
  // the mode's whole pick-a-concept step never actually happened unless you
  // opened each card by hand.
  const batchConceptsFor = (frameIndex: number): ContinuousConcept[] => {
    const frame = result?.frames.find((f) => f.index === frameIndex)
    if (!frame) return []
    return frame.concepts.filter((c) => frameStatesRef.current[frameKey(frameIndex, c.id)]?.editablePrompt.trim())
  }

  // One frame's share of the batch: all of its concepts in parallel, then ONE
  // deterministic pick. Returns false only on a real generation failure — a
  // skip (already picked, or an existing image just needs selecting) counts as
  // success.
  const runOneFrameOfBatch = async (
    frameIndex: number,
    override?: { aspectRatio: string; resolution: ImageResolution },
    includeExisting = false,
  ): Promise<boolean> => {
    const frame = result?.frames.find((f) => f.index === frameIndex)
    if (!frame || frame.concepts.length === 0) return true
    const picked = selectionsRef.current[String(frameIndex)]
    if (picked && !includeExisting) return true

    // Nothing rendered yet but an image is already sitting there (a hand-run
    // concept): just select it rather than re-billing the frame.
    if (!picked) {
      const withImage = frame.concepts.find((c) => (frameStatesRef.current[frameKey(frameIndex, c.id)]?.images.length ?? 0) > 0)
      if (withImage) {
        const card = frameStatesRef.current[frameKey(frameIndex, withImage.id)]!
        setSelections((prev) => ({ ...prev, [String(frameIndex)]: { conceptId: withImage.id, imageIndex: card.currentImageIndex } }))
        return true
      }
    }

    const targets = batchConceptsFor(frameIndex)
    if (targets.length === 0) return true
    const indices = await Promise.all(
      targets.map((c) => runFrameImage(frameKey(frameIndex, c.id), override, false, { autoPick: false })),
    )
    const landed = targets
      .map((c, i) => ({ conceptId: c.id, imageIndex: indices[i] }))
      .filter((e): e is { conceptId: string; imageIndex: number } => e.imageIndex !== null)
    if (landed.length === 0) return false

    // Keep the user's own concept choice across a regenerate; otherwise take the
    // leftmost concept that rendered. Never "whichever finished first".
    const keep = picked ? landed.find((e) => e.conceptId === picked.conceptId) : undefined
    const chosen = keep ?? landed[0]
    setSelections((prev) => ({ ...prev, [String(frameIndex)]: chosen }))
    return true
  }

  const runAllFrames = async (
    frameIndices: number[],
    override?: { aspectRatio: string; resolution: ImageResolution },
    includeExisting = false,
  ) => {
    if (!result || chainRunning) return
    const ordered = [...frameIndices].sort((a, b) => a - b)
    // Sequencing only buys something when a frame in the batch actually
    // references the previous keyframe. Chaining is off by default now, so the
    // common case is a plain parallel fan-out — a six-frame storyboard renders
    // in one image-generation's time instead of six.
    const anyChained = ordered.some((i) => {
      const frame = result.frames.find((f) => f.index === i)
      return !!frame?.concepts.some((c) => frameStatesRef.current[frameKey(i, c.id)]?.chainLink)
    })
    setChainRunning(true)
    try {
      if (!anyChained) {
        await Promise.all(ordered.map((frameIndex) => runOneFrameOfBatch(frameIndex, override, includeExisting)))
        return
      }
      // Chained run: walk in index order so each frame can reference the
      // previous frame's (possibly just-regenerated) keyframe.
      let step = 0
      for (const frameIndex of ordered) {
        setChainAt({ step: ++step, of: ordered.length })
        const ok = await runOneFrameOfBatch(frameIndex, override, includeExisting)
        if (!ok) {
          useAppStore.getState().addToast(`Stopped at Frame ${frameIndex}. Fix it and run again.`, 'error')
          break
        }
        // Let the ref effect observe the new selection before the next frame
        // reads it as its chain reference.
        await new Promise((r) => setTimeout(r, 0))
      }
    } finally {
      setChainRunning(false)
      setChainAt(null)
    }
  }

  // ── Clip video generation (frames-to-video) ──────────────────
  const runClipVideo = async (sceneIndex: number) => {
    if (!result || guardDemo()) return
    const key = clipKey(sceneIndex)
    const clipCard = clipStates[key]
    if (!clipCard) return
    const startRef = keyframeRef(sceneIndex)
    const endRef = keyframeRef(sceneIndex + 1)
    if (!startRef || !endRef) {
      useAppStore.getState().addToast(`Pick keyframes for Frame ${sceneIndex} and Frame ${sceneIndex + 1} first.`, 'error')
      return
    }

    const model = getModel(continuousModelId)
    if (!model) {
      useAppStore.getState().addToast(`Unknown video model: ${continuousModelId}`, 'error')
      return
    }
    const [firstFrameDataUri, lastFrameDataUri] = await Promise.all([toDataUri(startRef), toDataUri(endRef)])
    if (!firstFrameDataUri || !lastFrameDataUri) {
      useAppStore.getState().addToast('Could not load the keyframe images.', 'error')
      return
    }

    const constraints = model.videoConstraints
    const durationSeconds = constraints
      ? snapVideoDurationUp(clipCard.durationSeconds, constraints.durations)
      : clipCard.durationSeconds
    const resolution = constraints && !constraints.resolutions.includes(clipCard.resolution)
      ? constraints.default ?? constraints.resolutions[0]
      : clipCard.resolution
    // Match the canvas the endpoints were drawn on, clamped to what this model
    // offers. The frames are fixed inputs, so a mismatch crops or letterboxes.
    const startAspect = keyframeAspect(sceneIndex)
    const aspectRatio = constraints && constraints.aspectRatios.length > 0
      && !constraints.aspectRatios.includes(startAspect)
      ? constraints.aspectRatios[0]
      : startAspect

    const promptText = buildContinuousPrompt(`${clipCard.editablePrompt.trim()}\n\n${CLIP_AUDIO_RULE}`, result.style)

    const inFlightId = crypto.randomUUID()
    updateClip(key, (prev) => ({
      inFlightVideos: [
        ...prev.inFlightVideos,
        {
          id: inFlightId,
          taskId: null,
          modelId: continuousModelId,
          startedAt: Date.now(),
          prompt: promptText,
          mode: 'frames-to-video',
          aspectRatio,
          durationSeconds,
          resolution,
          audio: clipCard.audio,
        },
      ],
    }))

    let claimedTaskId: string | null = null
    try {
      const { taskId, videoEndpoint } = await startVideoTask({
        prompt: promptText,
        mode: 'frames-to-video',
        firstFrameDataUri,
        lastFrameDataUri,
        aspectRatio,
        durationSeconds,
        resolution,
        audio: clipCard.audio,
        modelId: continuousModelId,
        noRealism: !result.realism,
      })
      updateClip(key, (prev) => ({
        inFlightVideos: prev.inFlightVideos.map((e) => (e.id === inFlightId ? { ...e, taskId, endpoint: videoEndpoint } : e)),
      }))

      // Own this poll before the taskId is persisted — see taskRegistry.
      if (!claimTask('video', taskId)) return
      claimedTaskId = taskId

      const res = await finishVideoTask(taskId, continuousModelId, videoEndpoint, durationSeconds, aspectRatio)
      const assetRef = `asset://${res.assetId}`
      const newVideo: GeneratedVideo = {
        url: assetRef,
        modelId: continuousModelId,
        prompt: promptText,
        aspectRatio: res.aspectRatio,
        durationSeconds: res.durationSeconds,
        resolution,
        audio: clipCard.audio,
        mode: 'frames-to-video',
        createdAt: Date.now(),
      }
      updateClip(key, (prev) => {
        const newVideos = [...prev.videos, newVideo]
        return { videos: newVideos, currentVideoIndex: newVideos.length - 1, inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== inFlightId) }
      })

      const historyEntry: VideoHistoryItem = {
        id: crypto.randomUUID(),
        modelId: continuousModelId,
        prompt: promptText,
        mode: 'frames-to-video',
        aspectRatio: res.aspectRatio,
        durationSeconds: res.durationSeconds,
        resolution,
        audio: clipCard.audio,
        videoUrl: assetRef,
        sourceApp: 'broll-studio',
        createdAt: Date.now(),
      }
      await useBankStore.getState().addVideoHistory(historyEntry)
      useAppStore.getState().addToast(`Clip ${sceneIndex} ready`, 'success')
    } catch (err) {
      if (isPollTimeout(err)) return
      const msg = humanizeError(err, 'Video generation failed.')
      updateClip(key, (prev) => ({
        inFlightVideos: prev.inFlightVideos.map((e) => (e.id === inFlightId ? { ...e, error: msg } : e)),
      }))
      useAppStore.getState().addToast(msg, 'error')
    } finally {
      if (claimedTaskId) releaseTask('video', claimedTaskId)
    }
  }

  // Standalone Animate: image-to-video THIS frame's chosen still on its own
  // (not chained into the keyframe sequence). Mirrors runClipVideo but with a
  // single start frame + the frame's own motion, and writes to the frame card.
  const runFrameAnimate = async (frameKey: string) => {
    if (!result || guardDemo()) return
    const frameCard = frameStates[frameKey]
    if (!frameCard) return
    const frameIndex = Number(frameKey.slice(0, frameKey.indexOf(':')))
    const startImageRef = frameCard.images[frameCard.currentImageIndex]?.imageUrl
    if (!startImageRef) {
      useAppStore.getState().addToast('Generate an image for this frame first, then animate it.', 'error')
      return
    }
    const model = getModel(continuousAnimateModelId)
    if (!model) {
      useAppStore.getState().addToast(`Unknown video model: ${continuousAnimateModelId}`, 'error')
      return
    }
    // Use the still however the picked model can: a true start frame for an
    // image-to-video model, otherwise a reference image for a reference-to-video
    // model. Either way the chosen keyframe drives the clip.
    const modes = model.modes ?? []
    const animateMode: VideoMode | null = modes.includes('image-to-video')
      ? 'image-to-video'
      : modes.includes('reference-to-video')
        ? 'reference-to-video'
        : null
    if (!animateMode) {
      useAppStore.getState().addToast(`${model.displayName} can't animate a single still. Pick a model that takes a start frame or reference images.`, 'error')
      return
    }
    const frameDataUri = await toDataUri(startImageRef)
    if (!frameDataUri) {
      useAppStore.getState().addToast('Could not load the frame image.', 'error')
      return
    }

    // Motion: the frame's own editable animate motion, falling back to the clip
    // that starts on this frame (same departure motion), then nothing.
    const motion = frameCard.animateMotion?.trim() || clipStates[clipKey(frameIndex)]?.editablePrompt?.trim() || ''
    const constraints = model.videoConstraints
    const durationSeconds = constraints ? snapVideoDurationUp(frameCard.videoDurationSeconds, constraints.durations) : frameCard.videoDurationSeconds
    const resolution = constraints && !constraints.resolutions.includes(frameCard.videoResolution)
      ? constraints.default ?? constraints.resolutions[0]
      : frameCard.videoResolution
    // Animate on the canvas this frame was drawn at, clamped to the model's list.
    const aspectRatio = constraints && constraints.aspectRatios.length > 0
      && !constraints.aspectRatios.includes(frameCard.aspectRatio)
      ? constraints.aspectRatios[0]
      : frameCard.aspectRatio
    const promptText = buildContinuousPrompt(`${motion}\n\n${CLIP_AUDIO_RULE}`, result.style)

    const inFlightId = crypto.randomUUID()
    updateFrame(frameKey, (prev) => ({
      inFlightVideos: [
        ...prev.inFlightVideos,
        { id: inFlightId, taskId: null, modelId: continuousAnimateModelId, startedAt: Date.now(), prompt: promptText, mode: animateMode, aspectRatio, durationSeconds, resolution, audio: frameCard.videoAudio },
      ],
    }))

    let claimedTaskId: string | null = null
    try {
      const { taskId, videoEndpoint } = await startVideoTask({
        prompt: promptText,
        mode: animateMode,
        firstFrameDataUri: animateMode === 'image-to-video' ? frameDataUri : undefined,
        referenceDataUris: animateMode === 'reference-to-video' ? [frameDataUri] : undefined,
        aspectRatio,
        durationSeconds,
        resolution,
        audio: frameCard.videoAudio,
        modelId: continuousAnimateModelId,
        noRealism: !result.realism,
      })
      updateFrame(frameKey, (prev) => ({
        inFlightVideos: prev.inFlightVideos.map((e) => (e.id === inFlightId ? { ...e, taskId, endpoint: videoEndpoint } : e)),
      }))

      // Own this poll before the taskId is persisted — see taskRegistry.
      if (!claimTask('video', taskId)) return
      claimedTaskId = taskId

      const res = await finishVideoTask(taskId, continuousAnimateModelId, videoEndpoint, durationSeconds, aspectRatio)
      const assetRef = `asset://${res.assetId}`
      const newVideo: GeneratedVideo = {
        url: assetRef, modelId: continuousAnimateModelId, prompt: promptText, aspectRatio: res.aspectRatio,
        durationSeconds: res.durationSeconds, resolution, audio: frameCard.videoAudio, mode: animateMode, createdAt: Date.now(),
      }
      updateFrame(frameKey, (prev) => {
        const newVideos = [...prev.videos, newVideo]
        return { videos: newVideos, currentVideoIndex: newVideos.length - 1, inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== inFlightId) }
      })
      const historyEntry: VideoHistoryItem = {
        id: crypto.randomUUID(), modelId: continuousAnimateModelId, prompt: promptText, mode: animateMode, aspectRatio: res.aspectRatio,
        durationSeconds: res.durationSeconds, resolution, audio: frameCard.videoAudio, videoUrl: assetRef, sourceApp: 'broll-studio', createdAt: Date.now(),
      }
      await useBankStore.getState().addVideoHistory(historyEntry)
      useAppStore.getState().addToast('Animation ready', 'success')
    } catch (err) {
      if (isPollTimeout(err)) return
      const msg = humanizeError(err, 'Video generation failed.')
      updateFrame(frameKey, (prev) => ({
        inFlightVideos: prev.inFlightVideos.map((e) => (e.id === inFlightId ? { ...e, error: msg } : e)),
      }))
      useAppStore.getState().addToast(msg, 'error')
    } finally {
      if (claimedTaskId) releaseTask('video', claimedTaskId)
    }
  }

  // ── Refresh-resume (images + videos) ─────────────────────────
  // Also re-run when the connection comes back: a clip kie already rendered
  // and billed for is recoverable for 3 days, and a dropped Wi-Fi kills the
  // download rather than the generation. See hooks/useReconnectTick.
  const reconnectTick = useReconnectTick()
  const IMG_TTL_MS = 30 * 60 * 1000
  const VID_TTL_MS = 60 * 60 * 1000
  useEffect(() => {
    const now = Date.now()
    setFrameStates((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [key, cs] of Object.entries(prev)) {
        const stalled = cs.inFlightImages.filter((e) => (!e.taskId || !e.modelId) && now - e.startedAt > IMG_TTL_MS)
        if (stalled.length === 0) continue
        changed = true
        next[key] = {
          ...cs,
          inFlightImages: cs.inFlightImages.map((e) =>
            stalled.includes(e) ? { ...e, error: 'Generation stalled before kie returned a task id. Dismiss and try again.' } : e,
          ),
        }
      }
      return changed ? next : prev
    })
    setClipStates((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [key, cs] of Object.entries(prev)) {
        const stalled = cs.inFlightVideos.filter((e) => !e.taskId && now - e.startedAt > VID_TTL_MS)
        if (stalled.length === 0) continue
        changed = true
        next[key] = {
          ...cs,
          inFlightVideos: cs.inFlightVideos.map((e) =>
            stalled.includes(e) ? { ...e, error: 'Generation stalled before kie returned a task id. Dismiss and try again.' } : e,
          ),
        }
      }
      return changed ? next : prev
    })

    for (const [key, cs] of Object.entries(frameStates)) {
      for (const entry of cs.inFlightImages) {
        if (!entry.taskId || !entry.modelId) continue
        // Skip tasks a live generation promise still owns — a view unmounted by
        // a History/mode switch keeps polling, so resuming here would duplicate.
        if (!claimTask('image', entry.taskId)) continue
        const { id: inFlightId, taskId, modelId, prompt, resolution } = entry
        ;(async () => {
          try {
            const imageUrl = await finishImageTask(taskId, modelId, resolution || undefined)
            const newImage: GeneratedImage = { imageUrl, prompt, modelId, createdAt: Date.now() }
            setFrameStates((prev) => {
              const existing = prev[key]
              if (!existing) return prev
              const newImages = [...existing.images, newImage]
              return { ...prev, [key]: { ...existing, images: newImages, currentImageIndex: newImages.length - 1, inFlightImages: existing.inFlightImages.filter((e) => e.id !== inFlightId) } }
            })
          } catch (err) {
            const msg = humanizeError(err, 'Image resume failed.')
            setFrameStates((prev) => {
              const existing = prev[key]
              if (!existing) return prev
              return { ...prev, [key]: { ...existing, inFlightImages: existing.inFlightImages.map((e) => (e.id === inFlightId ? { ...e, error: msg } : e)) } }
            })
          } finally {
            releaseTask('image', taskId)
          }
        })()
      }
    }
    for (const [key, cs] of Object.entries(clipStates)) {
      for (const entry of cs.inFlightVideos) {
        if (!entry.taskId) continue
        if (!claimTask('video', entry.taskId)) continue
        const { id: inFlightId, taskId, modelId, endpoint, durationSeconds, aspectRatio, resolution, audio, prompt, mode } = entry
        ;(async () => {
          try {
            const res = await finishVideoTask(taskId, modelId, endpoint, durationSeconds, aspectRatio)
            const assetRef = `asset://${res.assetId}`
            const newVideo: GeneratedVideo = {
              url: assetRef, modelId, prompt, aspectRatio: res.aspectRatio,
              durationSeconds: res.durationSeconds, resolution, audio, mode, createdAt: Date.now(),
            }
            setClipStates((prev) => {
              const existing = prev[key]
              if (!existing) return prev
              const newVideos = [...existing.videos, newVideo]
              return { ...prev, [key]: { ...existing, videos: newVideos, currentVideoIndex: newVideos.length - 1, inFlightVideos: existing.inFlightVideos.filter((e) => e.id !== inFlightId) } }
            })
            const historyEntry: VideoHistoryItem = {
              id: crypto.randomUUID(), modelId, prompt, mode, aspectRatio: res.aspectRatio,
              durationSeconds: res.durationSeconds, resolution, audio, videoUrl: assetRef, sourceApp: 'broll-studio', createdAt: Date.now(),
            }
            await useBankStore.getState().addVideoHistory(historyEntry)
            useAppStore.getState().addToast('Continuous clip ready', 'success')
          } catch (err) {
            if (isPollTimeout(err)) return
            const msg = humanizeError(err, 'Video resume failed.')
            setClipStates((prev) => {
              const existing = prev[key]
              if (!existing) return prev
              return { ...prev, [key]: { ...existing, inFlightVideos: existing.inFlightVideos.map((e) => (e.id === inFlightId ? { ...e, error: msg } : e)) } }
            })
            useAppStore.getState().addToast(msg, 'error')
          } finally {
            releaseTask('video', taskId)
          }
        })()
      }
    }
    // Standalone-animate videos live on the frame cards — resume them too.
    for (const [key, cs] of Object.entries(frameStates)) {
      for (const entry of cs.inFlightVideos) {
        if (!entry.taskId) continue
        if (!claimTask('video', entry.taskId)) continue
        const { id: inFlightId, taskId, modelId, endpoint, durationSeconds, aspectRatio, resolution, audio, prompt, mode } = entry
        ;(async () => {
          try {
            const res = await finishVideoTask(taskId, modelId, endpoint, durationSeconds, aspectRatio)
            const assetRef = `asset://${res.assetId}`
            const newVideo: GeneratedVideo = {
              url: assetRef, modelId, prompt, aspectRatio: res.aspectRatio,
              durationSeconds: res.durationSeconds, resolution, audio, mode, createdAt: Date.now(),
            }
            setFrameStates((prev) => {
              const existing = prev[key]
              if (!existing) return prev
              const newVideos = [...existing.videos, newVideo]
              return { ...prev, [key]: { ...existing, videos: newVideos, currentVideoIndex: newVideos.length - 1, inFlightVideos: existing.inFlightVideos.filter((e) => e.id !== inFlightId) } }
            })
          } catch (err) {
            if (isPollTimeout(err)) return
            const msg = humanizeError(err, 'Video resume failed.')
            setFrameStates((prev) => {
              const existing = prev[key]
              if (!existing) return prev
              return { ...prev, [key]: { ...existing, inFlightVideos: existing.inFlightVideos.map((e) => (e.id === inFlightId ? { ...e, error: msg } : e)) } }
            })
          } finally {
            releaseTask('video', taskId)
          }
        })()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectTick])

  if (isGenerating) {
    return (
      <div className="flex h-full flex-col overflow-hidden px-5 py-4">
        <GenerationProgress
          isActive
          color="bg-broll-500"
          messages={['Reading the script...', 'Splitting into scenes...', 'Designing the keyframes...', 'Writing motion prompts...']}
          className="mb-6"
          showHelper={false}
        />
        <div className="flex-1 overflow-y-auto">
          {/* One breathe for the whole block — see `.skeleton-group` in
              index.css. The bar above already says the work is running. */}
          <div className="skeleton-group">
            <div className="mb-6 flex items-center gap-4">
              <div className="skeleton h-14 w-14 rounded-2xl" />
              <div className="flex flex-col gap-2">
                <div className="skeleton h-4 w-40" />
                <div className="skeleton h-3 w-56" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton skeleton-card aspect-[9/16]" />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <Box className="h-10 w-10 text-ink-800" strokeWidth={1.5} />
        <p className="text-sm text-ink-700">Storyboard the script as one continuous shot</p>
        <p className="text-xs text-ink-800">Keyframes chain into each other: every clip ends on the next clip's first frame</p>
        {error && (
          <div className="mt-2 flex max-w-sm items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400 light:text-red-600" />
            <p className="text-xs leading-relaxed text-red-300 light:text-red-700">{error}</p>
          </div>
        )}
      </div>
    )
  }

  const style = getContinuousStyle(result.styleId)
  const totalSeconds = result.scenes.reduce((s, sc) => s + (clipStates[clipKey(sc.index)]?.durationSeconds ?? sc.durationSeconds), 0)
  const finalFrame = result.frames[result.frames.length - 1]
  const framesPicked = result.frames.filter((f) => selections[String(f.index)]).length

  const readyClipIndices = result.scenes
    .map((s) => s.index)
    .filter((i) => keyframeRefLive(i) && keyframeRefLive(i + 1))

  // Rewrite context for the open frame, grounded in the motions actually on the
  // clips either side (the picked concept's, or the user's hand-edit) rather
  // than the storyboard's first-concept fallback.
  const openFrameContext = (frameIndex: number, conceptLabel: string, conceptShot?: string) =>
    frameContextFor(result, frameIndex, {
      productContext,
      modelContext,
      conceptLabel,
      conceptShot,
      inboundMotion: clipStates[clipKey(frameIndex - 1)]?.editablePrompt,
      outboundMotion: clipStates[clipKey(frameIndex)]?.editablePrompt,
    })

  // Every generated clip across all rows, in scene order, for the download
  // picker. Each clip's COVER take (what its card face plays) is flagged so the
  // picker opens with one clip per scene ticked and the alternate takes left
  // out — zipping every take was the old behaviour and it buried the keepers.
  const allClipEntries: ClipDownloadEntry[] = result.scenes.flatMap((s) => {
    const cs = clipStates[clipKey(s.index)]
    const vids = cs?.videos ?? []
    const cover = Math.min(cs?.currentVideoIndex ?? 0, Math.max(0, vids.length - 1))
    const scene = String(s.index).padStart(2, '0')
    return vids.map((v, i) => ({
      id: `${s.index}:${i}`,
      ref: v.url,
      name: vids.length > 1 ? `clip-${scene}-take${i + 1}` : `clip-${scene}`,
      label: `Clip ${s.index}`,
      meta: vids.length > 1 ? `Take ${i + 1} of ${vids.length}` : undefined,
      preselected: i === cover,
      badge: i === cover ? 'Cover' : undefined,
      aspectRatio: v.aspectRatio,
    }))
  })

  // Bookmark a keyframe still to the B-Rolls bank (reusable as a start frame),
  // mirroring the Line-by-Line card's save action. Product/model ids come from
  // the current session so the saved still keeps its provenance.
  const saveKeyframeToBank = async (imageRef: string, prompt: string) => {
    await useBankStore.getState().addBRoll({
      imageUrl: imageRef,
      prompt,
      productId: selectedProduct?.id,
      modelId: selectedModel?.id,
      sourceApp: 'broll-studio',
    } as Omit<BRoll, 'id' | 'createdAt'>)
  }

  const requestClips = (sceneIndices: number[], scope: string) => {
    const targets = sceneIndices.filter((i) => clipStates[clipKey(i)])
    if (targets.length === 0) {
      useAppStore.getState().addToast('No clips are ready. Pick keyframes first.', 'error')
      return
    }
    setConfirmGen({ kind: 'clips', sceneIndices: targets, scope })
  }
  // Generate keyframes for a specific set of frames, or (no arg) every frame
  // that doesn't have a picked keyframe yet. A single-frame request powers the
  // per-row "Generate frame" button, matching Line-by-Line's per-row generate.
  const requestFrames = (frameIndices?: number[]) => {
    const pool = frameIndices ?? result.frames.map((f) => f.index)
    // `fresh` = no keyframe picked yet; `done` = already picked. Kept apart so a
    // stray press never silently re-bills frames the user already chose — the
    // regenerate toggle is the only way to include them.
    const fresh = pool.filter((i) => !selections[String(i)])
    const done = pool.filter((i) => selections[String(i)])
    if (fresh.length === 0 && done.length === 0) return
    // When everything's already picked the dialog still opens — with the toggle
    // as the only path forward, so "regenerate the lot" stays possible but never
    // accidental. One exception: pressing a single row's own button IS the
    // explicit intent, so it pre-arms the toggle rather than opening on
    // "Nothing to generate" — that dead-end was the only way back into a frame
    // once its keyframe had been auto-picked.
    setIncludeExisting(frameIndices?.length === 1 && fresh.length === 0)
    setConfirmGen({ kind: 'frames', fresh, done })
  }
  // Put each clip through the SAME fire-time clamp runClipVideo applies —
  // duration snapped up onto the model's grid, unsupported resolutions swapped.
  // Swapping the model inside this dialog otherwise costs every clip at its old
  // settings while kie bills the clamped ones.
  const confirmClipConstraints = getModel(continuousModelId)?.videoConstraints
  const confirmCredits = confirmGen?.kind === 'clips'
    ? confirmGen.sceneIndices.reduce((sum, i) => {
        const c = clipStates[clipKey(i)]
        if (!c) return sum
        const durationSeconds = confirmClipConstraints
          ? snapVideoDurationUp(c.durationSeconds, confirmClipConstraints.durations)
          : c.durationSeconds
        const resolution = confirmClipConstraints && !confirmClipConstraints.resolutions.includes(c.resolution)
          ? confirmClipConstraints.default ?? confirmClipConstraints.resolutions[0]
          : c.resolution
        return sum + (estimateCredits(continuousModelId, { durationSeconds, resolution, audio: c.audio }) ?? 0)
      }, 0)
    : 0
  const overBudget = balance !== null && confirmGen?.kind === 'clips' && confirmCredits > balance

  // Frame-batch (keyframe images) cost + valid resolutions/aspects, clamped to
  // whatever the current image model supports so switching it never strands an
  // invalid pick. Defaults match the frame card (1K / 9:16).
  const frameImgConstraints = frameImageModelId ? getModel(frameImageModelId)?.imageConstraints : undefined
  const frameResOptions = (frameImgConstraints?.resolutions ?? []) as ImageResolution[]
  const frameAspectOptions = frameImgConstraints?.aspectRatios ?? []
  const effectiveFramesRes: ImageResolution | undefined =
    framesResolution && frameResOptions.includes(framesResolution)
      ? framesResolution
      : frameResOptions.includes('1K' as ImageResolution)
        ? ('1K' as ImageResolution)
        : frameResOptions[0]
  const effectiveFramesAspect =
    framesAspect && frameAspectOptions.includes(framesAspect)
      ? framesAspect
      : frameAspectOptions.includes('9:16')
        ? '9:16'
        : frameAspectOptions[0]
  // What the frames run will actually fire: the un-picked frames, plus the
  // already-picked ones only when the user opts in.
  const frameTargets = confirmGen?.kind === 'frames'
    ? (includeExisting ? [...confirmGen.fresh, ...confirmGen.done] : confirmGen.fresh)
    : []
  // Every concept of every target frame renders, so the batch costs images, not
  // frames — price and label it that way or a 6-frame run quietly bills triple.
  const frameImageCount = frameTargets.reduce((sum, i) => sum + batchConceptsFor(i).length, 0)
  const framesPerImage = frameImageModelId
    ? estimateCredits(frameImageModelId, { imageCount: 1, resolution: effectiveFramesRes })
    : null
  const framesCredits = framesPerImage != null ? framesPerImage * frameImageCount : null
  const framesOverBudget = framesCredits != null && balance !== null && framesCredits > balance

  const confirmGenerate = () => {
    if (!confirmGen) return
    if (confirmGen.kind === 'clips') {
      confirmGen.sceneIndices.forEach((i) => void runClipVideo(i))
    } else {
      if (frameTargets.length === 0) return
      void runAllFrames(frameTargets, {
        aspectRatio: effectiveFramesAspect ?? '9:16',
        resolution: effectiveFramesRes ?? ('1K' as ImageResolution),
      }, includeExisting)
    }
    setConfirmGen(null)
  }

  // Resolve the open frame modal target.
  const openFrame = openFrameKey ? result.frames.find((f) => f.index === Number(openFrameKey.split(':')[0])) : undefined
  const openConcept = openFrame?.concepts.find((c) => frameKey(openFrame.index, c.id) === openFrameKey)
  const openFrameCard = openFrameKey ? frameStates[openFrameKey] : undefined
  const openFrameSel = openFrame ? selections[String(openFrame.index)] : undefined
  // Resolve the open clip modal target.
  const openScene = openClipKey ? result.scenes.find((s) => clipKey(s.index) === openClipKey) : undefined
  const openClipCard = openClipKey ? clipStates[openClipKey] : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top strip — storyboard meta + the batch actions. A STATIC row above
          the scroll port, not a `sticky` child inside it: see the note on the
          Line-by-Line strip for why (a glass sticky bar lagged its own
          scroller on the way back up and read as coming loose). It never
          scrolled away, so nothing is lost but the blur-under. */}
      {/* The strip is the BATCH BUTTONS and nothing else, centred. The meta
          pills used to share the line and lost the squeeze to buttons that
          can't shrink, painting over the first of them on a narrow window; they
          sit under the separator now, at the top of the storyboard they
          describe. This strip had it worse than its twin — four pills against
          the other's two.

          NOTE: the Line-by-Line strip no longer mirrors this one (August 2026).
          It went to style-pill-left / actions-right on one always-scrolling
          line, with its three generate passes behind a single "Generate all"
          menu — the shape that finally made a meta pill and the buttons coexist.
          This strip was left as it was because its actions are a different set;
          bringing it across is the obvious follow-up, and until then the two
          tabs of one panel do dress the same job two ways. */}
      <div className="relative z-20 flex shrink-0 flex-col items-center gap-2.5 border-b border-ink/5 px-5 py-3.5">
        {/* One CENTRED line that scrolls when the pills outrun the panel. The
            `w-max min-w-full` shape is what allows both: at `min-w-full` the row
            is exactly the port when it fits (so centring does the work) and
            exactly its content when it doesn't (so centring is a no-op and the
            scroll starts at pill one). A plain `justify-center` inside a scroll
            port centres the overflow too, stranding the first pill off the left
            edge with no way to scroll back to it. */}
        {/* NOT `w-full` alongside `-mx-5`: `width: 100%` resolves against the
            strip's CONTENT box, so the port came out 40px narrower than the
            strip and the negative margin then spent all of it on the left —
            the row started at the panel's inset and ended 40px shy of it. With
            the width left `auto` the block fills its container and the two
            negative margins widen it by exactly the padding they cancel, so the
            port spans the strip and `px-5` puts both ends back on the panel's
            own inset. Invisible while the row was centred (it just shifted the
            centre 20px left); it shows the moment anything is right-aligned. */}
        <div className="-mx-5 overflow-x-auto scrollbar-hide px-5">
        {/* The generate steps are ONE tinted family in graded depths, lightest
            first — the same ramp as the Line-by-Line strip, so the two tabs of
            one panel don't dress the same job two ways. Download clips stays
            neutral: it's the export, not a generate step, and it spends
            nothing. */}
        <div className="flex w-full flex-wrap items-center justify-center gap-2 md:w-max md:min-w-full md:flex-nowrap md:whitespace-nowrap">
          <button
            type="button"
            onClick={() => requestFrames()}
            // Only a chain walk already underway blocks this — a single frame
            // card rendering on its own doesn't, so the two can overlap.
            disabled={chainRunning}
            title="Generate a keyframe image for every frame that doesn't have one yet"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-broll-500/15 bg-broll-500/[0.05] px-3.5 py-1.5 text-[11px] font-medium text-broll-300 transition-colors hover:border-broll-500/30 hover:bg-broll-500/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {chainRunning ? <Spinner className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
            {chainRunning
              ? chainAt ? `Frame ${chainAt.step} of ${chainAt.of}…` : 'Generating frames…'
              : 'Generate frames'}
          </button>
          <button
            type="button"
            onClick={() => requestClips(readyClipIndices, 'Every ready clip')}
            // Clips render in parallel — one already in flight is no reason to
            // stop the member firing the rest.
            disabled={readyClipIndices.length === 0}
            title="Generate every clip whose two keyframes are picked"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-broll-500/50 bg-broll-500/[0.24] px-3.5 py-1.5 text-[11px] font-medium text-broll-200 transition-colors hover:border-broll-500/65 hover:bg-broll-500/[0.32] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <VideoIcon className="h-3.5 w-3.5" />
            Generate all videos
          </button>
          {allClipEntries.length > 0 && (
            <button
              type="button"
              onClick={() => setDownloadOpen(true)}
              title="Pick which clips to download as a zip"
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100"
            >
              <Download className="h-3.5 w-3.5" />
              {`Download clips (${allClipEntries.length})`}
            </button>
          )}
        </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4 pt-5">
      {/* The storyboard's caption — scene count, look, running time, and how
          many keyframes are picked. Below the separator rather than in the bar
          above it: up there it was what squeezed the batch buttons off their own
          line.

          The look is the one item here that IS a control (August 2026): it left
          the input column, where it was a required row asking for a decision
          before a single frame existed, and became the pill in front of the
          frames it applies to — accent-tinted, unlike the neutral meta pills
          beside it, because it's the one you can press. An unpicked session
          folds to the mode default rather than blocking Generate. The read-only
          meta stays desktop-only as it has been; the pill doesn't, since a phone
          would otherwise have no way to change the look but a card modal. It
          spells out `uppercase` because preflight resets `text-transform` on a
          <button>, so the row's own class stops reaching it once it's pressable. */}
      <div className="mb-8 flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-400">
        {/* Scene count matches the per-line storyboard's — small-caps and dim,
            the same eyebrow treatment as the pills beside it. */}
        <span className="hidden font-semibold text-ink-500 md:inline">
          {result.scenes.length} {result.scenes.length === 1 ? 'Scene' : 'Scenes'}
        </span>
        <button
          type="button"
          onClick={onChangeStyle}
          title="Change the look every clip renders in"
          className="inline-flex min-w-0 items-center gap-1 rounded-full border border-broll-500/25 bg-broll-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-broll-300 transition-colors hover:border-broll-500/45 hover:bg-broll-500/[0.18]"
        >
          <Palette className="h-3 w-3 shrink-0" strokeWidth={2} />
          <span className="truncate">{style.label}</span>
          <ChevronRight className="h-3 w-3 shrink-0 opacity-70" strokeWidth={2.5} />
        </button>
        <span className="hidden rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[10px] text-ink-300 md:inline">~{totalSeconds}s</span>
        <span className="hidden rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[10px] text-ink-300 md:inline">{framesPicked}/{result.frames.length} keyframes picked</span>
      </div>
      {result.demo && (
        <div className="mb-4 mt-4 flex items-start gap-2 rounded-2xl border border-broll-500/25 bg-broll-500/10 px-4 py-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-broll-300" />
          <p className="text-xs leading-relaxed text-ink-300">
            <span className="font-semibold text-broll-300">Sample storyboard.</span>{' '}
            This is a preview of what Continuous mode produces. Add your kie.ai key in Settings to storyboard your own script and generate the keyframes and clips.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-10">
        {result.scenes.map((scene) => (
          <SceneRow
            key={scene.index}
            scene={scene}
            frame={result.frames.find((f) => f.index === scene.index)!}
            nextFramePicked={!!selections[String(scene.index + 1)]}
            selection={selections[String(scene.index)]}
            frameStates={frameStates}
            clipState={clipStates[clipKey(scene.index)]}
            framePicked={!!selections[String(scene.index)]}
            chainRunning={chainRunning}
            chainOn={frameChainOn(result.frames.find((f) => f.index === scene.index)!)}
            onToggleChain={() => toggleFrameChain(result.frames.find((f) => f.index === scene.index)!)}
            onEditScene={() => setEditingScene(scene.index)}
            onGenerateFrame={() => requestFrames([scene.index])}
            onOpenConcept={setOpenFrameKey}
            onOpenClip={() => setOpenClipKey(clipKey(scene.index))}
            onGenerateConcept={(key) => void runFrameImage(key)}
            onSelectConcept={(conceptId) => {
              const card = frameStates[frameKey(scene.index, conceptId)]
              if (!card || card.images.length === 0) return
              setSelections((prev) => ({ ...prev, [String(scene.index)]: { conceptId, imageIndex: card.currentImageIndex } }))
            }}
            onAddConcept={() => onAddConcept(scene.index)}
            onSaveImage={saveKeyframeToBank}
          />
        ))}

        {/* Final frame — the end state the last clip lands on. No clip cell. */}
        <FinalFrameRow
          frame={finalFrame}
          selection={selections[String(finalFrame.index)]}
          frameStates={frameStates}
          chainRunning={chainRunning}
          chainOn={frameChainOn(finalFrame)}
          onToggleChain={() => toggleFrameChain(finalFrame)}
          onGenerateFrame={() => requestFrames([finalFrame.index])}
          onOpenConcept={setOpenFrameKey}
          onGenerateConcept={(key) => void runFrameImage(key)}
          onSelectConcept={(conceptId) => {
            const card = frameStates[frameKey(finalFrame.index, conceptId)]
            if (!card || card.images.length === 0) return
            setSelections((prev) => ({ ...prev, [String(finalFrame.index)]: { conceptId, imageIndex: card.currentImageIndex } }))
          }}
          onAddConcept={() => onAddConcept(finalFrame.index)}
          onSaveImage={saveKeyframeToBank}
        />
      </div>
      </div>

      {editingScene !== null && result.scenes.find((s) => s.index === editingScene) && (
        <SceneEditModal
          scene={result.scenes.find((s) => s.index === editingScene)!}
          hasNext={result.scenes.some((s) => s.index === editingScene + 1)}
          canDelete={result.scenes.length > 1}
          onApply={onEditStoryboard}
          onClose={() => setEditingScene(null)}
        />
      )}

      {/* Cost-confirm popup — clips are expensive; the frame batch is a count
          confirm so a 12-frame chain never fires on a stray click. */}
      {confirmGen && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
          {...confirmBackdrop}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-ink/10 bg-ink-950/95 p-5 shadow-2xl"
          >
            {confirmGen.kind === 'clips' ? (
              <>
                {/* The count and the price ride on the Generate button, same
                    as Line-by-Line's batch dialogs. */}
                <h3 className="text-sm font-medium text-ink-100">Generate videos</h3>
                <p className="mt-1 text-xs text-ink-500">{confirmGen.scope}</p>

                {/* Model — the frames-to-video model every video in this batch
                    uses. Swapping it here re-costs the run. */}
                <div className="mt-4 flex flex-col gap-2.5">
                  <button
                    type="button"
                    onClick={() => setConfirmModelPanelOpen(true)}
                    className="flex h-12 w-full items-center gap-2.5 rounded-full border border-ink/10 bg-ink/[0.02] px-3 text-left transition-colors hover:bg-ink/[0.05]"
                  >
                    {getModel(continuousModelId) ? (
                      <>
                        <ProviderLogo provider={getModel(continuousModelId)?.provider ?? ''} />
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-ink-100">{getModel(continuousModelId)?.displayName}</span>
                          {getModel(continuousModelId)?.tags.includes('recommended') && (
                            <Star className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400 light:fill-yellow-600 light:text-yellow-600" strokeWidth={1.5} />
                          )}
                          {officialSavingsPercent(continuousModelId) != null && <SavingsPill pct={officialSavingsPercent(continuousModelId)!} />}
                        </div>
                      </>
                    ) : (
                      <span className="flex-1 truncate text-sm text-ink-400">Select model</span>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
                  </button>
                </div>

                {balance !== null && overBudget && (
                  <p className="mt-3 text-[11px] text-red-400 light:text-red-600">
                    Not enough credits. Your balance is {balance.toLocaleString()}.
                  </p>
                )}
              </>
            ) : (
              <>
                <h3 className="text-sm font-medium text-ink-100">
                  {frameTargets.length === 0 ? 'Nothing to generate' : 'Generate keyframes'}
                </h3>
                <p className="mt-1 text-xs text-ink-500">
                  {frameTargets.length > 0 && `${frameTargets.length} frame${frameTargets.length === 1 ? '' : 's'} · every concept renders, and the first one that lands becomes the keyframe until you pick another.`}
                </p>

                {confirmGen.done.length > 0 && (
                  <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={includeExisting}
                      onChange={(e) => setIncludeExisting(e.target.checked)}
                      className="h-3.5 w-3.5 shrink-0 accent-broll-500"
                    />
                    <span className="text-xs text-ink-300">
                      Also regenerate the {confirmGen.done.length} frame
                      {confirmGen.done.length === 1 ? '' : 's'} that already {confirmGen.done.length === 1 ? 'has' : 'have'} a keyframe
                    </span>
                  </label>
                )}

                {/* Model + run settings — the image model, resolution and aspect
                    every keyframe in this batch uses. Mirrors Line-by-Line. */}
                <div className="mt-4 flex flex-col gap-2.5">
                  <ModelPicker appId="broll-studio" task="image" mode="text-to-image" />
                  {(frameAspectOptions.length > 0 || frameResOptions.length > 0) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {frameAspectOptions.length > 0 && (
                        <ConstraintChip
                          grow
                          openDirection="up"
                          options={frameAspectOptions}
                          value={effectiveFramesAspect ?? frameAspectOptions[0]}
                          onChange={(v) => setFramesAspect(v)}
                          render={(v) => (
                            <span className="flex items-center gap-1.5">
                              <AspectIcon ratio={v} />
                              <span>{v}</span>
                            </span>
                          )}
                        />
                      )}
                      {frameResOptions.length > 0 && (
                        <ConstraintChip
                          grow
                          openDirection="up"
                          options={frameResOptions as string[]}
                          value={(effectiveFramesRes ?? frameResOptions[0]) as string}
                          onChange={(v) => setFramesResolution(v as ImageResolution)}
                          renderOption={(v) => {
                            const credits = formatCredits(estimateCredits(frameImageModelId, { imageCount: 1, resolution: v as ImageResolution }))
                            return (
                              <span className="flex w-full items-center justify-between gap-6">
                                <span>{v}</span>
                                {credits && <span className="text-ink-500">{credits}</span>}
                              </span>
                            )
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>

                {balance !== null && framesOverBudget && (
                  <p className="mt-3 text-[11px] text-red-400 light:text-red-600">
                    Not enough credits. Your balance is {balance.toLocaleString()}.
                  </p>
                )}
              </>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmGen(null)}
                className="flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-1.5 text-[12px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.06]"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmGenerate}
                disabled={confirmGen.kind === 'frames' && frameTargets.length === 0}
                className="flex items-center gap-2 rounded-full border border-white/15 bg-broll-500 py-1.5 pl-4 pr-2 text-[12px] font-medium text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-broll-500"
              >
                {confirmGen.kind === 'clips' ? <VideoIcon className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                {confirmGen.kind === 'clips'
                  ? `Generate ${confirmGen.sceneIndices.length} video${confirmGen.sceneIndices.length === 1 ? '' : 's'}`
                  : frameTargets.length === 0
                    ? 'Generate'
                    : `Generate ${frameImageCount} image${frameImageCount === 1 ? '' : 's'}`}
                {/* The price sits on the button that spends it. */}
                <span className="flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[11px] tabular-nums">
                  <Coins className="h-3 w-3" strokeWidth={2} />
                  {confirmGen.kind === 'clips'
                    ? formatCredits(confirmCredits) ?? '—'
                    : frameTargets.length === 0 || framesCredits == null ? '—' : formatCredits(framesCredits) ?? '—'}
                </span>
              </button>
            </div>
          </div>

          {/* Video-model picker, opened from the batch dialog (clips only).
              Portals to body, so it layers above this dialog cleanly. */}
          {confirmGen.kind === 'clips' && (
            <ModelPickerModal
              appId="broll-studio"
              task="video"
              allowedModelIds={CONTINUOUS_MODEL_IDS}
              value={continuousModelId}
              onChange={(id) => useSettingsStore.getState().setAppModel('broll-studio:continuous:video', id)}
              isOpen={confirmModelPanelOpen}
              onClose={() => setConfirmModelPanelOpen(false)}
              requireMode="frames-to-video"
              requireModeNote="Continuous clips interpolate between two keyframes, so only frame-to-frame models are offered."
              costParams={(() => {
                const c = clipStates[clipKey(confirmGen.sceneIndices[0])]
                return { durationSeconds: c?.durationSeconds ?? 5, resolution: c?.resolution ?? '720p', audio: c?.audio ?? true }
              })()}
            />
          )}
        </div>,
        document.body,
      )}

      {openFrameKey && openFrame && openConcept && openFrameCard && (
        <ContinuousFrameModal
          frameLabel={openFrame.index === result.frames.length ? 'Final Frame' : `Frame ${openFrame.index}`}
          frameNumber={openFrame.index}
          conceptLabel={openConcept.label}
          conceptShot={openConcept.shot}
          scriptLine={result.scenes.find((s) => s.index === openFrame.index)?.scriptLine ?? ''}
          style={result.style}
          cardState={openFrameCard}
          chainImageRef={openFrame.index > 1 ? keyframeRef(openFrame.index - 1) : undefined}
          characterRef={characterRef}
          productRef={productRef}
          productPhotos={productPhotos}
          onChangeStyle={onChangeStyle}
          selectedModel={selectedModel}
          selectedProduct={selectedProduct}
          extraRefs={extraRefs[openFrameKey] ?? []}
          onAddExtraRef={(r) => setExtraRefs((prev) => {
            const cur = prev[openFrameKey] ?? []
            return cur.length >= 4 ? prev : { ...prev, [openFrameKey]: [...cur, r] }
          })}
          onRemoveExtraRef={(i) => setExtraRefs((prev) => ({
            ...prev,
            [openFrameKey]: (prev[openFrameKey] ?? []).filter((_, idx) => idx !== i),
          }))}
          selectedImageIndex={openFrameSel?.conceptId === openConcept.id ? openFrameSel.imageIndex : null}
          onSelectImage={(i) => setSelections((prev) => ({ ...prev, [String(openFrame.index)]: { conceptId: openConcept.id, imageIndex: i } }))}
          onSaveImage={saveKeyframeToBank}
          onClose={() => setOpenFrameKey(null)}
          onUpdate={(updater) => updateFrame(openFrameKey, updater)}
          onGenerate={() => void runFrameImage(openFrameKey)}
          onEnhancePrompt={() => enhanceContinuousFrame(
            frameStates[openFrameKey]?.editablePrompt ?? '',
            openFrameContext(openFrame.index, openConcept.label, openConcept.shot),
            openFrame.index,
          )}
          onRegeneratePrompt={() => regenerateContinuousFrame(
            openFrameContext(openFrame.index, openConcept.label, openConcept.shot),
            openFrame.index,
          )}
          onRetryInFlight={(id) => {
            updateFrame(openFrameKey, (prev) => ({ inFlightImages: prev.inFlightImages.filter((e) => e.id !== id) }))
            void runFrameImage(openFrameKey)
          }}
          onDismissInFlight={(id) => updateFrame(openFrameKey, (prev) => ({ inFlightImages: prev.inFlightImages.filter((e) => e.id !== id) }))}
          animateModelId={continuousAnimateModelId}
          onAnimate={() => void runFrameAnimate(openFrameKey)}
          onDeleteVideo={(i) => updateFrame(openFrameKey, (prev) => ({ videos: prev.videos.filter((_, idx) => idx !== i), currentVideoIndex: Math.max(0, Math.min(prev.currentVideoIndex, prev.videos.length - 2)) }))}
          onRetryVideoInFlight={(id) => {
            updateFrame(openFrameKey, (prev) => ({ inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== id) }))
            void runFrameAnimate(openFrameKey)
          }}
          onDismissVideoInFlight={(id) => updateFrame(openFrameKey, (prev) => ({ inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== id) }))}
        />
      )}

      {openClipKey && openScene && openClipCard && (
        <ContinuousClipModal
          clipLabel={`Clip ${openScene.index}`}
          sceneNumber={openScene.index}
          scriptLine={openScene.scriptLine}
          style={result.style}
          onChangeStyle={onChangeStyle}
          cardState={openClipCard}
          modelId={continuousModelId}
          startImageRef={keyframeRef(openScene.index)}
          endImageRef={keyframeRef(openScene.index + 1)}
          onClose={() => setOpenClipKey(null)}
          onUpdate={(updater) => updateClip(openClipKey, updater)}
          onGenerate={() => void runClipVideo(openScene.index)}
          onEnhanceMotion={() => enhanceContinuousMotion(
            clipStates[openClipKey]?.editablePrompt ?? '',
            motionContextFor(openScene.index),
          )}
          onRegenerateMotion={() => regenerateMotionFromFrame(openScene.index)}
          onSelectVideo={(i) => updateClip(openClipKey, () => ({ currentVideoIndex: i }))}
          onDeleteVideo={(i) => updateClip(openClipKey, (prev) => {
            const videos = prev.videos.filter((_, idx) => idx !== i)
            return { videos, currentVideoIndex: Math.max(0, Math.min(prev.currentVideoIndex, videos.length - 1)) }
          })}
          onRetryInFlight={(id) => {
            updateClip(openClipKey, (prev) => ({ inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== id) }))
            void runClipVideo(openScene.index)
          }}
          onDismissInFlight={(id) => updateClip(openClipKey, (prev) => ({ inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== id) }))}
        />
      )}

      {downloadOpen && (
        <ClipDownloadModal
          entries={allClipEntries}
          zipBasename="continuous-clips"
          subtitle="Every card&rsquo;s cover clip is picked. Tick the extra takes you also want."
          onClose={() => setDownloadOpen(false)}
        />
      )}
    </div>
  )
}

// ── Scene editor ─────────────────────────────────────────────────
// The storyboard's segmentation is a guess the LLM makes before any frame
// exists, and one bad split (a line carrying two visual ideas) used to mean
// regenerating everything. This edits the plan in place: retype the narration,
// split it in two at the cursor, fold it into the next beat, or drop it.

function SceneEditModal({
  scene,
  hasNext,
  canDelete,
  onApply,
  onClose,
}: {
  scene: ContinuousScene
  hasNext: boolean
  canDelete: boolean
  onApply: (op: ContinuousStoryboardOp) => void
  onClose: () => void
}) {
  const [line, setLine] = useState(scene.scriptLine)
  // Where the caret sits, so "Split here" knows where to cut. Seeded to the end
  // so a split with no click lands somewhere harmless rather than at 0.
  const [caret, setCaret] = useState(scene.scriptLine.length)
  const [armedDelete, setArmedDelete] = useState(false)
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  useCloseOnEscape(true, onClose)
  useCloseOnAppSwitch(true, onClose)
  const sceneBackdrop = useBackdropClose(onClose)

  const trimmed = line.trim()
  const head = line.slice(0, caret).trim()
  const tail = line.slice(caret).trim()
  const canSplit = !!head && !!tail && trimmed === scene.scriptLine.trim()
  const dirty = trimmed !== scene.scriptLine.trim()

  const syncCaret = () => setCaret(textRef.current?.selectionStart ?? line.length)

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm" {...sceneBackdrop}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-ink/10 bg-ink-950/95 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-ink-100">Scene {scene.index}</h3>
            <p className="mt-1 text-xs text-ink-500">This line is the voiceover heard over the clip.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          ref={textRef}
          value={line}
          onChange={(e) => { setLine(e.target.value); setCaret(e.target.selectionStart) }}
          onClick={syncCaret}
          onKeyUp={syncCaret}
          onSelect={syncCaret}
          rows={3}
          className="mt-4 w-full resize-none rounded-2xl border border-ink/10 bg-ink/[0.03] px-3.5 py-3 text-sm leading-relaxed text-ink-100 placeholder:text-ink-600 focus:border-ink/20 focus:outline-none"
          placeholder="What the voiceover says over this clip"
        />

        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
          {canSplit
            ? <>Split here → <span className="text-ink-300">&ldquo;{head}&rdquo;</span> then <span className="text-ink-300">&ldquo;{tail}&rdquo;</span>, with a blank keyframe between them to write or regenerate.</>
            : dirty
              ? 'Save the line before splitting it.'
              : 'One scene shows one idea. Put the cursor where the line turns, usually at a “but”, “until” or “then”, to split it in two.'}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!canSplit}
            onClick={() => { onApply({ kind: 'split', sceneIndex: scene.index, at: caret }); onClose() }}
            className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SplitSquareVertical className="h-3.5 w-3.5" />
            Split here
          </button>
          <button
            type="button"
            disabled={!hasNext || dirty}
            title={hasNext ? 'Fold the next scene into this one. The keyframe between them is removed' : 'No scene after this one'}
            onClick={() => { onApply({ kind: 'merge', sceneIndex: scene.index }); onClose() }}
            className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Merge className="h-3.5 w-3.5" />
            Merge with next
          </button>
          {/* Two-click arm rather than a nested confirm dialog — the house
              delete idiom, and this one throws away rendered keyframes. */}
          <button
            type="button"
            disabled={!canDelete}
            onClick={() => {
              if (!armedDelete) { setArmedDelete(true); return }
              onApply({ kind: 'delete', sceneIndex: scene.index })
              onClose()
            }}
            onBlur={() => setArmedDelete(false)}
            title={canDelete ? 'Remove this scene and the keyframe it opens' : 'A storyboard needs at least one scene'}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              armedDelete
                ? 'border-red-500/40 bg-red-500/15 text-red-300 light:text-red-700'
                : 'border-ink/10 bg-ink/[0.03] text-ink-400 hover:border-red-500/30 hover:text-red-300'
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {armedDelete ? 'Confirm delete' : 'Delete scene'}
          </button>
          <button
            type="button"
            disabled={!dirty || !trimmed}
            onClick={() => { onApply({ kind: 'edit', sceneIndex: scene.index, line }); onClose() }}
            className="ml-auto rounded-full bg-broll-500 px-4 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save line
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Scene row — keyframe concepts + the clip into the next frame ──

// Row-level chain switch. Chained (the default) locks the look to the previous
// keyframe; unchained frees every concept on this row to be its own shot, which
// is what you want when the beat stays put and only the framing changes. Frame 1
// has nothing to chain from, so it never renders one.
function ChainToggle({ frameIndex, chainOn, onToggle }: { frameIndex: number; chainOn: boolean; onToggle: () => void }) {
  if (frameIndex <= 1) return null
  return (
    <button
      type="button"
      onClick={onToggle}
      title={
        chainOn
          ? `Chained to Frame ${frameIndex - 1}: every concept here inherits its look. Turn off for genuinely different shots.`
          : `Unchained: concepts here generate from the character, product and style only. More variety, looser continuity.`
      }
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
        chainOn
          ? 'border-broll-500/25 bg-broll-500/10 text-broll-300 hover:bg-broll-500/15'
          : 'border-ink/10 bg-ink/[0.03] text-ink-500 hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-300'
      }`}
    >
      {chainOn ? <Link2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
      {chainOn ? `Chained to ${String(frameIndex - 1).padStart(2, '0')}` : 'Unchained'}
    </button>
  )
}

function SceneRow({
  scene,
  frame,
  nextFramePicked,
  selection,
  frameStates,
  clipState,
  framePicked,
  chainRunning,
  chainOn,
  onToggleChain,
  onEditScene,
  onGenerateFrame,
  onOpenConcept,
  onOpenClip,
  onGenerateConcept,
  onSelectConcept,
  onAddConcept,
  onSaveImage,
}: {
  scene: ContinuousScene
  frame: ContinuousFrame
  nextFramePicked: boolean
  selection?: ContinuousSelection
  frameStates: Record<string, ContinuousFrameCardState>
  clipState?: ContinuousClipCardState
  framePicked: boolean
  chainRunning: boolean
  chainOn: boolean
  onToggleChain: () => void
  onEditScene: () => void
  onGenerateFrame: () => void
  onOpenConcept: (key: string) => void
  onOpenClip: () => void
  onGenerateConcept: (key: string) => void
  onSelectConcept: (conceptId: string) => void
  onAddConcept: () => void
  onSaveImage: (imageRef: string, prompt: string) => Promise<void>
}) {
  return (
    <div className="-m-4 p-4" style={{ contentVisibility: 'auto', containIntrinsicSize: '620px' }}>
      {/* Stacks on a phone — see the note on ScenesView's matching header. */}
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            className="text-5xl font-normal italic tabular-nums text-ink-800"
            style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
          >
            {String(scene.index).padStart(2, '0')}
          </span>
          <div className="h-8 w-px bg-ink/10" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="inline-flex w-fit rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              Scene {scene.index}
            </span>
            {/* The line is the edit affordance: click it to retype, split,
                merge or delete the beat. A storyboard the user can't fix is a
                storyboard they have to regenerate from scratch. */}
            <button
              type="button"
              onClick={onEditScene}
              title="Edit this scene: retype, split, merge or delete"
              className="group/line flex min-w-0 items-center gap-2 text-left"
            >
              <span
                className="truncate text-lg font-normal not-italic leading-relaxed text-ink-400 transition-colors group-hover/line:text-ink-200"
                style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
              >
                &ldquo;{scene.scriptLine}&rdquo;
              </span>
              <Pencil className="h-3.5 w-3.5 shrink-0 text-ink-700 opacity-0 transition-opacity group-hover/line:opacity-100" />
            </button>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ChainToggle frameIndex={frame.index} chainOn={chainOn} onToggle={onToggleChain} />
          <button
            type="button"
            onClick={onGenerateFrame}
            disabled={chainRunning}
            title={framePicked
              ? 'Render this scene\'s concepts again. The keyframe moves onto the fresh image'
              : 'Render every concept for this scene'}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {framePicked ? <RefreshCw className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
            {framePicked ? 'Regenerate frame' : 'Generate frame'}
          </button>
        </div>
      </div>

      {/* Image concepts stay in their own grid (rows of four at xl); the clip
          sits in a fixed column on the right, divided off by a vertical rule.
          Added concepts wrap below the images and never under the clip. The
          inner grid shares the outer gap, so a concept card is exactly one
          outer column wide — matching the clip. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <div className="col-span-2 md:col-span-3 xl:col-span-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {frame.concepts.map((concept, i) => (
              <FrameConceptCard
                key={concept.id}
                optionNumber={i + 1}
                label={concept.label}
                shot={concept.shot}
                cardState={frameStates[frameKey(frame.index, concept.id)]}
                isKeyframe={selection?.conceptId === concept.id}
                keyframeImageIndex={selection?.conceptId === concept.id ? selection.imageIndex : undefined}
                onOpen={() => onOpenConcept(frameKey(frame.index, concept.id))}
                onGenerate={() => onGenerateConcept(frameKey(frame.index, concept.id))}
                onSelect={() => onSelectConcept(concept.id)}
                onSaveImage={onSaveImage}
              />
            ))}
            <AddConceptCard onAdd={onAddConcept} />
          </div>
        </div>
        {/* Clip column — top-aligned so it holds its place while concepts wrap
            below, with a vertical separator centered in the gap on its left. */}
        <div className="relative col-span-1 self-start xl:col-span-1">
          <div className="pointer-events-none absolute inset-y-0 -left-1.5 hidden w-px bg-ink/15 xl:block" />
          <ClipCard
            sceneIndex={scene.index}
            clipState={clipState}
            startPicked={!!selection}
            endPicked={nextFramePicked}
            startRef={selection ? frameStates[frameKey(scene.index, selection.conceptId)]?.images[selection.imageIndex]?.imageUrl : undefined}
            onOpen={onOpenClip}
          />
        </div>
      </div>
    </div>
  )
}

function FinalFrameRow({
  frame,
  selection,
  frameStates,
  chainRunning,
  chainOn,
  onToggleChain,
  onGenerateFrame,
  onOpenConcept,
  onGenerateConcept,
  onSelectConcept,
  onAddConcept,
  onSaveImage,
}: {
  frame: ContinuousFrame
  selection?: ContinuousSelection
  frameStates: Record<string, ContinuousFrameCardState>
  chainRunning: boolean
  chainOn: boolean
  onToggleChain: () => void
  onGenerateFrame: () => void
  onOpenConcept: (key: string) => void
  onGenerateConcept: (key: string) => void
  onSelectConcept: (conceptId: string) => void
  onAddConcept: () => void
  onSaveImage: (imageRef: string, prompt: string) => Promise<void>
}) {
  const framePicked = !!selection
  return (
    <div className="-m-4 p-4" style={{ contentVisibility: 'auto', containIntrinsicSize: '620px' }}>
      {/* Stacks on a phone — see the note on ScenesView's matching header. */}
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            className="text-5xl font-normal italic tabular-nums text-ink-800"
            style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
          >
            {String(frame.index).padStart(2, '0')}
          </span>
          <div className="h-8 w-px bg-ink/10" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="inline-flex w-fit rounded-full border border-broll-500/25 bg-broll-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-broll-300">
              Final Frame
            </span>
            <p
              className="text-lg font-normal not-italic leading-relaxed text-ink-400"
              style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
            >
              The end state the last clip lands on
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ChainToggle frameIndex={frame.index} chainOn={chainOn} onToggle={onToggleChain} />
          <button
            type="button"
            onClick={onGenerateFrame}
            disabled={chainRunning}
            title={framePicked
              ? 'Render the final frame\'s concepts again. The keyframe moves onto the fresh image'
              : 'Render every concept for the final frame'}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {framePicked ? <RefreshCw className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
            {framePicked ? 'Regenerate frame' : 'Generate frame'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {frame.concepts.map((concept, i) => (
          <FrameConceptCard
            key={concept.id}
            optionNumber={i + 1}
            label={concept.label}
            shot={concept.shot}
            cardState={frameStates[frameKey(frame.index, concept.id)]}
            isKeyframe={selection?.conceptId === concept.id}
            keyframeImageIndex={selection?.conceptId === concept.id ? selection.imageIndex : undefined}
            onOpen={() => onOpenConcept(frameKey(frame.index, concept.id))}
            onGenerate={() => onGenerateConcept(frameKey(frame.index, concept.id))}
            onSelect={() => onSelectConcept(concept.id)}
            onSaveImage={onSaveImage}
          />
        ))}
        <AddConceptCard onAdd={onAddConcept} />
      </div>
    </div>
  )
}

// ── Frame concept card ─────────────────────────────────────────
// One staging of a keyframe. Face shows the generated image (or the prompt,
// faded, before any gen). The chosen keyframe carries an accent ring + badge.

function FrameConceptCard({
  optionNumber,
  label,
  shot,
  cardState,
  isKeyframe,
  keyframeImageIndex,
  onOpen,
  onGenerate,
  onSelect,
  onSaveImage,
}: {
  optionNumber: number
  label: string
  shot?: string
  cardState?: ContinuousFrameCardState
  isKeyframe: boolean
  keyframeImageIndex?: number
  onOpen: () => void
  onGenerate: () => void
  onSelect: () => void
  onSaveImage: (imageRef: string, prompt: string) => Promise<void>
}) {
  // Show the keyframe image when this concept is the pick, else the latest.
  const displayIndex = keyframeImageIndex ?? Math.max(0, (cardState?.images.length ?? 1) - 1)
  const image = cardState?.images[Math.min(displayIndex, Math.max(0, (cardState?.images.length ?? 1) - 1))]
  const imageUrl = useAssetUrl(image?.imageUrl ?? '')
  const activeInFlight = cardState?.inFlightImages.find((e) => !e.error)
  const inFlight = !!activeInFlight
  const errored = cardState?.inFlightImages.some((e) => e.error) ?? false
  const hasImage = (cardState?.images.length ?? 0) > 0
  // Keyframe entries only learn their model once createTask returns; name the
  // configured one until then so the label doesn't pop in late.
  const persistedFrameModel = useSettingsStore((s) => s.getAppModel('broll-studio:image:text-to-image'))
  const frameImageModelId = persistedFrameModel ?? getDefaultModel('broll-studio', 'image', 'text-to-image')?.id

  // Card-face quick actions — mirror the Line-by-Line image card's hover stack
  // (download · save · copy). Keyframe stills are reusable start frames, so
  // they're saveable to the B-Rolls bank. No trash (structural card).
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const handleDownload = async () => {
    if (!image) return
    const resolved = await getUrl(image.imageUrl)
    if (!resolved) { useAppStore.getState().addToast('Could not load the image.', 'error'); return }
    await downloadImage(resolved, `continuous-keyframe-${optionNumber}`, 'png')
  }
  const handleSave = async () => {
    if (!image || saved || saving) return
    setSaving(true)
    try {
      await onSaveImage(image.imageUrl, image.prompt)
      setSaved(true)
      useAppStore.getState().addToast('Saved to B-Rolls bank', 'success')
    } catch (err) {
      useAppStore.getState().addToast(humanizeError(err, 'Save failed'), 'error')
    } finally {
      setSaving(false)
    }
  }
  const handleCopy = async () => {
    const text = (image?.prompt ?? cardState?.editablePrompt ?? '').trim()
    if (!text) return
    if (await copyToClipboard(text)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }
  }

  return (
    <div className="group flex flex-col gap-1.5">
      <div
        onClick={onOpen}
        className={`relative aspect-[9/16] cursor-pointer overflow-hidden rounded-xl border bg-ink/[0.02] transition-all hover:-translate-y-px card-soft-shadow ${
          isKeyframe ? 'border-broll-400/70 ring-2 ring-broll-500/30' : 'border-ink/[0.08] hover:border-ink/15'
        }`}
      >
        {inFlight ? (
          <GeneratingMediaFill
            kind="image"
            modelId={activeInFlight?.modelId ?? frameImageModelId}
            prompt={cardState?.editablePrompt}
            messages={KEYFRAME_MESSAGES}
          />
        ) : image && imageUrl ? (
          <>
            <img src={imageUrl} alt={label} className="absolute inset-0 h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />
            {cardState && cardState.images.length > 1 && (
              <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white transition-opacity group-hover:opacity-0">
                {Math.min(displayIndex, cardState.images.length - 1) + 1}/{cardState.images.length}
              </span>
            )}
          </>
        ) : cardState?.editablePrompt.trim() ? (
          <>
            <div className="flex h-full w-full flex-col px-3 pb-3 pt-9">
              <p
                className="flex-1 overflow-hidden whitespace-pre-wrap text-[11px] leading-relaxed tracking-tight text-ink-400"
                style={{ maskImage: 'linear-gradient(to bottom, #000 72%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 72%, transparent)' }}
              >
                {cardState.editablePrompt}
              </p>
            </div>
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

        {/* Top-centre pill — which option this is. Stays visible on hover, which
            means it is also on screen while the card is generating: no
            `backdrop-filter` here, since one over the generating backdrop
            re-samples its patch every frame, once per option tile. A slightly
            heavier flat fill reads the same over a soft wash. */}
        <span className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full border border-ink/15 bg-ink/15 px-2 py-0.5 text-[10px] font-medium tracking-tight text-ink-300">
          Option {optionNumber}
        </span>

        {isKeyframe && (
          <span className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-broll-500 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
            <Check className="h-2.5 w-2.5" strokeWidth={3} /> Keyframe
          </span>
        )}
        {errored && !inFlight && (
          <span className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-red-400/40 bg-red-500/30 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-red-100 transition-opacity group-hover:opacity-0">
            <AlertCircle className="h-2.5 w-2.5" /> Failed
          </span>
        )}

        {/* Hover action stack — top-right, app-wide order: download · save ·
            copy · regenerate. Stills only (keyframes), so no send-to-Playground;
            no trash (structural card). Shown once an image exists. Regenerate
            lives HERE rather than in the bottom row it used to share with "Use
            as keyframe" — a 32px icon in the stack isn't in the way of the pick,
            and it appends a new image (the keyframe pick is pinned by index, so
            it survives). */}
        {hasImage && (
          <TileActionStack>
            <TileActionButton
              title="Download image"
              onClick={() => { void handleDownload() }}
            >
              <Download className="h-4 w-4" />
            </TileActionButton>
            <TileActionButton
              title={saved ? 'Saved to B-Rolls bank' : saving ? 'Saving…' : 'Save to B-Rolls bank'}
              tone={saved ? 'saved' : 'default'}
              onClick={() => { void handleSave() }}
            >
              {saved ? <Check className="h-4 w-4" /> : saving ? <Spinner className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            </TileActionButton>
            <TileActionButton
              title={copied ? 'Prompt copied' : 'Copy prompt'}
              onClick={() => { void handleCopy() }}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
            </TileActionButton>
            <TileActionButton
              title="Generate another image for this concept"
              onClick={() => onGenerate()}
            >
              <RefreshCw className="h-4 w-4" />
            </TileActionButton>
          </TileActionStack>
        )}

        {/* Which model drew this keyframe, bottom-left over the scrim. Fades on
            hover — the Generate / Use-as-keyframe row lands on the same strip. */}
        {image && imageUrl && (
          <ModelPill
            variant="media"
            modelId={image.modelId}
            className="absolute bottom-2 left-2 z-10 max-w-[70%] transition-opacity group-hover:opacity-0"
          />
        )}

        {/* Hover action row. Before any image → Generate. Once an image exists →
            "Use as keyframe" (select) only — the full-width regenerate button
            that used to sit here was removed because a stray click over an
            existing keyframe cost credits; re-rendering is the stack icon above
            (and the card's detail modal). The chosen keyframe shows nothing
            (its badge marks it). */}
        <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!hasImage ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onGenerate() }}
              title="Generate an image for this concept"
              // Scripts' "Send to B-Roll" aesthetic — tinted accent fill, accent
              // text, soft accent border. It only ever sits on an empty card
              // face (no image yet), so the translucent fill stays readable;
              // buttons that overlay real media keep the black/60 chrome.
              className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full border border-broll-500/20 bg-broll-500/10 text-[12px] font-medium tracking-tight text-broll-400 transition-colors hover:bg-broll-500/20"
            >
              <ImageIcon className="h-4 w-4" strokeWidth={1.75} />
              Generate image
            </button>
          ) : !isKeyframe ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSelect() }}
              title="Use this image as the keyframe"
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-white/25 bg-broll-500/85 text-[11px] font-semibold text-white transition-colors hover:border-broll-300/70 hover:bg-broll-400"
            >
              <Check className="h-3.5 w-3.5" />
              Use as keyframe
            </button>
          ) : null}
        </div>
      </div>

      {/* Idea slug, plus the concept's assigned shot class. The chip is how the
          user sees at a glance that a frame really does offer a wide, a macro
          and a character-scale option rather than three near-identical crops. */}
      <div className="flex items-center justify-center gap-1.5">
        {shot && (
          <span className="shrink-0 rounded-full border border-ink/10 bg-ink/[0.04] px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-ink-400">
            {shot}
          </span>
        )}
        <p className="truncate text-[10px] font-medium tracking-wider text-ink-500" title={label}>
          {label}
        </p>
      </div>
    </div>
  )
}

// ── Clip card — the animated clip between two keyframes ────────

function ClipCard({
  sceneIndex,
  clipState,
  startPicked,
  endPicked,
  startRef,
  onOpen,
}: {
  sceneIndex: number
  clipState?: ContinuousClipCardState
  startPicked: boolean
  endPicked: boolean
  startRef?: string
  onOpen: () => void
}) {
  const currentVideo = clipState && clipState.videos.length > 0
    ? clipState.videos[Math.min(clipState.currentVideoIndex, clipState.videos.length - 1)]
    : undefined
  const videoUrl = useAssetUrl(currentVideo?.url ?? '')
  const startUrl = useAssetUrl(startRef ?? '')
  const activeClipInFlight = clipState?.inFlightVideos.find((e) => !e.error)
  const inFlight = !!activeClipInFlight
  const errored = clipState?.inFlightVideos.some((e) => e.error) ?? false
  const ready = startPicked && endPicked

  // Inline playback on the card face — mirrors Line-by-Line's VariationCard.
  // Hover autoplays muted; an explicit Play click is a user gesture, so it
  // plays with sound and keeps playing after the mouse leaves. One clip plays
  // app-wide, so starting this one stops whatever was running.
  const inline = useInlineVideo()
  const { playing, unmuted } = inline
  const [copied, setCopied] = useState(false)
  const controlsExpanded = playing || unmuted
  const handleDownload = async () => {
    if (!currentVideo) return
    const resolved = await getUrl(currentVideo.url)
    if (!resolved) { useAppStore.getState().addToast('Could not load the video.', 'error'); return }
    await downloadImage(resolved, `continuous-clip-${sceneIndex}`, 'mp4')
  }
  const handleCopy = async () => {
    const text = (currentVideo?.prompt ?? '').trim()
    if (!text) return
    if (await copyToClipboard(text)) { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }
  }

  return (
    <div className="group flex flex-col gap-1.5">
      <div
        onClick={onOpen}
        {...inline.hoverProps}
        className="relative aspect-[9/16] cursor-pointer overflow-hidden rounded-xl border-2 border-broll-500/80 bg-broll-500/[0.06] transition-all hover:border-broll-500 hover:-translate-y-px card-soft-shadow"
      >
        {inFlight ? (
          <GeneratingMediaFill
            kind="video"
            modelId={activeClipInFlight?.modelId}
            prompt={clipState?.editablePrompt}
            messages={INTERPOLATE_MESSAGES}
          />
        ) : currentVideo && videoUrl ? (
          <>
            <video
              {...inline.videoProps}
              src={videoUrl}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />
            {/* Always-visible play/pause — top-left. On click, plays with audio
                in place (stopPropagation keeps the detail modal from opening). */}
            <button
              type="button"
              title={inline.watching ? 'Pause' : 'Play with sound'}
              onClick={inline.togglePlay}
              className="absolute left-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
            >
              {inline.watching ? <Pause className="h-3.5 w-3.5 fill-white" /> : <Play className="h-3.5 w-3.5 fill-white" />}
            </button>
            {controlsExpanded && (
              <button
                type="button"
                title={unmuted ? 'Mute' : 'Unmute'}
                onClick={inline.toggleMute}
                className="absolute left-11 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
              >
                {unmuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              </button>
            )}
            {clipState && clipState.videos.length > 1 && (
              <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white transition-opacity group-hover:opacity-0">
                {Math.min(clipState.currentVideoIndex, clipState.videos.length - 1) + 1}/{clipState.videos.length}
              </span>
            )}
          </>
        ) : ready ? (
          <>
            {startUrl && (
              <img src={startUrl} alt="Start frame" className="absolute inset-0 h-full w-full object-cover opacity-35" />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
              <span className="flex items-center gap-1.5 text-broll-300">
                <ImageIcon className="h-4 w-4" />
                <ArrowRight className="h-3.5 w-3.5" />
                <ImageIcon className="h-4 w-4" />
              </span>
              <p className="text-[11px] font-medium text-ink-300">Keyframes ready</p>
              <p className="text-[10px] leading-relaxed text-ink-500">{clipState?.editablePrompt.split('\n')[0]}</p>
            </div>
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
            <VideoIcon className="h-7 w-7 text-ink-700" strokeWidth={1.5} />
            <p className="text-[11px] leading-relaxed text-ink-500">
              Pick keyframes for Frame {sceneIndex}{startPicked ? ' ✓' : ''} &amp; Frame {sceneIndex + 1}{endPicked ? ' ✓' : ''}
            </p>
          </div>
        )}

        <span className={`pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full border border-broll-500/30 bg-broll-500/15 px-2 py-0.5 text-[10px] font-medium tracking-tight text-broll-300 transition-opacity ${controlsExpanded ? 'opacity-0' : ''}`}>
          Clip {sceneIndex}
        </span>
        {errored && !inFlight && (
          <span className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-red-400/40 bg-red-500/30 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-red-100 transition-opacity group-hover:opacity-0">
            <AlertCircle className="h-2.5 w-2.5" /> Failed
          </span>
        )}

        {/* Hover action stack — top-right, app-wide order: download · copy ·
            send-to-Playground. No save (video) and no trash (structural card).
            Stays put while the clip plays with sound — watching a take is when
            you decide to keep it, and it's clear of the play/mute buttons. */}
        {currentVideo && (
          <TileActionStack>
            <TileActionButton
              title="Download video"
              onClick={() => { void handleDownload() }}
            >
              <Download className="h-4 w-4" />
            </TileActionButton>
            <TileActionButton
              title={copied ? 'Prompt copied' : 'Copy prompt'}
              onClick={() => { void handleCopy() }}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
            </TileActionButton>
            <TileActionButton
              title="Use in Playground as a source clip"
              onClick={() => { void sendClipToPlayground(currentVideo) }}
            >
              <Film className="h-4 w-4" />
            </TileActionButton>
            {videoUrl && (
              <ExpandVideoButton
                videoUrl={videoUrl}
                prompt={currentVideo.prompt}
                fileStem={`continuous-clip-${sceneIndex}`}
                aspectRatio={currentVideo.aspectRatio}
              />
            )}
          </TileActionStack>
        )}

        {/* Which model rendered this take, bottom-left over the scrim. Fades on
            hover — the Open shortcut lands on the same strip. */}
        {currentVideo && videoUrl && (
          <ModelPill
            variant="media"
            modelId={currentVideo.modelId}
            className="absolute bottom-2 left-2 z-10 max-w-[70%] transition-opacity group-hover:opacity-0"
          />
        )}

        {/* Bottom shortcut into the workspace — only once there's a clip to
            open. Before that the card is covered by its own copy ("Pick
            keyframes for Frame N" / "Keyframes ready") and the whole face is
            already clickable, so a button just crowded it. */}
        {currentVideo && (
          <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpen() }}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-white/25 bg-black/60 text-[11px] font-semibold text-white transition-colors hover:border-broll-300/70 hover:bg-broll-500"
            >
              <VideoIcon className="h-3.5 w-3.5" />
              Open
            </button>
          </div>
        )}
      </div>

      <p className="text-center text-[10px] font-medium tracking-wider text-ink-500">
        {clipState?.durationSeconds ?? '—'}s
      </p>
    </div>
  )
}

// ── Add-concept card ───────────────────────────────────────────

// Adding a concept drops a blank card synchronously (no LLM call), so there is
// no pending state to show.
function AddConceptCard({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      title="Add a blank concept. Open it to write or generate a prompt"
      className="group/add flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink/20 bg-ink/[0.03] transition-colors hover:border-broll-400/60 hover:bg-broll-500/10"
    >
      <Plus className="h-4 w-4 shrink-0 text-ink-400 transition-colors group-hover/add:text-broll-300" />
      <span className="px-3 text-center text-[11px] font-medium text-ink-400 transition-colors group-hover/add:text-broll-300">
        Add concept
      </span>
    </button>
  )
}
