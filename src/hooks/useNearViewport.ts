// "Is this tile close enough to be worth loading?" — for grids of clips.
//
// A <video> is not a cheap element. Each one holds a whole clip in memory (read
// out of IndexedDB, or pulled back down off R2 when it isn't cached locally)
// and takes one of the browser's decoders, of which there are far fewer than a
// working member has clips: past the budget the extra elements never paint at
// all, so the grid sits black while the tab stalls on the reads. Playground's
// video history and its zip picker both list every clip ever generated, so both
// hit this at 60+ rows.
//
// Tiles claim their media as they scroll in and release it once they're well
// clear, which keeps the live count tracking the window rather than the
// history. Pass the SCROLLER as the root: ancestor clipping is applied before
// `rootMargin`, so an observer left on the viewport would only ever fire once a
// tile was already on screen — the margin buys nothing and the media pops in
// under the pointer.
import { useEffect, useRef, useState } from 'react'

export default function useNearViewport<T extends HTMLElement>(
  root: React.RefObject<HTMLElement | null>,
  rootMargin = '400px 0px',
) {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root: root.current,
      rootMargin,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [root, rootMargin])

  return { ref, near }
}
