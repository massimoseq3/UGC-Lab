import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useBackdropClose } from '../../../hooks/useBackdropClose'

/**
 * The shell both of this app's pickers wear — the voice list and the saved
 * presets.
 *
 * They were in-panel views that took over the left column, which worked while
 * that column held nothing but settings. It now holds Generate, and a picker
 * that covers the whole column covers the button too — so both come out to a
 * centred modal, the shape every other picker in the app already uses
 * (`PresetPickerModal`, `BankPicker`). Massimo asked for the presets to pop
 * like those; the voice list follows because the two are the same gesture one
 * after the other and are the one place in the app where two pickers sit a
 * click apart, so they can't wear different clothes.
 *
 * Geometry is `PresetPickerModal`'s, with one difference: these hold a LIST of
 * rows rather than a wall of pictures, so the panel is `max-w-xl` and sizes to
 * its content under a `max-h-[86vh]` ceiling. A fixed `h-[86vh]` would open a
 * near-empty box on a bank holding three presets.
 *
 * Tier is `z-[60]` for the reason spelled out in `PresetPickerModal`: every
 * `Dropdown` / `AnchoredPopover` menu portals at that tier over a `z-[55]`
 * catcher, so a panel above it paints over its own menus. Sharing the tier
 * lets DOM order decide, and a menu appended to the body later wins.
 */
export default function PickerModal({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
}) {
  const backdrop = useBackdropClose(onClose)
  useCloseOnEscape(open, onClose)
  useCloseOnAppSwitch(open, onClose)

  // Portalled to the body so a scrolling panel can't clip it — read as a plain
  // expression, the same shape `PresetPickerModal` uses.
  const portalTarget = typeof document !== 'undefined' ? document.body : null
  if (!open || !portalTarget) return null

  return createPortal(
    <div className="modal-fade fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" {...backdrop}>
      {/* `modal-pop` is the app's one modal arrival — see index.css. This
          unmounts on close, so it has no closed state to transition from and
          the keyframe runs on mount. */}
      <div
        className="modal-pop flex max-h-[86vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-ink/10 bg-surface-0 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-[57px] shrink-0 items-center justify-between gap-3 border-b border-ink/5 px-5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-tight text-ink-200">{title}</h3>
            {subtitle && <p className="truncate text-[11px] text-ink-600">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    portalTarget,
  )
}
