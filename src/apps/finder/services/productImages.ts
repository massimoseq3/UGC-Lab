import { saveFromDataUrl } from '../../../utils/assetStore'
import type { Product } from '../../../stores/types'

// One photo's trip from data URI to stored asset, remembered by the exact bytes
// it came in as. The product form autosaves, and it adopts the asset ref a save
// hands back through React state — so a debounce that fires in the window
// before that adoption commits offers us the SAME data URI a second time.
// Persisting it twice minted a second asset, which `updateProduct` then read as
// a replaced photo and purged the first for; the form's pending adoption put
// the first ref back on the row, so the second was purged in its turn — and the
// row was left pointing at a blob that no longer existed. That is the
// placeholder card, and it took every angle on the product with it.
//
// The map is per open form (a fresh one each time the form is opened) and holds
// the in-flight PROMISE, not the resolved ref, so a submit racing an autosave
// over the same photo waits on the one save instead of starting a second.
// Keying by the data URI costs nothing — JS strings are shared, so this is
// another reference to bytes the form is already holding.
export type ImageMemo = Map<string, Promise<string>>

export const newImageMemo = (): ImageMemo => new Map()

function persistImage(src: string, memo: ImageMemo): Promise<string> {
  if (!src.startsWith('data:')) return Promise.resolve(src)
  const inFlight = memo.get(src)
  if (inFlight) return inFlight
  const pending = saveFromDataUrl(src)
  memo.set(src, pending)
  // A failed save must not be remembered, or the retry would hand back the
  // same rejection for as long as the form stays open.
  pending.catch(() => { if (memo.get(src) === pending) memo.delete(src) })
  return pending
}

// Photos arrive from the Product form as data URIs on first add; already-saved
// ones come back as asset:// refs and pass through untouched.
//
// It lives here rather than in `Finder.tsx` because the product form is mounted
// in two places now — the Bank's own pane, and the Scripts panel's Edit Product
// Details modal — and both have to persist a dropped photo the same way.
export async function persistProductImages(data: Omit<Product, 'id' | 'createdAt'>, memo: ImageMemo) {
  const saved: Omit<Product, 'id' | 'createdAt'> = { ...data }
  if (saved.productImage) {
    saved.productImage = await persistImage(saved.productImage, memo)
  }
  if (saved.extraImages?.length) {
    saved.extraImages = await Promise.all(saved.extraImages.map((src) => persistImage(src, memo)))
  }
  return saved
}
