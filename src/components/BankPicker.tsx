import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Plus, FolderOpen, Check, ChevronDown } from 'lucide-react'
import type { BankType } from '../utils/constants'
import { BANK_CONFIG, getAppConfig } from '../utils/constants'
import { useBankStore } from '../stores/bankStore'
import { useAppStore } from '../stores/appStore'
import type { Product, Model, Script, VoicePreset, BRoll, StylePreset, AnyBankItem } from '../stores/types'
import BankItemCard from './BankItemCard'
import SegmentedToggle from './SegmentedToggle'
import { useIsDesktop } from '../hooks/useBreakpoint'
import { useCloseOnAppSwitch } from '../hooks/useCloseOnAppSwitch'
import { sortByOrder, starredFirst, SORT_OPTIONS_WITH_NAME, SORT_OPTIONS_DATE_ONLY, type SortOrder } from '../apps/finder/bankSort'
import useCloseOnEscape from '../hooks/useCloseOnEscape'
import Spinner from './Spinner'
import CountSlot from './CountSlot'
import DayPill from './DayPill'
import { groupByDay, sectionLabel } from '../utils/history'
import { humanizeError } from '../utils/friendlyError'
import {
  buildSearch,
  flattenJsonProfile,
  genderBucket,
  loadStarterPresets,
  saveStarterToBank,
  settingFromProfile,
  starterThumbUrl,
  type StarterRow,
} from '../apps/character-studio/presets/service'
import Dropdown from './Dropdown'

// A tile standing in for a template that isn't in the bank yet. Prefixed so
// `handleSelect` can tell one from a real row by its id alone — nothing else
// in the app mints an id with a colon in it.
const TEMPLATE_ID = 'template:'
const templateIdOf = (rowId: string) => rowId.startsWith(TEMPLATE_ID) ? rowId.slice(TEMPLATE_ID.length) : null

type BankItem = AnyBankItem

interface BankPickerProps {
  bankType: BankType
  isOpen: boolean
  onSelect: (item: BankItem) => void
  onClose: () => void
  // Optional extra filter beyond search (e.g. only brolls with `imageUrl`).
  filter?: (item: BankItem) => boolean
  // Multi-select mode — accumulates selections, returns the array on confirm.
  multiSelect?: boolean
  onSelectMany?: (items: BankItem[]) => void
  // When provided, the picker renders an inline tab strip so the user can
  // switch between banks without closing. `bankType` becomes the *initial*
  // active tab. The tabs array's order is the tab strip's order. Each tab
  // can carry its own optional filter (used today to keep brolls with
  // `imageUrl` only when surfacing them as image refs).
  tabs?: Array<BankType | { type: BankType; filter?: (item: BankItem) => boolean }>
  // Image-picking mode: a product with extra angles is listed as one tile per
  // photo, so the caller can attach the open box rather than only the hero
  // shot. Each tile hands back a shallow Product clone whose `productImage` is
  // that angle — callers that only read the image work unchanged. Off by
  // default: pickers that pick the *product* (B-Roll, Scripts) need the real
  // row and its real id.
  expandProductImages?: boolean
}

// One tile per photo for products carrying extra angles. The clone keeps every
// field but `productImage` and `id` — the suffixed id keeps multi-select
// selection unambiguous between two angles of the same product.
function expandProducts(products: Product[]): Product[] {
  return products.flatMap((p) =>
    !p.extraImages?.length
      ? [p]
      : [p, ...p.extraImages.map((src, i) => ({ ...p, id: `${p.id}::angle${i + 1}`, productImage: src }))],
  )
}

function getItemName(bankType: BankType, item: BankItem): string {
  switch (bankType) {
    case 'products': return (item as Product).productName
    case 'models': return (item as Model).name
    case 'scripts': return (item as Script).title
    case 'voices': return (item as VoicePreset).label
    case 'brolls': return (item as BRoll).prompt ?? 'B-Roll'
    case 'styles': return (item as StylePreset).name
    default: return ''
  }
}

export default function BankPicker({
  bankType,
  isOpen,
  onSelect,
  onClose,
  filter,
  multiSelect = false,
  onSelectMany,
  tabs,
  expandProductImages = false,
}: BankPickerProps) {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // Picker sort is local (not the Bank's persisted choice) so it always
  // defaults to "Newest first" — resets on open and on tab switch below.
  const [sort, setSort] = useState<SortOrder>('newest')
  // When `tabs` is provided, the active bank is local state initialised to
  // the caller's `bankType`. Otherwise the active bank is just `bankType`.
  const [activeTab, setActiveTab] = useState<BankType>(bankType)
  // Ids of landscape (16:9) images, detected on load — b-roll stills span the
  // full masonry width, and wide character sheets span both grid columns,
  // instead of being squeezed into one narrow column.
  const [landscapeIds, setLandscapeIds] = useState<Set<string>>(new Set())
  // The Characters template library, and the in-flight flag for turning one
  // into a real bank row on pick.
  const [templates, setTemplates] = useState<StarterRow[] | null>(null)
  // The two character facets, mirroring the Characters preset picker — a
  // picker holding the whole template library needs the same way into it.
  const [gender, setGender] = useState('')
  const [styleFacet, setStyleFacet] = useState('')
  // The row currently being written into the bank ('multi' for a confirmed
  // multi-select), so the tile it was clicked on can say so.
  const [addingId, setAddingId] = useState<string | null>(null)
  const adding = addingId !== null
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const isDesktop = useIsDesktop()

  // Normalize the tabs prop into a stable shape.
  const normalizedTabs = tabs?.map((t) =>
    typeof t === 'string' ? { type: t, filter: undefined } : t
  )
  const currentBankType: BankType = normalizedTabs ? activeTab : bankType
  const currentTabFilter = normalizedTabs?.find((t) => t.type === currentBankType)?.filter

  const products = useBankStore((s) => s.products)
  const models = useBankStore((s) => s.models)
  const scripts = useBankStore((s) => s.scripts)
  const voices = useBankStore((s) => s.voices)
  const brolls = useBankStore((s) => s.brolls)
  const styles = useBankStore((s) => s.styles)
  // In image-picking mode a product with extra angles occupies one tile per
  // photo; everywhere else the raw bank rows are the pool.
  const productPool = useMemo(
    () => (expandProductImages ? expandProducts(products) : products),
    [products, expandProductImages],
  )
  const addToast = useAppStore((s) => s.addToast)
  const openApp = useAppStore((s) => s.openApp)
  const sendToApp = useAppStore((s) => s.sendToApp)
  const activeApp = useAppStore((s) => s.activeApp)

  // Selection highlight follows the app the picker was opened from (green in
  // Playground, etc.), falling back to the bank's own accent.
  const accentColor = getAppConfig(activeApp ?? '')?.accent ?? BANK_CONFIG[currentBankType].accent

  const items: BankItem[] =
    currentBankType === 'products' ? productPool :
    currentBankType === 'models' ? models :
    currentBankType === 'scripts' ? scripts :
    currentBankType === 'voices' ? voices :
    currentBankType === 'styles' ? styles :
    brolls

  // The templates are shipped with the app and identical for every member, so
  // a character picker offers them alongside the member's own rows: picking one
  // writes it into the Characters bank (portrait and DNA) and hands the caller
  // the real `Model` it just made, which is what "use a template exactly like
  // one of mine" has to mean — every downstream app reads `characterImage`, and
  // a static URL is not an asset any of them can keep. Fetched on open, and
  // only for a picker that can actually reach the characters bank.
  const offersTemplates = normalizedTabs
    ? normalizedTabs.some((t) => t.type === 'models')
    : bankType === 'models'
  useEffect(() => {
    if (!isOpen || !offersTemplates || templates) return
    let live = true
    loadStarterPresets().then(
      (rows) => { if (live) setTemplates(rows) },
      // A library that won't load is not worth a toast in a picker that works
      // perfectly well without it — the member's own characters are the point.
      () => {},
    )
    return () => { live = false }
  }, [isOpen, offersTemplates, templates])

  // Apply the per-tab filter (when in tab-mode) ahead of the caller's
  // general filter so the caller-supplied filter stays in charge.
  const itemsAfterTabFilter = currentTabFilter ? items.filter(currentTabFilter) : items
  // Influencers are always picked to be *used* as an image reference, so hide
  // image-less presets (saved recipes) — they're only loadable in the studio.
  const itemsAfterImageFilter =
    currentBankType === 'models'
      ? itemsAfterTabFilter.filter((it) => !!(it as Model).characterImage)
      : itemsAfterTabFilter
  const itemsAfterFilter = filter ? itemsAfterImageFilter.filter(filter) : itemsAfterImageFilter

  // ── Characters ───────────────────────────────────────────────────────
  // The member's own rows and the template library, annotated with the two
  // facets and one search haystack apiece, so both halves of the list filter
  // through the same code — a picker that offers 81 templates needs the same
  // way into them the Characters preset picker has.
  //
  // A bank row's gender is BUCKETED and its style keyword-matched off its free
  // text (`genderBucket` / `settingFromProfile`), exactly as over there: raw
  // values would list two spellings of one thing, and a row nothing matches
  // simply carries no style rather than a wrong one.
  const characterPool = useMemo(() => {
    if (currentBankType !== 'models') return null
    const own = (itemsAfterFilter as Model[]).map((m) => {
      const flat = flattenJsonProfile(m.jsonProfile)
      return {
        model: m,
        gender: genderBucket(flat.gender ?? ''),
        setting: settingFromProfile(flat),
        search: buildSearch([m.name], flat),
      }
    })
    const saved = new Set(models.map((m) => m.presetId).filter(Boolean))
    const tpl = (templates ?? [])
      .filter((t) => !saved.has(t.id))
      .map((t) => ({
        model: {
          id: `${TEMPLATE_ID}${t.id}`,
          name: t.title,
          characterImage: starterThumbUrl(t.id),
          jsonProfile: null,
          notes: '',
          source: 'character-studio',
          presetId: t.id,
          createdAt: 0,
        } as Model,
        gender: genderBucket(t.gender),
        setting: t.setting,
        search: t.search,
      }))
      .filter((r) => (!currentTabFilter || currentTabFilter(r.model)) && (!filter || filter(r.model)))
    return { own, tpl }
  }, [currentBankType, itemsAfterFilter, models, templates, currentTabFilter, filter])

  const q = search.trim().toLowerCase()
  const characterPasses = useMemo(() => ({
    q: (r: { search: string }) => !q || r.search.includes(q),
    gender: (r: { gender?: string }) => !gender || r.gender === gender,
    setting: (r: { setting?: string }) => !styleFacet || r.setting === styleFacet,
  }), [q, gender, styleFacet])

  const filtered = characterPool
    // A character is searched on its whole DNA — "freckles" and "wood slat
    // wall" find the one they describe, where a name-only match never could.
    ? characterPool.own.filter((r) => Object.values(characterPasses).every((fn) => fn(r))).map((r) => r.model)
    : search.trim()
    ? itemsAfterFilter.filter((item) =>
        getItemName(currentBankType, item).toLowerCase().includes(search.toLowerCase())
      )
    : itemsAfterFilter

  // Both facets' counts are taken against the OTHER one (and the search), so a
  // segment can never promise more than the list delivers, and every option
  // renders even at zero — a vanishing one moves the control under the pointer,
  // and a 0 answers "why is there nothing here" outright.
  const characterFacets = useMemo(() => {
    if (!characterPool) return null
    const all = [...characterPool.own, ...characterPool.tpl]
    const pool = (except: keyof typeof characterPasses) =>
      all.filter((r) => Object.entries(characterPasses).every(([k, fn]) => k === except || fn(r)))
    const genderRows = pool('gender')
    const styleRows = pool('setting')
    // Styles in the LIBRARY's own order — the shot numbering the build script
    // bakes into the row order — not by count, which would reshuffle the menu
    // between two openings. A style only the member's own rows use is appended.
    const order: string[] = []
    for (const r of [...characterPool.tpl, ...characterPool.own]) {
      if (r.setting && !order.includes(r.setting)) order.push(r.setting)
    }
    return {
      genders: [
        { value: '', label: 'All', badge: <CountSlot value={genderRows.length} /> },
        ...['Female', 'Male'].map((k) => ({
          value: k,
          label: k,
          badge: <CountSlot value={genderRows.filter((r) => r.gender === k).length} />,
        })),
      ],
      styles: [
        { value: '', label: 'All Styles' },
        ...order.map((k) => ({
          value: k,
          label: k,
          count: styleRows.filter((r) => r.setting === k).length,
        })),
      ],
    }
  }, [characterPool, characterPasses])

  // Same sort options as the Bank browser. `sortOptions` is null for banks the
  // Bank doesn't sort (voices) — we then leave the list in its natural order.
  const sortOptions =
    currentBankType === 'products' || currentBankType === 'models' || currentBankType === 'scripts' || currentBankType === 'styles'
      ? SORT_OPTIONS_WITH_NAME
      : currentBankType === 'brolls'
      ? SORT_OPTIONS_DATE_ONLY
      : null
  const sorted = useMemo(() => {
    if (!sortOptions) return filtered
    const nameOf =
      currentBankType === 'products' ? (it: BankItem) => (it as Product).productName :
      currentBankType === 'models' ? (it: BankItem) => (it as Model).name :
      currentBankType === 'scripts' ? (it: BankItem) => (it as Script).title :
      currentBankType === 'styles' ? (it: BankItem) => (it as StylePreset).name :
      undefined
    // Starred items float to the top regardless of the chosen sort — the
    // picker is where pinned assets pay off.
    return starredFirst(sortByOrder(filtered, sort, nameOf))
  }, [filtered, sort, sortOptions, currentBankType])

  // One group per style ("Handheld Mic", "Car"), in the library's own order —
  // which the build script already sorts the rows into, so this splits on a
  // change of style rather than re-bucketing. 81 unfamiliar faces under one
  // heading is a wall; under eleven it's a shot list.
  const templateGroups = useMemo(() => {
    if (!characterPool) return []
    const out: Array<{ label: string; models: Model[] }> = []
    for (const r of characterPool.tpl) {
      if (!Object.values(characterPasses).every((fn) => fn(r))) continue
      const label = r.setting || 'Other'
      const last = out[out.length - 1]
      if (last?.label === label) last.models.push(r.model)
      else out.push({ label, models: [r.model] })
    }
    return out
  }, [characterPool, characterPasses])

  // B-Rolls are day-grouped under a date pill, exactly as the Bank browser
  // shows them — a still is recognised by when it was shot, and the picker is
  // where you go looking for "the one from yesterday". `groupByDay` is
  // newest-day-first; flip it when the user sorts oldest-first.
  const brollDayGroups = useMemo(() => {
    if (currentBankType !== 'brolls') return null
    const groups = groupByDay(sorted, (item) => (item as BRoll).createdAt)
    return sort === 'oldest' ? groups.reverse() : groups
  }, [sorted, sort, currentBankType])

  // Everything with a thumbnail (influencers, products, b-rolls, scripts) packs
  // into the same dense grid the main Bank uses — `grid-flow-row-dense`
  // backfills the hole a wide card leaves. Voices are text rows, so they stay
  // single-column. THREE columns at every width (August 2026, Massimo's call):
  // a phone showed two, on the theory that a third tile would be unreadable,
  // but these are 9:16 portraits with the name written across them — at ~112px
  // they still read, and two-up meant a 390px sheet showed four characters in a
  // screen and a half of scrolling when the point of the picker is recognising
  // one on sight.
  const gridClass =
    currentBankType === 'voices'
      ? 'flex flex-col gap-2'
      : 'grid grid-flow-row-dense grid-cols-3 items-start gap-2'

  const renderCard = (item: BankItem) => {
    const isSelected = multiSelect && selectedIds.includes(item.id)
    // A b-roll still or character sheet spans two columns only when it is
    // actually wide (a 16:9 frame or turnaround, unreadable squeezed into one
    // portrait-width column). Sheets render in whatever aspect the character was
    // generated at, so a 9:16 sheet stays a normal one-column tile like every
    // other card — measured on load rather than assumed from the sheetImage stamp.
    const isWide =
      (currentBankType === 'brolls' || currentBankType === 'models') && landscapeIds.has(item.id)
    return (
      <div key={item.id} className={`relative ${isWide ? 'col-span-2' : ''}`}>
        <BankItemCard
          bankType={currentBankType}
          item={item}
          onClick={() => handleSelect(item)}
          selected={isSelected}
          accentColor={accentColor}
          onLandscape={
            currentBankType === 'brolls' || currentBankType === 'models'
              ? (landscape) =>
                  setLandscapeIds((prev) => {
                    if (prev.has(item.id) === landscape) return prev
                    const next = new Set(prev)
                    if (landscape) next.add(item.id)
                    else next.delete(item.id)
                    return next
                  })
              : undefined
          }
        />
        {isSelected && (
          <div
            className="pointer-events-none absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: accentColor }}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </div>
        )}
        {addingId === item.id && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/45">
            <Spinner className="h-5 w-5 text-white" />
          </div>
        )}
      </div>
    )
  }

  // Brolls don't have a Finder-form create path (no useful empty record to
  // create) — they come from generation flows. Other bank types let the
  // user jump to Bank with the create form pre-opened.
  const supportsCreate = currentBankType !== 'brolls'

  // Reset transient state and pick the initial tab when the picker opens.
  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setSelectedIds([])
      setSort('newest')
      setGender('')
      setStyleFacet('')
      setAddingId(null)
      setActiveTab(bankType)
      const initialItems =
        bankType === 'products' ? productPool :
        bankType === 'models' ? models :
        bankType === 'scripts' ? scripts :
        bankType === 'voices' ? voices :
        bankType === 'styles' ? styles :
        brolls
      if (initialItems.length > 0) {
        setTimeout(() => searchRef.current?.focus(), 100)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, bankType])

  useCloseOnAppSwitch(isOpen, onClose)

  useCloseOnEscape(isOpen, onClose)

  // Writes a template into the Characters bank and returns the row it became,
  // so a caller only ever receives a real `Model` with a real asset behind it.
  // `saveStarterToBank` is a no-op if it's already there, which is what makes a
  // double-click safe beyond the `adding` guard.
  const materialize = async (templateId: string): Promise<Model | null> => {
    const row = templates?.find((t) => t.id === templateId)
    if (!row) return null
    await saveStarterToBank(row)
    return useBankStore.getState().models.find((m) => m.presetId === templateId) ?? null
  }

  const handleSelect = (item: BankItem) => {
    if (multiSelect) {
      setSelectedIds((prev) =>
        prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
      )
      return
    }
    const templateId = templateIdOf(item.id)
    if (templateId) {
      if (adding) return
      setAddingId(item.id)
      void materialize(templateId)
        .then((model) => {
          if (!model) return
          onSelect(model)
          onClose()
        })
        .catch((err: unknown) => addToast(humanizeError(err, 'Could not add that template.'), 'error'))
        .finally(() => setAddingId(null))
      return
    }
    onSelect(item)
    onClose()
  }

  // Resolve a bank type to its full (unfiltered) item array.
  const poolFor = (t: BankType): BankItem[] =>
    t === 'products' ? productPool :
    t === 'models' ? models :
    t === 'scripts' ? scripts :
    t === 'voices' ? voices :
    t === 'styles' ? styles :
    brolls

  const handleConfirmMulti = async () => {
    if (!onSelectMany || selectedIds.length === 0 || adding) return
    // Resolve selected ids across *every* bank the picker can switch between
    // (not just the current tab) so a selection spanning multiple tabs is added
    // in one go. Ids are global UUIDs, so a flat id→item map is unambiguous;
    // selection order is preserved by walking selectedIds.
    const tabTypes: BankType[] = normalizedTabs ? normalizedTabs.map((t) => t.type) : [bankType]
    const byId = new Map<string, BankItem>()
    for (const t of tabTypes) for (const it of poolFor(t)) byId.set(it.id, it)
    // Templates are written into the bank one at a time on the way out — each
    // one is a blob fetch plus an IndexedDB write, and firing a dozen at once
    // is the burst the R2 mirror already has a concurrency cap for.
    setAddingId('multi')
    const picked: BankItem[] = []
    try {
      for (const id of selectedIds) {
        const templateId = templateIdOf(id)
        if (templateId) {
          const model = await materialize(templateId)
          if (model) picked.push(model)
          continue
        }
        const item = byId.get(id)
        if (item) picked.push(item)
      }
    } catch (err) {
      addToast(humanizeError(err, 'Could not add those templates.'), 'error')
      setAddingId(null)
      return
    }
    setAddingId(null)
    if (picked.length === 0) return
    onSelectMany(picked)
    onClose()
  }

  // Jump to the Bank app with the create form for this bank pre-opened.
  // Finder consumes `openCreate` (see Finder.tsx) to switch bank + open form.
  const handleAddNew = () => {
    onClose()
    sendToApp({ targetApp: 'finder', targetField: 'openCreate', data: currentBankType })
    openApp('finder')
  }

  const handleManageInFinder = () => {
    onClose()
    sendToApp({ targetApp: 'finder', targetField: 'activeBank', data: currentBankType })
    openApp('finder')
  }

  const label = BANK_CONFIG[currentBankType].label

  // Render through a portal so the picker is parented at document root,
  // not inside whichever caller mounts it. This sidesteps the
  // backdrop-filter / transform containing-block trap (callers with those
  // styles otherwise pin our `position: fixed` to themselves).
  const portalTarget = typeof document !== 'undefined' ? document.body : null
  if (!portalTarget) return null

  const picker = (
    <>
      {/* Backdrop — z-[70] keeps the picker above the sidebar (z-40) and
          above the B-Roll CardDetailModal (z-[60]) when opened from within. */}
      <div
        className={`fixed inset-0 z-[70] bg-black/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`fixed z-[80] flex flex-col border-ink/5 bg-surface-1/95 backdrop-blur-2xl transition-transform duration-300 ease-out ${
          isDesktop
            ? `right-0 top-0 bottom-0 w-[560px] border-l ${isOpen ? 'translate-x-0' : 'translate-x-full'}`
            : `inset-x-0 bottom-0 top-14 border-t rounded-t-2xl ${isOpen ? 'translate-y-0' : 'translate-y-full'}`
        }`}
      >
        {/* Drag handle — mobile only */}
        {!isDesktop && (
          <div className="flex justify-center pt-2 pb-1">
            <div className="h-1 w-10 rounded-full bg-ink/20" />
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink/5 px-5 py-3.5">
          <h3 className="text-sm font-semibold tracking-tight text-ink-200">
            Select {normalizedTabs ? 'from Bank' : label.replace(/s$/, '')}
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-2 lg:p-1 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Optional bank-switch toggle — same rounded segmented control as
            the rest of the app. */}
        {normalizedTabs && (
          <div className="flex items-center border-b border-ink/5 px-4 py-3">
            <SegmentedToggle<BankType>
              value={currentBankType}
              // Keep the running multi-select across tabs — only the per-tab
              // view state (search, sort) resets — so the user can gather refs
              // from several banks and add them all at once.
              onChange={(t) => { setActiveTab(t); setSearch(''); setSort('newest'); setGender(''); setStyleFacet('') }}
              options={normalizedTabs.map((t) => ({ value: t.type, label: BANK_CONFIG[t.type].label }))}
              dense
            />
          </div>
        )}

        {/* Search + sort share one row. The sort dropdown sits beside the
            search box at a matching height (hidden for banks the Bank doesn't
            sort, e.g. voices). */}
        <div className="flex items-center gap-2 border-b border-ink/5 px-4 py-3">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-600" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full bg-transparent text-sm text-ink-200 placeholder-ink-600 outline-none"
            />
          </div>
          {sortOptions && (
            <div className="relative shrink-0">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOrder)}
                className="h-10 appearance-none rounded-full border border-ink/10 bg-surface-1 pl-3.5 pr-8 text-xs text-ink-200 outline-none transition-colors hover:border-ink/20 focus:border-ink/20"
              >
                {sortOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
            </div>
          )}
        </div>

        {/* Character facets, on their own row under the search — the same pair
            the Characters preset picker carries, because this list now holds
            the same library. Gender is a toggle (three options, all worth
            seeing without a click); the styles are a menu, since eleven
            segments make a strip no 560px panel fits. The menu takes a FIXED
            width rather than fitting its content: its label swings from "All
            Styles" to "Holding Product", and a self-resizing trigger would
            shove the gender toggle along the row on every pick. */}
        {characterFacets && (
          <div className="flex items-center gap-2 border-b border-ink/5 px-4 py-3">
            <SegmentedToggle
              value={gender}
              onChange={setGender}
              options={characterFacets.genders}
              className="shrink-0"
              fitContent
              dense
            />
            <div className="min-w-0 flex-1">
              <Dropdown
                value={styleFacet}
                onChange={setStyleFacet}
                options={characterFacets.styles}
                tier="panel"
                dense
              />
            </div>
          </div>
        )}

        {/* Item list */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {sorted.length === 0 && templateGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <span className="text-sm text-ink-600">
                {search ? 'No matches found' : `No ${label.toLowerCase()} yet`}
              </span>
              <span className="text-xs text-ink-700">
                {search ? 'Try a different search' : 'Add one below to get started'}
              </span>
            </div>
          ) : brollDayGroups ? (
            <div className="flex flex-col">
              {brollDayGroups.map(([dayTs, dayItems]) => (
                <div key={dayTs}>
                  <DayPill label={sectionLabel(dayTs)} />
                  <div className={gridClass}>{dayItems.map(renderCard)}</div>
                </div>
              ))}
            </div>
          ) : templateGroups.length > 0 ? (
            /* Your own characters, then the template library grouped by style —
               the same shape and the same order as the Characters preset
               picker, since it is now the same list in both places. The heading
               above your own rows only appears when the templates below give it
               something to distinguish them from. */
            <div className="flex flex-col">
              {sorted.length > 0 && (
                <>
                  <DayPill label="Your Characters" className="mb-2" />
                  <div className={gridClass}>{sorted.map(renderCard)}</div>
                </>
              )}
              {templateGroups.map((group, i) => (
                <div key={group.label}>
                  <DayPill
                    label={group.label}
                    className={i === 0 && sorted.length === 0 ? 'mb-2' : 'mb-2 mt-4'}
                  />
                  <div className={gridClass}>{group.models.map(renderCard)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className={gridClass}>{sorted.map(renderCard)}</div>
          )}
        </div>

        {/* Footer — add new (jumps to Bank with create form) + manage */}
        <div className="border-t border-ink/5 px-4 py-3">
          {multiSelect ? (
            <button
              onClick={() => { void handleConfirmMulti() }}
              disabled={selectedIds.length === 0 || adding}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {adding && <Spinner className="h-4 w-4" />}
              Add {selectedIds.length || ''} {selectedIds.length === 1 ? 'item' : 'items'}
            </button>
          ) : !supportsCreate ? (
            <button
              onClick={handleManageInFinder}
              className="flex w-full items-center justify-center gap-1.5 py-2 text-xs text-ink-600 transition-colors hover:text-ink-400"
            >
              <FolderOpen className="h-3 w-3" />
              Manage in Bank
            </button>
          ) : (
            <>
              <button
                onClick={handleAddNew}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink/90"
              >
                <Plus className="h-4 w-4" />
                Add New {label.replace(/s$/, '')}
              </button>
              <button
                onClick={handleManageInFinder}
                className="mt-2 flex w-full items-center justify-center gap-1.5 py-2 text-xs text-ink-600 transition-colors hover:text-ink-400"
              >
                <FolderOpen className="h-3 w-3" />
                Manage in Bank
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )

  return createPortal(picker, portalTarget)
}
