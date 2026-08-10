import { useEffect, useRef, useCallback, useState } from 'react'
import { Dna, Images, SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useReportActivity } from '../../stores/activityStore'
import { useBankStore } from '../../stores/bankStore'
import { useSettingsStore } from '../../stores/settingsStore'
import type { CharacterProfile, CharacterRefItem, InFlightCharacterGen, LaunchGenOptions, TabId } from './types'
import { createEmptyProfile, profileFromFlat } from './types'
import type { AspectRatio, ImageResolution } from '../../utils/models'
import { getDefaultModel, clampImageResolution } from '../../utils/models'
import MobilePaneTabs, { paneClass } from '../../components/MobilePaneTabs'
import ControlsPanel from './components/ControlsPanel'
import GalleryPanel from './components/GalleryPanel'
import ReferenceLibrarySlideOver from './components/ReferenceLibrarySlideOver'
import { startCharacterTask, startCharacterEditTask, finishCharacterTask, type GenerationKind } from './services/generateCharacter'
import { humanizeError } from '../../utils/friendlyError'
import { useReferenceLibrary } from './useReferenceLibrary'
import { usePersistedState, useProjectScopedKey } from '../../hooks/usePersistedState'

// In-flight character generations older than 30 min are evicted on resume —
// matches the cap used by Playground so the user's mental model is uniform.
const INFLIGHT_TTL_MS = 30 * 60 * 1000

export default function CharacterStudio() {
  const baseKey = useProjectScopedKey('character-studio')
  const [profile, setProfile] = usePersistedState<CharacterProfile>(`${baseKey}:profile`, createEmptyProfile())
  const [activeTab, setActiveTab] = usePersistedState<TabId>(`${baseKey}:tab`, 'physical')
  // Characters open at 1K by default — cheap enough to iterate on freely, and
  // a portrait that earns its keep can be re-run at 2K/4K from the resolution
  // toggle. Key bumped to :v3 so the new default lands over a stored 2K.
  const [resolution, setResolution] = usePersistedState<ImageResolution>(`${baseKey}:resolution:v3`, '1K')
  // Portrait vs character-sheet output. Flipping the toggle changes WHAT gets
  // generated and nothing else — resolution and aspect are the user's picks and
  // carry across both modes untouched. (Both used to reset on every flip, which
  // silently undid a deliberate 4K or 9:16 choice.) Persisted so a refresh
  // mid-session keeps the mode.
  const [sheetMode, setSheetMode] = usePersistedState<boolean>(`${baseKey}:sheet-mode`, false)

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

  // A sheet needs a long axis — its panel grid can't lay out square — so a 1:1
  // pick renders the sheet vertically. The portrait aspect itself is left
  // alone; flipping back to Portrait still shows 1:1.
  const sheetAspect = (profile.aspectRatio ?? '').includes('16:9') ? '16:9' : '9:16'

  // Which analysed reference photo currently fills the form. The photo itself
  // lives in the reference library below — this is only the pointer, so the
  // autofill pill and the library agree on which row is in play.
  const [activeRefId, setActiveRefId] = usePersistedState<string | null>(`${baseKey}:activeRef`, null)
  const [libraryOpen, setLibraryOpen] = useState(false)

  // Parallel generations: persisted to localStorage so a mid-flight refresh
  // resumes polling via finishCharacterTask. Stale entries (>30 min, e.g. a
  // tab left overnight) are evicted on resume so the gallery doesn't stay
  // stuck on a phantom spinner.
  const [inFlight, setInFlight] = usePersistedState<InFlightCharacterGen[]>(`${baseKey}:in-flight`, [])
  const [error, setError] = useState<string | null>(null)
  // Phone-only: which of the two panes is on screen (ignored from md up).
  const [pane, setPane] = useState<'controls' | 'gallery'>('controls')

  // Fill the form from an analysed reference and mark it as the active one.
  const applyReference = useCallback((item: CharacterRefItem) => {
    if (!item.profile) return
    setProfile(item.profile)
    setActiveRefId(item.id)
  }, [setProfile, setActiveRefId])

  const library = useReferenceLibrary(baseKey, applyReference)
  // Pulled out because the hook returns a fresh object each render — the
  // callbacks below want the stable functions, not the wrapper.
  const { addFiles, clearError: clearLibraryError, remove: removeRef } = library
  const analyzingCount = library.analyzingIds.length
  const activeRef = library.items.find((it) => it.id === activeRefId) ?? null
  // While a batch runs the pill wears the first photo in it; otherwise it wears
  // whichever reference filled the form.
  const pillThumb = analyzingCount > 0
    ? (library.items.find((it) => library.analyzingIds.includes(it.id))?.thumb || null)
    : (activeRef?.thumb || null)

  // Pulse the dock dot while portraits/sheets generate or DNA extraction runs.
  useReportActivity('character-studio', inFlight.length > 0 || analyzingCount > 0)
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
      setProfile(profileFromFlat(data as Record<string, unknown>))
    }

    consumePayload()
  }, [interAppPayload, activeApp, consumePayload])

  // Detach the active reference so the pill goes back to its drop state.
  // Deliberately does NOT wipe the form (that's "New") and does NOT delete the
  // library row — the analysis stays reusable.
  const handleResetExtract = useCallback(() => {
    setActiveRefId(null)
    clearLibraryError()
  }, [setActiveRefId, clearLibraryError])

  // Removing a library row that's currently in play leaves the form alone but
  // drops the pill — the row it pointed at no longer exists.
  const handleRemoveRef = useCallback((id: string) => {
    removeRef(id)
    setActiveRefId((current) => (current === id ? null : current))
  }, [removeRef, setActiveRefId])

  // "New": reset the form to empty AND detach the reference photo + any errors,
  // so the controls are a true blank slate. The gallery stays — generated
  // influencers live in the characterHistory bank, untouched — and so does the
  // reference library, which is history, not input.
  const handleClear = useCallback(() => {
    setProfile(createEmptyProfile())
    setActiveRefId(null)
    clearLibraryError()
    setError(null)
  }, [setProfile, setActiveRefId, clearLibraryError])

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
  // Drops anywhere on the app go into the reference library, same as the pill —
  // several at once are analysed as a batch. Validation lives there.
  const handleOverlayDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current = 0
    setOverlayActive(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) addFiles(files)
  }

  // Finish an already-started task (poll → save asset → write history → drop
  // the in-flight entry). Shared by handleGenerate (foreground) and the
  // mount-time resume effect (background).
  const finishGen = useCallback(async (gen: InFlightCharacterGen, controller: AbortController) => {
    if (!gen.taskId) return
    try {
      const assetId = await finishCharacterTask(gen.taskId, gen.modelId, controller.signal)
      addCharacterHistory({
        // The row keeps the GENERATION's id rather than a fresh one, so anything
        // anchored to the in-flight tile — the editor opened by clicking it —
        // resolves to the finished row the moment it lands, with nothing to
        // re-target. Gen ids are already uuids, so this is as unique as before.
        id: gen.id,
        imageRef: assetId,
        profile: (gen.profile as CharacterProfile | undefined) ?? createEmptyProfile(),
        modelId: gen.modelId,
        aspectRatio: gen.aspectRatio,
        resolution: gen.resolution,
        kind: gen.kind ?? 'portrait',
        // Derived gens (edit modal) rejoin their source's lineage strip.
        lineageId: gen.lineageId,
        styleName: gen.styleName,
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
      styleName: opts.styleName,
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
        : await startCharacterTask(opts.profile, undefined, opts.resolution, controller.signal, opts.kind, opts.aspect, opts.referenceUrl, { direction: opts.direction, extraReferenceUrls: opts.extraReferenceUrls })
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
    // On a phone only one pane is on screen — follow the run to the gallery.
    setPane('gallery')
    const snapshotKind: GenerationKind = sheetMode ? 'sheet' : 'portrait'
    const snapshotAspect = sheetMode ? sheetAspect : (profile.aspectRatio || '9:16')
    void launchGen({ profile: { ...profile }, resolution, kind: snapshotKind, aspect: snapshotAspect })
  }

  // Both gallery callbacks are useCallback'd with stable deps, and the gallery
  // itself is memoized: it renders every character the member has ever made
  // (characterHistory is uncapped) beside a form of ~28 fields, so a fresh
  // callback identity meant one keystroke re-rendered the whole history.
  const handleCancelGen = useCallback((id: string) => {
    const controller = abortersRef.current.get(id)
    controller?.abort()
    // Cancelling drops the entry even if the kie task itself can't be cancelled
    // server-side — the user has signalled they don't want this one.
    setInFlight((prev) => prev.filter((g) => g.id !== id))
    abortersRef.current.delete(id)
  }, [setInFlight])

  const handleLaunchGen = useCallback((opts: LaunchGenOptions) => { void launchGen(opts) }, [launchGen])

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
      className="relative flex h-full flex-col md:flex-row"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleOverlayDrop}
    >
      <MobilePaneTabs
        options={[
          { value: 'controls', label: 'Controls', icon: SlidersHorizontal },
          { value: 'gallery', label: 'Gallery', icon: Images },
        ]}
        value={pane}
        onChange={setPane}
        accent="influencers"
      />

      {/* Controls panel — 50% on desktop */}
      <div className={paneClass(pane === 'controls', 'md:w-1/2 md:shrink-0 md:border-r md:border-ink/5')}>
        <ControlsPanel
          profile={profile}
          onProfileChange={setProfile}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          analyzingCount={analyzingCount}
          extractError={library.error}
          referenceApplied={Boolean(activeRef?.profile)}
          extractedThumb={pillThumb}
          onPhotoDrop={addFiles}
          onResetExtract={handleResetExtract}
          onOpenLibrary={() => setLibraryOpen(true)}
          onClear={handleClear}
          error={error}
          onGenerate={handleGenerate}
          canGenerate={Object.values(profile).some((v) => v.trim() !== '')}
          resolution={resolution}
          onResolutionChange={setResolution}
          sheetMode={sheetMode}
          onSheetModeChange={setSheetMode}
          inFlightCount={inFlight.length}
        />
      </div>

      {/* Gallery panel — 50% on desktop */}
      <div className={paneClass(pane === 'gallery', 'md:w-1/2 md:overflow-hidden')}>
        <GalleryPanel
          inFlight={inFlight}
          onCancelGen={handleCancelGen}
          onLaunchGen={handleLaunchGen}
        />
      </div>

      {/* The reference library — every photo analysed for autofill, kept so a
          face can be reused without paying for the analysis twice. Lives here
          rather than in ControlsPanel so a bulk analysis keeps running with the
          panel closed. */}
      <ReferenceLibrarySlideOver
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        items={library.items}
        analyzingIds={library.analyzingIds}
        activeId={activeRefId}
        error={library.error}
        onAdd={addFiles}
        onApply={applyReference}
        onRetry={library.retry}
        canRetry={library.canRetry}
        onRemove={handleRemoveRef}
      />

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
