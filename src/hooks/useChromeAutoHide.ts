import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useChromeStore } from '../stores/chromeStore'

// Scrolling down inside an app rolls the DOCK away; scrolling back up hands it
// back.
//
// A phone gives the workspace ~812px and the dock takes ~108 of them before an
// app has drawn a pixel, so the moment a scroll is clearly a read rather than a
// nudge, it gets out of the way. It is the ONLY thing that hides. The menu bar
// stays (the pane never claims its 36px — see App.tsx: it's `fixed` and opaque,
// so "claiming" it only slid each app's top row out of sight behind it), and so
// do the bars inside an app — pane tabs, panel headers, search and filter rows
// — because rolling those away is what made a scroll feel like the page
// rearranging itself under the thumb.
//
// Coming BACK is deliberately expensive. Showing the dock puts it back over
// the bottom of the pane, so a false positive lands it on top of the Generate
// button the member was reaching for — which is how this read on a real phone,
// where the tail of a fling, a finger set down to stop it, and the browser
// clamping a list are all "a small scroll up". Four rules:
//  - It listens in the CAPTURE phase on window. Scroll events don't bubble,
//    but they do propagate downward, so one listener catches every scroller in
//    the app — the pane's own, a panel column, a history list — without each
//    one having to opt in.
//  - It only answers to scrollers inside the ACTIVE app pane. Background apps
//    stay mounted, and overlays are portaled to the body, so a modal's own
//    scrolling can't strand the dock hidden behind it.
//  - Direction has to be SUSTAINED, and asymmetrically so: `SHOW_TRAVEL_PX` is
//    most of a screen's worth of deliberate upward scroll, where
//    `HIDE_TRAVEL_PX` is a nudge. The accumulator resets the moment the finger
//    changes direction, so the settle at the end of a fling can't add up.
//  - A scroll nobody made is not a gesture, and a CLAMP is the one that kept
//    flipping the dock back on at the bottom of a list. Hiding the dock
//    makes the pane taller, which shortens every scroller inside it, and a
//    list parked near its end is then pulled back up by the browser to fit —
//    which arrives here as a large upward scroll. Every flip mutes the tracker
//    for `SETTLE_MS` to cover the relayout it just caused, and `lastMax`
//    catches the same thing arriving late or from somewhere else (a mobile URL
//    bar, the keyboard closing, a lazily-sized tile resolving): an upward
//    delta no bigger than the amount the scroller just LOST is a clamp, not a
//    finger. Deliberately not "any event where the extent changed" — the
//    grids use `content-visibility: auto`, so their scrollHeight moves under
//    every scroll and that blunter test threw the whole gesture away.
// Near the top of a list the dock is always shown: that's where you go to
// reach for it.

const MOBILE_QUERY = '(max-width: 767px)'
const HIDE_TRAVEL_PX = 40
// ~a third of a phone screen. A member who wants the dock back does one clear
// upward swipe for it; nothing incidental travels this far in one direction.
const SHOW_TRAVEL_PX = 260
const TOP_ZONE_PX = 32
// Apps the dock never gets out of the way for. Edit is one screen of download
// page: collapsing the dock hands it ~108px it has no use for, and what the
// member sees is the page jumping under a thumb that was only nudging it.
const NEVER_HIDE_IN = new Set(['edit-studio', 'dashboard'])
const SETTLE_MS = 420
// A clamp lands within a pixel or two of the height the scroller lost; the
// slack absorbs sub-pixel layout without letting a real swipe hide behind a
// small reflow.
const CLAMP_SLACK_PX = 4
// The dock is worth ~108px. A scroller with less overflow than that gains
// nothing by hiding it — and hiding it can leave the list too short to scroll
// back up far enough to ask for it again.
const MIN_OVERFLOW_PX = 200

export function useChromeAutoHide(): void {
  const activeApp = useAppStore((s) => s.activeApp)

  // A dock switch always hands the dock back — otherwise you land in the
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
    // Its scrollable extent alongside it: when that changes, the scrollTop
    // moved because the BOX did, not because a finger did.
    const lastMax = new WeakMap<EventTarget, number>()
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
      const max = el.scrollHeight - el.clientHeight
      const prev = lastTop.get(el)
      const prevMax = lastMax.get(el)
      lastTop.set(el, top)
      lastMax.set(el, max)
      if (prev === undefined) return

      const delta = top - prev
      if (delta === 0) return

      // Everything the relayout itself caused is not a gesture.
      if (performance.now() < mutedUntil) {
        travel = 0
        return
      }

      // The scroller got shorter and the view was dragged up to fit: an upward
      // move within what the scroller just lost is that correction, not a
      // gesture. Re-baseline rather than counting it.
      const lost = prevMax === undefined ? 0 : prevMax - max
      if (lost > 0 && delta < 0 && -delta <= lost + CLAMP_SLACK_PX) {
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
        if (max >= MIN_OVERFLOW_PX) flip(true)
      } else if (travel < -SHOW_TRAVEL_PX) {
        flip(false)
      }
    }

    // Rotating to a tablet width (or resizing a desktop window back up) has to
    // restore the dock, or it stays hidden on a layout that never hides it.
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
