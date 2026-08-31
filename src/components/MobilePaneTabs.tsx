import SegmentedToggle, {
  type SegmentedAccent,
  type SegmentedToggleOption,
} from './SegmentedToggle'

interface MobilePaneTabsProps<T extends string> {
  options: Array<SegmentedToggleOption<T>>
  value: T
  onChange: (value: T) => void
  accent?: SegmentedAccent
}

// The phone-only switcher between an app's two panes.
//
// Every workspace app is a two-pane desktop layout: what you fill in on the
// left, what comes out on the right. Stacking those two columns on a phone was
// tried first and doesn't work — each panel is built as a full-height column
// with its own internal scroll and a pinned footer, so stacked they collapse
// into a pair of ~200px scroll windows with the Generate bar sitting on top of
// the fields it belongs to, and the output pane ends up below a fold nobody
// finds. Showing ONE pane at a time gives each the whole window and leaves the
// desktop layout completely untouched (this bar is `md:hidden`, the panes swap
// with `hidden md:flex`, so no JS media query and nothing to get out of sync).
//
// Fire Generate and the app flips to the output pane on its own — on a phone
// that's the only way to see the thing you just paid for.
export default function MobilePaneTabs<T extends string>({
  options,
  value,
  onChange,
  accent = 'ink',
}: MobilePaneTabsProps<T>) {
  return (
    // Nothing in an app rolls away on a scroll any more (August 2026): this
    // bar never did, the search and filter rows that used to now don't either.
    // A bar that collapses on the way down and unrolls on the way back up
    // moves the list under the thumb that was reading it, and the one thing
    // that still gets out of the way — the dock — does it from OUTSIDE the
    // pane, where nothing it uncovers can shift. See useChromeAutoHide.
    // `px-5` is the app-wide panel inset, and this bar takes it because it is
    // almost never alone: under it sits a panel header at `px-5` (Playground's
    // Image/Video/Music, B-Roll's Line-by-Line/Continuous, the Ad Analyzer's
    // section jump) over a body at `px-5`. At `px-2` it stood 12px proud of
    // every one of them and the two stacked pills read as two widths of the
    // same control.
    <div className="shrink-0 border-b border-ink/5 px-5 py-1.5 md:hidden">
      <SegmentedToggle options={options} value={value} onChange={onChange} accent={accent} dense />
    </div>
  )
}
