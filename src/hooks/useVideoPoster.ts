// A clip that has been scrolled past keeps its own first frame.
//
// `useNearViewport` releases a <video> once its tile is well clear of the
// window, because a decoder is the scarce resource in a grid of sixty clips.
// The cost of that, reported from Playground's history (September 2026), lands
// on the way BACK: the element is rebuilt from nothing, and until the browser
// has fetched the blob and decoded frame one it paints nothing at all — a black
// tile that then visibly "reloads", every time you scroll back up. Safari makes
// it worse, since with `preload="metadata"` it decodes no frame on its own (the
// reason the list row's src carries `#t=0.1`).
//
// So the tile grabs a frame into a small JPEG the first time the clip decodes
// one and keeps it: it stands in for the released <video>, and rides on the
// element as its `poster` so a remount paints the picture immediately rather
// than a hole. The decoder is still handed back — only a few tens of KB of
// still stays behind, and only for clips the member actually scrolled past.
import { useCallback, useRef, useState } from 'react'

// Wide enough for a grid tile or a list row's media column at any slider
// position; a poster is a placeholder for a frame you are about to get back,
// not the frame itself.
const POSTER_WIDTH = 480

// `loadeddata` says a frame EXISTS, not that the browser will hand it to a
// canvas: measured in a backgrounded tab, `drawImage` at that point returns
// flat black for a clip whose first frame is nothing of the sort. A flat
// poster is worse than none — it is indistinguishable from the bug this exists
// to fix — so each attempt probes what it drew and only keeps a frame with
// something in it, retrying on the later events until one lands.
const MAX_ATTEMPTS = 5

export function useVideoPoster() {
  const [poster, setPoster] = useState<string>()
  // Refs, not state: several of these events can fire in one tick, and none of
  // them should re-render the tile just to say "still nothing to keep".
  const captured = useRef(false)
  const attempts = useRef(0)

  const capture = useCallback((el: HTMLVideoElement | null) => {
    if (captured.current || attempts.current >= MAX_ATTEMPTS) return
    if (!el?.videoWidth || !el.videoHeight) return
    attempts.current += 1
    try {
      // Probe at 8×8 first — cheap enough to run on a `timeupdate`, and enough
      // to tell a real frame from a flat fill.
      const probe = document.createElement('canvas')
      probe.width = 8
      probe.height = 8
      const pctx = probe.getContext('2d', { willReadFrequently: true })
      if (!pctx) return
      pctx.drawImage(el, 0, 0, 8, 8)
      const px = pctx.getImageData(0, 0, 8, 8).data
      let flat = true
      for (let i = 4; i < px.length; i += 4) {
        if (px[i] !== px[0] || px[i + 1] !== px[1] || px[i + 2] !== px[2]) { flat = false; break }
      }
      if (flat) return

      const scale = Math.min(1, POSTER_WIDTH / el.videoWidth)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(el.videoWidth * scale)
      canvas.height = Math.round(el.videoHeight * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
      // Blob URLs are same-origin, so the canvas is never tainted — but a
      // browser that refuses the read must not take the tile down with it.
      captured.current = true
      setPoster(canvas.toDataURL('image/jpeg', 0.72))
    } catch {
      // No poster on this browser; the tile falls back to its glyph placeholder.
      captured.current = true
    }
  }, [])

  return {
    poster,
    /** Spread on the <video> — every point at which a frame may be readable. */
    posterProps: {
      onLoadedData: (e: React.SyntheticEvent<HTMLVideoElement>) => capture(e.currentTarget),
      // The reliable one: a SEEKED frame is readable where a merely loaded one
      // often isn't, which is why every clip surface here asks for `#t=0.1`.
      onSeeked: (e: React.SyntheticEvent<HTMLVideoElement>) => capture(e.currentTarget),
      onCanPlay: (e: React.SyntheticEvent<HTMLVideoElement>) => capture(e.currentTarget),
      onTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => capture(e.currentTarget),
    },
  }
}
