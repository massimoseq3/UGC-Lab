import { useMemo, useState } from 'react'
import { Search, FileText, PenLine, Clapperboard, FishingHook } from 'lucide-react'
import type { ScriptHistoryItem } from '../../../stores/types'
import { formatRelative, sectionLabel, groupByDay } from '../../../utils/history'
import { WRITE_STYLE_META, HOOK_CATEGORY_META, isHookCategoryChoice, parseHooks } from '../types'
import { TileDeleteButton } from '../../../components/tileActions'

const isHooksItem = (item: ScriptHistoryItem) => item.mode === 'write' && item.writeFormat === 'hooks'

// A clean, recognisable title for a history row — "<Product> · <descriptor>"
// — so the list reads as titles you click to restore, not raw script dumps.
function historyTitle(item: ScriptHistoryItem): string {
  const product = item.productName?.trim()
  const descriptor = isHooksItem(item)
    ? (isHookCategoryChoice(item.hookCategory) && item.hookCategory !== 'auto'
        ? `${HOOK_CATEGORY_META[item.hookCategory].label} Hooks`
        : 'Hooks')
    : item.mode === 'write'
      ? (item.writeStyle && item.writeStyle in WRITE_STYLE_META
          ? WRITE_STYLE_META[item.writeStyle as keyof typeof WRITE_STYLE_META].label
          : 'Written script')
      : item.mode === 'remix' ? 'Remix' : 'Scenes'
  return product ? `${product} · ${descriptor}` : descriptor
}

interface HistoryViewProps {
  items: ScriptHistoryItem[]
  activeId: string | null
  onSelect: (item: ScriptHistoryItem) => void
  onDelete: (id: string) => void
}

// Two-click confirm delete — the shared control, so destructive actions behave
// identically in every history list.
function DeleteRowButton({ onDelete, alwaysVisible }: { onDelete: () => void; alwaysVisible: boolean }) {
  return <TileDeleteButton variant="chrome" size="sm" alwaysVisible={alwaysVisible} onDelete={onDelete} />
}

export default function HistoryView({ items, activeId, onSelect, onDelete }: HistoryViewProps) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = items
      .filter((it) => {
        if (!q) return true
        if (it.inputSummary.toLowerCase().includes(q)) return true
        if (it.productName?.toLowerCase().includes(q)) return true
        return it.variations.some((v) => v.toLowerCase().includes(q))
      })
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)

    return groupByDay(filtered, (it) => it.createdAt)
  }, [items, query])

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <FileText className="h-10 w-10 text-ink-800" strokeWidth={1.5} />
        <p className="text-sm text-ink-300">No scripts yet</p>
        <p className="text-center text-xs text-ink-500">Your generated scripts will land here.</p>
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
            className="w-full rounded-full border border-ink/10 bg-transparent py-2 pl-10 pr-3 text-sm text-ink-100 placeholder-ink-500 outline-none transition-colors focus:border-scripts-500/40"
          />
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

                {dayItems.map((item) => {
                  const isActive = activeId === item.id
                  const hooksRow = isHooksItem(item)
                  const ModeIcon = hooksRow ? FishingHook : item.mode === 'write' ? PenLine : item.mode === 'remix' ? FileText : Clapperboard
                  const modeColor = hooksRow ? 'text-amber-300 light:text-amber-700' : item.mode === 'write' ? 'text-emerald-300 light:text-emerald-700' : item.mode === 'remix' ? 'text-scripts-300' : 'text-fuchsia-300 light:text-fuchsia-700'
                  const count = hooksRow ? parseHooks(item.variations[0] ?? '').length : item.variations.length
                  const countLabel = hooksRow
                    ? `${count} hook${count === 1 ? '' : 's'}`
                    : item.mode === 'write'
                      ? `${count} take${count === 1 ? '' : 's'}`
                      : `${count} variation${count === 1 ? '' : 's'}`
                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelect(item)}
                      className={`group flex cursor-pointer items-center gap-3 rounded-full px-3.5 py-3 transition-colors ${
                        isActive ? 'bg-scripts-500/15 ring-1 ring-scripts-500/20' : 'hover:bg-ink/[0.04]'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.04] ${modeColor}`}>
                        <ModeIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium leading-snug text-ink-100">
                          {historyTitle(item)}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-500">
                          <span>{countLabel}</span>
                          <span>·</span>
                          <span className="shrink-0">{formatRelative(item.createdAt)}</span>
                        </div>
                      </div>

                      <DeleteRowButton onDelete={() => onDelete(item.id)} alwaysVisible={isActive} />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
