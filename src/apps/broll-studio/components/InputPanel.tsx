import { useState } from 'react'
import { Package, UserRound, FileText, RefreshCw, Loader2, Film, X, ChevronRight, Rows3, Box, Sparkles, Coins, Palette, Pencil, FileInput, MessageSquareQuote } from 'lucide-react'
import type { Product, Model, Script } from '../../../stores/types'
import { isLineMode, type BrollDelivery, type BrollMode } from '../types'
import ScriptModelRow from '../../../components/ScriptModelRow'
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
  // app instead of paying for the prompt-writing call. Works in both modes.
  onImportPrompts: () => void
  isGenerating: boolean
  highlightField?: string | null
  // Line-by-Line vs Continuous, which swaps the right panel for the
  // keyframe-chain storyboard.
  mode: BrollMode
  onModeChange: (mode: BrollMode) => void
  // Line-by-Line delivery — whether the cards speak. Not a mode: both produce
  // the same per-line storyboard, so it rides in the settings band.
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
  emptyHint,
  optional,
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
  // Sub-label shown in the empty state, replacing the default bank prompt. Use
  // when the slot's job needs saying — the Script slot is optional here, and a
  // card that only says "click to select" reads as required.
  emptyHint?: string
  // Shows an OPTIONAL tag in the empty state, same shape as the Brief pill's.
  optional?: boolean
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
        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
          flat
            ? 'border-b border-dashed border-ink/10 hover:bg-ink/[0.04]'
            : 'rounded-full border border-dashed border-ink/10 hover:border-ink/20 hover:bg-ink/[0.02]'
        } ${className ?? ''}`}
      >
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${accentClass}`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </div>
        {/* 13px: the same trigger text every ModelPicker uses, so a picker
            row reads the same weight wherever it appears in the app. The two
            settings-band rows below match it. */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink-300">{label}</p>
          <p className="truncate text-[11px] text-ink-600">{emptyHint ?? 'Click to select from bank'}</p>
        </div>
        {/* The OPTIONAL tag takes the chevron's slot rather than sitting beside
            it — this column is 25% wide and three trailing elements wrapped the
            label onto two lines and the hint onto five. */}
        {optional ? (
          <span className="shrink-0 rounded-full border border-ink/10 bg-ink/[0.03] px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-ink-500">
            Optional
          </span>
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
        )}
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
      className={`group flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
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
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-500/15 text-gold-400 light:text-gold-600">
          <Package className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink-200">{product.productName}</p>
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
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-influencers-500/15 text-influencers-400">
          <UserRound className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink-200">{model.name}</p>
        <p className="truncate text-[11px] text-ink-500">Character</p>
      </div>
    </div>
  )
}

function ScriptCard({ script }: { script: Script | null }) {
  const title = script?.title ?? 'Imported Script'
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-scripts-500/15 text-scripts-text">
        <FileText className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink-200">{title}</p>
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
  // The script gates the run now that B-Roll no longer writes one, alongside
  // the look. The ad format is still the pick that shapes the shots, but it
  // isn't in the gate: sessions that predate the format row have a script and
  // no format, and a storyboard without staging is a plain UGC storyboard, not
  // a broken one.
  const canGenerate = hasScript && styleChosen
  const [scriptExpanded, setScriptExpanded] = useState(false)
  const [instructionsExpanded, setInstructionsExpanded] = useState(false)
  const isContinuous = mode === 'continuous'

  // Estimated cost of the prompt-writing call behind the Generate button. These
  // are chat completions, so it's fractions of a credit — the pill is there so
  // nothing ever fires unpriced, not because the number is large. Two ways it
  // comes back null and hides: no script to measure yet, or a picked chat model
  // with no verified per-token rate (see the registry's "NO CREDIT FIGURES").
  const promptCredits = hasScript ? formatCredits(estimatePromptCredits(mode, scriptText, lineDelivery)) : null

  return (
    <div className="flex flex-col md:h-full">
      {/* Mode toggle header — the two shapes of workspace this app has:
          Line-by-Line (script → per-line shot prompts) vs Continuous (script →
          keyframe chain). Whether the cards SPEAK is not a mode — both
          deliveries produce the same per-line storyboard — so that's a toggle
          in the settings band. Sits in a 57px bar so its border-b lines up with
          the right panel's Storyboard/History strip, matching every other app's
          aligned top rule. */}
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
          {/* Sentence-case 13px label — the Voiceovers side panel's subheading
              size, so a section label reads the same in both apps. */}
          <span className="text-[13px] font-medium text-ink-200">References</span>
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
        <div className="flex grow flex-col gap-2">
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

          {/* Script — optional, and labelled as such. Bring your own words from
              the bank or a paste. It and the Instructions box below share the
              column's leftover height (`flex-1`, no `basis-0`): each one's base
              size is its own content, so a pasted script grows its box while an
              empty brief stays a strip, and whatever is still spare is split
              between them. With basis-0 they were always an even split whatever
              was in them — a matched pair on an empty panel, and a script fighting
              for room the moment one was pasted in. */}
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border transition-colors ${selectedScript ? 'border-scripts-500/30 bg-scripts-500/[0.06] focus-within:border-scripts-500/50' : 'border-dashed border-ink/10 bg-ink/[0.02] focus-within:border-ink/20'} ${highlightField === 'script' ? 'animate-field-flash' : ''}`}>
            <BankCard
              icon={FileText}
              label="Script / Hooks"
              accentClass="bg-scripts-500/15 text-scripts-text"
              selectedClass="border-scripts-500/30 bg-scripts-500/[0.06] hover:bg-scripts-500/10"
              isEmpty={!selectedScript}
              emptyHint="Or let the format write it"
              optional={!hasScript}
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
                rows={1}
                // flex-1 above hands this box every spare pixel in the column,
                // so the min-height is only the floor it gives way to on a short
                // window — not the size it normally renders at.
                placeholder="…or paste your own script here"
                className="min-h-[56px] w-full grow resize-none border-0 bg-transparent px-4 py-2.5 text-[13px] leading-relaxed text-ink-200 placeholder-ink-700 outline-none"
              />
              <ExpandButton onClick={() => setScriptExpanded(true)} className="absolute bottom-2 right-2" />
            </div>
          </div>

          {/* Additional instructions — a real textarea you type straight into.
              It was a pill that opened a centred editor popup, which put a
              click and a modal between the member and one line of direction;
              this is a text field, so it should behave like one. The popup is
              still one tap away on the expand button for anything longer.
              Doubles as the creative brief when there's no script yet — the
              product row carries the rest, so blank stays a normal answer. */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-dashed border-ink/10 bg-ink/[0.02] transition-colors focus-within:border-ink/20">
            <div className="flex items-center justify-between gap-2 px-4 pt-2.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <Pencil className="h-3.5 w-3.5 shrink-0 text-ink-500" strokeWidth={2} />
                <span className="truncate text-[13px] font-medium text-ink-200">
                  {hasScript ? 'Instructions' : 'Brief'}
                </span>
              </div>
              <span className="shrink-0 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">
                optional
              </span>
            </div>
            <textarea
              value={additionalContext}
              onChange={(e) => onAdditionalContextChange(e.target.value)}
              rows={1}
              placeholder={hasScript
                ? 'Mood, specific angles, things to avoid…'
                : "What's this ad about? The product's own details already drive the script."}
              className="min-h-[46px] w-full grow resize-none border-0 bg-transparent px-4 pb-2.5 pt-1.5 text-[13px] leading-relaxed text-ink-200 placeholder-ink-700 outline-none"
            />
            <ExpandButton onClick={() => setInstructionsExpanded(true)} className="absolute bottom-2 right-2" />
          </div>

        </div>
      </div>

      {/* Render-settings + Generate band. It used to be a tinted, bordered card
          docked at the bottom of the column; the border drew a panel inside the
          panel, so it's gone and the rows sit straight on the column. Sticky on
          mobile (where it floats over scrolling content, hence the opaque fill
          — see the note under bg-surface-0), plain and static on desktop. */}
      <div className="sticky bottom-0 z-30 bg-surface-0 px-5 py-2.5 md:static md:z-auto md:bg-transparent">
        <div className="mb-2 flex flex-col gap-2">

          {/* The two decisions that shape the output, docked together above
              Generate — and the two things Generate is gated on. The
              References column above says what the ad is ABOUT (product,
              character, words); this pair says what it IS: how it looks
              (Visual Style) and how it's shot (Ad Format). One bordered block
              rather than two stacked ones: that cost a border, a padding pair
              and a gap the column couldn't spare, and they read as a single
              decision anyway. They sit as plain rows in the band, the same
              size and width as the reference cards above, rather than boxed
              inside their own bordered card — and with no uppercase eyebrow
              labels, which only repeated what the rows already say.

              Each row opens its own picker — StyleModal for the look (presets,
              your saved styles, and the analyse-from-references flow), the
              Formats/Structures slide-over for the format. Both are dashed and
              asking to be filled until picked, accent-filled with a clear X
              after; a custom style shows its name with a Custom tag. */}
          <div
            role="button"
            tabIndex={0}
            onClick={onOpenStyle}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStyle() } }}
            title={styleChosen ? styleHint : 'How every clip looks'}
            className={`group flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-full border px-3 text-left transition-colors ${
              styleChosen
                ? 'border-broll-500/25 bg-broll-500/[0.07] hover:border-broll-500/35 hover:bg-broll-500/10'
                : 'border-dashed border-ink/10 bg-ink/[0.02] hover:border-broll-500/30 hover:bg-broll-500/5'
            }`}
          >
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${styleIsCustom ? 'bg-broll-500/20 text-broll-300' : 'bg-broll-500/10 text-broll-400 light:text-broll-600'}`}>
              {styleIsCustom ? <Sparkles className="h-4 w-4" strokeWidth={1.75} /> : <Palette className="h-4 w-4" strokeWidth={1.5} />}
            </div>
            {/* One line, at the delivery toggle's height — the band's three
                controls are a matched set, and the second line was a hint the
                picker gives better (unpicked) or a truncated brief every card's
                StyleNote already carries (picked). It survives as the row's
                tooltip. */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {styleChosen ? (
                <>
                  <span className="truncate text-[13px] font-medium tracking-tight text-broll-200 light:text-broll-700">{styleLabel}</span>
                  {styleIsCustom && (
                    <span className="shrink-0 rounded-full bg-broll-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-broll-300 light:text-broll-700">
                      Custom
                    </span>
                  )}
                </>
              ) : (
                <span className="truncate text-[13px] font-medium text-ink-300">Visual Style</span>
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

          {/* The Ad Format row (Formats + Structures, shared out of Scripts)
              stood here and is REMOVED (July 2026), a week after B-Roll stopped
              writing scripts. Once the words came from elsewhere, a format was
              only staging the shots, and the storyboard prompts read better
              staged by the script and the visual style than by a label the
              member had to pick before Generate would light up. `AdFormat`,
              `sceneStagingFor` and `BrollInput.sceneStaging` all survive —
              `AdBlueprintPayload` still feeds staging through that seam — so
              restoring the row is re-adding the picker, not rebuilding the
              plumbing. See git history. */}

          {/* Who writes the shot prompts. Second in the band because it's the
              less often changed of the two: the look is a creative decision made
              per ad, the model is a standing one about intelligence vs. spend.
              className="" because the band spaces its rows with a flex gap, not
              margins; `compact` so it matches the Visual Style row above it and
              the delivery toggle below. */}
          <ScriptModelRow appId="broll-studio" className="" compact />

          {/* Line-by-Line delivery — "B-Roll Clips" (the default) keeps every
              card silent, for a voiceover laid over in the edit; "With
              Dialogue" makes all three the character speaking that line, staged
              three different ways. It sits LAST, directly above Generate: it's
              the switch you'd flip on your way to firing, and it changes what
              comes back more than either row above it. Continuous has no
              deliveries — it's narration over footage — so the toggle isn't
              rendered there at all. */}
          {isLineMode(mode) && (
            <SegmentedToggle<BrollDelivery>
              className="h-11 !p-1"
              value={lineDelivery}
              onChange={onLineDeliveryChange}
              accent="broll"
              options={[
                { value: 'silent', label: 'B-Roll Clips' },
                { value: 'dialogue', label: 'With Dialogue' },
              ]}
            />
          )}

        </div>

        <button
          onClick={onGenerate}
          disabled={!canGenerate || isGenerating}
          className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-broll-500 px-7 py-3.5 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] btn-soft-shadow transition-all hover:bg-broll-400 disabled:opacity-40 disabled:cursor-not-allowed"
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
              ) : lineDelivery === 'dialogue' ? (
                <MessageSquareQuote className="h-4 w-4" strokeWidth={2.5} />
              ) : (
                <Film className="h-4 w-4" strokeWidth={2.5} />
              )}
              <span>
                {isContinuous ? 'Generate Storyboard'
                  : lineDelivery === 'dialogue' ? 'Generate Dialogue Prompts'
                  : 'Generate B-Roll Prompts'}
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
        {/* Nothing under the button: a greyed-out Generate says "you're missing
            something" on its own, and the line that used to sit here only
            existed to warn that an empty script box spent an extra call
            writing one. It doesn't any more. */}
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
        placeholder={hasScript
          ? 'Optional notes for this generation (mood, style preferences, specific angles...)'
          : "What's this ad about? Optional — the product's own details already drive the script (angle, audience, what to avoid...)"}
      />

    </div>
  )
}
