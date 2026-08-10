import { createPortal } from 'react-dom'
import { useAnnouncementStore } from '../../stores/announcementStore'
import { useBackdropClose } from '../../hooks/useBackdropClose'
import useCloseOnEscape from '../../hooks/useCloseOnEscape'
import AnnouncementCard from './AnnouncementCard'

// The one announcement type allowed to interrupt: an 'alert'. It opens once,
// the first time the member loads the app after it was published, and
// dismissing it marks it read so it never opens again. Everything else settles
// for the dot on the Dashboard tile.
//
// Only ever one at a time (the store hands over the OLDEST unread alert) — two
// stacked modals in front of someone trying to start work is how a channel
// gets ignored.

export default function AnnouncementAlert() {
  const alertId = useAnnouncementStore((s) => s.alertId)
  const items = useAnnouncementStore((s) => s.items)
  const dismiss = useAnnouncementStore((s) => s.dismissAlert)
  const openPanel = useAnnouncementStore((s) => s.openPanel)

  const backdrop = useBackdropClose(dismiss)
  useCloseOnEscape(Boolean(alertId), dismiss)

  const announcement = alertId ? items.find((a) => a.id === alertId) : null
  if (!announcement || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] overflow-hidden rounded-3xl border border-ink/10 bg-surface-1 shadow-2xl shadow-black/40"
      >
        <div className="max-h-[70vh] overflow-y-auto p-3">
          <AnnouncementCard announcement={announcement} unread chrome="bare" onNavigate={dismiss} />
        </div>
        <div className="flex items-center gap-2 border-t border-ink/5 p-3">
          <button
            onClick={() => { dismiss(); openPanel() }}
            className="h-9 rounded-full px-3.5 text-[12px] font-medium text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-100"
          >
            See all
          </button>
          <button
            onClick={dismiss}
            className="ml-auto h-9 rounded-full bg-ink px-5 text-[12px] font-semibold text-paper transition-colors hover:bg-ink/90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
