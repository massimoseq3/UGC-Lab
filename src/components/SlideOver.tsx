import { createPortal } from 'react-dom'
import { X, ChevronLeft } from 'lucide-react'
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
  // 'wide' matches BankPicker's 560px panel — for card grids where 380px
  // squeezes the tiles too small to read. 'medium' (460px) is the step between,
  // for a grid that wants a bigger tile without giving up the compact panel.
  size?: 'default' | 'medium' | 'wide'
  // Optional back arrow left of the title, for a panel with a second view
  // inside it (StyleModal's "New style from references").
  onBack?: () => void
  // Stacking tier. 'default' (backdrop z-70 / panel z-80) matches BankPicker
  // and ModelSidePanel. 'below-pickers' sits under those but still above the
  // z-60 modals — for a slide-over that opens a BankPicker on top of itself,
  // which on the shared tier would land behind it (equal z, later in <body>).
  layer?: 'default' | 'below-pickers'
}

// Right-edge slide-over panel — the same chrome as BankPicker (portal at
// document root, backdrop, 380px panel — or 560px on `size='wide'`, matching
// BankPicker exactly) so pickers and preset browsers read as one pattern.
export default function SlideOver({ open, onClose, title, subtitle, children, footer, size = 'default', onBack, layer = 'default' }: SlideOverProps) {
  useCloseOnAppSwitch(open, onClose)

  useCloseOnEscape(open, onClose)

  const portalTarget = typeof document !== 'undefined' ? document.body : null
  if (!portalTarget) return null

  return createPortal(
    <>
      <div
        className={`fixed inset-0 ${layer === 'below-pickers' ? 'z-[64]' : 'z-[70]'} bg-black/50 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      {/* `pb-[env(safe-area-inset-bottom)]` on the panel, not on the footer:
          it shrinks the flex column, so the scrolling list AND the footer under
          it both end above the home indicator. Zero in a browser tab, ~34px
          installed to an iPhone home screen — where `viewport-fit=cover` and no
          browser bar mean this panel really does run to the physical bottom
          edge, and the last row of a picker sits in a strip you can't reliably
          touch. Same fix as the workspace pane's bottom inset in App.tsx. */}
      <div
        className={`fixed bottom-0 right-0 top-0 ${layer === 'below-pickers' ? 'z-[66]' : 'z-[80]'} flex ${
          size === 'wide' ? 'w-[560px]' : size === 'medium' ? 'w-[460px]' : 'w-[380px]'
        } max-w-full flex-col border-l border-ink/5 bg-surface-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-ink/5 px-5 py-3.5">
          {onBack && (
            <button
              onClick={onBack}
              className="-ml-1 shrink-0 rounded-full p-1 text-ink-400 transition-colors hover:bg-ink/10 hover:text-ink-100"
              aria-label="Back"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
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
