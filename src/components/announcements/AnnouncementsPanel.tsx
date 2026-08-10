import { useEffect, useRef } from 'react'
import { Siren } from 'lucide-react'
import { useAnnouncementStore, unreadCount, type Announcement } from '../../stores/announcementStore'
import SlideOver from '../SlideOver'
import AnnouncementCard from './AnnouncementCard'

// The announcements log — every announcement that's still live, newest first,
// pinned on top. It's a log rather than an inbox that empties itself: a member
// who joins in September should still be able to read what shipped in July,
// and it keeps the Dashboard tile worth clicking on the 95% of days when
// there's nothing new.

export default function AnnouncementsPanel() {
  const open = useAnnouncementStore((s) => s.panelOpen)
  const close = useAnnouncementStore((s) => s.closePanel)
  const items = useAnnouncementStore((s) => s.items)
  const readIds = useAnnouncementStore((s) => s.readIds)
  const markAllRead = useAnnouncementStore((s) => s.markAllRead)
  const loading = useAnnouncementStore((s) => s.loading)

  const unread = unreadCount(items, readIds)

  return (
    <SlideOver
      open={open}
      onClose={close}
      title="Announcements"
      subtitle={
        items.length === 0
          ? undefined
          : unread > 0
            ? `${unread} unread · ${items.length} total`
            : `${items.length} in the log`
      }
      size="medium"
      footer={
        unread > 0 ? (
          <button
            onClick={markAllRead}
            className="h-9 w-full rounded-full bg-ink/5 text-[12px] font-semibold text-ink-300 transition-colors hover:bg-ink/10 hover:text-ink-100"
          >
            Mark all as read
          </button>
        ) : undefined
      }
    >
      <div className="space-y-3 p-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <Siren className="h-7 w-7 text-ink-700" strokeWidth={1.5} />
            <p className="text-[13px] text-ink-500">
              {loading ? 'Loading…' : 'Nothing announced yet.'}
            </p>
          </div>
        ) : (
          items.map((a) => (
            <SeenCard key={a.id} announcement={a} unread={!readIds.includes(a.id)} onNavigate={close} />
          ))
        )}
      </div>
    </SlideOver>
  )
}

// How long a card has to stay on screen before it counts as read. Long enough
// that scrolling past the bottom of the log doesn't silently mark five
// announcements read — the receipts in Admin are only worth showing if "seen"
// means someone actually looked at it.
const DWELL_MS = 900

function SeenCard({
  announcement,
  unread,
  onNavigate,
}: {
  announcement: Announcement
  unread: boolean
  onNavigate: () => void
}) {
  const markRead = useAnnouncementStore((s) => s.markRead)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!unread || !node || typeof IntersectionObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer = setTimeout(() => markRead(announcement.id), DWELL_MS)
        } else if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
      },
      { threshold: 0.5 },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [unread, announcement.id, markRead])

  return (
    <div ref={ref}>
      <AnnouncementCard announcement={announcement} unread={unread} onNavigate={onNavigate} />
    </div>
  )
}
