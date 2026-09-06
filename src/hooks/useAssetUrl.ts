import { useState, useEffect, type SyntheticEvent } from 'react'
import { isAssetRef, getUrl, peekUrl } from '../utils/assetStore'
import { capturePoster, getPosterUrl, getStillThumbUrl, isThumbMissing, peekThumbUrl } from '../utils/mediaThumbs'

/**
 * Resolves an asset reference to a renderable URL.
 * - If ref is an asset ID ("asset-xxx"), loads from IndexedDB and returns an object URL.
 * - If ref is a data URL, blob URL, or http URL, returns it as-is.
 * - Returns undefined while loading or if ref is empty.
 *
 * The synchronous (pass-through / empty) cases are derived during render so we
 * never call setState inside the effect for them. The async result is stored
 * tagged with the ref it resolved, so a stale load for a previous ref is
 * ignored by the render-time comparison instead of needing a reset setState.
 */
export function useAssetUrl(ref: string | undefined | null): string | undefined {
  const [entry, setEntry] = useState<{ ref: string; url: string | undefined }>()
  const isAsset = !!ref && isAssetRef(ref)
  // Already resolved in this tab: hand it over on the first render, no effect.
  const peeked = isAsset ? peekUrl(ref) : undefined

  useEffect(() => {
    if (!isAsset || peeked) return
    let cancelled = false
    getUrl(ref!).then((resolved) => {
      if (!cancelled) setEntry({ ref: ref!, url: resolved ?? undefined })
    })
    return () => { cancelled = true }
  }, [ref, isAsset, peeked])

  if (!ref) return undefined
  if (!isAsset) return ref // data:, blob:, http: — pass through
  if (peeked) return peeked
  return entry && entry.ref === ref ? entry.url : undefined
}

export type AssetUrlStatus = 'idle' | 'loading' | 'ready' | 'failed'

/**
 * Like {@link useAssetUrl}, but returns a status flag so callers can distinguish
 * "still loading from R2" from "asset not found". Logs a console warning on
 * failure with the asset id and cloud-active state.
 *
 * A ref this tab has already resolved is answered synchronously: a video tile
 * that releases its clip off screen and takes it back on the way up used to
 * spend a frame in `loading` for a promise that had settled long ago, which
 * read as a spinner flashing over every clip on the way back up a grid.
 */
export function useAssetUrlState(ref: string | undefined | null): { url: string | undefined; status: AssetUrlStatus } {
  const [entry, setEntry] = useState<{ ref: string; url: string | undefined; status: AssetUrlStatus }>()
  const isAsset = !!ref && isAssetRef(ref)
  const peeked = isAsset ? peekUrl(ref) : undefined

  useEffect(() => {
    if (!isAsset || peeked) return
    let cancelled = false
    getUrl(ref!).then((resolved) => {
      if (cancelled) return
      if (resolved) {
        setEntry({ ref: ref!, url: resolved, status: 'ready' })
      } else {
        console.warn('[useAssetUrlState] asset unresolvable', { assetId: ref })
        setEntry({ ref: ref!, url: undefined, status: 'failed' })
      }
    })
    return () => { cancelled = true }
  }, [ref, isAsset, peeked])

  if (!ref) return { url: undefined, status: 'idle' }
  if (!isAsset) return { url: ref, status: 'ready' }
  if (peeked) return { url: peeked, status: 'ready' }
  return entry && entry.ref === ref ? { url: entry.url, status: entry.status } : { url: undefined, status: 'loading' }
}

/**
 * The GRID-SIZED copy of a still (`utils/mediaThumbs`): a 1024px-edge JPEG
 * made once per asset per browser, falling back to the original only when the
 * original is already that small. This is what a tile in a history grid or a
 * list row renders; anything that reads the file — download, lightbox, a
 * generation input — keeps going through `getUrl` for the original.
 *
 * Same contract as {@link useAssetUrlState}: gate the ref on `near` and the
 * thumbnail isn't read until the tile approaches the window.
 */
export function useAssetThumb(ref: string | undefined | null): { url: string | undefined; status: AssetUrlStatus } {
  const [entry, setEntry] = useState<{ ref: string; url: string | undefined; status: AssetUrlStatus }>()
  const isAsset = !!ref && isAssetRef(ref)
  // The thumbnail if it's resolved; else, once this tab knows there is no
  // thumbnail for this asset, the original — both synchronous.
  const peeked = isAsset ? (peekThumbUrl(ref) ?? (isThumbMissing(ref) ? peekUrl(ref) : undefined)) : undefined

  useEffect(() => {
    if (!isAsset || peeked) return
    let cancelled = false
    getStillThumbUrl(ref!)
      .then((thumb) => thumb ?? getUrl(ref!))
      .then((resolved) => {
        if (cancelled) return
        if (resolved) {
          setEntry({ ref: ref!, url: resolved, status: 'ready' })
        } else {
          console.warn('[useAssetThumb] asset unresolvable', { assetId: ref })
          setEntry({ ref: ref!, url: undefined, status: 'failed' })
        }
      })
    return () => { cancelled = true }
  }, [ref, isAsset, peeked])

  if (!ref) return { url: undefined, status: 'idle' }
  if (!isAsset) return { url: ref, status: 'ready' }
  if (peeked) return { url: peeked, status: 'ready' }
  return entry && entry.ref === ref ? { url: entry.url, status: entry.status } : { url: undefined, status: 'loading' }
}

/**
 * A clip's POSTER frame (`utils/mediaThumbs`): the picture a grid tile IS at
 * rest, the `poster` its `<video preload="none">` wears, and what the tile
 * keeps showing after it has released the clip itself. Resolved from the
 * thumbs store, or made off the clip through mediaThumbs' poster queue the
 * first time this browser asks. `capture` is a bonus path — wire it to the
 * <video>'s `onLoadedData` and a clip that gets played before its queued
 * poster lands hands its frame over on the spot.
 *
 * `status` is what a tile renders while `url` is empty: `loading` means one is
 * on its way (show the busy face), `missing` means this clip could not be
 * decoded here and no poster will come (the tile lets the element try a frame
 * of its own instead).
 *
 * Gate the ref on the tile having been SEEN, never on `near`: the poster is
 * small and holds no decoder, so it is exactly the thing that should survive
 * the release.
 */
export type PosterStatus = 'idle' | 'loading' | 'ready' | 'missing'

export function useAssetPoster(ref: string | undefined | null): {
  url: string | undefined
  status: PosterStatus
  capture: (video: HTMLVideoElement) => void
} {
  const [entry, setEntry] = useState<{ ref: string; url: string | undefined }>()
  const isAsset = !!ref && isAssetRef(ref)
  const peeked = isAsset ? peekThumbUrl(ref) : undefined
  const knownMissing = isAsset && !peeked && isThumbMissing(ref)

  useEffect(() => {
    if (!isAsset || peeked || knownMissing) return
    let cancelled = false
    getPosterUrl(ref!).then((resolved) => {
      if (!cancelled) setEntry({ ref: ref!, url: resolved ?? undefined })
    })
    return () => { cancelled = true }
  }, [ref, isAsset, peeked, knownMissing])

  const capture = (video: HTMLVideoElement) => {
    if (!isAsset || peeked) return
    const target = ref!
    void capturePoster(target, video).then((url) => {
      if (url) setEntry({ ref: target, url })
    })
  }

  if (!isAsset) return { url: undefined, status: 'idle', capture }
  if (peeked) return { url: peeked, status: 'ready', capture }
  if (entry && entry.ref === ref) return { url: entry.url, status: entry.url ? 'ready' : 'missing', capture }
  return { url: undefined, status: knownMissing ? 'missing' : 'loading', capture }
}

export type PosterState = ReturnType<typeof useAssetPoster>

/**
 * The attributes every clip tile's `<video>` takes, spread after its player
 * props: `preload="none"` wearing the poster, so a wall of clips holds NO
 * decoder until one is hovered or played (Safari parks every decoder past a
 * handful, and a parked element never paints — see docs/performance.md). A
 * clip no poster will ever come for (`'missing'`) is asked for a frame of its
 * own instead: `metadata` plus a `#t=0.1` fragment, the one combination that
 * makes Safari decode and paint a frame without playing.
 */
export function posterVideoProps(url: string, poster: PosterState): {
  src: string
  poster: string | undefined
  preload: 'none' | 'metadata'
  onLoadedData: (e: SyntheticEvent<HTMLVideoElement>) => void
} {
  const posterless = poster.status === 'missing'
  return {
    src: posterless ? `${url}#t=0.1` : url,
    poster: poster.url,
    preload: posterless ? 'metadata' : 'none',
    onLoadedData: (e) => poster.capture(e.currentTarget),
  }
}

/**
 * True while the clip is mounted but its poster is still on its way: a
 * `preload="none"` element paints nothing until it's played, so the tile shows
 * its busy face OVER the element until the picture lands.
 */
export function posterPending(poster: PosterState): boolean {
  return !poster.url && poster.status === 'loading'
}
