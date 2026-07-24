import { useEffect, useRef, useCallback, useState } from 'react'
import { Dna } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useReportActivity } from '../../stores/activityStore'
import { useBankStore } from '../../stores/bankStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { CharacterProfile, InFlightCharacterGen, LaunchGenOptions, TabId } from './types'
import { createEmptyProfile, flattenDna, PHOTOREALISM_STYLE } from './types'
import type { AspectRatio, ImageResolution } from '../../utils/models'
import { getDefaultModel, clampImageResolution } from '../../utils/models'
import ControlsPanel from './components/ControlsPanel'
import GalleryPanel from './components/GalleryPanel'
import { startCharacterTask, startCharacterEditTask, finishCharacterTask, type GenerationKind } from './services/generateCharacter'
import { humanizeError } from '../../utils/friendlyError'
import { analyzeImage } from './services/analyzeImage'
import { usePersistedState, useProjectScopedKey } from '../../hooks/usePersistedState'

// In-flight character generations older than 30 min are evicted on resume —
// matches the cap used by Playground so the user's mental model is uniform.
const INFLIGHT_TTL_MS = 30 * 60 * 1000

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 10 * 1024 * 1024

export default function CharacterStudio() {
  const baseKey = useProjectScopedKey('character-studio')
  const [profile, setProfile] = usePersistedState<CharacterProfile>(`${baseKey}:profile`, createEmptyProfile())
  const [activeTab, setActiveTab] = usePersistedState<TabId>(`${baseKey}:tab`, 'physical')
  // Characters open at 2K by default — portraits hold up better reused as
  // references. The user can drop to 1K or bump to 4K from the resolution
  // toggle. Key bumped to :v2 so the new default lands over a stored 1K.
  const [resolution, setResolution] = usePersistedState<ImageResolution>(`${baseKey}:resolution:v2`, '2K')
  // Portrait vs character-sheet output. Flipping either way resets resolution
  // to the 2K sweet spot (1K is too soft for reuse as a reference, 4K burns
  // credits for detail that rarely pays off) — the user can still bump a
  // specific gen afterwards. Persisted so a refresh mid-session keeps the mode.
  const [sheetMode, setSheetMode] = usePersistedState<boolean>(`${baseKey}:sheet-mode`, false)
  // Sheet orientation — kept separate from the portrait aspect so flipping
  // modes preserves each. Defaults to the horizontal turnaround layout.
  const [sheetAspect, setSheetAspect] = usePersistedState<string>(`${baseKey}:sheet-aspect`, '16:9')

  // The image model actually used for portraits/sheets (persisted picker
  // selection, else the app default). Subscribed reactively so a model swap
  // re-clamps the resolution below.
  const persistedImageModel = useSettingsStore((s) => s.getAppModel('character-studio:image:text-to-image'))
  const selectedImageModelId = persistedImageModel
    ?? getDefaultModel('character-studio', 'image', 'text-to-image')?.id
    ?? 'unknown'

  // Keep resolution inside the selected model's supported tiers. Without this,
  // switching to a 1K/2K-only model (Seedream) while 4K is set would leave a
  // stale 4K that the resolution toggle can't display and that silently
  // downgrades to basic quality at request time.
  useEffect(() => {
    setResolution((r) => clampImageResolution(selectedImageModelId, r))
  }, [selectedImageModelId, setResolution])

  const handleSheetModeChange = (on: boolean) => {
    if (on === sheetMode) return
    // Both directions land on 2K (clamped down when the model tops out lower);
    // any 4K choice is a deliberate per-mode override, not carried across.
    setResolution(clampImageResolution(selectedImageModelId, '2K'))
    if (on) setSheetAspect('16:9')
    setSheetMode(on)
  }
  const [extractedThumb, setExtractedThumb] = usePersistedState<string | null>(`${baseKey}:thumb`, null)

  // Parallel generations: persisted to localStorage so a mid-flight refresh
  // resumes polling via finishCharacterTask. Stale entries (>30 min, e.g. a
  // tab left overnight) are evicted on resume so the gallery doesn't stay
  // stuck on a phantom spinner.
  const [inFlight, setInFlight] = usePersistedState<InFlightCharacterGen[]>(`${baseKey}:in-flight`, [])
  const [error, setError] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)

  // Pulse the dock dot while portraits/sheets generate or DNA extraction runs.
  useReportActivity('character-studio', inFlight.length > 0 || isExtracting)
  const [overlayActive, setOverlayActive] = useState(false)

  // Abort controllers keyed by gen id so per-tile Cancel can target one job.
  const abortersRef = useRef<Map<string, AbortController>>(new Map())
  const dragDepthRef = useRef(0)

  const interAppPayload = useAppStore((s) => s.interAppPayload)
  const consumePayload = useAppStore((s) => s.consumePayload)
  const activeApp = useAppStore((s) => s.activeApp)

  const addCharacterHistory = useBankStore((s) => s.addCharacterHistory)

  // Consume inter-app payload (kept for cross-app handoffs into the form)
  useEffect(() => {
    if (activeApp !== 'character-studio') return
    if (!interAppPayload || interAppPayload.targetApp !== 'character-studio') return

    const { targetField, data } = interAppPayload

    if (targetField === 'profile' && typeof data === 'object' && data !== null) {
      const incoming = data as Record<string, string>
      const newProfile = createEmptyProfile()
      for (const [key, value] of Object.entries(incoming)) {
        if (key === 'cameraDevice') continue
        if (key in newProfile && typeof value === 'string') {
          newProfile[key] = value
        }
      }
      newProfile.cameraDevice = PHOTOREALISM_STYLE
      setProfile(newProfile)
    }

    consumePayload()
  }, [interAppPayload, activeApp, consumePayload])

  const handlePhotoDrop = useCallback(async (file: File) => {
    setExtractError(null)
    setIsExtracting(true)

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setExtractedThumb(reader.result)
    }
    reader.readAsDataURL(file)

    try {
      const dna = await analyzeImage(file)
      const flat = flattenDna(dna)
      const newProfile = createEmptyProfile()
      for (const [key, value] of Object.entries(flat)) {
        if (key === 'cameraDevice') continue
        if (key in newProfile && typeof value === 'string') {
          newProfile[key] = value
        }
      }
      newProfile.cameraDevice = PHOTOREALISM_STYLE
      setProfile(newProfile)
    } catch (err) {
      setExtractError(humanizeError(err, 'Failed to extract DNA from image.'))
      setExtractedThumb(null)
    } finally {
      setIsExtracting(false)
    }
  }, [])

  // Clear just the source-image thumbnail so the user can drop another image.
  // Deliberately does NOT wipe the form — that's the "New" button's job.
  const handleResetExtract = useCallback(() => {
    setExtractedThumb(null)
    setExtractError(null)
  }, [])

  // "New": reset the form to empty AND drop the extracted reference photo +
  // any errors, so the controls are a true blank slate. The gallery stays —
  // generated influencers live in the characterHistory bank, untouched.
  const handleClear = useCallback(() => {
    setProfile(createEmptyProfile())
    setExtractedThumb(null)
    setExtractError(null)
    setError(null)
  }, [setProfile, setExtractedThumb])

  // Full-area drag overlay handlers
  const handleDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    dragDepthRef.current += 1
    setOverlayActive(true)
  }
  const handleDragLeave = () => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setOverlayActive(false)
  }
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }
  const handleOverlayDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current = 0
    setOverlayActive(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setExtractError('Unsupported format. Use JPG, PNG, or WebP.')
      return
    }
    if (file.size > MAX_SIZE) {
      setExtractError('File too large. Maximum size is 10 MB.')
      return
    }
    handlePhotoDrop(file)
  }

  // Finish an already-started task (poll → save asset → write history → drop
  // the in-flight entry). Shared by handleGenerate (foreground) and the
  // mount-time resume effect (background).
  const finishGen = useCallback(async (gen: InFlightCharacterGen, controller: AbortController) => {
    if (!gen.taskId) return
    try {
      const assetId = await finishCharacterTask(gen.taskId, gen.modelId, controller.signal)
      addCharacterHistory({
        id: crypto.randomUUID(),
        imageRef: assetId,
        profile: (gen.profile as CharacterProfile | undefined) ?? createEmptyProfile(),
        modelId: gen.modelId,
        aspectRatio: gen.aspectRatio,
        resolution: gen.resolution,
        kind: gen.kind ?? 'portrait',
        // Derived gens (edit modal) rejoin their source's lineage strip.
        lineageId: gen.lineageId,
        createdAt: Date.now(),
      })
      // A lineage'd portrait can only have come from the modal's Edit tab —
      // the form and "Make Sheet" never set one.
      const label = gen.kind === 'sheet'
        ? 'Character sheet generated'
        : gen.lineageId ? 'Edit generated' : 'Character generated'
      useAppStore.getState().addToast(label, 'success')
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = humanizeError(err, 'Image generation failed. Check your API key and try again.')
        setError(msg)
        useAppStore.getState().addToast(msg, 'error')
      }
    } finally {
      abortersRef.current.delete(gen.id)
      setInFlight((prev) => prev.filter((g) => g.id !== gen.id))
    }
  }, [addCharacterHistory, setInFlight])

  // Core launcher shared by the form's Generate button, the "Make Sheet from
  // portrait" gallery action, and the edit modal's Generate. Stamps an in-flight
  // tile, starts the task, persists the taskId, then polls to completion. The
  // model recorded is the one actually used — startCharacterTask swaps to an
  // image-to-image sibling when a reference portrait is supplied.
  //
  // Owning modal generations here (rather than inside the modal) is what makes
  // them survive a close + reopen: the tile and the poll live with the app, not
  // with the pop-up.
  const launchGen = useCallback(async (opts: LaunchGenOptions) => {
    const configuredModel = useSettingsStore.getState().getAppModel('character-studio:image:text-to-image')
      ?? getDefaultModel('character-studio', 'image', 'text-to-image')?.id
      ?? 'unknown'

    const id = crypto.randomUUID()
    const controller = new AbortController()
    abortersRef.current.set(id, controller)
    // Stamp an entry without taskId immediately so the in-flight tile renders
    // while createTask is on the wire. We fill in taskId as soon as it lands.
    const placeholder: InFlightCharacterGen = {
      id,
      modelId: configuredModel,
      aspectRatio: opts.aspect,
      startedAt: Date.now(),
      resolution: opts.resolution,
      kind: opts.kind,
      profile: opts.profile,
      lineageId: opts.lineageId,
    }
    setInFlight((prev) => [...prev, placeholder])
    setError(null)

    let started: { taskId: string; modelId: string }
    try {
      started = opts.edit
        ? await startCharacterEditTask({
            prompt: opts.edit.instruction,
            baseImageRef: opts.edit.baseImageRef,
            referenceRefs: opts.edit.referenceUrls,
            aspectRatio: opts.aspect as AspectRatio,
            resolution: opts.resolution,
            signal: controller.signal,
          })
        : await startCharacterTask(opts.profile, undefined, opts.resolution, controller.signal, opts.kind, opts.aspect, opts.referenceUrl)
    } catch (err) {
      abortersRef.current.delete(id)
      setInFlight((prev) => prev.filter((g) => g.id !== id))
      if (!controller.signal.aborted) {
        const msg = humanizeError(err, 'Image generation failed. Check your API key and try again.')
        setError(msg)
        useAppStore.getState().addToast(msg, 'error')
      }
      return
    }

    // Persist taskId (resume-safe) and the actual model used so the history row
    // and tile caption reflect any image-to-image swap.
    setInFlight((prev) => prev.map((g) => g.id === id ? { ...g, taskId: started.taskId, modelId: started.modelId } : g))
    await finishGen({ ...placeholder, taskId: started.taskId, modelId: started.modelId }, controller)
  }, [finishGen, setInFlight])

  const handleGenerate = () => {
    // Snapshot every input the gen depends on at click time — the user can
    // freely mutate the form while this job runs in parallel.
    const snapshotKind: GenerationKind = sheetMode ? 'sheet' : 'portrait'
    const snapshotAspect = sheetMode ? (sheetAspect.includes('9:16') ? '9:16' : '16:9') : (profile.aspectRatio || '9:16')
    void launchGen({ profile: { ...profile }, resolution, kind: snapshotKind, aspect: snapshotAspect })
  }

  const handleCancelGen = (id: string) => {
    const controller = abortersRef.current.get(id)
    controller?.abort()
    // Cancelling drops the entry even if the kie task itself can't be cancelled
    // server-side — the user has signalled they don't want this one.
    setInFlight((prev) => prev.filter((g) => g.id !== id))
    abortersRef.current.delete(id)
  }

  // Mount-time resume: walk the persisted in-flight list and either resume
  // polling (entries with a taskId) or evict stale / un-started entries. Runs
  // once on mount; new gens started this session are owned by handleGenerate.
  const didResumeRef = useRef(false)
  useEffect(() => {
    if (didResumeRef.current) return
    didResumeRef.current = true
    const now = Date.now()
    const toResume: InFlightCharacterGen[] = []
    const toEvict: string[] = []
    for (const gen of inFlight) {
      const stale = now - gen.startedAt > INFLIGHT_TTL_MS
      if (stale || !gen.taskId) {
        toEvict.push(gen.id)
      } else if (!abortersRef.current.has(gen.id)) {
        toResume.push(gen)
      }
    }
    if (toEvict.length > 0) {
      setInFlight((prev) => prev.filter((g) => !toEvict.includes(g.id)))
      useAppStore.getState().addToast(
        `${toEvict.length} stalled character gen${toEvict.length === 1 ? '' : 's'} cleared.`,
        'info',
      )
    }
    for (const gen of toResume) {
      const controller = new AbortController()
      abortersRef.current.set(gen.id, controller)
      void finishGen(gen, controller)
    }
    // We intentionally only resume on the first mount of this component.
    // Subsequent setInFlight calls re-render but must not re-trigger the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="relative flex flex-col pb-72 md:flex-row md:h-full md:pb-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleOverlayDrop}
    >
      {/* Controls panel — 50% on desktop */}
      <div className="flex w-full min-w-0 md:w-1/2 shrink-0 flex-col border-b md:border-b-0 md:border-r border-ink/5">
        <ControlsPanel
          profile={profile}
          onProfileChange={setProfile}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          isExtracting={isExtracting}
          extractError={extractError}
          extractedThumb={extractedThumb}
          onPhotoDrop={handlePhotoDrop}
          onResetExtract={handleResetExtract}
          onClear={handleClear}
          error={error}
          onGenerate={handleGenerate}
          canGenerate={Object.values(profile).some((v) => v.trim() !== '')}
          resolution={resolution}
          onResolutionChange={setResolution}
          sheetMode={sheetMode}
          onSheetModeChange={handleSheetModeChange}
          sheetAspect={sheetAspect}
          onSheetAspectChange={setSheetAspect}
          inFlightCount={inFlight.length}
        />
      </div>

      {/* Gallery panel — 50% on desktop */}
      <div className="flex min-w-0 w-full md:w-1/2 flex-col md:overflow-hidden">
        <GalleryPanel
          inFlight={inFlight}
          onCancelGen={handleCancelGen}
          onLaunchGen={(opts) => void launchGen(opts)}
        />
      </div>

      {/* Full-area drag overlay — mirrors the Products bank dropzone: a full-bleed
          dashed border with a light tint and a single centered pill, rather than
          a dimming backdrop behind a large card. */}
      {overlayActive && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-green-400/60 bg-green-500/10 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium text-green-200">
            <Dna className="h-4 w-4" />
            Drop to extract DNA
          </div>
        </div>
      )}
    </div>
  )
}
