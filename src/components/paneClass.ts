// The class string every pane wrapper takes, so the apps can't drift.
//
// Phone: the inactive pane is display:none and the active one takes the whole
// column (`max-md:flex-1`). Desktop: both are shown side by side and `desktop`
// supplies that app's own column sizing — width, grow, border. Nothing here
// touches `flex` above md, so a caller's `md:flex-1` / `md:w-1/2` can't lose a
// specificity coin-toss against this string.
//
// Lives beside MobilePaneTabs rather than in it: a file that exports both a
// component and a plain function loses React Fast Refresh, and every edit to
// the tab bar would full-reload the page instead of hot-swapping.
export function paneClass(active: boolean, desktop: string): string {
  return `${active ? 'flex' : 'hidden md:flex'} w-full min-w-0 min-h-0 flex-col max-md:flex-1 ${desktop}`
}
