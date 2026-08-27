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
import DayPill from './DayPill'
import { groupByDay, sectionLabel } from '../utils/history'

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

  const filtered = search.trim()
    ? itemsAfterFilter.filter((item) =>
        getItemName(currentBankType, item).toLowerCase().includes(search.toLowerCase())
      )
    : itemsAfterFilter

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

  const handleSelect = (item: BankItem) => {
    if (multiSelect) {
      setSelectedIds((prev) =>
        prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
      )
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

  const handleConfirmMulti = () => {
    if (!onSelectMany || selectedIds.length === 0) return
    // Resolve selected ids across *every* bank the picker can switch between
    // (not just the current tab) so a selection spanning multiple tabs is added
    // in one go. Ids are global UUIDs, so a flat id→item map is unambiguous;
    // selection order is preserved by walking selectedIds.
    const tabTypes: BankType[] = normalizedTabs ? normalizedTabs.map((t) => t.type) : [bankType]
    const byId = new Map<string, BankItem>()
    for (const t of tabTypes) for (const it of poolFor(t)) byId.set(it.id, it)
    const picked = selectedIds.map((id) => byId.get(id)).filter((x): x is BankItem => !!x)
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
              onChange={(t) => { setActiveTab(t); setSearch(''); setSort('newest') }}
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

        {/* Item list */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {sorted.length === 0 ? (
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
          ) : (
            <div className={gridClass}>{sorted.map(renderCard)}</div>
          )}
        </div>

        {/* Footer — add new (jumps to Bank with create form) + manage */}
        <div className="border-t border-ink/5 px-4 py-3">
          {multiSelect ? (
            <button
              onClick={handleConfirmMulti}
              disabled={selectedIds.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
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
