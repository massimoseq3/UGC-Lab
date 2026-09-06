import { PanelRightClose, PanelRightOpen } from 'lucide-react'

// The one control that opens and shuts a history rail.
//
// It is a plain 32px ghost button, and WHERE it sits is the caller's business:
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
}: {
  open: boolean
  onToggle: () => void
  // The noun for the tooltip — "history" reads right in all three apps today.
  label?: string
}) {
  const title = open ? `Hide ${label}` : `Show ${label}`
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={title}
      aria-expanded={open}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-100"
    >
      {open
        ? <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
        : <PanelRightOpen className="h-4 w-4" strokeWidth={1.75} />}
    </button>
  )
}

// The column that stands in the rail's place while it is shut: a button's worth
// of room and nothing else. No border and no fill — a bordered strip reads as a
// second panel, which is exactly what the 40px version of this was told off for.
export function HistoryRailClosed({ onExpand, label }: { onExpand: () => void; label?: string }) {
  return (
    <div className="flex w-12 shrink-0 justify-center pt-2.5">
      <HistoryRailToggle open={false} onToggle={onExpand} label={label} />
    </div>
  )
}
