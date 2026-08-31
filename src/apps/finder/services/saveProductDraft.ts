import type { Product } from '../../../stores/types'
import { useBankStore } from '../../../stores/bankStore'
import { saveFromDataUrl } from '../../../utils/assetStore'
import { fileToDataUri } from '../../../utils/kie'
import { extractProductInfo, type ProductExtraction } from './extractProductInfo'
import { humanizeError } from '../../../utils/friendlyError'

export interface DraftSaveOptions {
  file: File
  // Optional pasted product-page copy — forwarded to extraction as the
  // authoritative source for claims/specs/offer.
  listingText?: string
  initial?: Partial<Omit<Product, 'id' | 'createdAt'>>
  // Row to write into instead of creating one. The Product form autosaves, so
  // by the time it's dismissed mid-extraction the product usually already
  // exists — adding another would leave the member with two of it.
  existingId?: string
  onStart?: (productId: string) => void
  // `reason` is the friendly sentence when the read failed — a one-file drop is
  // worth reporting properly, and a bare "1 failed" is what sent members off
  // guessing at the photo when the answer was on their key or their balance.
  onFinish?: (productId: string, ok: boolean, reason?: string) => void
}

export interface DraftSaveResult {
  id: string
  ok: boolean
  reason?: string
}

function placeholderNameFor(file: File, initial?: Partial<Product>): string {
  const fromInitial = initial?.productName?.trim()
  if (fromInitial) return fromInitial
  const fromFile = file.name.replace(/\.[^.]+$/, '').trim()
  return fromFile || 'Untitled product'
}

export async function saveProductDraft(opts: DraftSaveOptions): Promise<DraftSaveResult> {
  const { file, listingText, initial, existingId, onStart, onFinish } = opts

  const dataUrl = await fileToDataUri(file)
  const assetRef = await saveFromDataUrl(dataUrl)

  // Extra angles carried over from an abandoned form are still data URIs —
  // persist them as assets so the bank row never holds a blob in localStorage.
  const extraImages = await Promise.all(
    (initial?.extraImages ?? []).map((src) => (src.startsWith('data:') ? saveFromDataUrl(src) : Promise.resolve(src))),
  )

  const placeholderName = placeholderNameFor(file, initial)
  const store = useBankStore.getState()

  let id: string
  if (existingId) {
    // Leave `confirmed` alone — the row may be a product the member already
    // saved, and dropping a new photo on it doesn't demote it to a draft.
    await store.updateProduct(existingId, { ...initial, productImage: assetRef, extraImages }, { silent: true })
    id = existingId
  } else {
    id = await store.addProduct({
      productName: placeholderName,
      productDescription: '',
      targetMarket: '',
      painPoints: '',
      usps: '',
      benefits: '',
      offer: '',
      cta: '',
      ...initial,
      // Override anything in `initial` so the row always points to persisted assets.
      productImage: assetRef,
      extraImages,
      confirmed: false,
    }, { silent: true })
  }

  onStart?.(id)

  try {
    const extracted = await extractProductInfo(file, listingText, extraImages)
    // Silent: this runs in the background, sometimes many at a time from a bulk
    // add — `onFinish` is what reports the outcome, once.
    await store.updateProduct(id, {
      ...extracted,
      productName: extracted.productName?.trim() || placeholderName,
    }, { silent: true })
    onFinish?.(id, true)
    return { id, ok: true }
  } catch (err) {
    console.warn('[saveProductDraft] extraction failed', err)
    const reason = humanizeError(err, "Couldn't read that product photo. Open the draft and try Auto-fill again.")
    onFinish?.(id, false, reason)
    return { id, ok: false, reason }
  }
}


export interface AdoptExtractionOptions {
  // The read that is ALREADY running, handed over by a form on its way out.
  job: Promise<ProductExtraction>
  // The row to write into, resolved once the form has flushed what it owed.
  rowId: Promise<string | null>
  onStart?: (productId: string) => void
  onFinish?: (productId: string | null, ok: boolean, message: string) => void
}

/**
 * Finish a read the Product form started, after that form has gone.
 *
 * The point is that it is the SAME call: the form hands over the promise, not
 * the file, so leaving the bank tab (or closing the form) costs nothing and
 * bills nothing. The older version of this restarted extraction from the file
 * and charged the member twice for one photo.
 *
 * Module scope on purpose — a `try`/`finally` inside a component makes the
 * React Compiler skip that component entirely (see the Tech Stack note in the
 * root CLAUDE.md), and this needs one to keep the in-flight marker honest.
 */
export async function adoptDetachedExtraction(opts: AdoptExtractionOptions): Promise<void> {
  const { job, rowId, onStart, onFinish } = opts
  // Both are already running; waiting on the row first only costs the tick the
  // form's own flush needs.
  const id = await rowId.catch(() => null)
  if (id) onStart?.(id)
  try {
    const extracted = await job
    if (!id) {
      // Nothing to write into — the form was dismissed before it had saved
      // anything at all. Nothing was lost that the member can see.
      onFinish?.(null, false, 'That product was closed before it was saved.')
      return
    }
    // `updateProduct` merges with a spread, so a `productName: undefined` in the
    // patch would BLANK a row the member had already named. Leave the key out.
    const patch: Partial<Product> = { ...extracted }
    if (!patch.productName?.trim()) delete patch.productName
    await useBankStore.getState().updateProduct(id, patch, { silent: true })
    onFinish?.(id, true, 'Product details filled in')
  } catch (err) {
    console.warn('[adoptDetachedExtraction] extraction failed', err)
    onFinish?.(id, false, humanizeError(err, "Couldn't read that product photo. Open the product and try Auto-fill again."))
  }
}
