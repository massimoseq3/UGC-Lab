import CollapsingBar from './CollapsingBar'
import { useChromeStore } from '../stores/chromeStore'
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
    // Rolls up while the member scrolls down the pane it switches — the pane
    // it would switch TO isn't what they're reading, and a scroll back up
    // hands it straight back.
    <CollapsingBar className="md:hidden">
      <div className="border-b border-ink/5 px-2 py-1.5">
        <SegmentedToggle
          options={options}
          value={value}
          // Switching panes hands the chrome back. The pane you arrive on
          // starts at the top and may be too short to scroll at all, and
          // scrolling is the only way to ask for the chrome back.
          onChange={(next) => {
            useChromeStore.getState().setHidden(false)
            onChange(next)
          }}
          accent={accent}
          dense
        />
      </div>
    </CollapsingBar>
  )
}

// The class string every pane wrapper takes, so the apps can't drift.
//
// Phone: the inactive pane is display:none and the active one takes the whole
// column (`max-md:flex-1`). Desktop: both are shown side by side and `desktop`
// supplies that app's own column sizing — width, grow, border. Nothing here
// touches `flex` above md, so a caller's `md:flex-1` / `md:w-1/2` can't lose a
// specificity coin-toss against this string.
export function paneClass(active: boolean, desktop: string): string {
  return `${active ? 'flex' : 'hidden md:flex'} w-full min-w-0 min-h-0 flex-col max-md:flex-1 ${desktop}`
}
