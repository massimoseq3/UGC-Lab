import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Film, ArrowDownUp, Check, ChevronDown, AlertCircle, X } from 'lucide-react'
import { GeneratingChip, GeneratingPulseRing } from '../../../components/GeneratingChip'
import type { BrollHistoryItem } from '../../../stores/types'
import {
  isLineMode,
  type BrollResult,
  type CardState,
  type ContinuousResult,
  type ContinuousFrameCardState,
  type ContinuousClipCardState,
  type BrollMode,
} from '../types'
import { useAssetThumb, useAssetUrl, useAssetPoster } from '../../../hooks/useAssetUrl'
import { useBankStore } from '../../../stores/bankStore'
import { usePersistedState } from '../../../hooks/usePersistedState'
import { getContinuousStyle } from '../services/generateContinuous'
import { formatRelative, sectionLabel, groupByDay } from '../../../utils/history'
import { TileActionStack, TileDeleteButton } from '../../../components/tileActions'
import DayPill from '../../../components/DayPill'
import RailNewButton from '../../../components/RailNewButton'
import { brollHistoryMode } from './brollHistoryRows'

interface HistoryRailProps {
  // Already filtered by the parent (see isRetiredOneShotRow) so the rail's
  // count and this list can't disagree.
  items: BrollHistoryItem[]
  activeId: string | null
  onSelect: (item: BrollHistoryItem) => void
  onDelete: (id: string) => void
  // Empties the storyboard back to its blank canvas. Single click — nothing is
  // deleted, and the session it clears is a row in the list right underneath.
  onNew: () => void
  onCollapse: () => void
}

// ── Card cover media ─────────────────────────────────────────────────────
// A card shows a small mosaic rather than one thumbnail, so a session reads as
// what it produced. Stills first (cheap, reliable <img>), then clip posters —
// a Continuous session that only rendered clips still gets a face.
const MAX_COVERS = 3

interface CoverMedia { kind: 'image' | 'video'; ref: string }
interface MediaStateish {
  images?: { imageUrl?: string }[]
  videos?: { url?: string }[]
}

function collectImages(states: Record<string, MediaStateish> | undefined, out: CoverMedia[]) {
  if (!states) return
  for (const k in states) {
    for (const img of states[k].images ?? []) {
      if (img.imageUrl && out.length < MAX_COVERS) out.push({ kind: 'image', ref: img.imageUrl })
    }
  }
}

function collectVideos(states: Record<string, MediaStateish> | undefined, out: CoverMedia[]) {
  if (!states) return
  for (const k in states) {
    for (const vid of states[k].videos ?? []) {
      if (vid.url && out.length < MAX_COVERS) out.push({ kind: 'video', ref: vid.url })
    }
  }
}

// Up to MAX_COVERS pieces of media from whatever the session produced, in
// either mode.
function historyCovers(item: BrollHistoryItem): CoverMedia[] {
  const out: CoverMedia[] = []
  const line = item.cardStates as Record<string, CardState> | undefined
  const frames = item.continuousFrameStates as Record<string, ContinuousFrameCardState> | undefined
  const clips = item.continuousClipStates as Record<string, ContinuousClipCardState> | undefined
  collectImages(line, out)
  collectImages(frames, out)
  if (out.length < MAX_COVERS) {
    collectVideos(clips, out)
    collectVideos(line, out)
    collectVideos(frames, out)
  }
  return out
}

// How much finished media a session holds — the card's "what's in here" line.
function mediaTally(item: BrollHistoryItem): { images: number; videos: number } {
  let images = 0
  let videos = 0
  for (const states of [item.cardStates, item.continuousFrameStates, item.continuousClipStates] as
    (Record<string, MediaStateish> | undefined)[]) {
    if (!states) continue
    for (const k in states) {
      images += states[k].images?.length ?? 0
      videos += states[k].videos?.length ?? 0
    }
  }
  return { images, videos }
}

function sceneCount(result: BrollResult | null): number {
  return result?.scenes?.length ?? 0
}

// ── Live activity on a row ───────────────────────────────────────────────
// A session's card states are snapshotted into its history row verbatim, and
// those states carry the in-flight queues — so a row already knows what it has
// rendering. That's what turns the History tab into the queue view: fire a batch
// in one session, switch away, and the row keeps reporting progress.
//
// Same TTL the views use to sweep dead entries: an entry older than this is
// almost certainly gone (a tab closed mid-poll), so it must not leave a row
// pulsing "Generating…" forever.
const ACTIVITY_TTL_MS = 30 * 60 * 1000

interface InFlightish { startedAt?: number; error?: string | null }
interface CardStateish { inFlightImages?: InFlightish[]; inFlightVideos?: InFlightish[] }

interface RowActivity {
  images: number
  videos: number
  generating: number
  failed: number
  // The storyboard call itself is in flight — the row exists before there is
  // anything in it, so this is the one kind of activity a row can report with
  // no cards to tally.
  writing: boolean
}

function tallyStates(states: Record<string, CardStateish> | undefined, now: number, out: RowActivity) {
  if (!states) return
  for (const k in states) {
    for (const [arr, kind] of [
      [states[k].inFlightImages, 'images'],
      [states[k].inFlightVideos, 'videos'],
    ] as const) {
      for (const e of arr ?? []) {
        if (e.error) out.failed += 1
        else if (now - (e.startedAt ?? 0) <= ACTIVITY_TTL_MS) {
          out[kind] += 1
          out.generating += 1
        }
      }
    }
  }
}

// Counts across every mode's card states — a row is one session, and a session
// can hold work in more than one mode.
function rowActivity(item: BrollHistoryItem, now: number): RowActivity {
  const out: RowActivity = { images: 0, videos: 0, generating: 0, failed: 0, writing: false }
  // The storyboard is written before the session has a single card, so this
  // reads off the row's own state rather than off any card queue. Same TTL:
  // a row left writing by a browser that closed must not pulse forever.
  if (item.storyboardStatus === 'writing' && now - (item.updatedAt ?? item.createdAt) <= ACTIVITY_TTL_MS) {
    out.writing = true
    out.generating += 1
  }
  tallyStates(item.cardStates as Record<string, CardStateish> | undefined, now, out)
  tallyStates(item.continuousFrameStates as Record<string, CardStateish> | undefined, now, out)
  tallyStates(item.continuousClipStates as Record<string, CardStateish> | undefined, now, out)
  return out
}

// Name what's actually rendering — a Continuous session mid-keyframe-chain is
// making images, not clips.
function activityLabel(a: RowActivity): string {
  // The prompts come before any of it, so it wins the line when both are true.
  if (a.writing) return 'Writing storyboard…'
  const noun = a.videos === 0 ? 'image' : a.images === 0 ? 'clip' : 'output'
  return `Generating ${a.generating} ${noun}${a.generating === 1 ? '' : 's'}…`
}

// Friendly visual-style label for the row's style pill. Prefers the style baked
// into the active mode's result (authoritative for line/continuous), then the
// row-level snapshot.
function historyStyleLabel(item: BrollHistoryItem, mode: BrollMode): string | null {
  // A named custom style (one saved to the Styles bank) shows its own name
  // wherever a brief is in play; an unnamed one-off still reads "Custom style".
  const customLabel = item.styleName?.trim() || 'Custom style'
  if (mode === 'continuous') {
    // ContinuousResult stamps `styleId` unconditionally and has no brief field,
    // so the row-level snapshot is the only place a custom look survives — it
    // has to win here or every custom storyboard mislabels as its preset.
    if (item.styleBrief) return customLabel
    const c = item.continuousResult as ContinuousResult | undefined
    if (c?.styleId) return getContinuousStyle(c.styleId).label
  }
  if (isLineMode(mode)) {
    const r = item.result as BrollResult | null
    if (r?.styleBrief) return customLabel
    if (r?.styleId) return getContinuousStyle(r.styleId).label
  }
  if (item.styleBrief) return customLabel
  if (item.styleId) return getContinuousStyle(item.styleId).label
  return null
}

const MODE_BADGE: Record<BrollMode, string> = {
  line: 'Line-by-Line',
  continuous: 'Continuous',
}

// Mode filter pills. Deliberately mode-only: delivery is a setting inside
// Line-by-Line, not a kind of session, so a dialogue run files under the same
// pill as a silent one.
type ModeFilter = 'all' | BrollMode
const MODE_FILTERS: { id: ModeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'line', label: 'Line-by-Line' },
  { id: 'continuous', label: 'Continuous' },
]
function itemMode(it: BrollHistoryItem): Exclude<ModeFilter, 'all'> {
  return brollHistoryMode(it)
}

// Sort options. `newest`/`oldest` key off the stable creation time (rows never
// move when reopened); `recent` keys off last-touched activity.
type SortId = 'newest' | 'oldest' | 'recent'
const SORTS: { id: SortId; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'recent', label: 'Recently updated' },
]
function sortTs(it: BrollHistoryItem, sort: SortId): number {
  if (sort === 'recent') return it.updatedAt ?? it.createdAt
  return it.createdAt
}

export default function HistoryRail({ items, activeId, onSelect, onDelete, onNew, onCollapse }: HistoryRailProps) {
  const [query, setQuery] = useState('')
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all')
  const [sort, setSort] = usePersistedState<SortId>('broll-studio:historySort', 'newest')
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = useRef<HTMLDivElement>(null)

  // Close the sort menu on an outside click.
  useEffect(() => {
    if (!sortOpen) return
    const onDown = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [sortOpen])

  // Which mode pills to show — only offer a filter when more than one mode is
  // actually present, so a Line-only history isn't cluttered with dead pills.
  const presentModes = useMemo(() => new Set(items.map(itemMode)), [items])
  const showModeFilters = presentModes.size > 1

  // Deleting the last row of the filtered mode hides the pills (they only show
  // for >1 mode), which would strand every remaining row behind "No matches"
  // with no visible control to clear the filter. Fall back to 'all' rather than
  // leaving a filter the user can't see or undo.
  const activeModeFilter: ModeFilter =
    modeFilter !== 'all' && !presentModes.has(modeFilter) ? 'all' : modeFilter

  // Row titles come from the linked bank items. Built once here rather than in
  // each row: 50 rows each subscribing to three banks re-rendered the whole
  // list on any bank write, and search could only see `inputSummary` — so
  // typing the influencer or script name a row visibly displays found nothing.
  const products = useBankStore((s) => s.products)
  const models = useBankStore((s) => s.models)
  const scripts = useBankStore((s) => s.scripts)
  const titles = useMemo(() => {
    const map = new Map<string, string>()
    for (const it of items) {
      const parts = [
        it.productId ? products.find((p) => p.id === it.productId)?.productName : undefined,
        it.modelId ? models.find((m) => m.id === it.modelId)?.name : undefined,
        it.scriptId ? scripts.find((s) => s.id === it.scriptId)?.title : undefined,
      ].map((s) => s?.trim()).filter(Boolean)
      map.set(it.id, parts.length > 0
        ? parts.join(' · ')
        : (it.inputSummary?.split(/ [—·] /)[0]?.trim() || 'B-Roll session'))
    }
    return map
  }, [items, products, models, scripts])

  // Re-tick while anything is rendering so a row's "Generating…" chip ages out
  // on its own (the bank write that would otherwise re-render the list stops
  // arriving the moment the generation dies). Idle histories run no timer.
  const [now, setNow] = useState(() => Date.now())
  const activity = useMemo(() => {
    const map = new Map<string, RowActivity>()
    for (const it of items) map.set(it.id, rowActivity(it, now))
    return map
  }, [items, now])
  const generatingRows = useMemo(
    () => Array.from(activity.values()).filter((a) => a.generating > 0).length,
    [activity],
  )
  useEffect(() => {
    if (generatingRows === 0) return
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [generatingRows])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = items
      .filter((it) => {
        if (activeModeFilter !== 'all' && itemMode(it) !== activeModeFilter) return false
        if (!q) return true
        return it.inputSummary.toLowerCase().includes(q)
          || (titles.get(it.id) ?? '').toLowerCase().includes(q)
      })
      .slice()
      .sort((a, b) => (sort === 'oldest'
        ? sortTs(a, sort) - sortTs(b, sort)
        : sortTs(b, sort) - sortTs(a, sort)))

    // Day sections must run the same direction as the rows inside them.
    return groupByDay(filtered, (it) => sortTs(it, sort), sort === 'oldest' ? 'asc' : 'desc')
  }, [items, query, activeModeFilter, sort, titles])

  const sortLabel = SORTS.find((s) => s.id === sort)?.label ?? 'Newest first'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* New leads the rail, above the filters — the Ad Analyzer's shape, and
          its band takes the app-wide h-[57px] so the hairline lines up with the
          input column's header. The rail's open/shut control is the pull tab on
          the seam (`HistoryRailHandle`), reachable in both states; the Close
          here renders only below 980px, where the rail covers the storyboard
          and takes that tab with it. */}
      <div className="flex h-[57px] shrink-0 items-center gap-2 border-b border-ink/5 px-3">
        <RailNewButton
          label="New Storyboard"
          accentClass="bg-broll-500"
          title="Clear the storyboard. This session stays here in History"
          onClick={onNew}
          className="flex-1"
        />
        <button
          type="button"
          onClick={onCollapse}
          title="Close history"
          aria-label="Close history"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-100 min-[980px]:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search + filters + sort. It stays put on a phone: this bar wore a
          CollapsingBar for a week and lost it (August 2026) — a filter row
          that rolls away on a scroll and unrolls on the way back up moves the
          list under the thumb reading it. */}
      <div className="shrink-0 border-b border-ink/5 px-3 py-2.5">
        {/* ONE row: search, then the mode pills, then sort (August 2026,
            Massimo's call). The field had the first line to itself and the pills
            and sort the next, which spent ~40px of a panel that is otherwise all
            list — and neither line was close to full. The field takes what's
            left of the row (`flex-1` off a 200px floor) and the row wraps on its
            own when there isn't room, which is what a phone gets. */}
        <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search history..."
            className="w-full rounded-full border border-ink/10 bg-transparent py-2 pl-10 pr-3 text-sm text-ink-100 placeholder-ink-500 outline-none transition-colors focus:border-broll-500/40"
          />
        </div>

        {/* Mode filter pills, then the sort dropdown. Sort is always shown; the
            mode pills only when more than one mode is present. A live "N
            sessions rendering" chip leads them whenever anything is in flight,
            so the queue is visible without scanning every row. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {generatingRows > 0 && (
              <span className="flex items-center rounded-full border border-broll-500/30 bg-broll-500/10 px-2.5 py-1 text-[11px]">
                <GeneratingChip
                  label={`${generatingRows} session${generatingRows === 1 ? '' : 's'} rendering`}
                />
              </span>
            )}
            {showModeFilters &&
              MODE_FILTERS.map((f) => {
                const active = activeModeFilter === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setModeFilter(f.id)}
                    className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'border-broll-500/40 bg-broll-500/15 text-broll-200'
                        : 'border-ink/10 bg-ink/[0.03] text-ink-400 hover:bg-ink/[0.06] hover:text-ink-200'
                    }`}
                  >
                    {f.label}
                  </button>
                )
              })}
          </div>

          <div ref={sortRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setSortOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1 text-[11px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.06] hover:text-ink-100"
              title="Sort history"
            >
              <ArrowDownUp className="h-3 w-3" />
              <span>{sortLabel}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full z-20 mt-1.5 w-44 overflow-hidden rounded-xl border border-ink/10 bg-surface-2 p-1 shadow-lg shadow-black/20">
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSort(s.id)
                      setSortOpen(false)
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[12px] transition-colors ${
                      sort === s.id ? 'bg-broll-500/15 text-broll-200' : 'text-ink-300 hover:bg-ink/[0.06] hover:text-ink-100'
                    }`}
                  >
                    <span>{s.label}</span>
                    {sort === s.id && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* A CONTAINER query, not a viewport one: this list is 280px wide as a
          rail and most of the pane when it stands in front of the storyboard,
          and `sm:grid-cols-2` (a viewport rule) put two 130px cards side by
          side in the rail. */}
      <div className="@container min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <Film className="h-8 w-8 text-ink-800" strokeWidth={1.5} />
            <p className="text-xs text-ink-300">No sessions yet</p>
            <p className="text-[11px] text-ink-500">Generated B-Roll sessions will land here.</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <span className="text-sm text-ink-500">No matches.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-6 px-3 py-4">
            {groups.map(([dayTs, dayItems]) => (
              <div key={dayTs} className="flex flex-col gap-3">
                <DayPill label={sectionLabel(dayTs)} className="" />

                <div className="grid grid-cols-1 gap-3 @min-[520px]:grid-cols-2 @min-[820px]:grid-cols-3 @min-[1100px]:grid-cols-4">
                  {dayItems.map((item) => (
                    <HistoryCard
                      key={item.id}
                      item={item}
                      displayTs={sortTs(item, sort)}
                      title={titles.get(item.id) ?? 'B-Roll session'}
                      activity={activity.get(item.id)}
                      isActive={activeId === item.id}
                      onSelect={() => onSelect(item)}
                      onDelete={() => onDelete(item.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// One piece of the cover mosaic. Each tile resolves its own asset ref, so the
// card can show several without a hook loop.
function CoverTile({ media, className = '' }: { media: CoverMedia; className?: string }) {
  // A still shows its grid-sized thumbnail (utils/mediaThumbs), never the
  // original: this mosaic is a few dozen tiles of ~100px, and every one used
  // to decode a full-size render. A clip shows its poster frame once one has
  // been captured — that's a picture, where a <video> is a decoder — and only
  // mounts the element to capture it the first time.
  const still = useAssetThumb(media.kind === 'image' ? media.ref : null)
  const poster = useAssetPoster(media.kind === 'video' ? media.ref : null)
  const clip = useAssetUrl(media.kind === 'video' && !poster.url ? media.ref : null)
  if (media.kind === 'video') {
    if (poster.url) return <img src={poster.url} alt="" loading="lazy" decoding="async" className={`${className} h-full w-full object-cover`} />
    if (!clip) return <span className={`${className} h-full w-full bg-ink/[0.05]`} />
    // The <video> element paints its first frame as the poster; the `#t=0.1`
    // fragment nudges the browser to decode+show that frame instead of a blank
    // element — and that decoded frame is what `capture` keeps as the poster.
    return (
      <video
        src={`${clip}#t=0.1`}
        onLoadedData={(e) => poster.capture(e.currentTarget)}
        muted
        playsInline
        preload="metadata"
        className={`${className} h-full w-full object-cover`}
      />
    )
  }
  if (!still.url) return <span className={`${className} h-full w-full bg-ink/[0.05]`} />
  return <img src={still.url} alt="" loading="lazy" decoding="async" className={`${className} h-full w-full object-cover`} />
}

// The cover: one still full-bleed, two side by side, three as a big left tile
// plus a stacked pair. Anything richer competes with the meta below it.
function CardCover({ covers }: { covers: CoverMedia[] }) {
  if (covers.length === 0) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-ink/[0.04] text-broll-300/50">
        <Film className="h-7 w-7" strokeWidth={1.5} />
      </span>
    )
  }
  if (covers.length === 1) {
    return <CoverTile media={covers[0]} />
  }
  if (covers.length === 2) {
    return (
      <div className="grid h-full w-full grid-cols-2 gap-px">
        {covers.map((m, i) => <CoverTile key={i} media={m} />)}
      </div>
    )
  }
  return (
    <div className="grid h-full w-full grid-cols-3 grid-rows-2 gap-px">
      <CoverTile media={covers[0]} className="col-span-2 row-span-2" />
      <CoverTile media={covers[1]} />
      <CoverTile media={covers[2]} />
    </div>
  )
}

function HistoryCard({
  item,
  displayTs,
  title,
  activity,
  isActive,
  onSelect,
  onDelete,
}: {
  item: BrollHistoryItem
  displayTs: number
  // "Product · Influencer · Script" from the linked bank items, resolved by the
  // parent (one lookup pass for the whole list, and the same string search
  // matches against).
  title: string
  // In-flight / failed counts for this session, tallied by the parent.
  activity?: RowActivity
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const result = item.result as BrollResult | null
  const covers = useMemo(() => historyCovers(item), [item])
  const tally = useMemo(() => mediaTally(item), [item])
  const mode = brollHistoryMode(item)
  const isContinuous = mode === 'continuous'
  const continuousResult = item.continuousResult as BrollResult | null
  const count = isContinuous ? sceneCount(continuousResult) : sceneCount(result)
  const countLabel = `scene${count === 1 ? '' : 's'}`
  const styleLabel = historyStyleLabel(item, mode)
  const generating = activity?.generating ?? 0
  const failed = activity?.failed ?? 0
  // A row whose storyboard is still being written — or whose writing failed —
  // holds nothing to restore, so it isn't clickable. It's here to be watched,
  // and (when it failed) to say what happened and be deleted.
  const storyboardFailed = item.storyboardStatus === 'error'
  const openable = !item.storyboardStatus

  return (
    <div
      onClick={openable ? onSelect : undefined}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-all ${
        openable ? 'cursor-pointer' : 'cursor-default'
      } ${
        isActive
          ? 'border-broll-500/50 bg-broll-500/[0.08] ring-1 ring-broll-500/40'
          : 'border-ink/5 bg-ink/[0.03] hover:-translate-y-px hover:border-ink/15 hover:bg-ink/[0.05]'
      }`}
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <CardCover covers={covers} />

        {/* Scrim only where text sits, so the media stays the loudest thing on
            the card. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/60 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/70 to-transparent" />

        <span className="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">
          {MODE_BADGE[mode]}
        </span>

        <div className="absolute inset-x-2.5 bottom-2.5 flex items-center gap-1.5 overflow-hidden">
          {/* A session being written has no scenes yet — "0 scenes" reads as a
              broken storyboard rather than an unfinished one. */}
          {count > 0 && (
            <span className="shrink-0 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
              {count} {countLabel}
            </span>
          )}
          {styleLabel && (
            <span className="min-w-0 truncate rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white/80">
              {styleLabel}
            </span>
          )}
        </div>

        <TileActionStack forceVisible={isActive}>
          <TileDeleteButton variant="media" size="sm" onDelete={onDelete} />
        </TileActionStack>

        {generating > 0 && <GeneratingPulseRing family="broll" shape="rect" />}
      </div>

      <div className="flex min-h-0 flex-col gap-1 px-3 py-2.5">
        <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink-100">{title}</p>
        {/* The storyboard call died — say why, on the row it died on. Nothing
            was generated, so there's no media line to keep. */}
        {storyboardFailed && (
          <p
            className="line-clamp-2 text-[11px] leading-snug text-red-400 light:text-red-600"
            title={item.storyboardError}
          >
            {item.storyboardError || 'Storyboard failed.'}
          </p>
        )}
        <div className="flex items-center gap-1.5 overflow-hidden text-[11px] text-ink-500">
          {/* While a session has work in flight, the live count replaces the
              media tally — that's the answer the member is looking for when they
              open History mid-render. The timestamp stays either way. */}
          {generating > 0 ? (
            <>
              <GeneratingChip family="broll" label={activityLabel(activity!)} />
              <span className="shrink-0">·</span>
            </>
          ) : (
            (tally.images > 0 || tally.videos > 0) && (
              <>
                <span className="truncate">
                  {[
                    tally.images > 0 ? `${tally.images} still${tally.images === 1 ? '' : 's'}` : null,
                    tally.videos > 0 ? `${tally.videos} clip${tally.videos === 1 ? '' : 's'}` : null,
                  ].filter(Boolean).join(' · ')}
                </span>
                <span className="shrink-0">·</span>
              </>
            )
          )}
          <span className="shrink-0">{formatRelative(displayTs)}</span>
          {failed > 0 && (
            <span className="flex shrink-0 items-center gap-1 text-red-400 light:text-red-600">
              <AlertCircle className="h-2.5 w-2.5" />
              {failed} failed
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
