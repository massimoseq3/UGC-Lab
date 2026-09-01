// "Is this tile close enough to be worth loading?" — for long media lists.
//
// A history bank is uncapped, so a working member's gallery is hundreds of
// rows: hundreds of blob reads out of IndexedDB (or pulls back down off R2 when
// they aren't cached locally) and hundreds of full-size pictures handed to the
// browser to decode, with about nine on screen. `loading="lazy"` does not help
// — it defers a FETCH, and by the time the <img> exists the read, the object
// URL and the decode have all already happened. So a tile claims its media as
// it comes NEAR the window instead, which keeps the cost proportional to the
// window rather than to the history.
//
// Pass the SCROLLER as the root: ancestor clipping is applied before
// `rootMargin`, so an observer left on the viewport would only ever fire once a
// tile was already on screen — the margin buys nothing and the media pops in
// under the pointer.
//
// ── Loading is not the same question as releasing ──────────────────────────
//
// By default a tile that has been near KEEPS what it loaded: the observer
// disconnects on the first hit and `near` stays true for good. Releasing has to
// be asked for, because it is only ever right for CLIPS.
//
// A still holds no decoder, and `assetStore`'s `urlCache` keeps its object URL
// (and the blob behind it) for the life of the tab either way — so dropping a
// picture on the way past frees nothing but a decoded bitmap the browser
// already manages, and it costs the member a grid that will not sit still.
// Both surfaces size a loaded tile to the picture's own height and the
// placeholder to a DECLARED aspect ratio, so a tile that releases changes
// height; the release fires ~400px BEHIND the scroll position, i.e. above the
// viewport, where a height change drags everything under the pointer. Scrolling
// down and back up in Characters' and Playground's grids made the whole column
// walk about (reported September 2026). The load in the other direction is
// free by comparison: it lands 400px AHEAD, below the viewport, where nothing
// above it moves.
//
// `release: true` is for a <video>, where the scarce thing is real: each
// element holds a whole clip in memory and takes one of the browser's decoders,
// of which there are far fewer than a working member has clips — past the
// budget the extra elements never paint at all, so the grid sits black while
// the tab stalls on the reads. A releasing tile must hold its own dimensions
// (a fixed aspect on the frame, so nothing moves) and leave a picture behind
// rather than a hole — see `hooks/useVideoPoster.ts`.
import { useEffect, useRef, useState } from 'react'

export default function useNearViewport<T extends HTMLElement>(
  root: React.RefObject<HTMLElement | null>,
  rootMargin = '400px 0px',
  { release = false }: { release?: boolean } = {},
) {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      setNear(entry.isIntersecting)
      // Loaded once and keeping it: stop watching, so nothing can take it back.
      if (!release && entry.isIntersecting) io.disconnect()
    }, {
      root: root.current,
      rootMargin,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [root, rootMargin, release])

  return { ref, near }
}
