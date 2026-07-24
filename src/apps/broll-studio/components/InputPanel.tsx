import { useState, useRef, useEffect } from 'react'
import { Package, UserRound, FileText, RefreshCw, Loader2, Film, X, ChevronRight, Clapperboard, AlertTriangle, Rows3, Star, Box, ImagePlus, Sparkles, Coins, Palette, Pencil } from 'lucide-react'
import type { Product, Model, Script } from '../../../stores/types'
import type { BrollMode, OneShotDelivery } from '../types'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import ExpandTextModal, { ExpandButton } from '../../../components/ExpandableText'
import SegmentedToggle from '../../../components/SegmentedToggle'
import ClearAllButton from '../../../components/ClearAllButton'
import ModelSidePanel from '../../../components/ModelSidePanel'
import SlideOver from '../../../components/SlideOver'
import ProviderLogo from '../../../components/ProviderLogo'
import SavingsPill from '../../../components/SavingsPill'
import { useSettingsStore } from '../../../stores/settingsStore'
import { ONE_SHOT_MODEL_IDS, ONE_SHOT_ENABLED_MODEL_IDS, estimateSpokenSeconds, planSegments } from '../services/generateOneShot'
import { CONTINUOUS_STYLES } from '../services/generateContinuous'
import { estimatePromptCredits } from '../services/promptCost'
import { getModel, officialSavingsPercent, formatCredits } from '../../../utils/models'

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
  isGenerating: boolean
  highlightField?: string | null
  // Line by Line vs One Shot. One Shot swaps the right panel for concept
  // cards and reveals the delivery toggle + video-model picker below.
  mode: BrollMode
  onModeChange: (mode: BrollMode) => void
  // Line-by-Line delivery toggle. 'dialogue' adds one talking card per scene.
  lineDelivery: OneShotDelivery
  onLineDeliveryChange: (delivery: OneShotDelivery) => void
  oneShotDelivery: OneShotDelivery
  onOneShotDeliveryChange: (delivery: OneShotDelivery) => void
  oneShotModelId: string
  // Continuous mode (keyframe chain) — visual style only. The video model is
  // NOT picked here: it only matters once there are keyframes to animate, so
  // the picker lives in the clip modal.
  continuousStyleId: string
  onContinuousStyleChange: (styleId: string) => void
  // Style reference frames (memory-only data URIs) + the style brief the
  // vision pass distils out of them. A brief overrides the preset chips.
  styleRefs: string[]
  onAddStyleRefs: (files: File[]) => void
  onRemoveStyleRef: (index: number) => void
  onClearStyleRefs: () => void
  onAnalyzeStyleRefs: () => void
  // Opens the bank picker (in the parent) to add saved stills as style refs.
  onPickStyleRefsFromBank: () => void
  isAnalyzingStyle: boolean
  continuousStyleBrief: string | null
  onClearStyleBrief: () => void
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

// Right slide-in listing the preset visual styles — same chrome as the Video
// Model / Character-preset pickers so every "pick from a panel" reads alike.
function StyleSlideOver({
  open,
  onClose,
  value,
  onPick,
}: {
  open: boolean
  onClose: () => void
  value: string
  onPick: (id: string) => void
}) {
  return (
    <SlideOver open={open} onClose={onClose} title="Choose a style" subtitle="The look every clip is rendered in">
      <div className="flex flex-col gap-2 p-4">
        {CONTINUOUS_STYLES.map((s) => {
          const active = s.id === value
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => { onPick(s.id); onClose() }}
              className={`flex items-center gap-3 rounded-full border px-4 py-3 text-left transition-colors ${
                active
                  ? 'border-broll-500/30 bg-broll-500/10'
                  : 'border-ink/5 bg-ink/[0.02] hover:border-ink/10 hover:bg-ink/[0.04]'
              }`}
            >
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${active ? 'bg-broll-500/10 text-broll-400' : 'bg-ink/5 text-ink-500'}`}>
                <Palette className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[13px] font-medium tracking-tight ${active ? 'text-broll-300' : 'text-ink-200'}`}>
                  {s.label}
                </div>
                <div className="line-clamp-2 text-[11px] leading-snug text-ink-500">{s.hint}</div>
              </div>
            </button>
          )
        })}
      </div>
    </SlideOver>
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
  isGenerating,
  highlightField,
  mode,
  onModeChange,
  lineDelivery,
  onLineDeliveryChange,
  oneShotDelivery,
  onOneShotDeliveryChange,
  oneShotModelId,
  continuousStyleId,
  onContinuousStyleChange,
  styleRefs,
  onAddStyleRefs,
  onRemoveStyleRef,
  onClearStyleRefs,
  onAnalyzeStyleRefs,
  onPickStyleRefsFromBank,
  isAnalyzingStyle,
  continuousStyleBrief,
  onClearStyleBrief,
}: InputPanelProps) {
  const hasScript = scriptText.trim().length > 0
  const canGenerate = hasScript
  const [scriptExpanded, setScriptExpanded] = useState(false)
  const [instructionsExpanded, setInstructionsExpanded] = useState(false)
  const [modelPanelOpen, setModelPanelOpen] = useState(false)
  // Popover that asks where to pull style-reference frames from (bank or upload).
  const [styleSourceOpen, setStyleSourceOpen] = useState(false)
  const styleSourceRef = useRef<HTMLDivElement>(null)
  // Slide-in picker for the preset visual style (mirrors the Video Model picker).
  const [stylePanelOpen, setStylePanelOpen] = useState(false)
  const isOneShot = mode === 'oneshot'
  const isContinuous = mode === 'continuous'
  const hasRefs = !!selectedProduct?.productImage || !!selectedModel?.characterImage

  // Estimated cost of the prompt-writing call behind the Generate button. These
  // are chat completions, so it's fractions of a credit — the pill is there so
  // nothing ever fires unpriced, not because the number is large.
  const promptCredits = hasScript ? formatCredits(estimatePromptCredits(mode, scriptText)) : null

  // Live split preview: spoken seconds → clip count on the selected model.
  // Recomputed on every keystroke so the user sees the plan before paying.
  const estSeconds = hasScript ? estimateSpokenSeconds(scriptText) : 0
  const plan = isOneShot && hasScript ? planSegments(estSeconds, oneShotModelId) : null
  const perClipSeconds = plan ? Math.min(plan.maxClipSeconds, Math.max(4, Math.ceil(estSeconds / plan.count))) : undefined
  const oneShotModel = getModel(oneShotModelId)
  const oneShotModelSupportsRefs = !!oneShotModel?.modes?.includes('reference-to-video')
  // Preset style shown on the slide-in picker's trigger.
  const currentStyle = CONTINUOUS_STYLES.find((s) => s.id === continuousStyleId) ?? CONTINUOUS_STYLES[0]

  // Close the reference-source popover on an outside click or Escape.
  useEffect(() => {
    if (!styleSourceOpen) return
    const onDown = (e: PointerEvent) => {
      if (styleSourceRef.current && !styleSourceRef.current.contains(e.target as Node)) setStyleSourceOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setStyleSourceOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [styleSourceOpen])

  return (
    <div className="flex flex-col md:h-full">
      {/* Mode toggle header — One-Shot (script → full multi-cut video concepts)
          vs Line-by-Line (script → per-line b-roll stills). Sits in a 57px bar
          so its border-b lines up with the right panel's Concepts/History
          strip, matching every other app's aligned top rule. */}
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
            { value: 'oneshot', label: 'One-Shot', icon: Clapperboard },
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
          <ClearAllButton onClear={onClearInputs} label="New" className="shrink-0" />
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
              merged into one rounded box so the two sources read as one input.
              In One-Shot the script box doesn't grow — there's a stack of
              controls below it (model, clip type) that should stay in view. */}
          <div className={`flex min-h-0 flex-col overflow-hidden rounded-3xl border transition-colors ${isOneShot ? '' : 'flex-1'} ${selectedScript ? 'border-scripts-500/30 bg-scripts-500/[0.06] focus-within:border-scripts-500/50' : 'border-dashed border-ink/10 bg-ink/[0.02] focus-within:border-ink/20'} ${highlightField === 'script' ? 'animate-field-flash' : ''}`}>
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

      {/* Render-settings + Generate band — the video model, clip type, and visual
          style are the controls that shape the output, so they dock together in
          one tinted panel directly above the Generate button (the Characters tab
          groups its model + chips + button the same way). Sticky on mobile,
          static rounded-top card on desktop. */}
      <div className="sticky bottom-0 z-30 border-t border-ink/5 bg-surface-0 px-5 py-3 md:static md:z-auto md:rounded-t-2xl md:border md:border-b-0 md:border-ink/5 md:bg-ink/[0.03]">
        <div className="mb-2.5 flex flex-col gap-2">

          {/* One Shot video model — picked BEFORE generation because the
              script split is planned against this model's max clip length
              (15s Seedance / Kling, 10s Gemini Omni). */}
          {isOneShot && (
            <div>
              <div>
                {/* Slide-in side-panel picker (same as the detail modal). */}
                <button
                  type="button"
                  onClick={() => setModelPanelOpen(true)}
                  className="flex h-12 w-full items-center gap-2.5 rounded-full border border-ink/10 bg-ink/[0.02] px-3 text-left transition-colors hover:bg-ink/[0.05]"
                >
                  {oneShotModel ? (
                    <>
                      <ProviderLogo provider={oneShotModel.provider ?? ''} />
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate text-[13px] font-medium text-ink-100">{oneShotModel.displayName}</span>
                        {oneShotModel.tags.includes('recommended') && (
                          <Star className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400 light:fill-yellow-600 light:text-yellow-600" strokeWidth={1.5} />
                        )}
                        {officialSavingsPercent(oneShotModelId) != null && (
                          <SavingsPill pct={officialSavingsPercent(oneShotModelId)!} />
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="flex-1 truncate text-sm text-ink-400">Select model</span>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
                </button>
                <ModelSidePanel
                  appId="broll-studio"
                  task="video"
                  allowedModelIds={ONE_SHOT_MODEL_IDS}
                  enabledModelIds={ONE_SHOT_ENABLED_MODEL_IDS}
                  value={oneShotModelId}
                  onChange={(id) => useSettingsStore.getState().setAppModel('broll-studio:oneshot:video', id)}
                  isOpen={modelPanelOpen}
                  onClose={() => setModelPanelOpen(false)}
                  requireMode={hasRefs ? 'reference-to-video' : undefined}
                  requireModeNote="Greyed-out models aren't built for One-Shot's ref + audio multi-cut — they'd drop your refs and render a plain text-to-video clip."
                  costParams={perClipSeconds ? { durationSeconds: perClipSeconds } : undefined}
                />
              </div>
              {plan?.capped && (
                <p className="mt-1 flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-amber-300 light:text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>~{estSeconds}s of speech won't fit comfortably in {plan.count} clips — trim the script or use Line-by-Line.</span>
                </p>
              )}
              {hasRefs && !oneShotModelSupportsRefs && (
                <p className="mt-1 flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-amber-300 light:text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{getModel(oneShotModelId)?.displayName ?? 'This model'} can't take reference images — clips will match your refs by description only.</span>
                </p>
              )}
            </div>
          )}

          {/* One Shot delivery — does the character speak the script on camera
              ("With Dialogue"), or is this pure b-roll footage a voiceover gets
              laid over in the edit ("B-Roll Clips")? Both carry diegetic audio,
              so neither is truly "silent". */}
          {isOneShot && (
            <SegmentedToggle<OneShotDelivery>
              className="h-12 !p-1"
              value={oneShotDelivery}
              onChange={onOneShotDeliveryChange}
              accent="broll"
              options={[
                { value: 'dialogue', label: 'With Dialogue' },
                { value: 'silent', label: 'B-Roll Clips' },
              ]}
            />
          )}

          {/* Line-by-Line delivery — "With Dialogue" adds one talking-to-camera
              card per scene (the character speaks the line) alongside three
              silent b-roll cards; "B-Roll Clips" keeps every card silent. */}
          {mode === 'line' && (
            <SegmentedToggle<OneShotDelivery>
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

          {/* Visual style + reference frames — two separate pills, half & half:
              the left opens the slide-in preset picker; the right opens the
              pick/upload menu for your own style frames. Both carry a chevron
              so they read as clickable. A locked custom style (distilled from
              those frames) replaces the whole row. */}
          {continuousStyleBrief ? (
            <div className="order-first rounded-2xl border border-broll-500/25 bg-broll-500/10 px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-broll-300">Custom style locked</span>
                <button
                  type="button"
                  onClick={onClearStyleBrief}
                  title="Drop the custom style and go back to the presets"
                  className="shrink-0 rounded-full p-0.5 text-ink-400 transition-colors hover:bg-ink/10 hover:text-ink-200"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-ink-400">{continuousStyleBrief}</p>
            </div>
          ) : (
            <div className="order-first flex items-center gap-2">
              {/* Visual style — opens the slide-in style picker. */}
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setStylePanelOpen(true)}
                  className="flex h-12 w-full items-center gap-2.5 rounded-full border border-dashed border-ink/10 bg-ink/[0.02] px-3.5 text-left transition-colors hover:border-ink/20 hover:bg-ink/[0.05]"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-broll-500/10 text-broll-400 light:text-broll-600">
                    <Palette className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-100">{currentStyle.label}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" strokeWidth={2} />
                </button>
              </div>

              {/* Reference frames — click asks bank or upload. The AI reads
                  only the LOOK of these frames, never their content. */}
              <div className="relative min-w-0 flex-1" ref={styleSourceRef}>
                <button
                  type="button"
                  onClick={() => setStyleSourceOpen((v) => !v)}
                  className="flex h-12 w-full items-center gap-2.5 rounded-full border border-dashed border-ink/10 bg-ink/[0.02] px-3.5 text-left transition-colors hover:border-ink/20 hover:bg-ink/[0.05]"
                >
                  <span className="shrink-0 rounded-full bg-ink/5 p-1.5">
                    <ImagePlus className="h-4 w-4 text-ink-500" strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-100">
                    {styleRefs.length > 0
                      ? `${styleRefs.length} reference${styleRefs.length === 1 ? '' : 's'}`
                      : 'Upload Style'}
                  </span>
                </button>
                {styleSourceOpen && (
                  <div className="absolute bottom-full left-0 right-0 z-40 mb-1 overflow-hidden rounded-2xl border border-ink/10 bg-surface-2/95 p-1 shadow-xl backdrop-blur-xl">
                    <button
                      type="button"
                      onClick={() => { setStyleSourceOpen(false); onPickStyleRefsFromBank() }}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-medium text-ink-200 transition-colors hover:bg-ink/[0.06]"
                    >
                      <Package className="h-3.5 w-3.5 text-ink-400" strokeWidth={1.5} />
                      Choose from Bank
                    </button>
                    <label className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-medium text-ink-200 transition-colors hover:bg-ink/[0.06]">
                      <ImagePlus className="h-3.5 w-3.5 text-ink-400" strokeWidth={1.5} />
                      Upload images
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? [])
                          if (files.length > 0) onAddStyleRefs(files)
                          e.target.value = ''
                          setStyleSourceOpen(false)
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Selected reference frames + the analyze-to-lock action. */}
          {styleRefs.length > 0 && !continuousStyleBrief && (
            <div className="order-first flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {styleRefs.map((ref, i) => (
                  <div key={i} className="group/ref relative h-14 w-14 overflow-hidden rounded-xl border border-ink/10">
                    <img src={ref} alt={`Style reference ${i + 1}`} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => onRemoveStyleRef(i)}
                      title="Remove"
                      className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover/ref:opacity-100"
                    >
                      <X className="h-3.5 w-3.5 text-white" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClearStyleRefs}
                  className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-300"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={onAnalyzeStyleRefs}
                  disabled={isAnalyzingStyle}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-broll-500/30 bg-broll-500/10 px-3 py-2 text-[11px] font-medium text-broll-200 transition-colors hover:bg-broll-500/20 disabled:cursor-not-allowed disabled:opacity-50 light:text-broll-700"
                >
                  {isAnalyzingStyle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {isAnalyzingStyle ? 'Reading the style…' : `Analyze style from ${styleRefs.length} image${styleRefs.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onGenerate}
          disabled={!canGenerate || isGenerating}
          className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-broll-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] btn-soft-shadow transition-all hover:bg-broll-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{isOneShot ? 'Generating Variations...' : isContinuous ? 'Storyboarding...' : 'Generating Prompts...'}</span>
            </>
          ) : (
            <>
              {isOneShot ? (
                <Clapperboard className="h-4 w-4" strokeWidth={2.5} />
              ) : isContinuous ? (
                <Box className="h-4 w-4" strokeWidth={2.5} />
              ) : (
                <Film className="h-4 w-4" strokeWidth={2.5} />
              )}
              <span>
                {isOneShot ? 'Generate Variations' : isContinuous ? 'Generate Storyboard' : 'Generate B-Roll Prompts'}
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
            Select or paste a script to get started
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

      <StyleSlideOver
        open={stylePanelOpen}
        onClose={() => setStylePanelOpen(false)}
        value={continuousStyleId}
        onPick={onContinuousStyleChange}
      />
    </div>
  )
}
