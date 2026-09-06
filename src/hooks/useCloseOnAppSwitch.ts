import { useEffect, useRef } from 'react'
import { useAppStore } from '../stores/appStore'

// Overlays (modals, pickers, lightboxes) portal to document.body, so the
// opacity-0 / pointer-events-none wrapper App.tsx hides background apps with
// can't hide them — an overlay left open would keep floating above whichever
// app the user switches to via the dock. Close it when the active app changes.
//
// `enabled` is the overlay's own open state (pass `true` for overlays that are
// conditionally mounted). The active app at open time is captured so an overlay
// that opens in the same render as an app switch isn't immediately closed.
export function useCloseOnAppSwitch(enabled: boolean, onClose: () => void) {
  const activeApp = useAppStore((s) => s.activeApp)
  const openedIn = useRef<string | null>(null)

  useEffect(() => {
    if (enabled) openedIn.current = useAppStore.getState().activeApp
  }, [enabled])

  // `onClose` in the deps is safe even when callers pass a fresh closure each
  // render: the close only fires when the app actually changed, and closing
  // flips `enabled` off (or unmounts the overlay) so it can't loop.
  useEffect(() => {
    if (enabled && activeApp !== openedIn.current) onClose()
  }, [enabled, activeApp, onClose])
}
