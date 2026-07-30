import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ImagePlus, Download, Loader2, AlertCircle, Sparkles, Check, Package, Users, Star, Tag } from 'lucide-react'
import type { Product } from '../../stores/types'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { useAppStore } from '../../stores/appStore'
import { extractProductInfo } from './services/extractProductInfo'
import { downloadImage } from '../../utils/downloadImage'
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_SIZE } from './services/imageValidation'
import { humanizeError } from '../../utils/friendlyError'
import SegmentedToggle from '../../components/SegmentedToggle'
import ExpandTextModal, { ExpandButton } from '../../components/ExpandableText'
import AutoGrowTextarea from '../../components/AutoGrowTextarea'

interface ProductFormProps {
  item?: Product | null
  onSave: (data: Omit<Product, 'id' | 'createdAt'>) => Promise<void> | void
  // Persists the form as it stands without closing it, and hands back the row
  // as stored (photos swapped for asset refs). See the autosave block below.
  onAutosave?: (data: Omit<Product, 'id' | 'createdAt'>) => Promise<Omit<Product, 'id' | 'createdAt'>>
  onCancel: () => void
  // Called when the user dismisses the form while extraction is still running.
  // The parent takes over: persists the partial form as a draft and lets the
  // extraction finish in the background.
  onCancelDuringExtraction?: (file: File, partial: Omit<Product, 'id' | 'createdAt'>, listingText?: string) => void
}

const FIELD_META: Record<string, { label: string; type: 'text' | 'textarea'; required?: boolean; hint?: string }> = {
  productName: { label: 'Product name', type: 'text', required: true },
  productDescription: { label: 'Description', type: 'textarea', required: true },
  targetMarket: { label: 'Target market', type: 'textarea' },
  painPoints: { label: 'Pain points', type: 'textarea' },
  objections: { label: 'Objections', type: 'textarea', hint: 'What stops them buying' },
  usps: { label: 'USPs', type: 'textarea' },
  benefits: { label: 'Benefits', type: 'textarea' },
  keySpecs: { label: 'Key specs & facts', type: 'textarea' },
  offer: { label: 'Offer', type: 'textarea' },
  cta: { label: 'CTA', type: 'text' },
}

// The fields grouped the way they're USED downstream, not the order they were
// added in: Scripts and B-Roll read the audience block to pick an angle and the
// selling block to back it up. Eleven identical boxes down one column had no
// hierarchy and no landmarks — four named stops give the column a shape, and
// the jump strip above it says out loud that there's more below.
type SectionKey = 'identity' | 'audience' | 'selling' | 'offer'

const SECTIONS: { key: SectionKey; label: string; icon: React.ElementType; fields: string[] }[] = [
  { key: 'identity', label: 'Identity', icon: Package, fields: ['productName', 'productDescription'] },
  { key: 'audience', label: 'Audience', icon: Users, fields: ['targetMarket', 'painPoints', 'objections'] },
  { key: 'selling', label: 'Selling', icon: Star, fields: ['usps', 'benefits', 'keySpecs'] },
  { key: 'offer', label: 'Offer', icon: Tag, fields: ['offer', 'cta'] },
]

const REQUIRED_KEYS = ['productName', 'productDescription'] as const

// Extra angles beyond the hero shot. Four is enough to cover closed/open/label/
// contents without turning the auto-fill call into a photo album.
const MAX_EXTRA_IMAGES = 4

// How long the form sits still before it writes. Long enough that typing a
// sentence is one save, short enough that clicking away can't outrun it (the
// close and unmount paths flush anyway).
const AUTOSAVE_DELAY = 700

// `extraImages` is optional on the stored row but always an array in the form,
// so every read of it here is unconditional.
type FormState = Omit<Product, 'id' | 'createdAt'> & { extraImages: string[] }

// What's actually persisted, so an edit that changes nothing doesn't write.
const signatureOf = (f: FormState) => JSON.stringify(f)

// Enough intent to be worth a row. Opening the form and closing it again must
// not litter the bank with empty products.
const worthSaving = (f: FormState) =>
  !!(f.productImage || f.productName.trim() || f.productDescription.trim())

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

// Fades the bottom edge of a scroll port while there's more below it, and stops
// fading at the end. A permanent fade is decoration; one that comes and goes is
// the only thing on screen telling you the column moves.
function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [more, setMore] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
    update()
    el.addEventListener('scroll', update, { passive: true })
    // The port itself resizes with the window; its content resizes as fields
    // grow — both change whether there's anything below the fold.
    const observer = new ResizeObserver(update)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [])

  return [ref, more] as const
}

export default function ProductForm({ item, onSave, onAutosave, onCancel, onCancelDuringExtraction }: ProductFormProps) {
  const [form, setForm] = useState<FormState>({
    productImage: item?.productImage ?? '',
    extraImages: item?.extraImages ?? [],
    productName: item?.productName ?? '',
    productDescription: item?.productDescription ?? '',
    targetMarket: item?.targetMarket ?? '',
    painPoints: item?.painPoints ?? '',
    usps: item?.usps ?? '',
    benefits: item?.benefits ?? '',
    keySpecs: item?.keySpecs ?? '',
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
  const [activeSection, setActiveSection] = useState<SectionKey>('identity')
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const resolvedAssetUrl = useAssetUrl(form.productImage)
  const displayImage = localPreview ?? resolvedAssetUrl
  const addToast = useAppStore((s) => s.addToast)

  const [fieldsRef, fieldsHaveMore] = useScrollFade<HTMLDivElement>()
  const [sideRef, sideHasMore] = useScrollFade<HTMLDivElement>()
  const sectionRefs = useRef<Partial<Record<SectionKey, HTMLDivElement | null>>>({})

  // Reload only when the form is pointed at a DIFFERENT product. Deliberately
  // keyed on the id and not the object: autosave rewrites the row on every
  // pass, and re-seeding from it would overwrite whatever was typed while that
  // save was in flight.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!item) return
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
      objections: item.objections ?? '',
      offer: item.offer,
      cta: item.cta,
    })
  }, [item?.id])
  /* eslint-enable react-hooks/exhaustive-deps */

  // --- Autosave ------------------------------------------------------------
  // The form writes itself. Dropping an extra angle and clicking away used to
  // throw the angle out; nothing here is lost by leaving. A product that
  // doesn't exist yet lands as an unconfirmed draft (orange dot in the bank)
  // and the Add button confirms it.
  const formRef = useRef(form)
  formRef.current = form
  // Signature of what's on disk. Seeded from the opening state so merely
  // opening a product doesn't rewrite it.
  const savedSigRef = useRef(signatureOf(form))
  const autosaveRef = useRef(onAutosave)
  autosaveRef.current = onAutosave
  const inFlightRef = useRef(false)
  // Set once the form has handed off (submitted, or closed mid-extraction) —
  // the unmount flush must not run then, or Add Product would write the row
  // twice: once confirmed, once as a fresh draft.
  const handedOffRef = useRef(false)

  const flushAutosave = useCallback(async () => {
    const save = autosaveRef.current
    const snapshot = formRef.current
    if (!save || handedOffRef.current || inFlightRef.current) return
    if (!worthSaving(snapshot)) return
    if (signatureOf(snapshot) === savedSigRef.current) return

    inFlightRef.current = true
    setAutosaveState('saving')
    try {
      const stored = await save(snapshot)
      // What's on disk is the snapshot with its photos swapped for asset refs.
      savedSigRef.current = signatureOf({
        ...snapshot,
        productImage: stored.productImage,
        extraImages: stored.extraImages ?? [],
      })
      // Adopt those refs so the next pass doesn't re-upload the same bytes —
      // but only where the form still holds the photo we just persisted.
      setForm((f) => ({
        ...f,
        productImage: f.productImage === snapshot.productImage ? stored.productImage : f.productImage,
        extraImages: (f.extraImages ?? []).map((src) => {
          const i = (snapshot.extraImages ?? []).indexOf(src)
          return i >= 0 ? (stored.extraImages ?? [])[i] ?? src : src
        }),
      }))
      setAutosaveState('saved')
      inFlightRef.current = false
      // Anything typed while that write was in the air gets its own pass —
      // otherwise the last edit before a close could be the one that's dropped.
      if (signatureOf(formRef.current) !== savedSigRef.current) void flushRef.current()
    } catch (err) {
      console.warn('[ProductForm] autosave failed', err)
      setAutosaveState('idle')
      inFlightRef.current = false
    }
  }, [])
  // Self-reference for the retry above (the callback can't name itself).
  const flushRef = useRef(flushAutosave)
  flushRef.current = flushAutosave

  // Deliberately keyed on the form alone — `onAutosave` is read through a ref,
  // so a parent that hands down a fresh function each render can't restart the
  // debounce out from under the typist.
  useEffect(() => {
    if (!worthSaving(form) || signatureOf(form) === savedSigRef.current) return
    const timer = setTimeout(() => { void flushAutosave() }, AUTOSAVE_DELAY)
    return () => clearTimeout(timer)
  }, [form, flushAutosave])

  // Leaving the bank, switching tabs, closing the form — whatever ends this
  // component, the pending edit goes with it.
  useEffect(() => () => { void flushAutosave() }, [flushAutosave])

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
      // The parent finishes the extraction in the background and writes it to
      // the same row this form has been autosaving into.
      handedOffRef.current = true
      onCancelDuringExtraction(extractingFileRef.current, form, listingText)
    } else {
      void flushAutosave()
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

  const filledIn = (fields: string[]) =>
    fields.filter((k) => (form[k as keyof FormState] as string)?.trim()).length

  const jumpTo = (key: SectionKey) => {
    setActiveSection(key)
    sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Keep the jump strip pointing at whatever's under the top of the column,
  // however it was reached.
  useEffect(() => {
    const root = fieldsRef.current
    if (!root) return
    const els = SECTIONS.map((s) => sectionRefs.current[s.key]).filter(Boolean) as HTMLElement[]
    if (els.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        const key = first?.target.getAttribute('data-section') as SectionKey | null
        if (key) setActiveSection(key)
      },
      { root, rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [fieldsRef])

  const renderField = (key: string) => {
    const { label, type, required, hint } = FIELD_META[key]
    const value = form[key as keyof FormState] as string
    const isMissing = showError && required && !value.toString().trim()
    const baseCls = 'w-full rounded-2xl border bg-ink/[0.02] px-4 py-3 text-[13px] text-ink-200 placeholder-ink-600 outline-none transition-colors'
    const borderCls = isMissing ? 'border-red-500/60 focus:border-red-400' : 'border-ink/10 focus:border-ink/20'
    return (
      <label key={key} className="flex flex-col gap-1.5">
        {/* Sentence case, quiet: uppercase belongs to the section headings now,
            so a label reads as a label and a heading reads as a heading. */}
        <span className="flex items-baseline gap-2">
          <span className={`text-[12px] font-medium ${isMissing ? 'text-red-400 light:text-red-600' : 'text-ink-300'}`}>
            {label}{required && <span className="text-ink-600"> *</span>}
          </span>
          {hint && <span className="truncate text-[11px] text-ink-600">{hint}</span>}
        </span>
        {type === 'textarea' ? (
          <div className="relative">
            {/* Grows to fit — an auto-filled product fills every one of these,
                and a column of boxes that each scroll internally is a column
                you can't scroll through. */}
            <AutoGrowTextarea
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
      jumpTo('identity')
      return
    }
    setShowError(false)
    setSaving(true)
    handedOffRef.current = true
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
      {/* Header — title, what the autosave is doing, and the way out. The
          primary action lives up here now: as a slab pinned across the field
          column it read as the bottom of the form, which is exactly why nobody
          could tell the column scrolled. */}
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h3 className="text-sm font-semibold tracking-tight text-ink-200">
            {item ? 'Edit product' : 'New product'}
          </h3>
          <span className="flex items-center gap-1.5 text-[11px] text-ink-500">
            {autosaveState === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" />Saving…</>}
            {autosaveState === 'saved' && <><Check className="h-3 w-3" />Saved</>}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="submit"
            disabled={saving || isExtracting}
            className="flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium tracking-tight text-ink-900 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {item ? 'Done' : 'Add product'}
          </button>
          <button
            type="button"
            onClick={handleClose}
            title="Close — everything is already saved"
            className="text-ink-500 transition-colors hover:text-ink-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Side-by-side: the photos on the left, every field down the right. */}
      <div className="flex flex-col gap-6 md:flex-row lg:min-h-0 lg:flex-1">
        {/* Left — the product photos + listing copy. Scrolls on its own so the
            paste box and the Auto-fill button stay reachable on a short window;
            the photo above them is what the right column is describing. */}
        <div
          ref={sideRef}
          className={`flex w-full shrink-0 flex-col gap-4 md:w-[300px] lg:min-h-0 lg:overflow-y-auto lg:pr-1 ${sideHasMore ? 'scroll-fade-b' : ''}`}
        >
          {displayImage ? (
            <div className="group/img relative aspect-square w-full shrink-0 overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.02]">
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
              className="group flex aspect-square w-full shrink-0 flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-ink/10 bg-ink/[0.02] px-3 text-center transition-colors hover:border-ink/20"
            >
              <ImagePlus className="h-6 w-6 text-ink-600 transition-colors group-hover:text-ink-400" />
              <span className="text-[10px] font-medium uppercase tracking-widest text-ink-600 transition-colors group-hover:text-ink-500">
                Drop to auto-fill
              </span>
            </button>
          )}

          {/* Auto-fill sits directly under the photo it reads. */}
          {displayImage && (
            <button
              type="button"
              onClick={rerunExtraction}
              disabled={isExtracting}
              className="flex shrink-0 items-center justify-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-[12px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 light:text-emerald-700"
            >
              {isExtracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {isExtracting
                ? 'Extracting…'
                : `Auto-fill from ${form.extraImages.length > 0 ? `${form.extraImages.length + 1} photos` : 'image'}${listingText.trim() ? ' + copy' : ''}`}
            </button>
          )}

          {/* More angles — extra shots of the same product (box open, what's
              inside, the label). They ride along in the auto-fill read and are
              individually attachable wherever a reference image is picked. */}
          <div className="flex shrink-0 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-medium text-ink-300">
                More angles <span className="text-ink-600">(optional)</span>
              </span>
              <span className="text-[11px] font-medium tabular-nums text-ink-600">
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
          <label className="flex shrink-0 flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-300">
              Listing copy <span className="text-ink-600">(optional)</span>
            </span>
            {/* Grows with the paste, but capped — a whole Amazon listing would
                otherwise push the photo and the Auto-fill button off the top of
                the column. Past the cap it scrolls, which is the one place in
                this form that's the right answer. */}
            <AutoGrowTextarea
              value={listingText}
              onChange={(e) => setListingText(e.target.value)}
              rows={5}
              maxHeight={280}
              placeholder="Paste the product page or Amazon listing text — auto-fill gets far more accurate with it."
              className="w-full resize-none rounded-2xl border border-ink/10 bg-ink/[0.02] px-4 py-3 text-[13px] leading-relaxed text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
            />
          </label>
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

        {/* Right — the fields, in four named stops. */}
        <div className={`flex min-w-0 flex-1 flex-col gap-3 transition-opacity lg:min-h-0 ${isExtracting ? 'pointer-events-none opacity-60' : ''}`}>
          {/* Jump strip. Opaque on purpose (the Ad Analyzer lesson): the column
              has no background of its own, so a translucent bar lets fields
              scroll visibly through it and the strip reads as unpinned. */}
          <div className="shrink-0">
            <SegmentedToggle<SectionKey>
              dense
              accent="products"
              value={activeSection}
              onChange={jumpTo}
              options={SECTIONS.map((s) => ({
                value: s.key,
                label: s.label,
                icon: s.icon,
                badge: `${filledIn(s.fields)}/${s.fields.length}`,
              }))}
            />
          </div>

          <div
            ref={fieldsRef}
            className={`min-h-0 flex-1 lg:overflow-y-auto lg:pr-1 ${fieldsHaveMore ? 'scroll-fade-b' : ''}`}
          >
            <div className="flex flex-col gap-7 pb-2">
              {SECTIONS.map((section) => (
                <div
                  key={section.key}
                  ref={(el) => { sectionRefs.current[section.key] = el }}
                  data-section={section.key}
                  className="flex scroll-mt-2 flex-col gap-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-500">
                      {section.label}
                    </span>
                    <span className="h-px flex-1 bg-ink/[0.07]" />
                  </div>
                  {section.fields.map(renderField)}
                </div>
              ))}

              {showError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300 light:text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>Fill in the product name and description to add this product.</span>
                </div>
              )}

              {extractError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300 light:text-red-700">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="break-words">{extractError}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {expandedField && (
        <ExpandTextModal
          open
          onClose={() => setExpandedField(null)}
          value={form[expandedField as keyof FormState] as string}
          onChange={(v) => set(expandedField, v)}
          title={FIELD_META[expandedField].label}
          accent="ink"
        />
      )}
    </form>
  )
}
