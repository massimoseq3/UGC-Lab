import { useState } from 'react'
import Modal from '../../components/Modal'
import ProductForm, { ProductFormFooter } from './ProductForm'
import { useAppStore } from '../../stores/appStore'
import { useBankStore } from '../../stores/bankStore'
import type { Product } from '../../stores/types'
import { persistProductImages, newImageMemo, type ImageMemo } from './services/productImages'
import { adoptDetachedExtraction } from './services/saveProductDraft'
import type { ProductExtraction } from './services/extractProductInfo'

// The footer's button lives outside the <form>, so it submits by id.
const FORM_ID = 'product-edit-modal-form'

interface ProductEditModalProps {
  // The bank row being edited. `null` is the closed state — the form is mounted
  // only while open, so closing unmounts it and its own exit flush runs.
  product: Product | null
  onClose: () => void
}

// The Bank's product form, opened from wherever a product is PICKED — today the
// Scripts panel's Edit Product Details row.
//
// It mounts the real `ProductForm`, not a copy of its fields. A second
// fourteen-field form was there first and it was the wrong shape twice over: it
// had no photo column and no Auto-fill, so half of what a product is couldn't
// be edited from here at all, and two hand-kept field lists drift the moment
// one of them gains a field. What the Bank's pane does with a NEW product —
// the unconfirmed draft, the row-claiming promise — has no equivalent here:
// this form always opens on a row that already exists, so the id is known
// before the first keystroke and the autosave writes straight into it.
export default function ProductEditModal({ product, onClose }: ProductEditModalProps) {
  const updateProduct = useBankStore((s) => s.updateProduct)
  const addToast = useAppStore((s) => s.addToast)
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const productId = product?.id ?? null

  // Photos this open form has already persisted (see services/productImages),
  // paired with the row they belong to. A fresh map per product, so one form's
  // data URIs can't be handed back for another's — and held in state rather
  // than a ref because it is swapped during render, alongside the key that
  // remounts the form: an autosave pass started after the swap must never
  // still be reading the outgoing map.
  const [memo, setMemo] = useState<{ id: string | null; images: ImageMemo }>(
    () => ({ id: productId, images: newImageMemo() }),
  )
  if (memo.id !== productId) {
    setMemo({ id: productId, images: newImageMemo() })
    setAutosaveState('idle')
  }

  const handleAutosave = async (data: Omit<Product, 'id' | 'createdAt'>) => {
    // Captured before the first await: a pass still in the air when the member
    // switches product has to finish writing into the row it started in.
    const id = productId
    const images = memo.images
    const saved = await persistProductImages(data, images)
    if (id) await updateProduct(id, saved, { silent: true })
    // The id goes back with the row — the form hands it to a read it detaches
    // on the way out, so the result lands on this product and no other.
    return { ...saved, id: id ?? '' }
  }

  const handleSave = async (data: Omit<Product, 'id' | 'createdAt'>) => {
    const id = productId
    const saved = await persistProductImages(data, memo.images)
    if (id) await updateProduct(id, saved)
    onClose()
  }

  // A photo dropped just before Done: the running read is handed over rather
  // than dying with the modal, and its result is written onto the row. Same
  // deal the Bank's pane gives a form closed mid-extraction — it costs nothing
  // and bills nothing, because the call is adopted, never restarted.
  const handleDetachExtraction = (job: Promise<ProductExtraction>, rowId: Promise<string | null>) => {
    void adoptDetachedExtraction({
      job,
      rowId,
      onFinish: (_id, ok, message) => addToast(message, ok ? 'success' : 'error'),
    })
  }

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title="Edit Product Details"
      // The Bank's own pane gives this form up to 1024px and it wants every
      // pixel: a 300px photo column, then fourteen fields under a four-stop
      // jump strip. At `wide` the field column lands narrower than the page
      // this is meant to BE.
      size="gallery"
      // The form owns its own scrolling columns, so the panel has to be a fixed
      // height for them to have one to fill. Below `lg` it stacks and the
      // modal's body scrolls it, exactly as the Bank's pane does.
      fill
      // The same bar the Bank's own pane puts under this form, so the two are
      // one shape rather than two that look alike.
      footer={<ProductFormFooter autosaveState={autosaveState} isNew={false} formId={FORM_ID} />}
    >
      {/* `pb-2`, not the `p-5` the rest of the inset uses: the footer's own
          hairline is right below, and 20px of empty panel above it read as a gap
          the form had stopped filling. Matches the Bank pane's bar. */}
      {product && (
        <div className="flex flex-col p-5 pb-2 lg:h-full">
          <ProductForm
            // Keyed on the row, so opening a different product never keeps the
            // last one's fields — they are local state inside the form.
            key={product.id}
            item={product}
            embedded
            formId={FORM_ID}
            onAutosaveStateChange={setAutosaveState}
            onSave={handleSave}
            onAutosave={handleAutosave}
            onCancel={onClose}
            onDetachExtraction={handleDetachExtraction}
          />
        </div>
      )}
    </Modal>
  )
}
