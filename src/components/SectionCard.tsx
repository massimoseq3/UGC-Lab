import type { ElementType, ReactNode, RefObject } from 'react'
import { ChevronRight } from 'lucide-react'

// The grouped section card, lifted out of the Influencers controls column —
// the one place in the app where a long input column reads as designed rather
// than as a ladder of unrelated rows. A card is a faint tinted block with a
// CENTERED icon + title over a hairline, and optional small actions pinned to
// the header's left and right edges (Influencers' TabDivider shape, folded into
// the card header rather than sitting on a divider row of its own — a 25%-wide
// pane can't afford a whole row to carry two 10px pills).
//
// Use it to group controls that are ONE thing: the references a generation is
// built from, a stack of delivery settings. Don't card a lone control — the
// border is what says "these belong together", and around a single row it says
// nothing while costing 24px.
export default function SectionCard({
  icon: Icon,
  title,
  titleNode,
  left,
  right,
  children,
  className = '',
  contentClassName = 'flex flex-col gap-2',
  onHeaderClick,
  divider = true,
  shadow = true,
}: {
  icon?: ElementType
  title: string
  // Replaces the centred icon + title with something that is itself a control —
  // a `SectionPresetPill`, where the heading IS the way into that section's
  // presets. `title` is still required and becomes the accessible name, so a
  // card can't end up with no name at all.
  titleNode?: ReactNode
  // Small pills pinned to the header's edges. Absolutely positioned so the
  // title stays optically centred whatever they weigh.
  left?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
  // Makes the whole header row the control that folds the card, for a section
  // whose body can be put away (the Voice card). The fold chevron still goes in
  // `left` as a real button — it keeps the `aria-expanded` and the keyboard
  // focus — and stops its own click, so a click on it doesn't fold twice.
  onHeaderClick?: () => void
  // The rule separates the header from a body. A folded card has none, so it
  // draws no rule — otherwise the card reads as a heading with its content
  // clipped off rather than as something put away.
  divider?: boolean
  // Off for a card that is the LAST child of a scrolling column: a scroller
  // clips its descendants' shadows, so what renders is a halo down the sides
  // stopping dead at the bottom corners, which reads as the card being sliced.
  shadow?: boolean
}) {
  return (
    <div className={`rounded-2xl border border-ink/5 bg-ink/[0.02] p-3 ${shadow ? 'card-soft-shadow' : ''} ${className}`}>
      {/* A 3-column grid, not absolutely-positioned edge slots: the two 1fr
          gutters are equal, so the title is genuinely centred, and a pane too
          narrow for all three squeezes them instead of letting a pill land on
          top of the title (which is what the absolute version did in B-Roll's
          25%-wide column). */}
      <div
        onClick={onHeaderClick}
        className={`mb-2.5 grid min-h-[22px] grid-cols-[1fr_auto_1fr] items-center gap-1.5 ${onHeaderClick ? 'group cursor-pointer' : ''}`}
      >
        <div className="flex min-w-0 justify-start">{left}</div>
        <div className="flex min-w-0 items-center justify-center gap-1.5">
          {titleNode ?? (
            <>
              {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-ink-100" strokeWidth={1.75} />}
              <h4 className="truncate text-[13px] font-semibold tracking-tight text-ink-100">{title}</h4>
            </>
          )}
        </div>
        <div className="flex min-w-0 justify-end">{right}</div>
      </div>
      {divider && <div className="mb-2.5 border-t border-ink/10" />}
      <div className={contentClassName}>{children}</div>
    </div>
  )
}

// Preset pill — a section heading that IS the way into that section's presets.
// Lifted out of Influencers' controls column (September 2026) when Playground's
// Voice card wanted the same shape; one shape, two tones, because the two live
// at different altitudes in the same column. The TAB divider's pill is the loud
// one (glassy influencers tint, matching the Portrait/Sheet toggle so the two
// read as one accent family), and every SECTION title inside that tab wears the
// same dashed pill in plain ink. Eight accent pills down one column would make
// the divider that separates two tabs no louder than the headings under it — a
// section title is still a title first, so the neutral tone keeps the heading's
// own type (`text-sm font-semibold`) and only borrows the chrome that says
// "this is a button": the dashed ring and the chevron.
const PILL_TONES = {
  accent: 'border-influencers-500/30 bg-influencers-500/10 text-influencers-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-influencers-500/15',
  neutral: 'border-ink/15 bg-ink/[0.03] text-ink-100 hover:border-ink/25 hover:bg-ink/[0.06]',
} as const

// Type, kept out of the tone so a caller can match the heading altitude it sits
// at without also changing its colour. `sm` is `SectionCard`'s own 13px title —
// for a pill standing in for that heading in a column of ordinary cards, where
// 14px next to a 13px "References" one card up reads as two title sizes.
const PILL_SIZES = {
  accent: 'text-[12px] font-medium',
  md: 'text-sm font-semibold tracking-tight',
  sm: 'text-[13px] font-semibold tracking-tight',
} as const

export function SectionPresetPill({
  label,
  title,
  icon: Icon,
  onClick,
  tone = 'accent',
  size,
  buttonRef,
}: {
  label: string
  title: string
  icon?: ElementType
  // Takes the event, so a pill sitting inside a row that is itself clickable
  // (Playground's Voice header, where the row folds the card) can stop its own
  // click from doing both things.
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  tone?: keyof typeof PILL_TONES
  // Defaults to the tone's own historic type — 12px on the accent pill, 14px on
  // the neutral one — so nothing moves unless a caller asks it to.
  size?: keyof typeof PILL_SIZES
  // For a caller that anchors a popover to the pill rather than opening a modal.
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 transition-colors ${PILL_TONES[tone]} ${
        PILL_SIZES[size ?? (tone === 'accent' ? 'accent' : 'md')]
      }`}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
      {label}
      <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${tone === 'neutral' ? 'text-ink-400' : ''}`} strokeWidth={2} />
    </button>
  )
}

// The filled/empty dot from Influencers' ChipField, with one addition every
// other panel needs. Influencers' 28 fields are all the same kind of optional,
// so an empty one is always red; everywhere else a column mixes inputs that
// GATE the run with ones that don't, and a red dot on something nothing is
// waiting for reads as an error to go and fix. So red means exactly one thing —
// "this is why Generate is grey" — and an optional empty slot gets a neutral
// dot instead.
export function StatusDot({ filled, required = false }: { filled: boolean; required?: boolean }) {
  return (
    <span
      aria-hidden
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        filled ? 'bg-emerald-500' : required ? 'bg-red-500' : 'bg-ink/20'
      }`}
    />
  )
}

// A field's name inside a card: the dot, then Influencers' small-caps label.
// The card header carries the section's weight, so labels under it step down to
// this register — two 13px sentence-case headings inside one titled card read
// as two competing titles.
export function SectionLabel({
  label,
  filled,
  required = false,
  right,
  className = '',
}: {
  label: string
  // Undefined = NO dot, the same convention `RefGroup` uses: for a row whose
  // filled state is already obvious from the control itself (a thumbnail versus
  // a dashed box), or one in a group where a dot could only ever be green.
  filled?: boolean
  required?: boolean
  right?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {filled != null && <StatusDot filled={filled} required={required} />}
      <span className="text-[11px] font-medium uppercase tracking-wider text-ink-300">{label}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  )
}
