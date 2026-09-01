import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Plus, Check, ChevronDown } from 'lucide-react'
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
import BankSidebar from '../apps/finder/BankSidebar'
import { SectionLabel } from './SectionCard'

// A tile standing in for a template that isn't in the bank yet. Prefixed so
// `handleSelect` can tell one from a real row by its id alone — nothing else
// in the app mints an id with a colon in it.
const TEMPLATE_ID = 'template:'
const templateIdOf = (rowId: string) => rowId.startsWith(TEMPLATE_ID) ? rowId.slice(TEMPLATE_ID.length) : null

type BankItem = AnyBankItem

// How far below the scroll port's top a section heading has to sit before the
// rail stops calling it the one you're looking at.
const SPY_OFFSET = 64
const STYLE_SECTION = 'style:'
// The section a style row points at. "All Styles" (an empty value) points at
// the head of the list, where every look is still ahead of you.
const styleSectionKey = (style: string) => (style ? `${STYLE_SECTION}${style}` : 'bank')

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
  // Gender filters; style does NOT. The style rail is a table of contents over
  // one scroll, exactly as it is over there: clicking a look scrolls to it and
  // the highlight follows the scroll back. Filtering by style was tried first
  // in both places and reads as a set of tabs — it hides the ten other looks
  // the moment you glance at one, when the point of the grid is that you keep
  // scrolling through it.
  const [gender, setGender] = useState('')
  // Which section the scroll is inside: 'bank', or `style:<look>`.
  const [scrolledKey, setScrolledKey] = useState('bank')
  // The row currently being written into the bank ('multi' for a confirmed
  // multi-select), so the tile it was clicked on can say so.
  const [addingId, setAddingId] = useState<string | null>(null)
  const adding = addingId !== null
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

  // The rail down the left is the Bank's own source list (`BankSidebar`),
  // mounted here whenever the picker can reach more than ONE bank — which today
  // means the reference-image pickers, where "a product photo or a character or
  // a saved still" is one question. A single-bank picker gets no rail: one row
  // in a 204px column is a label wearing a control's clothes, and the header
  // already names the bank. Below `lg` the rail doesn't render at all and the
  // segmented strip is the switcher.
  const railBanks = normalizedTabs && normalizedTabs.length > 1 ? normalizedTabs.map((t) => t.type) : null

  // Counts on the rail are what that tab would actually SHOW — the per-tab
  // filter and the caller's filter applied — never the raw bank length. A rail
  // promising 40 b-rolls beside a tab holding the 6 that have a still is worse
  // than no count at all.
  const railCounts = useMemo(() => {
    const out: Record<BankType, number> = { products: 0, models: 0, scripts: 0, voices: 0, brolls: 0, styles: 0, swipes: 0 }
    for (const t of normalizedTabs ?? []) {
      const pool: BankItem[] =
        t.type === 'products' ? productPool :
        t.type === 'models' ? models.filter((m) => !!m.characterImage) :
        t.type === 'scripts' ? scripts :
        t.type === 'voices' ? voices :
        t.type === 'styles' ? styles :
        brolls
      const afterTab = t.filter ? pool.filter(t.filter) : pool
      out[t.type] = (filter ? afterTab.filter(filter) : afterTab).length
    }
    return out
  }, [normalizedTabs, productPool, models, scripts, voices, styles, brolls, filter])

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
    // A template that has already been saved STAYS in its style section — it
    // used to be dropped from the library the moment it was picked, so the face
    // you found under "Desk & Office" was simply not there the next time you
    // went looking for it (it had moved silently into Your Characters at the
    // top). That was invisible while the styles were a dropdown; with the rail
    // it also quietly shrank a section's count on every pick. Picking it again
    // costs nothing — `materialize` re-finds the row it already made rather
    // than making a second one — and the Characters preset picker has always
    // listed a saved starter in both places, so this is the two agreeing.
    const tpl = (templates ?? [])
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
  }, [currentBankType, itemsAfterFilter, templates, currentTabFilter, filter])

  const q = search.trim().toLowerCase()
  const characterPasses = useMemo(() => ({
    q: (r: { search: string }) => !q || r.search.includes(q),
    gender: (r: { gender?: string }) => !gender || r.gender === gender,
  }), [q, gender])

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
    // Style filters nothing any more, so its per-look tallies are taken over
    // everything the other controls leave — which is what the rail is counting.
    const styleRows = all.filter((r) => Object.values(characterPasses).every((fn) => fn(r)))
    // Styles come from the TEMPLATES only, in the library's own order — the
    // shot numbering the build script bakes into the row order — never by
    // count, which would reshuffle the rail between two openings. A style only
    // the member's own rows use would be a row that scrolls nowhere: their
    // characters are ONE section whatever style is guessed off their free text.
    const tplRows = characterPool.tpl.filter((r) => Object.values(characterPasses).every((fn) => fn(r)))
    const order: string[] = []
    for (const r of characterPool.tpl) {
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
      // Each count is the SIZE OF THE SECTION it scrolls to — the templates
      // filed under that style — while "All Styles" carries the whole list,
      // which is what the top of it holds. Counting the member's own rows into
      // each style promised more than the section delivered: a saved template
      // is both a bank row and a library row, so every look it belongs to read
      // one too many.
      styles: [
        { value: '', label: 'All Styles', count: styleRows.length },
        ...order.map((k) => ({
          value: k,
          label: k,
          count: tplRows.filter((r) => r.setting === k).length,
        })),
      ],
    }
  }, [characterPool, characterPasses])

  // The Characters bank gets a rail of its own where a multi-bank picker gets
  // the bank one: the styles were a `Dropdown` on the filter row — eleven looks
  // behind a click, on a panel whose whole job is browsing faces — and the
  // Characters preset picker had already moved the same list down the left.
  // Only one rail at a time: a tabbed picker sitting on its models tab keeps
  // the styles in the menu, because the bank switcher has the better claim on
  // those 204px.
  //
  // It differs from the preset picker's rail in one way, deliberately: there
  // the rail NAVIGATES a single scroll and never filters, here it filters,
  // because that is what this control already did and a picker is a place you
  // narrow down rather than browse. The chrome is `BankSidebar`'s neutral row,
  // not that rail's influencers tint — in this component a rail is as often the
  // bank switcher, and one shape can't be two colours depending on the tab.
  const styleRail = !railBanks && characterFacets ? characterFacets.styles : null

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

  // Every section of the characters scroll, in render order: the member's own
  // rows first, then one per look. The rail reads its highlight out of this and
  // jumps into it — see `jumpToSection`.
  const sections = useMemo(() => {
    if (!characterPool) return []
    const out: string[] = []
    if (filtered.length > 0) out.push('bank')
    for (const g of templateGroups) out.push(styleSectionKey(g.label))
    return out
  }, [characterPool, filtered.length, templateGroups])

  // A key the search or the gender toggle has retired falls back to the FIRST
  // section — which is what the top of a re-filtered list means, and is also
  // the right answer for a bank with nothing in it, whose section isn't there
  // to be scrolled to.
  const currentKey = sections.includes(scrolledKey) ? scrolledKey : sections[0] ?? 'bank'
  // Empty inside the member's own rows: you're in all the looks there, which is
  // what lights "All Styles".
  const scrolledStyle = currentKey.startsWith(STYLE_SECTION) ? currentKey.slice(STYLE_SECTION.length) : ''

  // One node per rendered section, for the spy and the jump.
  const sectionEls = useRef(new Map<string, HTMLDivElement>())
  const gridRef = useRef<HTMLDivElement>(null)

  // The last section whose heading has passed the band below the port's top is
  // the one being looked at. Measured with rects rather than `offsetTop`: the
  // scroller isn't a positioned element, so `offsetTop` is counted from the
  // panel and carries the header and toolbar with it.
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const portTop = el.getBoundingClientRect().top
    let current = sections[0]
    for (const key of sections) {
      const node = sectionEls.current.get(key)
      if (!node) continue
      if (node.getBoundingClientRect().top - portTop > SPY_OFFSET) break
      current = key
    }
    // Only on a real change — this fires on every scroll frame over a list that
    // is eighty-odd cards by the time anyone is scrolling it this far.
    if (current && current !== scrolledKey) setScrolledKey(current)
  }

  const jumpToSection = (key: string) => {
    // The first section is simply the top — no measuring, and it is also what
    // "All Styles" means once nothing filters: the whole list, from the start.
    if (key === 'bank' || key === sections[0]) {
      setScrolledKey(sections[0] ?? 'bank')
      if (gridRef.current) gridRef.current.scrollTop = 0
      return
    }
    const el = gridRef.current
    const node = sectionEls.current.get(key)
    if (!el || !node) return
    // The spy corrects this once the scroll lands; setting it here only saves a
    // frame of the old highlight.
    setScrolledKey(key)
    el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - 12
  }

  // B-Rolls and Scripts are day-grouped under a date pill, exactly as the Bank
  // browser shows them — a still is recognised by when it was shot and a script
  // by the session it was written in, and the picker is where you go looking
  // for "the one from yesterday". `groupByDay` is newest-day-first; flip it when
  // the user sorts oldest-first. A NAME sort has no days to group by, so those
  // banks fall back to the flat grid (B-Rolls can't reach that — it sorts by
  // date only — but Scripts can).
  const dayGroups = useMemo(() => {
    if (currentBankType !== 'brolls' && currentBankType !== 'scripts') return null
    if (sort !== 'newest' && sort !== 'oldest') return null
    const groups = groupByDay(sorted, (item) => (item as BRoll | Script).createdAt)
    return sort === 'oldest' ? groups.reverse() : groups
  }, [sorted, sort, currentBankType])

  // Everything with a thumbnail (influencers, products, b-rolls, scripts) packs
  // into the same dense grid the main Bank uses — `grid-flow-row-dense`
  // backfills the hole a wide card leaves. Voices are text rows, so they stay
  // single-column. THREE columns on a phone (August 2026, Massimo's call): it
  // showed two, on the theory that a third tile would be unreadable, but these
  // are 9:16 portraits with the name written across them — at ~112px they still
  // read, and two-up meant a 390px sheet showed four characters in a screen and
  // a half of scrolling when the point of the picker is recognising one on
  // sight. It climbs from there because the picker is a centred modal now
  // rather than a 560px drawer: three columns across ~900px of content would
  // draw each tile at nearly 300px, which is a gallery, not a picker. The
  // ladder is the Characters preset picker's, unchanged — with the rail
  // appearing at the same `lg` it does there, every tile in both lands at
  // ~150px at every width, and two pickers a click apart read as one thing.
  const gridClass =
    currentBankType === 'voices'
      ? 'flex flex-col gap-2'
      : 'grid grid-flow-row-dense grid-cols-3 items-start gap-2.5 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6'

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
      setScrolledKey('bank')
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
    // A saved template is listed twice — once in its style section, once under
    // Your Characters — and both tiles resolve to the same bank row, so a
    // selection spanning the pair would otherwise add that character twice.
    const seen = new Set<string>()
    const unique: BankItem[] = []
    for (const it of picked) {
      if (seen.has(it.id)) continue
      seen.add(it.id)
      unique.push(it)
    }
    onSelectMany(unique)
    onClose()
  }

  // Jump to the Bank app with the create form for this bank pre-opened.
  // Finder consumes `openCreate` (see Finder.tsx) to switch bank + open form.
  const handleAddNew = () => {
    onClose()
    sendToApp({ targetApp: 'finder', targetField: 'openCreate', data: currentBankType })
    openApp('finder')
  }

  const label = BANK_CONFIG[currentBankType].label

  // Render through a portal so the picker is parented at document root,
  // not inside whichever caller mounts it. This sidesteps the
  // backdrop-filter / transform containing-block trap (callers with those
  // styles otherwise pin our `position: fixed` to themselves).
  const portalTarget = typeof document !== 'undefined' ? document.body : null
  if (!portalTarget) return null

  // Switching bank resets only the per-tab view state (search, sort, facets) —
  // the running multi-select is deliberately kept, so refs can be gathered from
  // several banks and added in one go.
  const switchBank = (t: BankType) => { setActiveTab(t); setSearch(''); setSort('newest'); setGender(''); setScrolledKey('bank') }

  const picker = (
    <>
      {/* Backdrop — z-[70] keeps the picker above the sidebar (z-40) and
          above the B-Roll CardDetailModal (z-[60]) when opened from within.
          A childless sibling, so a text-selection drag released over it can't
          be the `click` that closes the panel — see hooks/useBackdropClose. */}
      <div
        className={`fixed inset-0 z-[70] bg-black/50 transition-opacity duration-200 ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Centring wrapper. `pointer-events-none` so a click that misses the
          panel still lands on the backdrop underneath and closes it. */}
      <div className="pointer-events-none fixed inset-0 z-[80] flex items-end justify-center md:items-center md:p-4">
        {/* Panel. A centred modal from `md` up (Massimo's call, September 2026)
            rather than the 560px drawer this was: the picker is where a member
            recognises a saved thing on sight, and a drawer that narrow makes
            that a scroll. Wide enough for the Bank's own layout — the rail down
            the left, search and sort across the top, day pills through the grid
            — because the point is that picking from a bank and browsing one are
            the same act. On a phone it stays a bottom sheet: 204px of rail is
            more than half the screen, and one thing at a time is the rule. */}
        <div
          className={`pointer-events-auto flex w-full flex-col overflow-hidden border-ink/5 bg-surface-1/95 backdrop-blur-2xl ${
            isDesktop
              ? `h-[86vh] max-w-6xl rounded-3xl border shadow-2xl shadow-black/40 transition-all duration-200 ease-out ${
                  isOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.98] opacity-0'
                }`
              : `h-[calc(100%-3.5rem)] rounded-t-2xl border-t transition-transform duration-300 ease-out ${
                  isOpen ? 'translate-y-0' : 'translate-y-full'
                }`
          }`}
        >
        {/* Drag handle — mobile only */}
        {!isDesktop && (
          <div className="flex justify-center pt-2 pb-1">
            <div className="h-1 w-10 rounded-full bg-ink/20" />
          </div>
        )}
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-ink/5 px-5 py-3.5">
          <h3 className="text-sm font-semibold tracking-tight text-ink-200">
            Select {railBanks ? 'from Bank' : label.replace(/s$/, '')}
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-2 lg:p-1 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
        {/* The Bank's own source list, from `md` up. Below that it doesn't
            render and the segmented strip below is the switcher. */}
        {styleRail && (
          <div className="hidden w-[204px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-ink/5 px-3 py-4 lg:flex">
            <div className="flex flex-col gap-0.5">
              <SectionLabel label="Style" className="px-3 pb-1.5" />
              {styleRail.map((o) => {
                const active = o.value === scrolledStyle
                return (
                  <button
                    key={o.value || 'all'}
                    type="button"
                    onClick={() => jumpToSection(styleSectionKey(o.value))}
                    title={o.label}
                    aria-pressed={active}
                    className={`flex w-full items-center gap-2 rounded-full px-3 py-[7px] text-left text-[12.5px] transition-colors ${
                      active
                        ? 'bg-ink/[0.07] font-medium text-ink-100 ring-1 ring-inset ring-ink/10'
                        : 'text-ink-500 hover:bg-ink/5 hover:text-ink-300'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className={`shrink-0 text-[11px] ${active ? 'text-ink-400' : 'text-ink-600'}`}>
                      <CountSlot value={o.count ?? 0} />
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {railBanks && (
          <BankSidebar
            banks={railBanks}
            active={currentBankType}
            counts={railCounts}
            onSelect={switchBank}
            showFrom="lg"
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
        {/* The rail's stand-in below `lg`, where there is no room for 204px of
            rail beside a grid of faces. */}
        {railBanks && (
          <div className="flex items-center border-b border-ink/5 px-4 py-3 lg:hidden">
            <SegmentedToggle<BankType>
              value={currentBankType}
              onChange={switchBank}
              options={railBanks.map((t) => ({ value: t, label: BANK_CONFIG[t].label }))}
              dense
            />
          </div>
        )}

        {/* ONE toolbar row — search, then everything that narrows what it
            searches, then sort. The gender toggle and the styles menu had a
            band of their own under this one, which put two rows of chrome
            between the modal's title and the first face; they wrap onto a
            second line only when the width genuinely can't hold them. The sort
            dropdown is hidden for banks the Bank doesn't sort (voices). */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink/5 px-4 py-3">
          <div className="flex h-10 min-w-[180px] flex-1 items-center gap-2 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-600" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full bg-transparent text-sm text-ink-200 placeholder-ink-600 outline-none"
            />
          </div>
          {/* Gender stays a toggle — three options, all worth seeing without a
              click. The styles menu is the rail's stand-in below `lg`, at a
              FIXED width: its label swings from "All Styles" to "Holding
              Product", and a trigger that resized itself would shove the
              toggle along the row on every pick. */}
          {characterFacets && (
            <SegmentedToggle
              value={gender}
              onChange={setGender}
              options={characterFacets.genders}
              className="shrink-0"
              fitContent
              dense
            />
          )}
          {characterFacets && (
            <div className={`w-[190px] shrink-0 ${styleRail ? 'lg:hidden' : ''}`}>
              <Dropdown
                value={scrolledStyle}
                onChange={(v) => jumpToSection(styleSectionKey(v))}
                options={characterFacets.styles}
                tier="panel"
                dense
              />
            </div>
          )}
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
          {/* Add New rides the toolbar, in the Bank's own Add position and at
              the Bank's own weight — it belongs beside sort, not on a slab
              across the bottom, where a full-width primary button was the
              loudest thing in a modal whose job is picking one of the rows
              above it. Not offered in multi-select: the footer's Add N is that
              mode's action, and leaving for a form would abandon the
              selection. */}
          {!multiSelect && supportsCreate && (
            <button
              type="button"
              onClick={handleAddNew}
              // The Bank's own Add button, and the same 40px pill as the search
              // box and the sort menu beside it — the solid fill is what marks
              // it as the row's one action rather than another filter, and the
              // shared height is what keeps it from reading as a bigger
              // control. `ml-auto` is a no-op while the row fits on one line
              // (the search box's `flex-1` has already eaten the slack) and
              // right-aligns the button on the line it wraps onto, so it stays
              // under sort rather than stranded at the left margin.
              className="ml-auto flex h-10 shrink-0 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium tracking-tight text-ink-900 transition-colors hover:bg-ink-100"
            >
              <Plus className="h-4 w-4" />
              Add New {label.replace(/s$/, '')}
            </button>
          )}
        </div>

        {/* Item list */}
        <div ref={gridRef} onScroll={characterFacets ? handleScroll : undefined} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {sorted.length === 0 && templateGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <span className="text-sm text-ink-600">
                {search ? 'No matches found' : `No ${label.toLowerCase()} yet`}
              </span>
              <span className="text-xs text-ink-700">
                {search ? 'Try a different search' : supportsCreate ? 'Add one above to get started' : 'Save one from the app that makes them'}
              </span>
            </div>
          ) : dayGroups ? (
            <div className="flex flex-col">
              {dayGroups.map(([dayTs, dayItems]) => (
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
                <div ref={(el) => { if (el) sectionEls.current.set('bank', el); else sectionEls.current.delete('bank') }}>
                  <DayPill label="Your Characters" className="mb-2" />
                  <div className={gridClass}>{sorted.map(renderCard)}</div>
                </div>
              )}
              {templateGroups.map((group, i) => (
                <div
                  key={group.label}
                  ref={(el) => {
                    const key = styleSectionKey(group.label)
                    if (el) sectionEls.current.set(key, el)
                    else sectionEls.current.delete(key)
                  }}
                >
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

        {/* Footer — the multi-select confirm, and nothing else. A single-select
            picker has no footer at all now: its Add New sits in the toolbar,
            and "Manage in Bank" was a second way out of a modal that already
            has a close button and a dock tile (Massimo's call, September
            2026). */}
        {multiSelect && (
          <div className="border-t border-ink/5 px-4 py-3">
            <button
              onClick={() => { void handleConfirmMulti() }}
              disabled={selectedIds.length === 0 || adding}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {adding && <Spinner className="h-4 w-4" />}
              Add {selectedIds.length || ''} {selectedIds.length === 1 ? 'item' : 'items'}
            </button>
          </div>
        )}
        </div>
        </div>
        </div>
      </div>
    </>
  )

  return createPortal(picker, portalTarget)
}
