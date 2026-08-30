import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Sparkles, Star, UserRound, Images, Bookmark, Check } from 'lucide-react'
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
import {
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

function flattenJsonProfile(json: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof json !== 'object' || json === null) return out
  for (const section of Object.values(json as Record<string, unknown>)) {
    if (typeof section === 'object' && section !== null) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        if (typeof value === 'string') out[key] = value
      }
    }
  }
  return out
}

// The Bank's own character card at a smaller size: a 9:16 cover under a
// gradient with the name across it. Small enough to fit six to a row, which is
// what makes browsing 81 faces a scan rather than a scroll.
//
// A `div` wrapping a full-bleed button rather than a button outright, because a
// template card carries a Save action of its own and a button inside a button
// is not a thing the DOM has.
function PresetCard({ entry, savedId, onClick, onSaveStart }: {
  entry: Entry
  savedId?: string
  onClick: () => void
  onSaveStart: () => void
}) {
  // Starters pass a bundled thumb URL; bank rows pass an asset:// ref resolved
  // through IndexedDB. Prefer the direct URL when present.
  const assetUrl = useAssetUrl(entry.imageRef)
  const url = entry.imageUrl ?? assetUrl
  return (
    <div className="group relative aspect-[9/16] w-full overflow-hidden rounded-xl border border-ink/5 bg-ink/[0.03] transition-all hover:border-influencers-500/40 hover:-translate-y-px card-soft-shadow">
      <button
        type="button"
        onClick={onClick}
        title={[entry.title, entry.note].filter(Boolean).join(' — ') || entry.name}
        className="absolute inset-0 block h-full w-full text-left"
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
            <Sparkles className="h-5 w-5 text-ink-700" strokeWidth={1.5} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2 pt-6">
          <span className="block truncate text-[11px] font-semibold tracking-tight text-zinc-100">{entry.name}</span>
        </div>
      </button>
      {entry.starred && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-amber-300">
          <Star className="h-3 w-3 fill-current" strokeWidth={2} />
        </span>
      )}
      {entry.starter && <StarterSaveAction row={entry.starter} savedId={savedId} onSaveStart={onSaveStart} />}
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
function StarterSaveAction({ row, savedId, onSaveStart }: {
  row: StarterRow
  savedId?: string
  onSaveStart: () => void
}) {
  const [saving, setSaving] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const saved = !!savedId

  const save = async () => {
    if (saving || saved) return
    // The library side is DERIVED from the bank when nothing has been picked
    // (see `source`), so a member's first save would otherwise take the grid
    // they were browsing away with it: the bank goes 0 → 1 rows and the panel
    // flips to Your Characters mid-click. Saving is a reason to stay put.
    onSaveStart()
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
            ? 'Already in your Characters — pick it in Playground, B-Roll or any character picker'
            : 'Save to Characters — then use this face in Playground, B-Roll or any character picker'
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
 * A count in a fixed-width slot.
 *
 * The facet counts are live — they re-tally against whatever else is filtered —
 * so a segment reading "All 76" becomes "All 9" on the next click. Left to size
 * itself, that digit takes ~5px with it and every segment to its right slides,
 * which is what made the row feel like it moved under the pointer. Two digits'
 * worth of room is reserved always (the library is 76 rows; a three-digit one
 * would want another `ch` here), and `tabular-nums` keeps 11 the same width as
 * 76 so nothing shifts between two numbers of the same length either.
 */
function CountSlot({ value }: { value: number }) {
  return <span className="inline-block min-w-[2ch] text-center tabular-nums">{value}</span>
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
 * The two libraries are a TOGGLE, not two sections of one scroll. Stacked,
 * your own characters were a band at the top that a member with 35 of them
 * scrolled past to reach a template, and the templates' scene facet was
 * filtering a list that was half bank rows — where a scene is a keyword guess
 * off free text rather than the library's own shot category. One at a time,
 * each side gets the whole grid and the scene menu belongs to the side it was
 * built for; it renders only there.
 *
 * Calls `onPick` with the chosen recipe as a flat profile map, then closes.
 * Callers decide what to do with that map: apply it wholesale
 * (LoadPresetDropdown) or merge only a subset of keys (the scoped Physical /
 * Scene & Pose preset buttons in ControlsPanel).
 */
export default function PresetPickerModal({
  open,
  onClose,
  onPick,
  title = 'Character Presets',
  subtitle = 'Pick a recipe to fill the form',
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
  // `null` is "hasn't picked yet", so the front door can be DERIVED from the
  // bank rather than corrected by an effect after the first render: your own
  // characters, unless you don't have any yet. A click makes it a real pick,
  // including a click onto an empty bank — the badge reads 0 and the empty
  // state says why, which beats a segment that ignores you.
  const [sourcePick, setSourcePick] = useState<Source | null>(null)
  const [gender, setGender] = useState('')
  const [setting, setSetting] = useState('')
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

  const source: Source = sourcePick ?? (bankEntries.length > 0 ? 'bank' : 'starter')

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
    source: (e: Entry) => e.source === source,
    gender: (e: Entry) => !gender || e.gender === gender,
    setting: (e: Entry) => !setting || e.setting === setting,
  }), [q, source, gender, setting])

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
  const styleOrder = useMemo(() => {
    const seen: string[] = []
    for (const e of [...starterEntries, ...bankEntries]) {
      if (e.setting && !seen.includes(e.setting)) seen.push(e.setting)
    }
    return seen
  }, [starterEntries, bankEntries])

  // The two library counts are tallied against search and gender but NOT
  // against the style, which belongs to the templates alone: a style picked on
  // that side would otherwise narrow the "Your Characters" badge too, and the
  // number would stop matching the grid you get on clicking it.
  const sourceOptions = useMemo(() => {
    const rows = all.filter((e) => passes.q(e) && passes.gender(e))
    const count = (k: Source) => rows.filter((e) => e.source === k).length
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
  }, [all, passes])

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

    // The style MENU keeps the same two rules as the toggle: the library's own
    // order, and every option always present (a count of 0 says why the grid
    // would be empty). A menu sorted by count would reshuffle itself between
    // two openings, which is the same disorientation on a slower fuse.
    const styleRows = pool('setting')
    return {
      genders: segments('gender', ['Female', 'Male'], (e) => e.gender),
      styles: [
        { value: '', label: 'All Styles' },
        ...styleOrder.map((k) => ({
          value: k,
          label: k,
          count: styleRows.filter((e) => e.setting === k).length,
        })),
      ],
    }
  }, [all, passes, styleOrder])

  const filtered = useMemo(
    () => all.filter((e) => Object.values(passes).every((fn) => fn(e))),
    [all, passes],
  )

  const shown = filtered.slice(0, visible)

  // Infinite scroll: the next page is pulled in once the grid is within a
  // screenful of its end, so it's already rendered by the time the last row
  // is. A plain scroll handler rather than an IntersectionObserver on a
  // sentinel — the arithmetic is two subtractions, and it can be reasoned
  // about (and watched) without a second async system in the middle.
  const hasMore = shown.length < filtered.length
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!hasMore) return
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 500) setVisible((n) => n + PAGE)
  }

  // Narrowing the list starts it from the top again — otherwise a filter
  // applied after scrolling to card 200 renders 200 cards of a 12-card result.
  // Done on the way in rather than in an effect watching the filters, which
  // would render the long list once before cutting it back.
  const refilter = <T,>(set: (v: T) => void) => (value: T) => { set(value); setVisible(PAGE) }

  const changeSource = (value: Source) => {
    setSourcePick(value)
    setVisible(PAGE)
    // Back to the top with it. The page count resets, so a member deep in the
    // templates who switches would otherwise be dropped at the foot of a
    // three-card bank by the browser's own clamp.
    if (gridRef.current) gridRef.current.scrollTop = 0
  }

  const pick = (profile: Record<string, string> | CharacterProfile) => {
    onPick(profile)
    onClose()
  }

  const portalTarget = typeof document !== 'undefined' ? document.body : null
  if (!open || !portalTarget) return null

  const grid = 'grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6'

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" {...backdrop}>
      <div
        className="flex h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-ink/10 bg-surface-0 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex h-[57px] shrink-0 items-center justify-between gap-3 border-b border-ink/5 px-5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-tight text-ink-200">{title}</h3>
            <p className="truncate text-[11px] text-ink-600">{subtitle}</p>
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

        {/* Which library first, then how to narrow it. The toggle SWAPS what
            the panel is showing where the row under it only filters that, so
            it reads as the panel's own tab strip — the same shape and job as
            the Controls column's Physical / Scene & Pose toggle, which is also
            the first thing in its column. It sat under the filter bar until
            August 2026 (Massimo's call): a member picks a side before they
            search it, and a search box above the thing it searches puts the
            two in the wrong order. Gender is a toggle (three options, all
            worth seeing without a click); the styles are a menu, since as a
            toggle they made a strip no window fits and pushed the grid down a
            row. Shot type (Close-up / Medium / Full body) was a third facet
            and is gone: a starter is chosen by who and where, and three
            framings across the library mostly cut the grid down without
            answering anything. */}
        <div className="flex shrink-0 flex-col gap-2 border-b border-ink/5 px-5 py-3">
          <SegmentedToggle
            value={source}
            onChange={changeSource}
            options={sourceOptions}
            accent="influencers"
            className="h-10 !p-1"
          />
          {/* One bar. The style menu takes a FIXED width rather than fitting
              its content — its label swings from "All Styles" to "Holding
              Product", and a trigger that resized itself would push the gender
              toggle along the row on every pick, which is the shifting this
              control was moved to avoid. Every count rides in a `CountSlot`
              for the same reason. */}
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
            <div className="w-[190px] shrink-0">
              <Dropdown
                value={setting}
                onChange={refilter(setSetting)}
                options={facets.styles}
                accent="influencers"
                dense
              />
            </div>
          </div>
        </div>

        {/* Grid */}
        <div ref={gridRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4" onScroll={handleScroll}>
          {loadError && source === 'starter' && starterEntries.length === 0 ? (
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
          ) : !starters && source === 'starter' ? (
            <div className="flex h-full items-center justify-center">
              <Spinner className="h-5 w-5 text-ink-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-ink-600">
                {source === 'bank' && bankEntries.length === 0
                  ? 'No saved characters yet.'
                  : 'No characters match those filters.'}
              </p>
            </div>
          ) : (
            <>
              <div className={grid}>
                {shown.map((e) => (
                  <PresetCard
                    key={e.key}
                    entry={e}
                    savedId={e.starter ? savedStarters.get(e.starter.id) : undefined}
                    onClick={() => pick(e.profile)}
                    onSaveStart={() => setSourcePick(source)}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="flex h-14 items-center justify-center">
                  <Spinner className="h-4 w-4 text-ink-700" />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    portalTarget,
  )
}
