import { useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import AnchoredPopover from './video/AnchoredPopover'
import { MenuSurface, MenuItem, MENU_ROW_HEIGHT, MENU_MIN_WIDTH } from './Menu'

// Per-app accent for the open-state border and the selected row. Explicit class
// strings (not template interpolation) so Tailwind sees them.
const ACCENTS = {
  voice: { border: 'border-voice-500/40', selected: 'bg-voice-500/15', check: 'text-voice-300' },
  scripts: { border: 'border-scripts-500/40', selected: 'bg-scripts-500/15', check: 'text-scripts-text' },
  broll: { border: 'border-broll-500/40', selected: 'bg-broll-500/15', check: 'text-broll-300' },
  influencers: { border: 'border-influencers-500/40', selected: 'bg-influencers-500/15', check: 'text-influencers-300' },
  playground: { border: 'border-playground-500/40', selected: 'bg-playground-500/15', check: 'text-playground-300' },
  // For chrome that belongs to no app accent — Outliers' filter row sits above
  // a results grid, alongside a monochrome search field and Search button.
  neutral: { border: 'border-ink/25', selected: 'bg-ink/10', check: 'text-ink-200' },
} as const

export type DropdownAccent = keyof typeof ACCENTS

/**
 * A value that is its own label, or a value/label pair for a control whose
 * stored value is a code ('US', 'VIDEO') rather than the words on screen.
 *
 * `count` renders as a small pill after the label, in the menu AND in the
 * trigger once picked — for a facet list where the number is a second fact
 * about the row ("Big number · 93 of them"), not part of its name. Baked into
 * the label string it read as one long title and sorted the eye through prose;
 * in a pill the numbers line up as a column you can scan.
 */
export type DropdownOption = string | { value: string; label: string; count?: number }

interface DropdownProps {
  value: string
  options: readonly DropdownOption[]
  onChange: (value: string) => void
  // Compact trigger (smaller padding) for side-by-side rows.
  compact?: boolean
  // 36px tall — the height of a `dense` SegmentedToggle, for a filter row that
  // shares a line with one. `compact` alone is 38px, which reads as a
  // different class of control sitting 2px proud of the toggle beside it.
  // Keeps the 13px type every Dropdown trigger uses; only the padding moves.
  dense?: boolean
  accent?: DropdownAccent
  // Optional dim label inside the trigger, left of the value — for a control
  // whose value alone ("3", "30s") doesn't say what it sets.
  label?: string
  // 'above' pins the menu upward regardless of viewport room — for a trigger
  // sitting just above a Generate button, where a downward menu covers it.
  placement?: 'auto' | 'above'
  // Raise the menu's overlay tier for a trigger inside a panel mounted above
  // the default one (BankPicker's z-[80] panel). See `AnchoredPopover`.
  tier?: 'default' | 'panel'
  // Shrinks the trigger to its own content, for a wrapping row of filters
  // rather than a settings panel's full-width stack.
  fitContent?: boolean
  // Raises the floor `fitContent` puts under the MENU (default 168). For a
  // list whose options are much longer than the trigger — the Outlier Vault's
  // hook patterns carry a count after the name — where the default clipped
  // "Conditional callout 76" to "Conditional callou…". Only the menu moves;
  // the trigger still fits its own content, so the filter row keeps its shape.
  // The default is `MenuSurface`'s own min-width: a narrower wrapper would let
  // the menu overhang the box AnchoredPopover positions for it.
  menuMinWidth?: number
  className?: string
}

// A rounded-full select whose menu is portaled via AnchoredPopover, so it
// escapes a scrolling panel's `overflow-y-auto` clip and flips above the
// trigger when it's near the bottom edge. Replaces the native <select>, whose
// menu used the browser's default (unstyled) popup.
//
// Lives in components/ rather than voice-studio/ because Scripts pairs two of
// these above its Generate button; one copy, two accents.
export default function Dropdown({
  value,
  options,
  onChange,
  compact,
  dense = false,
  accent = 'voice',
  label,
  placement = 'auto',
  tier = 'default',
  fitContent = false,
  menuMinWidth = MENU_MIN_WIDTH,
  className = '',
}: DropdownProps) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(0)
  const tone = ACCENTS[accent]

  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  // Falls back to the raw value so a persisted pick with no matching option
  // still renders something rather than an empty trigger.
  const currentItem = items.find((o) => o.value === value)
  const current = currentItem?.label ?? value

  const toggle = () => {
    if (open) { setOpen(false); return }
    // A fit-content trigger can be narrower than its own longest option
    // ("Match: Broad" against "Exact phrase"), so the menu takes a floor.
    const measured = anchorRef.current?.offsetWidth ?? 0
    setWidth(fitContent ? Math.max(measured, menuMinWidth) : measured)
    setOpen(true)
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={toggle}
        // 13px, matching the Preset and Voice rows in Voiceovers — every trigger
        // in a settings panel reads at one size.
        className={`flex ${fitContent ? 'w-auto' : 'w-full'} items-center justify-between gap-2 rounded-full border bg-ink/[0.03] text-left text-[13px] font-medium text-ink-100 outline-none transition-colors hover:bg-ink/[0.06] ${
          open ? tone.border : 'border-ink/10'
        } ${dense ? 'px-3 py-[7px]' : compact ? 'px-3 py-2' : 'px-3.5 py-2.5'} ${className}`}
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          {label && <span className="shrink-0 text-[11px] font-normal text-ink-600">{label}</span>}
          <span className="truncate">{current}</span>
          {/* self-center rather than riding the baseline the two labels share —
              a pill aligned by the text inside it sits visibly low. */}
          {currentItem?.count != null && <CountPill value={currentItem.count} />}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnchoredPopover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        width={width}
        estimatedHeight={Math.min(options.length * MENU_ROW_HEIGHT + 2, 320)}
        placement={placement}
        tier={tier}
      >
        {/* The scroller is INSIDE the surface, not the surface itself:
            `MenuSurface` is `overflow-hidden` so its full-bleed rows are
            clipped to the rounded corners, and stacking `overflow-y-auto` on
            the same element leaves which one wins to stylesheet order. */}
        <MenuSurface>
          <div className="menu-scroll max-h-[320px] overflow-y-auto">
            {/* The COUNT is last and the check sits to its left, appearing only
                on the selected row. Reserving a slot for the tick on the right
                instead — the obvious first try — pushed every row's content
                off-centre: measured 17px of inset on the left against 48px on the
                right, which is what read as the menu being lopsided. This way the
                pills still hold one column (the tick grows leftward into the
                label's slack, which truncates), and the row's two paddings
                match. */}
            {items.map((o) => {
              const selected = o.value === value
              return (
                <MenuItem
                  key={o.value}
                  selected={selected}
                  selectedClassName={`${tone.selected} text-ink-50`}
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  trailing={(
                    <>
                      {selected && <Check className={`h-4 w-4 ${tone.check}`} />}
                      {o.count != null && <CountPill value={o.count} muted={!selected} />}
                    </>
                  )}
                >
                  {o.label}
                </MenuItem>
              )
            })}
          </div>
        </MenuSurface>
      </AnchoredPopover>
    </>
  )
}

/**
 * The small count pill beside an option's name.
 *
 * Same two-tone treatment `SegmentedToggle` gives its own count badge: brighter
 * on the picked row, dimmer on the rest, so the selection still reads first.
 */
function CountPill({ value, muted = false }: { value: number; muted?: boolean }) {
  return (
    <span
      className={`shrink-0 self-center rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
        muted ? 'bg-ink/[0.06] text-ink-500' : 'bg-ink/10 text-ink-300'
      }`}
    >
      {value}
    </span>
  )
}
