import { useState } from 'react'
import { Package, UserRound, FileText, RefreshCw, Loader2, Film, X, ChevronRight, Rows3, Box, Sparkles, Coins, Palette, Pencil, FileInput } from 'lucide-react'
import type { Product, Model, Script } from '../../../stores/types'
import type { BrollMode, BrollDelivery } from '../types'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import ExpandTextModal, { ExpandButton } from '../../../components/ExpandableText'
import SegmentedToggle from '../../../components/SegmentedToggle'
import ClearAllButton from '../../../components/ClearAllButton'
import { estimatePromptCredits } from '../services/promptCost'
import { formatCredits } from '../../../utils/models'

interface InputPanelProps {
  selectedProduct: Product | null
  selectedModel: Model | null
  selectedScript: Script | null
  scriptText: string
  additionalContext: string
  onSelectProduct: () => void
  onSelectModel: () => void
  onSelectScript: () => void
  onClearProduct: () => void
  onClearModel: () => void
  onClearScript: () => void
  onScriptTextChange: (value: string) => void
  onAdditionalContextChange: (value: string) => void
  // Resets the input column to a blank slate. Inputs only — every generated
  // scene, clip and history row stays exactly where it is.
  onClearInputs: () => void
  onGenerate: () => void
  // Opens the Import-prompts popup — paste in a storyboard written outside the
  // app instead of paying for the prompt-writing call. Works in all three modes.
  onImportPrompts: () => void
  isGenerating: boolean
  highlightField?: string | null
  // Line-by-Line vs Continuous. Continuous swaps the right panel for the
  // keyframe-chain storyboard.
  mode: BrollMode
  onModeChange: (mode: BrollMode) => void
  // Line-by-Line delivery toggle. 'dialogue' adds one talking card per scene.
  lineDelivery: BrollDelivery
  onLineDeliveryChange: (delivery: BrollDelivery) => void
  // Visual style — one row, one popup. The presets, the user's saved styles,
  // and the analyse-from-references flow all live in StyleModal (opened by the
  // parent), so this panel only shows what's picked. The video model is NOT
  // picked here: it only matters once there are keyframes to animate, so that
  // picker lives in the clip modal.
  // The row mirrors Scripts' Script Style row: dashed + prompting until a style
  // is actively picked, accent-filled with a clear X after. It's a required
  // input — nothing generates until the user has chosen a look.
  styleChosen: boolean
  styleLabel: string
  styleHint: string
  styleIsCustom: boolean
  onOpenStyle: () => void
  onClearStyle: () => void
}

function BankCard({
  icon: Icon,
  label,
  accentClass,
  selectedClass,
  isEmpty,
  children,
  onSelect,
  onClear,
  className,
  flat,
}: {
  icon: React.ElementType
  label: string
  accentClass: string
  // Glassy accent fill applied once a reference is selected — keyed to the
  // bank's own colour (amber products, pink influencers, orange scripts) so the
  // populated card "lights up" the way a selected Script Style card does.
  selectedClass: string
  isEmpty: boolean
  children?: React.ReactNode
  onSelect: () => void
  onClear?: () => void
  className?: string
  // Header variant — drops the rounded-full pill shape and accent fill so the
  // card can sit as a flat top row inside a merged input box (border-b instead
  // of its own border). Used for the Script slot, which pairs with the manual
  // paste textarea below it.
  flat?: boolean
}) {
  if (isEmpty) {
    return (
      <button
        onClick={onSelect}
        className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${
          flat
            ? 'border-b border-dashed border-ink/10 hover:bg-ink/[0.04]'
            : 'rounded-full border border-dashed border-ink/10 hover:border-ink/20 hover:bg-ink/[0.02]'
        } ${className ?? ''}`}
      >
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${accentClass}`}>
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-300">{label}</p>
          <p className="text-[11px] text-ink-600">Click to select from bank</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
      </button>
    )
  }

  // Populated state mirrors the empty state's single-row pill so selecting a
  // reference doesn't change the card's shape or height — it stays fully
  // rounded and same-size. Whole card re-opens the picker; the X clears
  // (stopPropagation so it doesn't also re-open).
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={`group flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors ${
        flat
          ? 'border-b border-ink/10 hover:bg-ink/[0.04]'
          : `rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${selectedClass}`
      } ${className ?? ''}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="hidden items-center rounded-md px-2 py-0.5 text-ink-500 group-hover:flex">
          <RefreshCw className="h-2.5 w-2.5" />
        </span>
        {onClear && (
          <button
            onClick={(e) => { e.stopPropagation(); onClear() }}
            title={`Remove ${label.toLowerCase()}`}
            aria-label={`Remove ${label.toLowerCase()}`}
            className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-red-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function ProductCard({ product }: { product: Product }) {
  const resolvedImage = useAssetUrl(product.productImage)
  return (
    <div className="flex items-center gap-3">
      {resolvedImage ? (
        <img
          src={resolvedImage}
          alt={product.productName}
          className="h-10 w-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-500/15 text-gold-400 light:text-gold-600">
          <Package className="h-5 w-5" strokeWidth={1.5} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-200">{product.productName}</p>
        <p className="truncate text-[11px] text-ink-500">Product</p>
      </div>
    </div>
  )
}

function ModelCard({ model }: { model: Model }) {
  const resolvedImage = useAssetUrl(model.characterImage)
  return (
    <div className="flex items-center gap-3">
      {resolvedImage ? (
        <img
          src={resolvedImage}
          alt={model.name}
          className="h-10 w-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-influencers-500/15 text-influencers-400">
          <UserRound className="h-5 w-5" strokeWidth={1.5} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-200">{model.name}</p>
        <p className="truncate text-[11px] text-ink-500">Character</p>
      </div>
    </div>
  )
}

function ScriptCard({ script }: { script: Script | null }) {
  const title = script?.title ?? 'Imported Script'
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-scripts-500/15 text-scripts-400">
        <FileText className="h-5 w-5" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-200">{title}</p>
        <p className="truncate text-[11px] text-ink-500">Script</p>
      </div>
    </div>
  )
}

export default function InputPanel({
  selectedProduct,
  selectedModel,
  selectedScript,
  scriptText,
  additionalContext,
  onSelectProduct,
  onSelectModel,
  onSelectScript,
  onClearProduct,
  onClearModel,
  onClearScript,
  onScriptTextChange,
  onAdditionalContextChange,
  onClearInputs,
  onGenerate,
  onImportPrompts,
  isGenerating,
  highlightField,
  mode,
  onModeChange,
  lineDelivery,
  onLineDeliveryChange,
  styleChosen,
  styleLabel,
  styleHint,
  styleIsCustom,
  onOpenStyle,
  onClearStyle,
}: InputPanelProps) {
  const hasScript = scriptText.trim().length > 0
  // Style is a required input, like the script: the look drives every prompt in
  // every mode, so it's an explicit decision rather than a silent default.
  const canGenerate = hasScript && styleChosen
  const [scriptExpanded, setScriptExpanded] = useState(false)
  const [instructionsExpanded, setInstructionsExpanded] = useState(false)
  const isContinuous = mode === 'continuous'

  // Estimated cost of the prompt-writing call behind the Generate button. These
  // are chat completions, so it's fractions of a credit — the pill is there so
  // nothing ever fires unpriced, not because the number is large.
  const promptCredits = hasScript ? formatCredits(estimatePromptCredits(mode, scriptText)) : null

  return (
    <div className="flex flex-col md:h-full">
      {/* Mode toggle header — Line-by-Line (script → per-line b-roll stills) vs
          Continuous (script → keyframe chain). Sits in a 57px bar so its
          border-b lines up with the right panel's Storyboard/History strip,
          matching every other app's aligned top rule. */}
      <div className="flex h-[57px] shrink-0 items-center border-b border-ink/5 px-5">
        <SegmentedToggle<BrollMode>
          className="h-10 !p-1"
          dense
          value={mode}
          onChange={onModeChange}
          accent="broll"
          options={[
            { value: 'line', label: 'Line-by-Line', icon: Rows3 },
            { value: 'continuous', label: 'Continuous', icon: Box },
          ]}
        />
      </div>

      {/* Bank selections */}
      <div className="flex flex-1 flex-col px-5 pb-4 pt-3 md:overflow-y-auto">
        {/* "References" label + the panel-level New reset. It sits here rather
            than in the header band because the three-way mode toggle already
            fills that row in this narrow (25%) pane. */}
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-600">References</span>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Bring your own prompts — write them in Claude (or anywhere) and
                paste them in, instead of paying for the prompt-writing call.
                Sized and styled as ClearAllButton's twin so the two read as one
                pair of panel-level utilities. */}
            <button
              type="button"
              onClick={onImportPrompts}
              title="Paste in prompts written outside the app instead of generating them here"
              className="flex items-center gap-1 rounded-full bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-300"
            >
              <FileInput className="h-2.5 w-2.5" strokeWidth={2.5} />
              Import prompts
            </button>
            <ClearAllButton onClear={onClearInputs} label="New" />
          </div>
        </div>
        <div className="flex grow flex-col gap-2.5">
          {/* Product */}
          <BankCard
            icon={Package}
            label="Product"
            accentClass="bg-gold-500/15 text-gold-400 light:text-gold-600"
            selectedClass="border-gold-500/30 bg-gold-500/[0.06] hover:bg-gold-500/10"
            isEmpty={!selectedProduct}
            onSelect={onSelectProduct}
            onClear={selectedProduct ? onClearProduct : undefined}
          >
            {selectedProduct && <ProductCard product={selectedProduct} />}
          </BankCard>

          {/* Character */}
          <BankCard
            icon={UserRound}
            label="Character"
            accentClass="bg-influencers-500/15 text-influencers-400"
            selectedClass="border-influencers-500/30 bg-influencers-500/[0.06] hover:bg-influencers-500/10"
            isEmpty={!selectedModel}
            onSelect={onSelectModel}
            onClear={selectedModel ? onClearModel : undefined}
          >
            {selectedModel && <ModelCard model={selectedModel} />}
          </BankCard>

          {/* Script — select from bank (header) or paste manually (textarea),
              merged into one rounded box so the two sources read as one input. */}
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border transition-colors ${selectedScript ? 'border-scripts-500/30 bg-scripts-500/[0.06] focus-within:border-scripts-500/50' : 'border-dashed border-ink/10 bg-ink/[0.02] focus-within:border-ink/20'} ${highlightField === 'script' ? 'animate-field-flash' : ''}`}>
            <BankCard
              icon={FileText}
              label="Script / Hooks"
              accentClass="bg-scripts-500/15 text-scripts-400"
              selectedClass="border-scripts-500/30 bg-scripts-500/[0.06] hover:bg-scripts-500/10"
              isEmpty={!selectedScript}
              onSelect={onSelectScript}
              onClear={selectedScript ? onClearScript : undefined}
              flat
            >
              {selectedScript && <ScriptCard script={selectedScript} />}
            </BankCard>
            <div className="relative flex min-h-0 flex-1 flex-col">
              <textarea
                value={scriptText}
                onChange={(e) => onScriptTextChange(e.target.value)}
                rows={5}
                placeholder="…or paste your script text here"
                className="min-h-[92px] w-full grow resize-none border-0 bg-transparent px-4 py-2.5 text-[13px] leading-relaxed text-ink-200 placeholder-ink-700 outline-none"
              />
              <ExpandButton onClick={() => setScriptExpanded(true)} className="absolute bottom-2 right-2" />
            </div>
          </div>

          {/* Additional instructions — a slim, fully-rounded dashed pill; a tap
              opens a centered editor popup (ExpandTextModal) to write in. Shows
              the note (or the placeholder + Optional) on its face. */}
          <button
            type="button"
            onClick={() => setInstructionsExpanded(true)}
            className="flex h-11 w-full items-center gap-2 rounded-full border border-dashed border-ink/10 bg-ink/[0.02] px-4 text-left transition-colors hover:border-ink/20 hover:bg-ink/[0.05]"
          >
            <Pencil className="h-3.5 w-3.5 shrink-0 text-ink-500" strokeWidth={1.5} />
            <span className={`min-w-0 flex-1 truncate text-[13px] ${additionalContext.trim() ? 'font-medium text-ink-100' : 'text-ink-400'}`}>
              {additionalContext.trim() ? additionalContext.trim() : 'Additional Instructions'}
            </span>
            {!additionalContext.trim() && (
              <span className="shrink-0 rounded-full border border-ink/10 bg-ink/[0.03] px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-ink-500">
                Optional
              </span>
            )}
          </button>

        </div>
      </div>

      {/* Render-settings + Generate band — the clip type and visual style are
          the controls that shape the output, so they dock together in one
          tinted panel directly above the Generate button (the Characters tab
          groups its model + chips + button the same way). Sticky on mobile,
          static rounded-top card on desktop. */}
      <div className="sticky bottom-0 z-30 border-t border-ink/5 bg-surface-0 px-5 py-3 md:static md:z-auto md:rounded-t-2xl md:border md:border-b-0 md:border-ink/5 md:bg-ink/[0.03]">
        <div className="mb-2.5 flex flex-col gap-2">

          {/* Line-by-Line delivery — "With Dialogue" adds one talking-to-camera
              card per scene (the character speaks the line) alongside the
              silent b-roll cards; "B-Roll Clips" keeps every card silent. */}
          {mode === 'line' && (
            <SegmentedToggle<BrollDelivery>
              className="h-12 !p-1"
              value={lineDelivery}
              onChange={onLineDeliveryChange}
              accent="broll"
              options={[
                { value: 'dialogue', label: 'With Dialogue' },
                { value: 'silent', label: 'B-Roll Clips' },
              ]}
            />
          )}

          {/* Visual style — one row that opens the style popup (presets, your
              saved styles, and the analyse-from-references flow all live
              there). Same shape as Scripts' Script Style row: dashed and
              asking to be filled until a look is picked, accent-filled with a
              clear X after. A custom style shows its name with a Custom tag. */}
          <div
            role="button"
            tabIndex={0}
            onClick={onOpenStyle}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStyle() } }}
            className={`group order-first flex w-full cursor-pointer items-center gap-3 rounded-full border px-3.5 py-3 text-left transition-colors ${
              styleChosen
                ? 'border-broll-500/25 bg-broll-500/[0.07] hover:border-broll-500/35 hover:bg-broll-500/10'
                : 'border-dashed border-ink/10 bg-ink/[0.02] hover:border-broll-500/30 hover:bg-broll-500/5'
            }`}
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${styleIsCustom ? 'bg-broll-500/20 text-broll-300' : 'bg-broll-500/10 text-broll-400 light:text-broll-600'}`}>
              {styleIsCustom ? <Sparkles className="h-5 w-5" strokeWidth={1.75} /> : <Palette className="h-5 w-5" strokeWidth={1.5} />}
            </div>
            <div className="min-w-0 flex-1">
              {styleChosen ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium tracking-tight text-broll-200 light:text-broll-700">{styleLabel}</span>
                    {styleIsCustom && (
                      <span className="shrink-0 rounded-full bg-broll-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-broll-300 light:text-broll-700">
                        Custom
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] leading-snug text-ink-500">{styleHint}</div>
                </>
              ) : (
                <>
                  <div className="text-sm font-medium text-ink-300">Visual Style</div>
                  <div className="text-xs text-ink-600">Select how every clip looks</div>
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
                  onClick={(e) => { e.stopPropagation(); onClearStyle() }}
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

        <button
          onClick={onGenerate}
          disabled={!canGenerate || isGenerating}
          className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-broll-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] btn-soft-shadow transition-all hover:bg-broll-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{isContinuous ? 'Storyboarding...' : 'Generating Prompts...'}</span>
            </>
          ) : (
            <>
              {isContinuous ? (
                <Box className="h-4 w-4" strokeWidth={2.5} />
              ) : (
                <Film className="h-4 w-4" strokeWidth={2.5} />
              )}
              <span>
                {isContinuous ? 'Generate Storyboard' : 'Generate B-Roll Prompts'}
              </span>
              {promptCredits && (
                <span
                  title="Estimated cost of writing the prompts. Generating the images and videos afterwards is priced separately."
                  className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight"
                >
                  <Coins className="h-3 w-3" strokeWidth={2} />
                  {promptCredits}
                </span>
              )}
            </>
          )}
        </button>
        {!canGenerate && !isGenerating && (
          <p className="mt-2 text-center text-[10px] text-ink-700">
            {!hasScript ? 'Select or paste a script to get started' : 'Choose a visual style to get started'}
          </p>
        )}
      </div>

      <ExpandTextModal
        open={scriptExpanded}
        onClose={() => setScriptExpanded(false)}
        value={scriptText}
        onChange={onScriptTextChange}
        title="Script"
        accent="broll"
        placeholder="Paste your script text here..."
      />
      <ExpandTextModal
        open={instructionsExpanded}
        onClose={() => setInstructionsExpanded(false)}
        value={additionalContext}
        onChange={onAdditionalContextChange}
        title="Additional Instructions"
        accent="broll"
        placeholder="Optional notes for this generation (mood, style preferences, specific angles...)"
      />
    </div>
  )
}
