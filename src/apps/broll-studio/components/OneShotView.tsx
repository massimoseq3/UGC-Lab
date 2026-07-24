import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Clapperboard,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Sparkles,
  Video as VideoIcon,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Plus,
  Coins,
  X,
  Download,
  Copy,
  Check,
  Film,
} from 'lucide-react'
import GenerationProgress from '../../../components/GenerationProgress'
import GeneratingBackdrop from '../../../components/GeneratingBackdrop'
import OneShotDetailModal from './OneShotDetailModal'
import type { OneShotResult, OneShotConcept, OneShotSegment, OneShotCardState, ReferenceImage, GeneratedVideo } from '../types'
import type { Product, Model, VideoHistoryItem } from '../../../stores/types'
import type { VideoMode } from '../../../utils/models'
import { createDefaultOneShotCardState } from '../cardState'
import { startVideoTask, finishVideoTask } from '../services/generateVideo'
import { claimTask, releaseTask } from '../services/taskRegistry'
import { buildReferencePreamble } from '../services/generateBroll'
import { resolveOneShotTokens } from '../services/generateOneShot'
import { applyStyleToPrompt } from '../services/generateContinuous'
import { isPollTimeout } from '../../../utils/kie'
import { useBankStore } from '../../../stores/bankStore'
import { useAppStore } from '../../../stores/appStore'
import { useCreditsStore } from '../../../stores/creditsStore'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import { getAsBase64, getUrl, isAssetRef } from '../../../utils/assetStore'
import { extractVideoFrame } from '../../../utils/videoFrames'
import { getModel, snapVideoDurationUp, estimateCredits, formatCredits } from '../../../utils/models'
import { humanizeError } from '../../../utils/friendlyError'
import { downloadImage } from '../../../utils/downloadImage'
import { downloadAssetsZip } from '../../../utils/downloadZip'
import { copyToClipboard } from '../../../utils/clipboard'
import { sendClipToPlayground } from '../services/sendClipToPlayground'

interface OneShotViewProps {
  result: OneShotResult | null
  isGenerating?: boolean
  error?: string | null
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
  selectedModel?: Model | null
  selectedProduct?: Product | null
  productName?: string
  // Plain-text context strings — passed to the modal's Enhance / Regenerate.
  productContext?: string
  modelContext?: string
  // Currently selected One Shot video model. May differ from result.modelId
  // (the model the split was planned against) — that shows the stale-plan hint.
  oneShotModelId: string
  cardStates: Record<string, OneShotCardState>
  setCardStates: React.Dispatch<React.SetStateAction<Record<string, OneShotCardState>>>
  // Generate one more variation concept (the grid's "Add variation" card).
  onAddVariation: () => void
  isAddingVariation?: boolean
}

function cardKey(conceptId: string, segmentIndex: number): string {
  return `${conceptId}:${segmentIndex}`
}

// Split a card key back into its concept id + 1-based segment index. Concept
// ids never contain ':' (see nextConceptId), so the last ':' is the divider.
function parseCardKey(key: string): { conceptId: string; segmentIndex: number } {
  const i = key.lastIndexOf(':')
  return { conceptId: key.slice(0, i), segmentIndex: Number(key.slice(i + 1)) }
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Right-panel view for One Shot mode: concept cards, each holding one clickable
// clip card per segment. Clicking a clip opens the detail modal (model picker,
// prompt editor, settings, generate, gallery). Video plumbing (startVideoTask /
// finishVideoTask, in-flight queues, refresh-resume, videoHistory) mirrors the
// line-by-line path.
export default function OneShotView({
  result,
  isGenerating,
  error,
  characterRef,
  productRef,
  selectedModel,
  selectedProduct,
  productName,
  productContext,
  modelContext,
  oneShotModelId,
  cardStates,
  setCardStates,
  onAddVariation,
  isAddingVariation,
}: OneShotViewProps) {
  // The clip whose detail modal is open ("conceptId:segmentIndex"), or null.
  const [openKey, setOpenKey] = useState<string | null>(null)
  // Extra user-attached reference images per card key (memory-only, like the
  // Line-by-Line card's extraRefs — data: URIs are too big to persist).
  const [extraRefs, setExtraRefs] = useState<Record<string, ReferenceImage[]>>({})
  // Pending Generate-all / Generate request awaiting confirmation — video gens
  // are expensive, so a click opens a cost popup before firing.
  // `fresh` = clips with no rendered video yet; `done` = already generated.
  // Kept apart so a second press never silently re-bills clips the user already
  // paid for — video gens are the most expensive thing in the app.
  const [confirmGen, setConfirmGen] = useState<{ fresh: string[]; done: string[]; scope: string } | null>(null)
  const [includeExisting, setIncludeExisting] = useState(false)
  const [downloadingAll, setDownloadingAll] = useState(false)
  const balance = useCreditsStore((s) => s.balance)
  // Portals to body, so dismiss it on a dock switch.
  useCloseOnAppSwitch(!!confirmGen, () => setConfirmGen(null))

  // Seed a card state for every segment when a result lands (history restore
  // included). Existing entries win — they hold the user's edits and videos.
  useEffect(() => {
    if (!result) return
    setCardStates((prev) => {
      const next: Record<string, OneShotCardState> = {}
      for (const concept of result.concepts) {
        for (const segment of concept.segments) {
          const key = cardKey(concept.id, segment.index)
          next[key] = prev[key] ?? createDefaultOneShotCardState(segment, result.modelId)
        }
      }
      return next
    })
  }, [result, setCardStates])

  const updateCard = (key: string, updater: (prev: OneShotCardState) => Partial<OneShotCardState>) => {
    setCardStates((prev) => {
      const existing = prev[key]
      if (!existing) return prev
      return { ...prev, [key]: { ...existing, ...updater(existing) } }
    })
  }

  const toDataUri = async (ref: string): Promise<string | null> => {
    if (!isAssetRef(ref)) return ref
    const asset = await getAsBase64(ref)
    if (!asset) return null
    return `data:${asset.mimeType};base64,${asset.base64}`
  }

  // Clips whose start is underway but whose in-flight entry hasn't landed in
  // state yet. `isBusy`/`anyInFlight` read cardStates, which doesn't update
  // until the entry is pushed — and the push used to sit behind seconds of IDB
  // reads and video decoding, so a second click (or a Generate-all overlapping
  // a per-concept Generate) fired a duplicate paid generation of the same clip.
  const startingRef = useRef<Set<string>>(new Set())

  // ── Video generation (adaptation of VariationCard.runVideoTask) ──
  const runSegmentVideo = async (key: string) => {
    const card = cardStates[key]
    if (!card) return
    if (startingRef.current.has(key)) return
    const model = getModel(oneShotModelId)
    if (!model) {
      useAppStore.getState().addToast(`Unknown video model: ${oneShotModelId}`, 'error')
      return
    }
    startingRef.current.add(key)

    // Provisional entry, pushed BEFORE any await so the card shows pending and
    // the busy flags close immediately. Its mode/duration/resolution/prompt are
    // the card's own settings; the fire-time values are patched in below.
    const inFlightId = crypto.randomUUID()
    updateCard(key, (prev) => ({
      inFlightVideos: [
        ...prev.inFlightVideos,
        {
          id: inFlightId,
          taskId: null,
          modelId: oneShotModelId,
          startedAt: Date.now(),
          prompt: card.editablePrompt,
          mode: 'text-to-video',
          aspectRatio: card.aspectRatio,
          durationSeconds: card.durationSeconds,
          resolution: card.resolution,
          audio: card.audio,
        },
      ],
    }))

    let claimedTaskId: string | null = null
    try {
      const refs: ReferenceImage[] = [
        ...(card.refsCharacter && characterRef ? [characterRef] : []),
        ...(card.refsProduct && productRef ? [productRef] : []),
        ...(extraRefs[key] ?? []),
      ]
      const referenceDataUris: string[] = []
      for (const r of refs) {
        const uri = await toDataUri(r.dataUrl)
        if (uri) referenceDataUris.push(uri)
      }

      // Clip-to-clip handoff: a follow-up clip (index > 1) carries the PREVIOUS
      // clip's last frame as a reference so the setting + character position
      // continue instead of the model re-inventing "the same kitchen" blind. Only
      // when the toggle is on AND the previous clip has actually rendered (nothing
      // to grab otherwise — a first parallel "Generate all" won't have it yet, so
      // regenerating this clip after clip 1 lands is what picks it up).
      let boundaryFrameAttached = false
      const { conceptId, segmentIndex } = parseCardKey(key)
      if (card.carryPrevFrame !== false && segmentIndex > 1) {
        const prevCard = cardStates[cardKey(conceptId, segmentIndex - 1)]
        const prevVideo = prevCard?.videos[prevCard.currentVideoIndex] ?? prevCard?.videos[prevCard.videos.length - 1]
        if (prevVideo?.url) {
          try {
            const playable = await getUrl(prevVideo.url)
            if (playable) {
              const frame = await extractVideoFrame(playable, 'last')
              referenceDataUris.unshift(await blobToDataUri(frame))
              boundaryFrameAttached = true
            }
          } catch {
            // Non-fatal — the clip still generates, just without the handoff anchor.
          }
        }
      }

      let mode: VideoMode = referenceDataUris.length > 0 ? 'reference-to-video' : 'text-to-video'
      let effectiveRefs: string[] | undefined = referenceDataUris.length > 0 ? referenceDataUris : undefined
      if (mode === 'reference-to-video' && !model.modes?.includes('reference-to-video')) {
        useAppStore.getState().addToast(
          `${model.displayName} doesn't support reference images — generating text-to-video only.`,
          'error',
        )
        mode = 'text-to-video'
        effectiveRefs = undefined
      }

      // Fire-time re-validation against the CURRENT model.
      const constraints = model.videoConstraints
      const durationSeconds = constraints
        ? snapVideoDurationUp(card.durationSeconds, constraints.durations)
        : card.durationSeconds
      const resolution = constraints && !constraints.resolutions.includes(card.resolution)
        ? constraints.default ?? constraints.resolutions[0]
        : card.resolution

      // Resolve [CHARACTER]/[PRODUCT] tokens to plain words the moment before
      // sending — a video model reads brackets literally.
      // When the previous clip's last frame rode along (and refs survived the
      // model-capability check), tell the model the first reference is the handoff
      // anchor so it continues that exact setting rather than re-inventing it.
      const usingBoundaryFrame = boundaryFrameAttached && !!effectiveRefs
      const continuityNote = usingBoundaryFrame
        ? `\n\nCONTINUITY — The FIRST reference image is special: it is the FINAL FRAME of the previous clip, NOT an appearance reference. Unlike the identity references above (which you must not copy for framing or background), you SHOULD match this first image — its setting, props, framing, lighting, and the character's position and wardrobe — so this clip picks up moments later in the same place and the two cut together seamlessly. Then play out the action below.`
        : ''
      const rawPrompt = effectiveRefs
        ? `${buildReferencePreamble(refs)}${continuityNote}\n\n${card.editablePrompt}`
        : card.editablePrompt
      const promptText = resolveOneShotTokens(rawPrompt, productName)
      // Restyle at fire time: a stylized pick appends its STYLE block and drops the
      // iPhone-realism stack; UGC / legacy pass through untouched. The persisted
      // prompt + history stay unstyled — the style rides outside, like Continuous.
      const { prompt: styledPrompt, noRealism } = applyStyleToPrompt(promptText, {
        style: result?.style,
        realism: result?.realism,
      })

      // Fold the fire-time values onto the provisional entry so a refresh-resume
      // polls with what was actually sent.
      updateCard(key, (prev) => ({
        inFlightVideos: prev.inFlightVideos.map((e) =>
          e.id === inFlightId ? { ...e, prompt: promptText, mode, durationSeconds, resolution } : e,
        ),
      }))

      const { taskId, videoEndpoint } = await startVideoTask({
        prompt: styledPrompt,
        mode,
        referenceDataUris: effectiveRefs,
        aspectRatio: card.aspectRatio,
        durationSeconds,
        resolution,
        audio: card.audio,
        modelId: oneShotModelId,
        multiShots: true,
        noRealism,
      })
      updateCard(key, (prev) => ({
        inFlightVideos: prev.inFlightVideos.map((e) =>
          e.id === inFlightId ? { ...e, taskId, endpoint: videoEndpoint } : e,
        ),
      }))

      // Own this poll before the taskId is persisted — see taskRegistry.
      if (!claimTask('video', taskId)) return
      claimedTaskId = taskId

      const res = await finishVideoTask(taskId, oneShotModelId, videoEndpoint, durationSeconds, card.aspectRatio)
      const assetRef = `asset://${res.assetId}`
      const newVideo: GeneratedVideo = {
        url: assetRef,
        modelId: oneShotModelId,
        prompt: promptText,
        aspectRatio: res.aspectRatio,
        durationSeconds: res.durationSeconds,
        resolution,
        audio: card.audio,
        mode,
        createdAt: Date.now(),
      }
      updateCard(key, (prev) => {
        const newVideos = [...prev.videos, newVideo]
        return {
          videos: newVideos,
          currentVideoIndex: newVideos.length - 1,
          inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== inFlightId),
        }
      })

      const historyEntry: VideoHistoryItem = {
        id: crypto.randomUUID(),
        modelId: oneShotModelId,
        prompt: promptText,
        mode,
        aspectRatio: res.aspectRatio,
        durationSeconds: res.durationSeconds,
        resolution,
        audio: card.audio,
        videoUrl: assetRef,
        sourceApp: 'broll-studio',
        createdAt: Date.now(),
      }
      await useBankStore.getState().addVideoHistory(historyEntry)
      useAppStore.getState().addToast('One-Shot clip ready', 'success')
    } catch (err) {
      if (isPollTimeout(err)) return
      const msg = humanizeError(err, 'Video generation failed.')
      updateCard(key, (prev) => ({
        inFlightVideos: prev.inFlightVideos.map((e) =>
          e.id === inFlightId ? { ...e, error: msg } : e,
        ),
      }))
      useAppStore.getState().addToast(`Video generation failed: ${msg}`, 'error')
    } finally {
      if (claimedTaskId) releaseTask('video', claimedTaskId)
      startingRef.current.delete(key)
    }
  }

  const deleteVideo = (key: string, index: number) => {
    updateCard(key, (prev) => {
      const videos = prev.videos.filter((_, i) => i !== index)
      return { videos, currentVideoIndex: Math.max(0, Math.min(prev.currentVideoIndex, videos.length - 1)) }
    })
  }
  const retryInFlight = (key: string, id: string) => {
    updateCard(key, (prev) => ({ inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== id) }))
    void runSegmentVideo(key)
  }
  const dismissInFlight = (key: string, id: string) => {
    updateCard(key, (prev) => ({ inFlightVideos: prev.inFlightVideos.filter((e) => e.id !== id) }))
  }

  // ── Refresh-resume (lean copy of ScenesView's video-queue walker) ──
  const INFLIGHT_TTL_MS = 30 * 60 * 1000
  useEffect(() => {
    const now = Date.now()
    setCardStates((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [key, card] of Object.entries(prev)) {
        const stalled = card.inFlightVideos.filter((e) => !e.taskId && now - e.startedAt > INFLIGHT_TTL_MS)
        if (stalled.length === 0) continue
        changed = true
        next[key] = {
          ...card,
          inFlightVideos: card.inFlightVideos.map((e) =>
            stalled.includes(e) ? { ...e, error: 'Generation stalled before kie returned a task id. Dismiss and try again.' } : e,
          ),
        }
      }
      return changed ? next : prev
    })

    for (const [key, card] of Object.entries(cardStates)) {
      for (const entry of card.inFlightVideos) {
        if (!entry.taskId) continue
        // Skip tasks a live generation promise still owns — a view unmounted by
        // a History/mode switch keeps polling, so resuming here would duplicate.
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
            setCardStates((prev) => {
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
            useAppStore.getState().addToast('One-Shot clip ready', 'success')
          } catch (err) {
            if (isPollTimeout(err)) return
            const msg = humanizeError(err, 'Video resume failed.')
            setCardStates((prev) => {
              const existing = prev[key]
              if (!existing) return prev
              return { ...prev, [key]: { ...existing, inFlightVideos: existing.inFlightVideos.map((e) => e.id === inFlightId ? { ...e, error: msg } : e) } }
            })
            useAppStore.getState().addToast(`Video resume failed: ${msg}`, 'error')
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
          messages={['Reading the script...', 'Planning the clips...', 'Designing 4 variations...', 'Writing scene blueprints...']}
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
            {[0, 1, 2, 3].map((i) => (
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
        <Clapperboard className="h-10 w-10 text-ink-800" strokeWidth={1.5} />
        <p className="text-sm text-ink-700">Generate the whole ad as one video</p>
        <p className="text-xs text-ink-800">4 variations, each a single multi-cut clip — no image step</p>
        {error && (
          <div className="mt-2 flex max-w-sm items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400 light:text-red-600" />
            <p className="text-xs leading-relaxed text-red-300 light:text-red-700">{error}</p>
          </div>
        )}
      </div>
    )
  }

  const planModel = getModel(result.modelId)
  const currentModel = getModel(oneShotModelId)
  const stalePlan = result.modelId !== oneShotModelId

  // Resolve the open clip → its concept + segment for the modal.
  const openConcept = openKey ? result.concepts.find((c) => c.segments.some((s) => cardKey(c.id, s.index) === openKey)) : undefined
  const openSegment = openConcept?.segments.find((s) => cardKey(openConcept.id, s.index) === openKey)
  const openCard = openKey ? cardStates[openKey] : undefined
  // Has the clip immediately before the open one actually rendered? Gates the
  // "continue from previous clip" toggle (nothing to grab until it has).
  const openPrevClipReady = !!openConcept && !!openSegment && openSegment.index > 1
    ? (cardStates[cardKey(openConcept.id, openSegment.index - 1)]?.videos.length ?? 0) > 0
    : false

  // One row = one CONCEPT (a distinct creative style); the concept's clips are
  // the cards within that row. A short ad is one clip = one card; a longer one
  // splits into sequential clips (Clip 1, Clip 2…) that cut together — still
  // one concept, one row. Different rows = different styles. Card keying is
  // `${conceptId}:${segmentIndex}`.
  // Only *active* (non-errored) in-flight gens disable Generate-all — a card
  // left with a Failed entry must not lock the buttons forever.
  const anyInFlight = Object.values(cardStates).some((c) => c.inFlightVideos.some((e) => !e.error))
  // Open the cost-confirm popup for a set of clips (never fire straight away).
  // Clips with an empty blueprint are dropped here rather than firing a paid
  // gen on an empty prompt — the modal's own Generate guards the same way.
  const requestGenerate = (keys: string[], scope: string) => {
    const targets = keys.filter((k) => cardStates[k] && cardStates[k].editablePrompt.trim())
    if (targets.length === 0) {
      useAppStore.getState().addToast('No blueprints ready to generate.', 'error')
      return
    }
    const fresh = targets.filter((k) => (cardStates[k]?.videos.length ?? 0) === 0)
    const done = targets.filter((k) => (cardStates[k]?.videos.length ?? 0) > 0)
    // Default to skipping what's already rendered. When everything is done the
    // dialog still opens — the toggle is the only way forward, so "regenerate
    // the lot" stays possible but never accidental.
    setIncludeExisting(false)
    setConfirmGen({ fresh, done, scope })
  }
  // What this run will actually fire.
  const confirmTargets = confirmGen
    ? includeExisting
      ? [...confirmGen.fresh, ...confirmGen.done]
      : confirmGen.fresh
    : []
  const confirmGenerate = () => {
    if (!confirmGen || confirmTargets.length === 0) return
    confirmTargets.forEach((k) => void runSegmentVideo(k))
    setConfirmGen(null)
  }
  const allKeys = result.concepts.flatMap((c) => c.segments.map((s) => cardKey(c.id, s.index)))

  // Every rendered clip across all variations, for "Download all".
  const allClipEntries = result.concepts.flatMap((c, ci) =>
    c.segments.flatMap((s) => {
      const vids = cardStates[cardKey(c.id, s.index)]?.videos ?? []
      return vids.map((v, vi) => ({
        ref: v.url,
        name: `variation${ci + 1}-clip${s.index}${vids.length > 1 ? `-take${vi + 1}` : ''}`,
      }))
    }),
  )
  const downloadAll = async () => {
    if (downloadingAll || allClipEntries.length === 0) return
    setDownloadingAll(true)
    try {
      const n = await downloadAssetsZip(allClipEntries, 'oneshot-clips')
      useAppStore.getState().addToast(`Downloading ${n} clip${n === 1 ? '' : 's'} as a zip`, 'success')
    } catch (err) {
      useAppStore.getState().addToast(humanizeError(err, 'Could not download the clips.'), 'error')
    } finally {
      setDownloadingAll(false)
    }
  }
  // Credits for the pending run — summed per clip at each card's settings,
  // put through the SAME fire-time clamp runSegmentVideo applies (duration
  // snapped up onto the model's grid, unsupported resolutions swapped). A card
  // planned on another model otherwise quotes a duration this model can't bill
  // — exactly the stale-plan case the banner above warns about.
  const confirmConstraints = getModel(oneShotModelId)?.videoConstraints
  const confirmCredits = confirmGen
    ? confirmTargets.reduce((sum, k) => {
        const card = cardStates[k]
        if (!card) return sum
        const durationSeconds = confirmConstraints
          ? snapVideoDurationUp(card.durationSeconds, confirmConstraints.durations)
          : card.durationSeconds
        const resolution = confirmConstraints && !confirmConstraints.resolutions.includes(card.resolution)
          ? confirmConstraints.default ?? confirmConstraints.resolutions[0]
          : card.resolution
        return sum + (estimateCredits(oneShotModelId, { durationSeconds, resolution, audio: card.audio }) ?? 0)
      }, 0)
    : 0
  const overBudget = balance !== null && confirmCredits > balance

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      {result.demo && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-broll-500/25 bg-broll-500/10 px-4 py-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-broll-300" />
          <p className="text-xs leading-relaxed text-ink-300">
            <span className="font-semibold text-broll-300">Sample variations.</span>{' '}
            This is a preview of what One-Shot produces. Add your kie.ai key in Settings to generate variations from your own script and render the clips.
          </p>
        </div>
      )}
      {stalePlan && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300 light:text-amber-700" />
          <p className="text-xs leading-relaxed text-amber-200 light:text-amber-800">
            These variations were split for {planModel?.displayName ?? result.modelId}. You can still generate with{' '}
            {currentModel?.displayName ?? oneShotModelId} (clip lengths re-snap automatically), or regenerate to re-plan the split.
          </p>
        </div>
      )}
      {result.capped && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300 light:text-amber-700" />
          <p className="text-xs leading-relaxed text-amber-200 light:text-amber-800">
            The script runs long (~{result.estimatedSeconds}s of speech) — each concept was split into {result.segmentCount} clips that cut together. For longer scripts, Line-by-Line gives finer control.
          </p>
        </div>
      )}
      {result.concepts.length < 4 && (
        <p className="mb-4 text-[11px] text-ink-600">
          {result.concepts.length} of 4 variations generated — the rest failed. Regenerate for a fresh set.
        </p>
      )}

      {/* Top strip — full-ad meta + Generate-all, mirroring ScenesView. */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-400">
          <span>{result.concepts.length} {result.concepts.length === 1 ? 'style' : 'styles'}</span>
          <span className="rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[10px] text-ink-300">{result.delivery === 'dialogue' ? 'With Dialogue' : 'B-Roll'}</span>
          <span className="rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[10px] text-ink-300">~{result.estimatedSeconds}s</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => requestGenerate(allKeys, 'Every variation')}
            disabled={anyInFlight}
            title="Generate the video for every variation"
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-broll-500 px-3.5 py-1.5 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <VideoIcon className="h-3.5 w-3.5" />
            Generate all
          </button>
          {allClipEntries.length > 0 && (
            <button
              type="button"
              onClick={() => void downloadAll()}
              disabled={downloadingAll}
              title="Download every rendered clip as a single zip"
              className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {downloadingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {downloadingAll ? 'Zipping…' : `Download all (${allClipEntries.length})`}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-10">
        {result.concepts.map((concept, i) => (
          <ConceptRow
            key={concept.id}
            conceptNumber={i + 1}
            concept={concept}
            cardStates={cardStates}
            onOpenClip={setOpenKey}
            onGenerateConcept={() => requestGenerate(concept.segments.map((s) => cardKey(concept.id, s.index)), `Variation ${i + 1}`)}
          />
        ))}
        <AddVariationRow onAdd={onAddVariation} adding={!!isAddingVariation} />
      </div>

      {confirmGen && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
          onClick={() => setConfirmGen(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-ink/10 bg-ink-950/95 p-5 shadow-2xl"
          >
            <h3 className="text-sm font-medium text-ink-100">
              Generate {confirmTargets.length} clip{confirmTargets.length === 1 ? '' : 's'}?
            </h3>
            <p className="mt-1 text-xs text-ink-500">
              {confirmGen.scope} · all render in parallel and survive a refresh.
              {confirmGen.done.length > 0 && !includeExisting && (
                <> {confirmGen.done.length} clip{confirmGen.done.length === 1 ? '' : 's'} already
                {confirmGen.done.length === 1 ? ' has' : ' have'} a video and will be skipped.</>
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
                  Also regenerate the {confirmGen.done.length} clip
                  {confirmGen.done.length === 1 ? '' : 's'} that already {confirmGen.done.length === 1 ? 'has' : 'have'} a video
                </span>
              </label>
            )}
            <div className="mt-4 flex items-center justify-between rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5 text-xs">
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
                disabled={confirmTargets.length === 0}
                className="flex items-center gap-1.5 rounded-full border border-white/15 bg-broll-500 px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <VideoIcon className="h-3.5 w-3.5" />
                Generate
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {openKey && openConcept && openSegment && openCard && (
        <OneShotDetailModal
          segment={openSegment}
          conceptAngle={openConcept.angle}
          conceptNumber={result.concepts.findIndex((c) => c.id === openConcept.id) + 1}
          clipLabel={openConcept.segments.length > 1 ? `Clip ${openSegment.index}` : ''}
          delivery={result.delivery}
          cardState={openCard}
          prevClipReady={openPrevClipReady}
          oneShotModelId={oneShotModelId}
          characterRef={characterRef}
          productRef={productRef}
          selectedModel={selectedModel}
          selectedProduct={selectedProduct}
          productContext={productContext}
          modelContext={modelContext}
          extraRefs={extraRefs[openKey] ?? []}
          onAddExtraRef={(r) => setExtraRefs((prev) => {
            const cur = prev[openKey] ?? []
            return cur.length >= 4 ? prev : { ...prev, [openKey]: [...cur, r] }
          })}
          onRemoveExtraRef={(i) => setExtraRefs((prev) => ({
            ...prev,
            [openKey]: (prev[openKey] ?? []).filter((_, idx) => idx !== i),
          }))}
          onClose={() => setOpenKey(null)}
          onUpdate={(updater) => updateCard(openKey, updater)}
          onGenerate={() => runSegmentVideo(openKey)}
          onDeleteVideo={(i) => deleteVideo(openKey, i)}
          onRetryInFlight={(id) => retryInFlight(openKey, id)}
          onDismissInFlight={(id) => dismissInFlight(openKey, id)}
        />
      )}
    </div>
  )
}

// ── Concept row (one concept/style per row; cards = its clips) ──
// Mirrors ScenesView's SceneSection: a serif concept number, a vertical rule,
// the concept's angle pill + one-line summary in Instrument Serif, and a
// Generate-all, then the concept's clip cards across one row. A short ad is a
// single clip = one card; a long one splits into Clip 1 / Clip 2 that cut
// together — still one concept, one row.

function ConceptRow({
  conceptNumber,
  concept,
  cardStates,
  onOpenClip,
  onGenerateConcept,
}: {
  conceptNumber: number
  concept: OneShotConcept
  cardStates: Record<string, OneShotCardState>
  onOpenClip: (key: string) => void
  onGenerateConcept: () => void
}) {
  const multiClip = concept.segments.length > 1
  const anyInFlight = concept.segments.some((s) => cardStates[cardKey(concept.id, s.index)]?.inFlightVideos.some((e) => !e.error) ?? false)
  return (
    <div className="-m-4 p-4" style={{ contentVisibility: 'auto', containIntrinsicSize: '700px' }}>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            className="text-5xl font-normal italic tabular-nums text-ink-800"
            style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
          >
            {String(conceptNumber).padStart(2, '0')}
          </span>
          <div className="h-8 w-px bg-ink/10" />
          <div className="flex min-w-0 flex-col gap-1.5">
            {/* Pill = "Variation N" (identity, like Line-by-Line's "Line N");
                the serif names the style/type. */}
            <span className="inline-flex w-fit rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              Variation {conceptNumber}
            </span>
            <p
              className="text-lg font-normal not-italic leading-relaxed text-ink-400"
              style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
            >
              {concept.angle.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onGenerateConcept}
          disabled={anyInFlight}
          title={multiClip ? 'Generate every clip in this concept' : 'Generate this concept'}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <VideoIcon className="h-3.5 w-3.5" />
          {multiClip ? 'Generate all' : 'Generate'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {concept.segments.map((segment) => (
          <OSVariationCard
            key={segment.index}
            segment={segment}
            cardState={cardStates[cardKey(concept.id, segment.index)]}
            onOpen={() => onOpenClip(cardKey(concept.id, segment.index))}
          />
        ))}
      </div>
    </div>
  )
}

// ── Variation card (Line-by-Line chrome, video-only) ───────────
// One clip of a concept. Same face as VariationCard: a 9:16 rounded card with
// a top-centre pill, the rendered clip once it exists (else the blueprint faded
// out), and a quiet caption. Click opens the video-only detail modal.

function OSVariationCard({
  segment,
  cardState,
  onOpen,
}: {
  segment: OneShotSegment
  cardState?: OneShotCardState
  onOpen: () => void
}) {
  const currentVideo = cardState && cardState.videos.length > 0
    ? cardState.videos[Math.min(cardState.currentVideoIndex, cardState.videos.length - 1)]
    : undefined
  const videoUrl = useAssetUrl(currentVideo?.url ?? '')
  const inFlight = cardState?.inFlightVideos.some((e) => !e.error) ?? false
  const errored = cardState?.inFlightVideos.some((e) => e.error) ?? false
  const duration = cardState?.durationSeconds ?? segment.durationSeconds

  // Inline playback on the card face — mirrors Line-by-Line's VariationCard.
  // Hover autoplays muted; an explicit Play click plays with sound and keeps
  // playing after the mouse leaves.
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
    await downloadImage(resolved, `oneshot-clip-${segment.index}`, 'mp4')
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
        className="relative aspect-[9/16] cursor-pointer overflow-hidden rounded-xl border border-ink/[0.08] bg-ink/[0.02] transition-all hover:border-ink/15 hover:-translate-y-px card-soft-shadow"
      >
        {inFlight ? (
          <>
            <GeneratingBackdrop family="broll" />
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center">
              <GenerationProgress
                isActive
                color="bg-broll-500"
                showHelper={false}
                messages={['Sending request...', 'Storyboarding frames...', 'Rendering motion...', 'Finalizing the clip...']}
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
            {/* Always-visible play/pause — top-left. Plays with audio in place. */}
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
            {cardState && cardState.videos.length > 1 && (
              <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white backdrop-blur transition-opacity group-hover:opacity-0">
                {Math.min(cardState.currentVideoIndex, cardState.videos.length - 1) + 1}/{cardState.videos.length}
              </span>
            )}
          </>
        ) : segment.prompt.trim() ? (
          <>
            <div className="flex h-full w-full flex-col px-3 pb-3 pt-9">
              <p
                className="flex-1 overflow-hidden whitespace-pre-wrap text-[11px] leading-relaxed tracking-tight text-ink-400"
                style={{ maskImage: 'linear-gradient(to bottom, #000 72%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 72%, transparent)' }}
              >
                {segment.prompt}
              </p>
            </div>
            <p className="pointer-events-none absolute bottom-2 left-3 z-10 text-[10px] font-medium tracking-tight text-ink-500 transition-opacity group-hover:opacity-0">
              Click to set up
            </p>
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
            <VideoIcon className="h-7 w-7 text-ink-700" strokeWidth={1.5} />
            <p className="text-[11px] text-ink-500">Click to set up</p>
          </div>
        )}

        {/* Top-centre pill — which clip this is (always shown, "Clip 1" for a
            single-clip concept). Neutral + small, Line-by-Line pill size. Stays
            visible on hover (the action row is at the bottom). */}
        <span className={`pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full border border-ink/15 bg-ink/10 px-2 py-0.5 text-[10px] font-medium tracking-tight text-ink-300 backdrop-blur transition-opacity ${controlsExpanded ? 'opacity-0' : ''}`}>
          Clip {segment.index}
        </span>

        {errored && (
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

      {/* Quiet caption below the card — the Line-by-Line roll-type slot. */}
      <p className="text-center text-[10px] font-medium tracking-wider text-ink-500">
        {duration}s
      </p>
    </div>
  )
}

// ── Add-variation row ──────────────────────────────────────────
// One more concept/style on demand — fires a fresh-angle LLM concept upstream,
// which lands as a new row. Full-width so it reads as "add another style".

function AddVariationRow({ onAdd, adding }: { onAdd: () => void; adding: boolean }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={adding}
      title="Generate one more concept in a fresh style"
      className="group/add flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-ink/20 bg-ink/[0.03] py-5 transition-colors hover:border-broll-400/60 hover:bg-broll-500/10 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {adding ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-broll-300" />
      ) : (
        <Plus className="h-4 w-4 shrink-0 text-ink-400 transition-colors group-hover/add:text-broll-300" />
      )}
      <span className="text-[12px] font-medium text-ink-300 transition-colors group-hover/add:text-broll-300">
        {adding ? 'Adding a style…' : 'Add another style'}
      </span>
    </button>
  )
}
