import type { Product } from '../../../stores/types'
import { useBankStore } from '../../../stores/bankStore'
import { saveFromDataUrl } from '../../../utils/assetStore'
import { fileToDataUri } from '../../../utils/kie'
import { extractProductInfo } from './extractProductInfo'

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
  onFinish?: (productId: string, ok: boolean) => void
}

export interface DraftSaveResult {
  id: string
  ok: boolean
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
    onFinish?.(id, false)
    return { id, ok: false }
  }
}
