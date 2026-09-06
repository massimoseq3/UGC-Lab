import CountSlot from './CountSlot'
import { SectionLabel } from './SectionCard'

/**
 * The table of contents down the left of a `Modal size="gallery"`.
 *
 * Lifted out of the Characters preset picker (September 2026), which had it
 * first and is still the one that needs it most — but the same shape now serves
 * every picker wide enough to carry one: Visual Styles, Playground's presets,
 * Choose a Script Style, Choose a Voice. Two copies of a scroll-spy is two
 * places for the highlight to drift out of step with the scroll.
 *
 * ONE RULE, and it is the whole design: the rail SAYS WHERE YOU ARE. Every row
 * is a place in the one scrolling body — clicking it scrolls there, and the
 * highlight follows the scroll back. Nothing on it filters. Filtering by the
 * rail was tried in the preset picker and reads as a set of tabs: it hides
 * every other section the moment you glance at one, which is the opposite of a
 * library you browse. Search, gender and the like stay real filters on the
 * toolbar above the body, because they cut ACROSS the sections rather than
 * picking one.
 */

// The scroll-spy that drives it and the gallery grid track live in
// `sectionSpy.ts` — see the note at the top of that file.

export type RailAccent = 'broll' | 'influencers' | 'playground' | 'scripts'

// Active-row fill + label. Literal strings per accent: Tailwind's JIT can't
// build a class name out of a prop.
const RAIL_ACTIVE: Record<RailAccent, string> = {
  broll: 'bg-broll-500/10 font-medium text-broll-300 ring-1 ring-inset ring-broll-500/15',
  influencers: 'bg-influencers-500/10 font-medium text-influencers-300 ring-1 ring-inset ring-influencers-500/15',
  playground: 'bg-playground-500/10 font-medium text-playground-300 ring-1 ring-inset ring-playground-500/15',
  scripts: 'bg-scripts-500/10 font-medium text-scripts-300 ring-1 ring-inset ring-scripts-500/15',
}

const RAIL_ACTIVE_COUNT: Record<RailAccent, string> = {
  broll: 'text-broll-300/70',
  influencers: 'text-influencers-300/70',
  playground: 'text-playground-300/70',
  scripts: 'text-scripts-300/70',
}

export interface RailSection {
  // Matches the key the body's section registers itself under.
  key: string
  label: string
  count: number
}

/**
 * One rail row: a place in the body, how much is in it, and whether you're in
 * it.
 *
 * A section a filter has emptied stays in the rail — a row that vanished at
 * zero would move the rest under the pointer, and the count answers "why is
 * there nothing there" outright — but it stops looking clickable, because it
 * isn't. The count rides in a `CountSlot` so a live tally can't shift the
 * label beside it.
 */
function RailRow({ label, count, active, accent, onClick }: {
  label: string
  count: number
  active: boolean
  accent: RailAccent
  onClick: () => void
}) {
  const empty = count === 0
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={empty}
      title={label}
      aria-pressed={active}
      className={`flex w-full items-center gap-2 rounded-full px-3 py-[7px] text-left text-[12.5px] transition-colors ${
        active ? RAIL_ACTIVE[accent] : empty ? 'text-ink-700' : 'text-ink-500 hover:bg-ink/5 hover:text-ink-300'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={`shrink-0 text-[11px] ${active ? RAIL_ACTIVE_COUNT[accent] : 'text-ink-600'}`}>
        <CountSlot value={count} />
      </span>
    </button>
  )
}

export default function SectionRail({
  heading,
  sections,
  activeKey,
  accent,
  onJump,
}: {
  // Optional block heading above the rows, for a rail whose rows need naming
  // ("Accent"). Omitted where the row labels already say what they are.
  heading?: string
  sections: RailSection[]
  activeKey: string | null
  accent: RailAccent
  onJump: (key: string) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {heading && <SectionLabel label={heading} className="px-3 pb-1.5" />}
      {sections.map((s) => (
        <RailRow
          key={s.key}
          label={s.label}
          count={s.count}
          active={s.key === activeKey}
          accent={accent}
          onClick={() => onJump(s.key)}
        />
      ))}
    </div>
  )
}

/**
 * The heading above one section of a gallery body.
 *
 * One component across all four pickers, so a section reads the same wherever
 * it is. Strings are written in Title Case ("Your Visual Styles") — the rail
 * renders them as typed, this renders them uppercase, and the two can't drift
 * apart by being written differently in two places.
 */
export function GallerySectionHeading({
  label,
  innerRef,
  className = '',
}: {
  label: string
  // The spy's `register(key)` callback — this heading is what a jump lands on.
  innerRef?: (el: HTMLElement | null) => void
  className?: string
}) {
  return (
    <p
      ref={innerRef}
      className={`text-[11px] font-medium uppercase tracking-wider text-ink-600 ${className}`}
    >
      {label}
    </p>
  )
}
