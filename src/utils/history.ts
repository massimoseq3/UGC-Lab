// Shared time/date helpers for history surfaces (Voiceovers, B-Roll, Playground).
// These were previously copy-pasted byte-for-byte across each history view —
// keep them here so a change to relative-time wording or day grouping happens
// in one place.

const DAY_MS = 86_400_000

/** Midnight (local) of the day containing `ts`, as an epoch-ms timestamp. */
export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Coarse "x ago" label for a timestamp: "just now" / "5m ago" / "3h ago" / "2d ago". */
export function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < DAY_MS) return `${Math.floor(diff / 3600_000)}h ago`
  return `${Math.floor(diff / DAY_MS)}d ago`
}

/** Section heading for a day bucket: "Today" / "Yesterday" / "April 5, 2026". */
export function sectionLabel(dayTs: number): string {
  const today = startOfDay(Date.now())
  const yesterday = today - DAY_MS
  if (dayTs === today) return 'Today'
  if (dayTs === yesterday) return 'Yesterday'
  return new Date(dayTs).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

/**
 * Bucket items by local day. Within a day, items keep their input order (so
 * callers that pre-sort newest-first stay newest-first).
 *
 * `order` must match how the caller sorted the items: pass 'asc' for an
 * oldest-first list, or the day sections run newest-first while the rows
 * inside each one run oldest-first — a list that is neither order.
 *
 * Returns `[dayStartTs, items][]`.
 */
export function groupByDay<T>(
  items: T[],
  getTs: (item: T) => number,
  order: 'asc' | 'desc' = 'desc',
): [number, T[]][] {
  const map = new Map<number, T[]>()
  for (const item of items) {
    const day = startOfDay(getTs(item))
    const arr = map.get(day) ?? []
    arr.push(item)
    map.set(day, arr)
  }
  return Array.from(map.entries()).sort(([a], [b]) => (order === 'asc' ? a - b : b - a))
}
