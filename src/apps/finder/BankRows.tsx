import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Star } from 'lucide-react'
import type { BankType } from '../../utils/constants'
import { useBankStore } from '../../stores/bankStore'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { TileDeleteButton } from '../../components/tileActions'
import { startOfDay } from '../../utils/history'
import { describeRow, type BankItem, type BankRow } from './bankRow'
import { canSortByName, sortByOrder, type SortOrder } from './bankSort'

/**
 * The Bank's list view — one shape for all seven banks.
 *
 * The grid view draws seven different cards because seven kinds of thing look
 * different; the list view draws one row because what you do in a list is scan
 * a column. Everything it knows about a row comes from `describeRow`, so the
 * banks can't drift apart here the way their cards have.
 *
 * The column template lives in one constant shared by the header and the rows —
 * two grids that have to agree on their tracks are one edit away from not.
 * Below `md` only Name and the row's actions survive; Kind and Date move into
 * the meta line under the title, which is the phone shape the Admin tables use.
 */
const MD_TRACKS = 'md:grid-cols-[minmax(0,1fr)_116px_132px_72px]'
const ROW_GRID = `grid grid-cols-[minmax(0,1fr)_72px] items-center gap-3 ${MD_TRACKS}`
const HEADER_GRID = `hidden items-center gap-3 md:grid ${MD_TRACKS}`

/** Date-added cell. Compact enough for a 132px column, exact enough to sort by. */
function rowDate(ts: number): string {
  const today = startOfDay(Date.now())
  const day = startOfDay(ts)
  if (day === today) return `Today ${new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  if (day === today - 86_400_000) return 'Yesterday'
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The clickable column headers.
 *
 * Deliberately NOT pinned. It sits inside the bank's scroll port, one row above
 * the list, and scrolls away with it — because the two ways to pin it both cost
 * more than they buy. `sticky` inside the port needs an opaque fill of its own,
 * and this pane is transparent over the desktop gradient, so that fill paints a
 * flat patch across it. Lifting it OUT of the port (the house rule for chrome
 * that must not move) puts it in a box with no scrollbar gutter while the rows
 * have an 11px one, so the right-hand columns sit 11px off their own values —
 * and only once the list is long enough to overflow, which is exactly when a
 * pinned header would matter. Inside the port the tracks align by construction.
 * The toolbar's Sort control stays visible in list view for that reason: it is
 * the way to re-sort a bank you have already scrolled down.
 *
 * `md` and up only — on a phone there is no room for three columns, so there
 * would be nothing to head.
 */
function BankRowsHeader({ bankType, sort, onSort }: { bankType: BankType; sort: SortOrder; onSort: (v: SortOrder) => void }) {
  const sortsByName = canSortByName(bankType)
  const byName = sort === 'name-asc' || sort === 'name-desc'
  const byDate = sort === 'newest' || sort === 'oldest'
  const arrow = (asc: boolean) => (asc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
  return (
    <div className={`mb-1 border-b border-ink/5 px-2 pb-2 text-[11px] font-medium tracking-tight text-ink-500 ${HEADER_GRID}`}>
      {sortsByName ? (
        <button
          type="button"
          onClick={() => onSort(sort === 'name-asc' ? 'name-desc' : 'name-asc')}
          className={`flex items-center gap-1 justify-self-start transition-colors hover:text-ink-200 ${byName ? 'text-ink-200' : ''}`}
        >
          Name {byName && arrow(sort === 'name-asc')}
        </button>
      ) : (
        <span>Name</span>
      )}
      <span>Kind</span>
      <button
        type="button"
        onClick={() => onSort(sort === 'newest' ? 'oldest' : 'newest')}
        className={`flex items-center gap-1 justify-self-start transition-colors hover:text-ink-200 ${byDate ? 'text-ink-200' : ''}`}
      >
        Date added {byDate && arrow(sort === 'oldest')}
      </button>
      <span />
    </div>
  )
}

function RowThumb({ row }: { row: BankRow }) {
  const url = useAssetUrl(row.thumbRef)
  const Icon = row.icon
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink/[0.05]">
      {url
        ? <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        : <Icon className="h-4 w-4 text-ink-600" strokeWidth={1.5} />}
    </div>
  )
}

function Row({ row, bankType, onOpen, onDelete }: { row: BankRow; bankType: BankType; onOpen: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const toggleStar = useBankStore((s) => s.toggleStar)
  return (
    <div
      onClick={onOpen}
      className={`group cursor-pointer rounded-xl px-2 py-1.5 transition-colors hover:bg-ink/[0.04] ${ROW_GRID}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <RowThumb row={row} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium tracking-tight text-ink-100">{row.title}</span>
          {/* Kind and date live in their own columns from `md` up; on a phone
              they join the subtitle line, which is the only line there is. */}
          <span className="truncate text-[11px] text-ink-500 md:hidden">
            {row.kind} · {rowDate(row.createdAt)}
          </span>
          {row.subtitle && <span className="hidden truncate text-[11px] text-ink-500 md:block">{row.subtitle}</span>}
        </div>
      </div>
      <span className="hidden truncate text-[11.5px] text-ink-400 md:block">{row.kind}</span>
      <span className="hidden truncate text-[11.5px] text-ink-500 md:block">{rowDate(row.createdAt)}</span>
      {/* The star stays visible once set — it's state, not an affordance. */}
      <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        {row.canStar && bankType !== 'voices' && (
          <button
            type="button"
            onClick={() => toggleStar(bankType, row.id)}
            title={row.starred ? 'Unstar' : 'Star — starred items show first when picking from banks'}
            aria-pressed={row.starred}
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-all hover:bg-ink/5 ${
              row.starred ? 'text-amber-400' : 'text-ink-700 opacity-0 hover:text-amber-400 group-hover:opacity-100 touch:opacity-100'
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${row.starred ? 'fill-current' : ''}`} />
          </button>
        )}
        {/* The WRAPPER owns the fade, and `alwaysVisible` stops the button
            fading itself: its own fade has no `touch:` variant (inside a
            `TileActionStack` the stack's ⋯ doorway is what reveals it), so a
            bare one is invisible AND unreachable on a phone. */}
        <div className={`transition-opacity ${confirm ? '' : 'opacity-0 group-hover:opacity-100 touch:opacity-100'}`}>
          <TileDeleteButton alwaysVisible variant="chrome" size="sm" onDelete={onDelete} onArmedChange={setConfirm} />
        </div>
      </div>
    </div>
  )
}

export default function BankRows({ items, bankType, sort, onSort, onEdit, onDelete }: {
  items: BankItem[]
  bankType: BankType
  sort: SortOrder
  onSort: (v: SortOrder) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const rows = useMemo(
    () => sortByOrder(items.map((item) => describeRow(bankType, item)), sort, (r) => r.title),
    [items, bankType, sort],
  )
  return (
    <div className="flex flex-col gap-0.5">
      <BankRowsHeader bankType={bankType} sort={sort} onSort={onSort} />
      {rows.map((row) => (
        <Row
          key={row.id}
          row={row}
          bankType={bankType}
          onOpen={() => onEdit(row.id)}
          onDelete={() => onDelete(row.id)}
        />
      ))}
    </div>
  )
}
