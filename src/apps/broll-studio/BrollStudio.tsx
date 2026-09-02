import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { Film, SlidersHorizontal } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import MobilePaneTabs from '../../components/MobilePaneTabs'
import { paneClass } from '../../components/paneClass'
import { useReportActivity } from '../../stores/activityStore'
import { useBankStore } from '../../stores/bankStore'
import type { AdBlueprintPayload, Product, Model, Script, BRoll, BrollHistoryItem } from '../../stores/types'
import { isLineMode, sanitizeBrollMode, type BrollResult, type PromptVariation, type ReferenceImage, type VariationTag, type VariationRefs, type CardState, type BrollMode, type BrollDelivery, type ContinuousResult, type ContinuousConcept, type ContinuousSelection, type ContinuousFrameCardState, type ContinuousClipCardState } from './types'
import { productPhotosOf, buildProductContext } from './services/productAngles'
import { buildDemoContinuousResult, analyzeStyleReferences, getContinuousStyle, styleBriefFor, styleUsesRealism, CONTINUOUS_DEFAULT_MODEL_ID } from './services/generateContinuous'
import {
  startStoryboard,
  resumeStoryboard,
  onStoryboardSettled,
  isStoryboardStranded,
  strandStoryboard,
  STORYBOARD_TTL_MS,
  type StoryboardRequest,
  type StoryboardOutcome,
} from './services/storyboardRun'
import InputPanel from './components/InputPanel'
import ImportPromptsModal from './components/ImportPromptsModal'
import type { ImportContext, ImportParsed } from './services/importPrompts'
import StyleModal, { type StyleSelection } from '../../components/StyleModal'
import { BROLL_STYLE_ACCENT } from '../../components/styleArt'
import RightPanel from './components/RightPanel'
import { brollHistoryMode } from './components/brollHistoryRows'
import { backfillCardState, backfillContinuousFrameState, backfillContinuousClipState } from './cardState'
import {
  editSceneLine,
  splitScene,
  mergeSceneWithNext,
  deleteScene,
  type ContinuousBundle,
  type ContinuousStoryboardOp,
} from './continuousEdits'
import { useSettingsStore } from '../../stores/settingsStore'
import { useFeatureEnabled } from '../../stores/appVisibilityStore'
import { getModel } from '../../utils/models'
import BankPicker from '../../components/BankPicker'
import { usePersistedState, useProjectScopedKey } from '../../hooks/usePersistedState'
import { humanizeError } from '../../utils/friendlyError'
import { fileToDataUri } from '../../utils/kie'
import { getAsBase64, isAssetRef } from '../../utils/assetStore'
import { swapQuotedLine, swapScriptLine } from './services/scriptLineEdit'

type PickerMode = 'products' | 'models' | 'scripts' | 'styleRefs' | null

// Guards both the inter-app payload (untyped `data`) and the persisted slot,
// so a stale or hand-edited localStorage entry can't put a half-built blueprint
// into the storyboard prompt.
function isAdBlueprint(raw: unknown): raw is AdBlueprintPayload {
  if (!raw || typeof raw !== 'object') return false
  const b = raw as Partial<AdBlueprintPayload>
  return typeof b.title === 'string' && typeof b.script === 'string' && !!b.staging?.trim()
}

// The raw mode slot, read straight out of localStorage. `usePersistedState`'s
// sanitize only sees its OWN value, and the delivery toggle needs this one: a
// member left mid-session while Dialogue was briefly its own mode has
// `:mode === 'dialogue'` and a `:lineDelivery` that predates it, so reading the
// mode back is the only way they reopen in Dialogue Clips rather than silently
// losing the delivery they were working in.
function readPersistedMode(baseKey: string): string {
  try {
    return String(JSON.parse(localStorage.getItem(`${baseKey}:mode`) ?? '""'))
  } catch {
    return ''
  }
}

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

  // Latest result, readable from stable useCallback handlers that must not
  // take `result` as a dep (that would re-render every memoized card row).
  const resultRef = useRef(result)
  useEffect(() => { resultRef.current = result }, [result])

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

  // ── Mode ─────────────────────────────────────────────────────
  // 'line' | 'continuous'. Dialogue rode here as a third mode for a while;
  // sanitizeBrollMode folds that value (and the retired 'oneshot') back onto
  // Line-by-Line, with the delivery recovered by the toggle below.
  const [storedMode, setMode] = usePersistedState<BrollMode>(`${baseKey}:mode`, 'line', {
    sanitize: sanitizeBrollMode,
  })
  // Continuous is opt-in (Settings → Experimental) and ships off. Switching it
  // off HOLDS the app in Line-by-Line rather than rewriting what's on disk: the
  // stored mode, the keyframe chain and its history rows are all left exactly
  // as they are, so switching it back on reopens the session that was there.
  // Everything downstream reads this one derived value, so a single gate here
  // covers the toggle, the right panel, Generate and the import modal at once.
  const continuousEnabled = useFeatureEnabled('broll-continuous')
  const mode: BrollMode = continuousEnabled ? storedMode : 'line'
  // Line-by-Line delivery: 'dialogue' (every card the character speaking that
  // line, staged three different ways — THE DEFAULT since August 2026) or
  // 'silent' (every card silent b-roll, for a voiceover laid over in the edit).
  // Not a mode: both produce the same per-line storyboard.
  const [lineDelivery, setLineDelivery] = usePersistedState<BrollDelivery>(
    `${baseKey}:lineDelivery`,
    'dialogue',
    // `sanitize` runs on the fallback too when the slot is empty, so flipping
    // the default means flipping this — it decides what an ABSENT value means.
    // Only an explicit stored 'silent' stays silent (a member who picked B-Roll
    // Clips keeps it); anything missing or unrecognised lands on dialogue. The
    // mode check still wins: a member sitting in the short-lived Dialogue *mode*
    // has that in the mode slot and a stale delivery in this one.
    {
      sanitize: (raw) =>
        readPersistedMode(baseKey) === 'dialogue' ? 'dialogue' : raw === 'silent' ? 'silent' : 'dialogue',
    },
  )

  // ── Scene staging ──────────────────────────────────────────────
  // B-Roll had an Ad Format pick (Scripts' Formats + Structures list) that
  // staged the shots. Both it and the state behind it are gone (July 2026):
  // once the words stopped being written here, the format was only a label the
  // member had to set before Generate would light up, and leaving the state
  // without its picker would have meant a persisted format quietly staging
  // every shot with nothing on screen to see or change it.
  //
  // Staging now has exactly one source: an analysed ad handed over by the Ad
  // Analyzer. `sceneStagingFor` and `BrollInput.sceneStaging` are untouched, so
  // restoring the picker is re-adding a row, not rebuilding the seam.
  // A storyboard staged on an analysed ad, handed over from the Ad Analyzer
  // ("Clone this with my product"). It answers the same question the Ad Format
  // row answers — how is this shot — so it OCCUPIES that row rather than adding
  // a competing one, and it supplies the staging in the format's place. The
  // title is what the row displays; without it the row would read "Standard
  // UGC" while a blueprint quietly drove the shots.
  const [adBlueprint, setAdBlueprint] = usePersistedState<AdBlueprintPayload | null>(
    `${baseKey}:adBlueprint`,
    null,
    { sanitize: (raw) => (isAdBlueprint(raw) ? raw : null) },
  )

  // Undefined unless an analysed ad is driving this session. Shared by both
  // storyboard calls.
  const sceneStaging = adBlueprint?.staging

  // ── Continuous mode (keyframe chain) state ─────────────────────
  // Until the user actively picks a style, the look falls back to a mode-
  // specific default: UGC Realism for Line-by-Line, 3D Animated for
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
  // Identity of the custom style, when it has one: the Styles-bank row it came
  // from (so the popup can show which card is selected) and its display name
  // (so the trigger and the history pill read "Warm 90s Camcorder", not
  // "Custom style"). Both null for a one-off brief that was never named.
  const [continuousStyleBankId, setContinuousStyleBankId] = usePersistedState<string | null>(`${baseKey}:continuousStyleBankId`, null)
  const [continuousStyleName, setContinuousStyleName] = usePersistedState<string | null>(`${baseKey}:continuousStyleName`, null)
  const [styleModalOpen, setStyleModalOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
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

  // The storyboard this workspace is waiting on. Persisted, because the run
  // outlives the page: the call goes through kie's task transport where the
  // picked writer model has one, so a reload re-attaches to it (see
  // services/storyboardRun.ts) instead of losing a call already billed for.
  // The row itself carries the state — this is only which row is OURS.
  const [pendingStoryboardId, setPendingStoryboardId] = usePersistedState<string>(
    `${baseKey}:pendingStoryboard`,
    '',
  )
  const pendingStoryboardRow = useBankStore((s) => s.brollHistory.find((r) => r.id === pendingStoryboardId))
  const pendingIdRef = useRef(pendingStoryboardId)
  useEffect(() => { pendingIdRef.current = pendingStoryboardId }, [pendingStoryboardId])
  // Writing the prompts, whether this page fired the call or inherited it. An
  // errored row stops counting immediately; the row is written before the id is
  // set, so an id with no row yet is the tick between the two.
  const isGenerating = !!pendingStoryboardId && pendingStoryboardRow?.storyboardStatus !== 'error'
  // Deleting the row mid-write cancels it — nothing left to wait for.
  useEffect(() => {
    if (pendingStoryboardId && !pendingStoryboardRow) setPendingStoryboardId('')
  }, [pendingStoryboardId, pendingStoryboardRow, setPendingStoryboardId])
  // Guards the microtask between the click and the row landing, so a double
  // click can't fire two storyboards. Never disables the button (app rule).
  const startingStoryboardRef = useRef(false)

  // Phone-only: which of the two panes is on screen (ignored from md up).
  const [pane, setPane] = useState<'input' | 'output'>('input')
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

  // Which mode the CURRENT session was generated in. The workspace can hold a
  // result per mode at once, but a history row represents ONE generation, so
  // the snapshot below is scoped to this. Without it a fresh row also carried
  // the previous session's sibling result — misfiling the row's badge, cover
  // and scene count (brollHistoryMode prioritises continuous > oneshot > line),
  // restoring stale content on click, and re-copying that payload into every
  // subsequent row. Sessions already in progress when this shipped have no
  // stored value, so the default derives it from what the workspace holds —
  // same precedence as the history badge — and their row keeps updating.
  const [sessionMode, setSessionMode] = usePersistedState<BrollMode>(
    `${baseKey}:sessionMode`,
    continuousResult ? 'continuous' : 'line',
    { sanitize: sanitizeBrollMode },
  )
  // And which delivery it ran with, stamped at Generate for the same reason:
  // the toggle above is live, so reading it in the snapshot would let a flip
  // made after the run rewrite what a finished session says it is.
  const [sessionDelivery, setSessionDelivery] = usePersistedState<BrollDelivery>(
    `${baseKey}:sessionDelivery`,
    'silent',
  )

  // The style the CURRENT session's content was actually generated with —
  // stamped at Generate, restored from the row on history select. The history
  // snapshot reads these, never the live panel: `resolvedStyleId` folds in a
  // mode-dependent default, so snapshotting it let a bare mode-toggle rewrite
  // the saved row's style, and the brief was clobbered to undefined whenever a
  // custom-style row was opened without one loaded in the panel.
  const [sessionStyleId, setSessionStyleId] = usePersistedState<string>(`${baseKey}:sessionStyleId`, '')
  const [sessionStyleBrief, setSessionStyleBrief] = usePersistedState<string | null>(`${baseKey}:sessionStyleBrief`, null)
  const [sessionStyleName, setSessionStyleName] = usePersistedState<string | null>(`${baseKey}:sessionStyleName`, null)

  // Stamp the style onto the session about to be generated. Called from all
  // four generate paths so a row can't record one field without the others.
  const stampSessionStyle = () => {
    setSessionStyleId(resolvedStyleId)
    setSessionStyleBrief(continuousStyleBrief)
    setSessionStyleName(continuousStyleName)
  }

  // Active history row in the History tab — highlights the row that's
  // currently being edited / restored.
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(sessionId || null)
  useEffect(() => { setActiveHistoryId(sessionId || null) }, [sessionId])

  // Canvas-clear state for the right panel, owned here because BOTH the panel's
  // + and the left column's "New" empty it. It's a view state, not a delete:
  // the signature is keyed to the storyboard that was cleared, so the next
  // generation (or a history pick) fills the panel again on its own.
  const [clearedCanvasSig, setClearedCanvasSig] = useState<string | null>(null)
  const canvasSceneCount = mode === 'continuous'
    ? (continuousResult?.scenes.length ?? 0)
    : (result?.scenes.length ?? 0)
  const canvasSig = `${mode}|${sessionId}|${canvasSceneCount}`
  const canvasCleared = canvasSceneCount > 0 && clearedCanvasSig === canvasSig

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

    // Ad Analyzer → "Clone this with my product". The ad's transcript becomes
    // the script and its staging drives the shots; the analysed prompts stay
    // behind on purpose (see ad-anatomy/services/adBlueprint.ts).
    if (targetField === 'adBlueprint' && isAdBlueprint(data)) {
      setAdBlueprint(data)
      setScriptText(data.script)
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
    // Only this session's own mode counts — a leftover sibling result in the
    // workspace must not keep an empty row alive or leak into the snapshot.
    const sessionResult = isLineMode(sessionMode) ? result : null
    const sessionContinuous = sessionMode === 'continuous' ? continuousResult : null
    if ((!sessionResult && !sessionContinuous) || !sessionIdRef.current) return
    const handle = setTimeout(() => {
      // A row's identity fields describe the session that PRODUCED the content,
      // so an empty input never overwrites one that's already stamped: clearing
      // the input column ("New") would otherwise re-save this row with no
      // product or script and rename it "Untitled session" — losing the label
      // on work that hasn't changed. Swapping one product for another still
      // updates the row; only emptying leaves the stamp alone.
      const prev = useBankStore.getState().brollHistory.find((r) => r.id === sessionIdRef.current)
      const rowProductId = selectedProductId ?? prev?.productId
      const rowScriptText = scriptText || prev?.scriptText || ''
      const rowProductName = selectedProduct?.productName
        ?? (rowProductId ? products.find((p) => p.id === rowProductId)?.productName : undefined)
      const item: BrollHistoryItem = {
        id: sessionIdRef.current,
        // Candidate creation time — only applied to a brand-new row; the store
        // preserves the original `createdAt` on every subsequent save.
        createdAt: Date.now(),
        // Row-level style snapshot for the history pill (works across both
        // modes), stamped at generation time so a later mode-toggle can't
        // rewrite it.
        styleId: sessionStyleId || undefined,
        styleBrief: sessionStyleBrief ?? undefined,
        styleName: sessionStyleName ?? undefined,
        inputSummary: buildInputSummary(rowProductName, rowScriptText),
        productId: rowProductId,
        modelId: selectedModelId ?? prev?.modelId,
        scriptId: selectedScriptId ?? prev?.scriptId,
        scriptText: rowScriptText || undefined,
        context: additionalContext || prev?.context,
        result: sessionResult ?? { scenes: [] },
        cardStates: sessionResult ? cardStates : {},
        mode: sessionMode,
        lineDelivery: sessionResult ? sessionDelivery : undefined,
        continuousResult: sessionContinuous ?? undefined,
        continuousFrameStates: sessionContinuous && Object.keys(continuousFrameStates).length > 0 ? continuousFrameStates : undefined,
        continuousClipStates: sessionContinuous && Object.keys(continuousClipStates).length > 0 ? continuousClipStates : undefined,
        continuousSelections: sessionContinuous && Object.keys(continuousSelections).length > 0 ? continuousSelections : undefined,
        continuousStyleId: sessionContinuous ? continuousStyleId : undefined,
        continuousModelId: sessionContinuous ? continuousModelId : undefined,
      }
      upsertBrollHistory(item)
    }, 1000)
    return () => clearTimeout(handle)
  }, [result, cardStates, sessionDelivery, continuousResult, continuousFrameStates, continuousClipStates, continuousSelections, continuousStyleId, sessionStyleId, sessionStyleBrief, sessionStyleName, continuousModelId, sessionMode, selectedProductId, selectedModelId, selectedScriptId, scriptText, additionalContext, selectedProduct, products, upsertBrollHistory])

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
    const scene = resultRef.current?.scenes.find((s) => s.number === sceneNumber)
    const removedIndex = scene?.variations.findIndex((v) => v.id === variationId) ?? -1
    if (removedIndex === -1) return

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
    // Card state is keyed positionally (`${sceneNumber}-${index}`), so deleting
    // a card shifts every later one down a slot. Without re-keying, each of
    // those cards would inherit its old neighbour's state, fail the rebuild
    // effect's prompt match, and reset to blank — losing already-paid images
    // and videos (and orphaning their in-flight tasks).
    setCardStates((prev) => {
      const next: Record<string, CardState> = {}
      for (const [key, card] of Object.entries(prev)) {
        const dash = key.lastIndexOf('-')
        const keyScene = Number(key.slice(0, dash))
        const index = Number(key.slice(dash + 1))
        if (keyScene !== sceneNumber || index < removedIndex) {
          next[key] = card
          continue
        }
        if (index === removedIndex) continue
        next[`${sceneNumber}-${index - 1}`] = card
      }
      return next
    })
  }, [setResult, setCardStates])

  // Edit the ad's shared dialogue voice profile (from a dialogue card's modal).
  // One value on the result, applied to every DIALOGUE clip at fire time.
  const handleUpdateVoiceProfile = useCallback((text: string) => {
    setResult((prev) => (prev ? { ...prev, voiceProfile: text } : prev))
  }, [setResult])

  // Retype a scene's spoken line. Free and instant: a dialogue prompt embeds
  // the line verbatim in quotes, so the new words are swapped straight into
  // every prompt of that scene and everything else about the shot survives.
  // See services/scriptLineEdit.ts for why this isn't a regeneration.
  //
  // Four places hold a copy of the line and all four move together, or the
  // card renders one sentence while the header shows another:
  //   1. the scene itself (the header, and what a regen is briefed from)
  //   2. each variation's original prompt AND its motion — a dialogue motion
  //      quotes the line too, since it's the whole prompt an animated clip
  //      fires with, so a motion left behind makes the clip say the old words
  //   3. each card's editablePrompt — the one that actually gets generated
  //   4. each card's animateMotion — the same, for the clip
  const handleEditSceneLine = useCallback((sceneNumber: number, nextLine: string) => {
    const line = nextLine.trim()
    if (!line) return
    // Read the old line before touching anything: the updaters have to stay
    // pure, and all three of them need the same value. Through the ref so this
    // callback stays stable and doesn't re-render every memoized card row.
    const previousLine = resultRef.current?.scenes.find((s) => s.number === sceneNumber)?.scriptLine ?? ''
    if (!previousLine || previousLine.trim() === line) return
    setResult((prev) => prev && ({
      ...prev,
      scenes: prev.scenes.map((s) =>
        s.number === sceneNumber
          ? {
              ...s,
              scriptLine: line,
              variations: s.variations.map((v) => ({
                ...v,
                prompt: swapQuotedLine(v.prompt, previousLine, line),
                ...(v.motionPrompt
                  ? { motionPrompt: swapQuotedLine(v.motionPrompt, previousLine, line) }
                  : {}),
              })),
            }
          : s,
      ),
    }))
    setCardStates((prev) => {
      const next: Record<string, CardState> = {}
      let changed = false
      for (const [key, card] of Object.entries(prev)) {
        // Positional key: `${sceneNumber}-${index}`.
        const keyScene = Number(key.slice(0, key.lastIndexOf('-')))
        const isThisScene = keyScene === sceneNumber
        const swapped = isThisScene
          ? swapQuotedLine(card.editablePrompt, previousLine, line)
          : card.editablePrompt
        // The motion is a second prompt with its own copy of the words on a
        // dialogue card, and it's the one an animated clip actually speaks.
        const swappedMotion = isThisScene
          ? swapQuotedLine(card.animateMotion, previousLine, line)
          : card.animateMotion
        if (swapped !== card.editablePrompt || swappedMotion !== card.animateMotion) {
          changed = true
          // Deliberately NOT pushed onto promptHistory. Undo is for rewrites of
          // the shot; the line has its own editor, and burying a line change in
          // the prompt undo stack would let Undo desync the prompt from the
          // scene header it's supposed to be speaking.
          next[key] = { ...card, editablePrompt: swapped, animateMotion: swappedMotion }
        } else {
          next[key] = card
        }
      }
      return changed ? next : prev
    })
    // Keep the panel's script honest when the line is one of its lines. It
    // often isn't — the storyboard may have split a sentence — and the helper
    // no-ops rather than guessing.
    setScriptText((prev) => swapScriptLine(prev, previousLine, line))
  }, [setResult, setCardStates, setScriptText])

  const handleOpenCharacterPicker = useCallback(() => setPickerMode('models'), [])
  const handleOpenProductPicker = useCallback(() => setPickerMode('products'), [])

  // Build context strings and reference images from selected bank items
  // Labelled per field rather than one flat sentence, because every consumer of
  // this string turns it into a PICTURE — see buildProductContext.
  const productContext = buildProductContext(selectedProduct)
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
  // Every photo the bank holds for this product, hero first: the packshot plus
  // the extra angles (box open, bar out of the wrapper, the label). The
  // storyboard sees all of them and names the ONE each shot needs, and the card
  // attaches that one — see productRefsForSelection. Attaching them all is what
  // put two bars in a shot of someone eating one.
  const productPhotos = useMemo<string[]>(
    () => productPhotosOf(selectedProduct),
    [selectedProduct],
  )
  const productPhotoRefs = useMemo<ReferenceImage[]>(
    () => productPhotos.map((dataUrl) => ({ dataUrl, label: 'product' })),
    [productPhotos],
  )
  // Combined ref bundle passed to the scene-generation LLM call — gives it
  // visibility into which reference images the user has selected so it can
  // emit sensible <REFS> tags per variation.
  const referenceImages: ReferenceImage[] = [
    ...(characterRef ? [characterRef] : []),
    ...(productRef ? [productRef] : []),
  ]

  // ── The storyboard call, as a job ──────────────────────────────────────
  // It writes its history row FIRST and hands the run to storyboardRun.ts, so
  // the session is visible in History from the press (like every other
  // generation surface in the app) and survives a reload where the picked
  // writer model has a kie job route.

  // The row for a storyboard that hasn't been written yet. It carries
  // everything the RESPONSE is parsed against — delivery, style, and the video
  // model whose ladder scene lengths snap to — as well as the identity fields
  // the card shows, so it reads right while it writes and parses right even if
  // it lands after a reload, when the panel may have moved on.
  const buildPendingRow = (id: string, rowMode: BrollMode): BrollHistoryItem => ({
    id,
    createdAt: Date.now(),
    inputSummary: buildInputSummary(selectedProduct?.productName, scriptText),
    productId: selectedProductId ?? undefined,
    modelId: selectedModelId ?? undefined,
    scriptId: selectedScriptId ?? undefined,
    scriptText: scriptText || undefined,
    context: additionalContext || undefined,
    styleId: resolvedStyleId || undefined,
    styleBrief: continuousStyleBrief ?? undefined,
    styleName: continuousStyleName ?? undefined,
    result: { scenes: [] },
    cardStates: {},
    mode: rowMode,
    lineDelivery: rowMode === 'line' ? lineDelivery : undefined,
    continuousStyleId: rowMode === 'continuous' ? resolvedStyleId : undefined,
    continuousModelId: rowMode === 'continuous' ? continuousModelId : undefined,
    storyboardStatus: 'writing',
  })

  // Write the row, then fire the call — in that order, so the taskId has
  // somewhere to land the moment kie hands one back.
  //
  // The workspace is deliberately NOT touched here. The old storyboard stays on
  // the canvas until a new one exists, which is the same commit discipline the
  // awaited version had: rotating the session up front left a failed call
  // showing the previous scenes stripped of every image. `adoptStoryboard`
  // swaps it over on success.
  const launchStoryboard = async (rowMode: BrollMode, req: StoryboardRequest) => {
    // Checked before the row is written: a missing key is a failure we can see
    // coming, and it has no business leaving a dead session in History.
    if (!useSettingsStore.getState().kieApiKey) {
      const msg = 'Add your kie.ai key in Settings to generate a storyboard.'
      setError(msg)
      useAppStore.getState().addToast(msg, 'info')
      return
    }
    const rowId = newSessionId()
    await upsertBrollHistory(buildPendingRow(rowId, rowMode))
    setPendingStoryboardId(rowId)
    startStoryboard(rowId, req)
  }

  // Where a finished storyboard lands in the workspace — ONE path, whether the
  // call finished in this page load or was resumed after a reload. Everything
  // is read off the row rather than the panel: the row stamped the delivery and
  // style at Generate, and either may have been changed while it wrote.
  // `warning` is a storyboard that landed but stopped short of the end of the
  // script. It REPLACES the ready toast rather than following it: two toasts
  // where the first says "ready" is how a member reads past the one that
  // matters and finds the missing half by scrolling.
  const adoptStoryboard = (row: BrollHistoryItem, warning?: string) => {
    const rowMode = brollHistoryMode(row)
    setSessionId(row.id)
    setSessionMode(rowMode)
    setMode(rowMode)
    setSessionStyleId(row.styleId ?? '')
    setSessionStyleBrief(row.styleBrief ?? null)
    setSessionStyleName(row.styleName ?? null)
    if (rowMode === 'continuous') {
      setContinuousFrameStates({})
      setContinuousClipStates({})
      setContinuousSelections({})
      setContinuousResult((row.continuousResult as ContinuousResult | undefined) ?? null)
      useAppStore.getState().addToast(
        warning ?? 'Storyboard ready — pick a keyframe per frame, then animate',
        warning ? 'error' : 'success',
      )
      return
    }
    const delivery = row.lineDelivery ?? 'silent'
    setSessionDelivery(delivery)
    setCardStates({})
    setResult((row.result as BrollResult | null) ?? null)
    useAppStore.getState().addToast(
      warning ?? (delivery === 'dialogue' ? 'Dialogue scenes ready' : 'B-roll scenes ready'),
      warning ? 'error' : 'success',
    )
  }

  const handleStoryboardSettled = (rowId: string, outcome: StoryboardOutcome) => {
    // Somebody else's row (another tab, or one this workspace already handed
    // over) — the row itself carries its own state either way.
    if (rowId !== pendingIdRef.current) return
    setPendingStoryboardId('')
    if (outcome.ok) {
      const row = useBankStore.getState().brollHistory.find((r) => r.id === rowId)
      if (row) adoptStoryboard(row, outcome.warning)
      return
    }
    // A null message means the row was deleted while it wrote — that's the
    // member cancelling, and there's nothing to tell them.
    if (!outcome.error) return
    setError(outcome.error)
    useAppStore.getState().addToast(outcome.error, 'error')
  }

  // One subscription for the app's whole lifetime, routed through a ref: the
  // job that settles may have been started by a previous page load, and the
  // handler closes over state that changes every render.
  const settledRef = useRef(handleStoryboardSettled)
  useEffect(() => { settledRef.current = handleStoryboardSettled })
  useEffect(() => onStoryboardSettled((rowId, outcome) => settledRef.current(rowId, outcome)), [])

  // Storyboards left 'writing' by a previous page load: re-attach kie's task
  // where there is one, and strand the rest rather than leaving a row pulsing
  // for a call that died with its page. Both helpers consult the live job
  // registry, so a StrictMode double-mount can't strand a run it just started.
  useEffect(() => {
    const now = Date.now()
    for (const row of useBankStore.getState().brollHistory) {
      if (row.storyboardStatus !== 'writing') continue
      if (resumeStoryboard(row)) continue
      if (!isStoryboardStranded(row, now)) continue
      // A row synced from another browser may still be writing over there, so
      // only its age can condemn it. Our own we know is dead.
      const mine = row.id === pendingIdRef.current
      if (!mine && now - (row.updatedAt ?? row.createdAt) <= STORYBOARD_TTL_MS) continue
      void strandStoryboard(
        row.id,
        mine
          ? 'The page reloaded before kie picked the storyboard up, so it never ran. Generate it again.'
          : 'This storyboard never finished writing. Generate it again.',
      )
    }
  }, [])

  const handleGenerateContinuous = async (script: string) => {
    // No kie.ai key yet → show the sample storyboard so the member sees what
    // Continuous mode produces before wiring billing.
    if (!useSettingsStore.getState().kieApiKey) {
      setSessionId(newSessionId())
      setSessionMode('continuous')
      stampSessionStyle()
      setContinuousFrameStates({})
      setContinuousClipStates({})
      setContinuousSelections({})
      setContinuousResult(buildDemoContinuousResult(continuousModelId, resolvedStyleId))
      useAppStore.getState().addToast('Showing a sample storyboard — add your kie.ai key to storyboard your own script', 'info')
      return
    }
    setError(null)
    await launchStoryboard('continuous', {
      mode: 'continuous',
      input: {
        scriptText: script,
        styleId: resolvedStyleId,
        styleBrief: continuousStyleBrief ?? undefined,
        modelId: continuousModelId,
        productContext,
        modelContext,
        additionalContext,
        productPhotos: productPhotoRefs,
        sceneStaging,
      },
    })
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

  // Runs the vision pass and HANDS BACK the paragraph rather than applying it.
  // The popup shows it for editing/naming first — nothing is committed to the
  // session (or the bank) until the user picks Use or Save there.
  const handleAnalyzeStyleRefs = async (): Promise<string | null> => {
    if (styleRefs.length === 0 || isAnalyzingStyle) return null
    if (!useSettingsStore.getState().kieApiKey) {
      useAppStore.getState().addToast('Add your kie.ai key in Settings to analyze a reference style', 'info')
      return null
    }
    setIsAnalyzingStyle(true)
    try {
      return await analyzeStyleReferences(styleRefs)
    } catch (err) {
      const msg = humanizeError(err, 'Could not read the style from those images.')
      useAppStore.getState().addToast(msg, 'error')
      return null
    } finally {
      setIsAnalyzingStyle(false)
    }
  }

  // Re-style the session that's already on screen: same storyboard, new look.
  //
  // The style block rides OUTSIDE the editable card prompts (it's appended at
  // fire time), so switching looks costs nothing but a re-render — which is the
  // whole point: shoot the ad you liked again in claymation. Only the result's
  // style stamp moves; every prompt, reference and pick stays exactly as it is,
  // and the media already generated stays too (the member regenerates whatever
  // they want in the new look).
  //
  // It also re-stamps the session, so the history row's style pill names the
  // look the cards would render in now rather than the one they were storyboarded
  // with. No-ops when there's nothing generated yet.
  const restyleSession = (styleId: string, brief: string | null, name: string | null) => {
    if (!result && !continuousResult) return
    const trimmedBrief = brief?.trim() || undefined
    const style = styleBriefFor({ styleId, styleBrief: trimmedBrief })
    const realism = styleUsesRealism(styleId, !!trimmedBrief)
    setSessionStyleId(styleId)
    setSessionStyleBrief(brief)
    setSessionStyleName(name)
    setResult((prev) => (prev ? {
      ...prev,
      style,
      realism,
      styleId,
      styleBrief: trimmedBrief,
      styleName: trimmedBrief ? name?.trim() || undefined : undefined,
    } : prev))
    setContinuousResult((prev) => (prev ? { ...prev, style, realism, styleId } : prev))
    useAppStore.getState().addToast('Style updated — regenerate any card to render it in the new look', 'success')
  }

  // A preset and a custom brief are mutually exclusive — picking either clears
  // the other, so `styleBriefFor` never has to arbitrate between them.
  const handlePickPresetStyle = (id: string) => {
    chooseStyle(id)
    setContinuousStyleBrief(null)
    setContinuousStyleBankId(null)
    setContinuousStyleName(null)
    restyleSession(id, null, null)
  }

  const handleUseCustomStyle = ({ brief, name, bankId }: StyleSelection) => {
    setContinuousStyleBrief(brief)
    setContinuousStyleName(name)
    setContinuousStyleBankId(bankId)
    // A custom brief only exists because the user built or picked one — that's
    // as explicit a choice as tapping a preset.
    setStyleChosen(true)
    restyleSession(resolvedStyleId, brief, name)
  }

  // A look can no longer be CLEARED, only swapped: with the left panel's row
  // gone there is no empty state to return to — an unpicked session simply
  // renders in the mode's default (UGC Realism / 3D Animated), which is a look
  // like any other. `handleClearStyle` came out with the row.

  // What the storyboard's caption pill and the import popup call the look.
  const styleLabel = continuousStyleBrief?.trim()
    ? continuousStyleName?.trim() || 'Custom style'
    : getContinuousStyle(resolvedStyleId).label

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

  // Structural storyboard edits (edit line / split / merge / delete). The pure
  // operations live in continuousEdits.ts; this applies whichever one the view
  // asked for across all four pieces of state at once, since the frame cards,
  // clip cards and keyframe picks are all keyed by scene/frame POSITION and a
  // partial apply would silently mis-key them against the new plan.
  const handleEditContinuousStoryboard = useCallback((op: ContinuousStoryboardOp) => {
    if (!continuousResult) return
    const bundle: ContinuousBundle = {
      result: continuousResult,
      frameStates: continuousFrameStates,
      clipStates: continuousClipStates,
      selections: continuousSelections,
    }
    const next =
      op.kind === 'edit' ? editSceneLine(bundle, op.sceneIndex, op.line)
      : op.kind === 'split' ? splitScene(bundle, op.sceneIndex, op.at)
      : op.kind === 'merge' ? mergeSceneWithNext(bundle, op.sceneIndex)
      : deleteScene(bundle, op.sceneIndex)
    if (!next) {
      useAppStore.getState().addToast("That edit doesn't apply to this scene.", 'error')
      return
    }
    setContinuousResult(next.result)
    setContinuousFrameStates(next.frameStates)
    setContinuousClipStates(next.clipStates)
    setContinuousSelections(next.selections)
  }, [
    continuousResult, continuousFrameStates, continuousClipStates, continuousSelections,
    setContinuousResult, setContinuousFrameStates, setContinuousClipStates, setContinuousSelections,
  ])

  // ── Import prompts ───────────────────────────────────────────
  // Everything a Generate would have fed the LLM, handed to the importer so a
  // pasted storyboard resolves style / delivery / model exactly like a live one.
  const importContext: ImportContext = {
    scriptText,
    productContext,
    modelContext,
    additionalContext,
    styleId: resolvedStyleId,
    styleBrief: continuousStyleBrief ?? undefined,
    styleName: continuousStyleName ?? undefined,
    lineDelivery,
    continuousModelId,
    productPhotoCount: productPhotos.length,
  }

  // Commit a parsed import as if it had just been generated: fresh session,
  // cleared card states, style stamped. The views rebuild their cards off the
  // new result, so nothing else has to know an import happened.
  const handleImportPrompts = (parsed: ImportParsed) => {
    setSessionId(newSessionId())
    setSessionMode(parsed.mode)
    setSessionDelivery(lineDelivery)
    stampSessionStyle()
    // Recover the script from the storyboard when the panel's box is empty —
    // it names the history row and backs the scene editors. Never clobbers a
    // script the user actually pasted.
    if (!scriptText.trim() && parsed.recoveredScript.trim()) {
      setScriptText(parsed.recoveredScript.trim())
      setSelectedScriptId(null)
    }
    if (isLineMode(parsed.mode)) {
      setCardStates({})
      setResult(parsed.lineResult ?? null)
    } else {
      setContinuousFrameStates({})
      setContinuousClipStates({})
      setContinuousSelections({})
      setContinuousResult(parsed.continuousResult ?? null)
    }
    useAppStore.getState().addToast(`Imported ${parsed.summary}`, 'success')
  }

  const handleGenerateLine = async (script: string) => {
    setError(null)
    await launchStoryboard('line', {
      mode: 'line',
      input: {
        productId: selectedProduct?.id ?? null,
        modelId: selectedModel?.id ?? null,
        scriptId: selectedScript?.id ?? null,
        scriptText: script,
        additionalContext,
        productContext,
        modelContext,
        referenceImages,
        productPhotos: productPhotoRefs,
        styleId: resolvedStyleId,
        styleBrief: continuousStyleBrief ?? undefined,
        styleName: continuousStyleName ?? undefined,
        delivery: lineDelivery,
        sceneStaging,
      },
    })
  }

  // The one Generate: storyboard the script in whichever mode is active.
  //
  // B-Roll used to write the script too when the box was empty — a second
  // chained chat call behind the same click, sized by a length toggle under the
  // Ad Format row. That is gone (July 2026): writing a script is Scripts' job,
  // it has the modes, the angles and the takes to do it properly, and a
  // one-take copy living here was a second thing to keep in step with no way to
  // compare what came back. Bring a script; the Ad Format row keeps its real
  // job, which is deciding how the ad gets SHOT.
  const handleGenerate = async () => {
    if (isGenerating || startingStoryboardRef.current) return
    const script = scriptText.trim()
    if (!script) return
    // On a phone only one pane is on screen — follow the run to the storyboard.
    setPane('output')
    startingStoryboardRef.current = true
    if (mode === 'continuous') await handleGenerateContinuous(script)
    else await handleGenerateLine(script)
    startingStoryboardRef.current = false
  }

  // Adopt a restored row's video model. These keys are the user's persistent
  // per-app picks, so a change outlives the session being opened — announce it
  // instead of letting a history click quietly redefine their default.
  const restoreAppModel = (key: string, modelId: string) => {
    const settings = useSettingsStore.getState()
    if (settings.perAppModel[key] === modelId) return
    settings.setAppModel(key, modelId)
    useAppStore.getState().addToast(
      `Video model set to ${getModel(modelId)?.displayName ?? modelId} to match this session`,
      'info',
    )
  }

  // Restore a B-Roll session from history. Loads all inputs + result +
  // cardStates back into the workspace. Images/videos resume from their
  // asset:// refs (IndexedDB / R2). Sets sessionId so further edits update
  // the same history row instead of forking a new one.
  const handleSelectHistory = (item: BrollHistoryItem) => {
    // A row that is still writing its storyboard — or died trying — holds
    // nothing to restore, and loading it would empty the workspace. The card
    // isn't clickable either; this is the guard behind it.
    if (item.storyboardStatus) return
    setSessionId(item.id)
    setSelectedProductId(item.productId ?? null)
    setSelectedModelId(item.modelId ?? null)
    setSelectedScriptId(item.scriptId ?? null)
    setScriptText(item.scriptText ?? '')
    setAdditionalContext(item.context ?? '')
    // A row generated in another mode stores a placeholder `{ scenes: [] }` —
    // restore that as null so line mode shows its empty state, not a blank grid.
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
    const rowMode = brollHistoryMode(item)
    setMode(rowMode)
    // Further edits keep updating this row as the mode + delivery it actually is.
    setSessionMode(rowMode)
    setSessionDelivery(item.lineDelivery ?? 'silent')

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

    // Restore the row's style snapshot into BOTH the session stamp (what the
    // next upsert writes back) and the live panel. Skipping this let the
    // debounced upsert overwrite the row ~1s after opening it with whatever
    // the panel happened to hold — permanently losing a custom style brief.
    const rowStyleId = item.continuousStyleId ?? item.styleId ?? ''
    setSessionStyleId(rowStyleId)
    setSessionStyleBrief(item.styleBrief ?? null)
    setSessionStyleName(item.styleName ?? null)
    setContinuousStyleBrief(item.styleBrief ?? null)
    setContinuousStyleName(item.styleName ?? null)
    // The row records the style's name, not which bank entry it came from, so
    // a restored session shows the name without claiming a saved-card selection
    // (the entry may since have been renamed or deleted).
    setContinuousStyleBankId(null)
    if (rowStyleId) {
      setContinuousStyleId(rowStyleId)
      setStyleChosen(true)
    } else {
      setContinuousStyleId('')
      setStyleChosen(false)
    }
    if (rowMode === 'continuous' && item.continuousModelId) {
      restoreAppModel('broll-studio:continuous:video', item.continuousModelId)
    }
    setActiveHistoryId(item.id)
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      <MobilePaneTabs
        options={[
          { value: 'input', label: 'Setup', icon: SlidersHorizontal },
          { value: 'output', label: 'Storyboard', icon: Film },
        ]}
        value={pane}
        onChange={setPane}
        accent="broll"
      />

      {/* Left panel — inputs */}
      <div className={paneClass(pane === 'input', 'md:w-[30%] md:shrink-0 md:border-r md:border-ink/5')}>
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
          onImportPrompts={() => setImportModalOpen(true)}
          isGenerating={isGenerating}
          highlightField={highlightField}
          mode={mode}
          onModeChange={setMode}
          showModeToggle={continuousEnabled}
          lineDelivery={lineDelivery}
          onLineDeliveryChange={setLineDelivery}
        />
      </div>

      {/* Right panel — output */}
      <div className={paneClass(pane === 'output', 'md:w-[70%] md:overflow-hidden')}>
        <RightPanel
          mode={mode}
          continuousEnabled={continuousEnabled}
          result={result}
          continuousResult={continuousResult}
          continuousModelId={continuousModelId}
          continuousFrameStates={continuousFrameStates}
          setContinuousFrameStates={setContinuousFrameStates}
          continuousClipStates={continuousClipStates}
          setContinuousClipStates={setContinuousClipStates}
          continuousSelections={continuousSelections}
          setContinuousSelections={setContinuousSelections}
          onAddContinuousConcept={handleAddContinuousConcept}
          onEditContinuousStoryboard={handleEditContinuousStoryboard}
          isGenerating={isGenerating}
          error={error}
          onAddVariation={handleAddVariation}
          onDeleteVariation={handleDeleteVariation}
          onEditSceneLine={handleEditSceneLine}
          onUpdateVoiceProfile={handleUpdateVoiceProfile}
          characterRef={characterRef}
          productRef={productRef}
          productPhotos={productPhotos}
          onChangeStyle={() => setStyleModalOpen(true)}
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
          canvasCleared={canvasCleared}
          onClearCanvas={() => setClearedCanvasSig(canvasSig)}
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

      {/* Import prompts — bring a storyboard written outside the app (Claude
          etc.) instead of paying for the prompt-writing call. Remounted per
          open so the paste box starts empty. */}
      <ImportPromptsModal
        key={importModalOpen ? 'import-open' : 'import-closed'}
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        mode={mode}
        ctx={importContext}
        styleLabel={styleLabel}
        onImport={handleImportPrompts}
      />

      {/* Visual style slide-over — presets, the user's saved styles, and the
          analyse-from-references flow, all in one place. */}
      <StyleModal
        open={styleModalOpen}
        onClose={() => setStyleModalOpen(false)}
        // The look the session renders in, picked or defaulted — the storyboard
        // is already in it, so the picker ticks it. (It used to pass '' until a
        // pick was made, back when the left panel was still asking for one.)
        styleId={resolvedStyleId}
        styleBrief={continuousStyleBrief}
        styleBankId={continuousStyleBankId}
        onPickPreset={handlePickPresetStyle}
        onUseCustom={handleUseCustomStyle}
        styleRefs={styleRefs}
        onAddStyleRefs={(files) => { void handleAddStyleRefs(files) }}
        onRemoveStyleRef={(i) => setStyleRefs((prev) => prev.filter((_, idx) => idx !== i))}
        onClearStyleRefs={() => setStyleRefs([])}
        onPickStyleRefsFromBank={() => setPickerMode('styleRefs')}
        onAnalyze={handleAnalyzeStyleRefs}
        isAnalyzing={isAnalyzingStyle}
        accent={BROLL_STYLE_ACCENT}
      />
    </div>
  )
}
