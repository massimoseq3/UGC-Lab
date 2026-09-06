import { useEffect, useMemo, useRef, useState } from 'react'
import type { ElementType } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Sparkle, Star, UserRound, Images, Bookmark, Check } from 'lucide-react'
import type { CharacterProfile } from '../types'
import type { Model } from '../../../stores/types'
import { useBankStore } from '../../../stores/bankStore'
import { useAppStore } from '../../../stores/appStore'
import { humanizeError } from '../../../utils/friendlyError'
import { TileActionButton, TileActionStack } from '../../../components/tileActions'
import { sortByOrder, starredFirst } from '../../finder/bankSort'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useBackdropClose } from '../../../hooks/useBackdropClose'
import Dropdown from '../../../components/Dropdown'
import SegmentedToggle from '../../../components/SegmentedToggle'
import Spinner from '../../../components/Spinner'
import DayPill from '../../../components/DayPill'
import CountSlot from '../../../components/CountSlot'
import { SectionLabel } from '../../../components/SectionCard'
import {
  flattenJsonProfile,
  loadStarterPresets,
  saveStarterToBank,
  starterThumbUrl,
  buildSearch,
  genderBucket,
  settingFromProfile,
  type StarterRow,
} from '../presets/service'

// How many cards render on open, and how many more each time the sentinel at
// the foot of the grid comes into view. 76 starters plus a working member's
// bank is a few hundred portraits, each one an image decode — rendering the
// lot on open costs a visible hitch on a modal whose whole job is to appear
// instantly.
const PAGE = 30

// How close to the top of the scroll port a section's heading has to come
// before the rail calls it the one you're in. Sections are a row of cards tall
// at minimum, so a fixed band reads the same on every list — the Ad Analyzer's
// own scroll-spy uses a proportion of its port for the same job.
const SPY_OFFSET = 64

/**
 * How far a section's top sits below the top of its scroll port, in px.
 *
 * `Infinity` when the section isn't rendered — a jump that has just raised the
 * page count then simply doesn't move, rather than scrolling somewhere it
 * measured against nothing.
 */
function sectionTopWithin(port: HTMLElement, section: HTMLElement | null): number {
  if (!section) return Infinity
  return section.getBoundingClientRect().top - port.getBoundingClientRect().top
}

// One card's worth of anything pickable — a starter shipped with the app, or a
// character out of the member's own bank. The grid doesn't care which; the two
// differ only in where the cover comes from (a bundled URL vs an asset ref).
type Source = 'bank' | 'starter'

interface Entry {
  key: string
  name: string
  // Starters only — the descriptive name behind the scene-and-gender label.
  title?: string
  source: Source
  // Starters only — the library row, so the card can copy it into the bank.
  starter?: StarterRow
  imageUrl?: string
  imageRef?: string
  note?: string
  starred?: boolean
  profile: Record<string, string>
  search: string
  gender?: string
  setting?: string
}

/**
 * The key of the section an entry belongs to.
 *
 * Your own characters are ONE section whatever their style — it's keyword-
 * guessed off free text and plenty of rows have none, so grouping those would
 * file the same face under a different heading each time it was extracted.
 * Templates carry a curated style, so they get one section each.
 */
function sectionKey(e: Entry): string {
  return e.source === 'bank' ? 'bank' : `style:${e.setting || 'Other'}`
}

// The section a style row points at. "All Styles" (an empty value) points at
// the head of the list, which is where every style is still ahead of you.
function styleSectionKey(style: string): string {
  return style ? `style:${style}` : 'bank'
}

// The Bank's own character card at a smaller size: a 9:16 cover under a
// gradient with the name across it. Small enough to fit six to a row, which is
// what makes browsing 81 faces a scan rather than a scroll.
//
// A `div` wrapping a full-bleed button rather than a button outright, because a
// template card carries a Save action of its own and a button inside a button
// is not a thing the DOM has.
function PresetCard({ entry, savedId, onClick }: {
  entry: Entry
  savedId?: string
  onClick: () => void
}) {
  // Starters pass a bundled thumb URL; bank rows pass an asset:// ref resolved
  // through IndexedDB. Prefer the direct URL when present.
  const assetUrl = useAssetUrl(entry.imageRef)
  const url = entry.imageUrl ?? assetUrl
  return (
    <div className="group relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-ink/5 bg-ink/[0.03] transition-all hover:border-influencers-500/40 card-soft-shadow">
      <button
        type="button"
        onClick={onClick}
        title={[entry.title, entry.note].filter(Boolean).join(' · ') || entry.name}
        className="absolute inset-0 block h-full w-full"
      >
        {url ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/[0.04]">
            <Sparkle className="h-5 w-5 text-ink-700" strokeWidth={1.5} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2 pt-6">
          <span className="block truncate text-center text-[11px] font-semibold tracking-tight text-zinc-100">{entry.name}</span>
        </div>
      </button>
      {entry.starred && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-amber-300">
          <Star className="h-3 w-3 fill-current" strokeWidth={2} />
        </span>
      )}
      {entry.starter && <StarterSaveAction row={entry.starter} savedId={savedId} />}
    </div>
  )
}

/**
 * Copies a template into the Characters bank, from the card.
 *
 * The templates are static files the picker owns, so until this existed a
 * member could load a face into the form and still not attach that face
 * anywhere else — the DNA travelled and the picture didn't. A bank row is the
 * app's own answer to "use this character elsewhere": it shows up in every
 * `BankPicker`, so one click makes the portrait attachable in Playground,
 * B-Roll and Scripts by the route a generated character already takes.
 *
 * Saved state is read off the bank rather than kept here, so it survives the
 * modal closing and reads the same on both scoped pickers.
 */
function StarterSaveAction({ row, savedId }: { row: StarterRow; savedId?: string }) {
  const [saving, setSaving] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const saved = !!savedId

  const save = async () => {
    if (saving || saved) return
    setSaving(true)
    try {
      await saveStarterToBank(row)
    } catch (err) {
      addToast(humanizeError(err, 'Could not save that character to the Bank.'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <TileActionStack forceVisible={saving || saved}>
      <TileActionButton
        title={
          saved
            ? 'Already in your Characters. Pick it in Playground, B-Roll or any character picker'
            : 'Save to Characters, then use this face in Playground, B-Roll or any character picker'
        }
        tone={saved ? 'saved' : 'default'}
        disabled={saving}
        onClick={() => { void save() }}
      >
        {saving ? <Spinner className="h-4 w-4" /> : saved ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
      </TileActionButton>
    </TileActionStack>
  )
}

/**
 * One row of the left rail: a place in the grid, its size, and whether you're
 * in it.
 *
 * The two blocks read as one control because every row does the same thing —
 * what separates them is the heading above and the icon the library rows
 * carry. The count rides in a `CountSlot` for the reason the old filter bar
 * needed one: these tallies are live (search and gender move them), and a
 * number that sized itself would shift the row's own label under the pointer.
 */
function RailRow({ label, count, active, icon: Icon, onClick }: {
  label: string
  count: number
  active: boolean
  icon?: ElementType
  onClick: () => void
}) {
  // A section a search has emptied has nowhere to scroll to. It stays in the
  // rail — a row that vanished at zero would move the rest under the pointer,
  // and the count answers "why is there nothing there" outright — but it stops
  // looking clickable, because it isn't.
  const empty = count === 0
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={empty}
      title={label}
      aria-pressed={active}
      className={`flex w-full items-center gap-2 rounded-full px-3 py-[7px] text-left text-[12.5px] transition-colors ${
        active
          ? 'bg-influencers-500/10 font-medium text-influencers-300 ring-1 ring-inset ring-influencers-500/15'
          : empty
            ? 'text-ink-700'
            : 'text-ink-500 hover:bg-ink/5 hover:text-ink-300'
      }`}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={`shrink-0 text-[11px] ${active ? 'text-influencers-300/70' : 'text-ink-600'}`}>
        <CountSlot value={count} />
      </span>
    </button>
  )
}

/**
 * The centred preset browser — the starters shipped with the app and the
 * member's own saved characters in one scrolling grid.
 *
 * It was a 380px right slide-over, which is the wrong shape for a picture
 * library: three faces across meant the starters alone ran past a screen, and
 * a member's own characters were only reachable by scrolling past every
 * built-in. A centred modal gets six across at a size a face is still
 * judgeable at and pages the grid in as you scroll rather than mounting a few
 * hundred image decodes on open.
 *
 * The two libraries are ONE scroll, in two labelled sections — your own
 * characters, then the templates (Massimo's call, August 2026). They were a
 * toggle that swapped the grid for a while, on the theory that a member with
 * 35 characters shouldn't scroll past all of them to reach a template; the
 * jump below is the cheaper answer to that, and it keeps everything the picker
 * holds in one list you can simply keep scrolling. The toggle stays, as a JUMP
 * with a count on each side: clicking scrolls to that section (pulling in
 * enough pages to reach it first), and the highlight follows the scroll rather
 * than the other way round.
 *
 * Calls `onPick` with the chosen recipe as a flat profile map, then closes.
 * Callers decide what to do with that map: apply it wholesale
 * (LoadPresetDropdown) or merge only a subset of keys (the scoped Physical /
 * Scene & Pose preset buttons in ControlsPanel).
 *
 * **Mount it only while it's open.** Every caller does, and the browsing state
 * — the page count and which section the rail is lit on — is per-opening
 * because of that, with no effect resetting anything. Left mounted behind
 * `open={false}` it keeps that state while its scroller does not (a new one
 * starts at the top), so the rail lit the section you left off in while the
 * grid showed the first, and the page count stayed wherever the last visit had
 * raised it — the hitch `PAGE` exists to avoid. The starter library is cached
 * in `presets/service.ts`, so reopening re-fetches nothing.
 */
export default function PresetPickerModal({
  open,
  onClose,
  onPick,
  title = 'Character Presets',
  // No default: the scoped callers pass a subtitle that says which part of the
  // form a pick fills, which is worth a line. The unscoped one had "Pick a
  // recipe to fill the form" under "Character Presets" — a second reading of
  // the title (Massimo's call, September 2026).
  subtitle,
}: {
  open: boolean
  onClose: () => void
  onPick: (profile: Record<string, string>) => void
  title?: string
  subtitle?: string
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  const backdrop = useBackdropClose(onClose)
  useCloseOnEscape(open, onClose)
  useCloseOnAppSwitch(open, onClose)

  const bankModels = useBankStore((s) => s.models)
  const [starters, setStarters] = useState<StarterRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [search, setSearch] = useState('')
  // Which SECTION the scroll is currently in, by key ('bank' / 'style:Car').
  // The rail reads where you are out of this — both blocks of it — and it
  // follows the scroller (see `handleScroll`), never the other way round, so
  // the rail and the grid can't disagree about what's on screen.
  const [scrolledKey, setScrolledKey] = useState('bank')
  const [gender, setGender] = useState('')
  const [visible, setVisible] = useState(PAGE)

  // The library is fetched on first open, not on mount — nothing pays for
  // 235KB of JSON until the picker is actually used.
  useEffect(() => {
    if (!open) return
    let live = true
    loadStarterPresets().then(
      (rows) => { if (live) { setStarters(rows); setLoadError(null) } },
      (e: unknown) => { if (live) setLoadError(e instanceof Error ? e.message : 'Could not load the starter presets.') },
    )
    return () => { live = false }
  }, [open, reloadKey])

  // Saved characters, newest first with starred on top — the same two helpers
  // every bank picker sorts with. The store holds them in raw insertion order,
  // so without this the character you saved last sits at the bottom.
  const bankEntries = useMemo<Entry[]>(() => {
    const rows = bankModels.filter((m: Model) => m.jsonProfile)
    return starredFirst(sortByOrder(rows, 'newest')).map((m) => {
      const profile = flattenJsonProfile(m.jsonProfile)
      return {
        key: `bank-${m.id}`,
        name: m.name,
        source: 'bank' as const,
        imageRef: m.characterImage,
        starred: m.starred,
        profile,
        search: buildSearch([m.name], profile),
        gender: genderBucket(profile.gender ?? ''),
        setting: settingFromProfile(profile),
      }
    })
  }, [bankModels])

  // Which templates are already saved, by preset id. Read off the bank so the
  // green tick survives the modal closing and reads the same on all three
  // pickers that open this component.
  const savedStarters = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of bankModels) if (m.presetId) map.set(m.presetId, m.id)
    return map
  }, [bankModels])

  const starterEntries = useMemo<Entry[]>(() => (starters ?? []).map((s) => ({
    key: `starter-${s.id}`,
    name: s.name,
    title: s.title,
    source: 'starter' as const,
    starter: s,
    imageUrl: starterThumbUrl(s.id),
    note: s.note,
    profile: s.profile,
    search: s.search,
    gender: genderBucket(s.gender),
    setting: s.setting,
  })), [starters])

  // Bank first — your own characters are what you came for more often than a
  // starter is — then the starters in the order the library ships them.
  const all = useMemo(() => [...bankEntries, ...starterEntries], [bankEntries, starterEntries])

  // Facets are DERIVED from the rows rather than hardcoded, so a library that
  // grows a new scene grows the filter on its own — and each facet's counts are
  // taken against the OTHER active filters, so "Medium 45" can never sit above
  // a result of 15. An option nothing would match drops out of its menu, which
  // makes an empty grid unreachable except by search; the one that's currently
  // picked always stays, or the control would lose the value it's showing.
  const q = search.trim().toLowerCase()
  const passes = useMemo(() => ({
    q: (e: Entry) => !q || e.search.includes(q),
    gender: (e: Entry) => !gender || e.gender === gender,
  }), [q, gender])

  // The style options, in the LIBRARY's own order — the order the source folder
  // numbers its shot categories in, which the build script bakes into the row
  // order. Sorting them by count instead (the obvious thing) reorders the whole
  // list every time another filter changes the tallies, so the option you were
  // about to click moves out from under the pointer. A style only the member's
  // own characters use is appended rather than dropped.
  //
  // The rows call it `setting` and always will — that's the build script's own
  // word for the shot category. The MEMBER's word for it is Style (Massimo's
  // call, August 2026): "Handheld Mic" and "Talking Head" are how a shot is
  // shot, not where it is, and the two the library really does name by place
  // (Kitchen, Car) are still styles of UGC ad.
  // Templates only. A style is a place in the list now, and only the templates
  // are filed into one — your own characters are a single section whatever
  // their keyword-guessed style, so a style none of the templates use would be
  // a row that scrolls nowhere.
  const styleOrder = useMemo(() => {
    const seen: string[] = []
    for (const e of starterEntries) {
      if (e.setting && !seen.includes(e.setting)) seen.push(e.setting)
    }
    return seen
  }, [starterEntries])

  // Bank rows first, then the templates in the library's own order — which the
  // build script already sorts by style, so each style's rows are contiguous
  // and `sections` below can split on a change rather than re-bucket.
  const filtered = useMemo(
    () => all.filter((e) => Object.values(passes).every((fn) => fn(e))),
    [all, passes],
  )

  // Each badge is its section's own row count, under every active filter —
  // with both sections in one list there is nothing left for it to mean. (It
  // used to skip the style filter, because that facet belonged to the side the
  // toggle wasn't showing; now the same list carries both.)
  const sourceOptions = useMemo(() => {
    const count = (k: Source) => filtered.filter((e) => e.source === k).length
    return [
      {
        value: 'bank' as Source,
        // Shortened below `sm` rather than shrinking the control: at 375px the
        // segment has ~145px for an icon, a label and a count, and the full
        // wording rendered as "Your Chara…". Two spans, no JS media query.
        label: (
          <>
            <span className="sm:hidden">Yours</span>
            <span className="hidden sm:inline">Your Characters</span>
          </>
        ),
        icon: UserRound,
        badge: <CountSlot value={count('bank')} />,
      },
      { value: 'starter' as Source, label: 'Templates', icon: Images, badge: <CountSlot value={count('starter')} /> },
    ]
  }, [filtered])

  const facets = useMemo(() => {
    // Rows passing every filter but this one — the pool each facet counts in,
    // and the number its "All" segment carries.
    const pool = (except: keyof typeof passes) =>
      all.filter((e) => Object.entries(passes).every(([k, fn]) => k === except || fn(e)))

    // A toggle always shows all of its segments, counts and all: one that
    // vanished on hitting zero would move the control under the pointer, and a
    // badge reading 0 answers "why is there nothing here" outright.
    const segments = (except: keyof typeof passes, order: string[], pick: (e: Entry) => string | undefined) => {
      const rows = pool(except)
      return [
        { value: '', label: 'All', badge: <CountSlot value={rows.length} /> },
        ...order.map((k) => ({ value: k, label: k, badge: <CountSlot value={rows.filter((e) => pick(e) === k).length} /> })),
      ]
    }

    // The styles keep the same two rules as the toggle: the library's own
    // order, and every option always present. Sorting by count instead (the
    // obvious thing) would reshuffle the whole list every time a search
    // changed the tallies, so the row you were about to click moves out from
    // under the pointer.
    //
    // Each count is the SIZE OF THE SECTION it scrolls to — the templates
    // under that style, since your own characters are one section of their
    // own — and "All Styles" carries the whole list, which is what the top of
    // it holds. A style at 0 has no section this run and simply doesn't move
    // the scroll; the count is what says so before you click it.
    const styleRows = all.filter((e) => Object.values(passes).every((fn) => fn(e)))
    return {
      genders: segments('gender', ['Female', 'Male'], (e) => e.gender),
      styles: [
        { value: '', label: 'All Styles', count: styleRows.length },
        ...styleOrder.map((k) => ({
          value: k,
          label: k,
          count: styleRows.filter((e) => e.source === 'starter' && e.setting === k).length,
        })),
      ],
    }
  }, [all, passes, styleOrder])

  const shown = filtered.slice(0, visible)

  // The page, cut into its labelled runs. A member's own characters are ONE
  // group — their style is keyword-guessed off free text and plenty of them
  // have none, so grouping those would file the same face under a different
  // heading each time it was extracted. The templates carry a curated style, so
  // they get one group each ("Handheld Mic", "Car"), which is what makes a
  // library of 81 scannable in a single scroll (Massimo's call, August 2026).
  // Split on a change of key rather than bucketed, so a group can never be
  // rendered before the rows above it have paged in.
  const sections = useMemo(() => {
    const out: Array<{ key: string; label: string; source: Source; entries: Entry[] }> = []
    for (const e of shown) {
      const key = sectionKey(e)
      const last = out[out.length - 1]
      if (last?.key === key) last.entries.push(e)
      else out.push({
        key,
        label: e.source === 'bank' ? 'Your Characters' : e.setting || 'Other',
        source: e.source,
        entries: [e],
      })
    }
    return out
  }, [shown])

  const bankCount = useMemo(() => filtered.filter((e) => e.source === 'bank').length, [filtered])

  // Every rendered section, by key, for the spy and the jump. A map rather
  // than a ref per section because the list of sections is itself derived —
  // a filter or another page changes which ones exist.
  const sectionEls = useRef(new Map<string, HTMLDivElement>())

  // Where the templates start. Taken off `filtered` rather than off the DOM,
  // so the jump knows its target before the rows it has to scroll past have
  // been paged in.
  const firstStarterKey = useMemo(() => {
    const first = filtered.find((e) => e.source === 'starter')
    return first ? sectionKey(first) : null
  }, [filtered])

  // The section actually on screen. The tracker holds a key that a filter can
  // retire (its section stops being rendered), so an unknown one falls back to
  // the FIRST section — which is what the top of a re-filtered list means, and
  // is also the right answer for an empty bank, whose section simply isn't
  // there to be scrolled into.
  const currentKey = sections.some((sec) => sec.key === scrolledKey) ? scrolledKey : sections[0]?.key ?? 'bank'
  const section: Source = currentKey === 'bank' ? 'bank' : 'starter'
  // Which style the scroll is inside, for the rail. Empty in the bank's own
  // section — you're in all of them there, which is what lights "All Styles".
  const scrolledStyle = currentKey.startsWith('style:') ? currentKey.slice('style:'.length) : ''

  // Infinite scroll: the next page is pulled in once the grid is within a
  // screenful of its end, so it's already rendered by the time the last row
  // is. A plain scroll handler rather than an IntersectionObserver on a
  // sentinel — the arithmetic is two subtractions, and it can be reasoned
  // about (and watched) without a second async system in the middle. It also
  // keeps working through a section list that changes under it, which an
  // observer would have to be re-subscribed for on every filter and page.
  //
  // The same handler moves the rail's highlight, so the rail can only ever
  // report where the scroll actually is.
  const hasMore = shown.length < filtered.length
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (hasMore && el.scrollHeight - el.scrollTop - el.clientHeight < 500) setVisible((n) => n + PAGE)
    // The last section whose heading has passed the band below the port's top
    // is the one being looked at. Measured with rects, not `offsetTop`: the
    // scroller is not a positioned element, so a section's `offsetTop` is
    // counted from the modal panel and carries the header + filter bar with it
    // — about a row of cards' worth of error, which is exactly how far the jump
    // used to overshoot. Tops only increase down the list, so the walk stops at
    // the first section still below the band.
    const portTop = el.getBoundingClientRect().top
    let current = sections[0]?.key
    for (const sec of sections) {
      const node = sectionEls.current.get(sec.key)
      if (!node) continue
      if (node.getBoundingClientRect().top - portTop > SPY_OFFSET) break
      current = sec.key
    }
    // Only on a real change: this fires on every scroll frame, over a list that
    // is a few hundred cards by the time anyone is scrolling it far enough to
    // move the highlight.
    if (current && current !== scrolledKey) setScrolledKey(current)
  }

  // Narrowing the list starts it from the top again — otherwise a filter
  // applied after scrolling to card 200 renders 200 cards of a 12-card result.
  // Done on the way in rather than in an effect watching the filters, which
  // would render the long list once before cutting it back.
  const refilter = <T,>(set: (v: T) => void) => (value: T) => {
    set(value)
    setVisible(PAGE)
    // Whatever the new first section turns out to be — `currentKey` resolves an
    // unknown key to it, so a style whose section this filter just retired
    // can't stay lit.
    setScrolledKey('bank')
    if (gridRef.current) gridRef.current.scrollTop = 0
  }

  /**
   * Scrolls to a section, paging the grid in far enough to reach it first.
   *
   * Every rail row and the phone menu land here: the rail is a table of
   * contents, so nothing on it filters — it moves the ONE scroll (Massimo's
   * call, August 2026). Filtering by style was tried first and reads as a set
   * of tabs, which is the opposite of a library you browse: it hides the
   * eleven other looks the moment you glance at one.
   *
   * A section that isn't rendered yet can't be measured, hence the two steps:
   * the page count is raised to cover the target's index (the position is
   * taken off `filtered`, which knows the whole list, not off the DOM), then
   * the scroll waits for React to lay the rows out. `scrollTop` set against a
   * list that hasn't grown yet just clamps to the old bottom, and a jump that
   * measured against nothing would scroll to the end — so the measure retries
   * for a few frames rather than firing blind.
   */
  const scrollToSection = (key: string, tries = 3) => {
    requestAnimationFrame(() => {
      const el = gridRef.current
      if (!el) return
      const node = sectionEls.current.get(key)
      if (!node) {
        if (tries > 0) scrollToSection(key, tries - 1)
        return
      }
      el.scrollTop += sectionTopWithin(el, node) - 12
    })
  }

  const jumpToSection = (key: string) => {
    // The first section is simply the top — no measuring, and it's also what
    // "All Styles" means once nothing filters: the whole list, from the start.
    if (key === 'bank' || key === sections[0]?.key) {
      setScrolledKey(key)
      if (gridRef.current) gridRef.current.scrollTop = 0
      return
    }
    const index = filtered.findIndex((e) => sectionKey(e) === key)
    if (index < 0) return
    setVisible((n) => Math.max(n, index + PAGE))
    // The spy corrects this once the scroll lands; setting it here only saves a
    // frame of the old highlight.
    setScrolledKey(key)
    scrollToSection(key)
  }

  // The library toggle jumps to the same two places the rail's top block does.
  const jumpTo = (value: Source) => jumpToSection(value === 'bank' ? 'bank' : firstStarterKey ?? 'bank')

  const pick = (profile: Record<string, string> | CharacterProfile) => {
    onPick(profile)
    onClose()
  }

  const portalTarget = typeof document !== 'undefined' ? document.body : null
  if (!open || !portalTarget) return null

  const grid = 'grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6'

  return createPortal(
    // z-[60], not the z-[70] a picker would normally take. `AnchoredPopover`
    // portals every Dropdown / ConstraintChip menu in the app at z-[60] over a
    // z-[55] click-away catcher — the lowest overlay tier, since its job is
    // escaping a scrolling panel's clip rather than covering a modal — so a
    // panel at z-[70] paints OVER its own menus, which is what "the dropdown
    // opens behind the modal" was on the scene facet. Sharing the
    // tier lets DOM order decide, and a menu is appended to the body after this
    // panel, so it wins: the same arrangement `InfluencerEditModal` and its
    // chips already rely on. The scene menu is exactly such a menu, so this
    // tier is load-bearing — don't raise it.
    //
    // No backdrop-blur on the backdrop: it would make this a backdrop root
    // containing a scrolling grid of a few hundred images, and every scrolled
    // pixel would drag a full-viewport filter recompute behind it.
    <div className="modal-fade fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" {...backdrop}>
      {/* `modal-pop` is the app's one modal arrival — see index.css. This panel
          unmounts when it closes, so it has no closed state to transition from
          and the keyframe runs on mount instead; `BankPicker` plays the same
          move as a transition because it stays mounted. */}
      <div
        className="modal-pop flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-ink/10 bg-surface-0 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex h-[57px] shrink-0 items-center justify-between gap-3 border-b border-ink/5 px-5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-tight text-ink-200">{title}</h3>
            {subtitle && <p className="truncate text-[11px] text-ink-600">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="shrink-0 rounded-full p-2 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body: the rail on the left, the one scrolling grid on the right.

            The rail is the TABLE OF CONTENTS of that scroll, and nothing on it
            filters (Massimo's call, August 2026). Every row is a place in the
            list — your characters, then each style the templates are filed
            under — clicking one scrolls there, and the highlight FOLLOWS THE
            SCROLL, the way the Ad Analyzer's section toggle follows its read.
            One rule for the whole rail: it says where you are.

            Two shapes were tried on the way here and both were worse. The
            styles were a `Dropdown` on the filter bar — eleven options behind a
            click, on a panel whose whole job is browsing — and then a rail that
            filtered, which reads as a set of tabs: it hides the ten other looks
            the moment you glance at one, when the point of the grid is that you
            keep scrolling through it. Navigating costs nothing the filter
            saved, because the section a jump lands on is the same handful of
            cards the filter would have left.

            Search and gender stay real filters, on the bar above the grid,
            because they cut ACROSS the sections rather than picking one.

            Below `lg` there is no room for a rail beside a grid of faces, so
            the same two controls ride the bar: the library toggle, and the
            style menu — which is this rail's Style block, one option per
            section, jumping exactly as the rows do. */}
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-[204px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-ink/5 px-3 py-4 lg:flex">
            <div className="flex flex-col gap-0.5">
              <SectionLabel label="Library" className="px-3 pb-1.5" />
              <RailRow
                icon={UserRound}
                label="Your Characters"
                count={bankCount}
                active={section === 'bank'}
                onClick={() => jumpTo('bank')}
              />
              <RailRow
                icon={Images}
                label="Templates"
                count={filtered.length - bankCount}
                active={section === 'starter'}
                onClick={() => jumpTo('starter')}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <SectionLabel label="Style" className="px-3 pb-1.5" />
              {facets.styles.map((o) => (
                <RailRow
                  key={o.value || 'all'}
                  label={o.label}
                  count={o.count}
                  active={o.value === scrolledStyle}
                  onClick={() => jumpToSection(styleSectionKey(o.value))}
                />
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Where you're going, then what to cut out of it. Gender stays a
                toggle (three options, all worth seeing without a click). Below
                `lg` the two navigation controls join this bar, in the order
                they always had — a member picks a side before they search it,
                so the toggle sits above the box that searches it. Shot type
                (Close-up / Medium / Full body) was a third facet and is gone: a
                starter is chosen by who and where, and three framings across
                the library mostly cut the grid down without answering
                anything. */}
            <div className="flex shrink-0 flex-col gap-2 border-b border-ink/5 px-5 py-3">
              <div className="lg:hidden">
                <SegmentedToggle
                  value={section}
                  onChange={jumpTo}
                  options={sourceOptions}
                  accent="influencers"
                  className="h-10 !p-1"
                />
              </div>
              {/* One bar. The style menu takes a FIXED width rather than
                  fitting its content — its label swings from "All Styles" to
                  "Holding Product", and a trigger that resized itself would
                  push the gender toggle along the row on every pick. Every
                  count rides in a `CountSlot` for the same reason. */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5">
                  <Search className="h-3.5 w-3.5 shrink-0 text-ink-600" />
                  <input
                    value={search}
                    onChange={(e) => refilter(setSearch)(e.target.value)}
                    placeholder="Search name, look, style..."
                    className="w-full bg-transparent text-sm text-ink-200 placeholder-ink-600 outline-none"
                  />
                </div>
                <SegmentedToggle
                  value={gender}
                  onChange={refilter(setGender)}
                  options={facets.genders}
                  accent="influencers"
                  className="shrink-0"
                  fitContent
                  dense
                />
                {/* The rail's Style block, for a width with no room for a
                    rail: same options, same jump, and its trigger reads the
                    section you're in because the spy owns that value. */}
                <div className="w-[190px] shrink-0 lg:hidden">
                  <Dropdown
                    value={scrolledStyle}
                    onChange={(v) => jumpToSection(styleSectionKey(v))}
                    options={facets.styles}
                    accent="influencers"
                    dense
                  />
                </div>
              </div>
            </div>

          {/* Grid */}
          <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4" onScroll={handleScroll}>
            {loadError && starterEntries.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="max-w-sm text-sm text-ink-500">{loadError}</p>
                <button
                  type="button"
                  onClick={() => { setLoadError(null); setReloadKey((n) => n + 1) }}
                  className="rounded-full border border-ink/10 bg-ink/[0.03] px-4 py-1.5 text-[13px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.06]"
                >
                  Try again
                </button>
              </div>
            ) : !starters && bankEntries.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <Spinner className="h-5 w-5 text-ink-600" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-ink-600">
                  {search || gender
                    ? 'No characters match those filters.'
                    : 'No characters yet.'}
                </p>
              </div>
            ) : (
              <>
                {sections.map((sec, i) => (
                  <div
                    key={sec.key}
                    // Every section registers itself: the rail measures against
                    // these to say which one you're in, and the library jump
                    // scrolls to one of them.
                    ref={(node) => {
                      if (node) sectionEls.current.set(sec.key, node)
                      else sectionEls.current.delete(sec.key)
                    }}
                  >
                    <DayPill label={sec.label} className={i === 0 ? 'mb-2' : 'mb-2 mt-5'} />
                    <div className={grid}>
                      {sec.entries.map((e) => (
                        <PresetCard
                          key={e.key}
                          entry={e}
                          savedId={e.starter ? savedStarters.get(e.starter.id) : undefined}
                          onClick={() => pick(e.profile)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {hasMore && (
                  <div className="flex h-14 items-center justify-center">
                    <Spinner className="h-4 w-4 text-ink-700" />
                  </div>
                )}
              </>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  )
}
