import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnAppSwitch } from '../../hooks/useCloseOnAppSwitch'

interface AnchoredPopoverProps {
  // Anchor element — usually the pill that triggers the menu.
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  width: number
  // Approximate rendered height. Only used to decide whether to flip above the
  // anchor, so a rough number is fine.
  estimatedHeight?: number
  // 'auto' (default) opens below when there's room and flips above when there
  // isn't. 'above' always opens upward — for a trigger pinned near the bottom
  // of a panel, where "there's room below" is measured against the viewport and
  // so a menu can technically fit while still covering the button you're about
  // to press.
  placement?: 'auto' | 'above'
  className?: string
  children: ReactNode
}

// Menu pinned to an anchor element. Rendered via portal so it escapes
// containers with `overflow-hidden` (the Playground's scrolling body clips
// inline-absolute dropdowns), and flipped above the anchor when there isn't
// room below — the prompt panel's controls sit near the viewport's bottom edge.
export default function AnchoredPopover({
  anchorRef,
  open,
  onClose,
  width,
  estimatedHeight = 80,
  placement = 'auto',
  className = '',
  children,
}: AnchoredPopoverProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useCloseOnAppSwitch(open, onClose)

  useLayoutEffect(() => {
    // When closed the component renders null regardless of `pos`, so there's
    // no need to reset position here — reopening re-measures before paint.
    if (!open) return
    function measure() {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const below = placement !== 'above' && spaceBelow >= estimatedHeight + 8
      setPos({
        top: below ? rect.bottom + 4 : rect.top - estimatedHeight - 4,
        // Keep the menu on screen when the anchor sits near the right edge.
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, anchorRef, estimatedHeight, width, placement])

  if (!open || !pos) return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose} />
      <div className={`fixed z-[60] ${className}`} style={{ top: pos.top, left: pos.left, width }}>
        {children}
      </div>
    </>,
    document.body,
  )
}
