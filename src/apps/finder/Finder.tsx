import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Package, UserRound, FileText, Mic, Film, Upload, LayoutGrid, Palette, Bookmark, Search, List, X } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useBankStore } from '../../stores/bankStore'
import { useIsAppVisible } from '../../stores/appVisibilityStore'
import type { BankType } from '../../utils/constants'
import { BANK_CONFIG } from '../../utils/constants'
import type { Product, Model, Script, VoicePreset, BRoll, StylePreset } from '../../stores/types'
import { saveFromDataUrl } from '../../utils/assetStore'
import BankList, { SortControl } from './BankList'
import BankSidebar from './BankSidebar'
import SegmentedToggle from '../../components/SegmentedToggle'
import { useBankSort, useBankView, type BankView } from './bankSort'
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

// The Swipe File is Outliers' own bank — every row in it is filed from that
// app, and its empty state says so. A member who has switched Outliers off in
// Settings therefore loses the tab too: left in, it is a tab pointing at an app
// that isn't there. Switching Outliers back on brings the tab and its rows back
// untouched — nothing here deletes a swipe.
const BANK_OWNER_APP: Partial<Record<BankType, string>> = { swipes: 'discover' }

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
  const [selectedBank, setActiveBank] = useState<BankType>('products')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  // Influencers bank sub-filter (All / Portraits / Influencer Sheets).
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all')
  // The toolbar search. Cleared on every bank switch: a query carried across
  // tabs lands on an empty grid whose tab reads "24", which looks like a bug.
  const [query, setQuery] = useState('')

  const isVisible = useIsAppVisible()
  const bankTypes = BANK_TYPES.filter((bank) => {
    const owner = BANK_OWNER_APP[bank]
    return !owner || isVisible(owner)
  })
  // Derived rather than corrected in an effect: a tab can disappear under us
  // (Settings is a modal over this app), and falling back in render means the
  // list below is never asked for a bank whose tab isn't on screen.
  const activeBank = bankTypes.includes(selectedBank) ? selectedBank : 'products'

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
  const [view, setView] = useBankView(activeBank)

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

  const selectBank = (bank: BankType) => { setActiveBank(bank); setQuery(''); closeForm() }

  return (
    // Sidebar + column, Finder's own shape. The banks moved off the top row and
    // down the left in September 2026: the strip and the toolbar were fighting
    // over one 57px line, and with search and the view switcher on it the last
    // tab scrolled off the end at 1440px. Below `md` there is no sidebar and the
    // tab strip is still the switcher.
    <div className="flex h-full">
      <BankSidebar
        banks={bankTypes}
        active={activeBank}
        counts={counts}
        icons={SIDEBAR_ICONS}
        onSelect={selectBank}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header — one 57px band from `md` up: the bank's name on the left (the
            sidebar says which one is selected; this says it in words, and gives
            the row a left edge), actions on the right. On a phone it's two rows,
            the tab strip and then the actions: the six tabs plus Sort plus Add
            can't share 390px, and squeezing them left the switcher as a sliver
            reading "P…". */}
        <div className="flex shrink-0 flex-col gap-2 border-b border-ink/5 px-3 py-2 md:h-[57px] md:flex-row md:items-center md:justify-between md:gap-3 md:px-5 md:py-0">
          <h2 className="hidden shrink-0 text-[15px] font-medium tracking-tight text-ink-100 md:block">
            {BANK_CONFIG[activeBank].label}
          </h2>
          <div className="min-w-0 flex-1 overflow-x-auto scrollbar-hide scroll-fade-r md:hidden">
            <SegmentedToggle<BankType>
              fitContent
              className="h-10 !p-1"
              value={activeBank}
              onChange={selectBank}
              options={bankTypes.map((bank) => ({
                value: bank,
                label: BANK_CONFIG[bank].label,
                icon: SIDEBAR_ICONS[bank],
                badge: counts[bank] > 0 ? counts[bank] : undefined,
              }))}
            />
          </div>
          {/* The row wraps on a phone rather than squeezing: the search field takes
              a full row of its own under the buttons (`order-last`), which is the
              shape the B-Roll history bar already uses. Above `md` it's one 57px
              band and the field sits inline. */}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 md:flex-nowrap md:gap-3">
            {/* How the list is LOOKED at — searched, and drawn. On a phone the two
                share the row under the buttons (`md:contents` dissolves this
                  wrapper above `md`, so on a desktop they're just two more items in
                  this row). They were loose items with `flex-wrap` first, and at
                  375px the Products tab pushed Add onto a line of its own: a header
                  of four stacked rows on the screen with the least to give. */}
              {counts[activeBank] > 0 && !showForm && (
                <div className="flex items-center gap-2 max-md:order-last max-md:w-full md:contents">
                {/* Fixed widths rather than `flex-1` above `md`: what a growing field
                    takes width FROM is the bank switcher, the one control this screen
                    exists for. Six tabs want ~820px, and a field that ate the
                    leftover scrolled "Visual Styles" off the end of the strip on a
                    1440px laptop. */}
                <div className="relative shrink-0 max-md:w-auto max-md:flex-1 md:w-[140px] 2xl:w-[230px]">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    // Just "Search": the field is narrow enough at `md` that
                    // "Search visual styles" clips mid-word, and the tab it sits
                    // beside already says which bank is being searched.
                    placeholder="Search"
                    className="h-10 w-full rounded-full border border-ink/10 bg-ink/[0.04] pl-9 pr-8 text-[13px] font-medium tracking-tight text-ink-200 outline-none transition-colors placeholder:font-normal placeholder:text-ink-500 focus:border-ink/20"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      title="Clear search"
                      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/[0.08] hover:text-ink-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <SegmentedToggle<BankView>
                  fitContent
                  // `dense` for the segment padding only — the height stays the
                  // toolbar's 40px. Two glyphs and no labels don't need a full-size
                  // segment's 32px of padding each, and this row is fighting the
                  // bank switcher for width.
                  dense
                  className="h-10 !p-1 shrink-0"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'grid', label: '', ariaLabel: 'Grid view', icon: LayoutGrid },
                    { value: 'list', label: '', ariaLabel: 'List view', icon: List },
                  ]}
                />
                </div>
            )}
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
                  <span className="hidden sm:inline">Bulk Add</span>
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
              onSortChange={setSort}
              view={view}
              query={query}
              modelFilter={modelFilter}
              inFlightProductIds={inFlightIds}
              onBulkProductFiles={handleBulkFiles}
            />
          )}
        </div>
      </div>
    </div>
  )
}
