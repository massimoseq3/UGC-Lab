import { type ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'

/**
 * The house popup menu — one shape for every anchored list of options or
 * actions in the app.
 *
 * There were four of these and they had all drifted apart: the `Dropdown`'s
 * `rounded-full` pill rows at 36px, `ConstraintChip`'s pills at 36px,
 * `SlotActionMenu`'s full-bleed 40px rows with an icon, B-Roll's Generate All
 * menu at `rounded-xl` and 12px, plus the Bank's sort menu and two one-off
 * upload menus. Opened a second apart they read as three different apps.
 *
 * The shape that won is `SlotActionMenu`'s (Massimo's call, September 2026):
 * full-bleed rows, an icon slot on the left, and a real 38px tap target — a
 * step up from the 34-36px pills it replaced, then tightened back from 42 once
 * a six-row menu was on screen and read as airy.
 * An inset pill row inside a padded card was the other candidate and loses on
 * two counts — it spends horizontal room twice (the card's padding, then the
 * pill's own) on menus that are already only ~200px wide, and a pill inside a
 * card reads as a control inside a panel rather than as one row of a list.
 *
 * Deliberately **opaque**. Every one of these wore `bg-surface-2/95` +
 * `backdrop-blur-xl`, which at 95% over an opaque panel buys no picture and
 * makes the menu a backdrop root — and two of them (the Dropdown's 30 voices,
 * the model lists) scroll, which re-runs the filter as you scroll. A heavier
 * shadow does the separating instead. See docs/performance.md.
 */

// Row height in px. Exported because every AnchoredPopover caller has to
// estimate its menu's height to decide whether to flip above the trigger, and
// that number must move when this one does.
export const MENU_ROW_HEIGHT = 38

// The surface's own width floor, exported for the same reason: a caller that
// sizes the box the menu is positioned in (AnchoredPopover) has to agree with
// it, or the menu overhangs its own anchor box.
export const MENU_MIN_WIDTH = 184

export function MenuSurface({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-ink/10 bg-surface-2 shadow-xl shadow-black/30 ${className}`}
      style={{ minWidth: MENU_MIN_WIDTH }}
    >
      {children}
    </div>
  )
}

export function MenuItem({
  icon: Icon,
  iconClassName = '',
  selected = false,
  // The accent band for a picked row. Neutral by default; a per-app accent
  // rides in from `Dropdown`'s own ACCENTS map.
  selectedClassName = 'bg-ink/[0.08] text-ink-50',
  // REPLACES the row's resting colours (not appended to them) — for a row that
  // is an accented action rather than one of a list of values, like Playground's
  // "Design new voice…". Appending an accent through `className` looks like it
  // works and doesn't: two same-specificity text utilities are resolved by their
  // order in the stylesheet, not in the class string.
  toneClassName,
  onClick,
  trailing,
  title,
  className = '',
  children,
}: {
  icon?: LucideIcon
  iconClassName?: string
  selected?: boolean
  selectedClassName?: string
  toneClassName?: string
  onClick: () => void
  // Right-aligned slot: a tick, a count pill, a credit price.
  trailing?: ReactNode
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] font-medium transition-colors ${
        selected
          ? selectedClassName
          : toneClassName ?? 'text-ink-300 hover:bg-ink/[0.06] hover:text-ink-100'
      } ${className}`}
      style={{ minHeight: MENU_ROW_HEIGHT }}
    >
      {Icon && <Icon className={`h-4 w-4 shrink-0 ${iconClassName || 'text-ink-500'}`} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing && <span className="flex shrink-0 items-center gap-1.5">{trailing}</span>}
    </button>
  )
}

// Full-bleed hairline between two groups of rows. Full-bleed because the rows
// are: an inset rule inside a menu with no padding reads as a stray line.
export function MenuSeparator() {
  return <div className="h-px bg-ink/10" />
}
