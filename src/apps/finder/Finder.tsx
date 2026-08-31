import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Package, UserRound, FileText, Mic, Film, Upload, LayoutGrid, Palette, Bookmark } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useBankStore } from '../../stores/bankStore'
import type { BankType } from '../../utils/constants'
import { BANK_CONFIG } from '../../utils/constants'
import type { Product, Model, Script, VoicePreset, BRoll, StylePreset } from '../../stores/types'
import { saveFromDataUrl } from '../../utils/assetStore'
import BankList, { SortControl } from './BankList'
import SegmentedToggle from '../../components/SegmentedToggle'
import { useBankSort } from './bankSort'
import ProductForm from './ProductForm'
import ModelForm from './ModelForm'
import ScriptForm from './ScriptForm'
import VoiceForm from './VoiceForm'
import BRollForm from './BRollForm'
import StyleForm from './StyleForm'
import { partitionImageFiles } from './services/imageValidation'
import { saveProductDraft, adoptDetachedExtraction } from './services/saveProductDraft'
import type { ProductExtraction } from './services/extractProductInfo'

const SIDEBAR_ICONS: Record<BankType, React.ElementType> = {
  products: Package,
  models: UserRound,
  scripts: FileText,
  voices: Mic,
  brolls: Film,
  styles: Palette,
  swipes: Bookmark,
}

const BANK_TYPES: BankType[] = ['products', 'models', 'scripts', 'voices', 'brolls', 'styles', 'swipes']

// One photo's trip from data URI to stored asset, remembered by the exact bytes
// it came in as. The form autosaves, and it adopts the asset ref a save hands
// back through React state — so a debounce that fires in the window before that
// adoption commits offers us the SAME data URI a second time. Persisting it
// twice minted a second asset, which `updateProduct` then read as a replaced
// photo and purged the first for; the form's pending adoption put the first ref
// back on the row, so the second was purged in its turn — and the row was left
// pointing at a blob that no longer existed. That is the placeholder card, and
// it took every angle on the product with it.
//
// The map is per open form (cleared with the rest of the form's scratch state)
// and holds the in-flight PROMISE, not the resolved ref, so a submit racing an
// autosave over the same photo waits on the one save instead of starting a
// second. Keying by the data URI costs nothing — JS strings are shared, so this
// is another reference to bytes the form is already holding.
type ImageMemo = Map<string, Promise<string>>

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

// Everything ONE open form accumulates: the row its autosaves write into, and
// the photos it has already persisted.
//
// It's a single object swapped out wholesale rather than two refs cleared in
// place, because an autosave that is already in flight has to keep writing into
// the form it started in. Closing the form flushes it, and the unmount flush
// lands later still — both resolve AFTER the close handler has reset the
// scratch. Reading the row id back out at that point returned null, the save
// decided this product didn't exist yet, and added it a SECOND time. Two rows,
// one blob: deleting either copy purged the shared photo (and its Supabase
// `assets` row, so R2 couldn't give it back), leaving the survivor on the
// package placeholder for good. Capturing the object before the first `await`
// keeps a late flush pointed at its own row.
interface FormScratch {
  // The row this form's autosave created, held as the in-flight PROMISE — a
  // submit racing an autosave then waits on the one add instead of racing it to
  // a second row.
  rowId: Promise<string> | null
  images: ImageMemo
}

const newFormScratch = (): FormScratch => ({ rowId: null, images: new Map() })

// Photos arrive from the Product form as data URIs on first add; already-saved
// ones come back as asset:// refs and pass through untouched.
async function persistProductImages(data: Omit<Product, 'id' | 'createdAt'>, memo: ImageMemo) {
  const saved: Omit<Product, 'id' | 'createdAt'> = { ...data }
  if (saved.productImage) {
    saved.productImage = await persistImage(saved.productImage, memo)
  }
  if (saved.extraImages?.length) {
    saved.extraImages = await Promise.all(saved.extraImages.map((src) => persistImage(src, memo)))
  }
  return saved
}

// Influencers bank sub-filter. An entry is a "sheet" when `sheetImage` is set,
// otherwise a portrait. Local-only UI state — not persisted.
export type ModelFilter = 'all' | 'portraits' | 'sheets'
// Short labels + icons (not "Portraits" / "Influencer Sheets") so the row never
// clips on narrow screens.
const MODEL_FILTER_OPTIONS: { value: ModelFilter; label: string; icon?: React.ElementType }[] = [
  { value: 'all', label: 'All' },
  { value: 'portraits', label: 'Portrait', icon: UserRound },
  { value: 'sheets', label: 'Sheets', icon: LayoutGrid },
]

export default function Finder() {
  const [activeBank, setActiveBank] = useState<BankType>('products')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  // Influencers bank sub-filter (All / Portraits / Influencer Sheets).
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all')

  const consumePayload = useAppStore((s) => s.consumePayload)
  const interAppPayload = useAppStore((s) => s.interAppPayload)
  const addToast = useAppStore((s) => s.addToast)

  // Ids of products currently waiting on background extraction. Local only —
  // resets on page refresh by design (interrupted extractions stay as orange-dot drafts).
  const [inFlightIds, setInFlightIds] = useState<Set<string>>(new Set())
  const bulkInputRef = useRef<HTMLInputElement>(null)

  const products = useBankStore((s) => s.products)
  const models = useBankStore((s) => s.models)
  const scripts = useBankStore((s) => s.scripts)
  const voices = useBankStore((s) => s.voices)
  const brolls = useBankStore((s) => s.brolls)
  const styles = useBankStore((s) => s.styles)
  const swipes = useBankStore((s) => s.swipes)
  const addProduct = useBankStore((s) => s.addProduct)
  const updateProduct = useBankStore((s) => s.updateProduct)
  const addModel = useBankStore((s) => s.addModel)
  const updateModel = useBankStore((s) => s.updateModel)
  const addScript = useBankStore((s) => s.addScript)
  const updateScript = useBankStore((s) => s.updateScript)
  const addVoice = useBankStore((s) => s.addVoice)
  const updateVoice = useBankStore((s) => s.updateVoice)
  const addBRoll = useBankStore((s) => s.addBRoll)
  const updateBRoll = useBankStore((s) => s.updateBRoll)
  const addStyle = useBankStore((s) => s.addStyle)
  const updateStyle = useBankStore((s) => s.updateStyle)

  // Consume inter-app payload.
  // `activeBank`  → just switch to the bank.
  // `openCreate`  → switch to the bank AND open the create form (no editingId).
  // This is a one-shot reaction to an external store event (and must call the
  // side-effecting consumePayload), so setting state inside the effect is the
  // correct tool here — not a cascading-render smell.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (interAppPayload?.targetApp !== 'finder') return
    if (interAppPayload.targetField === 'activeBank') {
      const bank = interAppPayload.data as BankType
      if (BANK_TYPES.includes(bank)) {
        setActiveBank(bank)
      }
      consumePayload()
    } else if (interAppPayload.targetField === 'openCreate') {
      const bank = interAppPayload.data as BankType
      if (BANK_TYPES.includes(bank)) {
        setActiveBank(bank)
        setEditingId(null)
        setShowForm(true)
      }
      consumePayload()
    }
  }, [interAppPayload, consumePayload])
  /* eslint-enable react-hooks/set-state-in-effect */

  const counts: Record<BankType, number> = {
    products: products.length,
    models: models.length,
    scripts: scripts.length,
    voices: voices.length,
    brolls: brolls.length,
    styles: styles.length,
    swipes: swipes.length,
  }

  const [sort, setSort, sortOptions] = useBankSort(activeBank)

  // Bumped to force the open Product form to re-seed from its row — see
  // `handleDetachExtraction`. Read through a ref there so the callback stays
  // stable while a background read is running.
  const [formSeed, setFormSeed] = useState(0)
  const editingIdRef = useRef<string | null>(editingId)
  useEffect(() => { editingIdRef.current = editingId }, [editingId])

  // The open form's scratch (see FormScratch above). The row id it carries is
  // deliberately NOT `editingId`: promoting it would swap a real `item` under
  // the open form and reset the fields out from under whoever is typing.
  const scratchRef = useRef<FormScratch>(newFormScratch())

  // Everything that WRITES this ref stays above the memoized callbacks that
  // read it — the compiler won't allow a value captured by a hook to be
  // modified afterwards, and none of these need memoizing anyway.

  // Start a new form. The outgoing object is REPLACED, never emptied, so a save
  // still in flight for the old form keeps the row and the photos it began with.
  const forgetFormScratch = () => {
    scratchRef.current = newFormScratch()
  }

  // Both of these start a fresh row: pressing Add (or opening another product)
  // with a form already open must not keep writing into the last one.
  const handleAdd = () => {
    setEditingId(null)
    forgetFormScratch()
    setShowForm(true)
  }

  const handleEdit = (id: string) => {
    setEditingId(id)
    forgetFormScratch()
    setShowForm(true)
  }

  // Autosave. Runs on a debounce from the form and on the way out of it, so
  // dropping an extra angle and clicking away can never lose the work. A
  // product that doesn't exist yet is created as an unconfirmed draft (the same
  // orange-dot state a bulk-added photo lands in) and confirmed by Save.
  // Returns the row as persisted, so the form can adopt the asset refs and stop
  // re-uploading the same data URI on every pass.
  const handleAutosaveProduct = async (data: Omit<Product, 'id' | 'createdAt'>) => {
    // Read before the first await — this call belongs to the form that started
    // it, whatever the member has opened by the time it resolves.
    const scratch = scratchRef.current
    const saved = await persistProductImages(data, scratch.images)
    const existing = editingId ?? (scratch.rowId ? await scratch.rowId : null)
    if (existing) {
      await updateProduct(existing, saved, { silent: true })
      // The id goes back with the row: a read the form hands off on its way out
      // needs to know which product to write into, and the form is the only one
      // that knows whether its own save had landed yet.
      return { ...saved, id: existing }
    }
    // Claim the slot with the promise itself, with no await in between, so a
    // second pass can only ever wait on this add.
    scratch.rowId = addProduct({ ...saved, confirmed: false }, { silent: true })
    return { ...saved, id: await scratch.rowId }
  }

  // Memoized — captured by the useCallback save handlers below, so it must
  // be referentially stable for the React Compiler to keep their memoization.
  const closeForm = useCallback(() => {
    setEditingId(null)
    forgetFormScratch()
    setShowForm(false)
  }, [])

  const handleSaveProduct = useCallback(async (data: Omit<Product, 'id' | 'createdAt'>) => {
    const scratch = scratchRef.current
    const saved = { ...(await persistProductImages(data, scratch.images)), confirmed: true }
    // Waits on the autosave's row when one is mid-flight — Add Product used to
    // read past it and write a second copy of the product it was confirming.
    const id = editingId ?? (scratch.rowId ? await scratch.rowId : null)
    if (id) await updateProduct(id, saved)
    else await addProduct(saved)
    closeForm()
  }, [editingId, updateProduct, addProduct, closeForm])

  const trackInFlight = useCallback((id: string, active: boolean) => {
    setInFlightIds((prev) => {
      const next = new Set(prev)
      if (active) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  // A read that outlived its form — the member dropped a photo and then closed
  // the form or switched bank tab. The RUNNING call is handed over rather than
  // restarted, so leaving costs nothing and bills nothing; `rowId` resolves once
  // the form has flushed whatever it still owed the bank.
  const handleDetachExtraction = useCallback((job: Promise<ProductExtraction>, rowId: Promise<string | null>) => {
    void adoptDetachedExtraction({
      job,
      rowId,
      onStart: (id) => trackInFlight(id, true),
      onFinish: (id, ok, message) => {
        if (id) trackInFlight(id, false)
        addToast(message, ok ? 'success' : 'error')
        // If the member came back and opened this very product while the read
        // was still running, the form on screen is holding the row as it was
        // BEFORE the fields landed — and its next keystroke would autosave that
        // stale copy straight over them. Re-seed it from the row instead.
        if (ok && id && id === editingIdRef.current) setFormSeed((n) => n + 1)
      },
    })
  }, [trackInFlight, addToast])

  const handleBulkFiles = useCallback(async (files: File[]) => {
    // Names the format that bounced (AVIF, HEIC, …) rather than a bare count —
    // "skipped 3 files" doesn't tell anyone what to re-save them as.
    const { accepted: valid, rejection } = partitionImageFiles(files)
    if (rejection) addToast(rejection, valid.length === 0 ? 'error' : 'info')
    if (valid.length === 0) return

    const results = await Promise.all(valid.map((file) => saveProductDraft({
      file,
      onStart: (id) => trackInFlight(id, true),
      onFinish: (id) => trackInFlight(id, false),
    })))

    const succeeded = results.filter((r) => r.ok).length
    const failed = results.length - succeeded
    if (failed === 0) {
      addToast(`${succeeded} product${succeeded === 1 ? '' : 's'} extracted`, 'success')
      return
    }
    // One photo dropped and one photo failed: say WHY. A bare count is the right
    // shape for a batch and useless for a single drop, which is most of them —
    // it sends a member off re-cropping a photo when their key was the problem.
    const single = results.length === 1 ? results[0].reason : null
    addToast(
      single ?? `${succeeded} of ${results.length} extracted, ${failed} failed — review drafts`,
      single ? 'error' : 'info',
    )
  }, [addToast, trackInFlight])

  const handleSaveModel = useCallback(async (data: Omit<Model, 'id' | 'createdAt'>) => {
    const saved = { ...data }
    if (saved.characterImage && saved.characterImage.startsWith('data:')) {
      saved.characterImage = await saveFromDataUrl(saved.characterImage)
    }
    if (editingId) await updateModel(editingId, saved)
    else await addModel(saved)
    closeForm()
  }, [editingId, updateModel, addModel, closeForm])

  const handleSaveScript = async (data: Omit<Script, 'id' | 'createdAt'>) => {
    if (editingId) await updateScript(editingId, data)
    else await addScript(data)
    closeForm()
  }

  const handleSaveVoice = async (data: Omit<VoicePreset, 'id' | 'createdAt'>) => {
    if (editingId) await updateVoice(editingId, data)
    else await addVoice(data)
    closeForm()
  }

  const handleSaveBRoll = useCallback(async (data: Omit<BRoll, 'id' | 'createdAt'>) => {
    const saved = { ...data }
    if (saved.imageUrl && saved.imageUrl.startsWith('data:')) {
      saved.imageUrl = await saveFromDataUrl(saved.imageUrl)
    }
    if (editingId) await updateBRoll(editingId, saved)
    else await addBRoll(saved)
    closeForm()
  }, [editingId, updateBRoll, addBRoll, closeForm])

  const handleSaveStyle = useCallback(async (data: Omit<StylePreset, 'id' | 'createdAt'>) => {
    if (editingId) await updateStyle(editingId, data)
    else await addStyle(data)
    closeForm()
  }, [editingId, updateStyle, addStyle, closeForm])

  const editingProduct = editingId ? products.find((p) => p.id === editingId) : null
  const editingModel = editingId ? models.find((m) => m.id === editingId) : null
  const editingScript = editingId ? scripts.find((s) => s.id === editingId) : null
  const editingVoice = editingId ? voices.find((v) => v.id === editingId) : null
  const editingBRoll = editingId ? brolls.find((b) => b.id === editingId) : null
  const editingStyle = editingId ? styles.find((s) => s.id === editingId) : null

  // Products & Influencers pin the left column and scroll only the right side
  // on desktop, instead of scrolling the whole page.
  const fixedFormLayout = showForm && (activeBank === 'products' || activeBank === 'models')

  return (
    <div className="flex h-full flex-col">
      {/* Header — single fixed-height row: bank toggle on the left, actions on
          the right, with the separator footing flush under the toggle. Mirrors
          the Influencers gallery header so the toggle reads the same height as
          the other main toggles across the app. */}
      {/* Two rows on a phone: the six bank tabs plus Sort plus Add can't share
          390px, and squeezing them left the bank switcher — the one control
          this screen is for — as a sliver reading "P…". The toggle takes its own
          full-width row and the actions sit under it. md+ is the single 57px
          band, unchanged. */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-ink/5 px-3 py-2 md:h-[57px] md:flex-row md:items-center md:justify-between md:gap-3 md:px-5 md:py-0">
        <div className="min-w-0 overflow-x-auto scrollbar-hide scroll-fade-r md:flex-1">
          <SegmentedToggle<BankType>
            fitContent
            className="h-10 !p-1"
            value={activeBank}
            onChange={(bank) => { setActiveBank(bank); closeForm() }}
            options={BANK_TYPES.map((bank) => ({
              value: bank,
              label: BANK_CONFIG[bank].label,
              icon: SIDEBAR_ICONS[bank],
              badge: counts[bank] > 0 ? counts[bank] : undefined,
            }))}
          />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 md:gap-3">
          {/* Influencers sub-filter — sized to match the main bank toggle
              (h-10 !p-1). Only the Influencers bank has the portrait/sheet
              split. */}
          {activeBank === 'models' && counts.models > 0 && !showForm && (
            <SegmentedToggle<ModelFilter>
              fitContent
              accent="influencers"
              className="h-10 !p-1 shrink-0"
              value={modelFilter}
              onChange={setModelFilter}
              options={MODEL_FILTER_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
                icon: o.icon,
              }))}
            />
          )}
          {sortOptions && counts[activeBank] > 0 && !showForm && (
            <SortControl value={sort} onChange={setSort} options={sortOptions} />
          )}
          {activeBank === 'products' && !showForm && (
            <>
              <input
                ref={bulkInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  if (files.length > 0) handleBulkFiles(files)
                }}
              />
              <button
                onClick={() => bulkInputRef.current?.click()}
                title="Bulk add"
                className="flex h-10 items-center gap-2 rounded-full border border-ink/10 bg-ink/[0.04] px-3.5 text-[13px] font-medium tracking-tight text-ink-300 transition-colors hover:bg-ink/[0.08] md:px-5"
              >
                <Upload className="h-4 w-4" />
                {/* Icon-only on phones — the label crowded the toolbar. */}
                <span className="hidden sm:inline">Bulk add</span>
              </button>
            </>
          )}
          <button
            onClick={handleAdd}
            className="flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[13px] font-medium tracking-tight text-ink-900 transition-colors hover:bg-ink-100"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>

      {/* Content area — list or form. Forms render unboxed so they get the
          full width of the section. Products/Influencers use a fixed-left /
          scroll-right layout on desktop so the image stays put while the
          details scroll (no whole-page scroll). */}
      <div className={`flex-1 overflow-y-auto p-5 ${fixedFormLayout ? 'lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden' : ''}`}>
        {showForm ? (
          <div className={`mx-auto ${['products', 'models', 'brolls', 'scripts', 'styles'].includes(activeBank) ? 'max-w-5xl' : 'max-w-md'} ${fixedFormLayout ? 'w-full lg:flex lg:min-h-0 lg:flex-1 lg:flex-col' : ''}`}>
            {activeBank === 'products' && (
              <ProductForm
                // Remount when the form is pointed at a different row (or at a
                // new product): its fields are local state, and without this
                // pressing Add with a form already open kept the last
                // product's values — which autosave would then write to a row
                // of its own. `editingId` doesn't change while autosaving, so
                // typing never remounts the form.
                key={`${editingId ?? 'new'}:${formSeed}`}
                item={editingProduct}
                onSave={handleSaveProduct}
                onAutosave={handleAutosaveProduct}
                onCancel={closeForm}
                onDetachExtraction={handleDetachExtraction}
              />
            )}
            {activeBank === 'models' && (
              <ModelForm item={editingModel} onSave={handleSaveModel} onCancel={closeForm} />
            )}
            {activeBank === 'scripts' && (
              <ScriptForm item={editingScript} onSave={handleSaveScript} onCancel={closeForm} />
            )}
            {activeBank === 'voices' && (
              <VoiceForm item={editingVoice} onSave={handleSaveVoice} onCancel={closeForm} />
            )}
            {activeBank === 'brolls' && (
              <BRollForm item={editingBRoll} onSave={handleSaveBRoll} onCancel={closeForm} />
            )}
            {activeBank === 'styles' && (
              <StyleForm item={editingStyle} onSave={handleSaveStyle} onCancel={closeForm} />
            )}
          </div>
        ) : (
          <BankList
            bankType={activeBank}
            onEdit={handleEdit}
            onAdd={handleAdd}
            sort={sort}
            modelFilter={modelFilter}
            inFlightProductIds={inFlightIds}
            onBulkProductFiles={handleBulkFiles}
          />
        )}
      </div>
    </div>
  )
}
