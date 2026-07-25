import { useMemo, useState } from 'react'
import type { UsageDay } from '../../stores/types'
import { usageDayId } from '../../utils/usage'

// GitHub-style activity grid: one rounded cell per day, columns are weeks
// (Monday-first), intensity is a single-hue sequential ramp on the Dashboard
// amber. Empty days stay in quiet ink so the accent only ever encodes data.

const WEEKS = 26

// Sequential intensity ramp — thresholds chosen so a casual day (1–2 gens)
// already lights up while heavy batch days still read distinctly darker.
const LEVELS: Array<{ min: number; className: string }> = [
  { min: 12, className: 'bg-dashboard-500' },
  { min: 6, className: 'bg-dashboard-500/70' },
  { min: 3, className: 'bg-dashboard-500/45' },
  { min: 1, className: 'bg-dashboard-500/25' },
  { min: 0, className: 'bg-ink/[0.06]' },
]

function levelClass(count: number): string {
  return LEVELS.find((l) => count >= l.min)!.className
}

// Local-midnight Date of the Monday on or before `ts`. Returns a Date (not a
// timestamp) so callers can step by calendar days via the Date constructor,
// which handles DST/month rollover — millisecond stepping drifts a day around
// a DST switch and lands two cells on the same calendar day.
function mondayOfWeek(ts: number): Date {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  const shift = (d.getDay() + 6) % 7 // Mon=0 … Sun=6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - shift)
}

interface WeekColumn {
  monthLabel: string | null
  days: Array<{ id: string; count: number; future: boolean; label: string }>
}

export default function ActivityHeatmap({ days }: { days: UsageDay[] }) {
  // Captured once per mount — the grid's "today" anchor. Fine to go stale
  // across a midnight while the tab sits open; a reload re-anchors it.
  const [now] = useState(() => Date.now())
  const weeks = useMemo<WeekColumn[]>(() => {
    const counts = new Map<string, number>()
    for (const day of days) {
      const total = Object.values(day.counts).reduce((sum, n) => sum + (n ?? 0), 0)
      if (total > 0) counts.set(day.id, total)
    }

    const anchor = mondayOfWeek(now)
    // First Monday of the grid, stepped back by whole calendar weeks.
    const gridYear = anchor.getFullYear()
    const gridMonth = anchor.getMonth()
    const gridDate = anchor.getDate() - (WEEKS - 1) * 7
    const out: WeekColumn[] = []
    let lastMonth = -1
    for (let w = 0; w < WEEKS; w++) {
      // Constructing each day as a real calendar date (not weekStart + i·DAY_MS)
      // keeps every cell on the right local day across DST transitions.
      const weekStart = new Date(gridYear, gridMonth, gridDate + w * 7)
      // Label a column when it starts a new month (skip the very first column
      // if the label would collide with nothing before it — GitHub-style).
      const month = weekStart.getMonth()
      const monthLabel = month !== lastMonth
        ? weekStart.toLocaleDateString(undefined, { month: 'short' })
        : null
      lastMonth = month
      const daysInWeek = Array.from({ length: 7 }, (_, i) => {
        const cell = new Date(gridYear, gridMonth, gridDate + w * 7 + i)
        const ts = cell.getTime()
        const id = usageDayId(ts)
        const count = counts.get(id) ?? 0
        return {
          id,
          count,
          future: ts > now,
          label: `${cell.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${count === 0 ? 'no generations' : `${count} generation${count === 1 ? '' : 's'}`}`,
        }
      })
      out.push({ monthLabel, days: daysInWeek })
    }

    // Labels are absolutely narrow (11px column, ~18px of text), so two month
    // starts within a couple of columns render as one smudge — the grid's
    // first column is the usual culprit, since it's labelled even when the
    // month turns over a week later ("JanFeb"). Drop the earlier of any two
    // labels closer than MIN_LABEL_GAP columns; the later one wins because it
    // marks the month that actually owns most of the grid.
    const MIN_LABEL_GAP = 3
    let lastLabelled = -MIN_LABEL_GAP
    for (let w = 0; w < out.length; w++) {
      if (!out[w].monthLabel) continue
      if (w - lastLabelled < MIN_LABEL_GAP) out[lastLabelled].monthLabel = null
      lastLabelled = w
    }
    return out
  }, [days, now])

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-flex flex-col gap-1.5">
        {/* Month labels row */}
        <div className="flex gap-[3px]">
          {weeks.map((week, i) => (
            <span key={i} className="w-[11px] shrink-0 overflow-visible whitespace-nowrap text-[9px] leading-none text-ink-500">
              {week.monthLabel ?? ''}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {weeks.map((week, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {week.days.map((day) =>
                day.future ? (
                  <span key={day.id} className="h-[11px] w-[11px] rounded-[3px]" />
                ) : (
                  <span
                    key={day.id}
                    title={day.label}
                    className={`h-[11px] w-[11px] rounded-[3px] ${levelClass(day.count)}`}
                  />
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
