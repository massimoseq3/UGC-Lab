import { useMemo } from 'react'
import { Loader2, RefreshCw, Users, UserCheck, Clock, Ban, HardDrive, Sparkles, TrendingUp, TrendingDown, UserPlus, AlertTriangle } from 'lucide-react'
import { useMembers, formatBytes, formatRelative, memberName, isInactive, isActivated, type MemberRow } from './useMembers'

const DAY = 24 * 60 * 60_000

// Is the timestamp `s` between `lo` and `hi` days old, measured from `now`?
// Module scope on purpose: `now` is passed in rather than read from the clock,
// so nothing here calls an impure function during render.
function withinDays(s: string | null, lo: number, hi: number, now: number): boolean {
  if (!s) return false
  const age = now - new Date(s).getTime()
  return age >= lo * DAY && age < hi * DAY
}

// Per-bank accent hexes (mirror of BANK_CONFIG, plus a videos tint).
const BANK_BARS: Array<{ key: keyof MemberRow; label: string; color: string }> = [
  { key: 'products', label: 'Products', color: '#f59e0b' },
  { key: 'models', label: 'Characters', color: '#F74F9E' },
  { key: 'scripts', label: 'Scripts', color: '#F05A24' },
  { key: 'voices', label: 'Voices', color: '#007AFF' },
  { key: 'brolls', label: 'B-Rolls', color: '#7165FF' },
  { key: 'video_history', label: 'Videos', color: '#22c55e' },
]

export default function Insights() {
  const { rows, fetchedAt, loading, refreshing, slowHint, profilesError, reload } = useMembers()

  const stats = useMemo(() => {
    let active = 0, inactive = 0, disabled = 0, bytes = 0, gens7d = 0
    for (const r of rows) {
      if (r.disabled_at) disabled++
      else if (isInactive(r)) { inactive++; active++ }
      else active++
      bytes += r.total_bytes
      gens7d += r.assets_last_7d
    }
    return { total: rows.length, active, inactive, disabled, bytes, gens7d }
  }, [rows])

  // Cumulative members by month (YYYY-MM) from created_at.
  const signups = useMemo(() => {
    const byMonth = new Map<string, number>()
    for (const r of rows) {
      if (!r.created_at) continue
      const key = r.created_at.slice(0, 7)
      byMonth.set(key, (byMonth.get(key) ?? 0) + 1)
    }
    const months = [...byMonth.keys()].sort()
    // Plain loop rather than a mutating .map callback: a closure that reassigns
    // an outer variable is flagged as escaping render (react-hooks/immutability).
    const out: Array<{ month: string; added: number; total: number }> = []
    let running = 0
    for (const m of months) {
      const added = byMonth.get(m) ?? 0
      running += added
      out.push({ month: m, added, total: running })
    }
    return out
  }, [rows])

  const bankTotals = useMemo(
    () => BANK_BARS.map((b) => ({ ...b, value: rows.reduce((s, r) => s + (r[b.key] as number), 0) })),
    [rows],
  )

  const topStorage = useMemo(
    () => [...rows].sort((a, b) => b.total_bytes - a.total_bytes).filter((r) => r.total_bytes > 0).slice(0, 8),
    [rows],
  )

  // Joined → made ≥1 asset → active in the last 7 days. Shows where the leak is.
  const funnel = useMemo(() => {
    const joined = rows.length
    const activated = rows.filter(isActivated).length
    const active7d = rows.filter((r) => r.assets_last_7d > 0).length
    return { joined, activated, active7d }
  }, [rows])

  // Productive members (made things) who have now gone quiet but aren't disabled
  // — the expensive ones to lose, still saveable. Ranked by lifetime output.
  const atRisk = useMemo(
    () => rows.filter((r) => isInactive(r) && isActivated(r)).sort((a, b) => b.asset_count - a.asset_count).slice(0, 6),
    [rows],
  )

  // Signup/churn momentum: this 7-day window vs the previous one.
  const growth = useMemo(() => {
    const newThisWeek = rows.filter((r) => withinDays(r.created_at, 0, 7, fetchedAt)).length
    const newLastWeek = rows.filter((r) => withinDays(r.created_at, 7, 14, fetchedAt)).length
    const disabledThisWeek = rows.filter((r) => withinDays(r.disabled_at, 0, 7, fetchedAt)).length
    return { newThisWeek, newLastWeek, disabledThisWeek, net: newThisWeek - disabledThisWeek }
  }, [rows, fetchedAt])

  if (loading) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        {slowHint && <span className="text-[11px]">Still loading…</span>}
      </div>
    )
  }

  // Same rule as MembersTable: only take over the pane when there's nothing to
  // show. A failed refresh over loaded rows reports in a banner.
  if (profilesError && rows.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-300 light:text-red-700">{profilesError}</div>
        <button onClick={reload} className="flex items-center gap-1.5 rounded-md border border-ink/10 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05]">
          <RefreshCw className="h-3 w-3" /> Try again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {profilesError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-300 light:text-red-700">
          Refresh failed — showing the last loaded numbers. {profilesError}
        </div>
      )}
      <div className="flex items-center justify-end">
        <button onClick={reload} className="flex items-center gap-1.5 rounded-md border border-ink/10 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05]">
          <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Users} label="Members" value={String(stats.total)} />
        <StatCard icon={UserCheck} label="Active" value={String(stats.active)} accent="text-emerald-400 light:text-emerald-600" />
        <StatCard icon={Clock} label={'Inactive 30d+'} value={String(stats.inactive)} accent="text-amber-400 light:text-amber-600" />
        <StatCard icon={Ban} label="Disabled" value={String(stats.disabled)} accent="text-red-400 light:text-red-600" />
        <StatCard icon={HardDrive} label="Storage" value={formatBytes(stats.bytes)} />
        <StatCard icon={Sparkles} label="Gens / 7d" value={String(stats.gens7d)} />
      </div>

      <GrowthStrip growth={growth} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Activation funnel" hint="joined → created → active">
          <ActivationFunnel funnel={funnel} />
        </Panel>
        <Panel title="Churn risk" hint="productive but going quiet">
          <AtRiskList rows={atRisk} />
        </Panel>
        <Panel title="Members over time" hint="cumulative signups by month">
          <SignupsChart data={signups} />
        </Panel>
        <Panel title="Status mix" hint="share of all members">
          <StatusDonut active={stats.active - stats.inactive} inactive={stats.inactive} disabled={stats.disabled} />
        </Panel>
        <Panel title="Bank usage" hint="total assets created across all members">
          <BarList items={bankTotals.map((b) => ({ label: b.label, value: b.value, color: b.color }))} />
        </Panel>
        <Panel title="Top storage" hint="largest 8 members by stored bytes">
          {topStorage.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-ink-500">No stored assets yet.</p>
          ) : (
            <BarList
              items={topStorage.map((r) => ({
                label: memberName(r) || r.email,
                value: r.total_bytes,
                color: '#6366f1',
                display: formatBytes(r.total_bytes),
              }))}
            />
          )}
        </Panel>
      </div>
    </div>
  )
}

// Signups this week vs last + churn, with a directional delta on signups.
function GrowthStrip({ growth }: { growth: { newThisWeek: number; newLastWeek: number; disabledThisWeek: number; net: number } }) {
  const delta = growth.newThisWeek - growth.newLastWeek
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : null
  const deltaColor = delta > 0 ? 'text-emerald-400 light:text-emerald-600' : delta < 0 ? 'text-red-400 light:text-red-600' : 'text-ink-500'
  return (
    <div className="grid grid-cols-3 gap-3 rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
      <div>
        <div className="flex items-center gap-1.5 text-[11px] text-ink-500"><UserPlus className="h-3.5 w-3.5" /> New this week</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight text-ink-100">{growth.newThisWeek}</span>
          <span className={`flex items-center gap-0.5 text-[11px] ${deltaColor}`}>
            {DeltaIcon && <DeltaIcon className="h-3 w-3" />}
            {delta === 0 ? 'flat' : `${delta > 0 ? '+' : ''}${delta} vs last wk`}
          </span>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-1.5 text-[11px] text-ink-500"><Ban className="h-3.5 w-3.5" /> Disabled this week</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight text-ink-100">{growth.disabledThisWeek}</div>
      </div>
      <div>
        <div className="flex items-center gap-1.5 text-[11px] text-ink-500">Net change</div>
        <div className={`mt-1 text-2xl font-semibold tracking-tight ${growth.net > 0 ? 'text-emerald-400 light:text-emerald-600' : growth.net < 0 ? 'text-red-400 light:text-red-600' : 'text-ink-100'}`}>
          {growth.net > 0 ? '+' : ''}{growth.net}
        </div>
      </div>
    </div>
  )
}

// Three-stage funnel with the conversion % off the top of funnel and the
// step-to-step drop. Tells you whether the leak is activation or retention.
function ActivationFunnel({ funnel }: { funnel: { joined: number; activated: number; active7d: number } }) {
  const { joined, activated, active7d } = funnel
  const pct = (n: number) => (joined > 0 ? Math.round((n / joined) * 100) : 0)
  const stages = [
    { label: 'Joined', value: joined, color: '#6366f1' },
    { label: 'Created ≥1 asset', value: activated, color: '#10b981' },
    { label: 'Active this week', value: active7d, color: '#f59e0b' },
  ]
  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => (
        <div key={s.label}>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-ink-300">{s.label}</span>
            <span className="tabular-nums text-ink-500">{s.value}{i > 0 && joined > 0 ? ` · ${pct(s.value)}%` : ''}</span>
          </div>
          <div className="h-5 overflow-hidden rounded-full bg-ink/[0.06]">
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct(s.value)}%`, backgroundColor: s.color, minWidth: s.value > 0 ? 6 : 0 }} />
          </div>
        </div>
      ))}
      <p className="pt-1 text-[10px] text-ink-600">
        {joined - activated} never created anything · {activated - active7d} activated but quiet this week
      </p>
    </div>
  )
}

// Compact churn-watchlist: who to nudge, with lifetime output + last seen.
function AtRiskList({ rows }: { rows: MemberRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center text-ink-500">
        <AlertTriangle className="h-4 w-4 text-emerald-400 light:text-emerald-600" />
        <span className="text-[12px]">No productive members are going quiet. </span>
      </div>
    )
  }
  return (
    <div className="divide-y divide-ink/5">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <div className="truncate text-[12px] text-ink-200">{memberName(r) || r.email}</div>
            <div className="truncate text-[10px] text-ink-500">{r.email}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[12px] tabular-nums text-ink-300">{r.asset_count} assets</div>
            <div className="text-[10px] text-amber-400 light:text-amber-600">seen {formatRelative(r.last_active_at)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-500">
        <Icon className={`h-3.5 w-3.5 ${accent ?? ''}`} />
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${accent ?? 'text-ink-100'}`}>{value}</div>
    </div>
  )
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[13px] font-medium text-ink-200">{title}</h3>
        {hint && <span className="text-[10px] text-ink-600">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

// Horizontal bars sized to the max value. Themed bar track + colored fill.
function BarList({ items }: { items: Array<{ label: string; value: number; color: string; display?: string }> }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (items.every((i) => i.value === 0)) {
    return <p className="py-6 text-center text-[12px] text-ink-500">No data yet.</p>
  }
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-24 shrink-0 truncate text-[11px] text-ink-400" title={it.label}>{it.label}</div>
          <div className="h-4 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${(it.value / max) * 100}%`, backgroundColor: it.color, minWidth: it.value > 0 ? 4 : 0 }}
            />
          </div>
          <div className="w-14 shrink-0 text-right text-[11px] tabular-nums text-ink-300">{it.display ?? it.value}</div>
        </div>
      ))}
    </div>
  )
}

// Cumulative-signups area + line chart in a fixed viewBox, scaled by CSS.
function SignupsChart({ data }: { data: Array<{ month: string; total: number; added: number }> }) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-[12px] text-ink-500">No signups yet.</p>
  }
  const W = 600, H = 180, padL = 8, padR = 8, padT = 10, padB = 22
  const maxY = Math.max(1, ...data.map((d) => d.total))
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const x = (i: number) => padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const y = (v: number) => padT + innerH - (v / maxY) * innerH
  const pts = data.map((d, i) => `${x(i)},${y(d.total)}`)
  const area = `${padL},${padT + innerH} ${pts.join(' ')} ${x(data.length - 1)},${padT + innerH}`
  const fmtMonth = (m: string) => {
    const [yr, mo] = m.split('-')
    return `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo)]} ${yr.slice(2)}`
  }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Cumulative signups by month">
        <polygon points={area} fill="currentColor" className="text-emerald-500/10" />
        <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="text-emerald-400 light:text-emerald-600" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.total)} r={2.5} fill="currentColor" className="text-emerald-400 light:text-emerald-600" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-600">
        <span>{fmtMonth(data[0].month)}</span>
        <span className="text-ink-400">{data[data.length - 1].total} total</span>
        <span>{fmtMonth(data[data.length - 1].month)}</span>
      </div>
    </div>
  )
}

// Three-segment donut: active / inactive / disabled.
function StatusDonut({ active, inactive, disabled }: { active: number; inactive: number; disabled: number }) {
  const total = active + inactive + disabled
  const segments = [
    { label: 'Active', value: active, color: '#10b981' },
    { label: 'Inactive', value: inactive, color: '#f59e0b' },
    { label: 'Disabled', value: disabled, color: '#ef4444' },
  ]
  const r = 60, C = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 160 160" className="h-32 w-32 shrink-0 -rotate-90">
        <circle cx={80} cy={80} r={r} fill="none" stroke="currentColor" strokeWidth={16} className="text-ink/[0.06]" />
        {total > 0 && segments.map((s, i) => {
          const len = (s.value / total) * C
          const el = (
            <circle key={i} cx={80} cy={80} r={r} fill="none" stroke={s.color} strokeWidth={16}
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />
          )
          offset += len
          return el
        })}
      </svg>
      <div className="space-y-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-[12px]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-ink-300">{s.label}</span>
            <span className="tabular-nums text-ink-500">{s.value}{total > 0 ? ` · ${Math.round((s.value / total) * 100)}%` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
