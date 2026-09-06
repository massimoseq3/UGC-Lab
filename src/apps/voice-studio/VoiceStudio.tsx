import { useMemo, useState, useEffect, useRef } from 'react'
import { FileText, Mic } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import MobilePaneTabs from '../../components/MobilePaneTabs'
import { paneClass } from '../../components/paneClass'
import { useReportActivity } from '../../stores/activityStore'
import { useBankStore } from '../../stores/bankStore'
import { useCreditsStore } from '../../stores/creditsStore'
import type { Script, VoiceHistoryItem } from '../../stores/types'
import type { VoiceSettings } from './types'
import { createDefaultSettings, sanitizeVoiceSettings } from './types'
import { startVoiceTask, finishVoiceTask } from './services/generateVoice'
import { enhanceScriptWithTags } from './services/enhanceScript'
import { humanizeError } from '../../utils/friendlyError'
import EditorArea from './components/EditorArea'
import { VOICE_BATCH_MAX } from './components/GenerateBar'
import HistoryRail from './components/HistoryRail'
import HistoryRailHandle from '../../components/HistoryRailHandle'
import HistoryDetailsView from './components/HistoryDetailsView'
import { clampBatchCount } from '../../utils/batchCount'
import SidePanel from './components/SidePanel'
import BottomPlayer from './components/BottomPlayer'
import BankPicker from '../../components/BankPicker'
import { usePersistedState, useProjectScopedKey } from '../../hooks/usePersistedState'
import { useMinWidth } from '../../hooks/useBreakpoint'

// Persisted in-flight TTS tasks. Survive a refresh so the user doesn't lose
// a gen (and the kie credit) when the tab reloads mid-generation. Stale
// entries (>30 min) are evicted on resume — matches the cap used by other
// apps so behaviour is uniform. Plural: several voiceovers render at once,
// like every other generation surface in the app.
interface InFlightVoice {
  id: string
  taskId: string
  // The TTS model this task was submitted against — snapshotted rather than
  // re-resolved on resume, so a task that outlives a model swap still finishes
  // (and is priced) as the model that actually ran it. Optional: entries
  // persisted before the picker shipped carry none, and finishVoiceTask defaults
  // those to the model they were all fired with.
  modelId?: string
  settings: VoiceSettings
  scriptText: string
  startedAt: number
}
const INFLIGHT_TTL_MS = 30 * 60 * 1000

export default function VoiceStudio() {
  const baseKey = useProjectScopedKey('voice-studio')
  const [rawSettings, setSettings] = usePersistedState<VoiceSettings>(`${baseKey}:settings`, createDefaultSettings())

  // Settings persisted by an older version can be missing fields or hold stale
  // shapes (e.g. no `temperature`, a numeric `style`, an ElevenLabs `voiceId`).
  // Rendering those directly white-screens the tab (the slider does
  // `temperature.toFixed(2)`), so sanitize at READ time — every render, every
  // consumer, sees a valid blob. `settings` is what the rest of the component uses.
  const settings = useMemo(() => sanitizeVoiceSettings(rawSettings), [rawSettings])

  // Heal the stored value once so the persisted blob matches what we render (and
  // so a stale ElevenLabs voiceId doesn't get sent to the new model on generate).
  const didHealRef = useRef(false)
  useEffect(() => {
    if (didHealRef.current) return
    didHealRef.current = true
    if (JSON.stringify(settings) !== JSON.stringify(rawSettings)) setSettings(settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [scriptText, setScriptText] = usePersistedState(`${baseKey}:scriptText`, '')
  const [activePlayerItemId, setActivePlayerItemId] = usePersistedState<string | null>(`${baseKey}:playerId`, null)
  // Persisted so a refresh between createTask and the audio download still
  // resumes polling. We store the kie taskId + the original settings/script
  // snapshot needed to build the history row on success. Read through a coercion
  // because this key used to hold a single entry (or null) before voiceovers
  // could render in parallel.
  const [rawInFlight, setRawInFlight] = usePersistedState<InFlightVoice[] | InFlightVoice | null>(
    `${baseKey}:in-flight`,
    [],
  )
  const inFlightVoices = useMemo(
    () => (Array.isArray(rawInFlight) ? rawInFlight : rawInFlight ? [rawInFlight] : []),
    [rawInFlight],
  )
  const setInFlightVoices = (updater: (prev: InFlightVoice[]) => InFlightVoice[]) =>
    setRawInFlight((prev) => updater(Array.isArray(prev) ? prev : prev ? [prev] : []))

  // How many reads one press of Generate fires. Persisted like the other
  // picker selections; sanitized on read so a stale blob can't arm a bigger
  // run than the cap.
  const [batchCount, setBatchCount] = usePersistedState<number>(`${baseKey}:batch-count`, 1, {
    sanitize: (v) => clampBatchCount(v, VOICE_BATCH_MAX),
  })

  // Clicks that have fired but whose kie taskId hasn't come back yet — they'd
  // otherwise leave the progress bar dark for the first second of a gen.
  const [startingCount, setStartingCount] = useState(0)
  const isGenerating = startingCount + inFlightVoices.length > 0
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scriptPickerOpen, setScriptPickerOpen] = useState(false)

  // Pulse the dock dot while TTS runs (or a persisted task resumes polling).
  useReportActivity('voice-studio', isGenerating)
  const [selectedScript, setSelectedScript] = useState<Script | null>(null)
  const [highlightField, setHighlightField] = useState<string | null>(null)
  const [detailsItem, setDetailsItem] = useState<VoiceHistoryItem | null>(null)
  // Phone-only: which of the two panes is on screen (ignored from md up).
  const [pane, setPane] = useState<'editor' | 'settings'>('editor')
  // Behaviour, not layout: where the rail covers the script, opening a read's
  // details has to hand the pane back; beside it, it must not. Keep the number
  // in step with the `min-[980px]:` classes below.
  //
  // The same 980 Scripts uses, deliberately, even though this app's settings
  // column is a fixed 460px against Scripts' 380 — so the script box here is
  // ~240px at the threshold where the takes there get ~320. Two numbers were
  // tried first and the extra 80px put a 994px window (Safari at half a 1080p
  // screen) on opposite sides of the line in the two apps, which is the one
  // thing a member reads as a bug rather than as a tight fit. A narrow script
  // box is a paste target with a one-click escape; no sidebar at all is not.
  const railIsColumn = useMinWidth(980)
  // Whether the history rail is showing. Persisted, because it is a working
  // preference rather than a per-run state. It opens by default where it can
  // sit BESIDE the script and stays shut where it would cover it — on a phone
  // this pane's job is the script box. Only ever a default; the stored answer,
  // once there is one, is the member's.
  const [historyOpen, setHistoryOpen] = usePersistedState<boolean>(`${baseKey}:historyRail`, railIsColumn)

  const history = useBankStore((s) => s.voiceHistory)
  const activePlayerItem = useMemo<VoiceHistoryItem | null>(
    () => (activePlayerItemId ? history.find((h) => h.id === activePlayerItemId) ?? null : null),
    [activePlayerItemId, history],
  )
  const setActivePlayerItem = (item: VoiceHistoryItem | null) => setActivePlayerItemId(item?.id ?? null)
  const addVoiceHistory = useBankStore((s) => s.addVoiceHistory)
  const deleteVoiceHistory = useBankStore((s) => s.deleteVoiceHistory)

  const interAppPayload = useAppStore((s) => s.interAppPayload)
  const consumePayload = useAppStore((s) => s.consumePayload)
  const activeApp = useAppStore((s) => s.activeApp)

  // Inter-app payload: Scripts → Voiceovers (scriptText).
  useEffect(() => {
    if (activeApp !== 'voice-studio') return
    if (!interAppPayload || interAppPayload.targetApp !== 'voice-studio') return

    const { targetField, data } = interAppPayload

    if (targetField === 'scriptText' && typeof data === 'string') {
      setScriptText(data)
      setHighlightField('script')
      setTimeout(() => setHighlightField(null), 800)
    }

    consumePayload()
  }, [interAppPayload, activeApp, consumePayload])

  const handleLoadScript = (item: unknown) => {
    const script = item as Script
    setScriptText(script.scriptText)
    setSelectedScript(script)
    setScriptPickerOpen(false)
  }

  const refreshCredits = useCreditsStore((s) => s.refresh)

  // Shared finisher used by handleGenerate (foreground) and the mount-time
  // resume effect (background) so both code paths land in the same place on
  // success / failure.
  const finishVoice = async (entry: InFlightVoice) => {
    setError(null)
    try {
      const item = await finishVoiceTask(entry.taskId, entry.settings, entry.scriptText, entry.modelId)
      addVoiceHistory(item)
      setActivePlayerItem(item)
      refreshCredits()
      useAppStore.getState().addToast('Voiceover generated', 'success')
    } catch (err) {
      const msg = humanizeError(err, 'Audio generation failed. Check your API key and try again.')
      setError(msg)
      useAppStore.getState().addToast(msg, 'error')
    } finally {
      // Drop only this entry — any sibling gen keeps running.
      setInFlightVoices((prev) => prev.filter((e) => e.id !== entry.id))
    }
  }

  const handleEnhance = async () => {
    if (!scriptText.trim() || isEnhancing) return
    setIsEnhancing(true)
    setError(null)
    try {
      const enhanced = await enhanceScriptWithTags(scriptText)
      setScriptText(enhanced)
      setSelectedScript(null)
      setHighlightField('script')
      setTimeout(() => setHighlightField(null), 800)
      useAppStore.getState().addToast('Expression tags added', 'success')
    } catch (err) {
      const msg = humanizeError(err, 'Could not enhance the script. Check your API key and try again.')
      useAppStore.getState().addToast(msg, 'error')
    } finally {
      setIsEnhancing(false)
    }
  }

  // One read. A batch fires several of these at once — each is its own kie
  // task, its own in-flight entry and its own history row, exactly as pressing
  // Generate repeatedly has always produced.
  const runOneVoice = async () => {
    // No single-slot guard — a second click queues another voiceover alongside
    // the first, and each lands in history on its own.
    setStartingCount((c) => c + 1)
    setError(null)

    let taskId: string
    let modelId: string
    try {
      const start = await startVoiceTask(settings, scriptText)
      taskId = start.taskId
      modelId = start.modelId
    } catch (err) {
      const msg = humanizeError(err, 'Audio generation failed. Check your API key and try again.')
      setError(msg)
      useAppStore.getState().addToast(msg, 'error')
      setStartingCount((c) => c - 1)
      return
    }

    const entry: InFlightVoice = {
      id: crypto.randomUUID(),
      taskId,
      modelId,
      settings,
      scriptText,
      startedAt: Date.now(),
    }
    // Persist BEFORE we start the poll so a tab refresh during the poll can
    // resume rather than burning the kie credit.
    setInFlightVoices((prev) => [...prev, entry])
    setStartingCount((c) => c - 1)
    await finishVoice(entry)
  }

  const handleGenerate = () => {
    if (!scriptText.trim()) return
    const count = clampBatchCount(batchCount, VOICE_BATCH_MAX)
    for (let i = 0; i < count; i++) void runOneVoice()
    // Show the reads. Generate now sits in the settings pane, which on a
    // phone is the ONLY pane on screen, so without the pane flip a press looks
    // like nothing happened at all; History is where the queue reports itself
    // (the in-progress rows), which is the app-wide "Generate flips to the
    // output pane" rule. The script is untouched and one click back.
    setPane('editor')
    setHistoryOpen(true)
  }

  // Mount-time resume: poll every persisted in-flight TTS taskId that survived
  // (evicting any older than 30 min — kie's record retention is short enough
  // that an older taskId likely 404s anyway).
  const didResumeRef = useRef(false)
  useEffect(() => {
    if (didResumeRef.current) return
    didResumeRef.current = true
    if (inFlightVoices.length === 0) return
    const now = Date.now()
    const stale = inFlightVoices.filter((e) => now - e.startedAt > INFLIGHT_TTL_MS)
    const live = inFlightVoices.filter((e) => now - e.startedAt <= INFLIGHT_TTL_MS)
    if (stale.length > 0) {
      const staleIds = new Set(stale.map((e) => e.id))
      setInFlightVoices((prev) => prev.filter((e) => !staleIds.has(e.id)))
      useAppStore.getState().addToast(
        stale.length === 1 ? 'A stalled voice gen was cleared.' : `${stale.length} stalled voice gens were cleared.`,
        'info',
      )
    }
    live.forEach((entry) => { void finishVoice(entry) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Queue rows for the History tab. Each carries the settings snapshot it was
  // fired with, so a pending row names the right voice even after the picker has
  // moved on.
  const pendingVoices = useMemo(
    () =>
      inFlightVoices.map((e) => ({
        id: e.id,
        voiceId: e.settings.voiceId,
        voiceName: e.settings.voiceName,
        scriptPreview: e.scriptText.trim().slice(0, 140),
      })),
    [inFlightVoices],
  )

  // Opening a details view (from a History card, or from the player) has to
  // put the pane that holds it on screen. Done during render as a prop-change
  // sync rather than in an effect, the same shape the side panel used when it
  // owned this view.
  const [prevDetails, setPrevDetails] = useState(detailsItem)
  if (detailsItem !== prevDetails) {
    setPrevDetails(detailsItem)
    // The details view rides over the script column, so the rail only has to
    // stand down where it is covering that column rather than sitting beside it.
    if (detailsItem) { setPane('editor'); if (!railIsColumn) setHistoryOpen(false) }
  }

  const handleDeleteHistoryItem = (id: string) => {
    deleteVoiceHistory(id)
    if (activePlayerItem?.id === id) setActivePlayerItem(null)
    if (detailsItem?.id === id) setDetailsItem(null)
  }

  const handleRestoreText = (text: string) => {
    setScriptText(text)
    setSelectedScript(null)
    setHighlightField('script')
    setTimeout(() => setHighlightField(null), 800)
    setDetailsItem(null)
  }

  const handleRestoreSettings = (next: Partial<VoiceSettings>) => {
    // Restored history settings aren't a preset, so any loaded preset's stamp
    // goes with them — otherwise the panel keeps naming a preset it no longer holds.
    setSettings((prev) => ({ ...prev, ...next, presetId: undefined, presetLabel: undefined }))
    setDetailsItem(null)
  }

  return (
    <div className="relative flex h-full flex-col">
      <MobilePaneTabs
        options={[
          { value: 'editor', label: 'Script', icon: FileText },
          { value: 'settings', label: 'Voice', icon: Mic },
        ]}
        value={pane}
        onChange={setPane}
        accent="voice"
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Left — the settings, and Generate at their foot. First in the DOM so
            the desktop reading order matches the visual one (and so this app
            has the same source shape as Scripts / B-Roll); the editor takes
            `order-first` below to keep the mobile stack unchanged — settings
            are long, and they'd push the script box off the first screen.

            460px, up from 400: History leaving freed the column, and the
            settings cards plus a generate row read better with the extra
            width. The last 20px are load-bearing rather than taste — the
            model row shares its line with the batch stepper, and at 440 the
            name it exists to show clipped to "Gemini 2.5 Pro T…" at every
            desktop width, since this column is a constant. Anything else
            reading that constant — the player's ±10s gating does — has to
            move with it. */}
        <div className={paneClass(pane === 'settings', 'md:w-[460px] md:shrink-0 md:border-r md:border-ink/5')}>
          <SidePanel
            settings={settings}
            onSettingsChange={setSettings}
            scriptText={scriptText}
            onGenerate={handleGenerate}
            batchCount={batchCount}
            onBatchCountChange={setBatchCount}
            isGenerating={isGenerating}
            error={error}
          />
        </div>

        {/* Right — the output column: the script, with the reads you've made of
            it in a rail beside it. It carried a Script / History
            `SegmentedToggle` in a 57px band until September 2026; the rail
            replaced the toggle and the band had nothing left to hold. The
            player is this column's FOOTER and spans the rail too — it's the
            transport for whatever is playing, whichever list you're looking
            at. */}
        <div className={paneClass(pane === 'editor', 'md:flex-1 md:overflow-hidden')}>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              {/* From 980px the rail is a column beside the script; below it
                  there is no room for three columns next to a fixed 460px
                  settings panel, so it stands in FRONT of the script — the
                  shape the tab had, and opening a read's details hands the pane
                  back.
                  The details view rides over this column, opaque, the same
                  shape the settings column used when it owned History. */}
              <div
                className={`relative min-h-0 min-w-0 flex-1 overflow-hidden ${
                  historyOpen ? 'hidden min-[980px]:block' : 'block'
                }`}
              >
                {/* The rail's one open/shut control, on the seam this column
                    makes with it — see HistoryRailHandle. */}
                <HistoryRailHandle open={historyOpen} onToggle={() => setHistoryOpen((v) => !v)} />

                <EditorArea
                  scriptText={scriptText}
                  onScriptChange={(v) => { setScriptText(v); setSelectedScript(null) }}
                  onSelectScript={() => setScriptPickerOpen(true)}
                  selectedScript={selectedScript}
                  onClearScript={() => setSelectedScript(null)}
                  canGenerate={scriptText.trim().length > 0}
                  onEnhance={handleEnhance}
                  isEnhancing={isEnhancing}
                  highlightField={highlightField}
                />

                {detailsItem && (
                  <div className="absolute inset-0 bg-surface-1">
                    <HistoryDetailsView
                      item={detailsItem}
                      onClose={() => setDetailsItem(null)}
                      onRestoreText={handleRestoreText}
                      onRestoreSettings={handleRestoreSettings}
                    />
                  </div>
                )}
              </div>

              {historyOpen && (
                <div className="flex min-h-0 w-full flex-col border-l border-ink/5 min-[980px]:w-[280px] min-[980px]:shrink-0">
                  <HistoryRail
                    items={history}
                    pending={pendingVoices}
                    activeId={activePlayerItem?.id ?? null}
                    onSelect={setActivePlayerItem}
                    onDelete={handleDeleteHistoryItem}
                    onShowDetails={setDetailsItem}
                    onNew={() => { setSelectedScript(null); setScriptText('') }}
                    onCollapse={() => setHistoryOpen(false)}
                  />
                </div>
              )}
            </div>

            {activePlayerItem && (
              <div className="flex shrink-0 items-center border-t border-ink/5 px-5 py-3">
                <BottomPlayer
                  item={activePlayerItem}
                  onClose={() => setActivePlayerItem(null)}
                  onShowDetails={setDetailsItem}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Script picker */}
      <BankPicker
        bankType="scripts"
        isOpen={scriptPickerOpen}
        onSelect={handleLoadScript}
        onClose={() => setScriptPickerOpen(false)}
      />
    </div>
  )
}
