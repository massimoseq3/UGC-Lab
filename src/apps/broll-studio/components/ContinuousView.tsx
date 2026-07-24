import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Box,
  AlertCircle,
  Loader2,
  Sparkles,
  Image as ImageIcon,
  Video as VideoIcon,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Plus,
  Coins,
  Check,
  X,
  ArrowRight,
  Download,
  Copy,
  Bookmark,
  Film,
  ChevronRight,
  Star,
} from 'lucide-react'
import GenerationProgress from '../../../components/GenerationProgress'
import GeneratingBackdrop from '../../../components/GeneratingBackdrop'
import ModelPicker from '../../../components/ModelPicker'
import ModelSidePanel from '../../../components/ModelSidePanel'
import ProviderLogo from '../../../components/ProviderLogo'
import SavingsPill from '../../../components/SavingsPill'
import ConstraintChip from '../../../components/ConstraintChip'
import AspectIcon from '../../../components/AspectIcon'
import { ContinuousFrameModal, ContinuousClipModal } from './ContinuousDetailModals'
import type {
  ContinuousResult,
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
import { startImageTask, finishImageTask } from '../services/generateBroll'
import { startVideoTask, finishVideoTask } from '../services/generateVideo'
import { claimTask, releaseTask } from '../services/taskRegistry'
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
import { getAsBase64, getUrl, isAssetRef } from '../../../utils/assetStore'
import { getModel, getDefaultModel, snapVideoDurationUp, estimateCredits, formatCredits, officialSavingsPercent, type VideoMode, type ImageResolution } from '../../../utils/models'
import { humanizeError } from '../../../utils/friendlyError'
import { downloadImage } from '../../../utils/downloadImage'
import { downloadAssetsZip } from '../../../utils/downloadZip'
import { copyToClipboard } from '../../../utils/clipboard'
import { sendClipToPlayground } from '../services/sendClipToPlayground'

// Every clip is silent narration-wise — the voiceover and music land in the
// edit. Appended to the motion prompt at fire time so hand-edits can't drop it.
const CLIP_AUDIO_RULE = 'No dialogue, no narration, no music — only the named sound effect and natural ambience.'

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
  addingConceptFrame: number | null
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
  addingConceptFrame,
}: ContinuousViewProps) {
  // Open modal: a frame concept ("3:cont-xxx") or a clip ("c2").
  const [openFrameKey, setOpenFrameKey] = useState<string | null>(null)
  const [openClipKey, setOpenClipKey] = useState<string | null>(null)
  // Extra user-attached reference images per frame card (memory-only, like the
  // Line-by-Line card's extraRefs — data: URIs are too big to persist).
  const [extraRefs, setExtraRefs] = useState<Record<string, ReferenceImage[]>>({})
  // Pending generate request awaiting cost confirmation.
  const [confirmGen, setConfirmGen] = useState<
    | { kind: 'clips'; sceneIndices: number[]; scope: string }
    | { kind: 'frames'; fresh: number[]; done: number[] }
    | null
  >(null)
  // Frames branch only: opt into regenerating frames that already have a picked
  // keyframe (mirrors Line-by-Line's "also regenerate" toggle).
  const [includeExisting, setIncludeExisting] = useState(false)
  const [downloadingAll, setDownloadingAll] = useState(false)
  // Video-model slide-in panel opened from inside the batch-generate dialog.
  const [confirmModelPanelOpen, setConfirmModelPanelOpen] = useState(false)
  const balance = useCreditsStore((s) => s.balance)
  useCloseOnAppSwitch(!!confirmGen, () => setConfirmGen(null))

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
        for (const concept of frame.concepts) {
          const key = frameKey(frame.index, concept.id)
          next[key] = prev[key] ?? createDefaultContinuousFrameState(concept)
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

  // Auto-sync each clip's motion to its START frame's picked concept, until the
  // user hand-edits it. Clip N starts on frame N (same index as the scene), so a
  // keyframe pick on frame N carries THAT staging's departure motion into the
  // clip. Motion is now a per-concept property, so the right prompt is ready the
  // moment the keyframe is chosen — no per-pair generation, no stale generic text.
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

  // Motion-tool context for a clip: its own narration line + where the story
  // goes next (direction only — the tools never paint the end frame).
  const motionContextFor = (sceneIndex: number) => ({
    scriptLine: result?.scenes.find((s) => s.index === sceneIndex)?.scriptLine ?? '',
    nextScriptLine: result?.scenes.find((s) => s.index === sceneIndex + 1)?.scriptLine,
  })

  // Vision regenerate reads the clip's ACTUAL chosen start keyframe image.
  const regenerateMotionFromFrame = async (sceneIndex: number): Promise<string> => {
    const startRef = keyframeRef(sceneIndex)
    if (!startRef) throw new Error('Pick a start keyframe for this clip first.')
    const dataUri = await toDataUri(startRef)
    if (!dataUri) throw new Error('Could not load the start keyframe image.')
    return regenerateContinuousMotion(dataUri, motionContextFor(sceneIndex))
  }

  const guardDemo = (): boolean => {
    if (result?.demo) {
      useAppStore.getState().addToast('This is a sample storyboard — add your kie.ai key in Settings to generate', 'info')
      return true
    }
    return false
  }

  // The chosen keyframe image ref for a frame slot, or undefined.
  const keyframeRef = (frameIndex: number): string | undefined => {
    const sel = selectionsRef.current[String(frameIndex)]
    if (!sel) return undefined
    const card = frameStatesRef.current[frameKey(frameIndex, sel.conceptId)]
    return card?.images[sel.imageIndex]?.imageUrl
  }

  const toDataUri = async (ref: string): Promise<string | null> => {
    if (!isAssetRef(ref)) return ref
    const asset = await getAsBase64(ref)
    if (!asset) return null
    return `data:${asset.mimeType};base64,${asset.base64}`
  }

  // ── Keyframe image generation (chained) ──────────────────────
  // Returns true on success so the sequential "Generate frames" walk can chain.
  const runFrameImage = async (
    key: string,
    override?: { aspectRatio: string; resolution: ImageResolution },
    repick = false,
  ): Promise<boolean> => {
    if (!result || guardDemo()) return false
    const card = frameStatesRef.current[key]
    if (!card || !card.editablePrompt.trim()) return false
    const frameIndex = Number(key.split(':')[0])
    // Batch runs choose one resolution/aspect for the whole chain; a single-card
    // generate (from the modal) passes no override and keeps the card's own.
    const aspectRatio = override?.aspectRatio ?? card.aspectRatio
    const resolution = override?.resolution ?? card.resolution

    // Chain reference: the previous frame's chosen keyframe. First in the ref
    // list so the preamble's "FIRST attached image" clause holds.
    const chainRefUrl = card.chainLink && frameIndex > 1 ? keyframeRef(frameIndex - 1) : undefined
    const cardExtras = extraRefs[key] ?? []
    const refs: ReferenceImage[] = [
      ...(chainRefUrl ? [{ dataUrl: chainRefUrl, label: 'style' }] : []),
      ...(card.refsCharacter && characterRef ? [characterRef] : []),
      ...(card.refsProduct && productRef ? [productRef] : []),
      ...cardExtras,
    ]
    const preamble = refs.length > 0
      ? buildContinuousPreamble({
          chain: !!chainRefUrl,
          character: !!(card.refsCharacter && characterRef),
          product: !!(card.refsProduct && productRef),
          extras: cardExtras.length,
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
      useAppStore.getState().addToast(`Image generation failed: ${msg}`, 'error')
      return false
    }

    // Own this poll before the taskId is persisted — see taskRegistry.
    if (!claimTask('image', taskId)) return false
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
      setSelections((prev) => {
        if (!repick && prev[String(frameIndex)]) return prev
        return { ...prev, [String(frameIndex)]: { conceptId: key.slice(key.indexOf(':') + 1), imageIndex: newIndex } }
      })
      return true
    } catch (err) {
      const msg = humanizeError(err, 'Image generation failed. Try again.')
      updateFrame(key, (prev) => ({
        inFlightImages: prev.inFlightImages.map((e) => (e.id === inFlightId ? { ...e, error: msg } : e)),
      }))
      useAppStore.getState().addToast(`Image generation failed: ${msg}`, 'error')
      return false
    } finally {
      releaseTask('image', taskId)
    }
  }

  // Sequential chain-generate: walk the frames in order so each generation can
  // reference the previous keyframe. Skips frames that already have one.
  const [chainRunning, setChainRunning] = useState(false)
  const runAllFrames = async (
    frameIndices: number[],
    override?: { aspectRatio: string; resolution: ImageResolution },
    includeExisting = false,
  ) => {
    if (!result || chainRunning) return
    setChainRunning(true)
    try {
      // Always walk in index order so each frame can chain off the previous
      // frame's (possibly just-regenerated) keyframe.
      const ordered = [...frameIndices].sort((a, b) => a - b)
      for (const frameIndex of ordered) {
        const frame = result.frames.find((f) => f.index === frameIndex)
        if (!frame || frame.concepts.length === 0) continue
        const picked = selectionsRef.current[String(frameIndex)]
        if (picked) {
          // Already has a keyframe. Skip unless the user opted to regenerate —
          // then re-run the picked concept and move the keyframe onto the new image.
          if (!includeExisting) continue
          const ok = await runFrameImage(frameKey(frameIndex, picked.conceptId), override, true)
          if (!ok) {
            useAppStore.getState().addToast(`Stopped at Frame ${frameIndex} — fix it and run again.`, 'error')
            break
          }
          await new Promise((r) => setTimeout(r, 0))
          continue
        }
        // Prefer a concept that already has an image (just needs selecting).
        const withImage = frame.concepts.find((c) => (frameStatesRef.current[frameKey(frameIndex, c.id)]?.images.length ?? 0) > 0)
        if (withImage) {
          const card = frameStatesRef.current[frameKey(frameIndex, withImage.id)]!
          setSelections((prev) => ({ ...prev, [String(frameIndex)]: { conceptId: withImage.id, imageIndex: card.currentImageIndex } }))
          // Let the ref effect observe the new selection before the next loop.
          await new Promise((r) => setTimeout(r, 0))
          continue
        }
        const ok = await runFrameImage(frameKey(frameIndex, frame.concepts[0].id), override)
        if (!ok) {
          useAppStore.getState().addToast(`Stopped at Frame ${frameIndex} — fix it and run again.`, 'error')
          break
        }
        await new Promise((r) => setTimeout(r, 0))
      }
    } finally {
      setChainRunning(false)
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
          aspectRatio: '9:16',
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
        aspectRatio: '9:16',
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

      const res = await finishVideoTask(taskId, continuousModelId, videoEndpoint, durationSeconds, '9:16')
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
      useAppStore.getState().addToast(`Video generation failed: ${msg}`, 'error')
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
      useAppStore.getState().addToast(`${model.displayName} can't animate a single still — pick a model that takes a start frame or reference images.`, 'error')
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
    const promptText = buildContinuousPrompt(`${motion}\n\n${CLIP_AUDIO_RULE}`, result.style)

    const inFlightId = crypto.randomUUID()
    updateFrame(frameKey, (prev) => ({
      inFlightVideos: [
        ...prev.inFlightVideos,
        { id: inFlightId, taskId: null, modelId: continuousAnimateModelId, startedAt: Date.now(), prompt: promptText, mode: animateMode, aspectRatio: '9:16', durationSeconds, resolution, audio: frameCard.videoAudio },
      ],
    }))

    let claimedTaskId: string | null = null
    try {
      const { taskId, videoEndpoint } = await startVideoTask({
        prompt: promptText,
        mode: animateMode,
        firstFrameDataUri: animateMode === 'image-to-video' ? frameDataUri : undefined,
        referenceDataUris: animateMode === 'reference-to-video' ? [frameDataUri] : undefined,
        aspectRatio: '9:16',
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

      const res = await finishVideoTask(taskId, continuousAnimateModelId, videoEndpoint, durationSeconds, '9:16')
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
      useAppStore.getState().addToast(`Video generation failed: ${msg}`, 'error')
    } finally {
      if (claimedTaskId) releaseTask('video', claimedTaskId)
    }
  }

  // ── Refresh-resume (images + videos) ─────────────────────────
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
            useAppStore.getState().addToast(`Video resume failed: ${msg}`, 'error')
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
  }, [])

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
          <div className="mb-6 flex items-center gap-4">
            <div className="skeleton h-14 w-14 rounded-2xl" />
            <div className="flex flex-col gap-2">
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-3 w-56" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="aspect-[9/16] animate-pulse rounded-2xl border border-ink/5 bg-ink/[0.03]" />
            ))}
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
        <p className="text-xs text-ink-800">Keyframes chain into each other — every clip ends on the next clip's first frame</p>
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
  const anyClipInFlight = Object.values(clipStates).some((c) => c.inFlightVideos.some((e) => !e.error))
  const anyFrameInFlight = Object.values(frameStates).some((c) => c.inFlightImages.some((e) => !e.error))

  const readyClipIndices = result.scenes
    .map((s) => s.index)
    .filter((i) => keyframeRef(i) && keyframeRef(i + 1))

  // Every generated clip across all rows, in scene order, for "Download all".
  const allClipEntries = result.scenes.flatMap((s) => {
    const cs = clipStates[clipKey(s.index)]
    const vids = cs?.videos ?? []
    return vids.map((v, i) => ({
      ref: v.url,
      name: vids.length > 1 ? `clip-${String(s.index).padStart(2, '0')}-take${i + 1}` : `clip-${String(s.index).padStart(2, '0')}`,
    }))
  })

  const downloadAll = async () => {
    if (downloadingAll || allClipEntries.length === 0) return
    setDownloadingAll(true)
    try {
      const n = await downloadAssetsZip(allClipEntries, 'continuous-clips')
      useAppStore.getState().addToast(`Downloading ${n} clip${n === 1 ? '' : 's'} as a zip`, 'success')
    } catch (err) {
      useAppStore.getState().addToast(humanizeError(err, 'Could not download the clips.'), 'error')
    } finally {
      setDownloadingAll(false)
    }
  }

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
      useAppStore.getState().addToast('No clips are ready — pick keyframes first.', 'error')
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
    // accidental.
    setIncludeExisting(false)
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
  const framesPerImage = frameImageModelId
    ? estimateCredits(frameImageModelId, { imageCount: 1, resolution: effectiveFramesRes })
    : null
  const framesCredits = framesPerImage != null ? framesPerImage * frameTargets.length : null
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
    <div className="flex-1 overflow-y-auto px-5 py-4">
      {result.demo && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-broll-500/25 bg-broll-500/10 px-4 py-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-broll-300" />
          <p className="text-xs leading-relaxed text-ink-300">
            <span className="font-semibold text-broll-300">Sample storyboard.</span>{' '}
            This is a preview of what Continuous mode produces. Add your kie.ai key in Settings to storyboard your own script and generate the keyframes and clips.
          </p>
        </div>
      )}

      {/* Top strip — storyboard meta + the two batch actions. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-400">
          <span>{result.scenes.length} {result.scenes.length === 1 ? 'scene' : 'scenes'}</span>
          <span className="rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[10px] text-ink-300">{style.label}</span>
          <span className="rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[10px] text-ink-300">~{totalSeconds}s</span>
          <span className="rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[10px] text-ink-300">{framesPicked}/{result.frames.length} keyframes picked</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => requestFrames()}
            disabled={chainRunning || anyFrameInFlight}
            title="Generate a keyframe image for every frame that doesn't have one yet, chained in order for consistency"
            className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {chainRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            {chainRunning ? 'Chaining frames…' : 'Generate frames'}
          </button>
          <button
            type="button"
            onClick={() => requestClips(readyClipIndices, 'Every ready clip')}
            disabled={anyClipInFlight || readyClipIndices.length === 0}
            title="Generate every clip whose two keyframes are picked"
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-broll-500 px-3.5 py-1.5 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <VideoIcon className="h-3.5 w-3.5" />
            Generate all videos
          </button>
          {allClipEntries.length > 0 && (
            <button
              type="button"
              onClick={() => void downloadAll()}
              disabled={downloadingAll}
              title="Download every generated clip as a single zip"
              className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {downloadingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {downloadingAll ? 'Zipping…' : `Download all (${allClipEntries.length})`}
            </button>
          )}
        </div>
      </div>

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
            addingConcept={addingConceptFrame === scene.index}
            onSaveImage={saveKeyframeToBank}
          />
        ))}

        {/* Final frame — the end state the last clip lands on. No clip cell. */}
        <FinalFrameRow
          frame={finalFrame}
          selection={selections[String(finalFrame.index)]}
          frameStates={frameStates}
          chainRunning={chainRunning}
          onGenerateFrame={() => requestFrames([finalFrame.index])}
          onOpenConcept={setOpenFrameKey}
          onGenerateConcept={(key) => void runFrameImage(key)}
          onSelectConcept={(conceptId) => {
            const card = frameStates[frameKey(finalFrame.index, conceptId)]
            if (!card || card.images.length === 0) return
            setSelections((prev) => ({ ...prev, [String(finalFrame.index)]: { conceptId, imageIndex: card.currentImageIndex } }))
          }}
          onAddConcept={() => onAddConcept(finalFrame.index)}
          addingConcept={addingConceptFrame === finalFrame.index}
          onSaveImage={saveKeyframeToBank}
        />
      </div>

      {/* Cost-confirm popup — clips are expensive; the frame batch is a count
          confirm so a 12-frame chain never fires on a stray click. */}
      {confirmGen && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
          onClick={() => setConfirmGen(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-ink/10 bg-ink-950/95 p-5 shadow-2xl"
          >
            {confirmGen.kind === 'clips' ? (
              <>
                <h3 className="text-sm font-medium text-ink-100">
                  Generate {confirmGen.sceneIndices.length} video{confirmGen.sceneIndices.length === 1 ? '' : 's'}?
                </h3>
                <p className="mt-1 text-xs text-ink-500">
                  {confirmGen.scope} · all render in parallel and survive a refresh.
                </p>

                {/* Model — the frames-to-video model every video in this batch
                    uses. Swapping it here re-costs the run below. */}
                <div className="mt-4 flex flex-col gap-2.5">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Model</span>
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

                <div className="mt-3 flex items-center justify-between rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5 text-xs">
                  <span className="text-ink-400">Estimated cost</span>
                  <span className="flex items-center gap-1 font-medium text-ink-100">
                    <Coins className="h-3 w-3" strokeWidth={2} />
                    {formatCredits(confirmCredits) ?? '— credits'}
                  </span>
                </div>
                {balance !== null && (
                  <p className={`mt-1.5 text-[11px] ${overBudget ? 'text-red-400 light:text-red-600' : 'text-ink-500'}`}>
                    Your balance: {balance.toLocaleString()} credits{overBudget ? ' — not enough' : ''}
                  </p>
                )}
              </>
            ) : (
              <>
                <h3 className="text-sm font-medium text-ink-100">
                  {frameTargets.length === 0
                    ? 'Nothing to generate'
                    : `Generate ${frameTargets.length} keyframe${frameTargets.length === 1 ? '' : 's'}?`}
                </h3>
                <p className="mt-1 text-xs text-ink-500">
                  Frames generate one after another so each can reference the previous keyframe — the chain keeps the style locked.
                  {confirmGen.done.length > 0 && !includeExisting && (
                    <> {confirmGen.done.length} frame{confirmGen.done.length === 1 ? '' : 's'} already
                    {confirmGen.done.length === 1 ? ' has' : ' have'} a keyframe and will be skipped.</>
                  )}
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
                  <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Model</span>
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

                <div className="mt-3 flex items-center justify-between rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5 text-xs">
                  <span className="text-ink-400">Estimated cost</span>
                  <span className="flex items-center gap-1 font-medium text-ink-100">
                    <Coins className="h-3 w-3" strokeWidth={2} />
                    {framesCredits != null ? (formatCredits(framesCredits) ?? '— credits') : '— credits'}
                  </span>
                </div>
                {balance !== null && (
                  <p className={`mt-1.5 text-[11px] ${framesOverBudget ? 'text-red-400 light:text-red-600' : 'text-ink-500'}`}>
                    Your balance: {balance.toLocaleString()} credits{framesOverBudget ? ' — not enough' : ''}
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
                className="flex items-center gap-1.5 rounded-full border border-white/15 bg-broll-500 px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-broll-500"
              >
                {confirmGen.kind === 'clips' ? <VideoIcon className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                Generate
              </button>
            </div>
          </div>

          {/* Video-model slide-in, opened from the batch dialog (clips only).
              Portals to body, so it layers above this dialog cleanly. */}
          {confirmGen.kind === 'clips' && (
            <ModelSidePanel
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
          scriptLine={result.scenes.find((s) => s.index === openFrame.index)?.scriptLine ?? ''}
          style={result.style}
          cardState={openFrameCard}
          chainImageRef={openFrame.index > 1 ? keyframeRef(openFrame.index - 1) : undefined}
          characterRef={characterRef}
          productRef={productRef}
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
            frameContextFor(result, openFrame.index, { productContext, modelContext, conceptLabel: openConcept.label }),
            openFrame.index,
          )}
          onRegeneratePrompt={() => regenerateContinuousFrame(
            frameContextFor(result, openFrame.index, { productContext, modelContext, conceptLabel: openConcept.label }),
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
    </div>
  )
}

// ── Scene row — keyframe concepts + the clip into the next frame ──

function SceneRow({
  scene,
  frame,
  nextFramePicked,
  selection,
  frameStates,
  clipState,
  framePicked,
  chainRunning,
  onGenerateFrame,
  onOpenConcept,
  onOpenClip,
  onGenerateConcept,
  onSelectConcept,
  onAddConcept,
  addingConcept,
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
  onGenerateFrame: () => void
  onOpenConcept: (key: string) => void
  onOpenClip: () => void
  onGenerateConcept: (key: string) => void
  onSelectConcept: (conceptId: string) => void
  onAddConcept: () => void
  addingConcept: boolean
  onSaveImage: (imageRef: string, prompt: string) => Promise<void>
}) {
  return (
    <div className="-m-4 p-4" style={{ contentVisibility: 'auto', containIntrinsicSize: '620px' }}>
      <div className="mb-5 flex items-center justify-between gap-4">
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
            <p
              className="truncate text-lg font-normal not-italic leading-relaxed text-ink-400"
              style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
              title={scene.scriptLine}
            >
              &ldquo;{scene.scriptLine}&rdquo;
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onGenerateFrame}
          disabled={chainRunning || framePicked}
          title={framePicked ? 'A keyframe is already picked for this scene' : 'Generate the keyframe image for this scene'}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {framePicked ? <Check className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
          {framePicked ? 'Frame picked' : 'Generate frame'}
        </button>
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
                cardState={frameStates[frameKey(frame.index, concept.id)]}
                isKeyframe={selection?.conceptId === concept.id}
                keyframeImageIndex={selection?.conceptId === concept.id ? selection.imageIndex : undefined}
                onOpen={() => onOpenConcept(frameKey(frame.index, concept.id))}
                onGenerate={() => onGenerateConcept(frameKey(frame.index, concept.id))}
                onSelect={() => onSelectConcept(concept.id)}
                onSaveImage={onSaveImage}
              />
            ))}
            <AddConceptCard onAdd={onAddConcept} adding={addingConcept} />
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
  onGenerateFrame,
  onOpenConcept,
  onGenerateConcept,
  onSelectConcept,
  onAddConcept,
  addingConcept,
  onSaveImage,
}: {
  frame: ContinuousFrame
  selection?: ContinuousSelection
  frameStates: Record<string, ContinuousFrameCardState>
  chainRunning: boolean
  onGenerateFrame: () => void
  onOpenConcept: (key: string) => void
  onGenerateConcept: (key: string) => void
  onSelectConcept: (conceptId: string) => void
  onAddConcept: () => void
  addingConcept: boolean
  onSaveImage: (imageRef: string, prompt: string) => Promise<void>
}) {
  const framePicked = !!selection
  return (
    <div className="-m-4 p-4" style={{ contentVisibility: 'auto', containIntrinsicSize: '620px' }}>
      <div className="mb-5 flex items-center justify-between gap-4">
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
        <button
          type="button"
          onClick={onGenerateFrame}
          disabled={chainRunning || framePicked}
          title={framePicked ? 'A keyframe is already picked for the final frame' : 'Generate the final keyframe image'}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {framePicked ? <Check className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
          {framePicked ? 'Frame picked' : 'Generate frame'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {frame.concepts.map((concept, i) => (
          <FrameConceptCard
            key={concept.id}
            optionNumber={i + 1}
            label={concept.label}
            cardState={frameStates[frameKey(frame.index, concept.id)]}
            isKeyframe={selection?.conceptId === concept.id}
            keyframeImageIndex={selection?.conceptId === concept.id ? selection.imageIndex : undefined}
            onOpen={() => onOpenConcept(frameKey(frame.index, concept.id))}
            onGenerate={() => onGenerateConcept(frameKey(frame.index, concept.id))}
            onSelect={() => onSelectConcept(concept.id)}
            onSaveImage={onSaveImage}
          />
        ))}
        <AddConceptCard onAdd={onAddConcept} adding={addingConcept} />
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
  const inFlight = cardState?.inFlightImages.some((e) => !e.error) ?? false
  const errored = cardState?.inFlightImages.some((e) => e.error) ?? false
  const hasImage = (cardState?.images.length ?? 0) > 0

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
          <>
            <GeneratingBackdrop family="broll" />
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center">
              <GenerationProgress
                isActive
                color="bg-broll-500"
                showHelper={false}
                messages={['Sending request...', 'Painting the keyframe...', 'Locking the style...', 'Almost there...']}
                className="max-w-[180px]"
              />
            </div>
          </>
        ) : image && imageUrl ? (
          <>
            <img src={imageUrl} alt={label} className="absolute inset-0 h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />
            {cardState && cardState.images.length > 1 && (
              <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white backdrop-blur transition-opacity group-hover:opacity-0">
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

        {/* Top-centre pill — which option this is. Stays visible on hover. */}
        <span className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full border border-ink/15 bg-ink/10 px-2 py-0.5 text-[10px] font-medium tracking-tight text-ink-300 backdrop-blur">
          Option {optionNumber}
        </span>

        {isKeyframe && (
          <span className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-broll-500 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
            <Check className="h-2.5 w-2.5" strokeWidth={3} /> Keyframe
          </span>
        )}
        {errored && !inFlight && (
          <span className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-red-400/40 bg-red-500/30 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-red-100 backdrop-blur transition-opacity group-hover:opacity-0">
            <AlertCircle className="h-2.5 w-2.5" /> Failed
          </span>
        )}

        {/* Hover action stack — top-right, app-wide order: download · save ·
            copy. Stills only (keyframes), so no send-to-Playground; no trash
            (structural card). Shown once an image exists. */}
        {hasImage && (
          <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              title="Download image"
              onClick={(e) => { e.stopPropagation(); void handleDownload() }}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur transition-colors hover:bg-black/50"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={saved ? 'Saved to B-Rolls bank' : saving ? 'Saving…' : 'Save to B-Rolls bank'}
              onClick={(e) => { e.stopPropagation(); void handleSave() }}
              className={`flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur transition-colors ${
                saved ? 'border-emerald-400/50 bg-emerald-500/30 text-emerald-100' : 'border-white/20 bg-black/35 text-white hover:bg-black/50'
              }`}
            >
              {saved ? <Check className="h-3.5 w-3.5" /> : saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              title={copied ? 'Prompt copied' : 'Copy prompt'}
              onClick={(e) => { e.stopPropagation(); void handleCopy() }}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur transition-colors hover:bg-black/50"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}

        {/* Hover action row. Before any image → Generate. Once an image exists →
            "Use as keyframe" (select) only; the regenerate button was removed
            here because a stray click over an existing keyframe wiped it —
            regenerating now lives inside the card's detail modal, one deliberate
            step away. The chosen keyframe shows nothing (its badge marks it). */}
        <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!hasImage ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onGenerate() }}
              title="Generate an image for this concept"
              className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full border border-white/20 bg-black/50 text-[10px] font-medium text-white backdrop-blur transition-colors hover:bg-black/70"
            >
              <ImageIcon className="h-3 w-3" />
              Generate
            </button>
          ) : !isKeyframe ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSelect() }}
              title="Use this image as the keyframe"
              className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full border border-white/20 bg-broll-500/80 text-[10px] font-medium text-white backdrop-blur transition-colors hover:bg-broll-500"
            >
              <Check className="h-3 w-3" />
              Use as keyframe
            </button>
          ) : null}
        </div>
      </div>

      <p className="truncate text-center text-[10px] font-medium tracking-wider text-ink-500" title={label}>
        {label}
      </p>
    </div>
  )
}

// ── Clip card — the transition into the next keyframe ──────────

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
  const inFlight = clipState?.inFlightVideos.some((e) => !e.error) ?? false
  const errored = clipState?.inFlightVideos.some((e) => e.error) ?? false
  const ready = startPicked && endPicked

  // Inline playback on the card face — mirrors Line-by-Line's VariationCard.
  // Hover autoplays muted; an explicit Play click is a user gesture, so it
  // plays with sound and keeps playing after the mouse leaves.
  const videoElRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [unmuted, setUnmuted] = useState(false)
  const [copied, setCopied] = useState(false)
  const controlsExpanded = playing || unmuted
  const togglePlay = () => {
    const v = videoElRef.current
    if (!v) return
    if (v.paused) { setUnmuted(true); v.muted = false; v.play().catch(() => {}) }
    else v.pause()
  }
  const toggleMute = () => {
    const v = videoElRef.current
    setUnmuted((prev) => { const next = !prev; if (v) v.muted = !next; return next })
  }
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
        className="relative aspect-[9/16] cursor-pointer overflow-hidden rounded-xl border-2 border-broll-500/80 bg-broll-500/[0.06] transition-all hover:border-broll-500 hover:-translate-y-px card-soft-shadow"
      >
        {inFlight ? (
          <>
            <GeneratingBackdrop family="broll" />
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center">
              <GenerationProgress
                isActive
                color="bg-broll-500"
                showHelper={false}
                messages={['Sending request...', 'Interpolating frames...', 'Rendering motion...', 'Finalizing the clip...']}
                className="max-w-[180px]"
              />
            </div>
          </>
        ) : currentVideo && videoUrl ? (
          <>
            <video
              ref={videoElRef}
              src={videoUrl}
              muted={!unmuted}
              loop
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onMouseEnter={(e) => { if (!unmuted) (e.currentTarget as HTMLVideoElement).play().catch(() => {}) }}
              onMouseLeave={(e) => { if (!unmuted) { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0 } }}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />
            {/* Always-visible play/pause — top-left. On click, plays with audio
                in place (stopPropagation keeps the detail modal from opening). */}
            <button
              type="button"
              title={playing ? 'Pause' : 'Play with sound'}
              onClick={(e) => { e.stopPropagation(); togglePlay() }}
              className="absolute left-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
            >
              {playing ? <Pause className="h-3.5 w-3.5 fill-white" /> : <Play className="h-3.5 w-3.5 fill-white" />}
            </button>
            {controlsExpanded && (
              <button
                type="button"
                title={unmuted ? 'Mute' : 'Unmute'}
                onClick={(e) => { e.stopPropagation(); toggleMute() }}
                className="absolute left-11 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur transition-colors hover:bg-black/70"
              >
                {unmuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              </button>
            )}
            {clipState && clipState.videos.length > 1 && (
              <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white backdrop-blur transition-opacity group-hover:opacity-0">
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

        <span className={`pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full border border-broll-500/30 bg-broll-500/15 px-2 py-0.5 text-[10px] font-medium tracking-tight text-broll-300 backdrop-blur transition-opacity ${controlsExpanded ? 'opacity-0' : ''}`}>
          Clip {sceneIndex}
        </span>
        {errored && !inFlight && (
          <span className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full border border-red-400/40 bg-red-500/30 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-red-100 backdrop-blur transition-opacity group-hover:opacity-0">
            <AlertCircle className="h-2.5 w-2.5" /> Failed
          </span>
        )}

        {/* Hover action stack — top-right, app-wide order: download · copy ·
            send-to-Playground. No save (video) and no trash (structural card). */}
        {currentVideo && (
          <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              title="Download video"
              onClick={(e) => { e.stopPropagation(); void handleDownload() }}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur transition-colors hover:bg-black/50"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title={copied ? 'Prompt copied' : 'Copy prompt'}
              onClick={(e) => { e.stopPropagation(); void handleCopy() }}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur transition-colors hover:bg-black/50"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              title="Use in Playground as Gemini Omni source clip"
              onClick={(e) => { e.stopPropagation(); void sendClipToPlayground(currentVideo) }}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur transition-colors hover:bg-black/50"
            >
              <Film className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Bottom shortcut into the workspace. */}
        <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen() }}
            className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full border border-white/20 bg-black/50 text-[10px] font-medium text-white backdrop-blur transition-colors hover:bg-black/70"
          >
            <VideoIcon className="h-3 w-3" />
            {currentVideo ? 'Open' : 'Set up & generate'}
          </button>
        </div>
      </div>

      <p className="text-center text-[10px] font-medium tracking-wider text-ink-500">
        {clipState?.durationSeconds ?? '—'}s
      </p>
    </div>
  )
}

// ── Add-concept card ───────────────────────────────────────────

function AddConceptCard({ onAdd, adding }: { onAdd: () => void; adding: boolean }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={adding}
      title="Add a blank concept — open it to write or generate a prompt"
      className="group/add flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink/20 bg-ink/[0.03] transition-colors hover:border-broll-400/60 hover:bg-broll-500/10 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {adding ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-broll-300" />
      ) : (
        <Plus className="h-4 w-4 shrink-0 text-ink-400 transition-colors group-hover/add:text-broll-300" />
      )}
      <span className="px-3 text-center text-[11px] font-medium text-ink-400 transition-colors group-hover/add:text-broll-300">
        {adding ? 'Adding…' : 'Add concept'}
      </span>
    </button>
  )
}
