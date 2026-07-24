import { useEffect, useMemo } from 'react'
import { Clock, PiggyBank, Flame, Trophy, CalendarCheck, ArrowUpRight, GraduationCap } from 'lucide-react'
import type { ElementType, ReactNode } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useBankStore, backfillUsageLedger } from '../../stores/bankStore'
import { isCloudEnabled } from '../../lib/supabase'
import { creditsToUsd } from '../../utils/models'
import { computeUsageMetrics, usageDayStart } from '../../utils/usage'
import { getAppConfig, AI_UGC_ACADEMY_URL } from '../../utils/constants'
import { TEAM } from '../../utils/team'
import CrabSprite from '../../components/CrabSprite'
import ActivityHeatmap from './ActivityHeatmap'
import ConnectKeyCard from './ConnectKeyCard'

// Dashboard — the workspace's "what you're getting out of this" screen and the
// default landing page. Greeting + a bento grid: time saved, money saved vs
// paying for the same models elsewhere, streaks, a GitHub-style activity
// heatmap, and the crab crew as app shortcuts. Everything derives from the
// usage ledger (bankStore.usageDays); nothing here writes data.

// Display face for the greeting + hero stats — same Instrument Serif italic
// the wordmark and Meet-your-team headline use.
const DISPLAY_FONT = { fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }

// Subtle lift under every bento element (cards, links, team tiles).
const CARD_SHADOW = 'shadow-lg shadow-black/20 light:shadow-black/[0.08]'

function greetingForHour(hour: number): string {
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// "42 min" → "6.5 hrs" → "38 hrs". Workday framing lives in the sub-line.
function formatTimeSaved(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 10) return `${(Math.round(hours * 10) / 10).toString()} hrs`
  return `${Math.round(hours)} hrs`
}

function formatUsd(usd: number): string {
  if (usd >= 100) return `$${Math.round(usd).toLocaleString()}`
  if (usd >= 10) return `$${usd.toFixed(0)}`
  return `$${usd.toFixed(2)}`
}

export default function Dashboard() {
  const profile = useAuthStore((s) => s.profile)
  const usageDays = useBankStore((s) => s.usageDays)
  const openApp = useAppStore((s) => s.openApp)
  const kieApiKey = useSettingsStore((s) => s.kieApiKey)
  const needsKey = kieApiKey.trim().length === 0

  // Cloud mode backfills after hydrate (cloudSync); local-only has no hydrate,
  // so seed the ledger from local history the first time the Dashboard opens.
  useEffect(() => {
    if (!isCloudEnabled()) backfillUsageLedger()
  }, [])

  const metrics = useMemo(() => computeUsageMetrics(usageDays, creditsToUsd), [usageDays])

  // Prefer the name the user set in Settings ("What should we call you?"),
  // falling back to their sign-up first name.
  const displayName = profile?.display_name?.trim() || profile?.first_name?.trim()
  const greeting = `${greetingForHour(new Date().getHours())}${displayName ? `, ${displayName}` : ''}`

  const workdays = metrics.minutesSaved / 60 / 8
  const sinceLabel = metrics.firstActiveDay
    ? new Date(usageDayStart(metrics.firstActiveDay)).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null

  const hasActivity = metrics.totalGenerations > 0

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-4 px-5 py-6 md:px-8">
      {/* Greeting + quick links */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-4xl italic font-normal tracking-tight text-ink-50 md:text-5xl" style={DISPLAY_FONT}>
            {greeting}
          </h1>
          <p className="text-[14px] text-ink-400">
            {hasActivity
              ? 'Here’s what UGC OS has saved you so far.'
              : 'Generate your first asset and your savings start counting.'}
          </p>
        </div>
      </header>
      {/* No Get Credits / Community pills here: the menu bar carries both on
          every screen, ~40px above this row, so on the landing page they were
          just the same two links twice. */}

      {/* Bento grid — until a kie.ai key is saved, a slim neutral to-do row
          sits above the metrics (nothing can generate without it). Top row is
          the two hero stats; the streaks + activity row below matches its
          height so the page never needs scrolling. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-12">
        {needsKey && <ConnectKeyCard />}

        {/* Time saved */}
        <BentoCard className="col-span-2 md:col-span-6 md:h-[200px]">
          <CardLabel icon={Clock} label="Time saved" />
          <p className="mt-3 text-5xl italic font-normal tracking-tight text-ink-50 md:text-6xl" style={DISPLAY_FONT}>
            {formatTimeSaved(metrics.minutesSaved)}
          </p>
          {metrics.minutesSavedLast7d > 0 && (
            <p className="mt-1.5 text-[12px] font-semibold text-dashboard-400">
              +{formatTimeSaved(metrics.minutesSavedLast7d)} this week
            </p>
          )}
          <p className="mt-1 text-[13px] text-ink-500">
            {workdays >= 1
              ? `≈ ${workdays < 10 ? (Math.round(workdays * 10) / 10) : Math.round(workdays)} workdays of production and tool-hopping, across ${metrics.totalGenerations.toLocaleString()} generations`
              : hasActivity
                ? `across ${metrics.totalGenerations.toLocaleString()} generation${metrics.totalGenerations === 1 ? '' : 's'}`
                : 'vs producing every asset by hand'}
          </p>
        </BentoCard>

        {/* Money saved */}
        <BentoCard className="col-span-2 md:col-span-6 md:h-[200px]">
          <CardLabel icon={PiggyBank} label="Money saved" />
          <p className="mt-3 text-5xl italic font-normal tracking-tight text-ink-50 md:text-6xl" style={DISPLAY_FONT}>
            {formatUsd(metrics.usdSaved)}
          </p>
          {metrics.usdSavedLast7d >= 0.01 && (
            <p className="mt-1.5 text-[12px] font-semibold text-dashboard-400">
              +{formatUsd(metrics.usdSavedLast7d)} this week
            </p>
          )}
          <p className="mt-1 text-[13px] text-ink-500">
            {hasActivity
              ? `vs official APIs & creator platforms · ${Math.round(metrics.creditsSpent).toLocaleString()} credits used`
              : 'vs paying for the same models elsewhere'}
          </p>
        </BentoCard>

        {/* Streaks — sits left of the activity heatmap, matching its height.
            Narrowed to col-span-3 to free room for the Academy card on the
            row's right edge. */}
        <BentoCard className="col-span-2 md:col-span-3 md:h-[200px]">
          <div className="flex h-full flex-col justify-between gap-4">
            <MiniStat
              icon={Flame}
              iconClass="text-dashboard-400"
              value={metrics.currentStreak > 0 ? `${metrics.currentStreak} day${metrics.currentStreak === 1 ? '' : 's'}` : '—'}
              label={metrics.currentStreak > 0 ? 'Current streak' : 'Start a streak today'}
            />
            <MiniStat
              icon={Trophy}
              iconClass="text-ink-400"
              value={metrics.longestStreak > 0 ? `${metrics.longestStreak} day${metrics.longestStreak === 1 ? '' : 's'}` : '—'}
              label="Longest streak"
            />
            <MiniStat
              icon={CalendarCheck}
              iconClass="text-ink-400"
              value={metrics.activeDays.toLocaleString()}
              label={sinceLabel ? `Active days since ${sinceLabel}` : 'Active days'}
            />
          </div>
        </BentoCard>

        {/* Activity heatmap — a touch less padding so the grid clears the
            shared row height. col-span-6 hugs the heatmap's natural width so
            the old dead space on its right now holds the Academy card. */}
        <BentoCard className="col-span-2 md:col-span-6 md:h-[200px]" pad="p-5">
          <div className="flex items-baseline justify-between gap-3">
            <CardLabel icon={CalendarCheck} label="Activity" />
            {/* The empty grid is 26 weeks of blank cells; without a caption
                it reads as a broken widget rather than a waiting one. */}
            <p className="text-[12px] text-ink-500">
              {hasActivity
                ? `${metrics.totalGenerations.toLocaleString()} generations · last 6 months`
                : 'Every generation lights up a day'}
            </p>
          </div>
          <div className="mt-3">
            <ActivityHeatmap days={usageDays} />
          </div>
        </BentoCard>

        {/* AI UGC Academy — opens the training classroom in the community.
            Fills the row's right edge (mirrors the crew tiles' ArrowUpRight
            open-in-new affordance). */}
        <a
          href={AI_UGC_ACADEMY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`group relative col-span-2 flex flex-col justify-between overflow-hidden rounded-3xl border border-ink/10 bg-surface-1/60 p-5 transition-all hover:-translate-y-px hover:border-dashboard-400/40 md:col-span-3 md:h-[200px] ${CARD_SHADOW}`}
        >
          <ArrowUpRight
            className="absolute right-4 top-4 h-4 w-4 text-ink-600 transition-colors group-hover:text-dashboard-400"
            strokeWidth={2}
          />
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-dashboard-500/[0.12]">
            <GraduationCap className="h-6 w-6 text-dashboard-400" strokeWidth={1.75} />
          </span>
          <div className="mt-3">
            <p className="text-lg italic font-normal leading-tight tracking-tight text-ink-50" style={DISPLAY_FONT}>
              AI UGC Academy
            </p>
            <p className="mt-1 text-[12px] leading-snug text-ink-500">
              Step-by-step trainings to get more out of every tool.
            </p>
          </div>
        </a>

        {/* The crew — one shortcut tile per teammate/app */}
        <div className="col-span-2 grid grid-cols-2 gap-3 md:col-span-12 md:grid-cols-4 lg:grid-cols-8">
          {TEAM.map((member) => {
            const app = getAppConfig(member.appId)
            if (!app) return null
            return (
              <button
                key={member.appId}
                onClick={() => openApp(member.appId)}
                title={`Open ${app.name}`}
                className={`group relative flex flex-col items-start gap-2 rounded-2xl border border-ink/10 bg-surface-1/60 px-3.5 py-3 text-left transition-all hover:-translate-y-px ${CARD_SHADOW}`}
              >
                <ArrowUpRight
                  className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-ink-600 transition-colors group-hover:text-ink-300"
                  strokeWidth={2}
                />
                <span
                  className="flex h-9 w-12 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${app.accent}1F` }}
                >
                  <CrabSprite
                    variant={member.appId}
                    body={member.roleColor ?? app.accent}
                    className="h-6 w-8"
                  />
                </span>
                {/* w-full + min-w-0 so the app name truncates and the
                    "Name · Role" line wraps within the card instead of
                    spilling past its edge (items-start would size to content). */}
                <span className="w-full min-w-0">
                  <span className="block truncate text-[12px] font-semibold tracking-tight text-ink-100">{app.name}</span>
                  <span
                    className="block text-[11px] italic font-normal leading-tight tracking-tight"
                    style={{ color: member.roleColor ?? app.accent, ...DISPLAY_FONT }}
                  >
                    <span className="block truncate">{member.name}</span>
                    <span className="block truncate opacity-65">{member.role}</span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function BentoCard({ className = '', pad = 'p-5 md:p-6', children }: { className?: string; pad?: string; children: ReactNode }) {
  return (
    <section
      className={`rounded-3xl border border-ink/10 bg-surface-1/60 ${pad} ${CARD_SHADOW} transition-all hover:-translate-y-px ${className}`}
    >
      {children}
    </section>
  )
}

function CardLabel({ icon: Icon, label }: { icon: ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="h-4 w-4 text-dashboard-400" strokeWidth={1.75} />
      <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">{label}</span>
    </div>
  )
}

function MiniStat({ icon: Icon, iconClass, value, label }: { icon: ElementType; iconClass: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.05]">
        <Icon className={`h-4 w-4 ${iconClass}`} strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <p className="text-xl italic font-normal leading-tight tracking-tight text-ink-100" style={DISPLAY_FONT}>{value}</p>
        <p className="text-[11px] leading-snug text-ink-500">{label}</p>
      </div>
    </div>
  )
}
