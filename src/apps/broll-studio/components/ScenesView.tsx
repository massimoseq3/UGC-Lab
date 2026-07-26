import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Film, AlertCircle, Plus, Images, X, Palette, Download, Video as VideoIcon, Coins } from 'lucide-react'
import GenerationProgress from '../../../components/GenerationProgress'
import type { BrollResult, Scene, PromptVariation, CardState, ReferenceImage, BatchVideoSettings } from '../types'
import type { Product, Model } from '../../../stores/types'
import { createDefaultCardState } from '../cardState'
import type { VideoHistoryItem } from '../../../stores/types'
import { finishImageTask, resolveImageModelId } from '../services/generateBroll'
import { getContinuousStyle } from '../services/generateContinuous'
import { finishVideoTask } from '../services/generateVideo'
import { claimTask, releaseTask } from '../services/taskRegistry'
import { isPollTimeout } from '../../../utils/kie'
import { useBankStore } from '../../../stores/bankStore'
import { useAppStore } from '../../../stores/appStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useCreditsStore } from '../../../stores/creditsStore'
import { getDefaultModel, getModel, estimateCredits, formatCredits, snapVideoDuration, videoResolutionLabel, type ImageResolution, type Mode } from '../../../utils/models'
import ModelPicker from '../../../components/ModelPicker'
import ConstraintChip from '../../../components/ConstraintChip'
import AspectIcon from '../../../components/AspectIcon'
import VariationCard from './VariationCard'
import { humanizeError } from '../../../utils/friendlyError'
import ClipDownloadModal, { type ClipDownloadEntry } from './ClipDownloadModal'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'

interface ScenesViewProps {
  result: BrollResult | null
  isGenerating?: boolean
  error?: string | null
  onAddVariation: (sceneNumber: number, variation: PromptVariation) => void
  onDeleteVariation: (sceneNumber: number, variationId: string) => void
  // Edit the ad's shared dialogue voice profile (from a dialogue card's modal).
  onUpdateVoiceProfile?: (text: string) => void
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
  selectedProduct?: Product | null
  selectedModel?: Model | null
  selectedProductId?: string
  selectedModelId?: string
  selectedScriptId?: string
  // Plain-text product / model context strings — passed down to VariationCard
  // so its Enhance / Regenerate-prompt service calls can ground the LLM.
  productContext?: string
  modelContext?: string
  onOpenCharacterPicker?: () => void
  onOpenProductPicker?: () => void
  // CardStates live in RightPanel so the Gallery view can see in-flight cards
  // while Scenes is hidden.
  cardStates: Record<string, CardState>
  setCardStates: React.Dispatch<React.SetStateAction<Record<string, CardState>>>
}

// Defaults for a bulk video run — deliberately the cheap tier. A batch here is
// one clip per card (often a dozen at once) on the member's own credits, so it
// starts at the smallest usable size and the shortest cut rather than inheriting
// whatever each card was last left on. Both clamp to the chosen model's grid.
const BATCH_VIDEO_RESOLUTION = '480p'
const BATCH_VIDEO_DURATION = 5

// The two ways a card's still can drive a clip: as a true first frame, or as a
// reference image (Gemini Omni's only route — it has no image-to-video mode but
// animates a still perfectly well as a reference). A model with neither can't
// use the still at all, which is what greys it out in the batch dialog.
const STILL_CAPABLE_MODES: Mode[] = ['image-to-video', 'reference-to-video']

// The still a card is currently showing — the user's pick if they made one,
// otherwise the one on the card face. Used to resolve what the next dialogue
// card chains from.
function coverImageRef(card?: CardState): string | undefined {
  if (!card || card.images.length === 0) return undefined
  const picked = card.selected?.kind === 'image' ? card.images[card.selected.index] : undefined
  return (picked ?? card.images[card.currentImageIndex] ?? card.images[card.images.length - 1])?.imageUrl
}

export default function ScenesView({
  result,
  isGenerating,
  error,
  onAddVariation,
  onDeleteVariation,
  onUpdateVoiceProfile,
  characterRef,
  productRef,
  selectedProduct,
  selectedModel,
  selectedProductId,
  selectedModelId,
  selectedScriptId,
  productContext,
  modelContext,
  onOpenCharacterPicker,
  onOpenProductPicker,
  cardStates,
  setCardStates,
}: ScenesViewProps) {
  const handleUpdateCardState = useCallback((key: string, updates: Partial<CardState>) => {
    setCardStates((prev) => {
      const existing = prev[key]
      if (!existing) {
        const placeholder: PromptVariation = { id: key, tag: 'ACTION', label: '', refs: 'both', prompt: '' }
        return { ...prev, [key]: { ...createDefaultCardState(placeholder), ...updates } }
      }
      return { ...prev, [key]: { ...existing, ...updates } }
    })
  }, [setCardStates])

  // Functional variant for atomic array updates (parallel in-flight gens).
  // Plain onUpdateState captures `cardState` at call time, so rapid fires
  // race; this version always operates on the latest persisted card.
  const handleUpdateCardStateFn = useCallback(
    (key: string, updater: (prev: CardState) => Partial<CardState>) => {
      setCardStates((prev) => {
        const existing = prev[key]
        if (!existing) return prev
        return { ...prev, [key]: { ...existing, ...updater(existing) } }
      })
    },
    [setCardStates],
  )

  // ─── Dialogue chain ────────────────────────────────────────────────────
  // In "With Dialogue" delivery each scene carries one talking-to-camera card,
  // and those cards chain: card N generates with card N-1's chosen still
  // attached, so the whole ad reads as one continuous piece to camera cut into
  // pieces rather than a new setup every line. Resolved here (the parent owns
  // every card's state) and handed down per card.
  const dialogueKeys = (result?.scenes ?? []).flatMap((s) => {
    const i = s.variations.findIndex((v) => v.tag === 'DIALOGUE')
    return i === -1 ? [] : [`${s.number}-${i}`]
  })
  // Each dialogue card chains from the nearest EARLIER dialogue card that
  // actually has an image — so generating out of order (or after one failed)
  // still finds an anchor instead of silently dropping the chain.
  const dialogueChainRefs: Record<string, string> = {}
  {
    let previous: string | undefined
    for (const key of dialogueKeys) {
      if (previous) dialogueChainRefs[key] = previous
      const own = coverImageRef(cardStates[key])
      if (own) previous = own
    }
  }

  // ─── Batch image generation ────────────────────────────────────────────
  // Fire image gen for many cards at once. Rather than lift the gen logic out
  // of VariationCard (it reads the latest card state at fire time), we bump a
  // per-card token; each card's own effect then runs handleGenerateImage. A
  // confirm step shows the aggregate cost against the live balance first.
  const balance = useCreditsStore((s) => s.balance)
  // Reactive global B-Roll image model so the picker, cost, and valid
  // resolutions/aspects in the confirm dialog all update as the user changes it.
  const batchImageModelId =
    useSettingsStore((s) => s.perAppModel['broll-studio:image:text-to-image']) ??
    getDefaultModel('broll-studio', 'image', 'text-to-image')?.id
  const [batchTokens, setBatchTokens] = useState<Record<string, number>>({})
  // Chained dialogue cards can't all fire at once — card N needs card N-1's
  // still to exist first. So a batch splits: everything else goes in parallel,
  // and the chained dialogue cards run as a queue, one armed each time the
  // previous one settles. `dialogueHead` is the card currently rendering, with
  // the image count it started at (that count is how "landed" is told apart
  // from "hasn't started yet").
  const [dialogueQueue, setDialogueQueue] = useState<string[]>([])
  const dialogueHead = useRef<{ key: string; startImages: number } | null>(null)
  // `fresh` = prompt-ready cards with no image yet; `done` = cards already
  // generated. Kept apart so a second press doesn't silently re-bill work the
  // user already paid for and picked through — see includeExisting.
  const [batchConfirm, setBatchConfirm] = useState<
    { fresh: string[]; done: string[]; scope: string } | null
  >(null)
  const [includeExisting, setIncludeExisting] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  // The confirm dialog portals to document.body, so it would outlive an app
  // switch — dismiss it when the user docks away.
  useCloseOnAppSwitch(!!batchConfirm, () => setBatchConfirm(null))
  useCloseOnEscape(!!batchConfirm, () => setBatchConfirm(null))
  // Resolution + aspect chosen for the run (model lives in the global setting).
  const [batchResolution, setBatchResolution] = useState<ImageResolution | undefined>(undefined)
  const [batchAspect, setBatchAspect] = useState<string | undefined>(undefined)
  // The settings the in-flight batch chose, read by each card's batch effect.
  const [batchImageOverride, setBatchImageOverride] = useState<
    { aspectRatio: string; resolution?: ImageResolution } | null
  >(null)

  // Clamp the picked resolution/aspect to what the current model supports, so
  // switching models in the dialog never leaves an invalid selection.
  const batchImgConstraints = batchImageModelId ? getModel(batchImageModelId)?.imageConstraints : undefined
  const batchResOptions = (batchImgConstraints?.resolutions ?? []) as ImageResolution[]
  const batchAspectOptions = batchImgConstraints?.aspectRatios ?? []
  const effectiveBatchRes =
    batchResolution && batchResOptions.includes(batchResolution) ? batchResolution : batchResOptions[0]
  const effectiveBatchAspect =
    batchAspect && batchAspectOptions.includes(batchAspect)
      ? batchAspect
      : batchAspectOptions.includes('9:16')
        ? '9:16'
        : batchAspectOptions[0]
  // What this run will actually fire: the untouched cards, plus the already-
  // generated ones only when the user explicitly opts in.
  const batchTargets = batchConfirm
    ? includeExisting
      ? [...batchConfirm.fresh, ...batchConfirm.done]
      : batchConfirm.fresh
    : []
  // A card with references attached doesn't fire on the picked text-to-image
  // model — startImageTask swaps in the image-to-image sibling, which can be
  // priced differently. Cost each card against the model that will really run,
  // or the dialog quotes one price and kie bills another.
  const batchTotalCredits = batchConfirm
    ? batchTargets.reduce<number | null>((sum, key) => {
        if (sum === null) return null
        const card = cardStates[key]
        const hasRefs = !!(
          (characterRef && card?.refsCharacter !== false) ||
          (productRef && card?.refsProduct !== false)
        )
        const modelId = resolveImageModelId(hasRefs) ?? batchImageModelId
        const credits = modelId
          ? estimateCredits(modelId, { imageCount: 1, resolution: effectiveBatchRes })
          : null
        return credits == null ? null : sum + credits
      }, 0)
    : null
  const batchOverBudget = batchTotalCredits != null && balance !== null && batchTotalCredits > balance

  const requestBatch = (keys: string[], scope: string) => {
    // Only cards with a prompt can generate; skip the rest silently.
    const targets = keys.filter((k) => (cardStates[k]?.editablePrompt ?? '').trim())
    if (targets.length === 0) {
      useAppStore.getState().addToast('No prompts ready to generate.', 'error')
      return
    }
    const fresh = targets.filter((k) => (cardStates[k]?.images.length ?? 0) === 0)
    const done = targets.filter((k) => (cardStates[k]?.images.length ?? 0) > 0)
    // Default to skipping what's already generated. When everything is done the
    // dialog still opens — with the toggle as the only way forward — so
    // "regenerate the lot" stays possible but never accidental.
    setIncludeExisting(false)
    setBatchConfirm({ fresh, done, scope })
  }

  const confirmBatch = () => {
    if (!batchConfirm || batchTargets.length === 0) return
    setBatchImageOverride({ aspectRatio: effectiveBatchAspect ?? '9:16', resolution: effectiveBatchRes })
    // Chained dialogue cards run one at a time, in scene order — each waits for
    // the still it chains from. A dialogue card with its chain toggled off has
    // nothing to wait for, so it joins the parallel group.
    const chained = dialogueKeys.filter(
      (k) => batchTargets.includes(k) && cardStates[k]?.chainLink !== false,
    )
    const parallel = batchTargets.filter((k) => !chained.includes(k))
    const [firstChained, ...restChained] = chained
    setBatchTokens((prev) => {
      const next = { ...prev }
      for (const k of parallel) next[k] = (next[k] ?? 0) + 1
      if (firstChained) next[firstChained] = (next[firstChained] ?? 0) + 1
      return next
    })
    dialogueHead.current = firstChained
      ? { key: firstChained, startImages: cardStates[firstChained]?.images.length ?? 0 }
      : null
    setDialogueQueue(restChained)
    setBatchConfirm(null)
  }

  // ─── Batch video generation ────────────────────────────────────────────
  // Same machinery as the image batch: a per-card token, bumped once per run,
  // fires exactly one clip inside each card (which knows whether to animate its
  // still or render from the prompt). Clips are independent — no chaining — so
  // the whole run goes in parallel.
  const batchVideoModelId =
    useSettingsStore((s) => s.perAppModel['broll-studio:video']) ??
    getDefaultModel('broll-studio', 'video')?.id
  const [videoTokens, setVideoTokens] = useState<Record<string, number>>({})
  const [videoConfirm, setVideoConfirm] = useState<
    { fresh: string[]; done: string[]; scope: string } | null
  >(null)
  const [includeExistingVideos, setIncludeExistingVideos] = useState(false)
  const [batchVideoOverride, setBatchVideoOverride] = useState<BatchVideoSettings | null>(null)
  const [batchVideoResolution, setBatchVideoResolution] = useState<string | undefined>(undefined)
  const [batchVideoDuration, setBatchVideoDuration] = useState<number | undefined>(undefined)
  useCloseOnAppSwitch(!!videoConfirm, () => setVideoConfirm(null))
  useCloseOnEscape(!!videoConfirm, () => setVideoConfirm(null))

  // Clamp resolution + duration to the picked model, so swapping models inside
  // the dialog never leaves a value kie would reject (or silently re-tier).
  const batchVideoConstraints = batchVideoModelId ? getModel(batchVideoModelId)?.videoConstraints : undefined
  const batchVideoResOptions = batchVideoConstraints?.resolutions ?? []
  const batchVideoDurationOptions = batchVideoConstraints?.durations ?? []
  const effectiveVideoRes =
    batchVideoResolution && batchVideoResOptions.includes(batchVideoResolution)
      ? batchVideoResolution
      : batchVideoResOptions.includes(BATCH_VIDEO_RESOLUTION)
        ? BATCH_VIDEO_RESOLUTION
        : batchVideoConstraints?.default ?? batchVideoResOptions[0] ?? '720p'
  const effectiveVideoDuration =
    batchVideoDuration && batchVideoDurationOptions.includes(batchVideoDuration)
      ? batchVideoDuration
      : batchVideoDurationOptions.length > 0
        ? snapVideoDuration(BATCH_VIDEO_DURATION, batchVideoDurationOptions)
        : BATCH_VIDEO_DURATION
  const videoTargets = videoConfirm
    ? includeExistingVideos
      ? [...videoConfirm.fresh, ...videoConfirm.done]
      : videoConfirm.fresh
    : []
  // How many of this run animate a still they already have. The rest render
  // from the prompt alone — worth saying out loud, since those cost the same
  // but come back as something the member hasn't seen a frame of.
  const videoAnimateCount = videoTargets.filter((k) => (cardStates[k]?.images.length ?? 0) > 0).length
  const videoBatchCredits = batchVideoModelId
    ? videoTargets.reduce<number | null>((sum, key) => {
        if (sum === null) return null
        const credits = estimateCredits(batchVideoModelId, {
          durationSeconds: effectiveVideoDuration,
          resolution: effectiveVideoRes,
          audio: cardStates[key]?.cardVideoAudio ?? true,
        })
        return credits == null ? null : sum + credits
      }, 0)
    : null
  const videoOverBudget = videoBatchCredits != null && balance !== null && videoBatchCredits > balance
  // A model that takes neither a start frame nor reference images can't animate
  // a still, so every card holding one would fail at fire time — a dozen
  // identical error toasts and nothing rendered. Say so here and hold the run.
  const videoModelModes = batchVideoModelId ? getModel(batchVideoModelId)?.modes ?? [] : []
  const videoModelCantAnimate =
    videoAnimateCount > 0 &&
    !videoModelModes.includes('image-to-video') &&
    !videoModelModes.includes('reference-to-video')

  const requestVideoBatch = (keys: string[], scope: string) => {
    const targets = keys.filter((k) => (cardStates[k]?.editablePrompt ?? '').trim())
    if (targets.length === 0) {
      useAppStore.getState().addToast('No prompts ready to generate.', 'error')
      return
    }
    // Cards that already have a clip are held back by default — a video is the
    // expensive half of this app, so re-billing one takes an explicit tick.
    const fresh = targets.filter((k) => (cardStates[k]?.videos.length ?? 0) === 0)
    const done = targets.filter((k) => (cardStates[k]?.videos.length ?? 0) > 0)
    setIncludeExistingVideos(false)
    setVideoConfirm({ fresh, done, scope })
  }

  const confirmVideoBatch = () => {
    if (!videoConfirm || videoTargets.length === 0 || !batchVideoModelId) return
    setBatchVideoOverride({
      modelId: batchVideoModelId,
      resolution: effectiveVideoRes,
      durationSeconds: effectiveVideoDuration,
    })
    setVideoTokens((prev) => {
      const next = { ...prev }
      for (const k of videoTargets) next[k] = (next[k] ?? 0) + 1
      return next
    })
    setVideoConfirm(null)
  }

  // Arm the next chained dialogue card once the current one has settled — an
  // image landed, or the generation errored (in which case the next card falls
  // back to the nearest earlier still rather than stalling the queue).
  useEffect(() => {
    const head = dialogueHead.current
    if (!head || dialogueQueue.length === 0) return
    const card = cardStates[head.key]
    if (!card) {
      // The session was rebuilt under us — drop the queue rather than wait on a
      // card that no longer exists.
      dialogueHead.current = null
      setDialogueQueue([])
      return
    }
    if (card.images.length <= head.startImages && !card.inFlightImages.some((e) => e.error)) return
    const [next, ...rest] = dialogueQueue
    dialogueHead.current = { key: next, startImages: cardStates[next]?.images.length ?? 0 }
    setDialogueQueue(rest)
    setBatchTokens((prev) => ({ ...prev, [next]: (prev[next] ?? 0) + 1 }))
  }, [cardStates, dialogueQueue])

  // Rebuild card states from the current result. Carries existing state
  // forward when prompts match (same generation, re-render); drops orphaned
  // slots when a fresh Generate produces a shorter script.
  useEffect(() => {
    if (!result) return
    // A new storyboard invalidates any chained dialogue run still in flight —
    // its keys point at the old scene list.
    dialogueHead.current = null
    setDialogueQueue([])
    setCardStates((prev) => {
      const next: Record<string, CardState> = {}
      for (const scene of result.scenes) {
        for (let i = 0; i < scene.variations.length; i++) {
          const key = `${scene.number}-${i}`
          const v = scene.variations[i]
          const existing = prev[key]
          // Preserve state across re-renders by matching the live prompt
          // against any entry in the card's history (not just `editablePrompt`).
          // That way Regenerate / Enhance / Undo / typed edits don't trip the
          // rebuilder into discarding the card's generated images.
          const matchesHistory = existing && (
            existing.editablePrompt === v.prompt
            || existing.promptHistory?.includes(v.prompt)
          )
          next[key] = matchesHistory ? existing : createDefaultCardState(v)
        }
      }
      return next
    })
  }, [result, setCardStates])

  // Refresh-resume: walk every card's in-flight queues on mount and finish
  // any kie task whose taskId survived the refresh. Drains parallel queues.
  // Entries older than 30 min — or in-flight entries that never received a
  // taskId (refresh during createTask) — are evicted with an error chip so the
  // gallery doesn't stay stuck on a phantom spinner.
  const INFLIGHT_TTL_MS = 30 * 60 * 1000
  useEffect(() => {
    const now = Date.now()
    // First pass: evict stale entries that can't be resumed.
    setCardStates((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [key, card] of Object.entries(prev)) {
        const stalledImages = card.inFlightImages.filter(
          (e) => (!e.taskId || !e.modelId) && now - e.startedAt > INFLIGHT_TTL_MS,
        )
        const stalledVideos = card.inFlightVideos.filter(
          (e) => !e.taskId && now - e.startedAt > INFLIGHT_TTL_MS,
        )
        if (stalledImages.length === 0 && stalledVideos.length === 0) continue
        changed = true
        next[key] = {
          ...card,
          inFlightImages: card.inFlightImages.map((e) =>
            stalledImages.includes(e) ? { ...e, error: 'Generation stalled before kie returned a task id. Reset and try again.' } : e,
          ),
          inFlightVideos: card.inFlightVideos.map((e) =>
            stalledVideos.includes(e) ? { ...e, error: 'Generation stalled before kie returned a task id. Reset and try again.' } : e,
          ),
        }
      }
      return changed ? next : prev
    })

    for (const [key, card] of Object.entries(cardStates)) {
      // ── Image queue ────────────────────────────────────────────────
      for (const entry of card.inFlightImages) {
        if (!entry.taskId || !entry.modelId) continue
        // Skip tasks a live generation promise still owns — a view unmounted by
        // a History/mode switch keeps polling, so resuming here would duplicate.
        if (!claimTask('image', entry.taskId)) continue
        const inFlightId = entry.id
        const taskId = entry.taskId
        const modelId = entry.modelId
        const prompt = entry.prompt
        const resolution = entry.resolution || undefined
        ;(async () => {
          try {
            const imageUrl = await finishImageTask(taskId, modelId, resolution)
            const newImage = { imageUrl, prompt, modelId, createdAt: Date.now() }
            setCardStates((prev) => {
              const existing = prev[key]
              if (!existing) return prev
              const newImages = [...existing.images, newImage]
              return {
                ...prev,
                [key]: {
                  ...existing,
                  images: newImages,
                  currentImageIndex: newImages.length - 1,
                  selected: { kind: 'image', index: newImages.length - 1 },
                  inFlightImages: existing.inFlightImages.filter((e) => e.id !== inFlightId),
                },
              }
            })
          } catch (err) {
            const msg = humanizeError(err, 'Image generation failed. Try again.')
            setCardStates((prev) => {
              const existing = prev[key]
              if (!existing) return prev
              return {
                ...prev,
                [key]: {
                  ...existing,
                  inFlightImages: existing.inFlightImages.map((e) =>
                    e.id === inFlightId ? { ...e, error: msg } : e,
                  ),
                },
              }
            })
          } finally {
            releaseTask('image', taskId)
          }
        })()
      }

      // ── Video queue ────────────────────────────────────────────────
      for (const entry of card.inFlightVideos) {
        if (!entry.taskId) continue
        if (!claimTask('video', entry.taskId)) continue
        const inFlightId = entry.id
        const taskId = entry.taskId
        const modelId = entry.modelId
        const endpoint = entry.endpoint
        const duration = entry.durationSeconds
        const aspect = entry.aspectRatio
        const resolution = entry.resolution
        const audio = entry.audio
        const promptText = entry.prompt
        const mode = entry.mode
        const sourceBRollId = entry.sourceBRollId
        ;(async () => {
          try {
            const res = await finishVideoTask(taskId, modelId, endpoint, duration, aspect)
            const assetRef = `asset://${res.assetId}`
            const newVideo = {
              url: assetRef,
              modelId,
              prompt: promptText,
              aspectRatio: res.aspectRatio,
              durationSeconds: res.durationSeconds,
              resolution,
              audio,
              mode,
              sourceBRollId,
              createdAt: Date.now(),
            }
            setCardStates((prev) => {
              const existing = prev[key]
              if (!existing) return prev
              const newVideos = [...existing.videos, newVideo]
              return {
                ...prev,
                [key]: {
                  ...existing,
                  videos: newVideos,
                  currentVideoIndex: newVideos.length - 1,
                  selected: { kind: 'video', index: newVideos.length - 1 },
                  inFlightVideos: existing.inFlightVideos.filter((e) => e.id !== inFlightId),
                },
              }
            })
            const historyEntry: VideoHistoryItem = {
              id: crypto.randomUUID(),
              modelId,
              prompt: promptText,
              mode,
              aspectRatio: res.aspectRatio,
              durationSeconds: res.durationSeconds,
              resolution,
              audio,
              videoUrl: assetRef,
              sourceBRollId,
              sourceApp: 'broll-studio',
              createdAt: Date.now(),
            }
            await useBankStore.getState().addVideoHistory(historyEntry)
            useAppStore.getState().addToast('B-Roll video ready', 'success')
          } catch (err) {
            if (isPollTimeout(err)) {
              // Still rendering past the poll budget — keep the entry in-flight
              // so a later refresh resumes it, rather than flipping it to a
              // Failed/Retry that would re-bill a clip already on its way.
              return
            }
            const msg = humanizeError(err, 'Video resume failed.')
            setCardStates((prev) => {
              const existing = prev[key]
              if (!existing) return prev
              return {
                ...prev,
                [key]: {
                  ...existing,
                  inFlightVideos: existing.inFlightVideos.map((e) =>
                    e.id === inFlightId ? { ...e, error: msg } : e,
                  ),
                },
              }
            })
            useAppStore.getState().addToast(msg, 'error')
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
      <div className="flex h-full flex-col overflow-hidden p-5">
        <GenerationProgress
          isActive
          color="bg-broll-500"
          messages={['Analyzing script scenes...', 'Sending request...', 'Generating B-Roll prompts...', 'Finalizing scene breakdowns...']}
          className="mb-6"
          showHelper={false}
        />
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-8">
            {[1, 2, 3].map((i) => (
              <SkeletonScene key={i} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <Film className="h-10 w-10 text-ink-800" strokeWidth={1.5} />
        <p className="text-sm text-ink-700">Select your inputs and generate</p>
        <p className="text-xs text-ink-800">B-Roll prompts will appear here</p>
        {error && (
          <div className="mt-2 flex max-w-sm items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400 light:text-red-600" />
            <p className="text-xs leading-relaxed text-red-300 light:text-red-700">{error}</p>
          </div>
        )}
      </div>
    )
  }

  const allKeys = result.scenes.flatMap((s) => s.variations.map((_, i) => `${s.number}-${i}`))

  // Every rendered clip across every scene, for the download picker — parity
  // with Continuous. This is the mode that produces the most clips and where
  // videos are download-only, so bulk export matters most here; without it the
  // only way out was opening each card in turn. Each card's COVER take (the
  // one its face plays — `selected` when the user picked one, else the newest)
  // opens ticked, so the zip is one clip per card unless the member says
  // otherwise.
  const allClipEntries: ClipDownloadEntry[] = result.scenes.flatMap((s) =>
    s.variations.flatMap((_, i) => {
      const card = cardStates[`${s.number}-${i}`]
      const vids = card?.videos ?? []
      const cover = Math.min(
        card?.selected?.kind === 'video' ? card.selected.index : card?.currentVideoIndex ?? 0,
        Math.max(0, vids.length - 1),
      )
      const scene = String(s.number).padStart(2, '0')
      return vids.map((v, vi) => ({
        id: `${s.number}-${i}:${vi}`,
        ref: v.url,
        name: `scene${scene}-option${i + 1}${vids.length > 1 ? `-take${vi + 1}` : ''}`,
        label: `Scene ${s.number} · Option ${i + 1}`,
        takeLabel: vids.length > 1 ? `Take ${vi + 1} of ${vids.length}` : undefined,
        isCover: vi === cover,
        aspectRatio: v.aspectRatio,
      }))
    }),
  )

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-400">
            {result.scenes.length} scene{result.scenes.length === 1 ? '' : 's'}
          </span>
          {/* Style pill — parity with Continuous, so the member can see
              which look every b-roll clip is rendered in. */}
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-broll-500/25 bg-broll-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-broll-300">
            <Palette className="h-3 w-3 shrink-0" strokeWidth={2} />
            <span className="truncate">{result.styleBrief ? (result.styleName?.trim() || 'Custom style') : getContinuousStyle(result.styleId ?? 'ugc').label}</span>
          </span>
        </div>
        {/* Batch actions, in the order the work happens — images, then videos,
            then the export. Same shape and styling as Continuous' top strip. */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => requestBatch(allKeys, 'All scenes')}
            title="Generate images for every variation across all scenes"
            className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100"
          >
            <Images className="h-3.5 w-3.5" />
            Generate all images
          </button>
          <button
            type="button"
            onClick={() => requestVideoBatch(allKeys, 'All scenes')}
            title="Generate a clip for every variation across all scenes"
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-broll-500 px-3.5 py-1.5 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-colors hover:bg-broll-400"
          >
            <VideoIcon className="h-3.5 w-3.5" />
            Generate all videos
          </button>
          {allClipEntries.length > 0 && (
            <button
              type="button"
              onClick={() => setDownloadOpen(true)}
              title="Pick which clips to download as a zip"
              className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100"
            >
              <Download className="h-3.5 w-3.5" />
              {`Download clips (${allClipEntries.length})`}
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-10">
        {result.scenes.map((scene) => (
          <SceneSection
            key={scene.number}
            scene={scene}
            cardStates={cardStates}
            onUpdateCardState={handleUpdateCardState}
            onUpdateCardStateFn={handleUpdateCardStateFn}
            onAddVariation={onAddVariation}
            onDeleteVariation={onDeleteVariation}
            characterRef={characterRef}
            productRef={productRef}
            selectedProduct={selectedProduct}
            selectedModel={selectedModel}
            selectedProductId={selectedProductId}
            selectedModelId={selectedModelId}
            selectedScriptId={selectedScriptId}
            productContext={productContext}
            modelContext={modelContext}
            onOpenCharacterPicker={onOpenCharacterPicker}
            onOpenProductPicker={onOpenProductPicker}
            batchTokens={batchTokens}
            batchImageOverride={batchImageOverride}
            videoTokens={videoTokens}
            batchVideoOverride={batchVideoOverride}
            dialogueChainRefs={dialogueChainRefs}
            onGenerateScene={() =>
              requestBatch(
                scene.variations.map((_, i) => `${scene.number}-${i}`),
                `Scene ${scene.number}`,
              )
            }
            onGenerateSceneVideos={() =>
              requestVideoBatch(
                scene.variations.map((_, i) => `${scene.number}-${i}`),
                `Scene ${scene.number}`,
              )
            }
            resultStyle={result.style}
            resultRealism={result.realism}
            resultVoiceProfile={result.voiceProfile}
            onUpdateVoiceProfile={onUpdateVoiceProfile}
          />
        ))}
      </div>

      {batchConfirm && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
          onClick={() => setBatchConfirm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-ink/10 bg-ink-950/95 p-5 shadow-2xl"
          >
            <h3 className="text-sm font-medium text-ink-100">
              {batchTargets.length === 0
                ? 'Nothing to generate'
                : `Generate ${batchTargets.length} image${batchTargets.length === 1 ? '' : 's'}`}
            </h3>
            <p className="mt-1 text-xs text-ink-500">
              {batchConfirm.scope} · all fire in parallel.
              {batchConfirm.done.length > 0 && !includeExisting && (
                <> {batchConfirm.done.length} card{batchConfirm.done.length === 1 ? '' : 's'} already
                {batchConfirm.done.length === 1 ? ' has' : ' have'} an image and will be skipped.</>
              )}
            </p>

            {batchConfirm.done.length > 0 && (
              <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={includeExisting}
                  onChange={(e) => setIncludeExisting(e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 accent-broll-500"
                />
                <span className="text-xs text-ink-300">
                  Also regenerate the {batchConfirm.done.length} card
                  {batchConfirm.done.length === 1 ? '' : 's'} that already {batchConfirm.done.length === 1 ? 'has' : 'have'} an image
                </span>
              </label>
            )}

            {/* Run settings — model is the shared B-Roll image model; resolution
                and aspect apply to every card in this batch. */}
            <div className="mt-4 flex flex-col gap-2.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Model</span>
              <ModelPicker
                appId="broll-studio"
                task="image"
                mode="text-to-image"
              />
              {(batchAspectOptions.length > 0 || batchResOptions.length > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                  {batchAspectOptions.length > 0 && (
                    <ConstraintChip
                      grow
                      openDirection="up"
                      options={batchAspectOptions}
                      value={effectiveBatchAspect ?? batchAspectOptions[0]}
                      onChange={(v) => setBatchAspect(v)}
                      render={(v) => (
                        <span className="flex items-center gap-1.5">
                          <AspectIcon ratio={v} />
                          <span>{v}</span>
                        </span>
                      )}
                    />
                  )}
                  {batchResOptions.length > 0 && (
                    <ConstraintChip
                      grow
                      openDirection="up"
                      options={batchResOptions as string[]}
                      value={(effectiveBatchRes ?? batchResOptions[0]) as string}
                      onChange={(v) => setBatchResolution(v as ImageResolution)}
                      renderOption={(v) => {
                        const credits = formatCredits(estimateCredits(batchImageModelId, { imageCount: 1, resolution: v as ImageResolution }))
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
              <span className="font-medium text-ink-100">
                {/* An empty run costs nothing — formatCredits(0) would read
                    "< 1 credit", which looks like a real charge. */}
                {batchTargets.length === 0 ? '—' : formatCredits(batchTotalCredits) ?? '— credits'}
              </span>
            </div>
            {balance !== null && (
              <p className={`mt-1.5 text-[11px] ${batchOverBudget ? 'text-red-400 light:text-red-600' : 'text-ink-500'}`}>
                Your balance: {balance.toLocaleString()} credits{batchOverBudget ? ' — not enough' : ''}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setBatchConfirm(null)}
                className="flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-1.5 text-[12px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.06]"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmBatch}
                disabled={batchTargets.length === 0}
                className="flex items-center gap-1.5 rounded-full border border-white/15 bg-broll-500 px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-broll-500"
              >
                <Images className="h-3.5 w-3.5" />
                Generate
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Video-batch confirm. Clips are the expensive half of this app, so the
          run is priced, counted and settled here before a single task fires. */}
      {videoConfirm && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
          onClick={() => setVideoConfirm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-ink/10 bg-ink-950/95 p-5 shadow-2xl"
          >
            <h3 className="text-sm font-medium text-ink-100">
              {videoTargets.length === 0
                ? 'Nothing to generate'
                : `Generate ${videoTargets.length} video${videoTargets.length === 1 ? '' : 's'}`}
            </h3>
            <p className="mt-1 text-xs text-ink-500">
              {videoConfirm.scope} · all render in parallel and survive a refresh.
              {videoTargets.length > 0 && (
                <>
                  {' '}
                  {videoAnimateCount > 0 && `${videoAnimateCount} animate the still on the card`}
                  {videoAnimateCount > 0 && videoAnimateCount < videoTargets.length && ', and '}
                  {videoAnimateCount < videoTargets.length &&
                    `${videoTargets.length - videoAnimateCount} render from the prompt alone`}
                  .
                </>
              )}
              {videoConfirm.done.length > 0 && !includeExistingVideos && (
                <> {videoConfirm.done.length} card{videoConfirm.done.length === 1 ? '' : 's'} already
                {videoConfirm.done.length === 1 ? ' has' : ' have'} a clip and will be skipped.</>
              )}
            </p>

            {videoConfirm.done.length > 0 && (
              <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={includeExistingVideos}
                  onChange={(e) => setIncludeExistingVideos(e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 accent-broll-500"
                />
                <span className="text-xs text-ink-300">
                  Also regenerate the {videoConfirm.done.length} card
                  {videoConfirm.done.length === 1 ? '' : 's'} that already {videoConfirm.done.length === 1 ? 'has' : 'have'} a clip
                </span>
              </label>
            )}

            {/* Run settings — the shared B-Roll video model (same setting the
                card modal's picker writes), plus one resolution and one clip
                length for every video in the batch. */}
            <div className="mt-4 flex flex-col gap-2.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Model</span>
              <ModelPicker
                appId="broll-studio"
                task="video"
                costParams={{ durationSeconds: effectiveVideoDuration, resolution: effectiveVideoRes }}
                requireAnyModes={videoAnimateCount > 0 ? STILL_CAPABLE_MODES : undefined}
                requireModeNote="Greyed-out models can't animate a still — they take neither a start frame nor reference images."
              />
              {(batchVideoResOptions.length > 0 || batchVideoDurationOptions.length > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                  {batchVideoResOptions.length > 0 && (
                    <ConstraintChip
                      grow
                      openDirection="up"
                      options={batchVideoResOptions}
                      value={effectiveVideoRes}
                      onChange={(v) => setBatchVideoResolution(v)}
                      render={videoResolutionLabel}
                    />
                  )}
                  {batchVideoDurationOptions.length > 0 && (
                    <ConstraintChip
                      grow
                      openDirection="up"
                      options={batchVideoDurationOptions.map(String)}
                      value={String(effectiveVideoDuration)}
                      onChange={(v) => setBatchVideoDuration(Number(v))}
                      render={(v) => <span>{v}s</span>}
                    />
                  )}
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5 text-xs">
              <span className="text-ink-400">Estimated cost</span>
              <span className="flex items-center gap-1 font-medium text-ink-100">
                <Coins className="h-3 w-3" strokeWidth={2} />
                {videoTargets.length === 0 ? '—' : formatCredits(videoBatchCredits) ?? '— credits'}
              </span>
            </div>
            {balance !== null && (
              <p className={`mt-1.5 text-[11px] ${videoOverBudget ? 'text-red-400 light:text-red-600' : 'text-ink-500'}`}>
                Your balance: {balance.toLocaleString()} credits{videoOverBudget ? ' — not enough' : ''}
              </p>
            )}
            {videoModelCantAnimate && (
              <p className="mt-1.5 text-[11px] text-red-300 light:text-red-700">
                {getModel(batchVideoModelId ?? '')?.displayName ?? 'This model'} can&rsquo;t animate a still — every card with an image would fail. Pick a model that takes a start frame or reference images.
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setVideoConfirm(null)}
                className="flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-1.5 text-[12px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.06]"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmVideoBatch}
                disabled={videoTargets.length === 0 || videoModelCantAnimate}
                className="flex items-center gap-1.5 rounded-full border border-white/15 bg-broll-500 px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-broll-500"
              >
                <VideoIcon className="h-3.5 w-3.5" />
                Generate
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {downloadOpen && (
        <ClipDownloadModal
          entries={allClipEntries}
          zipBasename="broll-clips"
          onClose={() => setDownloadOpen(false)}
        />
      )}
    </div>
  )
}

// Memoized per-card row. Binds the key-taking parent callbacks into the
// per-card closures VariationCard expects, with stable identity — so one
// card's state change no longer re-renders every other card in every scene.
// Effective only because the props from BrollStudio (refs, handlers) are
// referentially stable (useMemo/useCallback there) and cardStates[key] keeps
// the same reference for cards that didn't change.
const VariationCardRow = memo(function VariationCardRow({
  cardKey,
  sceneNumber,
  scriptLine,
  variation,
  cardState,
  onUpdateCardState,
  onUpdateCardStateFn,
  onDeleteVariation,
  characterRef,
  productRef,
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
  chainImageRef,
  resultStyle,
  resultRealism,
  resultVoiceProfile,
  onUpdateVoiceProfile,
}: {
  cardKey: string
  sceneNumber: number
  scriptLine: string
  variation: PromptVariation
  cardState: CardState
  onUpdateCardState: (key: string, updates: Partial<CardState>) => void
  onUpdateCardStateFn: (key: string, updater: (prev: CardState) => Partial<CardState>) => void
  onDeleteVariation: (sceneNumber: number, variationId: string) => void
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
  selectedProduct?: Product | null
  selectedModel?: Model | null
  selectedProductId?: string
  selectedModelId?: string
  selectedScriptId?: string
  productContext?: string
  modelContext?: string
  onOpenCharacterPicker?: () => void
  onOpenProductPicker?: () => void
  generateImageToken?: number
  batchImageOverride?: { aspectRatio: string; resolution?: ImageResolution } | null
  generateVideoToken?: number
  batchVideoOverride?: BatchVideoSettings | null
  chainImageRef?: string
  resultStyle?: string
  resultRealism?: boolean
  resultVoiceProfile?: string
  onUpdateVoiceProfile?: (text: string) => void
}) {
  const variationId = variation.id
  const onUpdateState = useCallback(
    (updates: Partial<CardState>) => onUpdateCardState(cardKey, updates),
    [onUpdateCardState, cardKey],
  )
  const onUpdateStateFn = useCallback(
    (updater: (prev: CardState) => Partial<CardState>) => onUpdateCardStateFn(cardKey, updater),
    [onUpdateCardStateFn, cardKey],
  )
  const onDelete = useCallback(
    () => onDeleteVariation(sceneNumber, variationId),
    [onDeleteVariation, sceneNumber, variationId],
  )
  return (
    <VariationCard
      sceneNumber={sceneNumber}
      scriptLine={scriptLine}
      variation={variation}
      cardState={cardState}
      onUpdateState={onUpdateState}
      onUpdateStateFn={onUpdateStateFn}
      onDelete={onDelete}
      characterRef={characterRef}
      productRef={productRef}
      selectedProduct={selectedProduct}
      selectedModel={selectedModel}
      selectedProductId={selectedProductId}
      selectedModelId={selectedModelId}
      selectedScriptId={selectedScriptId}
      productContext={productContext}
      modelContext={modelContext}
      onOpenCharacterPicker={onOpenCharacterPicker}
      onOpenProductPicker={onOpenProductPicker}
      generateImageToken={generateImageToken}
      batchImageOverride={batchImageOverride}
      generateVideoToken={generateVideoToken}
      batchVideoOverride={batchVideoOverride}
      chainImageRef={chainImageRef}
      resultStyle={resultStyle}
      resultRealism={resultRealism}
      voiceProfile={resultVoiceProfile}
      onUpdateVoiceProfile={onUpdateVoiceProfile}
    />
  )
})

function SceneSection({
  scene,
  cardStates,
  onUpdateCardState,
  onUpdateCardStateFn,
  onAddVariation,
  onDeleteVariation,
  characterRef,
  productRef,
  selectedProduct,
  selectedModel,
  selectedProductId,
  selectedModelId,
  selectedScriptId,
  productContext,
  modelContext,
  onOpenCharacterPicker,
  onOpenProductPicker,
  batchTokens,
  batchImageOverride,
  videoTokens,
  batchVideoOverride,
  dialogueChainRefs,
  onGenerateScene,
  onGenerateSceneVideos,
  resultStyle,
  resultRealism,
  resultVoiceProfile,
  onUpdateVoiceProfile,
}: {
  scene: Scene
  cardStates: Record<string, CardState>
  onUpdateCardState: (key: string, updates: Partial<CardState>) => void
  onUpdateCardStateFn: (key: string, updater: (prev: CardState) => Partial<CardState>) => void
  onAddVariation: (sceneNumber: number, variation: PromptVariation) => void
  onDeleteVariation: (sceneNumber: number, variationId: string) => void
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
  selectedProduct?: Product | null
  selectedModel?: Model | null
  selectedProductId?: string
  selectedModelId?: string
  selectedScriptId?: string
  productContext?: string
  modelContext?: string
  onOpenCharacterPicker?: () => void
  onOpenProductPicker?: () => void
  batchTokens: Record<string, number>
  batchImageOverride?: { aspectRatio: string; resolution?: ImageResolution } | null
  videoTokens: Record<string, number>
  batchVideoOverride?: BatchVideoSettings | null
  // Card key → the still that card's talking-head shot chains from. Only
  // DIALOGUE cards have an entry, and only from the second one onward.
  dialogueChainRefs: Record<string, string>
  onGenerateScene: () => void
  onGenerateSceneVideos: () => void
  resultStyle?: string
  resultRealism?: boolean
  resultVoiceProfile?: string
  onUpdateVoiceProfile?: (text: string) => void
}) {
  return (
    // `content-visibility: auto` brings paint containment, which clips the
    // cards' soft drop shadow at this box's edges. The `-m-4 p-4` bleed gives
    // the shadow 16px of room inside the contained box; the negative margin
    // cancels against the parent's flex `gap-10`, so layout is unchanged.
    <div className="-m-4 p-4" style={{ contentVisibility: 'auto', containIntrinsicSize: '700px' }}>
      {/* Scene header — number + tiny line chip + the line itself. The
          spoken-duration chip was removed (its estimate was unreliable). */}
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            className="text-5xl font-normal italic tabular-nums text-ink-800"
            style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
          >
            {String(scene.number).padStart(2, '0')}
          </span>
          <div className="h-8 w-px bg-ink/10" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="inline-flex w-fit rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              Line {scene.number}
            </span>
            <p
              className="text-lg font-normal not-italic leading-relaxed text-ink-400"
              style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
            >
              &ldquo;{scene.scriptLine}&rdquo;
            </p>
          </div>
        </div>
        {/* Per-scene batches — one row's worth of images or clips, so a member
            can work scene by scene instead of committing the whole storyboard's
            credits in one press. */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onGenerateScene}
            title="Generate images for every variation in this scene"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100"
          >
            <Images className="h-3.5 w-3.5" />
            Images
          </button>
          <button
            type="button"
            onClick={onGenerateSceneVideos}
            title="Generate a clip for every variation in this scene"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100"
          >
            <VideoIcon className="h-3.5 w-3.5" />
            Videos
          </button>
        </div>
      </div>

      {/* Three variations plus the Add-option card across one row at xl — four
          equal cards, the Add card just another cell in the grid. (A session
          generated before the cut to three still renders: it simply wraps its
          extra card onto a second line.) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {scene.variations.map((variation, i) => {
          const key = `${scene.number}-${i}`
          const state = cardStates[key] ?? createDefaultCardState(variation)
          return (
            <VariationCardRow
              key={variation.id}
              cardKey={key}
              sceneNumber={scene.number}
              scriptLine={scene.scriptLine}
              variation={variation}
              cardState={state}
              onUpdateCardState={onUpdateCardState}
              onUpdateCardStateFn={onUpdateCardStateFn}
              onDeleteVariation={onDeleteVariation}
              characterRef={characterRef}
              productRef={productRef}
              selectedProduct={selectedProduct}
              selectedModel={selectedModel}
              selectedProductId={selectedProductId}
              selectedModelId={selectedModelId}
              selectedScriptId={selectedScriptId}
              productContext={productContext}
              modelContext={modelContext}
              onOpenCharacterPicker={onOpenCharacterPicker}
              onOpenProductPicker={onOpenProductPicker}
              generateImageToken={batchTokens[key]}
              batchImageOverride={batchImageOverride}
              generateVideoToken={videoTokens[key]}
              batchVideoOverride={batchVideoOverride}
              chainImageRef={dialogueChainRefs[key]}
              resultStyle={resultStyle}
              resultRealism={resultRealism}
              resultVoiceProfile={resultVoiceProfile}
              onUpdateVoiceProfile={onUpdateVoiceProfile}
            />
          )
        })}
        <AddNewCard onAdd={(variation) => onAddVariation(scene.number, variation)} productVisible={scene.productVisible} />
      </div>
    </div>
  )
}

function AddNewCard({
  onAdd,
  productVisible,
}: {
  onAdd: (variation: PromptVariation) => void
  productVisible?: boolean
}) {
  const handleAdd = () => {
    onAdd({
      id: `manual-${Date.now()}`,
      label: 'Manual Option',
      tag: 'ACTION',
      // Follow the scene's product visibility: on a line that attacks the
      // category, attaching the product reference renders the advertised
      // product as the thing being criticised. The user can flip it back on
      // from the card's ref pills.
      refs: productVisible === false ? 'character' : 'both',
      prompt: '',
    })
  }
  return (
    // A normal card in the grid: same 9/16 footprint as the variation cards, so
    // the three variations plus this Add card fill the four-column row evenly.
    <button
      onClick={handleAdd}
      title="Add a blank option to this scene"
      className="group/add flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink/20 bg-ink/[0.03] transition-colors hover:border-broll-400/60 hover:bg-broll-500/10"
    >
      <Plus className="h-5 w-5 shrink-0 text-ink-400 transition-colors group-hover/add:text-broll-300" />
      <span className="text-[10px] font-medium text-ink-300 transition-colors group-hover/add:text-broll-300">
        Add option
      </span>
    </button>
  )
}

function SkeletonScene() {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="skeleton h-8 w-10" />
        <div className="flex flex-col gap-1">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton h-3 w-48" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton skeleton-card aspect-[9/16]" />
        ))}
      </div>
    </div>
  )
}
