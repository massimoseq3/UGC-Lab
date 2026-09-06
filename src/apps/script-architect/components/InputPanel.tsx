import { useState, type ComponentType } from 'react'
import { Package, PenLine, ChevronRight, FileText, Clapperboard, RefreshCw, X, Sparkles, Shuffle, FishingHook, Video, Clock, Layers } from 'lucide-react'
import type { Product, Script } from '../../../stores/types'
import { WRITE_LENGTHS, REMIX_LENGTHS, WRITE_STYLE_META, HOOK_CATEGORY_META, HOOK_COUNTS, VARIATION_COUNTS, createEditableContext, type EditableProductContext, type ScriptUiMode, type WriteStyle, type WriteFormat, type WriteLength, type RemixLength, type HookCategoryChoice, type HookCount, type VariationCount } from '../types'
import { useBankStore } from '../../../stores/bankStore'
import BankPicker from '../../../components/BankPicker'
import SegmentedToggle from '../../../components/SegmentedToggle'
import Modal from '../../../components/Modal'
import ScriptModelRow from '../../../components/ScriptModelRow'
import SectionCard, { StatusDot } from '../../../components/SectionCard'
import ConstraintChip from '../../../components/ConstraintChip'
import ExpandTextModal, { ExpandButton } from '../../../components/ExpandableText'
import PromptToolbar from '../../../components/PromptToolbar'
import { useAppStore } from '../../../stores/appStore'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { enhanceBrief } from '../services/generateScript'
import ScriptStyleList from './ScriptStyleList'
import { humanizeError } from '../../../utils/friendlyError'

interface InputPanelProps {
  mode: ScriptUiMode
  onModeChange: (mode: ScriptUiMode) => void
  // Resets the input column to a blank slate. Inputs only — generated scripts
  // stay in the Output pane and in History.
  // The merged Remix source — a plain winning transcript OR an Ad Analyzer
  // scene blueprint; the format is auto-detected (see detectSceneBlueprint).
  source: string
  onSourceChange: (value: string) => void
  isBlueprint: boolean
  // User override: remix a blueprint-shaped source as a plain script anyway.
  forceTranscript: boolean
  onForceTranscriptChange: (value: boolean) => void
  brief: string
  onBriefChange: (value: string) => void
  writeStyle: WriteStyle
  onWriteStyleChange: (value: WriteStyle) => void
  writeFormat: WriteFormat
  onWriteFormatChange: (value: WriteFormat) => void
  writeLength: WriteLength
  onWriteLengthChange: (value: WriteLength) => void
  remixLength: RemixLength
  onRemixLengthChange: (value: RemixLength) => void
  variationCount: VariationCount
  onVariationCountChange: (value: VariationCount) => void
  hookCategory: HookCategoryChoice
  onHookCategoryChange: (value: HookCategoryChoice) => void
  hookCount: HookCount
  onHookCountChange: (value: HookCount) => void
  selectedProduct: Product | null
  onProductSelect: (product: Product | null) => void
  additionalContext: string
  onAdditionalContextChange: (value: string) => void
  onGenerate: (context: EditableProductContext | null) => void
  highlightField?: string | null
}

export default function InputPanel({
  mode,
  onModeChange,
  source,
  onSourceChange,
  isBlueprint,
  forceTranscript,
  onForceTranscriptChange,
  brief,
  onBriefChange,
  writeStyle,
  onWriteStyleChange,
  writeFormat,
  onWriteFormatChange,
  writeLength,
  onWriteLengthChange,
  remixLength,
  onRemixLengthChange,
  variationCount,
  onVariationCountChange,
  hookCategory,
  onHookCategoryChange,
  hookCount,
  onHookCountChange,
  selectedProduct,
  onProductSelect,
  additionalContext,
  onAdditionalContextChange,
  onGenerate,
  highlightField,
}: InputPanelProps) {
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  const [scriptPickerOpen, setScriptPickerOpen] = useState(false)
  // Which big text box is open in the full-screen editor (null = none).
  const [expandedField, setExpandedField] = useState<null | 'brief' | 'source' | 'additionalContext'>(null)
  // Seed the editable context from a product that's already selected on mount
  // (persisted selection / history reload) so the "Edit product details"
  // dropdown is available immediately — not only after picking a new product.
  const [editableContext, setEditableContext] = useState<EditableProductContext | null>(
    () => (selectedProduct ? createEditableContext(selectedProduct) : null),
  )
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [styleModalOpen, setStyleModalOpen] = useState(false)
  const [hookModalOpen, setHookModalOpen] = useState(false)
  // The script picked from the bank for the remix source. Editing the textarea
  // clears it (reverts to the dashed picker), mirroring the B-Roll ref cards.
  const [sourceScript, setSourceScript] = useState<Script | null>(null)
  // True once the user has actively picked a Script Style — flips the trigger
  // from a dashed "click to choose" affordance to a solid, accented outline.
  const [styleChosen, setStyleChosen] = useState(false)
  // Brief enhance + undo/redo (mirrors Playground's prompt controls). History
  // is local; `briefSync` tracks the value we last set so a render-time check
  // can tell an external change (Create-new clears it, a history item loads)
  // from the user's own typing and reset the stack only on external changes.
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [briefHistory, setBriefHistory] = useState<string[]>([brief])
  const [briefIndex, setBriefIndex] = useState(0)
  const [briefSync, setBriefSync] = useState(brief)
  if (brief !== briefSync) {
    setBriefSync(brief)
    setBriefHistory([brief])
    setBriefIndex(0)
  }
  const canUndoBrief = briefIndex > 0
  const canRedoBrief = briefIndex < briefHistory.length - 1
  // Additional Context (remix modes) gets the same Enhance / Clear / Undo / Redo
  // controls as the brief — a parallel local history stack, synced the same way.
  const [isEnhancingContext, setIsEnhancingContext] = useState(false)
  const [contextHistory, setContextHistory] = useState<string[]>([additionalContext])
  const [contextIndex, setContextIndex] = useState(0)
  const [contextSync, setContextSync] = useState(additionalContext)
  if (additionalContext !== contextSync) {
    setContextSync(additionalContext)
    setContextHistory([additionalContext])
    setContextIndex(0)
  }
  const canUndoContext = contextIndex > 0
  const canRedoContext = contextIndex < contextHistory.length - 1
  const products = useBankStore((s) => s.products)
  const updateProduct = useBankStore((s) => s.updateProduct)
  const openApp = useAppStore((s) => s.openApp)
  const sendToApp = useAppStore((s) => s.sendToApp)
  const addToast = useAppStore((s) => s.addToast)
  const resolvedProductImage = useAssetUrl(selectedProduct?.productImage)
  // Hooks format: one-liners, so no length toggle; the Script Style picker is
  // swapped for the hook-family picker.
  // Write New ONLY — `writeFormat` is that mode's Script / Hooks / Scenes
  // toggle and Remix has no equivalent, so an unguarded read let a member who
  // last wrote hooks land in Remix with its Length chip gone and its batch size
  // counting "10 Hooks", for a pipeline that returns script variations.
  const isHooksFormat = mode === 'write' && writeFormat === 'hooks'
  // The scene-rewrite pipeline will run (blueprint detected, no override) —
  // drives the source box chrome, the chip copy, and the button labels.
  // Remix ONLY: `isBlueprint` is detected off the persisted `source` draft,
  // which Write New never reads. Without the mode guard, a blueprint left in
  // the remix box took Write New's batch-size chip off screen (a blueprint
  // rewrite returns one script, so `showCount` is false) with nothing on the
  // panel explaining where the 3 / 5 / 10 picker had gone.
  const blueprintActive = mode !== 'write' && isBlueprint && !forceTranscript
  // The two footer dropdowns. Every output picks its batch size — takes for
  // Script / Scenes / Remix, hooks for Hooks (one-liners off a single call, so
  // their own list) — except the blueprint rewrite, which returns ONE script.
  // Hooks have no duration; the blueprint rewrite does get a length, defaulting
  // to keeping the source's own scene timings (the 'default' pick), because
  // re-cutting a 60s blueprint to 30 is a real thing to want and
  // `runReverseEngineer` re-times the scenes for it.
  const showCount = !blueprintActive
  const showLength = !isHooksFormat

  // Slide-over footer actions. The edits already live in `editableContext`
  // (used for this generation), so "save for this script" just dismisses;
  // "update in bank" persists them back onto the saved product.
  const handleSaveForScript = () => {
    setDetailsOpen(false)
    addToast('Saved for this script')
  }
  const handleUpdateBank = async () => {
    if (!selectedProduct || !editableContext) return
    await updateProduct(selectedProduct.id, editableContext)
    setDetailsOpen(false)
    addToast('Product updated in bank', 'success')
  }

  // Rebuild the editable context whenever a different product is selected.
  // Done during render (prop-change sync) so it never setState-from-effect.
  const [prevProduct, setPrevProduct] = useState(selectedProduct)
  if (selectedProduct !== prevProduct) {
    setPrevProduct(selectedProduct)
    if (selectedProduct) {
      setEditableContext(createEditableContext(selectedProduct))
      setDetailsOpen(false)
    }
  }

  // Set the brief from one of our own actions (typing / undo / redo / enhance):
  // keep `briefSync` in step so the render-time check above doesn't mistake it
  // for an external reset.
  const setBrief = (next: string) => {
    setBriefSync(next)
    onBriefChange(next)
  }
  // Type handler — updates the brief live but doesn't push a history entry until
  // blur, so undo steps through coherent chunks instead of single keystrokes.
  const handleBriefType = (next: string) => setBrief(next)

  const pushBriefHistory = (next: string, base = briefHistory, baseIndex = briefIndex) => {
    const nextHistory = [...base.slice(0, baseIndex + 1), next]
    setBriefHistory(nextHistory)
    setBriefIndex(nextHistory.length - 1)
    setBrief(next)
  }
  // Commit the current typed draft into history (fired on blur). No-op when it
  // matches the latest entry.
  const commitBriefDraft = () => {
    if (brief !== briefHistory[briefIndex]) pushBriefHistory(brief)
  }
  // Clear the brief — pushed as a history entry so it's undoable.
  const handleBriefClear = () => {
    if (!brief.trim()) return
    pushBriefHistory('')
  }
  const handleBriefUndo = () => {
    if (briefIndex <= 0) return
    const i = briefIndex - 1
    setBriefIndex(i)
    setBrief(briefHistory[i])
  }
  const handleBriefRedo = () => {
    if (briefIndex >= briefHistory.length - 1) return
    const i = briefIndex + 1
    setBriefIndex(i)
    setBrief(briefHistory[i])
  }
  const handleEnhanceBrief = async () => {
    if (isEnhancing) return
    if (!brief.trim()) return
    // Fold any uncommitted typed draft into history first so Undo returns to
    // exactly what the user had before enhancing.
    const committed = brief !== briefHistory[briefIndex]
      ? [...briefHistory.slice(0, briefIndex + 1), brief]
      : briefHistory.slice(0, briefIndex + 1)
    setIsEnhancing(true)
    try {
      const rewritten = await enhanceBrief(brief)
      pushBriefHistory(rewritten, committed, committed.length - 1)
    } catch (err) {
      addToast(humanizeError(err, 'Enhance failed.'), 'error')
    } finally {
      setIsEnhancing(false)
    }
  }

  // Additional Context controls — mirror the brief handlers above.
  const setContext = (next: string) => {
    setContextSync(next)
    onAdditionalContextChange(next)
  }
  const handleContextType = (next: string) => setContext(next)
  const pushContextHistory = (next: string, base = contextHistory, baseIndex = contextIndex) => {
    const nextHistory = [...base.slice(0, baseIndex + 1), next]
    setContextHistory(nextHistory)
    setContextIndex(nextHistory.length - 1)
    setContext(next)
  }
  const commitContextDraft = () => {
    if (additionalContext !== contextHistory[contextIndex]) pushContextHistory(additionalContext)
  }
  const handleContextClear = () => {
    if (!additionalContext.trim()) return
    pushContextHistory('')
  }
  const handleContextUndo = () => {
    if (contextIndex <= 0) return
    const i = contextIndex - 1
    setContextIndex(i)
    setContext(contextHistory[i])
  }
  const handleContextRedo = () => {
    if (contextIndex >= contextHistory.length - 1) return
    const i = contextIndex + 1
    setContextIndex(i)
    setContext(contextHistory[i])
  }
  const handleEnhanceContext = async () => {
    if (isEnhancingContext) return
    if (!additionalContext.trim()) return
    const committed = additionalContext !== contextHistory[contextIndex]
      ? [...contextHistory.slice(0, contextIndex + 1), additionalContext]
      : contextHistory.slice(0, contextIndex + 1)
    setIsEnhancingContext(true)
    try {
      const rewritten = await enhanceBrief(additionalContext)
      pushContextHistory(rewritten, committed, committed.length - 1)
    } catch (err) {
      addToast(humanizeError(err, 'Enhance failed.'), 'error')
    } finally {
      setIsEnhancingContext(false)
    }
  }

  const sourceFilled = mode === 'write' ? true : source.trim().length > 0
  // What's still missing, in the order the column asks for it. A greyed
  // Generate is supposed to say what it wants on its own — but this form has
  // several rows and only these gate the run, so an unexplained grey-out reads
  // as "pick a Script Style too". The button names the real blocker instead.
  //
  // A product is OPTIONAL in both modes: a member describing the product in the
  // brief or the instructions shouldn't have to bank it first. What each mode
  // still needs is a subject from somewhere — Remix has its source script, and
  // Write New needs the product or the brief, since with neither the empty-brief
  // stand-in would be asking for an ad about nothing.
  const blocker = !sourceFilled
    ? { label: 'Paste a script to remix', icon: FileText }
    : mode === 'write' && !selectedProduct && !brief.trim()
      ? { label: 'Pick a product or write a brief', icon: Package }
      : null
  const canGenerate = blocker === null

  const handleOpenFinder = () => {
    sendToApp({ targetApp: 'finder', targetField: 'activeBank', data: 'products' })
    openApp('finder')
  }

  const updateField = (field: keyof EditableProductContext, value: string) => {
    if (!editableContext) return
    setEditableContext({ ...editableContext, [field]: value })
  }

  // Bank pick → fill the source text AND remember the chosen item so the
  // picker card shows the filled state. The pipeline follows from the picked
  // item's content (a Scenes bank item auto-detects as a blueprint).
  const handleBankScriptSelect = (item: Script) => {
    onSourceChange(item.scriptText)
    setSourceScript(item)
  }

  // The count keeps its noun ("3 Variations" / "10 Hooks") instead of an icon:
  // a bare "3" beside a duration reads as another measurement, and the word is
  // what makes the chip self-evident. `xl` — the picker-row height every
  // control on this band shares — and its menu anchors right, since it's the
  // rightmost thing in the row and the menu is wider than the chip.
  const countChip = (
    <ConstraintChip
      grow
      size="xl"
      align="right"
      openDirection="up"
      value={isHooksFormat ? `${hookCount} Hooks` : `${variationCount} Variations`}
      options={
        isHooksFormat
          ? HOOK_COUNTS.map((n) => `${n} Hooks`)
          : VARIATION_COUNTS.map((n) => `${n} Variations`)
      }
      onChange={(v) => {
        const n = parseInt(v, 10)
        if (isHooksFormat) onHookCountChange(n as HookCount)
        else onVariationCountChange(n as VariationCount)
      }}
    />
  )

  const generateLabel = mode === 'write'
    ? (writeFormat === 'scenes' ? `Generate ${variationCount} Scene Drafts` : writeFormat === 'hooks' ? `Generate ${hookCount} Hooks` : `Generate ${variationCount} Scripts`)
    : blueprintActive ? 'Rewrite Scene Prompts' : `Generate ${variationCount} Script Variations`

  // Product picker — the same row in both modes, and in both it CLOSES the
  // References card: under Script Style / Hook Style in Write New, under the
  // source script in Remix. The rows above it are the ones you set once and
  // leave; the product is what changes from script to script, so it sits
  // nearest the Generate button. It is no longer REQUIRED,
  // though, so its dot tracks the blocker above rather than being red on sight
  // — the house rule is that red means exactly one thing, "this is why
  // Generate is grey", and the only case left where an empty product is that
  // reason is a Write New with an empty brief too.
  const productRequired = mode === 'write' && !brief.trim()
  const productSection = (
    <div>
      {selectedProduct ? (
        /* One container, two sections. Picking the product and editing its
           details for this script are the same subject, and as two separate
           pills they read as unrelated controls stacked by accident. They
           share the card's border and tint now, split by an inset dashed
           rule; each half keeps its own hover so it's still obvious which
           one you're about to press. */
        <div
          className={`overflow-hidden border border-gold-500/25 bg-gold-500/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-inset ring-gold-500/10 ${editableContext ? 'rounded-2xl' : 'rounded-full'}`}
        >
          {/* Whole-card-clickable — hitting any part of the populated
              product card opens the picker. The refresh icon is a hover
              affordance only. Sized to match the B-Roll reference pills. */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setProductPickerOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setProductPickerOpen(true) } }}
            className={`group flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-gold-500/10 ${editableContext ? 'rounded-t-2xl' : 'rounded-full'}`}
          >
            <StatusDot filled />
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gold-500/15">
              {resolvedProductImage ? (
                <img src={resolvedProductImage} alt="" className="h-full w-full object-cover" />
              ) : (
                <Package className="h-[18px] w-[18px] text-gold-400 light:text-gold-600" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium tracking-tight text-ink-200">
                {selectedProduct.productName}
              </span>
              <span className="truncate text-[11px] text-ink-500">Product</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="hidden items-center rounded-md px-2 py-0.5 text-ink-500 group-hover:flex">
                <RefreshCw className="h-2.5 w-2.5" />
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onProductSelect(null) }}
                title="Remove product"
                aria-label="Remove product"
                className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-red-400 light:hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {editableContext && (
            <>
              {/* Inset, so the rule reads as a seam inside one card rather
                  than a cut between two. */}
              <div className="mx-4 border-t border-dashed border-gold-500/40" />
              <button
                type="button"
                onClick={() => setDetailsOpen(true)}
                className="flex w-full items-center justify-between gap-2 rounded-b-2xl px-4 py-2.5 text-left transition-colors hover:bg-gold-500/10"
              >
                <div className="flex items-center gap-2">
                  <PenLine className="h-3.5 w-3.5 text-scripts-text" strokeWidth={1.75} />
                  <span className="text-[12px] font-medium text-ink-200">Edit product details for this script</span>
                </div>
                <ChevronRight className="h-4 w-4 text-ink-400" strokeWidth={2} />
              </button>
            </>
          )}
        </div>
      ) : (
        <div>
          {products.length > 0 ? (
            <button
              onClick={() => setProductPickerOpen(true)}
              className="flex w-full items-center gap-2.5 rounded-full border border-dashed border-ink/10 bg-ink/[0.02] px-4 py-2.5 text-left transition-colors hover:border-scripts-500/30 hover:bg-scripts-500/5"
            >
              <StatusDot filled={false} required={productRequired} />
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-500/10">
                <Package className="h-[18px] w-[18px] text-gold-400 light:text-gold-600" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-medium text-ink-300">Product</span>
                <span className="text-[11px] text-ink-600">
                  {productRequired ? 'Choose from your Product Bank' : 'Optional. Choose from your Product Bank'}
                </span>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
            </button>
          ) : (
            <div className="flex items-center gap-2.5 rounded-full border border-dashed border-ink/10 bg-ink/[0.02] px-4 py-2.5">
              <StatusDot filled={false} required={productRequired} />
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5">
                <Package className="h-[18px] w-[18px] text-ink-700" />
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] text-ink-500">No products yet</span>
                <button
                  onClick={handleOpenFinder}
                  className="text-left text-[11px] text-scripts-text transition-colors hover:text-ink-100"
                >
                  Add one in Bank
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    // On a phone the WHOLE column is one scroller and the Generate band is the
    // last thing in it, not a footer standing over the fields — see the note on
    // the band below.
    <div className="flex h-full min-h-0 flex-col">
      {/* Mode toggle — rounded segmented pill, mirrored by the Output/History
          toggle in the right panel so both strips share the same baseline. */}
      {/* Full-width divider in the subtle vertical-divider tone (border-ink/5).
          Mirrored under the right column's Output/History toggle (same h-14 band
          + dense pill) so the line runs cleanly across both columns and lines up
          with the sidebar header divider. */}
      <div className="flex h-[57px] shrink-0 items-center border-b border-ink/5 px-5">
        <SegmentedToggle<ScriptUiMode>
          className="h-10 !p-1"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'write', label: 'Write New', icon: PenLine },
            { value: 'remix', label: 'Remix', icon: Shuffle },
          ]}
        />
      </div>

      {/* The phone's scroll port. It starts BELOW the toggle above, which is
          why that toggle is a sibling of this box and not its first child: the
          panel root used to be the scroller, so the tab bar scrolled away with
          the fields and the member lost the way back to the other tab halfway
          down a form. Above `md` this is a plain wrapper and the column below
          scrolls on its own. */}
      <div className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto">

        {/* Scrollable inputs — a flex column so step 1's textarea can absorb
            leftover height (same expand-don't-scroll pattern as Playground).
            Tight top padding so the first section sits close to the toggle. */}
        {/* pb-1, not pb-5: the brief grows to the bottom of this column and the
            footer starts right under it, so anything more reads as a gap between
            the box and the controls that belong to it. */}
        {/* 8px between every row, and 8px from the last one to the footer band
            (pb-2 + the band's pt-0) — B-Roll's rhythm. This column ran on 12s
            and 16s, which read as loose beside it. */}
        {/* pb-0, and the 8px to the band lives on the BAND (`pt-2`), not here.
            It used to be this column's `pb-2`, which is inside the scroller — so
            it was part of the scrolled content and slid out of view the moment
            the column overflowed, which is its normal state once a script is
            pasted in. Measured: the last box sat 2.5px off the band at scroll-top
            (reading as touching), 8.5px scrolled to the bottom. A gap that
            changes as you scroll isn't a gap. On the band it can't scroll away. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-0 pt-3 max-md:flex-none max-md:overflow-visible">
          {mode === 'write' ? (
            <>
              {/* Output sub-mode toggle — governs the form below (which style
                  picker, the length options, the artifact), so it leads, right
                  under the mode toggle. h-12, matching the Influencers
                  Portrait/Character Sheet toggle: a three-way switch of one-word
                  labels doesn't need a picker row's height, and at 58 it read as
                  the heaviest thing in a column it only introduces. */}
              <div className="mb-2">
                <SegmentedToggle<WriteFormat>
                  className="h-12 !p-1"
                  accent="scripts"
                  value={writeFormat}
                  onChange={onWriteFormatChange}
                  options={[
                    { value: 'script', label: 'Script', icon: FileText },
                    { value: 'hooks', label: 'Hooks', icon: FishingHook },
                    { value: 'scenes', label: 'Scenes', icon: Clapperboard },
                  ]}
                />
              </div>

              {/* References — what this script is built from, grouped in the
                  Influencers section card so the two picker rows read as one
                  thing rather than as two more rungs on a ladder. The card also
                  hosts the status dots: every row's dot sits at its left edge, so
                  they stack into one column you can scan without reading a word.
                  The STYLE leads and the product closes the card, in both modes
                  (August 2026) — the picker above it is the one you set once and
                  leave, where the product is what changes from script to script,
                  so it belongs nearest the button you press next. */}
              <SectionCard icon={Layers} title="References" className="mb-2">
              {/* Hook Style — the hooks format's replacement for the Script Style
                  picker. 'auto' (Best Mix) is the default and renders as the
                  dashed unset affordance; picking a family flips it solid, and
                  the X resets back to auto. */}
              {isHooksFormat && (
              <div>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setHookModalOpen(true)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHookModalOpen(true) } }}
                  className={`group flex w-full cursor-pointer items-center gap-2.5 rounded-full border px-4 py-2.5 text-left transition-colors ${
                    hookCategory !== 'auto'
                      ? 'border-scripts-500/20 bg-scripts-500/[0.06] hover:border-scripts-500/30 hover:bg-scripts-500/10'
                      : 'border-dashed border-ink/10 bg-ink/[0.02] hover:border-scripts-500/30 hover:bg-scripts-500/5'
                  }`}
                >
                  {/* Not `required`: Best Mix is a real answer, so an unpicked
                      family is neutral rather than something blocking the run. */}
                  <StatusDot filled={hookCategory !== 'auto'} />
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-scripts-500/10 text-scripts-text">
                    <FishingHook className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {hookCategory !== 'auto' ? (
                      <>
                        <div className="truncate text-[13px] font-medium tracking-tight text-scripts-text">{HOOK_CATEGORY_META[hookCategory].label}</div>
                        <div className="truncate text-[11px] leading-snug text-ink-500">{HOOK_CATEGORY_META[hookCategory].hint}</div>
                      </>
                    ) : (
                      <>
                        <div className="text-[13px] font-medium text-ink-300">Hook Style</div>
                        {/* "family", not "category" — the picker itself calls
                            them families, and one control shouldn't use two
                            names for the same thing. */}
                        <div className="text-[11px] text-ink-600">Auto picks the best mix, or lock one family</div>
                      </>
                    )}
                  </div>
                  {hookCategory !== 'auto' ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="hidden items-center rounded-md px-2 py-0.5 text-ink-500 group-hover:flex">
                        <RefreshCw className="h-2.5 w-2.5" />
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onHookCategoryChange('auto') }}
                        title="Back to Best Mix"
                        aria-label="Back to Best Mix"
                        className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-red-400 light:hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" strokeWidth={2} />
                  )}
                </div>
              </div>
              )}

              {/* Script Style — leads the card, with the product under it.
                  Tapping the button opens the style picker modal. Hidden in
                  the hooks format, which has its own family picker above. */}
              {!isHooksFormat && (
              <div>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setStyleModalOpen(true)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStyleModalOpen(true) } }}
                  className={`group flex w-full cursor-pointer items-center gap-2.5 rounded-full border px-4 py-2.5 text-left transition-colors ${
                    styleChosen
                      ? 'border-scripts-500/20 bg-scripts-500/[0.06] hover:border-scripts-500/30 hover:bg-scripts-500/10'
                      : 'border-dashed border-ink/10 bg-ink/[0.02] hover:border-scripts-500/30 hover:bg-scripts-500/5'
                  }`}
                >
                  {/* Optional — nothing is waiting on a style, so an unpicked one
                      is neutral, never red. */}
                  <StatusDot filled={styleChosen} />
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-scripts-500/10 text-scripts-text">
                    {styleChosen && WRITE_STYLE_META[writeStyle].group === 'format'
                      ? <Video className="h-[18px] w-[18px]" strokeWidth={1.75} />
                      : <FileText className="h-[18px] w-[18px]" strokeWidth={1.75} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {styleChosen ? (
                      <>
                        <div className="truncate text-[13px] font-medium tracking-tight text-scripts-text">{WRITE_STYLE_META[writeStyle].label}</div>
                        <div className="truncate text-[11px] leading-snug text-ink-500">{WRITE_STYLE_META[writeStyle].hint}</div>
                      </>
                    ) : (
                      <>
                        <div className="text-[13px] font-medium text-ink-300">Script Style</div>
                        <div className="text-[11px] text-ink-600">A structure to argue with, or a format to hide in</div>
                      </>
                    )}
                  </div>
                  {styleChosen ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="hidden items-center rounded-md px-2 py-0.5 text-ink-500 group-hover:flex">
                        <RefreshCw className="h-2.5 w-2.5" />
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setStyleChosen(false) }}
                        title="Clear style"
                        aria-label="Clear style"
                        className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-red-400 light:hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" strokeWidth={2} />
                  )}
                </div>
              </div>
              )}

              {productSection}
              </SectionCard>

              {/* The brief — the SAME box the remix modes get, header and all:
                  it's the same field doing the same job, and the two modes only
                  differ in what's above it. Its name sits INSIDE the box rather
                  than on a StepLabel row above, which is what closed the gap
                  under the product row — that row plus its margins was ~40px of
                  nothing between the pickers and the field.
                  `flex-1 basis-0` with the floor on the SECTION: the box takes
                  whatever height is left, so it opens tall on a fresh panel and
                  gives ground as the pickers above it fill up. */}
              {/* No top margin: the product row above already carries mb-2, and
                  the pair of them stacked a 16px gap where every other row in the
                  column sits 8 apart. */}
              {/* max-md: the growable boxes stop sharing the leftover height. On a
                  phone there IS no leftover — the column is shorter than its own
                  contents — so flex-1 just squeezes every box until the card's
                  overflow-hidden slices it. Fixed floors + a scrolling column is
                  the phone shape; the height-sharing is a desktop luxury. */}
              <div className="flex min-h-[160px] flex-1 basis-0 flex-col max-md:min-h-[220px] max-md:flex-none max-md:basis-auto">
                <div className="relative flex min-h-0 grow flex-col overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.02] transition-colors focus-within:border-scripts-500/30">
                  <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-2.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <PenLine className="h-3.5 w-3.5 shrink-0 text-ink-500" strokeWidth={2} />
                      <span className="truncate text-[13px] font-medium text-ink-200">Additional Instructions</span>
                    </div>
                    <span className="shrink-0 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">
                      optional
                    </span>
                  </div>
                  <textarea
                    value={brief}
                    onChange={(e) => handleBriefType(e.target.value)}
                    onBlur={commitBriefDraft}
                    placeholder={"Leave blank and I'll come up with the angle, or steer it: e.g. A girl in her 20s talking about this serum like she's telling her best friend, focus on how fast it cleared her skin. Casual, a little funny, end with the discount code."}
                    className="w-full min-h-0 flex-1 resize-none border-0 bg-transparent px-4 pb-3 pt-1.5 text-sm leading-relaxed text-ink-200 placeholder-ink-600 outline-none"
                  />
                  <PromptToolbar
                    accent="scripts"
                    onEnhance={handleEnhanceBrief}
                    enhanceTitle="Enhance prompt"
                    enhanceDisabled={!brief.trim()}
                    busy={isEnhancing}
                    onClear={handleBriefClear}
                    clearDisabled={!brief.trim()}
                    onUndo={handleBriefUndo}
                    canUndo={canUndoBrief}
                    onRedo={handleBriefRedo}
                    canRedo={canRedoBrief}
                    onExpand={() => setExpandedField('brief')}
                  />
                </div>
              </div>
            </>
          ) : (
            // Same References card as Write New, holding the source the remix is
            // built from plus the same product row — and in the same order the
            // other mode uses: what the script is MADE FROM first, the product it
            // is made FOR last, nearest the button. The source box is a fixed
            // share of the card's height (flex-1, its own scroller), so a row
            // under it isn't pushed down as you paste.
            <SectionCard
              icon={Layers}
              title="References"
              className="mb-2 flex flex-1 flex-col max-md:flex-none"
              contentClassName="flex flex-1 flex-col gap-2"
            >
            <div className="flex min-h-[140px] flex-1 flex-col max-md:min-h-[240px] max-md:flex-none">
              {/* Select from bank (header) + paste manually (textarea) merged into
                  one rounded box so the two sources read as a single input. One
                  box serves both remix pipelines: the pasted source's format is
                  auto-detected (a scene blueprint flips the chrome to fuchsia and
                  routes to the scene-rewrite pipeline; plain text gets 3 remixed
                  variations). It splits the column's leftover height evenly with
                  the Additional Context box below (both flex-1 basis-0) — the two
                  writing surfaces are a matched pair, and a fixed-height slab here
                  is what pushed the rest of the column past the fold. */}
              <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border bg-ink/[0.02] transition-colors focus-within:border-scripts-500/30 ${sourceScript ? (blueprintActive ? 'border-fuchsia-500/40' : 'border-scripts-500/40') : 'border-dashed border-ink/10'} ${highlightField === 'source' ? 'animate-field-flash' : ''}`}>
                <ScriptBankCard
                  selected={sourceScript}
                  // Filled is about the TEXT, not the bank pick — a pasted
                  // transcript is a filled source with no bank row behind it.
                  filled={sourceFilled}
                  label={blueprintActive ? 'Scene' : 'Reference Script'}
                  icon={blueprintActive ? Clapperboard : FileText}
                  accentClass={blueprintActive ? 'bg-fuchsia-500/10 text-fuchsia-300/80 light:text-fuchsia-700/80' : 'bg-scripts-500/10 text-scripts-300/80'}
                  onSelect={() => setScriptPickerOpen(true)}
                  onClear={() => setSourceScript(null)}
                  className="shrink-0"
                  flat
                />
                <div className="relative flex min-h-0 grow flex-col">
                  <textarea
                    value={source}
                    onChange={(e) => { onSourceChange(e.target.value); setSourceScript(null) }}
                    rows={6}
                    placeholder={'…or paste a proven ad transcript, or a scene blueprint from Ad Analyzer. The format is detected automatically.'}
                    className={`w-full min-h-0 grow resize-none overflow-y-auto border-0 bg-transparent px-4 py-3 leading-relaxed text-ink-200 outline-none ${
                      isBlueprint ? 'font-mono text-xs placeholder-ink-700' : 'text-sm placeholder-ink-600'
                    }`}
                  />
                  <ExpandButton onClick={() => setExpandedField('source')} className="absolute bottom-2 right-2" />
                </div>
                {/* Detection chip — only shows once a blueprint is recognised.
                    The right-hand button is the escape hatch for the one case
                    auto-detect can't know: remixing a blueprint's spoken lines
                    as a plain script instead of rewriting its scenes. */}
                {isBlueprint && (
                  <div className="flex shrink-0 items-center justify-between gap-2 border-t border-ink/10 px-4 py-2">
                    <span className={`flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium ${blueprintActive ? 'text-fuchsia-300 light:text-fuchsia-700' : 'text-ink-500'}`}>
                      {blueprintActive ? <Clapperboard className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
                      {blueprintActive ? 'Scene blueprint detected. Scenes will be rewritten' : `Remixing as a plain script · ${variationCount} variations`}
                    </span>
                    <button
                      type="button"
                      onClick={() => onForceTranscriptChange(!forceTranscript)}
                      className="shrink-0 rounded-full border border-ink/10 px-2.5 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200"
                    >
                      {blueprintActive ? 'Remix as script instead' : 'Rewrite scenes instead'}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {productSection}
            </SectionCard>
          )}

          {/* Final step — the free-text steer. Write New has its own copy of this
              box higher up (it doubles as the brief there), so this one is only
              shown for the remix / scene-rewrite modes. */}
          {mode !== 'write' && (
            // flex-1 basis-0 with the floor on the SECTION, never min-h-0 plus a
            // min-height on the textarea: that shape let the section shrink to
            // zero on a short viewport while the textarea kept its own floor, so
            // the box's overflow-hidden sliced the footer toolbar in half. A
            // min-height on the section overrides its auto min-size, so it shrinks
            // to a real, known floor and everything inside shrinks with it.
            <div className="flex min-h-[120px] flex-1 flex-col max-md:min-h-[200px] max-md:flex-none">
              {/* Single rounded box (matches the Write New brief): a header row
                  naming the field, the textarea taking whatever height is left,
                  then Enhance / Clear / Undo / Redo + Expand in a footer. The
                  label used to sit ABOVE the box as a StepLabel; it's the same
                  shape as B-Roll's Instructions/Brief box now — a field's name
                  belongs on the field, and the row it needed outside cost the
                  textarea its height in a column that's already tight. */}
              <div className="relative flex min-h-0 grow flex-col overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.02] transition-colors focus-within:border-scripts-500/30">
                <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-2.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <PenLine className="h-3.5 w-3.5 shrink-0 text-ink-500" strokeWidth={2} />
                    <span className="truncate text-[13px] font-medium text-ink-200">Additional Instructions</span>
                  </div>
                  <span className="shrink-0 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">
                    optional
                  </span>
                </div>
                <textarea
                  value={additionalContext}
                  onChange={(e) => handleContextType(e.target.value)}
                  onBlur={commitContextDraft}
                  placeholder={blueprintActive
                    ? "Extra instructions for the rewrite (e.g. 'Keep tone playful', 'Make the CTA softer')..."
                    : "Extra instructions for this script (e.g. 'Focus on the self-cleaning feature', 'Summer campaign tone')..."}
                  className="w-full min-h-0 flex-1 resize-none border-0 bg-transparent px-4 pb-3 pt-1.5 text-sm leading-relaxed text-ink-200 placeholder-ink-600 outline-none"
                />
                <PromptToolbar
                  accent="scripts"
                  onEnhance={handleEnhanceContext}
                  enhanceTitle="Enhance prompt"
                  enhanceDisabled={!additionalContext.trim()}
                  busy={isEnhancingContext}
                  onClear={handleContextClear}
                  clearDisabled={!additionalContext.trim()}
                  onUndo={handleContextUndo}
                  canUndo={canUndoContext}
                  onRedo={handleContextRedo}
                  canRedo={canRedoContext}
                  onExpand={() => setExpandedField('additionalContext')}
                />
              </div>
            </div>
          )}
        </div>

        {/* Generate band — a normal `shrink-0` footer at the foot of the column,
            exactly as in B-Roll, Playground and Characters.
            It used to go `position: fixed` under `md`, and that is a zoom trap,
            not just a phone shape: browser zoom shrinks the viewport in CSS px, so
            zooming a 1440px desktop to 200% lands under the 768px breakpoint with
            the desktop two-pane layout still on screen. The bar then detached to
            the window's bottom edge and covered the last ~150px of the scrolling
            column — which is what clipped Additional Instructions at 2× in Write
            New, and left Hooks looking fine only because its footer is one row
            shorter. A static footer is laid out by the flex column above it, so
            the scroll area can never run underneath it at any zoom.
            Opaque bg under md: backdrop-filter doesn't re-blur inside the
            already-blurred window frame, so any alpha lets content ghost through.
            No rule above it: the brief box ends where its own toolbar ends, so a
            hairline there just fenced off controls that belong to the same column. */}
        {/* Not pinned on a phone (August 2026, Massimo's call): a fixed band cost
            ~150px of a ~700px column and stood over the fields it belongs to. You
            fill the form top to bottom and Generate is where you arrive. It stays
            a footer from `md` up, where the column has the height to spare. */}
        <div className="shrink-0 bg-surface-0 px-5 pb-3 pt-2 md:bg-transparent">
          {/* ONE row above Generate on a desktop: who writes it, how long it runs,
              how many come back. The model takes HALF and the two chips a quarter
              each (`flex-[2]` against `flex-1`, both zero-basis, so the ratio
              holds whatever is in them). Equal thirds was tried first and the
              model row is the one control here with something to say — at a third
              it read "GPT 5.6…" over "The Scrip…", while the chips had spare room
              around two words. All at 58px, the picker-row height the column's
              other rows share.

              TWO rows once the row itself drops under 440px: the model takes the
              full width (`basis-full`) and the two pearls sit side by side under
              it. Half of a 335px column is 167px for a control whose whole job is
              naming the model that writes your script, and the name is the half
              that was being cut. The chips take `basis-0` there so they split the
              second row evenly rather than inheriting the desktop ratio.

              A CONTAINER query, not a viewport one: this column is `w-1/3` over a
              380px floor, so what decides whether three controls fit is the
              column's own width and the viewport is only a proxy for it — and it
              was the wrong proxy. `max-md` put the break at 768px, which is where
              the column stops being a column at all; from 768 to ~1320 the row is
              on one line at its 380px floor, which is 162px for the model. That is
              the reported clip — "GPT 5.6…" over a `$$$$$` spilling out past the
              chevron, with "3 Variations" wrapping inside its own pearl.

              They were a chip band stacked over the model row, which made two
              rows out of one decision each. Both chips are pearls rather than
              fields: the pair was two full-width `SegmentedToggle` slabs, then
              full-width `Dropdown`s, each costing the brief its height for a
              control nobody sweeps through. Each hides on its own — Hooks have no
              duration, the blueprint rewrite has no count. Everything here opens
              UPWARD: a downward menu covers the button you're heading for. */}
          <div className="@container mb-2">
          <div className="flex flex-wrap items-stretch gap-1.5">
            <ScriptModelRow appId="script-architect" className="min-w-0 flex-[2] @max-[440px]:basis-full" />
            {showLength && (
              // The clock carries the meaning the old dim "Length" label did —
              // "15s" alone doesn't say what it measures, and a chip has no
              // room for a second word. Remix's list leads with "Default": the
              // source ad already has a length, and keeping it is usually the
              // point of remixing a winner. Write New has no source to inherit.
              // It sits in the MIDDLE of the row, so its menu anchors left and
              // has room either side; the count on the right is the one that has
              // to hang its menu off the panel edge.
              <div className="flex min-w-0 flex-1 @max-[440px]:basis-0">
                <ConstraintChip
                  grow
                  size="xl"
                  openDirection="up"
                  value={mode === 'write' ? `${writeLength}s` : remixLength === 'default' ? 'Default' : `${remixLength}s`}
                  options={
                    mode === 'write'
                      ? WRITE_LENGTHS.map((len) => `${len}s`)
                      : REMIX_LENGTHS.map((len) => (len === 'default' ? 'Default' : `${len}s`))
                  }
                  onChange={(v) => {
                    if (mode === 'write') onWriteLengthChange(Number(v.replace('s', '')) as WriteLength)
                    else onRemixLengthChange((v === 'Default' ? 'default' : Number(v.replace('s', ''))) as RemixLength)
                  }}
                  render={(v) => (
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{v}</span>
                    </span>
                  )}
                />
              </div>
            )}
            {showCount && <div className="flex min-w-0 flex-1 @max-[440px]:basis-0">{countChip}</div>}
          </div>
          </div>
          {/* `disabled:hover:bg-scripts-500` — a disabled button must not answer
              the pointer. `:hover` still matches one, so the blocker state
              ("Paste a script to remix") repainted under the cursor and read as
              clickable. */}
          {/* Never disabled by a run in flight, and never wearing a spinner:
              a fired script becomes an in-progress card in History and the
              writing face in the Output pane, so the button is free to queue
              the next one. The only thing that greys it is a missing input. */}
          <button
            onClick={() => onGenerate(editableContext)}
            disabled={!canGenerate}
            className="flex w-full items-center justify-center gap-2.5 glass-fill glass-fill-soft rounded-full border border-white/15 bg-scripts-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] btn-soft-shadow transition-all hover:brightness-110 disabled:hover:brightness-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:"
          >
            {blocker ? (
              <>
                <blocker.icon className="h-4 w-4" strokeWidth={2.5} />
                <span>{blocker.label}</span>
              </>
            ) : (
              <>
                <PenLine className="h-4 w-4" strokeWidth={2.5} />
                <span>{generateLabel}</span>
              </>
            )}
          </button>
        </div>

        {/* Bank Pickers */}
        <BankPicker
          bankType="products"
          isOpen={productPickerOpen}
          onSelect={(item) => onProductSelect(item as Product)}
          onClose={() => setProductPickerOpen(false)}
        />
        <BankPicker
          bankType="scripts"
          isOpen={scriptPickerOpen}
          onSelect={(item) => handleBankScriptSelect(item as Script)}
          onClose={() => setScriptPickerOpen(false)}
        />

        {/* Edit product details — opens in a modal with full-size fields, so
            you never scroll the form or fight tiny inline boxes. */}
        <Modal
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          title="Edit product details"
          subtitle="Edit for this script, or push the changes back to your bank"
          footer={
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={handleSaveForScript}
                className="w-full glass-fill glass-fill-soft rounded-full border border-white/15 bg-scripts-500 px-5 py-2.5 text-[13px] font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] transition-all hover:brightness-110"
              >
                Save for this script only
              </button>
              <button
                type="button"
                onClick={handleUpdateBank}
                className="w-full rounded-full border border-ink/10 bg-ink/[0.02] px-5 py-2.5 text-[13px] font-medium tracking-tight text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.05] hover:text-ink-100"
              >
                Update product in bank
              </button>
            </div>
          }
        >
          {editableContext && (
            <div className="flex flex-col gap-4 p-5">
              <EditableField label="Name" value={editableContext.productName} onChange={(v) => updateField('productName', v)} />
              <EditableField label="Description" value={editableContext.productDescription} onChange={(v) => updateField('productDescription', v)} />
              <EditableField label="Unique Mechanism" value={editableContext.uniqueMechanism} onChange={(v) => updateField('uniqueMechanism', v)} />
              <EditableField label="Target Market" value={editableContext.targetMarket} onChange={(v) => updateField('targetMarket', v)} />
              <EditableField label="Pain Points" value={editableContext.painPoints} onChange={(v) => updateField('painPoints', v)} />
              <EditableField label="Benefits" value={editableContext.benefits} onChange={(v) => updateField('benefits', v)} />
              <EditableField label="Before / After" value={editableContext.beforeAfter} onChange={(v) => updateField('beforeAfter', v)} />
              <EditableField label="Current Alternatives" value={editableContext.currentAlternatives} onChange={(v) => updateField('currentAlternatives', v)} />
              <EditableField label="USPs" value={editableContext.usps} onChange={(v) => updateField('usps', v)} />
              <EditableField label="Proof" value={editableContext.proof} onChange={(v) => updateField('proof', v)} />
              <EditableField label="Objections" value={editableContext.objections} onChange={(v) => updateField('objections', v)} />
              <EditableField label="Not For" value={editableContext.notFor} onChange={(v) => updateField('notFor', v)} />
              <EditableField label="Offer" value={editableContext.offer} onChange={(v) => updateField('offer', v)} />
              <EditableField label="CTA" value={editableContext.cta} onChange={(v) => updateField('cta', v)} />
            </div>
          )}
        </Modal>

        {/* Style picker — tap a style to select it. */}
        <Modal
          open={styleModalOpen}
          onClose={() => setStyleModalOpen(false)}
          title="Choose a style"
          subtitle="What kind of content the ad looks like, and how it's built"
          size="wide"
        >
          {/* Two sections: Structures (how the argument is built) on top, then
              Formats (the kind of content the ad imitates). Structures lead HERE
              because the question this app is asking is how the argument is
              built; B-Roll passes `formatsFirst` and leads with Formats, since
              it's picking the kind of ad to shoot and a format is the half that
              stages the shots. Same list either way — only the reading order
              differs, and the component is shared so the slugs can't drift. */}
          <ScriptStyleList
            value={styleChosen ? writeStyle : null}
            onSelect={(style) => { onWriteStyleChange(style); setStyleChosen(true); setStyleModalOpen(false) }}
          />
        </Modal>

        {/* Hook family picker — mirrors the style picker. 'auto' leads. */}
        <Modal
          open={hookModalOpen}
          onClose={() => setHookModalOpen(false)}
          title="Choose a hook style"
          subtitle={`Which formula family the ${hookCount} hooks draw from`}
          size="wide"
        >
          <div className="flex flex-col gap-2 p-4">
            {(Object.keys(HOOK_CATEGORY_META) as HookCategoryChoice[]).map((choice) => {
              const active = choice === hookCategory
              return (
                <button
                  key={choice}
                  type="button"
                  onClick={() => { onHookCategoryChange(choice); setHookModalOpen(false) }}
                  className={`flex items-center gap-3 rounded-full border px-4 py-3 text-left transition-colors ${
                    active
                      ? 'border-scripts-500/30 bg-scripts-500/10'
                      : 'border-ink/5 bg-ink/[0.02] hover:border-ink/10 hover:bg-ink/[0.04]'
                  }`}
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${active ? 'bg-scripts-500/10 text-scripts-text' : 'bg-ink/5 text-ink-500'}`}>
                    {choice === 'auto' ? <Sparkles className="h-5 w-5" strokeWidth={1.75} /> : <FishingHook className="h-5 w-5" strokeWidth={1.75} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[13px] font-medium tracking-tight ${active ? 'text-scripts-300' : 'text-ink-200'}`}>
                      {HOOK_CATEGORY_META[choice].label}
                    </div>
                    <div className="text-[11px] leading-snug text-ink-500">{HOOK_CATEGORY_META[choice].hint}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </Modal>

        <ExpandTextModal
          open={expandedField === 'brief'}
          onClose={() => { commitBriefDraft(); setExpandedField(null) }}
          value={brief}
          onChange={handleBriefType}
          title="Additional Instructions"
          accent="scripts"
          placeholder="What should this video say or focus on? Vibe, angle, key points…"
        />
        <ExpandTextModal
          open={expandedField === 'source'}
          onClose={() => setExpandedField(null)}
          value={source}
          onChange={(v) => { onSourceChange(v); setSourceScript(null) }}
          title={blueprintActive ? 'Scene Blueprint' : 'Proven Script Transcript'}
          accent="scripts"
          mono={isBlueprint}
          placeholder="Paste a proven ad transcript or an Ad Analyzer scene blueprint…"
        />
        <ExpandTextModal
          open={expandedField === 'additionalContext'}
          onClose={() => { commitContextDraft(); setExpandedField(null) }}
          value={additionalContext}
          onChange={handleContextType}
          title="Additional Instructions"
          accent="scripts"
          placeholder="Extra instructions for this generation…"
        />
      </div>
    </div>
  )
}

// A bank-pick card for the remix / scene source. Dashed "Click to select"
// when empty; a solid filled pill with a hover refresh icon + an X-clear when a
// bank item is selected — mirrors the B-Roll reference cards.
function ScriptBankCard({
  selected,
  filled,
  label,
  icon: Icon,
  accentClass,
  onSelect,
  onClear,
  className,
  flat,
}: {
  selected: Script | null
  // Whether the source actually holds text — a paste fills it with no bank row
  // selected, so this is NOT `!!selected`.
  filled: boolean
  label: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  accentClass: string
  onSelect: () => void
  onClear: () => void
  className?: string
  // Header variant — drops the rounded-full pill so the card sits as a flat
  // top row (border-b) inside the merged input box above the paste textarea.
  flat?: boolean
}) {
  if (!selected) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={`group flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors ${
          flat
            ? 'border-b border-dashed border-ink/10 hover:bg-ink/[0.04]'
            : 'rounded-full border border-dashed border-ink/10 bg-ink/[0.015] hover:border-ink/20 hover:bg-ink/[0.03]'
        } ${className ?? ''}`}
      >
        <StatusDot filled={filled} required />
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${accentClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-ink-200">{label}</div>
          <div className="text-[11px] text-ink-400">Click to select from bank</div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
      </button>
    )
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={`group flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 transition-colors ${
        flat
          ? 'border-b border-ink/10 hover:bg-ink/[0.04]'
          : 'rounded-full border border-ink/10 bg-ink/[0.02] hover:border-ink/20 hover:bg-ink/[0.04]'
      } ${className ?? ''}`}
    >
      <StatusDot filled={filled} required />
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${accentClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink-200">{selected.title}</div>
        <div className="truncate text-[11px] text-ink-500">{label}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="hidden items-center rounded-md px-2 py-0.5 text-ink-500 group-hover:flex">
          <RefreshCw className="h-2.5 w-2.5" />
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClear() }}
          title={`Remove ${label.toLowerCase()}`}
          aria-label={`Remove ${label.toLowerCase()}`}
          className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-red-400 light:hover:text-red-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function EditableField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-500">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-2xl border border-ink/10 bg-ink/[0.02] px-4 py-3 text-[13px] leading-relaxed text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-scripts-500/30 resize-none"
      />
    </label>
  )
}
