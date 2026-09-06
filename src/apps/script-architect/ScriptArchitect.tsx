import { useMemo, useRef, useState, useEffect } from 'react'
import { FileText, PenLine } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import MobilePaneTabs from '../../components/MobilePaneTabs'
import { paneClass } from '../../components/paneClass'
import { useReportActivity } from '../../stores/activityStore'
import { useBankStore } from '../../stores/bankStore'
import { useMinWidth } from '../../hooks/useBreakpoint'
import type { Product, ScriptHistoryItem } from '../../stores/types'
import InputPanel from './components/InputPanel'
import RightPanel from './components/RightPanel'
import { generateScript } from './services/generateScript'
import { humanizeError } from '../../utils/friendlyError'
import { WRITE_STYLE_META, HOOK_CATEGORY_META, detectSceneBlueprint, isWriteStyle, isWriteFormat, isWriteLength, isRemixLength, isHookCategoryChoice, isHookCount, isVariationCount, parseHooks, DEFAULT_VARIATION_COUNT, DEFAULT_HOOK_COUNT, DEFAULT_REMIX_LENGTH, type ScriptMode, type ScriptUiMode, type EditableProductContext, type WriteStyle, type WriteFormat, type WriteLength, type RemixLength, type HookCategoryChoice, type HookCount, type VariationCount, type RemixAngle, type PendingScriptRun } from './types'
import { usePersistedState, useProjectScopedKey } from '../../hooks/usePersistedState'

interface ReverseEngineerPayload {
  fullPrompt?: string
  scenes?: Array<{ prompt: string; index: number; label: string; startTime: string; endTime: string }>
}

// Substituted for an empty Write New brief so the model takes creative license
// instead of the user hitting a hard "brief required" wall.
const OPEN_BRIEF = "I'm open to seeing what you can come up with."

// One-time draft migration: the merged Remix source box replaced the two
// per-mode fields (transcript / reversePrompt). Seed the new slot from
// whichever legacy draft is non-empty so nobody loses work on upgrade.
function readLegacySource(baseKey: string): string {
  try {
    const read = (key: string) => {
      const raw = localStorage.getItem(key)
      return raw ? String(JSON.parse(raw)) : ''
    }
    return read(`${baseKey}:transcript`) || read(`${baseKey}:reversePrompt`) || ''
  } catch {
    return ''
  }
}

export default function ScriptArchitect() {
  const baseKey = useProjectScopedKey('script-architect')
  // Drafts persisted before the merge may hold 'reverse-engineer' — fold it
  // into the merged 'remix' mode on hydration.
  const [mode, setMode] = usePersistedState<ScriptUiMode>(`${baseKey}:mode`, 'remix', {
    sanitize: (v) => ((v as string) === 'reverse-engineer' ? 'remix' : v),
  })
  const [source, setSource] = usePersistedState(`${baseKey}:source`, readLegacySource(baseKey))
  // Override for the blueprint auto-detect: remix the pasted blueprint as a
  // plain script (a batch of variations) instead of rewriting its scene prompts.
  const [forceTranscript, setForceTranscript] = useState(false)
  const [brief, setBrief] = usePersistedState(`${baseKey}:brief`, '')
  const [writeStyle, setWriteStyle] = usePersistedState<WriteStyle>(`${baseKey}:writeStyle`, 'pas', {
    sanitize: (v) => (isWriteStyle(v) ? v : 'pas'),
  })
  const [writeFormat, setWriteFormat] = usePersistedState<WriteFormat>(`${baseKey}:writeFormat`, 'script', {
    sanitize: (v) => (isWriteFormat(v) ? v : 'script'),
  })
  const [writeLength, setWriteLength] = usePersistedState<WriteLength>(`${baseKey}:writeLength`, 15)
  // Remix's own length, kept in its own slot: it carries a 'default' (keep the
  // source ad's length) that Write New has no meaning for, and the two modes'
  // picks shouldn't overwrite each other.
  const [remixLength, setRemixLength] = usePersistedState<RemixLength>(`${baseKey}:remixLength`, DEFAULT_REMIX_LENGTH, {
    sanitize: (v) => (isRemixLength(v) ? v : DEFAULT_REMIX_LENGTH),
  })
  // How many takes a generate returns. Applies to both modes; Hooks ignores it.
  const [variationCount, setVariationCount] = usePersistedState<VariationCount>(`${baseKey}:variationCount`, DEFAULT_VARIATION_COUNT, {
    sanitize: (v) => (isVariationCount(v) ? v : DEFAULT_VARIATION_COUNT),
  })
  // Hooks format: which formula family the pack draws from ('auto' = mixed).
  const [hookCategory, setHookCategory] = usePersistedState<HookCategoryChoice>(`${baseKey}:hookCategory`, 'auto', {
    sanitize: (v) => (isHookCategoryChoice(v) ? v : 'auto'),
  })
  // How many hooks a Hooks generate returns. Its own slot, not variationCount:
  // that one counts whole scripts, and the two lists don't overlap.
  const [hookCount, setHookCount] = usePersistedState<HookCount>(`${baseKey}:hookCount`, DEFAULT_HOOK_COUNT, {
    sanitize: (v) => (isHookCount(v) ? v : DEFAULT_HOOK_COUNT),
  })
  const [selectedProductId, setSelectedProductId] = usePersistedState<string | null>(`${baseKey}:productId`, null)
  const [additionalContext, setAdditionalContext] = usePersistedState(`${baseKey}:context`, '')

  const [variations, setVariations] = usePersistedState<string[]>(`${baseKey}:variations`, [])
  // Snapshot of the mode + style that produced the *currently shown*
  // variations. The output panel labels off these (not the live left-panel
  // selectors) so flipping the Style/mode after a generation doesn't
  // retroactively relabel the cards or their save-to-bank titles.
  const [outputMode, setOutputMode] = usePersistedState<ScriptMode>(`${baseKey}:outputMode`, 'remix')
  const [outputStyle, setOutputStyle] = usePersistedState<WriteStyle>(`${baseKey}:outputStyle`, 'pas', {
    sanitize: (v) => (isWriteStyle(v) ? v : 'pas'),
  })
  // Format pinned to the *currently shown* output, so the cards keep the labels
  // of the run that produced them when the live left-panel toggle moves on.
  const [outputFormat, setOutputFormat] = usePersistedState<WriteFormat>(`${baseKey}:outputFormat`, 'script', {
    sanitize: (v) => (isWriteFormat(v) ? v : 'script'),
  })
  // Remix only: the angle list that produced the *currently shown* cards, so
  // labels come from what actually ran rather than from re-deriving off a list
  // that may have been reordered or resized since.
  const [outputAngles, setOutputAngles] = usePersistedState<RemixAngle[] | null>(`${baseKey}:outputAngles`, null)
  // Remix only: the one voice brief the shown run came back with. Its own slot
  // rather than a line inside a variation — nothing generates it into a take,
  // and it belongs to the batch, not to any card in it.
  const [outputVoiceProfile, setOutputVoiceProfile] = usePersistedState<string>(`${baseKey}:outputVoiceProfile`, '')
  const [outputHookCategory, setOutputHookCategory] = usePersistedState<HookCategoryChoice>(`${baseKey}:outputHookCategory`, 'auto', {
    sanitize: (v) => (isHookCategoryChoice(v) ? v : 'auto'),
  })
  // What the Output pane is showing: a finished history row, or one of the runs
  // still writing (both are addressed by the same id — see PendingScriptRun).
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  // Every run in flight, newest first — so the in-progress block and the
  // day-grouped rows under it read as one most-recent-first list rather than as
  // two orderings. They are HISTORY rows from the moment they are fired, so
  // Generate never stands down: press it again and a second card joins the
  // queue, exactly as pressing a media app's Generate twice queues two tiles.
  const [pendingRuns, setPendingRuns] = useState<PendingScriptRun[]>([])
  const [error, setError] = useState<string | null>(null)
  // The one thing a run's async tail has to read back AFTER its await, and the
  // one it can't: the closure captured the render's `activeHistoryId`, and by
  // the time a script lands the member has usually moved the pane. Holds the id
  // of the still-writing run the pane is parked on, or null when it is parked
  // on finished work — which is exactly the question "may this run take the
  // pane when it lands?" asks. See the landing guard in handleGenerate.
  const watchedRunIdRef = useRef<string | null>(null)
  // Phone-only: which of the two panes is on screen (ignored from md up).
  const [pane, setPane] = useState<'input' | 'output'>('input')
  // Behaviour, not layout: where the rail stands in FRONT of the takes, picking
  // a run has to hand the pane back; beside them it must not, browsing the list
  // being the whole point of a rail. The layout itself is pure CSS — this only
  // has to agree with it, so keep the number in step with the
  // `min-[980px]:` classes in RightPanel and HistoryRail.
  //
  // 980, not Tailwind's `lg`: the threshold is the width at which all three
  // columns fit — a 380px input panel, the 280px rail, and ~320px of readable
  // takes. `lg` (1024) is the nearest breakpoint and it is 44px too high, which
  // put a 994px window (Safari at half a 1080p screen) on the covering side of
  // a line it clears.
  const railIsColumn = useMinWidth(980)
  // Whether the history rail is showing. Persisted, because it is a working
  // preference rather than a per-run state — a member recording their screen
  // shuts it once, not once per session. It opens by default where it can sit
  // BESIDE the takes and stays shut where it would cover them: on a phone the
  // first thing this pane should show is the thing you pressed Generate for,
  // not the list of what you pressed it for before. Only ever a default — the
  // stored answer, once there is one, is the member's.
  //
  // The slot is `:historyRail`, not the `:historyOpen` this was built under:
  // renaming it once made every browser that had shut the rail while it was
  // being built re-default rather than carry a stale `false` into the finished
  // thing. That is free only while a feature is unreleased — after that a
  // default flip needs the one-shot reset marker `appVisibilityStore` uses.
  const [historyOpen, setHistoryOpen] = usePersistedState<boolean>(`${baseKey}:historyRail`, railIsColumn)
  // "Clear the canvas" state. Holds a signature of the output that was cleared,
  // so the next generation (or a history restore) fills the panel again on its
  // own. Nothing is deleted — every take is already a History row; this exists
  // so the last run isn't sitting on camera while a new one is filmed.
  const [clearedSig, setClearedSig] = useState<string | null>(null)
  const [highlightField, setHighlightField] = useState<string | null>(null)

  // Pulse the dock dot while any script is being written.
  useReportActivity('script-architect', pendingRuns.length > 0)

  const interAppPayload = useAppStore((s) => s.interAppPayload)
  const consumePayload = useAppStore((s) => s.consumePayload)
  const activeApp = useAppStore((s) => s.activeApp)
  const getProductById = useBankStore((s) => s.getProductById)
  const products = useBankStore((s) => s.products)
  const scriptHistory = useBankStore((s) => s.scriptHistory)
  const addScriptHistory = useBankStore((s) => s.addScriptHistory)
  const deleteScriptHistory = useBankStore((s) => s.deleteScriptHistory)

  const selectedProduct = useMemo<Product | null>(
    () => (selectedProductId ? products.find((p) => p.id === selectedProductId) ?? null : null),
    [selectedProductId, products],
  )
  const handleProductSelect = (p: Product | null) => setSelectedProductId(p?.id ?? null)

  // The pipeline the next Generate will run. The UI toggle only offers
  // Remix / Write New; within Remix, a detected scene blueprint routes to the
  // scene-rewrite ('reverse-engineer') pipeline unless the user overrides.
  const isBlueprint = detectSceneBlueprint(source)
  const resolvedMode: ScriptMode = mode === 'write'
    ? 'write'
    : isBlueprint && !forceTranscript ? 'reverse-engineer' : 'remix'

  // The Output pane is a slot addressed by id, so "is it watching something
  // write?" is a lookup, not a flag. Non-null is the one state that draws the
  // writing face.
  const watchedRun = pendingRuns.find((r) => r.id === activeHistoryId) ?? null
  const outputSig = `${activeHistoryId ?? ''}|${variations.length}|${(variations[0] ?? '').slice(0, 64)}`
  const cleared = !watchedRun && variations.length > 0 && clearedSig === outputSig

  // Consume inter-app payloads. Both Ad Analyzer send actions land in the
  // same merged source box — the format detection picks the pipeline.
  useEffect(() => {
    if (activeApp !== 'script-architect') return
    if (!interAppPayload || interAppPayload.targetApp !== 'script-architect') return

    const { targetField, data } = interAppPayload

    if (targetField === 'reverseEngineerPrompt') {
      const payload = data as ReverseEngineerPayload | string
      const full = typeof payload === 'string'
        ? payload
        : (payload.fullPrompt ?? (payload.scenes ?? [])
            .map((s) => `--- Scene ${s.index}: ${s.label} (${s.startTime}-${s.endTime}) ---\n${s.prompt}`)
            .join('\n\n'))
      setMode('remix')
      setForceTranscript(false)
      setSource(full)
      setHighlightField('source')
      setTimeout(() => setHighlightField(null), 800)
    } else if (targetField === 'winningTranscript' || targetField === 'reconstructionPrompt') {
      setMode('remix')
      setForceTranscript(false)
      setSource(data as string)
      setHighlightField('source')
      setTimeout(() => setHighlightField(null), 800)
    } else if (targetField === 'productId') {
      const product = getProductById(data as string)
      if (product) setSelectedProductId(product.id)
    }

    consumePayload()
  }, [interAppPayload, activeApp, consumePayload, getProductById, setMode, setSource, setSelectedProductId])

  // Park the Output pane on `run` and pin the labels the cards read off. Both
  // the moment a run is fired and the moment it lands go through this, so the
  // writing face and the takes it turns into can't describe the run
  // differently — and a member who browsed History mid-run, which moves every
  // one of these, gets them put back.
  const pinRun = (run: PendingScriptRun) => {
    setActiveHistoryId(run.id)
    setOutputMode(run.mode)
    setOutputStyle(run.writeStyle)
    setOutputFormat(run.writeFormat)
    setOutputHookCategory(run.hookCategory)
  }

  // The same slot with nothing in it yet: the run as fired, or as clicked back
  // to from its in-progress card. Either way the pane is now watching a run
  // that is still writing, which is what the guard below reads.
  const showRunEmpty = (run: PendingScriptRun) => {
    watchedRunIdRef.current = run.id
    pinRun(run)
    setClearedSig(null)
    setVariations([])
    setOutputAngles(null)
    setOutputVoiceProfile('')
  }

  const handleGenerate = async (productContext: EditableProductContext | null) => {
    // Write New's brief is optional: an empty brief hands the model creative
    // license rather than blocking generation (avoids decision paralysis for
    // users who don't know what to write).
    const effectiveBrief = mode === 'write' && !brief.trim() ? OPEN_BRIEF : brief
    const sourceFilled = mode === 'write' ? true : source.trim()
    // A product is OPTIONAL in both modes — a member describing the product in
    // the brief or the instructions shouldn't have to bank it first. What each
    // mode still needs is a subject from SOMEWHERE: Remix has its source
    // script, and Write New needs the product or the brief (with neither, the
    // OPEN_BRIEF stand-in would be asking for an ad about nothing).
    if (!sourceFilled) return
    if (mode === 'write' && !selectedProduct && !brief.trim()) return

    const inputSource = mode === 'write' ? brief : source
    // Mint the run's id before the call: it names the in-progress card in
    // History, it is what the Output pane is parked on while the run writes,
    // and it becomes the finished row's id — so the card never changes
    // identity under the member watching it.
    const run: PendingScriptRun = {
      id: crypto.randomUUID(),
      mode: resolvedMode,
      writeStyle,
      writeFormat,
      hookCategory,
      hookCount,
      variationCount,
      productName: selectedProduct?.productName,
      inputSummary: inputSource.slice(0, 200),
      startedAt: Date.now(),
    }
    setPendingRuns((prev) => [run, ...prev])
    setError(null)
    // On a phone only one pane is on screen — follow the run to the takes.
    setPane('output')
    showRunEmpty(run)
    // Route the merged source into the field the resolved pipeline reads.
    const winningTranscript = resolvedMode === 'remix' ? source : ''
    const reversePrompt = resolvedMode === 'reverse-engineer' ? source : ''
    try {
      const result = await generateScript({
        mode: resolvedMode,
        winningTranscript,
        reversePrompt,
        brief: effectiveBrief,
        writeStyle,
        writeFormat,
        writeLength,
        // 'default' → omitted, which is what tells the remix to keep the
        // source ad's own length.
        remixLength: remixLength === 'default' ? undefined : remixLength,
        hookCategory,
        hookCount,
        variationCount,
        productId: selectedProduct?.id ?? null,
        productName: selectedProduct?.productName,
        productContext,
        additionalContext,
      })
      const item: ScriptHistoryItem = {
        id: run.id,
        mode: resolvedMode,
        variations: result.variations,
        inputSummary: inputSource.slice(0, 200),
        linkedProductId: selectedProduct?.id,
        productName: selectedProduct?.productName,
        winningTranscript,
        reversePrompt,
        additionalContext,
        brief,
        writeStyle,
        writeFormat,
        writeLength,
        remixLength,
        hookCategory,
        hookCount,
        variationCount,
        remixAngles: result.angles,
        voiceProfile: result.voiceProfile,
        createdAt: Date.now(),
      }
      addScriptHistory(item)
      // The finished run takes the pane, even if the member wandered off into a
      // finished row while it wrote — that is what they pressed Generate for.
      // The one thing it will not do is steal the pane from ANOTHER run still
      // being written: watching a script arrive is the one state where being
      // yanked away loses something you can't get back with a click.
      const watchingAnotherRun =
        watchedRunIdRef.current !== null && watchedRunIdRef.current !== run.id
      if (!watchingAnotherRun) {
        watchedRunIdRef.current = null
        pinRun(run)
        setVariations(result.variations)
        setOutputAngles(result.angles ?? null)
        setOutputVoiceProfile(result.voiceProfile ?? '')
      }

      const hooksReturned = writeFormat === 'hooks' ? parseHooks(result.variations[0] ?? '').length : 0
      // Count what actually came back rather than the configured batch size, so
      // the toast stays honest if a take fails or the count changes again.
      const n = result.variations.length
      useAppStore.getState().addToast(
        resolvedMode === 'write'
          ? (writeFormat === 'hooks' ? `${hooksReturned || 'Your'} hooks generated` : writeFormat === 'scenes' ? `${n} scene drafts generated` : `${n} scripts generated`)
          : resolvedMode === 'remix' ? `${n} script variations generated` : 'Script rewritten',
        'success',
      )
    } catch (err) {
      const msg = humanizeError(err, 'Script generation failed. Check your API key and try again.')
      // Only the pane parked on THIS run should turn into its error; anyone
      // reading something else gets the toast and keeps their page. The pane
      // the run was fired into is already empty, which is the state OutputPanel
      // renders an error in.
      if (watchedRunIdRef.current === run.id) {
        watchedRunIdRef.current = null
        setError(msg)
      }
      useAppStore.getState().addToast(msg, 'error')
    } finally {
      setPendingRuns((prev) => prev.filter((r) => r.id !== run.id))
    }
  }

  const handleSelectHistory = (item: ScriptHistoryItem) => {
    // The pane is on finished work now, so a run that lands may take it back.
    watchedRunIdRef.current = null
    // A click in History is a request to SEE that run, so it always uncovers
    // the canvas — including when the run picked is the one that was cleared,
    // which the signature alone reads as "still the thing I cleared" and left
    // blank. That was reported as history rows not opening at all.
    setClearedSig(null)
    // Where the rail stands in front of the takes, picking a run is a request
    // to read it — so it hands the pane back. Beside them it stays open.
    if (!railIsColumn) setHistoryOpen(false)
    setMode(item.mode === 'write' ? 'write' : 'remix')
    setVariations(item.variations)
    setActiveHistoryId(item.id)
    setError(null)
    // Pin the output labels to the run we're restoring.
    setOutputMode(item.mode)
    setOutputStyle(item.writeStyle && item.writeStyle in WRITE_STYLE_META ? (item.writeStyle as WriteStyle) : 'pas')
    // A row from the retired Cinematic format restores as a plain script take.
    setOutputFormat(isWriteFormat(item.writeFormat) ? item.writeFormat : 'script')
    setOutputHookCategory(isHookCategoryChoice(item.hookCategory) ? item.hookCategory : 'auto')
    // Rows saved before the count was pickable carry no angle list; OutputPanel
    // falls back to matching them by variation count.
    setOutputAngles((item.remixAngles as RemixAngle[] | undefined) ?? null)
    // Rows saved before the voice brief existed carry none, and so do runs
    // whose profile call failed — both restore to no card.
    setOutputVoiceProfile(item.voiceProfile ?? '')
    if (isVariationCount(item.variationCount)) setVariationCount(item.variationCount)
    // Rows saved before Remix had a length carry none — they keep the current
    // pick rather than snapping to 'default'.
    if (item.mode === 'remix' && isRemixLength(item.remixLength)) setRemixLength(item.remixLength)
    // Restore the left-panel inputs too. Older rows (saved before these
    // fields existed) fall back to the inputSummary slice for the source so
    // something sensible reappears.
    const restoredSource = item.mode === 'reverse-engineer'
      ? (item.reversePrompt ?? item.inputSummary)
      : item.mode === 'remix'
        ? (item.winningTranscript ?? item.inputSummary)
        : (item.winningTranscript || item.reversePrompt || '')
    setSource(restoredSource)
    // Keep a regenerate faithful to the restored run: if this row remixed a
    // blueprint-shaped source as a plain script, restore that override too.
    setForceTranscript(item.mode === 'remix' && detectSceneBlueprint(restoredSource))
    setAdditionalContext(item.additionalContext ?? '')
    setSelectedProductId(item.linkedProductId ?? null)
    if (item.mode === 'write') {
      setBrief(item.brief ?? item.inputSummary)
      if (item.writeStyle && item.writeStyle in WRITE_STYLE_META) setWriteStyle(item.writeStyle as WriteStyle)
      if (isWriteFormat(item.writeFormat)) setWriteFormat(item.writeFormat)
      if (isWriteLength(item.writeLength)) setWriteLength(item.writeLength)
      if (item.writeFormat === 'hooks') {
        if (isHookCategoryChoice(item.hookCategory)) setHookCategory(item.hookCategory)
        // Absent on rows saved before the count was pickable — those kept the
        // fixed ten, so restoring the default is faithful to what ran.
        if (isHookCount(item.hookCount)) setHookCount(item.hookCount)
      }
    }
  }

  // Clicking an in-progress card puts the Output pane back on that run. It
  // restores no inputs: the run's own inputs are still in the left panel unless
  // the member has since loaded another row, and silently undoing that edit is
  // not what clicking a status card asks for.
  const handleWatchPending = (run: PendingScriptRun) => {
    setError(null)
    if (!railIsColumn) setHistoryOpen(false)
    showRunEmpty(run)
  }

  // "Clear" on the References card: the inputs only. Every take stays on the
  // canvas and in History — that is what the button's arm and tooltip promise,
  // and the output labels are pinned to their own snapshots, so the shown cards
  // keep their wording as the live selectors reset.
  const handleClearInputs = () => {
    setSource('')
    setBrief('')
    setAdditionalContext('')
    setSelectedProductId(null)
    setForceTranscript(false)
  }

  const handleDeleteHistory = (id: string) => {
    deleteScriptHistory(id)
    if (activeHistoryId === id) setActiveHistoryId(null)
  }

  // "New": clear the inputs only (source text + selected product + context). The generated variations stay on screen — they're the user's
  // working output / history, never wiped by starting a new draft. (Output
  // labels are pinned to outputMode/outputStyle snapshots, so leaving the
  // shown cards untouched is safe even as the live left-panel toggles reset.)
  return (
    <div className="relative flex h-full flex-col md:flex-row">
      <MobilePaneTabs
        options={[
          { value: 'input', label: 'Setup', icon: PenLine },
          { value: 'output', label: 'Output', icon: FileText },
        ]}
        value={pane}
        onChange={setPane}
        accent="scripts"
      />

      <div className={paneClass(pane === 'input', 'md:w-1/3 md:min-w-[380px] md:shrink-0 md:border-r md:border-ink/5')}>
        <InputPanel
          mode={mode}
          onModeChange={setMode}
          onClearInputs={handleClearInputs}
          source={source}
          onSourceChange={setSource}
          isBlueprint={isBlueprint}
          forceTranscript={forceTranscript}
          onForceTranscriptChange={setForceTranscript}
          brief={brief}
          onBriefChange={setBrief}
          writeStyle={writeStyle}
          onWriteStyleChange={setWriteStyle}
          writeFormat={writeFormat}
          onWriteFormatChange={setWriteFormat}
          writeLength={writeLength}
          onWriteLengthChange={setWriteLength}
          remixLength={remixLength}
          onRemixLengthChange={setRemixLength}
          variationCount={variationCount}
          onVariationCountChange={setVariationCount}
          hookCategory={hookCategory}
          onHookCategoryChange={setHookCategory}
          hookCount={hookCount}
          onHookCountChange={setHookCount}
          selectedProduct={selectedProduct}
          onProductSelect={handleProductSelect}
          additionalContext={additionalContext}
          onAdditionalContextChange={setAdditionalContext}
          onGenerate={handleGenerate}
          highlightField={highlightField}
        />
      </div>

      <div className={paneClass(pane === 'output', 'md:min-w-0 md:flex-1')}>
        <RightPanel
          variations={variations}
          mode={resolvedMode}
          outputAngles={outputAngles}
          outputMode={outputMode}
          writeFormat={outputFormat}
          writeStyleLabel={WRITE_STYLE_META[outputStyle].label}
          hookCategoryLabel={HOOK_CATEGORY_META[outputHookCategory].label}
          hookCount={hookCount}
          linkedProductId={selectedProduct?.id ?? null}
          watchedRun={watchedRun}
          activeHistoryId={activeHistoryId}
          error={error}
          onEditVariation={(index, text) =>
            setVariations((prev) => prev.map((v, i) => (i === index ? text : v)))
          }
          voiceProfile={outputVoiceProfile}
          onEditVoiceProfile={setOutputVoiceProfile}
          cleared={cleared}
          onClearCanvas={() => setClearedSig(outputSig)}
          history={scriptHistory}
          pendingRuns={pendingRuns}
          onSelectHistory={handleSelectHistory}
          onWatchPending={handleWatchPending}
          onDeleteHistory={handleDeleteHistory}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen((v) => !v)}
        />
      </div>
    </div>
  )
}
