import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useCloseOnAppSwitch } from '../hooks/useCloseOnAppSwitch'
import useCloseOnEscape from '../hooks/useCloseOnEscape'

interface SlideOverProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  // Optional pinned footer (e.g. action buttons) below the scroll area.
  footer?: React.ReactNode
}

// Right-edge slide-over panel — the same chrome as BankPicker (portal at
// document root, backdrop, 380px panel) so pickers and preset browsers read
// as one pattern across the app.
export default function SlideOver({ open, onClose, title, subtitle, children, footer }: SlideOverProps) {
  useCloseOnAppSwitch(open, onClose)

  useCloseOnEscape(open, onClose)

  const portalTarget = typeof document !== 'undefined' ? document.body : null
  if (!portalTarget) return null

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[70] bg-black/50 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed bottom-0 right-0 top-0 z-[80] flex w-[380px] max-w-full flex-col border-l border-ink/5 bg-surface-1/95 backdrop-blur-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-ink/5 px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-tight text-ink-200">{title}</h3>
            {subtitle && <p className="truncate text-[11px] text-ink-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-2 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300 lg:p-1"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="shrink-0 border-t border-ink/5 p-4">{footer}</div>}
      </div>
    </>,
    portalTarget,
  )
}
