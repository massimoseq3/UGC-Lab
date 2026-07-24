import { useEffect } from 'react'

// Escape closes any dismissible overlay — modal, slide-over, lightbox, confirm
// sheet. Every overlay in the app already closes on a backdrop click; this is
// the keyboard half of the same contract. It was previously hand-rolled ~10
// times (half on `window`, half on `document`) with several overlays missing it
// entirely, so it lives here now.
//
// Pair it with `useCloseOnAppSwitch` for body-portaled overlays.
//
// Nesting note: listeners are plain document-level ones and nothing calls
// stopPropagation, so Escape with a picker open inside a modal closes both.
// That matches the behaviour the hand-rolled copies already had. If a surface
// ever needs the inner overlay to swallow the key, handle it there rather than
// making every caller pay for it.
export default function useCloseOnEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, onClose])
}
