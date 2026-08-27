import { useState } from 'react'
import { Package, UserRound, FileText, RefreshCw, Film, X, ChevronRight, Rows3, Box, Sparkles, Coins, Palette, Pencil, FileInput, MessageSquareQuote, Layers } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import type { Product, Model, Script } from '../../../stores/types'
import { isLineMode, type BrollDelivery, type BrollMode } from '../types'
import ScriptModelRow from '../../../components/ScriptModelRow'
import SectionCard, { StatusDot } from '../../../components/SectionCard'
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
  required,
  filled,
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
  // when the slot's job needs saying — the Script slot takes a paste as well as
  // a bank pick, and a card that only says "click to select" hides that.
  emptyHint?: string
  // An empty one gets the red dot instead of the neutral one. Every row in
  // B-Roll's References card sets it: the script and the style genuinely gate
  // Generate, and the product and the character are what a UGC storyboard is
  // OF — a run without them technically fires and isn't worth the credits.
  // (This replaced an `optional` flag that painted an OPTIONAL tag on the
  // Script slot, which has been REQUIRED since B-Roll stopped writing scripts.)
  required?: boolean
  // Overrides what the dot reports. The Script slot needs it: pasting into the
  // textarea below fills the input while the header row is still "empty", so
  // `!isEmpty` would leave a red dot over a filled script.
  filled?: boolean
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
        // Empty: the same dashed surface the Visual Style row wears, fill
        // included — it had none, so an unfilled Product read a shade darker
        // than the unfilled style row directly under it.
        className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
          flat
            ? 'border-b border-dashed border-ink/10 hover:bg-ink/[0.04]'
            : 'rounded-full border border-dashed border-ink/10 bg-ink/[0.02] hover:border-ink/20 hover:bg-ink/[0.04]'
        } ${className ?? ''}`}
      >
        <StatusDot filled={filled ?? false} required={required} />
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
      className={`group flex cursor-pointer items-center gap-2.5 px-4 py-2.5 transition-colors ${
        flat
          ? 'border-b border-ink/10 hover:bg-ink/[0.04]'
          : `rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${selectedClass}`
      } ${className ?? ''}`}
    >
      <StatusDot filled={filled ?? true} required={required} />
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
    <div className="flex h-full min-h-0 flex-col">
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

      {/* The phone's scroll port. On a desktop this is a plain wrapper and the
          inputs column below scrolls on its own, with the settings band pinned
          under it as a footer. On a phone there is no room to pin anything:
          the band held the model row and Generate against the bottom edge over
          a column that was already too short for its own fields, so the two of
          them sat on top of the thing being filled in. Here the band is simply
          the END of the page — scroll to the bottom of the inputs and it's the
          next thing under them. */}
      <div className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto">
        {/* Bank selections */}
        {/* pb-0, and the 8px to the band lives on the BAND (`pt-2`), not here.
            It used to be this column's `pb-2`, which is inside the scroller — so
            it was part of the scrolled content and slid out of view the moment
            the column overflowed, which is its normal state once a script is
            pasted in. Measured: the last box sat 2.5px off the band at scroll-top
            (reading as touching), 8.5px scrolled to the bottom. A gap that
            changes as you scroll isn't a gap. On the band it can't scroll away.
            (On a phone the band scrolls WITH the column, so the gap rides along
            with it and the same 8px holds.) */}
        <div className="flex min-h-0 flex-1 flex-col px-5 pb-0 pt-3 md:overflow-y-auto max-md:flex-none">
          {/* The References card — the Influencers section card, holding
              everything the storyboard is built FROM. Its centred header carries
              the panel's two utilities on its edges (Influencers' TabDivider
              shape), which is what the old left-aligned label row did with an
              extra row of its own: Import prompts on the left, New on the right.
              Every row inside puts its status dot at its own left edge, so they
              stack into one column that answers "what's still missing" without
              reading a word. */}
          <SectionCard
            icon={Layers}
            title="References"
            className="mb-2 flex flex-[5] flex-col max-md:flex-none"
            contentClassName="flex flex-1 flex-col gap-2"
            left={
              /* Bring your own prompts — write them in Claude (or anywhere) and
                 paste them in, instead of paying for the prompt-writing call.
                 Sized and styled as ClearAllButton's twin so the two read as one
                 pair of panel-level utilities. */
              <button
                type="button"
                onClick={onImportPrompts}
                title="Paste in prompts written outside the app instead of generating them here"
                className="flex items-center gap-1 rounded-full bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-300"
              >
                <FileInput className="h-2.5 w-2.5" strokeWidth={2.5} />
                Import prompts
              </button>
            }
            right={<ClearAllButton onClear={onClearInputs} label="New" />}
          >
            {/* Product and Character.
                COLOUR: empty, they wear the same dashed surface as the Visual
                Style row below them; filled, each lights up in its own bank's
                colour — amber for products, pink for influencers — the way the
                style row lights up purple. They were briefly neutral in both
                states, which made a filled reference the quietest thing in the
                card: the accent IS the "this is set" signal, and it's the colour
                that says WHICH bank set it.
                DOT: they carried the neutral dot (nothing here holds Generate
                shut but the script and the style). Massimo asked for red, and
                the honest reading is that a UGC storyboard without its product or
                its character isn't a storyboard you'd ship — so they're `required`
                alongside the other two, and all four dots answer one question:
                "have I filled this in?". */}
            <BankCard
              icon={Package}
              label="Product"
              accentClass="bg-gold-500/15 text-gold-400 light:text-gold-600"
              selectedClass="border-gold-500/30 bg-gold-500/[0.07] hover:border-gold-500/40 hover:bg-gold-500/10"
              isEmpty={!selectedProduct}
              required
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
              selectedClass="border-influencers-500/30 bg-influencers-500/[0.07] hover:border-influencers-500/40 hover:bg-influencers-500/10"
              isEmpty={!selectedModel}
              required
              onSelect={onSelectModel}
              onClear={selectedModel ? onClearModel : undefined}
            >
              {selectedModel && <ModelCard model={selectedModel} />}
            </BankCard>

            {/* Script — REQUIRED (half of `canGenerate`), and the only reference
                here that GROWS as you paste, which is why it sits under the two
                bank pills rather than above them: there, every keystroke would
                shove them down the column. Visual Style follows it for the same
                reason it used to lead it — a 58px row that gets pushed down is
                cheaper than three that do.
                Bring your own words from the bank or a paste. It and the
                Instructions box below share the
                column's leftover height (`flex-1`, no `basis-0`): each one's base
                size is its own content, so a pasted script grows its box while an
                empty brief stays a strip, and whatever is still spare is split
                between them. With basis-0 they were always an even split whatever
                was in them — a matched pair on an empty panel, and a script fighting
                for room the moment one was pasted in. */}
            <div className={`flex min-h-[140px] flex-1 flex-col overflow-hidden rounded-3xl border transition-colors max-md:min-h-[220px] max-md:flex-none ${selectedScript ? 'border-scripts-500/30 bg-scripts-500/[0.06] focus-within:border-scripts-500/50' : 'border-dashed border-ink/10 bg-ink/[0.02] focus-within:border-ink/20'} ${highlightField === 'script' ? 'animate-field-flash' : ''}`}>
              <BankCard
                icon={FileText}
                label="Script / Hooks"
                accentClass="bg-scripts-500/15 text-scripts-text"
                selectedClass="border-scripts-500/30 bg-scripts-500/[0.06] hover:bg-scripts-500/10"
                isEmpty={!selectedScript}
                // NOT "Or let the format write it": B-Roll stopped writing
                // scripts in July 2026, so that offered a deleted feature — and
                // the slot wore an OPTIONAL tag while being half of `canGenerate`,
                // which is why an empty script left Generate grey with nothing on
                // screen saying so. It's required, and the dot says it.
                emptyHint="Pick one from your bank, or paste it below"
                required
                filled={hasScript}
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

            {/* The words above, the look and the delivery below — one break
                inside one card, not two cards. Everything here is still a
                reference the storyboard is built FROM, so splitting the group
                would say they're different kinds of thing; a hairline just says
                you've finished reading one half. INSET, not full-bleed: it takes
                SectionCard's own `p-3` like every row it sits between, so it ends
                exactly where the card's HEADER hairline ends and the two read as
                one pair of rules rather than two widths of line in one card. (It
                was briefly `-mx-3` edge-to-edge, which met the card's border and
                cut the card in half — the opposite of a break inside one group.)
                `shrink-0` so a squeezed column can't drop it. */}
            <div className="shrink-0 border-t border-ink/10" />

            {/* Visual Style — the last reference, under the Script: the look is
                something the storyboard is built FROM, so it reads as one of the
                inputs rather than a switch on the way to Generate. Required, so
                it's dashed and asking to be filled until picked, then
                accent-filled with an X to clear. `shrink-0` because it now sits
                below the box that owns the column's leftover height, and a fixed
                58px row under a `flex-1` sibling is the one that gets squeezed. */}
            <div
              role="button"
              tabIndex={0}
              onClick={onOpenStyle}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStyle() } }}
              title={styleChosen ? styleHint : 'How every clip looks'}
              className={`group flex h-[58px] w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-full border px-4 text-left transition-colors ${
                styleChosen
                  ? 'border-broll-500/25 bg-broll-500/[0.07] hover:border-broll-500/35 hover:bg-broll-500/10'
                  : 'border-dashed border-ink/10 bg-ink/[0.02] hover:border-broll-500/30 hover:bg-broll-500/5'
              }`}
            >
              {/* Required — half of `canGenerate`, so an unpicked style is red. */}
              <StatusDot filled={styleChosen} required />
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${styleIsCustom ? 'bg-broll-500/20 text-broll-300' : 'bg-broll-500/10 text-broll-400 light:text-broll-600'}`}>
                {styleIsCustom ? <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.75} /> : <Palette className="h-[18px] w-[18px]" strokeWidth={1.5} />}
              </div>
              {/* Name over a one-line subtext, the shape of the References
                  cards above and the model row below — at 58px the second line
                  is room the row already has, and "Visual Style" alone says
                  nothing about what picking one does. Picked, the subtext is the
                  style's own brief, clipped to the line. */}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-w-0 items-center gap-1.5">
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
                <div className="truncate text-[11px] leading-snug text-ink-500">
                  {styleChosen ? styleHint : 'How every clip looks'}
                </div>
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

            {/* Line-by-Line delivery — "B-Roll Clips" keeps every card silent,
                for a voiceover laid over in the edit; "Dialogue Clips" makes all
                three the character speaking that line, staged three different
                ways. It's the last row INSIDE the References card, under Visual
                Style: it decides what KIND of storyboard the references above it
                are for, so it belongs to them rather than sitting outside the
                card as a setting on the way to Generate. Shrink-0 — a fixed h-12
                row in a column whose script box takes the leftover height. It
                keeps that 48px switch height rather than the 58px of the picker
                rows it now stacks with: it's a two-word toggle, not a row that
                opens something. (It has also sat between the card and the
                Instructions box, led the settings band, sat at that band's
                bottom directly above Generate, and sat at the very top of the
                column above the References heading.)
                Continuous has no deliveries — it's narration over footage — so
                it isn't rendered there at all. **B-Roll Clips leads the toggle,
                Dialogue Clips is still the default**: the order reads left to
                right as the plainer thing first, while the default stays on the
                one most members are here to make. Position and default are
                separate here on purpose — don't "fix" one to match the other. */}
            {isLineMode(mode) && (
              <SegmentedToggle<BrollDelivery>
                className="h-12 shrink-0 !p-1"
                value={lineDelivery}
                onChange={onLineDeliveryChange}
                accent="broll"
                // The same two glyphs the Generate button below swaps between for
                // these deliveries, so the button reads as an echo of what's
                // picked here rather than as a third piece of vocabulary.
                options={[
                  { value: 'silent', label: 'B-Roll Clips', icon: Film },
                  { value: 'dialogue', label: 'Dialogue Clips', icon: MessageSquareQuote },
                ]}
              />
            )}
          </SectionCard>

            {/* Additional instructions — a real textarea you type straight into.
                It was a pill that opened a centred editor popup, which put a
                click and a modal between the member and one line of direction;
                this is a text field, so it should behave like one. The popup is
                still one tap away on the expand button for anything longer.
                Doubles as the creative brief when there's no script yet — the
                product row carries the rest, so blank stays a normal answer. */}
            <div className="relative flex min-h-[72px] flex-1 flex-col overflow-hidden rounded-3xl border border-dashed border-ink/10 bg-ink/[0.02] transition-colors focus-within:border-ink/20 max-md:min-h-[120px] max-md:flex-none">
              <div className="flex items-center justify-between gap-2 px-4 pt-2.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-ink-500" strokeWidth={2} />
                  {/* One name whether or not a script is loaded — it's the same
                      box doing the same job, and it matches what Scripts calls
                      its own free-text steer. */}
                  <span className="truncate text-[13px] font-medium text-ink-200">Additional Instructions</span>
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

        {/* Render-settings + Generate band. It used to be a tinted, bordered card
            docked at the bottom of the column; the border drew a panel inside the
            panel, so it's gone and the rows sit straight on the column. Static in
            both layouts — on a desktop it's the column's footer, on a phone it's
            the last thing in the scroll (see the wrapper above). */}
        <div className="shrink-0 px-5 pb-2.5 pt-2">
          <div className="mb-2 flex flex-col gap-2">

            {/* Who writes the shot prompts, then how the cards are delivered.
                Visual Style used to lead this band and now sits with the
                References above — it's an input the storyboard is built FROM,
                like the product and the character, not a setting on the way to
                Generate. */}

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
                margins; `compact` so it matches the References cards up the
                column, Visual Style now among them. */}
            <ScriptModelRow appId="broll-studio" className="" />


          </div>

          <button
            onClick={onGenerate}
            disabled={!canGenerate || isGenerating}
 className="flex w-full items-center justify-center gap-2.5 glass-fill glass-fill-soft rounded-full border border-white/15 bg-broll-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] btn-soft-shadow transition-all hover:brightness-110 disabled:hover:brightness-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <Spinner className="h-4 w-4" />
                <span>Storyboarding...</span>
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
                {/* One label in all three cases. The button made the same thing
                    every time — a storyboard — and named it three ways; the
                    delivery toggle directly above already says which kind, and
                    the icon carries it too. */}
                <span>Generate Storyboard</span>
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
