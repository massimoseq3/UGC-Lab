import { useMemo, useState } from 'react'
import { Search, FileText } from 'lucide-react'
import type { ScriptHistoryItem } from '../../../stores/types'
import { formatRelative, sectionLabel, groupByDay } from '../../../utils/history'
import { WRITE_STYLE_META, HOOK_CATEGORY_META, isHookCategoryChoice, parseHooks, hooksPlainText, type PendingScriptRun } from '../types'
import { TileDeleteButton } from '../../../components/tileActions'
import DayPill from '../../../components/DayPill'
import RailNewButton from '../../../components/RailNewButton'
import HistoryRailToggle from '../../../components/HistoryRailToggle'
import { GeneratingChip } from '../../../components/GeneratingChip'
import { WARM_METALS, COOL_METALS, metalPlate, METAL_PLATE_INK, METAL_PLATE_RIM, type MetalRamp } from '../../../utils/metal'

const isHooksItem = (item: ScriptHistoryItem) => item.mode === 'write' && item.writeFormat === 'hooks'

// The badge each row leads with — the kind of thing this run produced, plus
// (for Write New) which style wrote it. Same information the old rows carried
// in their title, moved onto the row's own label so the title can be the
// product.
//
// The pills are METAL (September 2026, Massimo's call), the same material
// Voiceovers' voice discs are cut from — a light-to-mid ramp under a diffuse
// bloom, a lit rim, and the label engraved into it in dark ink. They were
// solid fuchsia / blue / amber / emerald / sky, which is four saturated
// rectangles down a column of grey chrome: the loudest thing in the rail was
// a category label nobody is looking for.
//
// The fill is still OPAQUE, which is the half of the previous pass worth
// keeping: the pills before that were 15%-alpha washes, and a 9px label over
// one takes its colour from whatever is behind it, so the same badge read
// differently on a hovered row, a selected one and a plain one. Metal is a
// fixed material in both themes, so its ink is a literal too.
//
// One metal per kind, fixed rather than seeded — the pill has to say the same
// thing every time it appears. They stay distinguishable at a glance (gold /
// copper / steel / silver) without a saturated hue between them.
const BADGE_METALS = {
  hooks: WARM_METALS[3],     // antique gold
  remix: WARM_METALS[1],     // copper
  scenes: COOL_METALS[1],    // steel
  cinematic: WARM_METALS[2], // champagne
  script: COOL_METALS[0],    // silver
} as const

function historyBadge(item: ScriptHistoryItem): { label: string; metal: MetalRamp } {
  if (isHooksItem(item)) {
    const family = isHookCategoryChoice(item.hookCategory) && item.hookCategory !== 'auto'
      ? `${HOOK_CATEGORY_META[item.hookCategory].label} Hooks`
      : 'Hooks'
    return { label: family, metal: BADGE_METALS.hooks }
  }
  if (item.mode === 'remix') {
    return { label: 'Remix', metal: BADGE_METALS.remix }
  }
  if (item.mode === 'reverse-engineer' || (item.mode === 'write' && item.writeFormat === 'scenes')) {
    return { label: 'Scenes', metal: BADGE_METALS.scenes }
  }
  // Rows from the retired Cinematic format keep their own badge — the run
  // really was a cinematic concept, and the label shouldn't lie about it.
  if (item.mode === 'write' && item.writeFormat === 'prompt') {
    return { label: 'Cinematic', metal: BADGE_METALS.cinematic }
  }
  const style = item.writeStyle && item.writeStyle in WRITE_STYLE_META
    ? WRITE_STYLE_META[item.writeStyle as keyof typeof WRITE_STYLE_META].label
    : 'Script'
  return { label: style, metal: BADGE_METALS.script }
}

// The row's preview text — the opening of the first take. Hooks strip their
// <FAMILY> tags (UI metadata, not script text), and every run of whitespace
// collapses to one space: the card this replaced showed ~10 lines and its
// paragraph breaks were part of the preview, where two clamped lines spend one
// of them on a blank line and land the ellipsis under an empty row.
function previewText(item: ScriptHistoryItem): string {
  const first = item.variations[0] ?? ''
  return (isHooksItem(item) ? hooksPlainText(first) : first).replace(/\s+/g, ' ').trim()
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

// A run still being written, shaped as the row it is about to become — so the
// in-progress row is the SAME row, badge and title included, and nothing moves
// when the takes land. `variations: []` is what the row branches on.
function pendingAsItem(run: PendingScriptRun): ScriptHistoryItem {
  return {
    id: run.id,
    mode: run.mode,
    variations: [],
    inputSummary: run.inputSummary,
    productName: run.productName,
    writeStyle: run.writeStyle,
    writeFormat: run.writeFormat,
    hookCategory: run.hookCategory,
    hookCount: run.hookCount,
    variationCount: run.variationCount,
    createdAt: run.startedAt,
  }
}

// What the run is doing, in the pipeline's own words.
function pendingStatus(run: PendingScriptRun): string {
  if (run.mode === 'reverse-engineer') return 'Rewriting scenes…'
  if (run.mode === 'remix') return 'Remixing…'
  return run.writeFormat === 'hooks' ? 'Writing hooks…' : 'Writing…'
}

interface HistoryRailProps {
  items: ScriptHistoryItem[]
  // The runs in flight, newest first. Rendered above the finished rows and
  // never filtered by the search box: they have no takes to match on yet, and
  // hiding the thing you just fired is the opposite of a queue.
  pending: PendingScriptRun[]
  activeId: string | null
  onSelect: (item: ScriptHistoryItem) => void
  onSelectPending: (run: PendingScriptRun) => void
  onDelete: (id: string) => void
  // Empties the takes panel back to its blank canvas. Nothing is deleted — the
  // run it clears is a row in the list directly underneath, which is the whole
  // reason this button can be a single click where the other rails' "New" is
  // armed: the thing it clears is on screen the moment it happens.
  onNew: () => void
  onCollapse: () => void
}

// Scripts' history, as the Ad Analyzer's rail rather than a tab sharing the
// output pane. Two things follow from the move and both are the point: the
// takes are on screen while you browse the list, and the list is a column of
// rows instead of a grid of 272px cards — a run is recognised by its first few
// lines, which a row carries as well as a card did at a fifth of the width.
export default function HistoryRail({ items, pending, activeId, onSelect, onSelectPending, onDelete, onNew, onCollapse }: HistoryRailProps) {
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

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* New leads the rail; the open/shut toggle sits to its LEFT, at the
          band's own edge (September 2026, Massimo's call — the pull tab it
          replaced was clipping the bar across the top of the column beside
          it). The band takes the app-wide h-[57px] so the hairline lines up
          with the input column's header. */}
      <div className="flex h-[57px] shrink-0 items-center gap-1.5 border-b border-ink/5 px-3">
        <HistoryRailToggle open onToggle={onCollapse} />
        <RailNewButton
          label="New Script"
          accentClass="bg-scripts-500"
          title="Clear the takes panel. Every take stays here in History"
          onClick={onNew}
          className="flex-1"
        />
      </div>

      <div className="relative flex shrink-0 items-center border-b border-ink/5 px-3 py-2.5">
        <Search className="pointer-events-none absolute left-6 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search history..."
          className="w-full rounded-full border border-ink/10 bg-transparent py-2 pl-9 pr-3 text-[12.5px] text-ink-100 placeholder-ink-500 outline-none transition-colors focus:border-scripts-500/40"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 && pending.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <FileText className="h-8 w-8 text-ink-800" strokeWidth={1.5} />
            <p className="text-xs text-ink-300">No scripts yet</p>
            <p className="text-[11px] text-ink-500">Your generated scripts will land here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {pending.length > 0 && (
              <>
                <DayPill
                  label={pending.length === 1 ? 'In progress' : `In progress · ${pending.length}`}
                  className="my-1.5"
                />
                {pending.map((run) => (
                  <HistoryRow
                    key={run.id}
                    item={pendingAsItem(run)}
                    pendingLabel={pendingStatus(run)}
                    isActive={activeId === run.id}
                    onSelect={() => onSelectPending(run)}
                    onDelete={() => {}}
                  />
                ))}
              </>
            )}

            {groups.length === 0 ? (
              pending.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-ink-500">No matches.</div>
              )
            ) : (
              groups.map(([dayTs, dayItems]) => (
                <div key={dayTs} className="flex flex-col gap-1">
                  <DayPill label={sectionLabel(dayTs)} className="my-1.5" />
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
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// One run as a rail row: what kind of thing it is, what it was written for,
// and the first lines of the take itself — the writing being the half worth
// recognising, which is why the preview survived the move off the card.
function HistoryRow({
  item,
  pendingLabel,
  isActive,
  onSelect,
  onDelete,
}: {
  item: ScriptHistoryItem
  // Set while this row's takes are still being written: the row previews the
  // shape of what is coming instead of a take it doesn't have, its footer
  // becomes the status chip, and it carries no delete (there is nothing saved
  // to delete — the run is in memory until it lands).
  pendingLabel?: string
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const badge = historyBadge(item)
  const preview = previewText(item)
  // Rows are generated against a product, so the product names the row. The
  // fallbacks cover odd/legacy rows — the brief's first line before the badge
  // label, which would otherwise just repeat the pill above it.
  const title = item.productName?.trim()
    || item.inputSummary.split('\n').map((l) => l.trim()).find(Boolean)
    || badge.label

  return (
    <div
      onClick={onSelect}
      className={`group relative cursor-pointer rounded-xl px-3 py-2.5 transition-colors ${
        isActive
          ? 'bg-scripts-500/15 ring-1 ring-inset ring-scripts-500/30'
          : 'hover:bg-ink/[0.04]'
      }`}
    >
      {/* The delete sits over the badge row's reserved right end (pr-7 below)
          rather than in a column of its own: a 28px column plus its gap is a
          sixth of a 260px rail, taken from the preview for a button that is
          invisible most of the time. */}
      {!pendingLabel && (
        <div className="absolute right-1.5 top-1.5 z-10" onClick={(e) => e.stopPropagation()}>
          <TileDeleteButton variant="chrome" size="sm" alwaysVisible={isActive} onDelete={onDelete} />
        </div>
      )}

      <span
        className={`block w-fit max-w-full truncate rounded-full px-2 py-[3px] text-[9.5px] font-bold uppercase leading-none tracking-[0.04em] ${METAL_PLATE_RIM}`}
        style={{ background: metalPlate(badge.metal), color: METAL_PLATE_INK }}
      >
        {badge.label}
      </span>

      <p className="mt-1.5 line-clamp-1 pr-7 text-[12.5px] font-semibold leading-snug tracking-tight text-ink-100">
        {title}
      </p>

      {pendingLabel ? (
        // Where the take will be. The row's title already says what is being
        // written, so this shows the shape of what is coming rather than
        // repeating the brief back — one breathe for the block, per
        // `.skeleton-group`, not three shimmering lines.
        <div className="skeleton-group mt-1.5 flex flex-col gap-1.5">
          <div className="skeleton h-2 w-full" />
          <div className="skeleton h-2 w-[82%]" />
        </div>
      ) : (
        <p className="mt-1 line-clamp-2 break-words text-[11px] leading-relaxed text-ink-400">
          {preview || 'Empty script'}
        </p>
      )}

      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-ink-600">
        {pendingLabel ? (
          <GeneratingChip family="scripts" label={pendingLabel} />
        ) : (
          <>
            <span className="truncate">{countLabel(item)}</span>
            <span className="shrink-0">·</span>
            <span className="shrink-0 text-ink-700">{formatRelative(item.createdAt)}</span>
          </>
        )}
      </div>
    </div>
  )
}
