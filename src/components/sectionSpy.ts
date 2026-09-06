import { useRef, useState } from 'react'

// The scroll-spy and the grid track behind `components/SectionRail`, in their
// own module because that one exports components: react-refresh can only
// hot-reload a file whose exports are all components, and a hook plus a class
// string beside them breaks it (the same split `styleArt.ts` made).

// How close to the top of the scroll port a section's heading has to come
// before the rail calls it the one you're in. A section is a row of tiles tall
// at minimum, so a fixed band reads the same on every list.
const SPY_OFFSET = 64

/**
 * The scroll-spy behind the rail.
 *
 * Hands back the scroller ref and the scroll handler to give `Modal`, a ref
 * callback each section tags itself with, the key currently on screen, and the
 * jump every rail row calls.
 *
 * Positions are measured with rects rather than `offsetTop`: the scroller is
 * not a positioned element, so a section's `offsetTop` is counted from the
 * panel and carries the title bar and toolbar with it — about a row's worth of
 * error, which is exactly how far a jump overshoots.
 */
export function useSectionSpy(keys: string[]) {
  const portRef = useRef<HTMLDivElement | null>(null)
  const els = useRef(new Map<string, HTMLElement>())
  const [scrolled, setScrolled] = useState<string | null>(null)

  const register = (key: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(key, el)
    else els.current.delete(key)
  }

  // A section can be filtered away under the highlight. An unknown key falls
  // back to the FIRST one, which is what the top of a re-filtered list means.
  const activeKey = scrolled && keys.includes(scrolled) ? scrolled : (keys[0] ?? null)

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const portTop = el.getBoundingClientRect().top
    // The last section whose heading has passed the band below the port's top
    // is the one being looked at. Tops only increase down the list, so the walk
    // stops at the first section still below the band.
    let current = keys[0]
    for (const key of keys) {
      const node = els.current.get(key)
      if (!node) continue
      if (node.getBoundingClientRect().top - portTop > SPY_OFFSET) break
      current = key
    }
    // Only on a real change — this fires on every scroll frame.
    if (current && current !== scrolled) setScrolled(current)
  }

  const jumpTo = (key: string) => {
    const el = portRef.current
    if (!el) return
    setScrolled(key)
    // The first section is simply the top — no measuring, and it puts the
    // toolbar above it back on screen too.
    if (key === keys[0]) {
      el.scrollTop = 0
      return
    }
    const node = els.current.get(key)
    if (!node) return
    el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - 12
  }

  return { portRef, register, activeKey, onScroll, jumpTo }
}

// The one tile track for every gallery grid. From `sm` up the TILE SIZE is the
// constant, not the column count: at `gallery` width beside a rail this lands
// seven ~120px tiles to a row, and it gives up columns on its own as the panel
// narrows, instead of a hardcoded `grid-cols-3` that shrinks the picture.
//
// The phone keeps a literal three across. A floor low enough to fit three into
// a 375px sheet would fit nine into the desktop panel, and auto-fill would take
// them — so the phone is the one width that has to be stated rather than
// derived.
export const GALLERY_GRID = 'grid grid-cols-3 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(116px,1fr))]'
