import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Film, AlertCircle, Plus, Images, X, Palette, Download, Video as VideoIcon, Clapperboard, Coins, Pencil, Check, ChevronRight, ChevronDown, Sparkle } from 'lucide-react'
import GenerationProgress from '../../../components/GenerationProgress'
import type { BrollResult, Scene, PromptVariation, CardState, ReferenceImage, BatchVideoSettings } from '../types'
import type { Product, Model } from '../../../stores/types'
import { createDefaultCardState } from '../cardState'
import { cardClipSeconds, speaksItsLine } from '../services/clipDuration'
import type { VideoHistoryItem } from '../../../stores/types'
import { finishImageTask, resolveImageModelId } from '../services/generateBroll'
import { getContinuousStyle } from '../services/generateContinuous'
import { finishVideoTask } from '../services/generateVideo'
import { claimTask, releaseTask } from '../services/taskRegistry'
import { useReconnectTick } from '../../../hooks/useReconnectTick'
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
import ClipDownloadModal, { type ClipDownloadEntry } from '../../../components/ClipDownloadModal'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import AnchoredPopover from '../../../components/video/AnchoredPopover'
import { useBackdropClose } from '../../../hooks/useBackdropClose'

interface ScenesViewProps {
  result: BrollResult | null
  isGenerating?: boolean
  error?: string | null
  onAddVariation: (sceneNumber: number, variation: PromptVariation) => void
  onDeleteVariation: (sceneNumber: number, variationId: string) => void
  // Retype a scene's spoken line. Swaps the quoted words in that scene's
  // prompts — no LLM call, no credits. See services/scriptLineEdit.ts.
  onEditSceneLine?: (sceneNumber: number, line: string) => void
  // Edit the ad's shared dialogue voice profile (from a dialogue card's modal).
  onUpdateVoiceProfile?: (text: string) => void
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
  productPhotos?: string[]
  onChangeStyle?: () => void
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
// starts at the smallest usable size rather than inheriting whatever each card
// was last left on. It clamps to the chosen model's grid.
const BATCH_VIDEO_RESOLUTION = '480p'

// Clip length is the exception on a WITH DIALOGUE storyboard, and there it
// defaults to AUTO: a dozen spoken lines are a dozen different lengths, so one
// number for all of them is exactly the flat-5s problem the per-line estimate
// exists to fix — the long lines come back gabbled and the short ones come back
// slow. Each card uses its own length (its line's estimate, or whatever the
// member pinned in its modal) unless the dialog is set to a fixed number, which
// is still one click away. A silent b-roll run never offers this row: nothing in
// it is speaking, so there are no words for a length to follow.
const AUTO_DURATION = 'auto'

// Stands in for a card that somehow has no state yet when the dialog prices the
// run. Only reachable between a fresh storyboard landing and the card-state
// rebuild, and only as a number to multiply — the card itself re-derives its
// own length when it fires.
const BATCH_VIDEO_DURATION_FALLBACK = 5

// The two ways a card's still can drive a clip: as a true first frame, or as a
// reference image (Gemini Omni's only route — it has no image-to-video mode but
// animates a still perfectly well as a reference). A model with neither can't
// use the still at all, which is what greys it out in the batch dialog.
const STILL_CAPABLE_MODES: Mode[] = ['image-to-video', 'reference-to-video']

// ─── Option columns ──────────────────────────────────────────────────────
// The storyboard is a grid: one row per script line, one column per option.
// Both header batches open on ALL options. They used to open on the leftmost
// column with work left, so that a second press picked up where the first left
// off — cheaper per press, but a button labelled "Generate all images" that
// quietly does a third of them is a button that doesn't do what it says, and
// members read the short run as a bug rather than a saving. The Options chips
// still scope a run; scoping is the deliberate act now, not the default.
type BatchColumn = number | 'all'

interface BatchRequest {
  // Every card the press covers. The column filter is applied inside the
  // dialog, so switching columns re-scopes without reopening.
  keys: string[]
  scope: string
  // Only a multi-scene batch offers columns; a single scene's row is one
  // card per column, where the choice means nothing.
  columnar: boolean
  // Video runs only: animate the stills that exist, and nothing else. A plain
  // video batch also fires cards that have no image yet, rendering those from
  // the prompt alone — which is a different, blinder spend. After a
  // Generate-all-images pass, "animate what I can see" is the step the member
  // actually wants.
  stillsOnly?: boolean
}

// Card keys are `${scene.number}-${variationIndex}` — the index IS the column.
const columnOf = (key: string) => Number(key.split('-')[1])

const columnsIn = (keys: string[]) =>
  [...new Set(keys.map(columnOf))].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)

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
  onEditSceneLine,
  onUpdateVoiceProfile,
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
  // In "Dialogue Clips" delivery each scene carries one talking-to-camera card,
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
  const [batchConfirm, setBatchConfirm] = useState<BatchRequest | null>(null)
  const [batchColumn, setBatchColumn] = useState<BatchColumn>('all')
  const [includeExisting, setIncludeExisting] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  // The batch menu: one "Generate all" opening the three passes, rather than
  // three pills competing on the bar. See the note where it renders.
  const generateAllRef = useRef<HTMLButtonElement>(null)
  const [generateAllOpen, setGenerateAllOpen] = useState(false)
  // The confirm dialog portals to document.body, so it would outlive an app
  // switch — dismiss it when the user docks away.
  useCloseOnAppSwitch(!!batchConfirm, () => setBatchConfirm(null))
  const batchBackdrop = useBackdropClose(() => setBatchConfirm(null))
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
  // Only cards with a prompt can generate — everything else is skipped
  // silently, here and in the target maths below.
  const promptReady = (key: string) => (cardStates[key]?.editablePrompt ?? '').trim().length > 0
  const hasImage = (key: string) => (cardStates[key]?.images.length ?? 0) > 0

  // The cards this press covers, narrowed to the picked option column.
  const batchColumns = batchConfirm?.columnar ? columnsIn(batchConfirm.keys) : []
  const batchScoped = batchConfirm
    ? batchConfirm.keys.filter(
        (k) => promptReady(k) && (batchColumn === 'all' || columnOf(k) === batchColumn),
      )
    : []
  // `fresh` = prompt-ready cards with no image yet; `done` = cards already
  // generated. Kept apart so a second press doesn't silently re-bill work the
  // user already paid for and picked through — see includeExisting.
  const batchFresh = batchScoped.filter((k) => !hasImage(k))
  const batchDone = batchScoped.filter(hasImage)
  // What this run will actually fire: the untouched cards, plus the already-
  // generated ones only when the user explicitly opts in.
  const batchTargets = includeExisting ? [...batchFresh, ...batchDone] : batchFresh
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

  const requestBatch = (keys: string[], scope: string, columnar = false) => {
    const targets = keys.filter(promptReady)
    if (targets.length === 0) {
      useAppStore.getState().addToast('No prompts ready to generate.', 'error')
      return
    }
    // Default to skipping what's already generated. When everything is done the
    // dialog still opens — with the toggle as the only way forward — so
    // "regenerate the lot" stays possible but never accidental.
    setIncludeExisting(false)
    // All options — see the note on BatchColumn. Cards that already hold an
    // image are still held back by the toggle above, so this is "every option
    // that has no still yet", not a re-render of the storyboard.
    setBatchColumn('all')
    setBatchConfirm({ keys, scope, columnar })
  }

  // Every card in the run is armed in the same tick — the anchor-take cards
  // included. They used to run as a queue instead, one armed each time the
  // previous one's still landed, so that card N could chain from card N-1's
  // picture. The cost of that was the whole run: `dialogueChainRefs` only ever
  // feeds the FIRST variation of each scene, which is the anchor column, so a
  // member scoping the batch to Option 1 (the common case — one card per line)
  // got a run that rendered one card, waited a minute for it, then started the
  // next. Twelve lines took twenty minutes, and eleven of the twelve cards sat
  // showing nothing at all, which reads as a batch that never fired.
  //
  // So the chain is best-effort now: a card still attaches the nearest earlier
  // anchor still that EXISTS when it fires (an earlier run's, or one generated
  // from the card itself), and a fresh run simply has none to attach. What
  // holds the anchor column together in a fresh run is the prompt, which
  // already restates the same place, wardrobe, light and camera in every
  // scene's VAR_1 — see the anchor-take clause in generateBroll's dialogue
  // addendum. The backend stagger nobody has to think about is `submitToKie`:
  // the POSTs drip out under kie's rate limit while every tile shows generating
  // from the press.
  const confirmBatch = () => {
    if (!batchConfirm || batchTargets.length === 0) return
    setBatchImageOverride({ aspectRatio: effectiveBatchAspect ?? '9:16', resolution: effectiveBatchRes })
    setBatchTokens((prev) => {
      const next = { ...prev }
      for (const k of batchTargets) next[k] = (next[k] ?? 0) + 1
      return next
    })
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
  const [videoConfirm, setVideoConfirm] = useState<BatchRequest | null>(null)
  const [videoColumn, setVideoColumn] = useState<BatchColumn>('all')
  const [includeExistingVideos, setIncludeExistingVideos] = useState(false)
  const [batchVideoOverride, setBatchVideoOverride] = useState<BatchVideoSettings | null>(null)
  const [batchVideoResolution, setBatchVideoResolution] = useState<string | undefined>(undefined)
  // undefined = untouched (→ Auto); a number = a length pinned for the whole run.
  const [batchVideoDuration, setBatchVideoDuration] = useState<number | undefined>(undefined)
  useCloseOnAppSwitch(!!videoConfirm, () => setVideoConfirm(null))
  useCloseOnEscape(!!videoConfirm, () => setVideoConfirm(null))
  const videoBackdrop = useBackdropClose(() => setVideoConfirm(null))

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
  // Card key → the script line that card's clip has to hold, and whether that
  // card SPEAKS it, so an Auto run can price each card at its own length.
  const scriptLineByKey: Record<string, string> = {}
  const spokenByKey: Record<string, boolean> = {}
  for (const scene of result?.scenes ?? []) {
    for (let i = 0; i < scene.variations.length; i++) {
      scriptLineByKey[`${scene.number}-${i}`] = scene.scriptLine
      spokenByKey[`${scene.number}-${i}`] = speaksItsLine(scene.variations[i])
    }
  }
  // Auto is only on this menu when some card in the storyboard speaks its line —
  // i.e. this is a Dialogue Clips session. A silent b-roll run has no words to
  // fit anywhere in it, so the run pins one length exactly as it did before Auto
  // existed. Derived from the storyboard rather than from the ticked targets, so
  // the chip doesn't change shape as options are scoped in and out.
  const runHasSpokenCard = Object.values(spokenByKey).some(Boolean)
  const defaultPinnedDuration = batchVideoDurationOptions.length > 0
    ? snapVideoDuration(BATCH_VIDEO_DURATION_FALLBACK, batchVideoDurationOptions)
    : BATCH_VIDEO_DURATION_FALLBACK
  // The length pinned for the whole run, or undefined for Auto. A pin the
  // picked model doesn't offer falls back to Auto rather than snapping to some
  // other number — a model swap inside the dialog shouldn't quietly re-tier a
  // dozen clips to a length nobody chose. With no Auto to fall back to, it
  // lands on the flat default instead.
  const pinnedVideoDuration =
    batchVideoDuration && batchVideoDurationOptions.includes(batchVideoDuration)
      ? batchVideoDuration
      : runHasSpokenCard
        ? undefined
        : defaultPinnedDuration
  const clipSecondsFor = (key: string) =>
    pinnedVideoDuration
      ?? cardClipSeconds(
        cardStates[key] ?? { cardVideoDurationSeconds: BATCH_VIDEO_DURATION_FALLBACK },
        scriptLineByKey[key] ?? '',
        batchVideoModelId,
        { spoken: spokenByKey[key] ?? false },
      )
  const hasVideo = (key: string) => (cardStates[key]?.videos.length ?? 0) > 0
  // What makes a card eligible for this run: a still to animate, or (for a
  // plain video batch) just a prompt to render from.
  const videoEligible = videoConfirm?.stillsOnly ? hasImage : promptReady
  const videoColumns = videoConfirm?.columnar ? columnsIn(videoConfirm.keys) : []
  const videoScoped = videoConfirm
    ? videoConfirm.keys.filter(
        (k) => videoEligible(k) && (videoColumn === 'all' || columnOf(k) === videoColumn),
      )
    : []
  const videoFresh = videoScoped.filter((k) => !hasVideo(k))
  const videoDone = videoScoped.filter(hasVideo)
  const videoTargets = includeExistingVideos ? [...videoFresh, ...videoDone] : videoFresh
  // How many of this run animate a still they already have. The rest render
  // from the prompt alone — worth saying out loud, since those cost the same
  // but come back as something the member hasn't seen a frame of.
  const videoAnimateCount = videoTargets.filter((k) => (cardStates[k]?.images.length ?? 0) > 0).length
  const videoSourceNote =
    // Redundant in a stills-only run: the title already says every clip comes
    // off a still.
    videoTargets.length === 0 || videoConfirm?.stillsOnly ? null
      : videoAnimateCount === videoTargets.length ? 'from the card stills'
        : videoAnimateCount === 0 ? 'from the prompts'
          : `${videoAnimateCount} from a still, ${videoTargets.length - videoAnimateCount} from the prompt`
  const videoBatchCredits = batchVideoModelId
    ? videoTargets.reduce<number | null>((sum, key) => {
        if (sum === null) return null
        const credits = estimateCredits(batchVideoModelId, {
          durationSeconds: clipSecondsFor(key),
          resolution: effectiveVideoRes,
          audio: cardStates[key]?.cardVideoAudio ?? true,
        })
        return credits == null ? null : sum + credits
      }, 0)
    : null
  // What the run's clip lengths actually come out as, for the Auto chip: one
  // number when every line lands the same, a range otherwise. Every clip in the
  // run is billed, so the spread it's paying for belongs on screen.
  const videoTargetSeconds = videoTargets.map(clipSecondsFor)
  const autoDurationLabel = videoTargetSeconds.length === 0
    ? 'Auto'
    : (() => {
        const lo = Math.min(...videoTargetSeconds)
        const hi = Math.max(...videoTargetSeconds)
        return lo === hi ? `Auto · ${lo}s` : `Auto · ${lo}–${hi}s`
      })()
  // A single representative length for the model picker's price comparison —
  // it ranks models against each other, so the run's average is enough.
  const representativeSeconds = videoTargetSeconds.length > 0
    ? Math.round(videoTargetSeconds.reduce((a, b) => a + b, 0) / videoTargetSeconds.length)
    : pinnedVideoDuration ?? BATCH_VIDEO_DURATION_FALLBACK
  const videoOverBudget = videoBatchCredits != null && balance !== null && videoBatchCredits > balance
  // A model that takes neither a start frame nor reference images can't animate
  // a still, so every card holding one would fail at fire time — a dozen
  // identical error toasts and nothing rendered. Say so here and hold the run.
  const videoModelModes = batchVideoModelId ? getModel(batchVideoModelId)?.modes ?? [] : []
  const videoModelCantAnimate =
    videoAnimateCount > 0 &&
    !videoModelModes.includes('image-to-video') &&
    !videoModelModes.includes('reference-to-video')

  const requestVideoBatch = (keys: string[], scope: string, columnar = false, stillsOnly = false) => {
    const eligible = stillsOnly ? hasImage : promptReady
    const targets = keys.filter(eligible)
    if (targets.length === 0) {
      useAppStore.getState().addToast(
        stillsOnly ? 'No stills to animate yet.' : 'No prompts ready to generate.',
        'error',
      )
      return
    }
    // Cards that already have a clip are held back by default — a video is the
    // expensive half of this app, so re-billing one takes an explicit tick.
    setIncludeExistingVideos(false)
    // All options — see the note on BatchColumn. Cards that already hold a clip
    // are still held back, so this is "every option that has no video yet",
    // not a re-bill of the storyboard.
    setVideoColumn('all')
    setVideoConfirm({ keys, scope, columnar, stillsOnly })
  }

  const confirmVideoBatch = () => {
    if (!videoConfirm || videoTargets.length === 0 || !batchVideoModelId) return
    setBatchVideoOverride({
      modelId: batchVideoModelId,
      resolution: effectiveVideoRes,
      // Absent on an Auto run — each card then uses its own per-line length.
      ...(pinnedVideoDuration ? { durationSeconds: pinnedVideoDuration } : {}),
    })
    setVideoTokens((prev) => {
      const next = { ...prev }
      for (const k of videoTargets) next[k] = (next[k] ?? 0) + 1
      return next
    })
    setVideoConfirm(null)
  }

  // Rebuild card states from the current result. Carries existing state
  // forward when prompts match (same generation, re-render); drops orphaned
  // slots when a fresh Generate produces a shorter script.
  useEffect(() => {
    if (!result) return
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
          next[key] = matchesHistory ? existing : createDefaultCardState(v, scene.scriptLine)
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
  //
  // It runs again whenever the connection comes back, because that is the
  // other way a paid-for clip goes missing: kie renders it, the download dies
  // with the Wi-Fi, and the entry sits on a Failed tile. Entries that already
  // errored are walked too (they keep their taskId), and `claimTask` stops an
  // extra pass from double-polling anything a live promise still owns.
  const reconnectTick = useReconnectTick()
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
  }, [reconnectTick])

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
          {/* One breathe for the whole block — see `.skeleton-group` in
              index.css. Eighteen individually-shimmering skeletons is eighteen
              composited layers inside rounded clips; the bar above already says
              the work is running. */}
          <div className="skeleton-group flex flex-col gap-8">
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
  // Cards holding a still — what the Animate action works on, and the reason
  // its button only appears once there's something to animate.
  const animatableKeys = allKeys.filter(hasImage)

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
        meta: vids.length > 1 ? `Take ${vi + 1} of ${vids.length}` : undefined,
        preselected: vi === cover,
        badge: vi === cover ? 'Cover' : undefined,
        aspectRatio: v.aspectRatio,
      }))
    }),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The strip is a STATIC row above the scroll port, not a `sticky` child
          inside it (August 2026). It was sticky and glass, and it visibly came
          loose from the top edge on the way back up a long storyboard: a
          backdrop-filter element re-samples its backdrop on the main thread
          while the scroller itself is scrolled by the compositor, so the bar
          lagged its own container by a frame or two and then snapped back.
          Outside the scroller it cannot lag by construction — it is a sibling
          of the scrolling box, exactly like the panel header above it, and
          nothing about a scroll moves it. It never scrolled away anyway (it was
          pinned at `top-0` from the first pixel), so the only thing given up is
          cards passing under it blurred. `relative z-20` so a card's own
          positioned hover chrome can't paint over it.

          It draws NO fill of its own, and that is the answer that keeps coming
          back. It wore the app's own glass for a day in September 2026 (a faint
          `bg-ink/[0.04]` wash under `.glass-fill .glass-fill-soft`, plus a
          blur) and Massimo reverted it on sight: with nothing scrolling
          underneath, the wash had nothing to sit over and simply lifted a 57px
          band a shade off the panel it belongs to, which reads as a seam rather
          than as glass. Same finding as the header's opaque fill in August —
          the band here is the hairline, not a surface. */}
      {/* ONE line, at EVERY width: what the storyboard IS on the left, what you
          can do to it on the right (August 2026, Massimo's call).

          That was the old shape and it used to break — the buttons are
          `shrink-0` (a batch pill you can't read is a batch you won't press), so
          the meta took every squeeze, and past its own min-content the count and
          the style pill PAINTED OVER the first button; reported at 900px, where
          the port is ~590px against 592px of pills. It was answered first by
          wrapping (a strip two rows tall on some windows and one on others) and
          then by moving the meta out of the bar entirely, down into the
          storyboard. What makes it work now is that NOTHING on the line shrinks
          and the line itself scrolls: every pill is `shrink-0`, the meta
          included, so the collision it kept losing simply can't be expressed.

          `w-max min-w-full` is the whole trick. When the content fits, the row
          is exactly the port, so the `flex-1` spacer opens up and pushes the
          buttons to the right edge; when it doesn't, the row is exactly its
          content, the spacer collapses to nothing, and the meta and buttons sit
          shoulder to shoulder in one swipeable line that starts at the scene
          count. `-mx-5 px-5` so it scrolls edge to edge while its first and last
          pills still sit on the panel's own inset. */}
      {/* `h-[57px]`, the app-wide panel-header height, NOT vertical padding
          around the pills: the History rail's own band next door is 57px, so
          `py-3.5` made this strip 61px and the two hairlines missed each other
          by 4px across the seam (Massimo's report, September 2026). A stated
          height is also what keeps them level if a pill on either side ever
          changes size. The scroll port under it takes `flex-1 min-w-0` rather
          than a width — see the note below, which the flex parent doesn't
          change: with both margins negative the row still resolves to exactly
          the strip's padding box. */}
      <div className="relative z-20 flex h-[57px] shrink-0 items-center border-b border-ink/5 px-5">
        {/* NOT `w-full` alongside `-mx-5`: `width: 100%` resolves against the
            strip's CONTENT box, so the port came out 40px narrower than the
            strip and the negative margin then spent all of it on the left —
            the row started at the panel's inset and ended 40px shy of it. With
            the width left `auto` the block fills its container and the two
            negative margins widen it by exactly the padding they cancel, so the
            port spans the strip and `px-5` puts both ends back on the panel's
            own inset. Invisible while the row was centred (it just shifted the
            centre 20px left); it shows the moment anything is right-aligned. */}
        <div className="-mx-5 min-w-0 flex-1 overflow-x-auto scrollbar-hide px-5">
        <div className="flex w-max min-w-full flex-nowrap items-center gap-2 whitespace-nowrap">
          {/* The look every clip in this storyboard renders in — the one piece
              of meta left on the line. It is CUT TO THE BATCH PILLS' OWN SIZE
              (same padding, same 11px, same 3.5 glyph), because a smaller chip
              at the head of a row of buttons reads as a fragment of one rather
              than as the thing the row is about. The scene count stood beside
              it and came out (August 2026, Massimo's call): the storyboard it
              counts is directly underneath, numbered.

              `shrink-0` like everything else on the line, with the NAME capped
              instead — a custom style can be titled anything, and an uncapped
              one would push the batch buttons off the end of a bar that fits. */}
          <button
            type="button"
            onClick={onChangeStyle}
            title="Change the visual style every clip renders in"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-broll-500/25 bg-broll-500/10 px-3.5 py-1.5 text-[12px] font-semibold tracking-tight text-broll-300 transition-colors hover:border-broll-500/45 hover:bg-broll-500/[0.18]"
          >
            <Palette className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span className="max-w-[180px] truncate">{result.styleBrief ? (result.styleName?.trim() || 'Custom style') : getContinuousStyle(result.styleId ?? 'ugc').label}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" strokeWidth={2.5} />
          </button>
          {/* Holds the two ends apart while there is room, and disappears the
              moment there isn't — `flex-1` contributes nothing to `w-max`. */}
          <span className="flex-1" aria-hidden />
          {/* ONE "Generate all", opening the three passes as a menu (August
              2026, Massimo's call). They were three pills side by side —
              images, the animate pass, videos — tinted as one family in three
              depths so the row read as a sequence getting more expensive. What
              that cost is the whole bar: three long labels are ~450px, which is
              most of the panel at every width the right pane actually gets, and
              it is why the labels had to shorten below `lg` and why the row had
              to scroll on a phone at all. The passes are also mutually
              exclusive in practice — you run one, wait for it, then run the
              next — so they are a choice, not four things to reach for.

              The menu is the same anchored popover the constraint chips use, so
              it escapes the strip's own clip and can't be cut off by the scroll
              port it sits in. */}
          <button
            ref={generateAllRef}
            type="button"
            onClick={() => setGenerateAllOpen((v) => !v)}
            title="Run a generation pass across every scene"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-broll-500/50 bg-broll-500/[0.24] px-3.5 py-1.5 text-[11px] font-medium text-broll-200 transition-colors hover:border-broll-500/65 hover:bg-broll-500/[0.32]"
          >
            <Sparkle className="h-3.5 w-3.5" />
            <span>Generate All</span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 opacity-70 transition-transform duration-200 ${generateAllOpen ? 'rotate-180' : ''}`}
              strokeWidth={2.5}
            />
          </button>
          <AnchoredPopover
            anchorRef={generateAllRef}
            open={generateAllOpen}
            onClose={() => setGenerateAllOpen(false)}
            width={214}
            estimatedHeight={animatableKeys.length > 0 ? 122 : 86}
            className="overflow-hidden rounded-2xl border border-ink/10 bg-surface-2 p-1 shadow-xl"
          >
            {/* In the order the work happens: stills, then the animate pass
                over whatever has one, then clips from the prompts. */}
            <button
              type="button"
              onClick={() => {
                setGenerateAllOpen(false)
                requestBatch(allKeys, 'All scenes', true)
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-medium text-ink-200 transition-colors hover:bg-ink/[0.06] hover:text-ink-100"
            >
              <Images className="h-3.5 w-3.5 shrink-0 text-broll-300" />
              Generate All Images
            </button>
            {/* Only once there's a still to animate — nothing should render
                from a prompt the member hasn't seen a frame of. */}
            {animatableKeys.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setGenerateAllOpen(false)
                  requestVideoBatch(allKeys, 'All stills', true, true)
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-medium text-ink-200 transition-colors hover:bg-ink/[0.06] hover:text-ink-100"
              >
                <Clapperboard className="h-3.5 w-3.5 shrink-0 text-broll-300" />
                Animate All Stills
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setGenerateAllOpen(false)
                requestVideoBatch(allKeys, 'All scenes', true)
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-medium text-ink-200 transition-colors hover:bg-ink/[0.06] hover:text-ink-100"
            >
              <VideoIcon className="h-3.5 w-3.5 shrink-0 text-broll-300" />
              Generate All Videos
            </button>
          </AnchoredPopover>
          {/* Download clips stays its own pill and stays neutral: it's the
              export, not a generate pass, and it spends nothing. */}
          {allClipEntries.length > 0 && (
            <button
              type="button"
              onClick={() => setDownloadOpen(true)}
              title="Pick which clips to download as a zip"
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100"
            >
              <Download className="h-3.5 w-3.5" />
              {/* One label at every width now. It carried a short `lg:hidden`
                  twin back when four long pills shared this line and overflowed
                  worst just above the phone breakpoint; with the three generate
                  passes behind one menu, the bar is a style pill and two
                  buttons and the full label fits. */}
              <span>Download Clips</span>
              {/* The count is a PILL, not `(8)` in the label (September 2026,
                  Massimo's call). Parenthesised it read as part of the button's
                  name and the one number on the row that changes was the least
                  visible thing on it; as its own chip it is a count beside a
                  verb, the way every other tally in the app is written. Same
                  `rounded-full` as the button around it — `tabular-nums` so the
                  pill holds its width as clips land rather than twitching the
                  row's right edge on every completion. */}
              <span className="rounded-full bg-ink/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-ink-200">
                {allClipEntries.length}
              </span>
            </button>
          )}
        </div>
        </div>
      </div>
      {/* The scroll port. `pt-5` replaces the strip's old `mb-5` — the gap
          between the bar and the first scene now belongs to the scrolling
          content, which is where it was already being drawn. */}
      <div className="flex-1 overflow-y-auto px-5 pb-4 pt-5">
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
            onEditSceneLine={onEditSceneLine}
            characterRef={characterRef}
            productRef={productRef}
            productPhotos={productPhotos}
            onChangeStyle={onChangeStyle}
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
      </div>

      {batchConfirm && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
          {...batchBackdrop}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-ink/10 bg-ink-950/95 p-5 shadow-2xl"
          >
            {/* Same shape as the video dialog below — the two open from
                buttons sitting side by side and must read as a pair. */}
            <h3 className="text-sm font-medium text-ink-100">
              {batchTargets.length === 0 ? 'Nothing to generate' : 'Generate images'}
            </h3>
            <p className="mt-1 text-xs text-ink-500">
              {[batchConfirm.scope, batchColumn !== 'all' ? `Option ${batchColumn + 1}` : null]
                .filter(Boolean).join(' · ')}
            </p>

            <ColumnChips
              columns={batchColumns}
              value={batchColumn}
              onChange={setBatchColumn}
              isDone={(col) =>
                !!batchConfirm.keys.some((k) => columnOf(k) === col && promptReady(k)) &&
                batchConfirm.keys.every((k) => columnOf(k) !== col || !promptReady(k) || hasImage(k))
              }
            />

            {batchDone.length > 0 && (
              <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={includeExisting}
                  onChange={(e) => setIncludeExisting(e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 accent-broll-500"
                />
                <span className="text-xs text-ink-300">
                  Also regenerate the {batchDone.length} card
                  {batchDone.length === 1 ? '' : 's'} that already {batchDone.length === 1 ? 'has' : 'have'} an image
                </span>
              </label>
            )}

            {/* Run settings — model is the shared B-Roll image model; resolution
                and aspect apply to every card in this batch. */}
            <div className="mt-4 flex flex-col gap-2.5">
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

            {balance !== null && batchOverBudget && (
              <p className="mt-3 text-[11px] text-red-400 light:text-red-600">
                Not enough credits. Your balance is {balance.toLocaleString()}.
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
                className="flex items-center gap-2 rounded-full border border-white/15 bg-broll-500 py-1.5 pl-4 pr-2 text-[12px] font-medium text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-broll-500"
              >
                <Images className="h-3.5 w-3.5" />
                {batchTargets.length === 0
                  ? 'Generate'
                  : `Generate ${batchTargets.length} image${batchTargets.length === 1 ? '' : 's'}`}
                <span className="flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[11px] tabular-nums">
                  <Coins className="h-3 w-3" strokeWidth={2} />
                  {/* An empty run costs nothing — formatCredits(0) would read
                      "< 1 credit", which looks like a real charge. */}
                  {batchTargets.length === 0 ? '—' : formatCredits(batchTotalCredits) ?? '—'}
                </span>
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
          {...videoBackdrop}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-ink/10 bg-ink-950/95 p-5 shadow-2xl"
          >
            {/* One title, one line of context. The count and the price live on
                the Generate button — everything else this dialog used to
                explain (parallel rendering, refresh-safety, why some cards are
                skipped) is either obvious from the storyboard behind it or
                already said by the controls below. */}
            <h3 className="text-sm font-medium text-ink-100">
              {videoTargets.length === 0
                ? (videoConfirm.stillsOnly ? 'Nothing to animate' : 'Nothing to generate')
                : (videoConfirm.stillsOnly ? 'Animate stills' : 'Generate videos')}
            </h3>
            <p className="mt-1 text-xs text-ink-500">
              {[
                videoConfirm.scope,
                videoColumn !== 'all' ? `Option ${videoColumn + 1}` : null,
                videoSourceNote,
              ].filter(Boolean).join(' · ')}
            </p>

            <ColumnChips
              columns={videoColumns}
              value={videoColumn}
              onChange={setVideoColumn}
              isDone={(col) =>
                !!videoConfirm.keys.some((k) => columnOf(k) === col && videoEligible(k)) &&
                videoConfirm.keys.every((k) => columnOf(k) !== col || !videoEligible(k) || hasVideo(k))
              }
            />

            {videoDone.length > 0 && (
              <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={includeExistingVideos}
                  onChange={(e) => setIncludeExistingVideos(e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 accent-broll-500"
                />
                <span className="text-xs text-ink-300">
                  Also regenerate the {videoDone.length} card
                  {videoDone.length === 1 ? '' : 's'} that already {videoDone.length === 1 ? 'has' : 'have'} a clip
                </span>
              </label>
            )}

            {/* Run settings — the shared B-Roll video model (same setting the
                card modal's picker writes), plus one resolution and one clip
                length for every video in the batch. */}
            <div className="mt-4 flex flex-col gap-2.5">
              <ModelPicker
                appId="broll-studio"
                task="video"
                costParams={{ durationSeconds: representativeSeconds, resolution: effectiveVideoRes }}
                requireAnyModes={videoAnimateCount > 0 ? STILL_CAPABLE_MODES : undefined}
                requireModeNote="Greyed-out models can't animate a still. They take neither a start frame nor reference images."
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
                  {/* Clip length. On a Dialogue Clips storyboard it defaults to
                      Auto — one length per spoken line rather than one length
                      for the whole run — and the trigger reads back the run's
                      real spread ("Auto · 5–10s"), since every one of those
                      seconds is billed on the button below. A silent b-roll run
                      has no words to fit, so it's the plain ladder pinned for
                      the run, as it was before Auto existed. */}
                  {batchVideoDurationOptions.length > 0 && (
                    <ConstraintChip
                      grow
                      openDirection="up"
                      options={[
                        ...(runHasSpokenCard ? [AUTO_DURATION] : []),
                        ...batchVideoDurationOptions.map(String),
                      ]}
                      value={pinnedVideoDuration ? String(pinnedVideoDuration) : AUTO_DURATION}
                      onChange={(v) => setBatchVideoDuration(v === AUTO_DURATION ? undefined : Number(v))}
                      render={(v) => (
                        <span>{v === AUTO_DURATION ? autoDurationLabel : `${v}s`}</span>
                      )}
                      renderOption={(v) => (
                        v === AUTO_DURATION ? (
                          <span className="flex w-full items-center justify-between gap-6">
                            <span>Auto</span>
                            <span className="text-ink-500">fits each line</span>
                          </span>
                        ) : (
                          <span>{v}s</span>
                        )
                      )}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Balance only when it's in the way — the price itself rides on
                the button. */}
            {balance !== null && videoOverBudget && (
              <p className="mt-3 text-[11px] text-red-400 light:text-red-600">
                Not enough credits. Your balance is {balance.toLocaleString()}.
              </p>
            )}
            {videoModelCantAnimate && (
              <p className="mt-1.5 text-[11px] text-red-300 light:text-red-700">
                {getModel(batchVideoModelId ?? '')?.displayName ?? 'This model'} can&rsquo;t animate a still. Every card with an image would fail. Pick a model that takes a start frame or reference images.
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
                className="flex items-center gap-2 rounded-full border border-white/15 bg-broll-500 py-1.5 pl-4 pr-2 text-[12px] font-medium text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-broll-500"
              >
                {videoConfirm.stillsOnly
                  ? <Clapperboard className="h-3.5 w-3.5" />
                  : <VideoIcon className="h-3.5 w-3.5" />}
                {videoTargets.length === 0
                  ? (videoConfirm.stillsOnly ? 'Animate' : 'Generate')
                  : videoConfirm.stillsOnly
                    ? `Animate ${videoTargets.length} still${videoTargets.length === 1 ? '' : 's'}`
                    : `Generate ${videoTargets.length} video${videoTargets.length === 1 ? '' : 's'}`}
                {/* The price sits on the button that spends it. */}
                <span className="flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[11px] tabular-nums">
                  <Coins className="h-3 w-3" strokeWidth={2} />
                  {videoTargets.length === 0 ? '—' : formatCredits(videoBatchCredits) ?? '—'}
                </span>
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
          subtitle="Every card&rsquo;s cover clip is picked. Tick the extra takes you also want."
          onClose={() => setDownloadOpen(false)}
        />
      )}
    </div>
  )
}

// The option-column picker inside both batch dialogs. Renders nothing for a
// single-scene batch (one card per column — the choice would be meaningless).
function ColumnChips({
  columns,
  value,
  onChange,
  isDone,
}: {
  columns: number[]
  value: BatchColumn
  onChange: (value: BatchColumn) => void
  // Column has nothing left to generate — ticked, so a member walking the
  // columns can see how far they've got.
  isDone: (col: number) => boolean
}) {
  if (columns.length < 2) return null
  const chip = (active: boolean) =>
    `flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
      active
        ? 'border-broll-400/40 bg-broll-500/15 text-broll-200'
        : 'border-ink/10 bg-ink/[0.03] text-ink-400 hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-200'
    }`
  return (
    <div className="mt-3">
      {/* No eyebrow and no hint paragraph: the chips say "Option 1 / All
          options" in full, and a dialog that has to teach on every open is a
          dialog nobody reads. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {columns.map((col) => (
          <button key={col} type="button" onClick={() => onChange(col)} className={chip(value === col)}>
            {isDone(col) && <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} />}
            Option {col + 1}
          </button>
        ))}
        <button type="button" onClick={() => onChange('all')} className={chip(value === 'all')}>
          All options
        </button>
      </div>
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
      productPhotos={productPhotos}
      onChangeStyle={onChangeStyle}
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

// Retype a scene's spoken line. Same shape as Continuous' SceneEditModal, with
// none of its structural operations: a per-line storyboard's scenes come from
// the LLM's own segmentation of the script, so there's nothing to split or
// merge here — just the words.
//
// Saving is instant and free. A dialogue prompt embeds the line verbatim in
// quotes, so the new words are swapped into every prompt of the scene without
// an LLM call; the room, the gesture and the light stay exactly as written.
function SceneLineEditModal({
  sceneNumber,
  scriptLine,
  speaks,
  onSave,
  onClose,
}: {
  sceneNumber: number
  scriptLine: string
  // Whether this scene's cards actually say the line. Only changes the copy —
  // in silent b-roll the line is the voiceover laid over the footage, so
  // editing it changes what the shots are meant to illustrate, not their words.
  speaks: boolean
  onSave: (line: string) => void
  onClose: () => void
}) {
  const [line, setLine] = useState(scriptLine)
  useCloseOnEscape(true, onClose)
  useCloseOnAppSwitch(true, onClose)
  // Selecting the line and releasing the mouse over the backdrop fires a click
  // on the common ancestor — a bare onClick={onClose} would throw the edit away.
  const backdrop = useBackdropClose(onClose)

  const trimmed = line.trim()
  const dirty = trimmed !== scriptLine.trim()

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm" {...backdrop}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-ink/10 bg-ink-950/95 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-ink-100">Line {sceneNumber}</h3>
            <p className="mt-1 text-xs text-ink-500">
              {speaks
                ? 'What the character says in this scene.'
                : 'The voiceover heard over this scene, and what its shots have to show.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          value={line}
          onChange={(e) => setLine(e.target.value)}
          rows={3}
          autoFocus
          className="mt-4 w-full resize-none rounded-2xl border border-ink/10 bg-ink/[0.03] px-3.5 py-3 text-sm leading-relaxed text-ink-100 placeholder:text-ink-600 focus:border-ink/20 focus:outline-none"
          placeholder={speaks ? 'What the character says here' : 'What the voiceover says over this scene'}
        />

        {/* No explainer under the box. It ran to three lines to say that saving
            is free, instant and doesn't touch the shots — which is what saving
            a line has always done, and reading it every time you fix a typo is
            the clutter, not the reassurance. */}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-ink/10 bg-ink/[0.03] px-4 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!dirty || !trimmed}
            onClick={() => { onSave(trimmed); onClose() }}
            className="rounded-full bg-broll-500 px-4 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save line
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function SceneSection({
  scene,
  cardStates,
  onUpdateCardState,
  onUpdateCardStateFn,
  onAddVariation,
  onDeleteVariation,
  onEditSceneLine,
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
  onEditSceneLine?: (sceneNumber: number, line: string) => void
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
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
  const [lineEditorOpen, setLineEditorOpen] = useState(false)
  return (
    // `content-visibility: auto` brings paint containment, which clips the
    // cards' soft drop shadow at this box's edges. The `-m-4 p-4` bleed gives
    // the shadow 16px of room inside the contained box; the negative margin
    // cancels against the parent's flex `gap-10`, so layout is unchanged.
    <div className="-m-4 p-4" style={{ contentVisibility: 'auto', containIntrinsicSize: '700px' }}>
      {/* Scene header — the take number, the line, then the two per-scene batch
          buttons, CENTRED and stacked at EVERY width (August 2026, Massimo's
          call: match how it looks on a phone). It used to be a masthead on a
          desktop — number, hairline rule, the line running away to the right,
          the buttons parked on the far edge — a shape a phone had already given
          up, because ~330px of shrink-0 buttons left the line a column two
          characters wide. Centred, one header serves both, and it stacks under
          the storyboard's own centred batch strip instead of reading as a
          second bar aligned a different way. The rule went with the split (it
          divided a row that no longer exists) and so did the `LINE N` chip: it
          printed the scene's number two inches under the 48px numeral that is
          the header's own first line. The spoken-duration chip was removed
          earlier — its estimate was unreliable. */}
      <div className="mb-5 flex flex-col items-center gap-3">
        {/* `w-full`, not a shrink-to-fit column. Under `items-center` alone this
            block sized itself to fit-content and landed at ~470px inside an
            845px panel — with a `w-full` chain under it the percentage can't
            resolve until the parent has a width, and the parent was waiting on
            the content — so the line wrapped onto a second row with 180px of
            empty panel either side of it. Full width, `text-center` inside, and
            it wraps only when the words genuinely run out of room. */}
        <div className="flex w-full min-w-0 flex-col items-center gap-1">
          <span
            className="text-5xl font-normal italic tabular-nums text-ink-700"
            style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
          >
            {String(scene.number).padStart(2, '0')}
          </span>
          {/* No reading-measure cap. A `max-w-2xl` was tried and came straight
              off: the panel is ~1000px wide and the line is the one thing here
              worth reading, so capping it wrapped a quote onto a second line
              with one word alone on it while 300px sat empty either side. It
              takes the width it has and wraps only when it genuinely runs out. */}
          <div className="flex w-full min-w-0 flex-col items-center gap-1.5">
            {/* The line itself, and the place you retype it. Clicking it opens
                the editor; saving swaps the quoted words in this scene's
                prompts, so a dialogue card says the new sentence without a
                regeneration. Read-only when the host doesn't hand us a handler. */}
            {onEditSceneLine ? (
              <button
                type="button"
                onClick={() => setLineEditorOpen(true)}
                title="Edit this line"
                className="group/line -mx-1.5 flex w-full items-start justify-center gap-2 rounded-lg px-1.5 py-0.5 text-center transition-colors hover:bg-ink/[0.04]"
              >
                <p
                  className="text-center text-lg font-normal not-italic leading-relaxed text-ink-400 transition-colors group-hover/line:text-ink-200"
                  style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
                >
                  &ldquo;{scene.scriptLine}&rdquo;
                </p>
                <Pencil className="mt-2 h-3 w-3 shrink-0 text-ink-600 opacity-0 transition-opacity group-hover/line:opacity-100" strokeWidth={2} />
              </button>
            ) : (
              <p
                className="text-center text-lg font-normal not-italic leading-relaxed text-ink-400"
                style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
              >
                &ldquo;{scene.scriptLine}&rdquo;
              </p>
            )}
          </div>
        </div>
        {/* Per-scene batches — one row's worth of images or clips, so a member
            can work scene by scene instead of committing the whole storyboard's
            credits in one press. */}
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onGenerateScene}
            title="Generate images for every variation in this scene"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100"
          >
            <Images className="h-3.5 w-3.5" />
            Generate Images
          </button>
          <button
            type="button"
            onClick={onGenerateSceneVideos}
            title="Generate a clip for every variation in this scene"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5 text-[11px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink-100"
          >
            <VideoIcon className="h-3.5 w-3.5" />
            Generate Videos
          </button>
        </div>
      </div>

      {/* The scene's variations plus the Add-option card across one row at xl —
          the Add card is just another cell in the grid. Both deliveries are three
          variations (a four-column row); a scene that carries four — an added
          option, or a session generated back when Dialogue Clips emitted a fourth
          card — runs five wide rather than wrapping the Add card onto a line of
          its own. */}
      <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${scene.variations.length >= 4 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}>
        {scene.variations.map((variation, i) => {
          const key = `${scene.number}-${i}`
          const state = cardStates[key] ?? createDefaultCardState(variation, scene.scriptLine)
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
              productPhotos={productPhotos}
              onChangeStyle={onChangeStyle}
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

      {lineEditorOpen && onEditSceneLine && (
        <SceneLineEditModal
          sceneNumber={scene.number}
          scriptLine={scene.scriptLine}
          speaks={scene.variations.some((v) => v.tag === 'DIALOGUE')}
          onSave={(line) => onEditSceneLine(scene.number, line)}
          onClose={() => setLineEditorOpen(false)}
        />
      )}
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
