import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Film, ArrowDownUp, Check, ChevronDown } from 'lucide-react'
import type { BrollHistoryItem } from '../../../stores/types'
import type {
  BrollResult,
  CardState,
  OneShotResult,
  OneShotCardState,
  ContinuousResult,
  ContinuousFrameCardState,
  ContinuousClipCardState,
  BrollMode,
} from '../types'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { useBankStore } from '../../../stores/bankStore'
import { usePersistedState } from '../../../hooks/usePersistedState'
import { getContinuousStyle } from '../services/generateContinuous'
import { formatRelative, sectionLabel, groupByDay } from '../../../utils/history'
import { TileDeleteButton } from '../../../components/tileActions'

interface BrollHistoryViewProps {
  items: BrollHistoryItem[]
  activeId: string | null
  onSelect: (item: BrollHistoryItem) => void
  onDelete: (id: string) => void
}

// First image url found across a mode's card states — the visual anchor for the
// row thumbnail.
function firstImageIn(cardStates: Record<string, { images?: { imageUrl?: string }[] }> | undefined): string | null {
  if (!cardStates) return null
  for (const k in cardStates) {
    const url = cardStates[k].images?.[0]?.imageUrl
    if (url) return url
  }
  return null
}

// First video url found across a mode's card states — used as a poster when a
// mode produced only clips (One-Shot, Continuous clips) and no still.
function firstVideoIn(cardStates: Record<string, { videos?: { url?: string }[] }> | undefined): string | null {
  if (!cardStates) return null
  for (const k in cardStates) {
    const url = cardStates[k].videos?.[0]?.url
    if (url) return url
  }
  return null
}

// Derive the row's cover from whatever media the session produced, in ANY mode.
// Prefer a still (cheap, reliable <img>) from line cards or continuous keyframes;
// otherwise fall back to a video first-frame poster. This is why previously
// One-Shot / Continuous rows never showed a cover — the old helper only read the
// line-mode card states.
function historyThumb(item: BrollHistoryItem): { imageRef?: string; videoRef?: string } {
  const lineImg = firstImageIn(item.cardStates as Record<string, CardState>)
  if (lineImg) return { imageRef: lineImg }
  const frameImg = firstImageIn(item.continuousFrameStates as Record<string, ContinuousFrameCardState> | undefined)
  if (frameImg) return { imageRef: frameImg }
  const oneShotVid = firstVideoIn(item.oneShotCardStates as Record<string, OneShotCardState> | undefined)
  if (oneShotVid) return { videoRef: oneShotVid }
  const clipVid = firstVideoIn(item.continuousClipStates as Record<string, ContinuousClipCardState> | undefined)
  if (clipVid) return { videoRef: clipVid }
  return {}
}

function sceneCount(result: BrollResult | null): number {
  return result?.scenes?.length ?? 0
}

// A session accumulates results across modes (state isn't cleared on a mode
// switch), and the saved `mode` is only the last-active one — unreliable for
// telling what a row *is*. So derive the row's mode from its richest content:
// prefer the special modes' own results (continuous, then one-shot); a lingering
// line result is the weakest signal. Both the badge/filter AND selecting the row
// use this, so what you see always matches where a click takes you.
export function brollHistoryMode(item: BrollHistoryItem): BrollMode {
  if (item.continuousResult) return 'continuous'
  if (item.oneShotResult) return 'oneshot'
  const line = item.result as BrollResult | null
  if (line?.scenes?.length) return 'line'
  return item.mode ?? 'line'
}

// Friendly visual-style label for the row's style pill. Prefers the style baked
// into the active mode's result (authoritative for line/continuous), then the
// row-level snapshot (the only source for One-Shot, whose result has no styleId).
function historyStyleLabel(item: BrollHistoryItem, mode: BrollMode): string | null {
  if (mode === 'continuous') {
    const c = item.continuousResult as ContinuousResult | undefined
    if (c?.styleId) return getContinuousStyle(c.styleId).label
  }
  if (mode === 'line') {
    const r = item.result as BrollResult | null
    if (r?.styleBrief) return 'Custom style'
    if (r?.styleId) return getContinuousStyle(r.styleId).label
  }
  if (item.styleBrief) return 'Custom style'
  if (item.styleId) return getContinuousStyle(item.styleId).label
  return null
}

const MODE_BADGE: Record<BrollMode, string> = {
  line: 'Line-by-Line',
  continuous: 'Continuous',
  oneshot: 'One-Shot',
}

// Mode filter pills.
type ModeFilter = 'all' | 'line' | 'continuous' | 'oneshot'
const MODE_FILTERS: { id: ModeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'line', label: 'Line-by-Line' },
  { id: 'continuous', label: 'Continuous' },
  { id: 'oneshot', label: 'One-Shot' },
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

export default function BrollHistoryView({ items, activeId, onSelect, onDelete }: BrollHistoryViewProps) {
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

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = items
      .filter((it) => {
        if (modeFilter !== 'all' && itemMode(it) !== modeFilter) return false
        if (!q) return true
        return it.inputSummary.toLowerCase().includes(q)
      })
      .slice()
      .sort((a, b) => (sort === 'oldest'
        ? sortTs(a, sort) - sortTs(b, sort)
        : sortTs(b, sort) - sortTs(a, sort)))

    return groupByDay(filtered, (it) => sortTs(it, sort))
  }, [items, query, modeFilter, sort])

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <Film className="h-10 w-10 text-ink-800" strokeWidth={1.5} />
        <p className="text-sm text-ink-300">No sessions yet</p>
        <p className="text-center text-xs text-ink-500">Generated B-Roll sessions will land here.</p>
      </div>
    )
  }

  const sortLabel = SORTS.find((s) => s.id === sort)?.label ?? 'Newest first'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-ink/5 px-5 py-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search history..."
            className="w-full rounded-full border border-ink/10 bg-transparent py-2 pl-10 pr-3 text-sm text-ink-100 placeholder-ink-500 outline-none transition-colors focus:border-broll-500/40"
          />
        </div>

        {/* Mode filter pills (left) + sort dropdown (right). The sort control is
            always shown; the mode pills only when more than one mode is present. */}
        <div className="mt-3 flex items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {showModeFilters &&
              MODE_FILTERS.map((f) => {
                const active = modeFilter === f.id
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

      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <span className="text-sm text-ink-500">No matches.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {groups.map(([dayTs, dayItems]) => (
              <div key={dayTs} className="flex flex-col gap-0.5">
                <div className="my-2 flex items-center justify-center">
                  <span className="rounded-full bg-ink/[0.06] px-3 py-1 text-[11px] font-medium text-ink-300">
                    {sectionLabel(dayTs)}
                  </span>
                </div>

                {dayItems.map((item) => (
                  <HistoryRow
                    key={item.id}
                    item={item}
                    displayTs={sortTs(item, sort)}
                    isActive={activeId === item.id}
                    onSelect={() => onSelect(item)}
                    onDelete={() => onDelete(item.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function HistoryRow({
  item,
  displayTs,
  isActive,
  onSelect,
  onDelete,
}: {
  item: BrollHistoryItem
  displayTs: number
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const result = item.result as BrollResult | null
  const { imageRef, videoRef } = useMemo(() => historyThumb(item), [item])
  const thumbUrl = useAssetUrl(imageRef ?? videoRef ?? '')
  const mode = brollHistoryMode(item)
  const isOneShot = mode === 'oneshot'
  const isContinuous = mode === 'continuous'
  const oneShotResult = item.oneShotResult as OneShotResult | undefined
  const continuousResult = item.continuousResult as BrollResult | null
  const count = isOneShot
    ? (oneShotResult?.concepts?.length ?? 0)
    : isContinuous
      ? sceneCount(continuousResult)
      : sceneCount(result)
  const countLabel = isOneShot
    ? `concept${count === 1 ? '' : 's'}`
    : `scene${count === 1 ? '' : 's'}`
  const styleLabel = historyStyleLabel(item, mode)

  // A clean title built from the linked references: "Product · Influencer ·
  // Script" (only the ones that were set). Falls back to the saved summary's
  // product slice if the references were since deleted from the banks.
  const products = useBankStore((s) => s.products)
  const models = useBankStore((s) => s.models)
  const scripts = useBankStore((s) => s.scripts)
  const productName = item.productId ? products.find((p) => p.id === item.productId)?.productName : undefined
  const influencerName = item.modelId ? models.find((m) => m.id === item.modelId)?.name : undefined
  const scriptName = item.scriptId ? scripts.find((s) => s.id === item.scriptId)?.title : undefined
  const parts = [productName, influencerName, scriptName].map((s) => s?.trim()).filter(Boolean)
  const title = parts.length > 0
    ? parts.join(' · ')
    : (item.inputSummary?.split(' — ')[0]?.trim() || 'B-Roll session')

  return (
    <div
      onClick={onSelect}
      className={`group flex cursor-pointer items-center gap-3 rounded-full px-3 py-2.5 transition-colors ${
        isActive ? 'bg-broll-500/15 ring-1 ring-broll-500/20' : 'hover:bg-ink/[0.04]'
      }`}
    >
      {thumbUrl && imageRef ? (
        <img
          src={thumbUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-full border border-ink/10 object-cover"
        />
      ) : thumbUrl && videoRef ? (
        // Video-only session (One-Shot / Continuous clips): the <video> element
        // paints its first frame as the poster. The `#t=0.1` fragment nudges the
        // browser to decode+show that frame instead of a blank element.
        <video
          src={`${thumbUrl}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className="h-10 w-10 shrink-0 rounded-full border border-ink/10 object-cover"
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.04] text-broll-300/70">
          <Film className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-snug text-ink-100">{title}</p>
        <div className="mt-1 flex items-center gap-1.5 overflow-hidden text-[11px] text-ink-500">
          <span className="shrink-0 rounded-full bg-broll-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-broll-300">
            {MODE_BADGE[mode]}
          </span>
          {styleLabel && (
            <span className="min-w-0 truncate rounded-full bg-ink/[0.06] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-ink-300">
              {styleLabel}
            </span>
          )}
          <span className="shrink-0">{count} {countLabel}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">{formatRelative(displayTs)}</span>
        </div>
      </div>

      <TileDeleteButton variant="chrome" size="sm" alwaysVisible={isActive} onDelete={onDelete} />
    </div>
  )
}
