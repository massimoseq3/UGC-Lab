import { useRef } from 'react'

// Backdrop-click dismissal that survives a text-selection drag.
//
// The bug this exists to prevent: a drag that STARTS inside the panel (picking
// up text in a textarea, or selecting a prompt to copy) and releases over the
// backdrop fires a `click` on the two targets' COMMON ANCESTOR — the backdrop —
// so a bare `onClick={onClose}` closes the overlay and throws the edit away.
// Guarding with `stopPropagation` on the panel does NOT help: that click never
// originated inside the panel, so the panel's handler never runs.
//
// The rule is "a click is where the press went down and came back up on the
// same element". A real click reports the same target for mousedown and click;
// a drag across element boundaries reports the ancestor on click, so it fails
// the test and the overlay stays open.
//
// Deliberately NOT `e.target === e.currentTarget`: several overlays (the video
// and influencer lightboxes, the Playground preview) dismiss on clicks that
// bubble up from transparent centering wrappers, and demanding the backdrop
// itself be the target would silently kill those dismiss areas. This keeps the
// existing `stopPropagation`-on-the-panel contract every overlay already uses —
// so any panel that must not dismiss still needs its own stopPropagation, the
// same as before.
//
// Call it at the TOP of the component (never inside JSX that sits after an
// early `return null`, which would make the hook call conditional), then spread
// the result onto the backdrop:
//
//   const backdrop = useBackdropClose(onClose)
//   ...
//   <div className="fixed inset-0 …" {...backdrop}>
export function useBackdropClose(onClose: () => void) {
  const pressTarget = useRef<EventTarget | null>(null)
  return {
    onMouseDown: (e: React.MouseEvent) => {
      pressTarget.current = e.target
    },
    onClick: (e: React.MouseEvent) => {
      const from = pressTarget.current
      pressTarget.current = null
      if (from === e.target) onClose()
    },
  }
}

export default useBackdropClose
