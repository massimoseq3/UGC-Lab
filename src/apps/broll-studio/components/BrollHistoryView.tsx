import { useMemo, useState } from 'react'
import { Search, Film, Trash2 } from 'lucide-react'
import type { BrollHistoryItem } from '../../../stores/types'
import type { BrollResult, CardState, OneShotResult, BrollMode } from '../types'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { useBankStore } from '../../../stores/bankStore'
import { formatRelative, sectionLabel, groupByDay } from '../../../utils/history'

interface BrollHistoryViewProps {
  items: BrollHistoryItem[]
  activeId: string | null
  onSelect: (item: BrollHistoryItem) => void
  onDelete: (id: string) => void
}

// Pull the first image url found in any card's image list. Used for the
// history-row thumbnail so a session that already produced media has a
// visual anchor.
function firstImageRef(cardStates: Record<string, CardState>): string | null {
  for (const k in cardStates) {
    const card = cardStates[k]
    const url = card.images?.[0]?.imageUrl
    if (url) return url
  }
  return null
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

export default function BrollHistoryView({ items, activeId, onSelect, onDelete }: BrollHistoryViewProps) {
  const [query, setQuery] = useState('')
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all')

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
      .sort((a, b) => b.createdAt - a.createdAt)

    return groupByDay(filtered, (it) => it.createdAt)
  }, [items, query, modeFilter])

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <Film className="h-10 w-10 text-ink-800" strokeWidth={1.5} />
        <p className="text-sm text-ink-300">No sessions yet</p>
        <p className="text-center text-xs text-ink-500">Generated B-Roll sessions will land here.</p>
      </div>
    )
  }

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

        {/* Mode filter pills — sort by Line-by-Line / Continuous / One-Shot. */}
        {showModeFilters && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {MODE_FILTERS.map((f) => {
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
        )}
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
  isActive,
  onSelect,
  onDelete,
}: {
  item: BrollHistoryItem
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const cardStates = item.cardStates as Record<string, CardState>
  const result = item.result as BrollResult | null
  const thumbRef = firstImageRef(cardStates)
  const thumbUrl = useAssetUrl(thumbRef ?? '')
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
  const modeBadge = isOneShot ? 'One Shot' : isContinuous ? 'Continuous' : null
  const countLabel = isOneShot
    ? `concept${count === 1 ? '' : 's'}`
    : `scene${count === 1 ? '' : 's'}`
  const [confirming, setConfirming] = useState(false)

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
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-full border border-ink/10 object-cover"
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.04] text-broll-300/70">
          <Film className="h-5 w-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-snug text-ink-100">{title}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-500">
          {modeBadge && (
            <span className="rounded-full bg-broll-500/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-broll-300">
              {modeBadge}
            </span>
          )}
          <span>{count} {countLabel}</span>
          <span>·</span>
          <span className="shrink-0">{formatRelative(item.createdAt)}</span>
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation()
          if (!confirming) {
            setConfirming(true)
            setTimeout(() => setConfirming(false), 3000)
            return
          }
          onDelete()
        }}
        // Idle is a fixed 7×7 circle; only "Confirm" grows into a pill.
        className={`flex h-7 shrink-0 items-center justify-center rounded-full transition-all ${
          confirming
            ? 'gap-1 px-2 bg-red-500/30 text-red-100 light:text-red-900 opacity-100 ring-1 ring-red-400/60'
            : `w-7 text-ink-500 hover:bg-red-500/10 hover:text-red-400 light:hover:text-red-600 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`
        }`}
        title={confirming ? 'Click again to delete' : 'Delete'}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {confirming && <span className="text-[10px] font-medium">Confirm</span>}
      </button>
    </div>
  )
}
