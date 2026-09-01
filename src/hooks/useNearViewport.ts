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
//
// `once` is the half of that rule that only applies to CLIPS. Releasing is
// about the decoder, and a still doesn't hold one: the blob read and the object
// URL are both permanently cached the moment a picture resolves, so dropping a
// still's <img> on the way past buys nothing and costs the member a black tile
// on the way back — which is exactly how it was reported (Playground, September
// 2026). A tile that opts into `once` stops observing the moment it has been
// near, so its picture is read on approach exactly as before and then simply
// stays. Clips keep the releasing behaviour, and hold their first frame instead
// — see `hooks/useVideoPoster.ts`.
import { useEffect, useRef, useState } from 'react'

export default function useNearViewport<T extends HTMLElement>(
  root: React.RefObject<HTMLElement | null>,
  rootMargin = '400px 0px',
  { once = false }: { once?: boolean } = {},
) {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      setNear(entry.isIntersecting)
      if (once && entry.isIntersecting) io.disconnect()
    }, {
      root: root.current,
      rootMargin,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [root, rootMargin, once])

  return { ref, near }
}
