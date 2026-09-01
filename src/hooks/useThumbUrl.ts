// The picture a TILE draws — a thumbnail sized to the tile, never the still.
//
// `useAssetUrlState` for anything that shows the whole picture (a lightbox, a
// reference slot, a download); this for the <img> inside a grid tile, list row
// or bank card. Same contract as useAssetUrlState — pass null to hold off (the
// near-viewport gate), a data:/http: URL passes straight through, and `status`
// tells a spinner from a missing asset — plus one extra input: the element the
// picture will be drawn in. Its laid-out width, in device pixels, picks the
// thumbnail bucket (`utils/thumbStore.ts`), so a 200px column gets a 512px
// copy and a two-column landscape a 1024px one. The element is measured by a
// ResizeObserver from the moment the ref is asked for, and the bucket only
// ever GROWS: a wider window asks for the next size up and the tile keeps
// drawing the smaller copy until it lands, rather than dropping to a spinner
// over a picture it already had.
import { useEffect, useState, type RefObject } from 'react'
import { isAssetRef } from '../utils/assetStore'
import { bucketFor, getThumbUrl, type ThumbBucket } from '../utils/thumbStore'
import type { AssetUrlStatus } from './useAssetUrl'

interface Resolved {
  key: string
  url: string | undefined
  status: AssetUrlStatus
}

export function useThumbUrl(
  ref: string | undefined | null,
  measure: RefObject<HTMLElement | null>,
): { url: string | undefined; status: AssetUrlStatus } {
  const isAsset = !!ref && isAssetRef(ref)
  const [bucket, setBucket] = useState<ThumbBucket | null>(null)
  const [entry, setEntry] = useState<Resolved>()

  // Which size to ask for. Read off the element rather than passed in, so a
  // caller doesn't have to know how wide its column is on this screen. A
  // ResizeObserver rather than a window listener, for the same reason
  // AutoGrowTextarea uses one: an element inside a closed picker, a hidden
  // phone pane or a backgrounded app (`content-visibility: hidden`) measures
  // 0, and nothing but its own resize says when it has a width. Until then no
  // picture is asked for at all — a card in a picker that is mounted but shut
  // is not on screen, and a full decode for it is the cost this hook exists to
  // avoid. A caller with no element to measure gets the middle of the range.
  useEffect(() => {
    if (!isAsset) return
    const el = measure.current
    const grow = (next: ThumbBucket) => setBucket((prev) => (prev === null || next > prev ? next : prev))
    if (!el) { grow(bucketFor(0)); return }
    const pick = () => {
      const w = el.clientWidth
      if (w > 0) grow(bucketFor(w))
    }
    // Read once now — a laid-out tile gets its bucket this tick rather than
    // on the observer's first delivery, which waits for a rendering
    // opportunity the tab may not get for a while (a backgrounded tab).
    pick()
    if (typeof ResizeObserver === 'undefined') { grow(bucketFor(el.clientWidth || 0)); return }
    const ro = new ResizeObserver(pick)
    ro.observe(el)
    return () => ro.disconnect()
  }, [isAsset, measure])

  useEffect(() => {
    if (!isAsset || bucket === null) return
    let cancelled = false
    const key = `${ref}@${bucket}`
    getThumbUrl(ref!, bucket).then((resolved) => {
      if (cancelled) return
      if (!resolved) console.warn('[useThumbUrl] asset unresolvable', { assetId: ref })
      setEntry({ key, url: resolved ?? undefined, status: resolved ? 'ready' : 'failed' })
    })
    return () => { cancelled = true }
  }, [ref, isAsset, bucket])

  if (!ref) return { url: undefined, status: 'idle' }
  if (!isAsset) return { url: ref, status: 'ready' }
  if (entry && entry.key === `${ref}@${bucket}`) return { url: entry.url, status: entry.status }
  // A bigger bucket is on its way for the same picture: keep the one we have.
  if (entry && entry.url && entry.key.startsWith(`${ref}@`)) return { url: entry.url, status: 'ready' }
  return { url: undefined, status: 'loading' }
}
