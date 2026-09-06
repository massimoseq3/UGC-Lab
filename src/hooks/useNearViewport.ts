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
// already manages, and it costs the member a grid that will not sit still. A
// LOADED still tile is sized by the picture (`h-auto w-full`); a RELEASED one
// is sized by the DECLARED aspect ratio, and those are not the same number
// whenever a provider returns one of its own supported sizes rather than
// exactly what was asked for. The release fires ~400px BEHIND the scroll
// position — above the viewport — so those tiles change height off screen
// behind you and drag the whole grid under the pointer. Scrolling back up in
// Characters' and Playground's grids "goes crazy" (reported twice, September
// 2026 — once against Playground, and again against Characters after a revert
// took this default away). The load in the other direction is free by
// comparison: it lands 400px AHEAD, below the viewport, where nothing above it
// moves.
//
// `release: true` is for a <video>, where the scarce thing is real: a clip
// that has been played holds its buffered data and one of the browser's
// decoders, of which there are far fewer than a working member has clips —
// past the budget the extra elements never paint at all. (At REST a grid
// <video> is `preload="none"` wearing its poster and holds neither — see
// utils/mediaThumbs — so releasing is the valve for the ones that got
// hovered, not the thing keeping the count down.) A releasing tile must hold
// its own dimensions, which every caller does by putting a fixed aspect on the
// FRAME rather than letting the media size it, so nothing moves when it comes
// and goes.
//
// `seen` is the sticky half of `near`: true from the first approach and never
// false again, whatever `release` does afterwards. It's for what a releasing
// tile keeps — a clip's poster frame, which is small, holds no decoder, and is
// precisely the thing that should still be on the tile once the <video> is gone.
import { useEffect, useRef, useState } from 'react'

export default function useNearViewport<T extends HTMLElement>(
  root: React.RefObject<HTMLElement | null>,
  rootMargin = '400px 0px',
  { release = false }: { release?: boolean } = {},
) {
  const ref = useRef<T | null>(null)
  const [near, setNear] = useState(false)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => {
      setNear(entry.isIntersecting)
      if (entry.isIntersecting) setSeen(true)
      // Loaded once and keeping it: stop watching, so nothing can take it back.
      if (!release && entry.isIntersecting) io.disconnect()
    }, {
      root: root.current,
      rootMargin,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [root, rootMargin, release])

  return { ref, near, seen }
}
