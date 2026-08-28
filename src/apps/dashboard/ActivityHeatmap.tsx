import { useMemo, useState } from 'react'
import type { UsageDay } from '../../stores/types'
import { usageDayId } from '../../utils/usage'

// GitHub-style activity grid: one rounded cell per day, columns are weeks
// (Monday-first), intensity is a single-hue sequential ramp on the Dashboard
// green. Empty days stay in quiet ink so the accent only ever encodes data.

// A QUARTER's worth of weeks, not half a year (August 2026, Massimo's call). It
// ran 26 columns back, which at the tile's own width drew cells too small to
// read and spent most of the picture on months a member has stopped thinking
// about — the recent run is the thing this widget is looked at for. Thirteen
// columns fill the same box at roughly twice the cell size.
const WEEKS = 13

// Sequential intensity ramp — thresholds chosen so a casual day (1–2 gens)
// already lights up while heavy batch days still read distinctly darker.
//
// There is no printed key. A `HeatmapLegend` ("Less ▪▪▪▪ More") sat beside the
// grid at `xl` and came out in August 2026 (Massimo's call): darker means more
// is the one thing about this picture nobody has to be told.
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

type WeekColumn = Array<{ id: string; count: number; future: boolean; label: string }>

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
    return Array.from({ length: WEEKS }, (_, w) =>
      // Constructing each day as a real calendar date (not weekStart + i·DAY_MS)
      // keeps every cell on the right local day across DST transitions.
      Array.from({ length: 7 }, (_, i) => {
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
      }),
    )
  }, [days, now])

  // The grid SIZES ITSELF to whatever tile it is dropped in: every column takes
  // `flex-1 min-w-0` and every cell `aspect-square w-full`, so the blocks come
  // out as big as the row allows and the picture ends where the tile does. It
  // drew at a fixed 11px per cell above `sm` until August 2026, which made it a
  // fixed-size object in a fluid box — a dead margin down its right wherever the
  // tile was wider (reported as "a massive gap" the moment the legend that had
  // been filling it came out) and an overflow scrollbar wherever it was
  // narrower. Both were the same bug.
  //
  // `max-w` is the one limit: 13 square cells with no ceiling would be ~24px
  // each in a full-width tile, and the grid's HEIGHT follows its cell size, so
  // the whole wall's second row would grow with the window. Capped, a wide tile
  // centres the grid instead — even margins, which read as placement where a
  // one-sided margin reads as a gap.
  //
  // There are no month labels. They were a 9px row over the grid, and at
  // thirteen columns the picture is a quarter and reads as "the recent run"
  // rather than as a calendar to find a date in.
  return (
    <div className="w-full min-w-0 pb-1">
      <div className="flex justify-center gap-[2px] sm:gap-[3px]">
        {weeks.map((week, i) => (
          <div key={i} className="flex min-w-0 max-w-[18px] flex-1 flex-col gap-[2px] sm:gap-[3px]">
            {week.map((day) =>
              day.future ? (
                <span key={day.id} className="aspect-square w-full rounded-[2px] sm:rounded-[3px]" />
              ) : (
                <span
                  key={day.id}
                  title={day.label}
                  className={`aspect-square w-full rounded-[2px] sm:rounded-[3px] ${levelClass(day.count)}`}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
