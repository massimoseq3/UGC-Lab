import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Ban, CheckCircle2, AlertTriangle, ChevronUp, ChevronDown, Search, Download, Clock, Trash2, X, PauseCircle } from 'lucide-react'
import Spinner from '../../components/Spinner'
import Dropdown from '../../components/Dropdown'
import { getSupabase } from '../../lib/supabase'
import useCloseOnEscape from '../../hooks/useCloseOnEscape'
import { deleteMember } from './deleteMember'
import { QUERY_TIMEOUT_MS, readyAdminSession, withTimeout } from './adminQuery'
import { formatDuration } from '../../utils/usage'
import AppGlyph from './AppGlyph'
import { appName } from './appDisplay'
import {
  useMembers, memberName, memberTopApp, totalSeconds, formatBytes, formatDate, formatRelative,
  daysSinceActive, isActivated, memberStatus, INACTIVE_DAYS,
  type MemberRow, type MemberStatus,
} from './useMembers'

type SortKey = 'name' | 'email' | 'created_at' | 'last_active_at' | 'total_bytes' | 'assets_last_7d' | 'time_30d'
type SortDir = 'asc' | 'desc'
type StatusFilter = 'all' | 'active' | 'inactive' | 'unactivated' | 'lapsed' | 'disabled'

// The phone's stand-in for the sortable column headers — a card list has no
// header row to click, and losing sort would make the list unreadable past a
// few dozen members. Same keys, same default directions.
const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'created_at', label: 'Joined' },
  { value: 'last_active_at', label: 'Last active' },
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
  { value: 'total_bytes', label: 'Storage' },
  { value: 'assets_last_7d', label: '7-day activity' },
  { value: 'time_30d', label: 'Top app / 30d' },
]

const STATUS_LABEL: Record<MemberStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  lapsed: 'Lapsed',
  disabled: 'Disabled',
}

// The app's display name, or an em-dash when nothing has been recorded for the
// member yet. App tracking only started reporting recently, so a blank here
// means "no data", never "opened nothing".
function appLabel(appId: string | undefined): string {
  return appId ? appName(appId) : '—'
}

// One CSV field: quote-wrap and escape embedded quotes when needed.
function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadMembersCsv(rows: MemberRow[]) {
  const header = [
    'Name', 'Email', 'Status', 'Admin', 'Joined', 'Last active', 'Days inactive',
    'Storage bytes', 'Assets', 'Products', 'Characters', 'Scripts', 'Voices',
    'B-rolls', 'Voiceovers', 'Videos', 'Assets last 7d',
    'Top app 30d', 'Minutes 30d', 'Minutes all time',
  ]
  const lines = rows.map((r) => [
    memberName(r) || '—',
    r.email,
    STATUS_LABEL[memberStatus(r)],
    r.is_admin ? 'yes' : 'no',
    formatDate(r.created_at),
    r.last_active_at ? formatDate(r.last_active_at) : 'never',
    Number.isFinite(daysSinceActive(r)) ? daysSinceActive(r) : '',
    r.total_bytes,
    r.asset_count,
    r.products, r.models, r.scripts, r.voices, r.brolls, r.voice_history, r.video_history,
    r.assets_last_7d,
    // Raw minutes, not "2h 14m": a CSV is opened in a spreadsheet and summed.
    appLabel(memberTopApp(r, '30d')?.appId),
    Math.round(totalSeconds(r, '30d') / 60),
    Math.round(totalSeconds(r, 'all') / 60),
  ].map(csvCell).join(','))

  const csv = [header.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ugc-members-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function MembersTable() {
  const { rows, loading, refreshing, slowHint, profilesError, storageWarning, activityWarning, reload } = useMembers()
  const [busyId, setBusyId] = useState<string | null>(null)

  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Moves a member between the three real states. Both columns are always
  // written, never just the one being set — a member can only be in one state,
  // and leaving the other timestamp behind is how a "restored" account stays
  // locked by the flag nobody cleared.
  async function setStatus(row: MemberRow, next: 'active' | 'lapsed' | 'disabled') {
    const now = new Date().toISOString()
    const patch =
      next === 'active' ? { disabled_at: null, lapsed_at: null }
      : next === 'lapsed' ? { disabled_at: null, lapsed_at: now }
      : { disabled_at: now, lapsed_at: null }

    setBusyId(row.id)
    try {
      await readyAdminSession()
      const sb = getSupabase()
      const { error } = await withTimeout(
        (signal) => sb.from('profiles').update(patch).eq('id', row.id).abortSignal(signal),
        QUERY_TIMEOUT_MS,
        'profile update',
      ) as { error: { message: string } | null }
      if (error) throw error
      await reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  function pickSort(key: SortKey) {
    setSortKey(key)
    // Sensible default direction per column
    setSortDir(key === 'email' || key === 'name' ? 'asc' : 'desc')
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else pickSort(key)
  }

  const counts = useMemo(() => {
    let disabled = 0, lapsed = 0, inactive = 0, unactivated = 0
    for (const r of rows) {
      const status = memberStatus(r)
      if (status === 'disabled') { disabled++; continue }
      if (status === 'lapsed') { lapsed++; continue }
      if (status === 'inactive') inactive++
      if (!isActivated(r)) unactivated++
    }
    return { all: rows.length, active: rows.length - disabled - lapsed, disabled, lapsed, inactive, unactivated }
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      const status = memberStatus(r)
      // "Active" is the has-access list, so it keeps the inactive rows too —
      // they can still sign in. Only the two locked states drop out.
      if (statusFilter === 'active' && (status === 'disabled' || status === 'lapsed')) return false
      if (statusFilter === 'disabled' && status !== 'disabled') return false
      if (statusFilter === 'lapsed' && status !== 'lapsed') return false
      if (statusFilter === 'inactive' && status !== 'inactive') return false
      if (statusFilter === 'unactivated' && (status === 'disabled' || status === 'lapsed' || isActivated(r))) return false
      if (q && !r.email.toLowerCase().includes(q) && !memberName(r).toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, statusFilter, query])

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows]
    arr.sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'name':
          cmp = memberName(a).localeCompare(memberName(b))
          break
        case 'email':
          cmp = a.email.localeCompare(b.email)
          break
        case 'created_at':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          break
        case 'time_30d':
          cmp = totalSeconds(a, '30d') - totalSeconds(b, '30d')
          break
        case 'last_active_at': {
          const av = a.last_active_at ? new Date(a.last_active_at).getTime() : new Date(a.created_at).getTime()
          const bv = b.last_active_at ? new Date(b.last_active_at).getTime() : new Date(b.created_at).getTime()
          cmp = av - bv
          break
        }
        case 'total_bytes':
          cmp = a.total_bytes - b.total_bytes
          break
        case 'assets_last_7d':
          cmp = a.assets_last_7d - b.assets_last_7d
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filteredRows, sortKey, sortDir])

  // Admins are never selectable — the RPC refuses them, and the checkbox
  // shouldn't offer something the server will reject.
  const selectableRows = useMemo(() => sortedRows.filter((r) => !r.is_admin), [sortedRows])

  // Selection is scoped to what's on screen: filtering or searching drops
  // anything that scrolled out of view, so the Delete button can never act on
  // a row the operator can't see.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const visible = new Set(selectableRows.map((r) => r.id))
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [selectableRows])

  const selectedRows = useMemo(
    () => selectableRows.filter((r) => selected.has(r.id)),
    [selectableRows, selected],
  )
  const allSelected = selectableRows.length > 0 && selectedRows.length === selectableRows.length

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableRows.map((r) => r.id)))
  }

  // Footer aggregates — rendered independent of sort
  const totals = useMemo(() => {
    const totalBytes = rows.reduce((s, r) => s + r.total_bytes, 0)
    const totalAssets7d = rows.reduce((s, r) => s + r.assets_last_7d, 0)
    return { totalBytes, totalAssets7d }
  }, [rows])

  if (loading) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 text-ink-500">
        <Spinner className="h-4 w-4" />
        {slowHint && <span className="text-[11px]">Still loading… retrying via timeout if it stalls.</span>}
      </div>
    )
  }

  // Only take over the pane when there's nothing to show. A refresh that fails
  // over rows we already loaded reports in a banner and leaves them on screen.
  if (profilesError && rows.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-300 light:text-red-700">
          {profilesError}
        </div>
        <button onClick={reload} className="flex items-center gap-1.5 rounded-md border border-ink/10 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05]">
          <RefreshCw className="h-3 w-3" /> Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {profilesError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-300 light:text-red-700">
          Refresh failed. Showing the last loaded list. {profilesError}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] text-ink-400">
          <span className="text-ink-200">{rows.length}</span> {rows.length === 1 ? 'member' : 'members'}
          <span className="text-ink-600"> · {formatBytes(totals.totalBytes)} total · {totals.totalAssets7d} {totals.totalAssets7d === 1 ? 'generation' : 'generations'} this week</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadMembersCsv(sortedRows)}
            disabled={sortedRows.length === 0}
            title="Export the rows currently shown"
            className="flex items-center gap-1.5 rounded-md border border-ink/10 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05] disabled:opacity-40"
          >
            <Download className="h-3 w-3" /> Export CSV
          </button>
          <button onClick={reload} className="flex items-center gap-1.5 rounded-md border border-ink/10 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05]">
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 max-md:w-full max-md:flex-none">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email…"
            className="w-full rounded-full border border-ink/10 bg-ink/[0.03] py-2 pl-8 pr-3 text-[12px] text-ink-200 outline-none transition-colors placeholder:text-ink-600 focus:border-ink/20 md:py-1.5"
          />
        </div>
        {/* Six pills are twice a phone's width. They swipe rather than wrap:
            a wrapped row costs 30px of a screen that has none to give, and
            the set reads as one scale either way. */}
        <div className="flex max-w-full items-center gap-0.5 overflow-x-auto scrollbar-hide rounded-full border border-ink/10 bg-ink/[0.03] p-0.5 md:overflow-visible">
          {([
            ['all', 'All', counts.all],
            ['active', 'Active', counts.active],
            ['inactive', `Inactive ${INACTIVE_DAYS}d+`, counts.inactive],
            ['unactivated', 'Never used', counts.unactivated],
            ['lapsed', 'Lapsed', counts.lapsed],
            ['disabled', 'Disabled', counts.disabled],
          ] as Array<[StatusFilter, string, number]>).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] transition-colors md:py-1 ${
                statusFilter === key ? 'bg-ink text-paper' : 'text-ink-400 hover:text-ink-200'
              }`}
            >
              {label} <span className={statusFilter === key ? 'text-paper/60' : 'text-ink-600'}>{count}</span>
            </button>
          ))}
        </div>
      </div>

      {selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-full border border-ink/10 bg-ink/[0.03] px-3 py-1.5">
          <span className="text-[12px] text-ink-200">
            {selectedRows.length} selected
            <span className="text-ink-600"> · {formatBytes(selectedRows.reduce((s, r) => s + r.total_bytes, 0))}</span>
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="rounded-full px-2 py-0.5 text-[11px] text-ink-400 transition-colors hover:text-ink-200"
          >
            Clear
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            className="ml-auto flex items-center gap-1.5 rounded-full bg-red-500 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-400"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}

      {storageWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200 light:text-amber-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{storageWarning}</span>
        </div>
      )}
      {activityWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200 light:text-amber-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{activityWarning}</span>
        </div>
      )}

      {/* The card list has no header row to click, so sort and select-all get
          their own line on a phone. */}
      <div className="flex items-center gap-2 md:hidden">
        <label
          title={allSelected ? 'Clear selection' : 'Select all shown'}
          className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-ink/10 bg-ink/[0.03] px-3 text-[11px] text-ink-400"
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={selectableRows.length === 0}
            className="h-3.5 w-3.5 cursor-pointer accent-red-400 disabled:opacity-40"
          />
          All
        </label>
        <Dropdown
          value={sortKey}
          options={SORT_OPTIONS}
          onChange={(v) => pickSort(v as SortKey)}
          accent="neutral"
          label="Sort"
          dense
          className="min-w-0 flex-1"
        />
        <button
          onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-ink/[0.03] text-ink-400 transition-colors hover:text-ink-200"
        >
          {sortDir === 'asc' ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Below `md` the ten-column table has nowhere to go — a horizontal
          scroller would put the name off screen the moment you reach for the
          status. A card per member instead, carrying the same facts and the
          same actions. */}
      <div className="space-y-2 md:hidden">
        {sortedRows.length === 0 && (
          <p className="rounded-xl border border-ink/10 px-3 py-6 text-center text-[12px] text-ink-500">
            No members match this filter.
          </p>
        )}
        {sortedRows.map((r) => (
          <MemberCard
            key={r.id}
            row={r}
            selected={selected.has(r.id)}
            busy={busyId === r.id}
            onToggle={() => toggleRow(r.id)}
            onSetStatus={setStatus}
          />
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-ink/10 md:block">
        <table className="w-full text-[12px]">
          <thead className="bg-ink/[0.03] text-[11px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={selectableRows.length === 0}
                  title={allSelected ? 'Clear selection' : 'Select all shown'}
                  className="h-3.5 w-3.5 cursor-pointer accent-red-400 disabled:opacity-40"
                />
              </th>
              <SortableTh label="Name" k="name" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableTh label="Email" k="email" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableTh label="Joined" k="created_at" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableTh label="Last active" k="last_active_at" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableTh label="Storage" k="total_bytes" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableTh label="7-day activity" k="assets_last_7d" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableTh label="Top app / 30d" k="time_30d" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/5">
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-[12px] text-ink-500">
                  No members match this filter.
                </td>
              </tr>
            )}
            {sortedRows.map((r) => {
              const name = memberName(r)
              const status = memberStatus(r)
              return (
              <tr key={r.id} className={`text-ink-300 ${selected.has(r.id) ? 'bg-red-500/[0.06]' : ''}`}>
                <td className="px-3 py-2 align-top">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleRow(r.id)}
                    disabled={r.is_admin}
                    title={r.is_admin ? 'Admins cannot be deleted here' : undefined}
                    className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="font-medium text-ink-200">{name || <span className="text-ink-600">—</span>}</div>
                  {r.is_admin && <div className="text-[10px] uppercase tracking-wider text-amber-400 light:text-amber-600">Admin</div>}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="text-ink-300">{r.email}</div>
                  <div className="mt-1 text-[10px] text-ink-500">
                    {r.products}p · {r.models}i · {r.scripts}s · {r.voices}v · {r.brolls}b · {r.video_history}vid
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-ink-400">{formatDate(r.created_at)}</td>
                <td className="px-3 py-2 align-top text-ink-400">
                  <span className={status === 'inactive' ? 'text-amber-400 light:text-amber-600' : undefined}>{formatRelative(r.last_active_at)}</span>
                </td>
                <td className="px-3 py-2 align-top text-ink-400">
                  {formatBytes(r.total_bytes)}
                  <span className="text-ink-600"> ({r.asset_count})</span>
                </td>
                <td className="px-3 py-2 align-top text-ink-400">
                  {r.assets_last_7d > 0 ? (
                    <span className="text-ink-200">{r.assets_last_7d}</span>
                  ) : (
                    <span className="text-ink-600">0</span>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <TopAppCell row={r} />
                </td>
                <td className="px-3 py-2 align-top">
                  <StatusPill status={status} />
                </td>
                <td className="px-3 py-2 align-top text-right">
                  <StatusActions
                    row={r}
                    status={status}
                    busy={busyId === r.id}
                    onSetStatus={setStatus}
                    className="flex items-center justify-end gap-1"
                    btnClass={ACTION_BTN}
                  />
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-ink-600">
        Bank counts: <span className="text-ink-500">p</span>roducts · <span className="text-ink-500">i</span>nfluencers · <span className="text-ink-500">s</span>cripts · <span className="text-ink-500">v</span>oices · <span className="text-ink-500">b</span>-rolls · <span className="text-ink-500">vid</span>eos.
      </p>

      {confirmingDelete && (
        <DeleteMembersModal
          members={selectedRows}
          onClose={() => setConfirmingDelete(false)}
          onDeleted={(deletedIds) => {
            setSelected((prev) => new Set([...prev].filter((id) => !deletedIds.has(id))))
            reload()
          }}
        />
      )}
    </div>
  )
}

// Confirm + run a bulk hard delete. Stays open on failure so the per-member
// errors are readable; the table behind it reloads either way.
function DeleteMembersModal({
  members,
  onClose,
  onDeleted,
}: {
  members: MemberRow[]
  onClose: () => void
  onDeleted: (deletedIds: Set<string>) => void
}) {
  const [removeFromAllowlist, setRemoveFromAllowlist] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [failures, setFailures] = useState<Array<{ email: string; message: string }>>([])
  const [warnings, setWarnings] = useState<string[]>([])

  useCloseOnEscape(!running, onClose)

  const totalBytes = members.reduce((s, m) => s + m.total_bytes, 0)

  async function run() {
    setRunning(true)
    setProgress(0)
    setFailures([])
    setWarnings([])
    const done = new Set<string>()
    const failed: Array<{ email: string; message: string }> = []
    const warned: string[] = []

    // Sequential on purpose: each delete purges R2 and then cascades a whole
    // account, and a readable per-member failure beats a fast parallel run.
    for (const m of members) {
      try {
        const res = await deleteMember(m.id, { removeFromAllowlist })
        done.add(m.id)
        if (res.storageWarning) warned.push(`${m.email}: ${res.storageWarning}`)
      } catch (e) {
        failed.push({ email: m.email, message: e instanceof Error ? e.message : String(e) })
      }
      setProgress(done.size + failed.length)
    }

    setRunning(false)
    setFailures(failed)
    setWarnings(warned)
    onDeleted(done)
    if (failed.length === 0 && warned.length === 0) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-ink/10 bg-surface-2 p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink-100">
              Delete {members.length} {members.length === 1 ? 'member' : 'members'}?
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-500">
              Their account and everything in it: banks, history, {formatBytes(totalBytes)} of storage. Not reversible.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            className="rounded-md p-1 text-ink-500 transition-colors hover:bg-ink/[0.05] hover:text-ink-200 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 max-h-40 overflow-y-auto rounded-lg border border-ink/10 bg-ink/[0.02] p-2 text-[11px]">
          {members.map((m) => (
            <div key={m.id} className="flex items-baseline justify-between gap-2">
              <span className="truncate text-ink-300">{m.email}</span>
              <span className="shrink-0 text-ink-600">{formatBytes(m.total_bytes)}</span>
            </div>
          ))}
        </div>

        {/* Label and caveat are ONE sentence in one box: as three flex
            children the caveat became a second column the moment the label
            wrapped, and the two read as unrelated lines. */}
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12px] text-ink-300">
          <input
            type="checkbox"
            checked={removeFromAllowlist}
            onChange={(e) => setRemoveFromAllowlist(e.target.checked)}
            disabled={running}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-red-400"
          />
          <span>
            Also remove from the allowlist{' '}
            <span className="text-ink-600">otherwise they can sign up again</span>
          </span>
        </label>

        {failures.length > 0 && (
          <div className="mt-3 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300 light:text-red-700">
            {failures.map((f) => <div key={f.email}><span className="font-medium">{f.email}</span>: {f.message}</div>)}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mt-2 max-h-24 space-y-1 overflow-y-auto rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200 light:text-amber-800">
            {warnings.map((w, i) => <div key={i}>{w}</div>)}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={running}
            className="rounded-lg border border-ink/10 px-3 py-1.5 text-[12px] text-ink-300 transition-colors hover:bg-ink/[0.05] disabled:opacity-50"
          >
            {failures.length > 0 || warnings.length > 0 ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={run}
            disabled={running || members.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-red-400 disabled:opacity-60"
          >
            {running && <Spinner className="h-3 w-3" />}
            {running ? `Deleting ${progress + 1} of ${members.length}…` : `Delete ${members.length}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// One member as a card, for the phone. Identity + status on the first line
// (the two things you scan for), the table's numbers as a two-up meta grid,
// then the same status actions the row carries — full-width, since a 24px
// text button is a desktop target.
function MemberCard({
  row, selected, busy, onToggle, onSetStatus,
}: {
  row: MemberRow
  selected: boolean
  busy: boolean
  onToggle: () => void
  onSetStatus: (row: MemberRow, next: 'active' | 'lapsed' | 'disabled') => void
}) {
  const name = memberName(row)
  const status = memberStatus(row)
  const top = memberTopApp(row, '30d')
  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        selected ? 'border-red-500/30 bg-red-500/[0.06]' : 'border-ink/10 bg-ink/[0.02]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={row.is_admin}
          title={row.is_admin ? 'Admins cannot be deleted here' : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-red-400 disabled:cursor-not-allowed disabled:opacity-30"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-ink-200">
              {name || <span className="text-ink-600">—</span>}
            </span>
            {row.is_admin && (
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-amber-400 light:text-amber-600">Admin</span>
            )}
          </div>
          {/* Emails run past a phone's width and the local part is the half
              that identifies the member, so it wraps rather than truncates. */}
          <div className="break-all text-[11px] text-ink-500">{row.email}</div>
        </div>
        <div className="shrink-0"><StatusPill status={status} /></div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <Meta label="Joined" value={formatDate(row.created_at)} />
        <Meta
          label="Last active"
          value={formatRelative(row.last_active_at)}
          accent={status === 'inactive' ? 'text-amber-400 light:text-amber-600' : undefined}
        />
        <Meta label="Storage" value={`${formatBytes(row.total_bytes)} (${row.asset_count})`} />
        <Meta label="7-day activity" value={String(row.assets_last_7d)} />
        <Meta label="Top app / 30d" value={appLabel(top?.appId)} glyph={top?.appId} />
        <Meta label="Time / 30d" value={top ? formatDuration(totalSeconds(row, '30d')) : '—'} />
      </dl>

      <div className="mt-2.5 text-[10px] text-ink-600">
        {row.products}p · {row.models}i · {row.scripts}s · {row.voices}v · {row.brolls}b · {row.video_history}vid
      </div>

      <StatusActions
        row={row}
        status={status}
        busy={busy}
        onSetStatus={onSetStatus}
        className="mt-3 flex gap-2 border-t border-ink/5 pt-3"
        btnClass={ACTION_BTN_MOBILE}
      />
    </div>
  )
}

function Meta({ label, value, accent, glyph }: { label: string; value: string; accent?: string; glyph?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-ink-600">{label}</dt>
      <dd className={`mt-0.5 flex items-center gap-1.5 text-[12px] ${accent ?? 'text-ink-300'}`}>
        {glyph && <AppGlyph appId={glyph} className="h-3 w-3 shrink-0" />}
        <span className="truncate">{value}</span>
      </dd>
    </div>
  )
}

// Lapse / Disable / Re-enable, shared by the table row and the phone card so
// the two can't drift apart. Only the wrapper and the button shape differ.
function StatusActions({
  row, status, busy, onSetStatus, className, btnClass,
}: {
  row: MemberRow
  status: MemberStatus
  busy: boolean
  onSetStatus: (row: MemberRow, next: 'active' | 'lapsed' | 'disabled') => void
  className: string
  btnClass: string
}) {
  const locked = busy || row.is_admin
  return (
    <div className={className}>
      {status === 'disabled' ? (
        <button
          onClick={() => onSetStatus(row, 'active')}
          disabled={locked}
          title="Give this account its access back"
          className={btnClass}
        >
          Re-enable
        </button>
      ) : (
        <>
          <button
            onClick={() => onSetStatus(row, status === 'lapsed' ? 'active' : 'lapsed')}
            disabled={locked}
            title={status === 'lapsed'
              ? 'Unlock now, without waiting for them to enter the code'
              : 'Lock the account but let them back in with the current access code'}
            className={btnClass}
          >
            {status === 'lapsed' ? 'Restore' : 'Lapse'}
          </button>
          <button
            onClick={() => onSetStatus(row, 'disabled')}
            disabled={locked}
            title="Lock the account · only you can reopen it"
            className={btnClass}
          >
            Disable
          </button>
        </>
      )}
    </div>
  )
}

// Where this member spends their time, over the last 30 days. Two readings in
// one cell: the tool itself, and the total under it — a member whose top app is
// B-Roll at 12 minutes is a very different member from one at nine hours.
function TopAppCell({ row }: { row: MemberRow }) {
  const top = memberTopApp(row, '30d')
  const total = totalSeconds(row, '30d')
  if (!top) return <span className="text-ink-600">—</span>
  return (
    <div>
      <div className="flex items-center gap-1.5 text-ink-200">
        <AppGlyph appId={top.appId} className="h-3 w-3 shrink-0" />
        <span className="truncate">{appLabel(top.appId)}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-ink-500">{formatDuration(total)} total</div>
    </div>
  )
}

function SortableTh({
  label, k, sortKey, sortDir, onClick,
}: {
  label: string
  k: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onClick: (k: SortKey) => void
}) {
  const active = sortKey === k
  return (
    <th
      onClick={() => onClick(k)}
      className="cursor-pointer select-none px-3 py-2 text-left font-medium transition-colors hover:text-ink-300"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  )
}

const ACTION_BTN =
  'rounded-md border border-ink/10 px-2 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05] disabled:opacity-40'

// Same button, thumb-sized: the card gives it the full width of the card
// rather than the tail of a right-aligned row.
const ACTION_BTN_MOBILE =
  'flex-1 rounded-lg border border-ink/10 py-2 text-[12px] text-ink-300 transition-colors hover:bg-ink/[0.05] disabled:opacity-40'

// Lapsed gets its own violet rather than a second amber: Inactive means "still
// has access, hasn't used it", Lapsed means "locked out until they enter the
// code". Two shades of the same colour would read as two shades of one idea,
// and the Insights donut — which has no glyph to fall back on — needs them
// told apart at a glance.
function StatusPill({ status }: { status: MemberStatus }) {
  if (status === 'disabled') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300 light:text-red-700"><Ban className="h-2.5 w-2.5" /> Disabled</span>
  }
  if (status === 'lapsed') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300 light:text-violet-700"><PauseCircle className="h-2.5 w-2.5" /> Lapsed</span>
  }
  if (status === 'inactive') {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300 light:text-amber-700"><Clock className="h-2.5 w-2.5" /> Inactive</span>
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 light:text-emerald-700"><CheckCircle2 className="h-2.5 w-2.5" /> Active</span>
}
