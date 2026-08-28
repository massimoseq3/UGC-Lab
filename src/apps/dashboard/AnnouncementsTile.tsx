import { Siren } from 'lucide-react'
import { useAnnouncementStore, unreadCount } from '../../stores/announcementStore'
import type { Announcement } from '../../stores/announcementStore'
import { WIDGET_SHELL, WIDGET_INTERACTIVE, WidgetLabel, riseStyle } from './Widget'

// The way into the announcements log, sitting at the end of the desktop's
// second row. Cut from the same glass as every other widget, so it reads as
// part of the desktop rather than a notification bolted onto it.
//
// It IS a log now (August 2026, Massimo's call), not a labelled door: the newest
// few titles read on the tile itself, unread ones marked. It was a disc over the
// word "Announcements" over "Nothing new", which said nothing at all about the
// thing it opened — and once every tile on the wall became the same size, it was
// the one holding a whole square to say its own name.
//
// The dot is still the point: it's the only thing on this screen that changes
// because someone ELSE did something.

/** How many titles fit under the label without the tile growing a scrollbar. */
const LOG_ROWS = 3

function logDate(a: Announcement): string {
  return new Date(a.publishedAt ?? a.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export default function AnnouncementsTile({ index, className = '' }: { index: number; className?: string }) {
  const items = useAnnouncementStore((s) => s.items)
  const readIds = useAnnouncementStore((s) => s.readIds)
  const openPanel = useAnnouncementStore((s) => s.openPanel)

  const unread = unreadCount(items, readIds)
  const hasAlert = items.some((a) => a.level === 'alert' && !readIds.includes(a.id))
  // `items` arrives sorted (pinned first, then newest) — the log shows the top
  // of that same order, so the tile and the panel can never disagree.
  const recent = items.slice(0, LOG_ROWS)

  return (
    <button
      onClick={openPanel}
      style={riseStyle(index)}
      className={`widget-rise group relative flex flex-col items-center p-4 text-center ${WIDGET_SHELL} ${WIDGET_INTERACTIVE} ${className}`}
    >
      <WidgetLabel icon={Siren} label="Announcements" />
      {/* Out of flow, like the Academy card's ↗: in the label row it would push
          a centred label off centre by half its own width. Ringed in the page
          fill so it reads as a badge rather than a stray pixel on the glass. */}
      {unread > 0 && (
        <span
          className={`absolute right-3 top-3 h-2.5 w-2.5 rounded-full border-2 border-surface-0 bg-red-500 ${
            hasAlert ? 'animate-pulse' : ''
          }`}
          aria-hidden
        />
      )}

      {recent.length === 0 ? (
        <p className="mt-auto pt-4 text-[12px] leading-snug text-ink-500">Nothing new</p>
      ) : (
        // The log reads LEFT-aligned inside a centred tile: everything else on
        // this wall is a figure or a picture, which centre, and a stack of
        // ragged-both-ends titles is the one thing here that is read rather
        // than looked at.
        <ul className="mt-3 w-full flex-1 space-y-1.5 overflow-hidden text-left">
          {recent.map((a) => {
            const isUnread = !readIds.includes(a.id)
            return (
              <li key={a.id} className="flex items-baseline gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full ${
                    isUnread ? 'bg-dashboard-400' : 'bg-ink/15'
                  }`}
                  aria-hidden
                />
                <span
                  className={`min-w-0 flex-1 truncate text-[12px] leading-snug ${
                    isUnread ? 'text-ink-100' : 'text-ink-400'
                  }`}
                >
                  {a.title}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-ink-600">{logDate(a)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </button>
  )
}
