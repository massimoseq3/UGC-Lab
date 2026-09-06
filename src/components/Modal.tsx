import type { ReactNode, RefObject, UIEventHandler } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft } from 'lucide-react'
import { useCloseOnAppSwitch } from '../hooks/useCloseOnAppSwitch'
import useCloseOnEscape from '../hooks/useCloseOnEscape'
import { useIsDesktop } from '../hooks/useBreakpoint'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  // Optional pinned footer (e.g. action buttons) below the scroll area.
  footer?: React.ReactNode
  // Panel width, all centred: 'default' 512px for a column of rows, 'medium'
  // 672px for a list beside a rail, 'wide' 768px for a two-column body of rows
  // or form fields, and 'gallery' 1152px — BankPicker's and the Characters
  // preset picker's own width, for a body that is a WALL OF PICTURES or a
  // sectioned list you browse rather than read.
  //
  // A grid of 9:16 tiles is the one body that can't be narrowed without either
  // shrinking the picture past reading it or stacking it into a scroll: seven
  // style previews three across a 512px panel is four rows you have to scroll
  // to compare, when the same tiles at the same size fit on one screen the
  // moment the panel is as wide as the picker every member already browses
  // their characters in.
  size?: 'default' | 'medium' | 'wide' | 'gallery'
  // A table of contents down the left, from `lg` up — see components/SectionRail.
  // Given one, the modal lays the rail beside the scrolling body instead of
  // letting the body fill the panel, and hands the scroller back through
  // `bodyRef` / `onBodyScroll` so the rail's spy can measure it.
  //
  // Below `lg` there is no room for a 204px column beside a grid, so the rail
  // simply doesn't render and the sections are reached by scrolling — the same
  // rule BankPicker follows.
  rail?: ReactNode
  bodyRef?: RefObject<HTMLDivElement | null>
  onBodyScroll?: UIEventHandler<HTMLDivElement>
  // Optional back arrow left of the title, for a panel with a second view
  // inside it (StyleModal's "New style from references").
  onBack?: () => void
  // Stacking tier. 'default' (backdrop z-70 / panel z-80) matches BankPicker
  // and ModelPickerModal. 'below-pickers' sits under those but still above the
  // z-60 modals — for a modal that opens a BankPicker on top of itself, which
  // on the shared tier would land behind it (equal z, later in <body>).
  layer?: 'default' | 'below-pickers'
  // Hold the panel at the full 86vh instead of hugging its content. For a body
  // that filters itself — a search box over a list — where a modal sized by its
  // rows resizes on every keystroke and moves them under the pointer. Leave it
  // off for a short, fixed body, which would otherwise sit in a tall empty box.
  fill?: boolean
}

// The app's one panel modal — the geometry BankPicker and PresetPickerModal
// share (centred, `86vh` ceiling, `rounded-3xl`), with a title bar, a scrolling
// body and an optional pinned footer. It was a right-edge slide-over until
// September 2026: a drawer narrow enough to sit beside the app is too narrow
// for the grids and forms these panels hold, and a picker you reach from the
// middle of the screen shouldn't answer from its edge. On a phone it's a bottom
// sheet, the same shape BankPicker takes there.
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'default',
  onBack,
  layer = 'default',
  fill = false,
  rail,
  bodyRef,
  onBodyScroll,
}: ModalProps) {
  useCloseOnAppSwitch(open, onClose)

  useCloseOnEscape(open, onClose)

  const isDesktop = useIsDesktop()

  const portalTarget = typeof document !== 'undefined' ? document.body : null
  if (!portalTarget) return null

  const width =
    size === 'gallery'
      ? 'max-w-6xl'
      : size === 'wide'
        ? 'max-w-3xl'
        : size === 'medium'
          ? 'max-w-2xl'
          : 'max-w-lg'

  return createPortal(
    <>
      {/* Backdrop — a childless sibling, so a text-selection drag that starts
          inside the panel and is released over it can't be the `click` that
          closes the modal (see hooks/useBackdropClose). */}
      <div
        className={`fixed inset-0 ${layer === 'below-pickers' ? 'z-[64]' : 'z-[70]'} bg-black/50 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      {/* Centring wrapper. `pointer-events-none` so a click that misses the
          panel still lands on the backdrop underneath and closes it. */}
      <div
        className={`pointer-events-none fixed inset-0 ${
          layer === 'below-pickers' ? 'z-[66]' : 'z-[80]'
        } flex items-end justify-center md:items-center md:p-4`}
      >
        {/* `pb-[env(safe-area-inset-bottom)]` on the panel, not on the footer:
            it shrinks the flex column, so the scrolling body AND the footer
            under it both end above the home indicator. Zero in a browser tab,
            ~34px installed to an iPhone home screen. */}
        <div
          className={`pointer-events-auto flex w-full flex-col overflow-hidden border-ink/5 bg-surface-1/95 backdrop-blur-2xl ${
            isDesktop
              ? `${width} ${fill ? 'h-[86vh]' : 'max-h-[86vh]'} rounded-3xl border shadow-2xl shadow-black/40 transition-all duration-200 ease-out ${
                  open ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.98] opacity-0'
                }`
              : `${fill ? 'h-[calc(100%-3.5rem)]' : 'max-h-[calc(100%-3.5rem)]'} rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)] transition-transform duration-300 ease-out ${
                  open ? 'translate-y-0' : 'translate-y-full'
                }`
          }`}
        >
          {/* Drag handle — mobile only */}
          {!isDesktop && (
            <div className="flex shrink-0 justify-center pb-1 pt-2">
              <div className="h-1 w-10 rounded-full bg-ink/20" />
            </div>
          )}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink/5 px-5 py-3.5">
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
          {rail ? (
            <div className="flex min-h-0 flex-1">
              <div className="hidden w-[204px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-ink/5 px-3 py-4 lg:flex">
                {rail}
              </div>
              <div ref={bodyRef} onScroll={onBodyScroll} className="min-h-0 flex-1 overflow-y-auto">
                {children}
              </div>
            </div>
          ) : (
            <div ref={bodyRef} onScroll={onBodyScroll} className="min-h-0 flex-1 overflow-y-auto">
              {children}
            </div>
          )}
          {footer && <div className="shrink-0 border-t border-ink/5 p-4">{footer}</div>}
        </div>
      </div>
    </>,
    portalTarget,
  )
}
