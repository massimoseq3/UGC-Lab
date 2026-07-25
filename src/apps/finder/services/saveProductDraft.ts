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
  const { file, listingText, initial, onStart, onFinish } = opts

  const dataUrl = await fileToDataUri(file)
  const assetRef = await saveFromDataUrl(dataUrl)

  // Extra angles carried over from an abandoned form are still data URIs —
  // persist them as assets so the bank row never holds a blob in localStorage.
  const extraImages = await Promise.all(
    (initial?.extraImages ?? []).map((src) => (src.startsWith('data:') ? saveFromDataUrl(src) : Promise.resolve(src))),
  )

  const placeholderName = placeholderNameFor(file, initial)
  const store = useBankStore.getState()

  const id = await store.addProduct({
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
  })

  onStart?.(id)

  try {
    const extracted = await extractProductInfo(file, listingText, extraImages)
    await store.updateProduct(id, {
      ...extracted,
      productName: extracted.productName?.trim() || placeholderName,
    })
    onFinish?.(id, true)
    return { id, ok: true }
  } catch (err) {
    console.warn('[saveProductDraft] extraction failed', err)
    onFinish?.(id, false)
    return { id, ok: false }
  }
}
