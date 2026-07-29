import { useState, type ComponentType } from 'react'
import { Package, Loader2, PenLine, ChevronRight, FileText, Clapperboard, RefreshCw, X, Sparkles, Undo2, Redo2, Eraser, Shuffle, FishingHook, Video } from 'lucide-react'
import type { Product, Script } from '../../../stores/types'
import { WRITE_LENGTHS, WRITE_STYLE_META, HOOK_CATEGORY_META, HOOK_COUNT, VARIATION_COUNTS, createEditableContext, type EditableProductContext, type ScriptUiMode, type WriteStyle, type WriteFormat, type WriteLength, type HookCategoryChoice, type VariationCount } from '../types'
import { useBankStore } from '../../../stores/bankStore'
import BankPicker from '../../../components/BankPicker'
import SegmentedToggle from '../../../components/SegmentedToggle'
import ClearAllButton from '../../../components/ClearAllButton'
import SlideOver from '../../../components/SlideOver'
import ExpandTextModal, { ExpandButton } from '../../../components/ExpandableText'
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
  onClearInputs: () => void
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
  variationCount: VariationCount
  onVariationCountChange: (value: VariationCount) => void
  hookCategory: HookCategoryChoice
  onHookCategoryChange: (value: HookCategoryChoice) => void
  selectedProduct: Product | null
  onProductSelect: (product: Product | null) => void
  additionalContext: string
  onAdditionalContextChange: (value: string) => void
  onGenerate: (context: EditableProductContext | null) => void
  isGenerating: boolean
  highlightField?: string | null
}

export default function InputPanel({
  mode,
  onModeChange,
  onClearInputs,
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
  variationCount,
  onVariationCountChange,
  hookCategory,
  onHookCategoryChange,
  selectedProduct,
  onProductSelect,
  additionalContext,
  onAdditionalContextChange,
  onGenerate,
  isGenerating,
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
  const [styleSlideOpen, setStyleSlideOpen] = useState(false)
  const [hookSlideOpen, setHookSlideOpen] = useState(false)
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
  const isHooksFormat = writeFormat === 'hooks'
  // The scene-rewrite pipeline will run (blueprint detected, no override) —
  // drives the source box chrome, the chip copy, and the button labels.
  const blueprintActive = isBlueprint && !forceTranscript

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

  // Write New's brief is optional (an empty brief lets the model invent the
  // angle), so that mode only needs a selected product to generate.
  const sourceFilled = mode === 'write' ? true : source.trim().length > 0
  // What's still missing, in the order the column asks for it. A greyed
  // Generate is supposed to say what it wants on its own — but this form has
  // two dashed picker rows and only ONE of them (Product) actually gates the
  // run, so an unexplained grey-out reads as "pick a Script Style too". The
  // button names the real blocker instead.
  const blocker = !sourceFilled
    ? { label: 'Paste a script to remix', icon: FileText }
    : !selectedProduct
      ? { label: 'Pick a product to generate', icon: Package }
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

  const generateLabel = mode === 'write'
    ? (writeFormat === 'scenes' ? `Generate ${variationCount} Scene Drafts` : writeFormat === 'hooks' ? `Generate ${HOOK_COUNT} Hooks` : `Generate ${variationCount} Scripts`)
    : blueprintActive ? 'Rewrite Scene Prompts' : `Generate ${variationCount} Script Variations`

  // Product picker — step 2 in every mode, but rendered in a different spot
  // for Write New (before the brief) than for the remix modes (after the
  // source text).
  const productSection = (
    <div className="mb-3">
      {selectedProduct ? (
        <div>
          {/* Whole-card-clickable — hitting any part of the populated
              product card opens the picker. The refresh icon is a hover
              affordance only. Sized to match the B-Roll reference pills. */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setProductPickerOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setProductPickerOpen(true) } }}
            className="group flex w-full cursor-pointer items-center gap-3 rounded-full border border-gold-500/25 bg-gold-500/[0.06] px-4 py-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-inset ring-gold-500/10 transition-colors hover:bg-gold-500/10"
          >
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
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-full border border-ink/10 bg-ink/[0.02] px-4 py-2.5 text-left transition-colors hover:border-ink/20 hover:bg-ink/[0.04]"
            >
              <div className="flex items-center gap-2">
                <PenLine className="h-3.5 w-3.5 text-scripts-text" strokeWidth={1.75} />
                <span className="text-[12px] font-medium text-ink-200">Edit product details for this script</span>
              </div>
              <ChevronRight className="h-4 w-4 text-ink-400" strokeWidth={2} />
            </button>
          )}
        </div>
      ) : (
        <div>
          {products.length > 0 ? (
            <button
              onClick={() => setProductPickerOpen(true)}
              className="flex w-full items-center gap-3 rounded-full border border-dashed border-ink/10 bg-ink/[0.02] px-4 py-2.5 text-left transition-colors hover:border-scripts-500/30 hover:bg-scripts-500/5"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-500/10">
                <Package className="h-[18px] w-[18px] text-gold-400 light:text-gold-600" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-medium text-ink-300">Product</span>
                <span className="text-[11px] text-ink-600">Choose from your Product Bank</span>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-full border border-dashed border-ink/10 bg-ink/[0.02] px-4 py-2.5">
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
    <div className="flex flex-col md:h-full">
      {/* Mode toggle — rounded segmented pill, mirrored by the Output/History
          toggle in the right panel so both strips share the same baseline. */}
      {/* Full-width divider in the subtle vertical-divider tone (border-ink/5).
          Mirrored under the right column's Output/History toggle (same h-14 band
          + dense pill) so the line runs cleanly across both columns and lines up
          with the sidebar header divider. */}
      <div className="flex h-[57px] shrink-0 items-center gap-2 border-b border-ink/5 px-5">
        <SegmentedToggle<ScriptUiMode>
          className="h-10 !p-1"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'write', label: 'Write New', icon: PenLine },
            { value: 'remix', label: 'Remix', icon: Shuffle },
          ]}
        />
        <ClearAllButton onClear={onClearInputs} label="New" className="shrink-0" />
      </div>

      {/* Scrollable inputs — a flex column so step 1's textarea can absorb
          leftover height (same expand-don't-scroll pattern as Playground).
          Tight top padding so the first section sits close to the toggle. */}
      <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-5 pt-4">
        {mode === 'write' ? (
          <>
            {/* Output sub-mode toggle — governs the form below (which style
                picker, the length options, the artifact), so it leads, right
                under the mode toggle. Sized to match the Influencers
                Portrait/Character Sheet toggle (h-12, p-1). */}
            <div className="mb-3">
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

            {/* Hook Style — the hooks format's replacement for the Script Style
                picker. 'auto' (Best Mix) is the default and renders as the
                dashed unset affordance; picking a family flips it solid, and
                the X resets back to auto. */}
            {isHooksFormat && (
            <div className="mb-3">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setHookSlideOpen(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHookSlideOpen(true) } }}
                className={`group flex w-full cursor-pointer items-center gap-3 rounded-full border px-4 py-2.5 text-left transition-colors ${
                  hookCategory !== 'auto'
                    ? 'border-scripts-500/20 bg-scripts-500/[0.06] hover:border-scripts-500/30 hover:bg-scripts-500/10'
                    : 'border-dashed border-ink/10 bg-ink/[0.02] hover:border-scripts-500/30 hover:bg-scripts-500/5'
                }`}
              >
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
                      <div className="text-[11px] text-ink-600">Auto picks the best mix — or lock one category</div>
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

            {/* Script Style — sits above the product picker. Tapping the button
                opens the style picker slide-over. Hidden in the hooks format,
                which has its own family picker above. */}
            {!isHooksFormat && (
            <div className="mb-3">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setStyleSlideOpen(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStyleSlideOpen(true) } }}
                className={`group flex w-full cursor-pointer items-center gap-3 rounded-full border px-4 py-2.5 text-left transition-colors ${
                  styleChosen
                    ? 'border-scripts-500/20 bg-scripts-500/[0.06] hover:border-scripts-500/30 hover:bg-scripts-500/10'
                    : 'border-dashed border-ink/10 bg-ink/[0.02] hover:border-scripts-500/30 hover:bg-scripts-500/5'
                }`}
              >
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

            {/* Product — sits below the style picker. */}
            {productSection}

            {/* The brief — its section grows to absorb leftover column height so
                the box fills the blank space below the pickers (same
                expand-don't-scroll pattern as Playground's prompt). The length
                toggle is pinned to the footer above Generate, so the brief owns
                all the leftover space here. */}
            {/* No min-h-0 here either — see the Additional Context note below. */}
            <div className="mt-3 flex flex-1 flex-col">
              <div className="mb-3 flex items-center gap-2">
                <StepLabel
                  label="Describe Your Ad"
                  optional
                  tooltip="What should this video say or focus on? Vibe, angle, key points — anything goes. Leave it blank and the model will come up with the angle for you."
                />
              </div>
              {/* Single rounded box (Playground prompt pattern): the textarea
                  grows to fill the box, the Enhance + Undo/Redo + Expand controls
                  sit attached in a footer under a hairline. */}
              <div className="relative flex grow flex-col overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.02] transition-colors focus-within:border-scripts-500/30">
                <textarea
                  value={brief}
                  onChange={(e) => handleBriefType(e.target.value)}
                  onBlur={commitBriefDraft}
                  placeholder={"Leave blank and I'll come up with the angle — or steer it: e.g. A girl in her 20s talking about this serum like she's telling her best friend, focus on how fast it cleared her skin. Casual, a little funny, end with the discount code."}
                  className="min-h-[120px] w-full flex-1 resize-none border-0 bg-transparent px-4 py-3 text-sm leading-relaxed text-ink-200 placeholder-ink-600 outline-none"
                />
                {/* Footer toolbar — Enhance + Clear + Undo/Redo bottom-left;
                    Expand bottom-right (mirrors the Playground prompt field). */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-ink/10 px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Enhance prompt"
                      onClick={handleEnhanceBrief}
                      disabled={isEnhancing || !brief.trim()}
                      className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:bg-scripts-500/10 hover:text-scripts-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isEnhancing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      Enhance Prompt
                    </button>
                    <button
                      type="button"
                      title="Clear prompt"
                      onClick={handleBriefClear}
                      disabled={isEnhancing || !brief.trim()}
                      className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Eraser className="h-3 w-3" />
                      Clear Prompt
                    </button>
                    <button
                      type="button"
                      title="Undo"
                      onClick={handleBriefUndo}
                      disabled={!canUndoBrief || isEnhancing}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Undo2 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="Redo"
                      onClick={handleBriefRedo}
                      disabled={!canRedoBrief || isEnhancing}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Redo2 className="h-3 w-3" />
                    </button>
                  </div>
                  <ExpandButton onClick={() => setExpandedField('brief')} />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="mb-4 flex flex-col">
            {/* Select from bank (header) + paste manually (textarea) merged into
                one rounded box so the two sources read as a single input. One
                box serves both remix pipelines: the pasted source's format is
                auto-detected (a scene blueprint flips the chrome to fuchsia and
                routes to the scene-rewrite pipeline; plain text gets 3 remixed
                variations). Natural height (no grow) so the product row hugs it —
                the Additional Context box absorbs the leftover column space. */}
            <div className={`flex flex-col overflow-hidden rounded-3xl border bg-ink/[0.02] transition-colors focus-within:border-scripts-500/30 ${sourceScript ? (blueprintActive ? 'border-fuchsia-500/40' : 'border-scripts-500/40') : 'border-dashed border-ink/10'} ${highlightField === 'source' ? 'animate-field-flash' : ''}`}>
              <ScriptBankCard
                selected={sourceScript}
                label={blueprintActive ? 'Scene' : 'Script'}
                icon={blueprintActive ? Clapperboard : FileText}
                accentClass={blueprintActive ? 'bg-fuchsia-500/10 text-fuchsia-300/80 light:text-fuchsia-700/80' : 'bg-scripts-500/10 text-scripts-300/80'}
                onSelect={() => setScriptPickerOpen(true)}
                onClear={() => setSourceScript(null)}
                flat
              />
              <div className="relative flex grow flex-col">
                <textarea
                  value={source}
                  onChange={(e) => { onSourceChange(e.target.value); setSourceScript(null) }}
                  rows={6}
                  placeholder={'…or paste a proven ad transcript, or a scene blueprint from Ad Analyzer — the format is detected automatically.'}
                  className={`w-full grow resize-none border-0 bg-transparent px-4 py-3 leading-relaxed text-ink-200 outline-none ${
                    isBlueprint ? 'min-h-[150px] overflow-y-auto font-mono text-xs placeholder-ink-700' : 'min-h-[120px] text-sm placeholder-ink-600'
                  }`}
                />
                <ExpandButton onClick={() => setExpandedField('source')} className="absolute bottom-2 right-2" />
              </div>
              {/* Detection chip — only shows once a blueprint is recognised.
                  The right-hand button is the escape hatch for the one case
                  auto-detect can't know: remixing a blueprint's spoken lines
                  as a plain script instead of rewriting its scenes. */}
              {isBlueprint && (
                <div className="flex items-center justify-between gap-2 border-t border-ink/10 px-4 py-2">
                  <span className={`flex min-w-0 items-center gap-1.5 truncate text-[11px] font-medium ${blueprintActive ? 'text-fuchsia-300 light:text-fuchsia-700' : 'text-ink-500'}`}>
                    {blueprintActive ? <Clapperboard className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
                    {blueprintActive ? 'Scene blueprint detected — scenes will be rewritten' : `Remixing as a plain script — ${variationCount} variations`}
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
        )}

        {/* Step 02 — Product Context (Write New renders it inside its own
            block above, between Output and the brief) */}
        {mode !== 'write' && productSection}

        {/* Final step — Additional Context. Write New folds this into the
            "Describe Your Video" brief (step 3), so it's only shown for the
            remix / scene-rewrite modes. */}
        {mode !== 'write' && (
          // flex-1 to absorb leftover height, but NO min-h-0: that let the
          // section shrink to zero on a short viewport while the textarea kept
          // its min-height, so the footer toolbar overflowed and the box's
          // overflow-hidden sliced it in half. Auto min-size = content size.
          <div className="mt-2 flex flex-1 flex-col">
            <div className="mb-2 flex items-center gap-2">
              <StepLabel label="Additional Context" optional />
            </div>
            {/* Single rounded box (matches the Write New brief): the textarea
                grows to absorb the leftover column height, with Enhance / Clear /
                Undo / Redo + Expand attached in a footer under a hairline. */}
            <div className="relative flex grow flex-col overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.02] transition-colors focus-within:border-scripts-500/30">
              <textarea
                value={additionalContext}
                onChange={(e) => handleContextType(e.target.value)}
                onBlur={commitContextDraft}
                placeholder={blueprintActive
                  ? "Additional context for the rewrite (e.g. 'Keep tone playful', 'Make the CTA softer')..."
                  : "Additional context for this script (e.g. 'Focus on the self-cleaning feature', 'Summer campaign tone')..."}
                className="min-h-[160px] w-full flex-1 resize-none border-0 bg-transparent px-4 py-3 text-sm leading-relaxed text-ink-200 placeholder-ink-600 outline-none"
              />
              {/* Footer toolbar — Enhance + Clear + Undo/Redo bottom-left;
                  Expand bottom-right (mirrors the Describe Your Ad field). */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-ink/10 px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title="Enhance prompt"
                    onClick={handleEnhanceContext}
                    disabled={isEnhancingContext || !additionalContext.trim()}
                    className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:bg-scripts-500/10 hover:text-scripts-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isEnhancingContext ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Enhance Prompt
                  </button>
                  <button
                    type="button"
                    title="Clear prompt"
                    onClick={handleContextClear}
                    disabled={isEnhancingContext || !additionalContext.trim()}
                    className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Eraser className="h-3 w-3" />
                    Clear Prompt
                  </button>
                  <button
                    type="button"
                    title="Undo"
                    onClick={handleContextUndo}
                    disabled={!canUndoContext || isEnhancingContext}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Undo2 className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    title="Redo"
                    onClick={handleContextRedo}
                    disabled={!canRedoContext || isEnhancingContext}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Redo2 className="h-3 w-3" />
                  </button>
                </div>
                <ExpandButton onClick={() => setExpandedField('additionalContext')} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Generate button — pinned to the app window's bottom edge on mobile.
          Opaque bg: backdrop-filter doesn't re-blur inside the already-blurred
          window frame, so any alpha lets content underneath ghost through. */}
      <div className="fixed bottom-0 left-0 right-0 z-30 shrink-0 border-t border-ink/5 bg-surface-0 px-5 py-4 md:static md:left-auto md:right-auto md:z-auto md:bg-transparent">
        {/* Variations — how many takes this generate returns. Shown for both
            modes; hidden for Hooks (fixed at HOOK_COUNT) and for the blueprint
            rewrite, which returns a single rewritten script. */}
        {!isHooksFormat && !blueprintActive && (
          <div className="mb-3">
            <SegmentedToggle<string>
              className="h-12 !p-1"
              accent="scripts"
              value={String(variationCount)}
              onChange={(v) => onVariationCountChange(Number(v) as VariationCount)}
              options={VARIATION_COUNTS.map((n) => ({ value: String(n), label: `${n} variations` }))}
            />
          </div>
        )}
        {/* Length — pinned directly above Generate. Hooks are one-liners, so the
            format has no duration and the toggle hides; only Write New offers it. */}
        {mode === 'write' && !isHooksFormat && (
          <div className="mb-3">
            <SegmentedToggle<string>
              className="h-12 !p-1"
              accent="scripts"
              value={String(writeLength)}
              onChange={(v) => onWriteLengthChange(Number(v) as WriteLength)}
              options={WRITE_LENGTHS.map((len) => ({ value: String(len), label: `${len}s` }))}
            />
          </div>
        )}
        <button
          onClick={() => onGenerate(editableContext)}
          disabled={!canGenerate || isGenerating}
          className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-scripts-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] btn-soft-shadow transition-all hover:bg-scripts-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{mode === 'write' ? (writeFormat === 'hooks' ? `Writing ${HOOK_COUNT} Hooks...` : `Writing ${variationCount} Takes...`) : blueprintActive ? 'Rewriting Scene Prompts...' : `Generating ${variationCount} Script Variations...`}</span>
            </>
          ) : blocker ? (
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

      {/* Edit product details — opens in a right slide-over with full-size
          fields, so you never scroll the form or fight tiny inline boxes. */}
      <SlideOver
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Edit product details"
        subtitle="Edit for this script, or push the changes back to your bank"
        footer={
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSaveForScript}
              className="w-full rounded-full border border-white/15 bg-scripts-500 px-5 py-2.5 text-[13px] font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-colors hover:bg-scripts-400"
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
            <EditableField label="Target Market" value={editableContext.targetMarket} onChange={(v) => updateField('targetMarket', v)} />
            <EditableField label="Pain Points" value={editableContext.painPoints} onChange={(v) => updateField('painPoints', v)} />
            <EditableField label="USPs" value={editableContext.usps} onChange={(v) => updateField('usps', v)} />
            <EditableField label="Benefits" value={editableContext.benefits} onChange={(v) => updateField('benefits', v)} />
            <EditableField label="Key Specs & Facts" value={editableContext.keySpecs} onChange={(v) => updateField('keySpecs', v)} />
            <EditableField label="Customer Language" value={editableContext.customerLanguage} onChange={(v) => updateField('customerLanguage', v)} />
            <EditableField label="Objections" value={editableContext.objections} onChange={(v) => updateField('objections', v)} />
            <EditableField label="Offer" value={editableContext.offer} onChange={(v) => updateField('offer', v)} />
            <EditableField label="CTA" value={editableContext.cta} onChange={(v) => updateField('cta', v)} />
          </div>
        )}
      </SlideOver>

      {/* Style picker — opens from the right; tap a style to select it. */}
      <SlideOver
        open={styleSlideOpen}
        onClose={() => setStyleSlideOpen(false)}
        title="Choose a style"
        subtitle="What kind of content the ad looks like — and how it's built"
        size="wide"
      >
        {/* Two sections: Structures (how the argument is built) and Formats
            (the kind of content the ad imitates). Formats also stage the shots
            in the Scenes output, so they're worth telling apart at the picker.
            Shared with B-Roll, which picks from the same list. */}
        <ScriptStyleList
          formatsFirst
          value={styleChosen ? writeStyle : null}
          onSelect={(style) => { onWriteStyleChange(style); setStyleChosen(true); setStyleSlideOpen(false) }}
        />
      </SlideOver>

      {/* Hook family picker — mirrors the style slide-over. 'auto' leads. */}
      <SlideOver
        open={hookSlideOpen}
        onClose={() => setHookSlideOpen(false)}
        title="Choose a hook style"
        subtitle={`Which formula family the ${HOOK_COUNT} hooks draw from`}
        size="wide"
      >
        <div className="flex flex-col gap-2 p-4">
          {(Object.keys(HOOK_CATEGORY_META) as HookCategoryChoice[]).map((choice) => {
            const active = choice === hookCategory
            return (
              <button
                key={choice}
                type="button"
                onClick={() => { onHookCategoryChange(choice); setHookSlideOpen(false) }}
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
      </SlideOver>

      <ExpandTextModal
        open={expandedField === 'brief'}
        onClose={() => { commitBriefDraft(); setExpandedField(null) }}
        value={brief}
        onChange={handleBriefType}
        title="Describe Your Ad"
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
        title="Additional Context"
        accent="scripts"
        placeholder="Additional context for this generation…"
      />
    </div>
  )
}

// Section heading for every field in the form — 13px, no leading number, the
// same size as the Voiceovers settings subheadings (SETTING_LABEL). An optional
// `tooltip` turns the label into a dotted-underline hint that reveals guidance
// on hover (same pattern as the Voiceovers sliders), keeping the form clean of
// always-on helper text.
function StepLabel({ label, tooltip, optional }: { label: string; tooltip?: string; optional?: boolean }) {
  const [hover, setHover] = useState(false)
  return (
    <span
      className={`relative inline-block text-[13px] font-medium text-ink-200 ${tooltip ? 'cursor-help' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      tabIndex={tooltip ? 0 : -1}
    >
      <span className={tooltip ? 'underline decoration-dotted decoration-ink-600 underline-offset-4' : ''}>
        {label}
      </span>
      {optional && <span className="ml-2 inline-block rounded-full bg-ink/5 px-2 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-ink-500">optional</span>}
      {tooltip && hover && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-72 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12px] font-normal leading-snug text-ink-100 shadow-xl ring-1 ring-ink/10"
        >
          {tooltip}
        </span>
      )}
    </span>
  )
}

// A bank-pick card for the remix / scene source. Dashed "Click to select"
// when empty; a solid filled pill with a hover refresh icon + an X-clear when a
// bank item is selected — mirrors the B-Roll reference cards.
function ScriptBankCard({
  selected,
  label,
  icon: Icon,
  accentClass,
  onSelect,
  onClear,
  className,
  flat,
}: {
  selected: Script | null
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
        className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
          flat
            ? 'border-b border-dashed border-ink/10 hover:bg-ink/[0.04]'
            : 'rounded-full border border-dashed border-ink/10 bg-ink/[0.015] hover:border-ink/20 hover:bg-ink/[0.03]'
        } ${className ?? ''}`}
      >
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
      className={`group flex w-full cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${
        flat
          ? 'border-b border-ink/10 hover:bg-ink/[0.04]'
          : 'rounded-full border border-ink/10 bg-ink/[0.02] hover:border-ink/20 hover:bg-ink/[0.04]'
      } ${className ?? ''}`}
    >
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
