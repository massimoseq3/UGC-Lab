import type { BrollHistoryItem } from '../../../stores/types'
import type { BrollResult, BrollMode } from '../types'

// How a History row is classified. Lives beside BrollHistoryView rather than in
// it: a file that exports both a component and a plain function loses React
// Fast Refresh.

// A session accumulates results across modes (state isn't cleared on a mode
// switch), and the saved `mode` is only the last-active one — unreliable for
// telling what a row *is*. So derive the row's mode from its richest content:
// prefer Continuous' own result; a lingering line result is the weaker signal.
// Both the badge/filter AND selecting the row use this, so what you see always
// matches where a click takes you.
export function brollHistoryMode(item: BrollHistoryItem): BrollMode {
  if (item.continuousResult) return 'continuous'
  const line = item.result as BrollResult | null
  if (line?.scenes?.length) return 'line'
  return item.mode === 'continuous' ? 'continuous' : 'line'
}

// A session from the retired One-Shot mode, and nothing else — no keyframe
// storyboard, no line scenes. The row and its clips stay on disk (and in the
// cloud) untouched; it's just not listed, because there's no longer a mode to
// open it in. Delete this, not the data, when One-Shot comes back.
export function isRetiredOneShotRow(item: BrollHistoryItem): boolean {
  if (item.continuousResult) return false
  if ((item.result as BrollResult | null)?.scenes?.length) return false
  return !!item.oneShotResult || item.mode === 'oneshot'
}
