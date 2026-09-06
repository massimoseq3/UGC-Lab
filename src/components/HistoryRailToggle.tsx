import { PanelRightClose, PanelRightOpen } from 'lucide-react'

// The one control that opens and shuts a history rail.
//
// It is a 38px circle in the app's own icon-button material, and WHERE it sits
// is the caller's business:
// open, it leads the rail's own 57px band, immediately left of that rail's New
// button; shut, the caller keeps a narrow column in the rail's place holding
// nothing but this. Either way it is a laid-out element, not an overlay.
//
// It was a pull tab on the seam between the two columns for a day (September
// 2026) and came off: costing no layout is worth nothing if the thing it
// overlaps is chrome. Every one of these output columns puts a full-width bar
// across its own top — B-Roll's batch strip, Voiceovers' script picker row —
// and a tab pinned to the top-right corner landed on it. The one before that
// was a 40px strip with a border, which read as a second panel. What is left is
// the plainest version: a button that lives in a band when there is a band, and
// keeps a button's worth of room when there isn't.
export default function HistoryRailToggle({
  open,
  onToggle,
  label = 'history',
  showLabel = false,
  count,
}: {
  open: boolean
  onToggle: () => void
  // The noun for the tooltip — "history" reads right in all three apps today.
  label?: string
  // Shut, the button is the only thing left standing where the rail was, so it
  // says the word as well as drawing the glyph (September 2026, Massimo's
  // call). Open, the rail underneath it is self-evidently the history and the
  // label would be repeating it beside the New button.
  //
  // It gives way below 980px — the width at which the rail stops being a column
  // at all — because there the shut column is a stub against a full-width pane,
  // and ~135px of label is a third of a phone's screen taken from the output.
  showLabel?: boolean
  // How many rows are waiting behind it. Omitted (or 0) draws no pill: an empty
  // history is not a number worth a badge.
  count?: number
}) {
  const title = open ? `Hide ${label}` : `Show ${label}`
  const Icon = open ? PanelRightClose : PanelRightOpen
  // The tooltip's noun is lowercase mid-sentence; the label is a heading.
  const word = label.charAt(0).toUpperCase() + label.slice(1)
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={title}
      aria-expanded={open}
      // The app's own icon-button material — the ring and faint wash the `+`
      // every output panel heads its bar with (`ClearAllButton iconOnly`). It
      // was a bare glyph on the panel's background, which put the one control
      // in that band with no surface of its own beside a solid CTA. Carrying a
      // label it is the same ring stretched to a pill.
      //
      // `38px`, not that button's own 36: the height is stated on
      // `RailNewButton` so the rail's band reads level with B-Roll's storyboard
      // bar across the seam, and this sits in that same row. The material is
      // what was borrowed, not the size.
      className={`flex h-[38px] shrink-0 items-center rounded-full border border-ink/10 bg-ink/[0.03] text-ink-300 transition-colors hover:bg-ink/[0.08] hover:text-ink-100 ${
        showLabel ? 'justify-center gap-2 px-2.5' : 'w-[38px] justify-center'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
      {showLabel && (
        <>
          <span className="hidden text-[12.5px] font-medium tracking-tight min-[980px]:inline">{word}</span>
          {count ? (
            // The house count pill — same chip B-Roll's Download Clips wears.
            <span className="hidden rounded-full bg-ink/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-ink-200 min-[980px]:inline-block">
              {count}
            </span>
          ) : null}
        </>
      )}
    </button>
  )
}

// The column that stands in the rail's place while it is shut. No border and no
// fill — a bordered strip reads as a second panel, which is exactly what the
// 40px version of this was told off for.
//
// The 57px band at the top is what puts the button level with whatever the
// output column runs across ITS top. It draws NO hairline of its own: Scripts'
// and Voiceovers' output panes carry no bar for one to continue, so a line here
// was a stub floating over nothing, and B-Roll — the one pane with a bar —
// doesn't use this column at those widths any more. Its toggle rides inside
// that bar instead, so the bar's own glass runs under it and the storyboard
// isn't narrowed by a column (September 2026, Massimo's call). See
// `broll-studio/components/RightPanel.tsx`, which keeps this for the two cases
// the bar can't take it.
export function HistoryRailClosed({
  onExpand,
  label,
  count,
}: {
  onExpand: () => void
  label?: string
  count?: number
}) {
  return (
    <div className="flex min-h-0 shrink-0 flex-col">
      <div className="flex h-[57px] shrink-0 items-center px-2.5">
        <HistoryRailToggle open={false} onToggle={onExpand} label={label} showLabel count={count} />
      </div>
    </div>
  )
}
