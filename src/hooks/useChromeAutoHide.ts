import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useChromeStore } from '../stores/chromeStore'

// Scrolling down inside an app collapses the chrome away; scrolling back up
// brings it straight back.
//
// A phone gives the workspace ~812px and the fixed chrome takes 144 of them
// (a 36px menu bar plus a ~108px dock) before an app has drawn a pixel — and
// every app then puts its own bars on top of that: the pane tabs, a panel
// header, a history search + filter row. Reading a long list on that budget is
// looking at the content through a slot. So the moment a scroll is clearly a
// read rather than a nudge, the chrome gets out of the way.
//
// Three rules keep it from feeling twitchy:
//  - It listens in the CAPTURE phase on window. Scroll events don't bubble,
//    but they do propagate downward, so one listener catches every scroller in
//    the app — the pane's own, a panel column, a history list — without each
//    one having to opt in.
//  - It only answers to scrollers inside the ACTIVE app pane. Background apps
//    stay mounted, and overlays are portaled to the body, so a modal's own
//    scrolling can't strand the chrome hidden behind it.
//  - Direction has to be sustained (`HIDE_TRAVEL_PX` / `SHOW_TRAVEL_PX`) and
//    the accumulator resets the moment the finger changes direction, so the
//    rubber-band at the end of a fling doesn't flap the dock.
//  - Every flip mutes the tracker for `SETTLE_MS`. Collapsing the chrome makes
//    the pane taller, which shortens every scroller inside it — and a list
//    parked near its end is then CLAMPED back up by the browser, which arrives
//    here as a large upward scroll nobody made. Without the mute that reads as
//    "show the chrome", which shrinks the pane, which lets the scroll back
//    down: the dock flaps once a frame. The mute re-baselines instead.
// Near the top of a list the chrome is always shown: that's where you go to
// reach for it.

const MOBILE_QUERY = '(max-width: 767px)'
const HIDE_TRAVEL_PX = 28
const SHOW_TRAVEL_PX = 14
const TOP_ZONE_PX = 32
// Apps the dock never gets out of the way for. Edit is one screen of download
// page: collapsing the dock hands it ~108px it has no use for, and what the
// member sees is the page jumping under a thumb that was only nudging it.
const NEVER_HIDE_IN = new Set(['edit-studio', 'dashboard'])
const SETTLE_MS = 260
// The chrome is worth ~144px. A scroller with less overflow than that gains
// nothing by hiding it — and hiding it can leave the list too short to scroll
// back up far enough to ask for it again.
const MIN_OVERFLOW_PX = 200

export function useChromeAutoHide(): void {
  const activeApp = useAppStore((s) => s.activeApp)

  // A dock switch always hands back the chrome — otherwise you land in the
  // next app with the dock you just used gone.
  useEffect(() => {
    useChromeStore.getState().setHidden(false)
  }, [activeApp])

  const enabled = !!activeApp && !NEVER_HIDE_IN.has(activeApp)

  useEffect(() => {
    if (!enabled) return
    const mq = window.matchMedia(MOBILE_QUERY)
    const setHidden = useChromeStore.getState().setHidden
    // Per-scroller, so two columns in the same app can't read each other's
    // last position. Weak so a torn-down panel doesn't leak.
    const lastTop = new WeakMap<EventTarget, number>()
    let travel = 0
    let mutedUntil = 0

    const flip = (hidden: boolean) => {
      travel = 0
      mutedUntil = performance.now() + SETTLE_MS
      setHidden(hidden)
    }

    const onScroll = (event: Event) => {
      if (!mq.matches) return
      const el = event.target as HTMLElement | null
      if (!el || typeof el.closest !== 'function') return
      if (!el.closest('[data-app-pane="active"]')) return

      const top = el.scrollTop
      const prev = lastTop.get(el)
      lastTop.set(el, top)
      if (prev === undefined) return

      const delta = top - prev
      if (delta === 0) return

      // Everything the relayout itself caused is not a gesture.
      if (performance.now() < mutedUntil) {
        travel = 0
        return
      }

      if (top <= TOP_ZONE_PX) {
        flip(false)
        return
      }

      // Direction change starts the count again.
      if (travel !== 0 && travel > 0 !== delta > 0) travel = 0
      travel += delta

      if (travel > HIDE_TRAVEL_PX) {
        if (el.scrollHeight - el.clientHeight >= MIN_OVERFLOW_PX) flip(true)
      } else if (travel < -SHOW_TRAVEL_PX) {
        flip(false)
      }
    }

    // Rotating to a tablet width (or resizing a desktop window back up) has to
    // restore the chrome, or it stays hidden on a layout that never hides it.
    const onQueryChange = () => {
      if (!mq.matches) setHidden(false)
    }

    window.addEventListener('scroll', onScroll, true)
    mq.addEventListener('change', onQueryChange)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      mq.removeEventListener('change', onQueryChange)
    }
  }, [enabled])
}
