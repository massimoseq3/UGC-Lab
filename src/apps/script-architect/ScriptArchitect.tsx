import { useMemo, useState, useEffect } from 'react'
import { FileText, PenLine } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import MobilePaneTabs, { paneClass } from '../../components/MobilePaneTabs'
import { useReportActivity } from '../../stores/activityStore'
import { useBankStore } from '../../stores/bankStore'
import type { Product, ScriptHistoryItem } from '../../stores/types'
import InputPanel from './components/InputPanel'
import RightPanel from './components/RightPanel'
import { generateScript } from './services/generateScript'
import { humanizeError } from '../../utils/friendlyError'
import { WRITE_STYLE_META, HOOK_CATEGORY_META, detectSceneBlueprint, isWriteStyle, isWriteFormat, isWriteLength, isRemixLength, isHookCategoryChoice, isHookCount, isVariationCount, parseHooks, DEFAULT_VARIATION_COUNT, DEFAULT_HOOK_COUNT, DEFAULT_REMIX_LENGTH, type ScriptMode, type ScriptUiMode, type EditableProductContext, type WriteStyle, type WriteFormat, type WriteLength, type RemixLength, type HookCategoryChoice, type HookCount, type VariationCount, type RemixAngle } from './types'
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

  // Panel-level "New" — wipes the input column back to a blank slate. Inputs
  // ONLY: generated variations stay in the Output pane and in the script
  // history bank, because outputs are the user's work.
  const handleClearInputs = () => {
    setSource('')
    setBrief('')
    setSelectedProductId(null)
    setAdditionalContext('')
  }
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
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Phone-only: which of the two panes is on screen (ignored from md up).
  const [pane, setPane] = useState<'input' | 'output'>('input')
  const [highlightField, setHighlightField] = useState<string | null>(null)

  // Pulse the dock dot while the script LLM call runs.
  useReportActivity('script-architect', isGenerating)

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

    setIsGenerating(true)
    setError(null)
    setActiveHistoryId(null)
    // On a phone only one pane is on screen — follow the run to the takes.
    setPane('output')
    // Lock the output's labelling context to this run up front, so the
    // loading copy and the resulting cards reflect what was generated.
    setOutputMode(resolvedMode)
    setOutputStyle(writeStyle)
    setOutputFormat(writeFormat)
    setOutputHookCategory(hookCategory)
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
      setVariations(result.variations)
      setOutputAngles(result.angles ?? null)
      setOutputVoiceProfile(result.voiceProfile ?? '')

      const inputSource = mode === 'write' ? brief : source
      const item: ScriptHistoryItem = {
        id: crypto.randomUUID(),
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
      setActiveHistoryId(item.id)

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
      setError(msg)
      useAppStore.getState().addToast(msg, 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSelectHistory = (item: ScriptHistoryItem) => {
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

      <div className={paneClass(pane === 'input', 'md:w-1/2 md:shrink-0 md:border-r md:border-ink/5')}>
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
          isGenerating={isGenerating}
          highlightField={highlightField}
        />
      </div>

      <div className={paneClass(pane === 'output', 'md:w-1/2')}>
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
          isGenerating={isGenerating}
          error={error}
          onEditVariation={(index, text) =>
            setVariations((prev) => prev.map((v, i) => (i === index ? text : v)))
          }
          voiceProfile={outputVoiceProfile}
          onEditVoiceProfile={setOutputVoiceProfile}
          history={scriptHistory}
          activeHistoryId={activeHistoryId}
          onSelectHistory={handleSelectHistory}
          onDeleteHistory={handleDeleteHistory}
        />
      </div>
    </div>
  )
}
