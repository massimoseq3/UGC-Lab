import type { BankType } from '../../utils/constants'
import { BANK_CONFIG } from '../../utils/constants'
import { SectionLabel } from '../../components/SectionCard'

/**
 * The Bank's source list — the seven banks down the left, Finder's own shape.
 *
 * It replaces the top tab strip from `md` up, and that isn't only a style
 * choice: the strip and the toolbar were fighting over one 57px line. Six tabs
 * want ~820px, and once search and the view switcher joined the row the last
 * tab scrolled off the end on a 1440px laptop. Down the side the banks cost a
 * fixed 204px, every bank is legible at once — which is the thing a switcher is
 * for — and the toolbar gets its whole line back.
 *
 * Below `md` this doesn't render at all and the tab strip is still the
 * switcher: 204px is more than half a phone, and the app's rule is that a phone
 * shows one thing at a time (docs/mobile.md).
 *
 * The geometry is Characters' preset-picker rail, deliberately — that rail
 * shipped first and a second one two pixels off it would just read as sloppy.
 * What it doesn't borrow is that rail's local `RailRow`: it paints the
 * Influencers accent, and it DISABLES a row whose count is zero, which is right
 * for a filter (nothing to scroll to) and wrong for a bank — an empty bank is
 * exactly the one you open to put the first thing in.
 *
 * Grouped the way the banks actually differ: the six you fill in yourself, then
 * the one another app fills for you. The Swipe File is Outliers' bank shown
 * here, so it sits under what owns it — and it disappears with Outliers,
 * exactly as its tab did.
 */
export default function BankSidebar({ banks, active, counts, onSelect, showFrom = 'md' }: {
  banks: BankType[]
  active: BankType
  counts: Record<BankType, number>
  onSelect: (bank: BankType) => void
  // The width the rail appears at. `md` in the Bank app, which owns the whole
  // window; `lg` inside the bank picker, whose modal is already inset from the
  // viewport — 204px of rail beside a grid of faces needs the room, and it is
  // the breakpoint the Characters preset picker's rail already uses.
  showFrom?: 'md' | 'lg'
}) {
  const owned = banks.filter((b) => b !== 'swipes')
  const fromApps = banks.filter((b) => b === 'swipes')

  const row = (bank: BankType) => {
    // The glyph comes off `BANK_CONFIG`, which already carries one per bank —
    // a second table here would be one more thing to keep in step.
    const Icon = BANK_CONFIG[bank].icon
    const isActive = bank === active
    return (
      <button
        key={bank}
        type="button"
        onClick={() => onSelect(bank)}
        title={BANK_CONFIG[bank].label}
        aria-pressed={isActive}
        className={`flex w-full items-center gap-2 rounded-full px-3 py-[7px] text-left text-[12.5px] transition-colors ${
          isActive
            ? 'bg-ink/[0.07] font-medium text-ink-100 ring-1 ring-inset ring-ink/10'
            : 'text-ink-500 hover:bg-ink/5 hover:text-ink-300'
        }`}
      >
        {/* The icon takes the ROW's colour, never the bank's accent. Painting
            each glyph in `BANK_CONFIG[bank].accent` was tried first and two of
            the seven are unreadable at any moment: Scripts' #24365A vanishes
            into a dark page, and in light mode the gold fails instead (2.32:1 on
            white — `SegmentedToggle` already says so).
            Seven accents down one column is a paint chart anyway; they earn
            their keep on the app tiles, where each one owns a whole surface. */}
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{BANK_CONFIG[bank].label}</span>
        {counts[bank] > 0 && (
          <span className={`shrink-0 text-[11px] tabular-nums ${isActive ? 'text-ink-400' : 'text-ink-600'}`}>
            {counts[bank]}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className={`hidden w-[204px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-ink/5 px-3 py-4 ${showFrom === 'lg' ? 'lg:flex' : 'md:flex'}`}>
      <div className="flex flex-col gap-0.5">
        <SectionLabel label="Library" className="px-3 pb-1.5" />
        {owned.map(row)}
      </div>
      {fromApps.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <SectionLabel label="From Apps" className="px-3 pb-1.5" />
          {fromApps.map(row)}
        </div>
      )}
    </div>
  )
}
