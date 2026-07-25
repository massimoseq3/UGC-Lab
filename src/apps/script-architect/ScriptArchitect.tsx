import { useMemo, useState, useEffect } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useReportActivity } from '../../stores/activityStore'
import { useBankStore } from '../../stores/bankStore'
import type { Model, Product, ScriptHistoryItem } from '../../stores/types'
import InputPanel from './components/InputPanel'
import RightPanel from './components/RightPanel'
import { generateScript } from './services/generateScript'
import { humanizeError } from '../../utils/friendlyError'
import { WRITE_STYLE_META, HOOK_CATEGORY_META, detectSceneBlueprint, isWriteStyle, isHookCategoryChoice, parseHooks, type ScriptMode, type ScriptUiMode, type EditableProductContext, type WriteStyle, type WriteFormat, type WriteLength, type HookCategoryChoice } from './types'
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
  const [writeFormat, setWriteFormat] = usePersistedState<WriteFormat>(`${baseKey}:writeFormat`, 'script')
  const [writeLength, setWriteLength] = usePersistedState<WriteLength>(`${baseKey}:writeLength`, 15)
  // Hooks format: which formula family the pack draws from ('auto' = mixed).
  const [hookCategory, setHookCategory] = usePersistedState<HookCategoryChoice>(`${baseKey}:hookCategory`, 'auto', {
    sanitize: (v) => (isHookCategoryChoice(v) ? v : 'auto'),
  })
  const [selectedProductId, setSelectedProductId] = usePersistedState<string | null>(`${baseKey}:productId`, null)
  // Influencer (Bank → Influencers / models) for the cinematic 'prompt' format.
  // Optional, only used by that format: its portrait rides the Playground
  // handoff as the @INFLUENCER reference image.
  const [selectedInfluencerId, setSelectedInfluencerId] = usePersistedState<string | null>(`${baseKey}:influencerId`, null)
  const [additionalContext, setAdditionalContext] = usePersistedState(`${baseKey}:context`, '')

  // Panel-level "New" — wipes the input column back to a blank slate. Inputs
  // ONLY: generated variations stay in the Output pane and in the script
  // history bank, because outputs are the user's work.
  const handleClearInputs = () => {
    setSource('')
    setBrief('')
    setSelectedProductId(null)
    setSelectedInfluencerId(null)
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
  // Format + length pinned to the *currently shown* output, so the cinematic
  // "Send to Playground" handoff uses the duration that actually produced the
  // prompt — not whatever the live left-panel toggles read now.
  const [outputFormat, setOutputFormat] = usePersistedState<WriteFormat>(`${baseKey}:outputFormat`, 'script')
  const [outputLength, setOutputLength] = usePersistedState<WriteLength>(`${baseKey}:outputLength`, 15)
  const [outputHookCategory, setOutputHookCategory] = usePersistedState<HookCategoryChoice>(`${baseKey}:outputHookCategory`, 'auto', {
    sanitize: (v) => (isHookCategoryChoice(v) ? v : 'auto'),
  })
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highlightField, setHighlightField] = useState<string | null>(null)

  // Pulse the dock dot while the script LLM call runs.
  useReportActivity('script-architect', isGenerating)

  const interAppPayload = useAppStore((s) => s.interAppPayload)
  const consumePayload = useAppStore((s) => s.consumePayload)
  const activeApp = useAppStore((s) => s.activeApp)
  const getProductById = useBankStore((s) => s.getProductById)
  const products = useBankStore((s) => s.products)
  const models = useBankStore((s) => s.models)
  const scriptHistory = useBankStore((s) => s.scriptHistory)
  const addScriptHistory = useBankStore((s) => s.addScriptHistory)
  const deleteScriptHistory = useBankStore((s) => s.deleteScriptHistory)

  const selectedProduct = useMemo<Product | null>(
    () => (selectedProductId ? products.find((p) => p.id === selectedProductId) ?? null : null),
    [selectedProductId, products],
  )
  const handleProductSelect = (p: Product | null) => setSelectedProductId(p?.id ?? null)

  const selectedInfluencer = useMemo<Model | null>(
    () => (selectedInfluencerId ? models.find((m) => m.id === selectedInfluencerId) ?? null : null),
    [selectedInfluencerId, models],
  )
  const handleInfluencerSelect = (m: Model | null) => setSelectedInfluencerId(m?.id ?? null)

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
    if (!sourceFilled || !selectedProduct) return

    setIsGenerating(true)
    setError(null)
    setActiveHistoryId(null)
    // Lock the output's labelling context to this run up front, so the
    // loading copy and the resulting cards reflect what was generated.
    setOutputMode(resolvedMode)
    setOutputStyle(writeStyle)
    setOutputFormat(writeFormat)
    setOutputLength(writeLength)
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
        hookCategory,
        productId: selectedProduct.id,
        productName: selectedProduct.productName,
        productContext,
        additionalContext,
      })
      setVariations(result.variations)

      const inputSource = mode === 'write' ? brief : source
      const item: ScriptHistoryItem = {
        id: crypto.randomUUID(),
        mode: resolvedMode,
        variations: result.variations,
        inputSummary: inputSource.slice(0, 200),
        linkedProductId: selectedProduct.id,
        productName: selectedProduct.productName,
        winningTranscript,
        reversePrompt,
        additionalContext,
        brief,
        writeStyle,
        writeFormat,
        writeLength,
        hookCategory,
        createdAt: Date.now(),
      }
      addScriptHistory(item)
      setActiveHistoryId(item.id)

      const hookCount = writeFormat === 'hooks' ? parseHooks(result.variations[0] ?? '').length : 0
      // Count what actually came back rather than the configured batch size, so
      // the toast stays honest if a take fails or the count changes again.
      const n = result.variations.length
      useAppStore.getState().addToast(
        resolvedMode === 'write'
          ? (writeFormat === 'hooks' ? `${hookCount || 'Your'} hooks generated` : writeFormat === 'prompt' ? `${n} cinematic concepts generated` : writeFormat === 'scenes' ? `${n} scene drafts generated` : `${n} scripts generated`)
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
    setOutputFormat(item.writeFormat ?? 'script')
    setOutputLength(item.writeLength === 10 || item.writeLength === 15 || item.writeLength === 30 || item.writeLength === 60 ? item.writeLength : 15)
    setOutputHookCategory(isHookCategoryChoice(item.hookCategory) ? item.hookCategory : 'auto')
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
      if (item.writeFormat) setWriteFormat(item.writeFormat)
      if (item.writeLength === 10 || item.writeLength === 15 || item.writeLength === 30 || item.writeLength === 60) {
        setWriteLength(item.writeLength)
      }
      if (item.writeFormat === 'hooks' && isHookCategoryChoice(item.hookCategory)) {
        setHookCategory(item.hookCategory)
      }
    }
  }

  const handleDeleteHistory = (id: string) => {
    deleteScriptHistory(id)
    if (activeHistoryId === id) setActiveHistoryId(null)
  }

  // "New": clear the inputs only (source text + selected product/influencer +
  // context). The generated variations stay on screen — they're the user's
  // working output / history, never wiped by starting a new draft. (Output
  // labels are pinned to outputMode/outputStyle snapshots, so leaving the
  // shown cards untouched is safe even as the live left-panel toggles reset.)
  return (
    <div className="relative flex flex-col pb-32 md:flex-row md:h-full md:pb-0">
      <div className="flex w-full md:w-1/2 shrink-0 flex-col border-b md:border-b-0 md:border-r border-ink/5">
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
          hookCategory={hookCategory}
          onHookCategoryChange={setHookCategory}
          selectedProduct={selectedProduct}
          onProductSelect={handleProductSelect}
          selectedInfluencer={selectedInfluencer}
          onInfluencerSelect={handleInfluencerSelect}
          additionalContext={additionalContext}
          onAdditionalContextChange={setAdditionalContext}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          highlightField={highlightField}
        />
      </div>

      <div className="flex w-full md:w-1/2 flex-col min-h-[300px] md:min-h-0">
        <RightPanel
          variations={variations}
          mode={resolvedMode}
          outputMode={outputMode}
          writeFormat={outputFormat}
          writeStyleLabel={WRITE_STYLE_META[outputStyle].label}
          hookCategoryLabel={HOOK_CATEGORY_META[outputHookCategory].label}
          linkedProductId={selectedProduct?.id ?? null}
          influencer={selectedInfluencer}
          cinematicDuration={outputLength}
          isGenerating={isGenerating}
          error={error}
          onEditVariation={(index, text) =>
            setVariations((prev) => prev.map((v, i) => (i === index ? text : v)))
          }
          history={scriptHistory}
          activeHistoryId={activeHistoryId}
          onSelectHistory={handleSelectHistory}
          onDeleteHistory={handleDeleteHistory}
        />
      </div>
    </div>
  )
}
