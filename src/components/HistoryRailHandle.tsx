import { PanelRightClose, PanelRightOpen } from 'lucide-react'

// The one control that opens and shuts a history rail, as a pull tab on the
// seam between the output column and the rail.
//
// Both apps that use it dropped the bar over their output pane, so there is
// nowhere left for a toggle to live as ordinary chrome — and the two obvious
// alternatives were tried and are worse. A column of its own (a 40px strip
// beside the shut rail) spends real width on one button and reads as a second
// panel; a round button floating in the pane's top-right corner lands on the
// first thing every one of these columns puts there (Scripts' take switcher,
// Voiceovers' script picker row).
//
// A tab on the seam costs no layout at all, sits in the gutter each column
// already keeps between its content and its edge, and — this is the part that
// makes it one control rather than two — it is in the SAME place in both
// states, because the seam is the pane's right edge when the rail is shut and
// the rail's own left edge when it is open. Rendered inside the output column,
// which below `lg` is hidden while the rail stands in front of it; the rail
// carries its own close there.
export default function HistoryRailHandle({
  open,
  onToggle,
  label = 'history',
}: {
  open: boolean
  onToggle: () => void
  // The noun for the tooltip — "history" reads right in both apps today.
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
      className="absolute right-0 top-1/2 z-20 flex h-14 w-6 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 border-ink/10 bg-surface-1 text-ink-500 transition-colors hover:bg-ink/[0.08] hover:text-ink-100"
    >
      {open
        ? <PanelRightClose className="h-3.5 w-3.5" strokeWidth={1.75} />
        : <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={1.75} />}
    </button>
  )
}
