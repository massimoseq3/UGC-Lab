import { PanelRightClose } from 'lucide-react'

// The LIP: the control that shuts an OPEN history rail, hung on the seam
// between the output column and the rail (Massimo's call, September 2026).
//
// It is rendered inside the output column, hard against its right edge — which
// while the rail is open IS the rail's own left edge — so it reads as a tab on
// the rail rather than as a button parked in a panel. It costs no layout, and
// it leaves the rail's 57px band to the one thing that band is for: its New
// button, which now runs the full width of it.
//
// It rides at the TOP, level with that New button across the seam, so the two
// read as one row of chrome rather than as a tab floating halfway down a
// column of script.
//
// It is deliberately ONE-WAY, which is what separates it from the pull tab
// this shape was the first time round. Shut, there is no seam to hang it on
// and no rail for it to be a tab of — a lip on the bare right edge of the
// output column is a mystery button. So the shut state keeps the laid-out
// control that says the word: `HistoryRailClosed`'s labelled *History* button
// (B-Roll's rides inside the storyboard bar). Open → this shuts it; shut → that
// opens it.
//
// Below each app's rail threshold (980px) the rail stands in FRONT of the
// output column, so this goes away with the column it lives in and the rail
// carries its own Close — see `RailCloseButton`.
export default function HistoryRailHandle({
  onCollapse,
  label = 'history',
}: {
  onCollapse: () => void
  // The noun for the tooltip — "history" reads right in all three apps today.
  label?: string
}) {
  const title = `Hide ${label}`
  return (
    <button
      type="button"
      onClick={onCollapse}
      title={title}
      aria-label={title}
      aria-expanded
      // `border-r-0` plus the flat right corners are what make it a lip on the
      // edge rather than a button parked near it: the shape continues off the
      // column instead of closing beside it. `bg-surface-1` is the panel
      // elevation, so it reads as part of the chrome under it and not as
      // something floating over the output.
      //
      // `z-30`, not 20: B-Roll's storyboard bar is an `absolute … z-20` sibling
      // in this same container, so at equal z the later element won — the lip
      // was rendering, correctly positioned, entirely behind the bar's scroll
      // port (reported as "the lip isn't there in B-Roll"). A pane with a bar
      // also has to keep the bar's own content clear of this: see the spacer
      // B-Roll passes as `railToggle` while the rail is open.
      className="absolute right-0 top-2.5 z-30 flex h-9 w-6 items-center justify-center rounded-l-lg border border-r-0 border-ink/10 bg-surface-1 text-ink-500 transition-colors hover:bg-ink/[0.08] hover:text-ink-100"
    >
      <PanelRightClose className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  )
}

// The rail's own Close, for the widths where the rail covers the output column
// and the lip goes with it. It is the only way back there, so it is a laid-out
// button in the rail's band — and it is `min-[980px]:hidden`, because above
// that width the lip is on screen and two closes in one row is one too many.
export function RailCloseButton({ onCollapse, label = 'history' }: { onCollapse: () => void; label?: string }) {
  const title = `Close ${label}`
  return (
    <button
      type="button"
      onClick={onCollapse}
      title={title}
      aria-label={title}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-ink/[0.03] text-ink-400 transition-colors hover:bg-ink/[0.08] hover:text-ink-100 min-[980px]:hidden"
    >
      <PanelRightClose className="h-4 w-4" strokeWidth={2} />
    </button>
  )
}
