import { useMemo, useState } from 'react'
import { Search, FileText } from 'lucide-react'
import type { ScriptHistoryItem } from '../../../stores/types'
import { formatRelative, sectionLabel, groupByDay } from '../../../utils/history'
import { WRITE_STYLE_META, HOOK_CATEGORY_META, isHookCategoryChoice, parseHooks, hooksPlainText } from '../types'
import { TileActionStack, TileDeleteButton } from '../../../components/tileActions'

const isHooksItem = (item: ScriptHistoryItem) => item.mode === 'write' && item.writeFormat === 'hooks'

// The badge each card leads with — the kind of thing this run produced, plus
// (for Write New) which style wrote it. Same information the old rows carried
// in their title, moved onto the card's own label so the title can be the
// product.
function historyBadge(item: ScriptHistoryItem): { label: string; className: string } {
  if (isHooksItem(item)) {
    const family = isHookCategoryChoice(item.hookCategory) && item.hookCategory !== 'auto'
      ? `${HOOK_CATEGORY_META[item.hookCategory].label} Hooks`
      : 'Hooks'
    return { label: family, className: 'bg-amber-500/15 text-amber-300 light:text-amber-700 border-amber-500/20' }
  }
  if (item.mode === 'remix') {
    return { label: 'Remix', className: 'bg-scripts-500/15 text-scripts-300 border-scripts-500/20' }
  }
  if (item.mode === 'reverse-engineer' || (item.mode === 'write' && item.writeFormat === 'scenes')) {
    return { label: 'Scenes', className: 'bg-fuchsia-500/15 text-fuchsia-300 light:text-fuchsia-700 border-fuchsia-500/20' }
  }
  if (item.mode === 'write' && item.writeFormat === 'prompt') {
    return { label: 'Cinematic', className: 'bg-sky-500/15 text-sky-300 light:text-sky-700 border-sky-500/20' }
  }
  const style = item.writeStyle && item.writeStyle in WRITE_STYLE_META
    ? WRITE_STYLE_META[item.writeStyle as keyof typeof WRITE_STYLE_META].label
    : 'Script'
  return { label: style, className: 'bg-emerald-500/15 text-emerald-300 light:text-emerald-700 border-emerald-500/20' }
}

// The card's preview text — the first take, exactly as written. Hooks strip
// their <FAMILY> tags (UI metadata, not script text).
function previewText(item: ScriptHistoryItem): string {
  const first = item.variations[0] ?? ''
  return (isHooksItem(item) ? hooksPlainText(first) : first).trim()
}

function countLabel(item: ScriptHistoryItem): string {
  if (isHooksItem(item)) {
    const n = parseHooks(item.variations[0] ?? '').length
    return `${n} hook${n === 1 ? '' : 's'}`
  }
  const n = item.variations.length
  if (item.mode === 'write') return `${n} take${n === 1 ? '' : 's'}`
  return `${n} variation${n === 1 ? '' : 's'}`
}

interface HistoryViewProps {
  items: ScriptHistoryItem[]
  activeId: string | null
  onSelect: (item: ScriptHistoryItem) => void
  onDelete: (id: string) => void
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
          <div className="flex flex-col gap-6 px-5 py-4">
            {groups.map(([dayTs, dayItems]) => (
              <div key={dayTs} className="flex flex-col gap-3">
                {/* Day header sits left of a hairline rather than centred over
                    the list: with a grid below it, a centred pill reads as a
                    divider between two unrelated blocks. */}
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    {sectionLabel(dayTs)}
                  </span>
                  <span className="text-[11px] text-ink-600">{dayItems.length}</span>
                  <span className="h-px flex-1 bg-ink/[0.07]" />
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {dayItems.map((item) => (
                    <HistoryCard
                      key={item.id}
                      item={item}
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

// One run as a little script box — mirrors the Bank's script cards, because the
// thing worth recognising is the writing itself. A 36px icon and a one-line
// title showed none of it.
function HistoryCard({
  item,
  isActive,
  onSelect,
  onDelete,
}: {
  item: ScriptHistoryItem
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const badge = historyBadge(item)
  const preview = previewText(item)
  // Rows are generated against a product, so the product names the card. The
  // fallbacks cover odd/legacy rows — the brief's first line before the badge
  // label, which would otherwise just repeat the pill above it.
  const title = item.productName?.trim()
    || item.inputSummary.split('\n').map((l) => l.trim()).find(Boolean)
    || badge.label

  return (
    <div
      onClick={onSelect}
      // Fixed height rather than an aspect ratio: the panel is half the window,
      // so a portrait card would fill it and only one row would ever be on
      // screen. This is deep enough for ~10 lines — enough to recognise the take.
      className={`group relative flex h-[272px] cursor-pointer flex-col overflow-hidden rounded-2xl border p-4 transition-all card-soft-shadow ${
        isActive
          ? 'border-scripts-500/50 bg-scripts-500/[0.08] ring-1 ring-scripts-500/40'
          : 'border-ink/5 bg-ink/[0.03] hover:-translate-y-px hover:border-ink/15 hover:bg-ink/[0.05]'
      }`}
    >
      <div className="flex flex-col gap-2">
        <span
          className={`w-fit max-w-[calc(100%-2rem)] shrink-0 truncate rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest ${badge.className}`}
        >
          {badge.label}
        </span>
        <span className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight text-ink-100">
          {title}
        </span>
      </div>

      {/* The take itself, fading out at the bottom. Masked rather than covered
          by a gradient so the fade holds on the selected card's tinted fill. */}
      <div
        className="mt-3 flex-1 overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to bottom, #000 72%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, #000 72%, transparent)',
        }}
      >
        <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-ink-400">
          {preview || 'Empty script'}
        </p>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ink-600">
        <span className="truncate">{countLabel(item)}</span>
        <span className="shrink-0">·</span>
        <span className="shrink-0 text-ink-700">{formatRelative(item.createdAt)}</span>
      </div>

      <TileActionStack forceVisible={confirm || isActive}>
        <TileDeleteButton variant="chrome" size="sm" onDelete={onDelete} onArmedChange={setConfirm} />
      </TileActionStack>
    </div>
  )
}
