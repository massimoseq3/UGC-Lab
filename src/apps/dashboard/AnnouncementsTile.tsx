import { Siren } from 'lucide-react'
import { useAnnouncementStore, unreadCount } from '../../stores/announcementStore'
import {
  WIDGET_SHELL,
  WIDGET_INTERACTIVE,
  DISPLAY_FONT,
  riseStyle,
  SHORTCUT_TILE,
  SHORTCUT_TILE_DISC,
  SHORTCUT_TILE_GLYPH,
  SHORTCUT_TILE_TEXT,
  SHORTCUT_TILE_TITLE,
  SHORTCUT_TILE_SUB,
} from './Widget'

// The way into the announcements log, sitting in the desktop's second row
// beside the Academy card. Cut from the same glass as every other widget, so it reads
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
      // Shape is shared with the Academy card — see SHORTCUT_TILE in Widget.tsx.
      // `text-left` is only the button's own default being undone; both centred
      // layouts override it from their own media query.
      className={`${SHORTCUT_TILE} text-left ${WIDGET_SHELL} ${WIDGET_INTERACTIVE} ${className}`}
    >
      <span className={`relative ${SHORTCUT_TILE_DISC}`}>
        <Siren className={`text-dashboard-400 ${SHORTCUT_TILE_GLYPH}`} strokeWidth={1.75} />
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
      <span className={SHORTCUT_TILE_TEXT}>
        <span className={SHORTCUT_TILE_TITLE} style={DISPLAY_FONT}>
          Announcements
        </span>
        <span
          className={`${SHORTCUT_TILE_SUB} ${unread > 0 ? 'text-dashboard-400' : 'text-ink-500'}`}
        >
          {unread > 0 ? `${unread} unread` : items.length > 0 ? 'All caught up' : 'Nothing new'}
        </span>
      </span>
    </button>
  )
}
