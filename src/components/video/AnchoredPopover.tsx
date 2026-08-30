import { useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnAppSwitch } from '../../hooks/useCloseOnAppSwitch'

// Two overlay tiers, and the default is deliberately the LOWEST in the app.
// This component's job is escaping a scrolling panel's clip, not covering a
// modal — which is what lets a modal sitting at the same z-[60] win on DOM
// order (it is portaled first, the menu after) instead of painting over its own
// menus. `PresetPickerModal` relies on exactly that and says so.
//
// A caller mounted ABOVE that tier has the opposite problem and needs the menu
// raised with it: `BankPicker`'s slide-over is z-[80] over a z-[70] backdrop,
// so it can sit over B-Roll's z-[60] card modal, and a default-tier menu opened
// from inside it renders behind the panel — a trigger that visibly opens onto
// nothing. That's what 'panel' is for.
const TIERS = {
  default: { catcher: 'z-[55]', menu: 'z-[60]' },
  panel: { catcher: 'z-[85]', menu: 'z-[90]' },
} as const

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
  // Which overlay tier to paint on. See `TIERS` below — raise it only for a
  // caller that is itself mounted above the default one.
  tier?: keyof typeof TIERS
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
  tier = 'default',
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
      // An anchor with no box at all has been swapped out from under us — on a
      // phone that's `MobilePaneTabs` hiding the whole pane the button lives on
      // (`display: none`), which reports 0×0 rather than unmounting. The menu is
      // portaled to the body, so it survives that and re-measures to the top-left
      // corner, floating over a pane its button isn't even on. A menu whose
      // anchor is gone isn't a menu: close it.
      if (rect.width === 0 && rect.height === 0) {
        onClose()
        return
      }
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
  }, [open, anchorRef, estimatedHeight, width, placement, onClose])

  if (!open || !pos) return null

  return createPortal(
    <>
      <div className={`fixed inset-0 ${TIERS[tier].catcher}`} onClick={onClose} />
      <div
        className={`fixed ${TIERS[tier].menu} ${className}`}
        style={{ top: pos.top, left: pos.left, width }}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}
