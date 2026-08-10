import { Siren } from 'lucide-react'
import { useAnnouncementStore, unreadCount } from '../../stores/announcementStore'
import { WIDGET_SHELL, WIDGET_INTERACTIVE, DISPLAY_FONT, riseStyle } from './Widget'

// The way into the announcements log, sitting in the desktop's second row above
// the Academy card. Cut from the same glass as every other widget, so it reads
// as part of the desktop rather than a notification bolted onto it.
//
// The dot is the whole point: it's the only thing on this screen that changes
// because someone ELSE did something.

export default function AnnouncementsTile({ index, className = '' }: { index: number; className?: string }) {
  const items = useAnnouncementStore((s) => s.items)
  const readIds = useAnnouncementStore((s) => s.readIds)
  const openPanel = useAnnouncementStore((s) => s.openPanel)

  const unread = unreadCount(items, readIds)
  const hasAlert = items.some((a) => a.level === 'alert' && !readIds.includes(a.id))

  return (
    <button
      onClick={openPanel}
      style={riseStyle(index)}
      className={`widget-rise group relative flex items-center gap-2.5 p-3.5 text-left ${WIDGET_SHELL} ${WIDGET_INTERACTIVE} ${className}`}
    >
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-dashboard-500/15">
        <Siren className="h-[18px] w-[18px] text-dashboard-400" strokeWidth={1.75} />
        {unread > 0 && (
          // Ringed in the page fill so the dot reads as a badge on the glyph
          // rather than a stray pixel floating over the glass.
          <span
            className={`absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-surface-0 bg-red-500 ${
              hasAlert ? 'animate-pulse' : ''
            }`}
            aria-hidden
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[15px] italic font-normal leading-tight tracking-tight text-ink-50"
          style={DISPLAY_FONT}
        >
          Announcements
        </span>
        <span
          className={`mt-0.5 block truncate text-[11px] leading-snug ${unread > 0 ? 'text-dashboard-400' : 'text-ink-500'}`}
        >
          {unread > 0 ? `${unread} unread` : items.length > 0 ? 'All caught up' : 'Nothing new'}
        </span>
      </span>
    </button>
  )
}
