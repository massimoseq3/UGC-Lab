import { useState, useEffect, useRef } from 'react'
import { X, ImagePlus, Download, Loader2, AlertCircle, Sparkles } from 'lucide-react'
import type { Product } from '../../stores/types'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { useAppStore } from '../../stores/appStore'
import { extractProductInfo } from './services/extractProductInfo'
import { downloadImage } from '../../utils/downloadImage'
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_SIZE } from './services/imageValidation'
import { humanizeError } from '../../utils/friendlyError'
import ExpandTextModal, { ExpandButton } from '../../components/ExpandableText'

interface ProductFormProps {
  item?: Product | null
  onSave: (data: Omit<Product, 'id' | 'createdAt'>) => Promise<void> | void
  onCancel: () => void
  // Called when the user dismisses the form while extraction is still running.
  // The parent takes over: persists the partial form as a draft and lets the
  // extraction finish in the background.
  onCancelDuringExtraction?: (file: File, partial: Omit<Product, 'id' | 'createdAt'>, listingText?: string) => void
}

const FIELD_META: Record<string, { label: string; type: 'text' | 'textarea'; required?: boolean }> = {
  productName: { label: 'Product Name', type: 'text', required: true },
  productDescription: { label: 'Description', type: 'textarea', required: true },
  targetMarket: { label: 'Target Market', type: 'textarea' },
  painPoints: { label: 'Pain Points', type: 'textarea' },
  usps: { label: 'USPs', type: 'textarea' },
  benefits: { label: 'Benefits', type: 'textarea' },
  keySpecs: { label: 'Key Specs & Facts', type: 'textarea' },
  customerLanguage: { label: 'Customer Language', type: 'textarea' },
  objections: { label: 'Objections', type: 'textarea' },
  offer: { label: 'Offer', type: 'textarea' },
  cta: { label: 'CTA', type: 'text' },
}

// The image sits alone on the left; every text field stacks down the right
// column (which scrolls).
const FIELDS = ['productName', 'productDescription', 'targetMarket', 'painPoints', 'usps', 'benefits', 'keySpecs', 'customerLanguage', 'objections', 'offer', 'cta'] as const

const REQUIRED_KEYS = ['productName', 'productDescription'] as const

// Extra angles beyond the hero shot. Four is enough to cover closed/open/label/
// contents without turning the auto-fill call into a photo album.
const MAX_EXTRA_IMAGES = 4

// One extra-angle thumbnail. Its own component so `useAssetUrl` can resolve
// each stored `asset://` ref (a hook can't run inside a .map callback).
function ExtraImageThumb({ src, onRemove }: { src: string; onRemove: () => void }) {
  const resolved = useAssetUrl(src)
  return (
    <div className="group/extra relative aspect-square overflow-hidden rounded-xl border border-ink/10 bg-ink/[0.02]">
      {resolved && <img src={resolved} alt="" className="h-full w-full object-cover" />}
      <button
        type="button"
        onClick={onRemove}
        title="Remove this angle"
        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 group-hover/extra:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

export default function ProductForm({ item, onSave, onCancel, onCancelDuringExtraction }: ProductFormProps) {
  const [form, setForm] = useState({
    productImage: item?.productImage ?? '',
    extraImages: item?.extraImages ?? [],
    productName: item?.productName ?? '',
    productDescription: item?.productDescription ?? '',
    targetMarket: item?.targetMarket ?? '',
    painPoints: item?.painPoints ?? '',
    usps: item?.usps ?? '',
    benefits: item?.benefits ?? '',
    keySpecs: item?.keySpecs ?? '',
    customerLanguage: item?.customerLanguage ?? '',
    objections: item?.objections ?? '',
    offer: item?.offer ?? '',
    cta: item?.cta ?? '',
  })
  const [listingText, setListingText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const extraFileRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const extractingFileRef = useRef<File | null>(null)
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showError, setShowError] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [overlayActive, setOverlayActive] = useState(false)
  const [expandedField, setExpandedField] = useState<string | null>(null)
  const resolvedAssetUrl = useAssetUrl(form.productImage)
  const displayImage = localPreview ?? resolvedAssetUrl
  const addToast = useAppStore((s) => s.addToast)

  useEffect(() => {
    if (item) {
      setForm({
        productImage: item.productImage,
        extraImages: item.extraImages ?? [],
        productName: item.productName,
        productDescription: item.productDescription,
        targetMarket: item.targetMarket,
        painPoints: item.painPoints,
        usps: item.usps,
        benefits: item.benefits,
        keySpecs: item.keySpecs ?? '',
        customerLanguage: item.customerLanguage ?? '',
        objections: item.objections ?? '',
        offer: item.offer,
        cta: item.cta,
      })
    }
  }, [item])

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (showError && (REQUIRED_KEYS as readonly string[]).includes(key) && value.trim()) {
      // Recompute whether all required fields are now filled.
      const next = { ...form, [key]: value }
      const stillMissing = REQUIRED_KEYS.some((k) => !next[k].trim())
      if (!stillMissing) setShowError(false)
    }
  }

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      set('productImage', dataUrl)
      setLocalPreview(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  // Extra angles are read straight to data URIs and held on the form; the save
  // path persists them to IndexedDB the same way the hero shot is persisted.
  const addExtraImages = (files: FileList | null) => {
    if (!files) return
    const room = MAX_EXTRA_IMAGES - form.extraImages.length
    const accepted: File[] = []
    let rejected = false
    for (const file of Array.from(files)) {
      if (!ACCEPTED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE) { rejected = true; continue }
      if (accepted.length < room) accepted.push(file)
    }
    if (rejected) setExtractError('Skipped a file — use JPG, PNG, or WebP under 10 MB.')
    for (const file of accepted) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setForm((f) => (
          f.extraImages.length >= MAX_EXTRA_IMAGES ? f : { ...f, extraImages: [...f.extraImages, dataUrl] }
        ))
      }
      reader.readAsDataURL(file)
    }
  }

  const removeExtraImage = (index: number) => {
    setForm((f) => ({ ...f, extraImages: f.extraImages.filter((_, i) => i !== index) }))
  }

  const runExtraction = async (file: File) => {
    setExtractError(null)
    setIsExtracting(true)
    extractingFileRef.current = file
    const extras = form.extraImages

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setForm((f) => ({ ...f, productImage: reader.result as string }))
        setLocalPreview(reader.result as string)
      }
    }
    reader.readAsDataURL(file)

    try {
      const result = await extractProductInfo(file, listingText, extras)
      setForm((f) => ({ ...f, ...result }))
      setShowError(false)
    } catch (err) {
      const message = humanizeError(err, 'Failed to extract product info from image.')
      setExtractError(message)
      addToast('Extraction failed', 'error')
    } finally {
      extractingFileRef.current = null
      setIsExtracting(false)
    }
  }

  // Re-run extraction on the image already in the form (e.g. after pasting
  // listing copy). Editing an existing product means there's no File — the
  // stored image resolves to a blob/data URL, which we re-encode.
  const rerunExtraction = async () => {
    if (!displayImage || isExtracting) return
    setExtractError(null)
    setIsExtracting(true)
    try {
      // `displayImage` is a data: or blob: URL — the service resolves either.
      const result = await extractProductInfo(displayImage, listingText, form.extraImages)
      setForm((f) => ({ ...f, ...result }))
      setShowError(false)
    } catch (err) {
      const message = humanizeError(err, 'Failed to extract product info from image.')
      setExtractError(message)
      addToast('Extraction failed', 'error')
    } finally {
      setIsExtracting(false)
    }
  }

  const handleClose = () => {
    if (isExtracting && extractingFileRef.current && onCancelDuringExtraction) {
      onCancelDuringExtraction(extractingFileRef.current, form, listingText)
    } else {
      onCancel()
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    dragDepthRef.current += 1
    setOverlayActive(true)
  }
  const handleDragLeave = () => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setOverlayActive(false)
  }
  const handleDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current = 0
    setOverlayActive(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setExtractError('Unsupported format. Use JPG, PNG, or WebP.')
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setExtractError('File too large. Maximum size is 10 MB.')
      return
    }
    runExtraction(file)
  }

  const handleDownload = () => {
    if (!displayImage) return
    downloadImage(displayImage, `product-${form.productName || item?.id?.slice(0, 8) || 'image'}`)
  }

  const missingRequired = REQUIRED_KEYS.filter((k) => !form[k].trim())

  const renderField = (key: string) => {
    const { label, type, required } = FIELD_META[key]
    const value = form[key as keyof typeof form] as string
    const isMissing = showError && required && !value.toString().trim()
    const baseCls = 'w-full rounded-2xl border bg-ink/[0.02] px-4 py-3 text-[13px] text-ink-200 placeholder-ink-600 outline-none transition-colors'
    const borderCls = isMissing ? 'border-red-500/60 focus:border-red-400' : 'border-ink/10 focus:border-ink/20'
    return (
      <label key={key} className="flex flex-col gap-1.5">
        <span className={`text-[11px] font-medium uppercase tracking-widest ${isMissing ? 'text-red-400 light:text-red-600' : 'text-ink-400'}`}>
          {label}{required && ' *'}
        </span>
        {type === 'textarea' ? (
          <div className="relative">
            <textarea
              value={value}
              onChange={(e) => set(key, e.target.value)}
              rows={3}
              className={`${baseCls} ${borderCls} min-h-[84px] resize-none leading-relaxed`}
            />
            <ExpandButton onClick={() => setExpandedField(key)} className="absolute bottom-2 right-2" />
          </div>
        ) : (
          <input
            value={value}
            onChange={(e) => set(key, e.target.value)}
            className={`${baseCls} ${borderCls} rounded-full`}
          />
        )}
      </label>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (missingRequired.length > 0) {
      setShowError(true)
      return
    }
    setShowError(false)
    setSaving(true)
    try {
      await onSave(form)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative flex flex-col gap-4 lg:min-h-0 lg:flex-1"
    >
      {overlayActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-emerald-400/60 bg-emerald-500/10 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium text-emerald-200">
            <Sparkles className="h-4 w-4" />
            Drop image to auto-fill product info
          </div>
        </div>
      )}
      {/* Header — stays fixed above the scrolling fields */}
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight text-ink-200">
          {item ? 'Edit Product' : 'New Product'}
        </h3>
        <button type="button" onClick={handleClose} className="text-ink-500 hover:text-ink-300 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Side-by-side: image alone on the left, every field scrolls down the right. */}
      <div className="flex flex-col gap-6 md:flex-row lg:min-h-0 lg:flex-1">
        {/* Left — the product photos + listing copy. Deliberately does NOT
            scroll: it stays put while the field column on the right moves, so
            the image you're describing is always in view. */}
        <div className="flex w-full shrink-0 flex-col gap-4 md:w-[300px] lg:min-h-0">
          {displayImage ? (
            <div className="group/img relative aspect-square w-full overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.02]">
              <img src={displayImage} alt="" className="h-full w-full object-cover" />
              {isExtracting && (
                <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1 text-[10px] font-medium text-emerald-200 backdrop-blur-sm">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Extracting…
                </div>
              )}
              <button
                type="button"
                onClick={handleDownload}
                className="absolute right-2 top-2 z-10 rounded-full border border-white/20 bg-black/35 p-2 text-white opacity-0 backdrop-blur transition-all hover:bg-black/50 group-hover/img:opacity-100"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute left-2 top-2 z-10 rounded-full bg-black/60 px-3 py-1.5 text-[10px] font-medium text-zinc-300 opacity-0 backdrop-blur-sm transition-all hover:bg-black/80 group-hover/img:opacity-100"
              >
                Change image
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="group flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-ink/10 bg-ink/[0.02] px-3 text-center transition-colors hover:border-ink/20"
            >
              <ImagePlus className="h-6 w-6 text-ink-600 transition-colors group-hover:text-ink-400" />
              <span className="text-[10px] font-medium uppercase tracking-widest text-ink-600 transition-colors group-hover:text-ink-500">
                Drop to auto-fill
              </span>
            </button>
          )}

          {/* More angles — extra shots of the same product (box open, what's
              inside, the label). They ride along in the auto-fill read and are
              individually attachable wherever a reference image is picked. */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-widest text-ink-400">
                More Angles <span className="normal-case tracking-normal text-ink-600">(optional)</span>
              </span>
              <span className="text-[10px] font-medium tabular-nums text-ink-600">
                {form.extraImages.length}/{MAX_EXTRA_IMAGES}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {form.extraImages.map((src, i) => (
                <ExtraImageThumb key={`${src.slice(0, 32)}-${i}`} src={src} onRemove={() => removeExtraImage(i)} />
              ))}
              {form.extraImages.length < MAX_EXTRA_IMAGES && (
                <button
                  type="button"
                  onClick={() => extraFileRef.current?.click()}
                  title="Add another shot of this product"
                  className="group flex aspect-square items-center justify-center rounded-xl border border-dashed border-ink/10 bg-ink/[0.02] transition-colors hover:border-ink/20"
                >
                  <ImagePlus className="h-4 w-4 text-ink-600 transition-colors group-hover:text-ink-400" />
                </button>
              )}
            </div>
          </div>

          {/* Listing copy — optional paste box that feeds auto-fill. Text from
              the product page carries the claims/specs/offer a photo can't. */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-widest text-ink-400">
              Listing Copy <span className="normal-case tracking-normal text-ink-600">(optional)</span>
            </span>
            <textarea
              value={listingText}
              onChange={(e) => setListingText(e.target.value)}
              rows={5}
              placeholder="Paste the product page or Amazon listing text — auto-fill gets far more accurate with it."
              className="w-full resize-none rounded-2xl border border-ink/10 bg-ink/[0.02] px-4 py-3 text-[13px] leading-relaxed text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
            />
          </label>
          {displayImage && (
            <button
              type="button"
              onClick={rerunExtraction}
              disabled={isExtracting}
              className="flex items-center justify-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-[12px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 light:text-emerald-700"
            >
              {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {isExtracting
                ? 'Extracting…'
                : `Auto-fill from ${form.extraImages.length > 0 ? `${form.extraImages.length + 1} photos` : 'image'}${listingText.trim() ? ' + copy' : ''}`}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" className="hidden" onChange={handleImage} />
        <input
          ref={extraFileRef}
          type="file"
          multiple
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => { addExtraImages(e.target.files); e.target.value = '' }}
        />

        {/* Right — every field + save (the only part that scrolls) */}
        <div className={`flex min-w-0 flex-1 flex-col gap-3 transition-opacity lg:min-h-0 lg:overflow-y-auto lg:pr-1 ${isExtracting ? 'pointer-events-none opacity-60' : ''}`}>
          <div className="flex flex-col gap-4">
            {FIELDS.map(renderField)}
          </div>

          {/* Sticky save footer — pinned to the bottom of the scrolling field
              column so Save is always visible without scrolling to find it. */}
          <div className="sticky bottom-0 z-10 -mx-1 mt-2 flex flex-col gap-2 border-t border-ink/10 bg-surface-0/90 px-1 pb-1 pt-3 backdrop-blur-sm">
            {showError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300 light:text-red-700">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>Please fill in the required fields first.</span>
              </div>
            )}

            {extractError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300 light:text-red-700">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="break-words">{extractError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={saving || isExtracting}
              className="flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Saving…' : (item ? 'Save Changes' : 'Add Product')}
            </button>
          </div>
        </div>
      </div>

      {expandedField && (
        <ExpandTextModal
          open
          onClose={() => setExpandedField(null)}
          value={form[expandedField as keyof typeof form] as string}
          onChange={(v) => set(expandedField, v)}
          title={FIELD_META[expandedField].label}
          accent="ink"
        />
      )}
    </form>
  )
}
