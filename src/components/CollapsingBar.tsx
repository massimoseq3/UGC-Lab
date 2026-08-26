import { useEffect, useState, type ReactNode } from 'react'
import { useChromeHidden } from '../stores/chromeStore'

// A bar that rolls up out of the way while the member scrolls down a phone,
// and unrolls the moment they scroll back up. Above `md` it is a plain
// wrapper — nothing here applies, so the desktop layout is untouched by
// construction (the `md:` rules win on source order, no JS media query).
//
// Collapsed with `grid-template-rows: 0fr`, not a height or a translate: the
// bars this wraps are content-sized (B-Roll's filter row wraps to two lines
// once the mode pills appear), and 0fr → 1fr animates a box whose height
// nobody had to measure. The child owns the border and padding, so a collapsed
// bar leaves no hairline behind.
//
// The clip is released once the bar is fully open. `overflow: hidden` is what
// makes the roll read as a roll, but these bars carry popovers — B-Roll's sort
// menu opens downward into the list — and a permanent clip would cut them off
// at the bar's own edge. So it holds only while collapsed or mid-animation.
//
// Put this around the bar ONLY, never around the scroller underneath it — the
// point is to hand those pixels to the list.
const OPEN_MS = 300

export default function CollapsingBar({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  const hidden = useChromeHidden()
  // Starts settled when the bar starts open, so a desktop render (where this
  // never animates) has an unclipped bar from the first paint.
  const [settled, setSettled] = useState(!hidden)
  const [wasHidden, setWasHidden] = useState(hidden)

  // Adjusted during render rather than in an effect: the clip has to be back on
  // in the SAME commit that starts the roll, or the first frame of a collapse
  // shows the bar's full height spilling out of a 0fr track.
  if (wasHidden !== hidden) {
    setWasHidden(hidden)
    setSettled(false)
  }

  useEffect(() => {
    if (hidden) return
    // A timer rather than `transitionend`: the event doesn't fire when the
    // transition is interrupted or when the browser skips it (reduced motion, a
    // `display:none` pane), and a bar stuck clipped would silently swallow its
    // own menus.
    const timer = window.setTimeout(() => setSettled(true), OPEN_MS)
    return () => window.clearTimeout(timer)
  }, [hidden])

  return (
    <div
      className={`grid shrink-0 transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:grid-rows-[1fr] md:opacity-100 ${
        hidden ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
      } ${className}`}
    >
      <div className={`min-h-0 ${settled ? '' : 'overflow-hidden'}`}>{children}</div>
    </div>
  )
}
