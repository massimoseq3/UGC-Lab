import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ImagePlus, Download, AlertCircle, Sparkle, Check, Package, Users, Star, Tag } from 'lucide-react'
import Spinner from '../../components/Spinner'
import type { Product } from '../../stores/types'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { useAppStore } from '../../stores/appStore'
import { extractProductInfo, type ProductExtraction } from './services/extractProductInfo'
import { downloadImage } from '../../utils/downloadImage'
import { imageRejectionReason, partitionImageFiles, IMAGE_ACCEPT_ATTR } from './services/imageValidation'
import { humanizeError } from '../../utils/friendlyError'
import { fileToDataUri } from '../../utils/kie'
import DropOverlay from '../../components/DropOverlay'
import SegmentedToggle from '../../components/SegmentedToggle'
import ExpandTextModal, { ExpandButton, BracketGrowArea, BracketInput } from '../../components/ExpandableText'
import AutoGrowTextarea from '../../components/AutoGrowTextarea'
import SectionCard, { SectionLabel } from '../../components/SectionCard'
import { suspendChromeAutoHide } from '../../hooks/useChromeAutoHide'

interface ProductFormProps {
  item?: Product | null
  onSave: (data: Omit<Product, 'id' | 'createdAt'>) => Promise<void> | void
  // Persists the form as it stands without closing it, and hands back the row
  // as stored (photos swapped for asset refs) plus the id it was written into.
  // See the autosave block below.
  onAutosave?: (data: Omit<Product, 'id' | 'createdAt'>) => Promise<Omit<Product, 'id' | 'createdAt'> & { id: string }>
  onCancel: () => void
  // Called when the form goes away while a read is still running — dismissed,
  // or unmounted by a bank switch. The RUNNING call is handed over, not the
  // file: the parent writes its result into `rowId` when it lands. Starting a
  // second extraction here would bill the member twice for one photo, which is
  // what the file-based version of this prop used to do.
  onDetachExtraction?: (job: Promise<ProductExtraction>, rowId: Promise<string | null>) => void
}

const FIELD_META: Record<string, { label: string; type: 'text' | 'textarea'; required?: boolean; hint?: string }> = {
  productName: { label: 'Product name', type: 'text', required: true },
  productDescription: { label: 'Description', type: 'textarea' },
  uniqueMechanism: { label: 'Unique mechanism', type: 'textarea', hint: 'Why it works' },
  targetMarket: { label: 'Target market', type: 'textarea' },
  painPoints: { label: 'Pain points', type: 'textarea' },
  currentAlternatives: { label: 'Current alternatives', type: 'textarea', hint: 'What they do instead' },
  objections: { label: 'Objections', type: 'textarea', hint: 'What stops them buying' },
  notFor: { label: 'Not for', type: 'textarea', hint: 'Who should skip it' },
  usps: { label: 'USPs', type: 'textarea' },
  benefits: { label: 'Benefits', type: 'textarea' },
  proof: { label: 'Proof', type: 'textarea', hint: 'And how strong it is' },
  beforeAfter: { label: 'Before / after', type: 'textarea', hint: 'Their day, then with it' },
  offer: { label: 'Offer', type: 'textarea' },
  cta: { label: 'CTA', type: 'text' },
}

// The fields grouped the way they're USED downstream, not the order they were
// added in: Scripts and B-Roll read the audience block to pick an angle and the
// selling block to back it up. Fourteen identical boxes down one column would
// have no hierarchy and no landmarks — four named stops give it a shape, and
// the jump strip above says out loud that there's more below.
type SectionKey = 'identity' | 'audience' | 'selling' | 'offer'

const SECTIONS: { key: SectionKey; label: string; icon: React.ElementType; fields: string[] }[] = [
  { key: 'identity', label: 'Identity', icon: Package, fields: ['productName', 'productDescription', 'uniqueMechanism'] },
  { key: 'audience', label: 'Audience', icon: Users, fields: ['targetMarket', 'painPoints', 'currentAlternatives', 'objections', 'notFor'] },
  { key: 'selling', label: 'Selling', icon: Star, fields: ['usps', 'benefits', 'proof', 'beforeAfter'] },
  { key: 'offer', label: 'Offer', icon: Tag, fields: ['offer', 'cta'] },
]

// A name is what makes the row pickable in a BankPicker, so it stays required.
// The description deliberately doesn't: a member who only wants this product's
// photos as reference images (Photo only, below) has no copy to put in it, and
// gating Add on a write-up they didn't ask for was the whole complaint.
const REQUIRED_KEYS = ['productName'] as const

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

export default function ProductForm({ item, onSave, onAutosave, onCancel, onDetachExtraction }: ProductFormProps) {
  const [form, setForm] = useState<FormState>({
    productImage: item?.productImage ?? '',
    extraImages: item?.extraImages ?? [],
    productName: item?.productName ?? '',
    productDescription: item?.productDescription ?? '',
    uniqueMechanism: item?.uniqueMechanism ?? '',
    targetMarket: item?.targetMarket ?? '',
    painPoints: item?.painPoints ?? '',
    currentAlternatives: item?.currentAlternatives ?? '',
    objections: item?.objections ?? '',
    notFor: item?.notFor ?? '',
    usps: item?.usps ?? '',
    benefits: item?.benefits ?? '',
    proof: item?.proof ?? '',
    beforeAfter: item?.beforeAfter ?? '',
    offer: item?.offer ?? '',
    cta: item?.cta ?? '',
  })
  const [listingText, setListingText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const extraFileRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  // The read that is currently in the air, so it can be handed to the parent
  // instead of dying when this form unmounts.
  const extractionRef = useRef<Promise<ProductExtraction> | null>(null)
  const detachedRef = useRef(false)
  // False between the unmount and a StrictMode remount — an async step that
  // resolves in that window must not write to a form that no longer exists.
  const aliveRef = useRef(true)
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
      uniqueMechanism: item.uniqueMechanism ?? '',
      targetMarket: item.targetMarket,
      painPoints: item.painPoints,
      currentAlternatives: item.currentAlternatives ?? '',
      objections: item.objections ?? '',
      notFor: item.notFor ?? '',
      usps: item.usps,
      benefits: item.benefits,
      proof: item.proof ?? '',
      beforeAfter: item.beforeAfter ?? '',
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
  const detachRef = useRef(onDetachExtraction)
  detachRef.current = onDetachExtraction
  // Set below, once `releaseForm` exists — the unmount effect reads it, and
  // everything that WRITES a ref has to sit above the hook that captured it.
  const detachOnExitRef = useRef<() => void>(() => {})
  const inFlightRef = useRef(false)
  // The row this form's work lands in, held as a PROMISE rather than an id: a
  // detach that happens while a save is still in the air has to be able to wait
  // for it, and polling a ref until it fills in is the version of this that
  // reads like a bug.
  const rowIdRef = useRef<Promise<string | null>>(Promise.resolve(item?.id ?? null))
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
    const pending = save(snapshot)
    // Claim the row before the first await, so a detach arriving mid-save waits
    // on this one instead of finding nothing. A failed save keeps whatever row
    // the form was already pointed at.
    const previousRowId = rowIdRef.current
    rowIdRef.current = pending.then((s) => s.id, () => previousRowId)
    try {
      const stored = await pending
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

  // Everything the form still owes the bank, written — then the id of the row
  // it went into. What a detached extraction is handed, so it can never land on
  // a product that doesn't exist yet.
  const flushToRowId = useCallback(async (): Promise<string | null> => {
    await flushAutosave()
    return rowIdRef.current
  }, [flushAutosave])

  // Deliberately keyed on the form alone — `onAutosave` is read through a ref,
  // so a parent that hands down a fresh function each render can't restart the
  // debounce out from under the typist.
  useEffect(() => {
    if (!worthSaving(form) || signatureOf(form) === savedSigRef.current) return
    const timer = setTimeout(() => { void flushAutosave() }, AUTOSAVE_DELAY)
    return () => clearTimeout(timer)
  }, [form, flushAutosave])

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (showError && (REQUIRED_KEYS as readonly string[]).includes(key) && value.trim()) {
      // Recompute whether all required fields are now filled.
      const next = { ...form, [key]: value }
      const stillMissing = REQUIRED_KEYS.some((k) => !next[k].trim())
      if (!stillMissing) setShowError(false)
    }
  }

  // The one gate every way of adding a photo goes through — the tile, the file
  // picker, a drop, an extra angle. It TOASTS rather than writing to
  // `extractError`, which renders at the bottom of the field column below four
  // section cards: off screen on any normal window, so a rejected AVIF looked
  // exactly like nothing happening.
  const rejectFile = (file: File): boolean => {
    const reason = imageRejectionReason(file)
    if (!reason) return false
    addToast(reason, 'error')
    return true
  }

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    // `accept` is a filter, not a guarantee — every OS file dialog has a way
    // past it, and a picked file is validated exactly like a dropped one.
    if (!file || rejectFile(file)) return
    void runExtraction(file)
  }

  // Extra angles are read straight to data URIs and held on the form; the save
  // path persists them to IndexedDB the same way the hero shot is persisted.
  const addExtraImages = (files: FileList | null) => {
    if (!files) return
    const { accepted: valid, rejection } = partitionImageFiles(Array.from(files))
    if (rejection) addToast(rejection, 'error')
    const room = MAX_EXTRA_IMAGES - form.extraImages.length
    const accepted = valid.slice(0, room)
    if (valid.length > room) {
      addToast(
        room === 0
          ? `More Angles is full. ${MAX_EXTRA_IMAGES} is the limit.`
          : `Only ${MAX_EXTRA_IMAGES} extra angles fit. Kept the first ${room}.`,
        'info',
      )
    }
    for (const file of accepted) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setForm((f) => (
          f.extraImages.length >= MAX_EXTRA_IMAGES ? f : { ...f, extraImages: [...f.extraImages, dataUrl] }
        ))
      }
      // A read that fails silently leaves an angle the member watched
      // themselves add simply not there.
      reader.onerror = () => addToast(`Couldn't read ${file.name}.`, 'error')
      reader.readAsDataURL(file)
    }
  }

  const removeExtraImage = (index: number) => {
    setForm((f) => ({ ...f, extraImages: f.extraImages.filter((_, i) => i !== index) }))
  }

  // Fire the read and keep hold of it. The promise is stored SYNCHRONOUSLY, so
  // a close arriving in the next tick has something to hand over.
  const startExtraction = (source: File | string, extras: string[], listing: string) => {
    setExtractError(null)
    setIsExtracting(true)
    detachedRef.current = false
    const job = extractProductInfo(source, listing, extras)
    extractionRef.current = job
    job.then(
      (result) => {
        if (detachedRef.current) return
        setForm((f) => ({ ...f, ...result }))
        setShowError(false)
      },
      (err) => {
        // Toast the real reason. The inline `extractError` below renders at the
        // bottom of a scrolling column under four section cards — off screen on
        // any normal window — so a two-word "Extraction failed" toast was the
        // whole of what a member ever saw, whether the photo was refused, the
        // key was out of credits, or the answer came back unreadable.
        if (detachedRef.current) return
        const message = humanizeError(
          err,
          "Couldn't read that product photo. Try Auto-fill again, or paste the listing copy to help it along.",
        )
        setExtractError(message)
        addToast(message, 'error')
      },
    ).finally(() => {
      if (extractionRef.current === job) extractionRef.current = null
      setIsExtracting(false)
    })
  }

  // A dropped or picked file. The photo is encoded and put on the form BEFORE
  // the read starts, so there is never a window where a read is running against
  // a product with no picture to save it into.
  const runExtraction = (file: File) => {
    setExtractError(null)
    setIsExtracting(true)
    fileToDataUri(file).then(
      (dataUri) => {
        if (!aliveRef.current) return
        setForm((f) => ({ ...f, productImage: dataUri }))
        setLocalPreview(dataUri)
        startExtraction(dataUri, formRef.current.extraImages, listingText)
      },
      () => {
        addToast(`Couldn't read ${file.name}.`, 'error')
        setIsExtracting(false)
      },
    )
  }

  // Re-run extraction on the image already in the form (e.g. after pasting
  // listing copy). Editing an existing product means there's no File — the
  // stored image resolves to a blob/data URL, which the service re-encodes.
  const rerunExtraction = () => {
    if (!displayImage || isExtracting) return
    startExtraction(displayImage, form.extraImages, listingText)
  }

  // Flush what's unsaved, and hand any running read to the parent along with
  // the row it should be written into. Called from the X and from the unmount,
  // so a bank switch behaves exactly like a close.
  const releaseForm = () => {
    const job = extractionRef.current
    const detach = detachRef.current
    if (!job || detachedRef.current || !detach) {
      void flushAutosave()
      return
    }
    detachedRef.current = true
    detach(job, flushToRowId())
  }
  detachOnExitRef.current = releaseForm

  // Leaving the bank, switching tabs, closing the form — whatever ends this
  // component, the pending edit goes with it, and a read still in the air is
  // handed to the parent rather than dying on the unmount. That handoff is the
  // whole of "drop a photo, go somewhere else, come back to a filled-in
  // product": the call outlives the form because the form stops owning it.
  //
  // Read through a ref (declared above) and mounted with no deps, or the
  // cleanup would fire on every render instead of on the way out.
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      detachOnExitRef.current()
    }
  }, [])


  const handleClose = () => {
    releaseForm()
    onCancel()
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
    if (!file || rejectFile(file)) return
    void runExtraction(file)
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
    suspendChromeAutoHide()
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
    // The border and fill move to the WRAPPER, because the field itself has to
    // be transparent for the red placeholder wash behind it to show through —
    // which is also why `focus:` becomes `focus-within:` here.
    const chromeCls = `w-full border bg-ink/[0.02] transition-colors ${
      isMissing ? 'border-red-500/60 focus-within:border-red-400' : 'border-ink/10 focus-within:border-ink/20'
    }`
    // Both layers take the same padding and metrics, or they wrap on different
    // characters and every wash slides off its word further down the paragraph.
    const padClass = 'px-4 py-3'
    const textClass = 'text-[13px] leading-relaxed'
    const inkClass = 'text-ink-200 placeholder-ink-600'
    return (
      <label key={key} className="flex flex-col gap-1.5">
        {/* The in-card small-caps register. It was quiet 12px sentence case
            under a quiet 9px uppercase section eyebrow, where only the
            letter-spacing told a heading from a label; the section is a titled
            card now, so the label can step down to this without competing.
            A dot only where it can ever be red — `productName` is the one
            required field, and a neutral dot on each of the thirteen optional
            ones would be decoration (the card header's filled count answers
            "what's left" at the right scale). */}
        <SectionLabel
          label={label}
          filled={required ? !!value.toString().trim() : undefined}
          required={required}
          right={hint ? <span className="truncate text-[11px] text-ink-600">{hint}</span> : undefined}
        />
        {type === 'textarea' ? (
          <div className="relative">
            {/* Grows to fit — an auto-filled product fills every one of these,
                and a column of boxes that each scroll internally is a column
                you can't scroll through. The read leaves a [bracketed
                placeholder] wherever it had no fact to state, deliberately, so
                every one of them is painted red: that is the list of what the
                member still has to write in, and without the wash it is ten
                paragraphs of prose with the gaps hidden inside them. */}
            <BracketGrowArea
              value={value}
              onChange={(e) => set(key, e.target.value)}
              rows={3}
              className={`${chromeCls} rounded-2xl`}
              padClass={padClass}
              textClass={textClass}
              textareaClass={`min-h-[84px] ${inkClass}`}
            />
            <ExpandButton onClick={() => setExpandedField(key)} className="absolute bottom-2 right-2" />
          </div>
        ) : (
          <BracketInput
            value={value}
            onChange={(e) => set(key, e.target.value)}
            className={`${chromeCls} rounded-full`}
            padClass={padClass}
            textClass={textClass}
            inputClass={inkClass}
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
      {overlayActive && <DropOverlay icon={Sparkle} label="Drop image to Auto-fill Product Info" accent="emerald" />}
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
            {autosaveState === 'saving' && <><Spinner className="h-3 w-3" />Saving…</>}
            {autosaveState === 'saved' && <><Check className="h-3 w-3" />Saved</>}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="submit"
            disabled={saving || isExtracting}
            className="flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium tracking-tight text-ink-900 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Spinner className="h-3.5 w-3.5" />}
            {item ? 'Done' : 'Add product'}
          </button>
          <button
            type="button"
            onClick={handleClose}
            title="Close · everything is already saved"
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
            <div className="group/img relative aspect-[3/2] w-full shrink-0 overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.02] md:aspect-square">
              <img src={displayImage} alt="" className="h-full w-full object-cover" />
              {isExtracting && (
                <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1 text-[10px] font-medium text-emerald-200 backdrop-blur-sm">
                  <Spinner className="h-3 w-3" />
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
              className="group flex aspect-[3/2] w-full shrink-0 flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-ink/10 bg-ink/[0.02] px-3 text-center transition-colors hover:border-ink/20 md:aspect-square"
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
              {isExtracting ? <Spinner className="h-3.5 w-3.5" /> : <Sparkle className="h-3.5 w-3.5" />}
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
              placeholder="Paste the product page or Amazon listing text. Auto-fill gets far more accurate with it."
              className="w-full resize-none rounded-2xl border border-ink/10 bg-ink/[0.02] px-4 py-3 text-[13px] leading-relaxed text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
            />
          </label>
        </div>
        <input ref={fileRef} type="file" accept={IMAGE_ACCEPT_ATTR} className="hidden" onChange={handleImage} />
        <input
          ref={extraFileRef}
          type="file"
          multiple
          accept={IMAGE_ACCEPT_ATTR}
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

          {/* The scroll port is INSET from the cards it holds, by the width of
              their drop shadow. `overflow-y-auto` computes to `auto` on the
              other axis too, so a card flush against this box had its shadow
              sliced off down both sides and along the bottom — the shadow is
              0/8px offset on a 24px blur, so it needs ~20px of room. The
              negative margins hand that room back out of the pane's own `p-5`
              and the 24px gap beside the photo column, which keeps every card
              at exactly the width and position it had. */}
          <div
            ref={fieldsRef}
            className={`min-h-0 flex-1 lg:-mx-5 lg:-mt-3 lg:overflow-y-auto lg:px-5 lg:pt-3 ${fieldsHaveMore ? 'scroll-fade-b' : ''}`}
          >
            <div className="flex flex-col gap-3 pb-8">
              {/* One SectionCard per section. This was a left-aligned small-caps
                  eyebrow with a hairline running off to the right — the exact
                  shape SectionCard was written to replace, and one that reads as
                  a divider BETWEEN blocks rather than a container around one.
                  The four glyphs have been declared in SECTIONS all along and
                  nothing rendered them; the card header is where they go, and
                  it's also where the filled count belongs — beside the fields
                  it's counting, not only up in the jump strip. */}
              {SECTIONS.map((section) => (
                <div
                  key={section.key}
                  ref={(el) => { sectionRefs.current[section.key] = el }}
                  data-section={section.key}
                  className="scroll-mt-2"
                >
                  <SectionCard
                    icon={section.icon}
                    title={section.label}
                    contentClassName="flex flex-col gap-4"
                    right={(
                      <span className="rounded-full bg-ink/[0.03] px-2 py-0.5 text-[10px] tabular-nums text-ink-500">
                        {filledIn(section.fields)}/{section.fields.length}
                      </span>
                    )}
                  >
                    {section.fields.map(renderField)}
                  </SectionCard>
                </div>
              ))}

              {showError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300 light:text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>Give this product a name to add it.</span>
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
          // The gaps have to stay marked in the big editor too — it's where a
          // member actually fills them in.
          highlightBrackets
        />
      )}
    </form>
  )
}
