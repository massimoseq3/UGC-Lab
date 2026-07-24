import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { useAppStore } from '../../stores/appStore'
import { useReportActivity } from '../../stores/activityStore'
import { useBankStore } from '../../stores/bankStore'
import type { Product, Model, Script, BRoll, BrollHistoryItem } from '../../stores/types'
import type { BrollResult, PromptVariation, ReferenceImage, VariationTag, VariationRefs, CardState, BrollMode, OneShotDelivery, OneShotResult, OneShotCardState, ContinuousResult, ContinuousConcept, ContinuousSelection, ContinuousFrameCardState, ContinuousClipCardState } from './types'
import { generateBroll } from './services/generateBroll'
import { generateOneShot, generateOneShotVariation, buildDemoOneShotResult, ONE_SHOT_DEFAULT_MODEL_ID } from './services/generateOneShot'
import { generateContinuous, buildDemoContinuousResult, analyzeStyleReferences, CONTINUOUS_DEFAULT_MODEL_ID } from './services/generateContinuous'
import InputPanel from './components/InputPanel'
import RightPanel from './components/RightPanel'
import { brollHistoryMode } from './components/BrollHistoryView'
import { backfillCardState, backfillOneShotCardState, backfillContinuousFrameState, backfillContinuousClipState } from './cardState'
import { useSettingsStore } from '../../stores/settingsStore'
import BankPicker from '../../components/BankPicker'
import { usePersistedState, useProjectScopedKey } from '../../hooks/usePersistedState'
import { humanizeError } from '../../utils/friendlyError'
import { fileToDataUri } from '../../utils/kie'
import { getAsBase64, isAssetRef } from '../../utils/assetStore'

type PickerMode = 'products' | 'models' | 'scripts' | 'styleRefs' | null

// Each mode gets its own shade of the B-Roll purple so the accent shifts when
// you switch toggles — a visual cue for which mode you're in. The wrapper's
// data-broll-mode attribute drives the retint; the shades + ramp live in
// index.css ([data-broll-mode]), light- and dark-correct, so no per-component
// colours change here.

// Map old slash-form tag values onto the new single-word union. Variations
// generated before iteration 3 carry strings like 'CHARACTER / SPEAKING';
// after migration they become 'DIALOGUE'. Keys are typed as `string` to
// match raw localStorage values.
const TAG_MIGRATION: Record<string, VariationTag> = {
  'CHARACTER / SPEAKING': 'DIALOGUE',
  'LITERAL / ACTION': 'ACTION',
  'EMOTIONAL / REACTION': 'EMOTIONAL',
  'PRODUCT / DETAIL': 'PRODUCT',
  // Identity entries so already-migrated tags pass through unchanged.
  'DIALOGUE': 'DIALOGUE',
  'STATIC': 'STATIC',
  'ACTION': 'ACTION',
  'EMOTIONAL': 'EMOTIONAL',
  'PRODUCT': 'PRODUCT',
  'POV': 'POV',
  'ENVIRONMENT': 'ENVIRONMENT',
  'TRANSITION': 'TRANSITION',
  'PROOF': 'PROOF',
}

const DEFAULT_LABELS: Record<VariationTag, string> = {
  DIALOGUE: 'Talking to camera',
  STATIC: 'Same shot every scene',
  ACTION: 'Literal action',
  EMOTIONAL: 'Emotional reaction',
  PRODUCT: 'Product detail',
  POV: 'POV insert',
  ENVIRONMENT: 'Environment beat',
  TRANSITION: 'Transition move',
  PROOF: 'Proof shot',
}

function migrateVariation(v: PromptVariation): PromptVariation {
  const rawTag = (v.tag as unknown as string) ?? 'ACTION'
  const tag = TAG_MIGRATION[rawTag] ?? 'ACTION'
  // Old data stored a positional label like 'Option 1' — drop it for the
  // descriptive default unless the LLM already filled in something better.
  const looksPositional = !v.label || /^option\s*\d/i.test(v.label)
  const label = looksPositional ? DEFAULT_LABELS[tag] : v.label
  // Default refs to 'both' when the persisted variation didn't have any
  // reference declaration. Keeps existing card behaviour (both refs attached).
  const refs: VariationRefs = v.refs ?? 'both'
  // Strip any leftover LLM template wrappers from prompts persisted before
  // the parser fix landed. Same regex set the parser now applies.
  const prompt = (v.prompt ?? '')
    .replace(/<LABEL>[\s\S]*?<\/LABEL>/g, '')
    .replace(/<REFS>[\s\S]*?<\/REFS>/g, '')
    .replace(/<\/?(PROMPT|VAR_\d+|TAG|POSITION|VISIBILITY)>/g, '')
    .trim()
  return { ...v, tag, label, refs, prompt }
}

function newSessionId(): string {
  return crypto.randomUUID()
}

// Capped at 80 chars so the history row shows the gist without wrapping.
function buildInputSummary(productName: string | undefined, scriptText: string): string {
  const prefix = productName ? `${productName} — ` : ''
  const body = scriptText.trim().replace(/\s+/g, ' ').slice(0, 80 - prefix.length)
  return `${prefix}${body}`.trim() || 'Untitled session'
}

export default function BrollStudio() {
  const baseKey = useProjectScopedKey('broll-studio')
  const [selectedProductId, setSelectedProductId] = usePersistedState<string | null>(`${baseKey}:productId`, null)
  const [selectedModelId, setSelectedModelId] = usePersistedState<string | null>(`${baseKey}:modelId`, null)
  const [selectedScriptId, setSelectedScriptId] = usePersistedState<string | null>(`${baseKey}:scriptId`, null)
  const [scriptText, setScriptText] = usePersistedState(`${baseKey}:scriptText`, '')
  const [additionalContext, setAdditionalContext] = usePersistedState(`${baseKey}:context`, '')
  const [result, setResult] = usePersistedState<BrollResult | null>(
    `${baseKey}:result`,
    null,
    {
      // Migrate persisted scenes from the legacy slash-form tag union
      // (CHARACTER / SPEAKING etc) into the new clean union (DIALOGUE etc).
      // Also backfill new fields (label, refs) on older variations so the
      // UI doesn't render undefined chips. Runs once on hydrate.
      sanitize: (raw) => {
        if (!raw || !raw.scenes) return raw
        return {
          ...raw,
          scenes: raw.scenes.map((s) => ({
            ...s,
            variations: s.variations.map(migrateVariation),
          })),
        }
      },
    },
  )

  // Per-card state — lifted from RightPanel so BrollStudio can snapshot it
  // into the brollHistory bank whenever it changes. Sanitized on hydrate to
  // clear transient flags + backfill legacy fields.
  const [cardStates, setCardStates] = usePersistedState<Record<string, CardState>>(
    `${baseKey}:cardStates`,
    {},
    {
      sanitize: (raw) => {
        const next: Record<string, CardState> = {}
        const stripTags = (s: string) => s
          .replace(/<LABEL>[\s\S]*?<\/LABEL>/g, '')
          .replace(/<REFS>[\s\S]*?<\/REFS>/g, '')
          .replace(/<\/?(PROMPT|VAR_\d+|TAG|POSITION|VISIBILITY)>/g, '')
          .trim()
        for (const k in raw) {
          const card = raw[k] as Partial<CardState> & Record<string, unknown>
          const patched: CardState = backfillCardState(card)
          patched.isGeneratingImage = false
          patched.pendingTaskId = null
          patched.pendingModelId = null
          patched.pendingStartedAt = null
          patched.videoStatus = 'idle'
          patched.videoTaskId = null
          patched.videoStartedAt = null
          patched.isPromptWorking = false
          patched.promptError = null
          // Clean leftover LLM template wrappers from anything the user typed
          // before the parser fix shipped. Same regex set as the parser.
          patched.editablePrompt = stripTags(patched.editablePrompt ?? '')
          patched.promptHistory = (patched.promptHistory ?? []).map(stripTags)
          next[k] = patched
        }
        return next
      },
    },
  )

  // ── One Shot mode state ──────────────────────────────────────
  // Defaults keep existing users in line-by-line with zero change.
  const [mode, setMode] = usePersistedState<BrollMode>(`${baseKey}:mode`, 'line', {
    // The keyframe-chain mode shipped briefly as 'animated' before the rename.
    sanitize: (raw) => ((raw as string) === 'animated' ? 'continuous' : raw),
  })
  const [oneShotDelivery, setOneShotDelivery] = usePersistedState<OneShotDelivery>(`${baseKey}:oneShotDelivery`, 'dialogue')
  // Line-by-Line delivery: 'silent' (all cards silent b-roll — today's default)
  // or 'dialogue' (one talking card per scene + three silent b-roll cards).
  const [lineDelivery, setLineDelivery] = usePersistedState<OneShotDelivery>(`${baseKey}:lineDelivery`, 'silent')
  const [oneShotResult, setOneShotResult] = usePersistedState<OneShotResult | null>(`${baseKey}:oneShotResult`, null)
  const [oneShotCardStates, setOneShotCardStates] = usePersistedState<Record<string, OneShotCardState>>(
    `${baseKey}:oneShotCardStates`,
    {},
    {
      sanitize: (raw) => {
        const next: Record<string, OneShotCardState> = {}
        for (const k in raw) {
          next[k] = backfillOneShotCardState(raw[k] as Partial<OneShotCardState> & Record<string, unknown>)
        }
        return next
      },
    },
  )
  // The One Shot model selection lives in settingsStore like every other model
  // pick. Seedance 2.0 (not the app's Omni default) — it's the only default
  // that does 15s multi-cut with refs AND audio.
  const oneShotModelId =
    useSettingsStore((s) => s.perAppModel['broll-studio:oneshot:video']) ?? ONE_SHOT_DEFAULT_MODEL_ID

  // ── Continuous mode (keyframe chain) state ─────────────────────
  // Until the user actively picks a style, the look falls back to a mode-
  // specific default: UGC Realism for Line-by-Line / One-Shot, 3D Animated for
  // Continuous. `styleChosen` (not the raw id) gates this so a legacy persisted
  // id from the old app-wide default doesn't masquerade as an explicit pick.
  const [continuousStyleId, setContinuousStyleId] = usePersistedState<string>(`${baseKey}:continuousStyle`, '')
  const [styleChosen, setStyleChosen] = usePersistedState<boolean>(`${baseKey}:styleChosen`, false)
  const resolvedStyleId = styleChosen && continuousStyleId
    ? continuousStyleId
    : (mode === 'continuous' ? 'zack-3d' : 'ugc')
  const chooseStyle = (id: string) => { setContinuousStyleId(id); setStyleChosen(true) }
  // Style reference frames are memory-only (data: URIs blow the localStorage
  // quota); the distilled brief they produce IS persisted, so a refresh keeps
  // the locked style even though the thumbnails go.
  const [styleRefs, setStyleRefs] = useState<string[]>([])
  const [isAnalyzingStyle, setIsAnalyzingStyle] = useState(false)
  const [continuousStyleBrief, setContinuousStyleBrief] = usePersistedState<string | null>(`${baseKey}:continuousStyleBrief`, null)
  const [continuousResult, setContinuousResult] = usePersistedState<ContinuousResult | null>(`${baseKey}:continuousResult`, null)
  const [continuousSelections, setContinuousSelections] = usePersistedState<Record<string, ContinuousSelection>>(`${baseKey}:continuousSelections`, {})
  const [continuousFrameStates, setContinuousFrameStates] = usePersistedState<Record<string, ContinuousFrameCardState>>(
    `${baseKey}:continuousFrameStates`,
    {},
    {
      sanitize: (raw) => {
        const next: Record<string, ContinuousFrameCardState> = {}
        for (const k in raw) next[k] = backfillContinuousFrameState(raw[k] as Partial<ContinuousFrameCardState> & Record<string, unknown>)
        return next
      },
    },
  )
  const [continuousClipStates, setContinuousClipStates] = usePersistedState<Record<string, ContinuousClipCardState>>(
    `${baseKey}:continuousClipStates`,
    {},
    {
      sanitize: (raw) => {
        const next: Record<string, ContinuousClipCardState> = {}
        for (const k in raw) next[k] = backfillContinuousClipState(raw[k] as Partial<ContinuousClipCardState> & Record<string, unknown>)
        return next
      },
    },
  )
  const continuousModelId =
    useSettingsStore((s) => s.perAppModel['broll-studio:continuous:video']) ?? CONTINUOUS_DEFAULT_MODEL_ID

  const [isGenerating, setIsGenerating] = useState(false)
  const [isAddingVariation, setIsAddingVariation] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerMode, setPickerMode] = useState<PickerMode>(null)
  const [highlightField, setHighlightField] = useState<string | null>(null)

  // Pulse the dock dot while the scene analysis or any card generation runs.
  useReportActivity(
    'broll-studio',
    isGenerating ||
      Object.values(cardStates).some(
        (cs) =>
          cs.inFlightImages.length > 0 ||
          cs.inFlightVideos.length > 0 ||
          cs.isGeneratingImage ||
          cs.videoStatus === 'generating' ||
          cs.isPromptWorking === true,
      ) ||
      Object.values(oneShotCardStates).some((cs) => cs.inFlightVideos.length > 0) ||
      Object.values(continuousFrameStates).some((cs) => cs.inFlightImages.some((e) => !e.error)) ||
      Object.values(continuousClipStates).some((cs) => cs.inFlightVideos.some((e) => !e.error)),
  )

  const interAppPayload = useAppStore((s) => s.interAppPayload)
  const consumePayload = useAppStore((s) => s.consumePayload)
  const activeApp = useAppStore((s) => s.activeApp)
  const getScriptById = useBankStore((s) => s.getScriptById)
  const products = useBankStore((s) => s.products)
  const models = useBankStore((s) => s.models)
  const scripts = useBankStore((s) => s.scripts)
  const upsertBrollHistory = useBankStore((s) => s.upsertBrollHistory)

  // Active session id for the brollHistory upsert. Persisted so a refresh
  // mid-session keeps editing the same history row instead of forking a new
  // one. Cleared (= regenerated) whenever the user runs a fresh generation.
  const [sessionId, setSessionId] = usePersistedState<string>(`${baseKey}:sessionId`, '')
  const sessionIdRef = useRef(sessionId)
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])

  // Active history row in the History tab — highlights the row that's
  // currently being edited / restored.
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(sessionId || null)
  useEffect(() => { setActiveHistoryId(sessionId || null) }, [sessionId])

  const selectedProduct = useMemo<Product | null>(
    () => (selectedProductId ? products.find((p) => p.id === selectedProductId) ?? null : null),
    [selectedProductId, products],
  )
  const selectedModel = useMemo<Model | null>(
    () => (selectedModelId ? models.find((m) => m.id === selectedModelId) ?? null : null),
    [selectedModelId, models],
  )
  const selectedScript = useMemo<Script | null>(
    () => (selectedScriptId ? scripts.find((s) => s.id === selectedScriptId) ?? null : null),
    [selectedScriptId, scripts],
  )

  // Consume inter-app payload (from Scripts "Send to B-Roll Images")
  useEffect(() => {
    if (activeApp !== 'broll-studio') return
    if (!interAppPayload || interAppPayload.targetApp !== 'broll-studio') return

    const { targetField, data } = interAppPayload

    if (targetField === 'scriptText' && typeof data === 'string') {
      setScriptText(data)
      setSelectedScriptId(null)
      setHighlightField('script')
      setTimeout(() => setHighlightField(null), 800)
    }

    if (targetField === 'scriptId' && typeof data === 'string') {
      const script = getScriptById(data)
      if (script) {
        setSelectedScriptId(script.id)
        setScriptText(script.scriptText)
        setHighlightField('script')
        setTimeout(() => setHighlightField(null), 800)
      }
    }

    consumePayload()
  }, [interAppPayload, activeApp, consumePayload, getScriptById])

  // Persist the current session into brollHistory whenever the result or
  // card states change. Debounced ~1s so rapid edits (e.g. typing into a
  // prompt) don't thrash localStorage. Only writes when there's actually a
  // result to snapshot.
  useEffect(() => {
    if ((!result && !oneShotResult && !continuousResult) || !sessionIdRef.current) return
    const handle = setTimeout(() => {
      const item: BrollHistoryItem = {
        id: sessionIdRef.current,
        // Candidate creation time — only applied to a brand-new row; the store
        // preserves the original `createdAt` on every subsequent save.
        createdAt: Date.now(),
        // Row-level style snapshot for the history pill (works across all three
        // modes, incl. One-Shot whose result carries no styleId). `resolvedStyleId`
        // folds in the per-mode default (UGC for line/one-shot, 3D for continuous).
        styleId: resolvedStyleId || undefined,
        styleBrief: continuousStyleBrief ?? undefined,
        inputSummary: buildInputSummary(selectedProduct?.productName, scriptText),
        productId: selectedProductId ?? undefined,
        modelId: selectedModelId ?? undefined,
        scriptId: selectedScriptId ?? undefined,
        scriptText: scriptText || undefined,
        context: additionalContext || undefined,
        result: result ?? { scenes: [] },
        cardStates,
        mode,
        lineDelivery: result ? lineDelivery : undefined,
        oneShotResult: oneShotResult ?? undefined,
        oneShotCardStates: Object.keys(oneShotCardStates).length > 0 ? oneShotCardStates : undefined,
        oneShotDelivery: oneShotResult ? oneShotDelivery : undefined,
        oneShotModelId: oneShotResult ? oneShotModelId : undefined,
        continuousResult: continuousResult ?? undefined,
        continuousFrameStates: Object.keys(continuousFrameStates).length > 0 ? continuousFrameStates : undefined,
        continuousClipStates: Object.keys(continuousClipStates).length > 0 ? continuousClipStates : undefined,
        continuousSelections: Object.keys(continuousSelections).length > 0 ? continuousSelections : undefined,
        continuousStyleId: continuousResult ? continuousStyleId : undefined,
        continuousModelId: continuousResult ? continuousModelId : undefined,
      }
      upsertBrollHistory(item)
    }, 1000)
    return () => clearTimeout(handle)
  }, [result, cardStates, lineDelivery, oneShotResult, oneShotCardStates, oneShotDelivery, oneShotModelId, continuousResult, continuousFrameStates, continuousClipStates, continuousSelections, continuousStyleId, continuousStyleBrief, resolvedStyleId, continuousModelId, mode, selectedProductId, selectedModelId, selectedScriptId, scriptText, additionalContext, selectedProduct, upsertBrollHistory])

  // "New": clear the inputs / references only. The generated scene cards stay
  // on screen — they're the user's output, never wiped by starting a new
  // session. Blanking the sessionId *detaches* the kept cards: the debounced
  // History upsert early-returns while it's empty, so clearing the inputs
  // can't overwrite the saved session's metadata. The prior session is already
  // preserved as its own brollHistory row, and the next generation stamps a
  // fresh sessionId + replaces the cards cleanly.
  const handleSelectProduct = (item: unknown) => {
    setSelectedProductId((item as Product).id)
    setPickerMode(null)
  }

  const handleSelectModel = (item: unknown) => {
    setSelectedModelId((item as Model).id)
    setPickerMode(null)
  }

  const handleSelectScript = (item: unknown) => {
    const script = item as Script
    setSelectedScriptId(script.id)
    setScriptText(script.scriptText)
    setPickerMode(null)
  }

  // Functional setResult + useCallback keeps these referentially stable so the
  // memoized VariationCardRow doesn't re-render every card on each render.
  const handleAddVariation = useCallback((sceneNumber: number, variation: PromptVariation) => {
    setResult((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        scenes: prev.scenes.map((s) =>
          s.number === sceneNumber
            ? { ...s, variations: [...s.variations, { ...variation, label: `Option ${s.variations.length + 1}` }] }
            : s
        ),
      }
    })
  }, [setResult])

  const handleDeleteVariation = useCallback((sceneNumber: number, variationId: string) => {
    setResult((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        scenes: prev.scenes.map((s) =>
          s.number === sceneNumber
            ? { ...s, variations: s.variations.filter((v) => v.id !== variationId) }
            : s
        ),
      }
    })
  }, [setResult])

  // Edit the ad's shared dialogue voice profile (from a dialogue card's modal).
  // One value on the result, applied to every DIALOGUE clip at fire time.
  const handleUpdateVoiceProfile = useCallback((text: string) => {
    setResult((prev) => (prev ? { ...prev, voiceProfile: text } : prev))
  }, [setResult])

  const handleOpenCharacterPicker = useCallback(() => setPickerMode('models'), [])
  const handleOpenProductPicker = useCallback(() => setPickerMode('products'), [])

  // Build context strings and reference images from selected bank items
  const productContext = selectedProduct
    ? `Product: ${selectedProduct.productName}. ${selectedProduct.productDescription}. USPs: ${selectedProduct.usps}. Benefits: ${selectedProduct.benefits}.${selectedProduct.keySpecs ? ` Key specs: ${selectedProduct.keySpecs}.` : ''}`
    : ''
  const modelContext = selectedModel
    ? `Model/Character: ${selectedModel.name}.${selectedModel.notes ? ` ${selectedModel.notes}.` : ''}${selectedModel.jsonProfile ? ` Profile: ${JSON.stringify(selectedModel.jsonProfile)}` : ''}`
    : ''
  const characterRef = useMemo<ReferenceImage | undefined>(
    () => (selectedModel?.characterImage ? { dataUrl: selectedModel.characterImage, label: 'character' } : undefined),
    [selectedModel?.characterImage],
  )
  const productRef = useMemo<ReferenceImage | undefined>(
    () => (selectedProduct?.productImage ? { dataUrl: selectedProduct.productImage, label: 'product' } : undefined),
    [selectedProduct?.productImage],
  )
  // Combined ref bundle passed to the scene-generation LLM call — gives it
  // visibility into which reference images the user has selected so it can
  // emit sensible <REFS> tags per variation.
  const referenceImages: ReferenceImage[] = [
    ...(characterRef ? [characterRef] : []),
    ...(productRef ? [productRef] : []),
  ]

  const handleGenerateOneShot = async () => {
    if (!scriptText.trim()) return
    // No kie.ai key yet → show sample concepts so the member can see exactly
    // what One Shot produces before they set up billing. Rendering a clip
    // still needs a real key (the Generate Video button surfaces that).
    if (!useSettingsStore.getState().kieApiKey) {
      setSessionId(newSessionId())
      setOneShotCardStates({})
      setOneShotResult(buildDemoOneShotResult(oneShotModelId, oneShotDelivery))
      useAppStore.getState().addToast('Showing sample concepts — add your kie.ai key to generate from your own script', 'info')
      return
    }
    setIsGenerating(true)
    setError(null)
    try {
      const res = await generateOneShot({
        scriptText,
        delivery: oneShotDelivery,
        modelId: oneShotModelId,
        productContext,
        modelContext,
        additionalContext,
        styleId: resolvedStyleId,
        styleBrief: continuousStyleBrief ?? undefined,
      })
      // Same commit discipline as line mode: only rotate the session once we
      // actually have concepts, so a failed call leaves the old ones intact.
      setSessionId(newSessionId())
      setOneShotCardStates({})
      setOneShotResult(res)
      if (res.concepts.length < 4) {
        useAppStore.getState().addToast(`${res.concepts.length} of 4 concepts generated — the rest failed`, 'error')
      } else {
        useAppStore.getState().addToast('One-Shot concepts ready', 'success')
      }
    } catch (err) {
      const msg = humanizeError(err, 'Concept generation failed. Check your API key and try again.')
      setError(msg)
      useAppStore.getState().addToast(`Concept generation failed: ${msg}`, 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  // "Add variation" — one more concept appended to the existing set, planned
  // against the model the result was generated with so its clip split matches
  // the others. The seed-card effect in OneShotView picks up the new segments.
  const handleAddOneShotVariation = async () => {
    if (!oneShotResult || isAddingVariation) return
    if (!useSettingsStore.getState().kieApiKey) {
      useAppStore.getState().addToast('Add your kie.ai key in Settings to generate more variations', 'info')
      return
    }
    setIsAddingVariation(true)
    try {
      const concept = await generateOneShotVariation(
        {
          scriptText,
          delivery: oneShotResult.delivery,
          modelId: oneShotResult.modelId,
          productContext,
          modelContext,
          additionalContext,
          // Style is already fixed on oneShotResult; the new concept inherits it
          // at fire time. Passed only to satisfy the input shape.
          styleId: resolvedStyleId,
          styleBrief: continuousStyleBrief ?? undefined,
        },
        oneShotResult.concepts.length,
      )
      setOneShotResult((prev) => (prev ? { ...prev, concepts: [...prev.concepts, concept] } : prev))
      useAppStore.getState().addToast('Variation added', 'success')
    } catch (err) {
      const msg = humanizeError(err, 'Could not add a variation. Try again.')
      useAppStore.getState().addToast(`Add variation failed: ${msg}`, 'error')
    } finally {
      setIsAddingVariation(false)
    }
  }

  const handleGenerateContinuous = async () => {
    if (!scriptText.trim()) return
    // No kie.ai key yet → show the sample storyboard so the member sees what
    // Continuous mode produces before wiring billing.
    if (!useSettingsStore.getState().kieApiKey) {
      setSessionId(newSessionId())
      setContinuousFrameStates({})
      setContinuousClipStates({})
      setContinuousSelections({})
      setContinuousResult(buildDemoContinuousResult(continuousModelId, resolvedStyleId))
      useAppStore.getState().addToast('Showing a sample storyboard — add your kie.ai key to storyboard your own script', 'info')
      return
    }
    setIsGenerating(true)
    setError(null)
    try {
      const res = await generateContinuous({
        scriptText,
        styleId: resolvedStyleId,
        styleBrief: continuousStyleBrief ?? undefined,
        modelId: continuousModelId,
        productContext,
        modelContext,
        additionalContext,
      })
      // Same commit discipline as the other modes: only rotate the session
      // once a storyboard actually landed.
      setSessionId(newSessionId())
      setContinuousFrameStates({})
      setContinuousClipStates({})
      setContinuousSelections({})
      setContinuousResult(res)
      useAppStore.getState().addToast('Storyboard ready — pick a keyframe per frame, then animate', 'success')
    } catch (err) {
      const msg = humanizeError(err, 'Storyboard generation failed. Check your API key and try again.')
      setError(msg)
      useAppStore.getState().addToast(`Storyboard failed: ${msg}`, 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  // Style references → one vision call → a style paragraph that outranks the
  // preset chips for this storyboard. Reads the LOOK only, never the content.
  const handleAddStyleRefs = async (files: File[]) => {
    const room = 4 - styleRefs.length
    if (room <= 0) return
    const dataUris = await Promise.all(files.slice(0, room).map((f) => fileToDataUri(f)))
    setStyleRefs((prev) => [...prev, ...dataUris].slice(0, 4))
  }

  // Add saved B-Roll stills as style references — the vision pass reads data
  // URIs, so resolve each bank asset ref to base64 before storing it.
  const handleAddStyleRefsFromBank = async (items: BRoll[]) => {
    const room = 4 - styleRefs.length
    if (room <= 0) return
    const refs = items.map((b) => b.imageUrl).filter(Boolean).slice(0, room)
    const dataUris = (
      await Promise.all(
        refs.map(async (ref) => {
          if (!isAssetRef(ref)) return ref
          const asset = await getAsBase64(ref)
          return asset ? `data:${asset.mimeType};base64,${asset.base64}` : null
        }),
      )
    ).filter((u): u is string => !!u)
    if (dataUris.length > 0) setStyleRefs((prev) => [...prev, ...dataUris].slice(0, 4))
  }

  const handleAnalyzeStyleRefs = async () => {
    if (styleRefs.length === 0 || isAnalyzingStyle) return
    if (!useSettingsStore.getState().kieApiKey) {
      useAppStore.getState().addToast('Add your kie.ai key in Settings to analyze a reference style', 'info')
      return
    }
    setIsAnalyzingStyle(true)
    try {
      const brief = await analyzeStyleReferences(styleRefs)
      setContinuousStyleBrief(brief)
      useAppStore.getState().addToast('Style locked from your references', 'success')
    } catch (err) {
      const msg = humanizeError(err, 'Could not read the style from those images.')
      useAppStore.getState().addToast(`Style analysis failed: ${msg}`, 'error')
    } finally {
      setIsAnalyzingStyle(false)
    }
  }

  // Add one blank concept box to a single keyframe (the frame row's "Add
  // concept" card). Mirrors Line-by-Line's "Add option": it drops an empty
  // card the user opens and writes — or generates a prompt in — rather than
  // firing an LLM call up front.
  const handleAddContinuousConcept = (frameIndex: number) => {
    setContinuousResult((prev) => {
      if (!prev) return prev
      const blank: ContinuousConcept = { id: `cont-${crypto.randomUUID()}`, label: 'Custom', prompt: '' }
      return {
        ...prev,
        frames: prev.frames.map((f) => (f.index === frameIndex ? { ...f, concepts: [...f.concepts, blank] } : f)),
      }
    })
  }

  const handleGenerate = async () => {
    if (mode === 'oneshot') return handleGenerateOneShot()
    if (mode === 'continuous') return handleGenerateContinuous()
    if (!scriptText.trim()) return
    setIsGenerating(true)
    setError(null)
    try {
      const res = await generateBroll({
        productId: selectedProduct?.id ?? null,
        modelId: selectedModel?.id ?? null,
        scriptId: selectedScript?.id ?? null,
        scriptText,
        additionalContext,
        productContext,
        modelContext,
        referenceImages,
        styleId: resolvedStyleId,
        styleBrief: continuousStyleBrief ?? undefined,
        delivery: lineDelivery,
      })
      // Only now that we have scenes do we start a fresh session: rotating the
      // id and clearing cardStates up-front meant a failed call left the old
      // scenes on screen stripped of every image (and wrote a new history row
      // holding the old result with no card states). Batched into one commit,
      // so the rebuild effect sees the new result against empty cards.
      setSessionId(newSessionId())
      setCardStates({})
      setResult(res)
      useAppStore.getState().addToast('B-roll image generated', 'success')
    } catch (err) {
      const msg = humanizeError(err, 'B-Roll generation failed. Check your API key and try again.')
      setError(msg)
      useAppStore.getState().addToast(`B-roll generation failed: ${msg}`, 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  // Restore a B-Roll session from history. Loads all inputs + result +
  // cardStates back into the workspace. Images/videos resume from their
  // asset:// refs (IndexedDB / R2). Sets sessionId so further edits update
  // the same history row instead of forking a new one.
  const handleSelectHistory = (item: BrollHistoryItem) => {
    setSessionId(item.id)
    setSelectedProductId(item.productId ?? null)
    setSelectedModelId(item.modelId ?? null)
    setSelectedScriptId(item.scriptId ?? null)
    setScriptText(item.scriptText ?? '')
    setAdditionalContext(item.context ?? '')
    // One-shot-only sessions store a placeholder `{ scenes: [] }` — restore
    // that as null so line mode shows its empty state, not a blank grid.
    const lineResult = item.result as BrollResult | null
    setResult(lineResult && lineResult.scenes?.length > 0 ? lineResult : null)
    const restored: Record<string, CardState> = {}
    for (const k in item.cardStates as Record<string, unknown>) {
      restored[k] = backfillCardState(
        (item.cardStates as Record<string, Partial<CardState> & Record<string, unknown>>)[k],
      )
    }
    setCardStates(restored)
    // Restore the Line-by-Line delivery toggle (legacy rows => silent).
    setLineDelivery(item.lineDelivery ?? 'silent')

    // Switch to the mode this row actually represents (derived from its content,
    // not the unreliable last-active `mode`) so the toggle + right panel land on
    // what the user clicked. Same helper drives the history badge, so they agree.
    setMode(brollHistoryMode(item))
    setOneShotResult((item.oneShotResult as OneShotResult | undefined) ?? null)
    const restoredOneShot: Record<string, OneShotCardState> = {}
    for (const k in (item.oneShotCardStates ?? {}) as Record<string, unknown>) {
      restoredOneShot[k] = backfillOneShotCardState(
        (item.oneShotCardStates as Record<string, Partial<OneShotCardState> & Record<string, unknown>>)[k],
      )
    }
    setOneShotCardStates(restoredOneShot)
    if (item.oneShotDelivery) setOneShotDelivery(item.oneShotDelivery)
    if (item.oneShotModelId) {
      useSettingsStore.getState().setAppModel('broll-studio:oneshot:video', item.oneShotModelId)
    }

    // Continuous snapshot (absent on older rows).
    setContinuousResult((item.continuousResult as ContinuousResult | undefined) ?? null)
    const restoredFrames: Record<string, ContinuousFrameCardState> = {}
    for (const k in (item.continuousFrameStates ?? {}) as Record<string, unknown>) {
      restoredFrames[k] = backfillContinuousFrameState(
        (item.continuousFrameStates as Record<string, Partial<ContinuousFrameCardState> & Record<string, unknown>>)[k],
      )
    }
    setContinuousFrameStates(restoredFrames)
    const restoredClips: Record<string, ContinuousClipCardState> = {}
    for (const k in (item.continuousClipStates ?? {}) as Record<string, unknown>) {
      restoredClips[k] = backfillContinuousClipState(
        (item.continuousClipStates as Record<string, Partial<ContinuousClipCardState> & Record<string, unknown>>)[k],
      )
    }
    setContinuousClipStates(restoredClips)
    setContinuousSelections((item.continuousSelections as Record<string, ContinuousSelection> | undefined) ?? {})
    if (item.continuousStyleId) { setContinuousStyleId(item.continuousStyleId); setStyleChosen(true) }
    if (item.continuousModelId) {
      useSettingsStore.getState().setAppModel('broll-studio:continuous:video', item.continuousModelId)
    }
    setActiveHistoryId(item.id)
  }

  return (
    <div
      className="flex flex-col pb-28 md:flex-row md:h-full md:pb-0"
      data-broll-mode={mode}
    >
      {/* Left panel — inputs */}
      <div className="flex w-full md:w-[30%] shrink-0 flex-col border-b md:border-b-0 md:border-r border-ink/5">
        <InputPanel
          selectedProduct={selectedProduct}
          selectedModel={selectedModel}
          selectedScript={selectedScript}
          scriptText={scriptText}
          additionalContext={additionalContext}
          onSelectProduct={() => setPickerMode('products')}
          onSelectModel={() => setPickerMode('models')}
          onSelectScript={() => setPickerMode('scripts')}
          onClearProduct={() => setSelectedProductId(null)}
          onClearModel={() => setSelectedModelId(null)}
          onClearScript={() => setSelectedScriptId(null)}
          onScriptTextChange={(v) => { setScriptText(v); setSelectedScriptId(null) }}
          onAdditionalContextChange={setAdditionalContext}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          highlightField={highlightField}
          mode={mode}
          onModeChange={setMode}
          lineDelivery={lineDelivery}
          onLineDeliveryChange={setLineDelivery}
          oneShotDelivery={oneShotDelivery}
          onOneShotDeliveryChange={setOneShotDelivery}
          oneShotModelId={oneShotModelId}
          onOneShotModelChange={() => { /* persisted by the picker via persistKey */ }}
          continuousStyleId={resolvedStyleId}
          onContinuousStyleChange={chooseStyle}
          styleRefs={styleRefs}
          onAddStyleRefs={(files) => { void handleAddStyleRefs(files) }}
          onRemoveStyleRef={(i) => setStyleRefs((prev) => prev.filter((_, idx) => idx !== i))}
          onClearStyleRefs={() => { setStyleRefs([]); setContinuousStyleBrief(null) }}
          onAnalyzeStyleRefs={() => { void handleAnalyzeStyleRefs() }}
          onPickStyleRefsFromBank={() => setPickerMode('styleRefs')}
          isAnalyzingStyle={isAnalyzingStyle}
          continuousStyleBrief={continuousStyleBrief}
          onClearStyleBrief={() => setContinuousStyleBrief(null)}
        />
      </div>

      {/* Right panel — output */}
      <div className="flex w-full md:w-[70%] flex-col overflow-hidden">
        <RightPanel
          mode={mode}
          result={result}
          oneShotResult={oneShotResult}
          oneShotModelId={oneShotModelId}
          oneShotCardStates={oneShotCardStates}
          setOneShotCardStates={setOneShotCardStates}
          onAddOneShotVariation={handleAddOneShotVariation}
          isAddingVariation={isAddingVariation}
          continuousResult={continuousResult}
          continuousModelId={continuousModelId}
          continuousFrameStates={continuousFrameStates}
          setContinuousFrameStates={setContinuousFrameStates}
          continuousClipStates={continuousClipStates}
          setContinuousClipStates={setContinuousClipStates}
          continuousSelections={continuousSelections}
          setContinuousSelections={setContinuousSelections}
          onAddContinuousConcept={handleAddContinuousConcept}
          addingConceptFrame={null}
          isGenerating={isGenerating}
          error={error}
          onAddVariation={handleAddVariation}
          onDeleteVariation={handleDeleteVariation}
          onUpdateVoiceProfile={handleUpdateVoiceProfile}
          characterRef={characterRef}
          productRef={productRef}
          selectedProduct={selectedProduct}
          selectedModel={selectedModel}
          selectedProductId={selectedProduct?.id ?? undefined}
          selectedModelId={selectedModel?.id ?? undefined}
          selectedScriptId={selectedScript?.id ?? undefined}
          productContext={productContext}
          modelContext={modelContext}
          onOpenCharacterPicker={handleOpenCharacterPicker}
          onOpenProductPicker={handleOpenProductPicker}
          cardStates={cardStates}
          setCardStates={setCardStates}
          activeHistoryId={activeHistoryId}
          onSelectHistory={handleSelectHistory}
        />
      </div>

      {/* Bank Pickers */}
      <BankPicker
        bankType="products"
        isOpen={pickerMode === 'products'}
        onSelect={handleSelectProduct}
        onClose={() => setPickerMode(null)}
      />
      <BankPicker
        bankType="models"
        isOpen={pickerMode === 'models'}
        onSelect={handleSelectModel}
        onClose={() => setPickerMode(null)}
      />
      <BankPicker
        bankType="scripts"
        isOpen={pickerMode === 'scripts'}
        onSelect={handleSelectScript}
        onClose={() => setPickerMode(null)}
      />
      {/* Style references from the bank — saved B-Roll stills (image only),
          multi-select. Their look is what gets distilled, not their content. */}
      <BankPicker
        bankType="brolls"
        isOpen={pickerMode === 'styleRefs'}
        multiSelect
        filter={(item) => !!(item as BRoll).imageUrl}
        onSelect={() => { /* multi-select uses onSelectMany */ }}
        onSelectMany={(items) => { void handleAddStyleRefsFromBank(items as BRoll[]) }}
        onClose={() => setPickerMode(null)}
      />
    </div>
  )
}
