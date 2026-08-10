import type { ElementType, ReactNode } from 'react'

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
  left,
  right,
  children,
  className = '',
  contentClassName = 'flex flex-col gap-2',
}: {
  icon?: ElementType
  title: string
  // Small pills pinned to the header's edges. Absolutely positioned so the
  // title stays optically centred whatever they weigh.
  left?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <div className={`rounded-2xl border border-ink/5 bg-ink/[0.02] p-3 card-soft-shadow ${className}`}>
      {/* A 3-column grid, not absolutely-positioned edge slots: the two 1fr
          gutters are equal, so the title is genuinely centred, and a pane too
          narrow for all three squeezes them instead of letting a pill land on
          top of the title (which is what the absolute version did in B-Roll's
          25%-wide column). */}
      <div className="mb-2.5 grid min-h-[22px] grid-cols-[1fr_auto_1fr] items-center gap-1.5">
        <div className="flex min-w-0 justify-start">{left}</div>
        <div className="flex min-w-0 items-center justify-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-ink-100" strokeWidth={1.75} />}
          <h4 className="truncate text-[13px] font-semibold tracking-tight text-ink-100">{title}</h4>
        </div>
        <div className="flex min-w-0 justify-end">{right}</div>
      </div>
      <div className="mb-2.5 border-t border-ink/10" />
      <div className={contentClassName}>{children}</div>
    </div>
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
  filled: boolean
  required?: boolean
  right?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <StatusDot filled={filled} required={required} />
      <span className="text-[11px] font-medium uppercase tracking-widest text-ink-300">{label}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  )
}
