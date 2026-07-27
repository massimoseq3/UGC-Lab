import { useEffect, useMemo } from 'react'
import { Clock, PiggyBank, Flame, Trophy, CalendarCheck, GraduationCap, ArrowUpRight } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useBankStore, backfillUsageLedger } from '../../stores/bankStore'
import { isCloudEnabled } from '../../lib/supabase'
import { creditsToUsd } from '../../utils/models'
import { computeUsageMetrics, dailyMinutesSaved, usageDayStart } from '../../utils/usage'
import { AI_UGC_ACADEMY_URL } from '../../utils/constants'
import ActivityHeatmap, { HeatmapLegend } from './ActivityHeatmap'
import ConnectKeyCard from './ConnectKeyCard'
import DesktopWallpaper from './DesktopWallpaper'
import DesktopIcons from './DesktopIcons'
import SolarSystem from './SolarSystem'
import StreakRing from './StreakRing'
import Widget, { WidgetLabel, WidgetFigure, WIDGET_SHELL, WIDGET_INTERACTIVE, DISPLAY_FONT, riseStyle } from './Widget'

// Dashboard — the workspace's "what you're getting out of this" screen and the
// default landing page, staged as a desk in deep space: a starfield wallpaper,
// the value widgets laid across it, and the crew orbiting the workspace as a
// solar system on the right (the launcher — see SolarSystem). Below xl there
// isn't room for the orrery, so the crew falls back to a plain icon row under
// the widgets. Everything derives from the usage ledger (bankStore.usageDays);
// nothing here writes data.

const SPARK_DAYS = 14

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
  const kieApiKey = useSettingsStore((s) => s.kieApiKey)
  const needsKey = kieApiKey.trim().length === 0

  // Cloud mode backfills after hydrate (cloudSync); local-only has no hydrate,
  // so seed the ledger from local history the first time the Dashboard opens.
  useEffect(() => {
    if (!isCloudEnabled()) backfillUsageLedger()
  }, [])

  const metrics = useMemo(() => computeUsageMetrics(usageDays, creditsToUsd), [usageDays])
  const spark = useMemo(() => dailyMinutesSaved(usageDays, SPARK_DAYS), [usageDays])

  // Prefer the name the user set in Settings ("What should we call you?"),
  // falling back to their sign-up first name.
  const displayName = profile?.display_name?.trim() || profile?.first_name?.trim()
  const now = new Date()
  const greeting = `${greetingForHour(now.getHours())}${displayName ? `, ${displayName}` : ''}`
  const today = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  const workdays = metrics.minutesSaved / 60 / 8
  const sinceLabel = metrics.firstActiveDay
    ? new Date(usageDayStart(metrics.firstActiveDay)).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null

  const hasActivity = metrics.totalGenerations > 0
  // Widgets rise in reading order; the banner (when shown) takes slot 0.
  const slot = (n: number) => (needsKey ? n + 1 : n)

  return (
    <div className="relative flex min-h-full flex-col">
      <DesktopWallpaper />

      {/* `safe center` centres the desktop on a tall window without ever
          clipping the greeting off the top when the content outgrows it. */}
      <div
        className="relative mx-auto flex w-full max-w-[1240px] flex-1 flex-col px-5 py-5 md:px-8"
        style={{ justifyContent: 'safe center' }}
      >
        <div className="flex gap-7">
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <header>
              <h1 className="text-4xl italic font-normal tracking-tight text-ink-50 md:text-[46px] md:leading-[1.1]" style={DISPLAY_FONT}>
                {greeting}
              </h1>
              <p className="mt-1 text-[13px] text-ink-400">
                {today}
                <span className="mx-1.5 text-ink-700">·</span>
                {hasActivity
                  ? 'Here’s what UGC OS has saved you so far.'
                  : 'Generate your first asset and your savings start counting.'}
              </p>
            </header>

            {needsKey && <ConnectKeyCard />}

            {/* The widget wall. Two rows of equal-height tiles at lg: the pair
                of hero figures with the streak ring and Academy beside them,
                then activity across the bottom with two small counters. */}
            <div className="grid grid-cols-12 gap-3.5">
              {/* Time saved */}
              <Widget index={slot(0)} className="col-span-12 sm:col-span-6 lg:min-h-[176px]">
                <WidgetLabel icon={Clock} label="Time saved" />
                <div className="mt-auto pt-4">
                  <WidgetFigure
                    value={formatTimeSaved(metrics.minutesSaved)}
                    delta={metrics.minutesSavedLast7d > 0 ? `+${formatTimeSaved(metrics.minutesSavedLast7d)} this week` : undefined}
                  />
                  <p className="mt-1.5 text-[12px] leading-snug text-ink-500">
                    {workdays >= 1
                      ? `≈ ${workdays < 10 ? Math.round(workdays * 10) / 10 : Math.round(workdays)} workdays of production and tool-hopping`
                      : hasActivity
                        ? `across ${metrics.totalGenerations.toLocaleString()} generation${metrics.totalGenerations === 1 ? '' : 's'}`
                        : 'vs producing every asset by hand'}
                  </p>
                  <Sparkline values={spark} />
                </div>
              </Widget>

              {/* Money saved */}
              <Widget index={slot(1)} className="col-span-12 sm:col-span-6 lg:min-h-[176px]">
                <WidgetLabel
                  icon={PiggyBank}
                  label="Money saved"
                  note={hasActivity ? `${Math.round(metrics.creditsSpent).toLocaleString()} credits` : undefined}
                />
                <div className="mt-auto pt-4">
                  <WidgetFigure
                    value={formatUsd(metrics.usdSaved)}
                    delta={metrics.usdSavedLast7d >= 0.01 ? `+${formatUsd(metrics.usdSavedLast7d)} this week` : undefined}
                  />
                  <p className="mt-1.5 text-[12px] leading-snug text-ink-500">
                    vs official APIs &amp; creator platforms
                  </p>
                  <SpendBar spent={metrics.kieUsd} elsewhere={metrics.officialUsd} format={formatUsd} />
                </div>
              </Widget>

              {/* Streak — the ring is the desktop's signature widget. */}
              <Widget index={slot(2)} className="col-span-6 items-center text-center sm:col-span-3 lg:min-h-[176px]" pad="p-4">
                <div className="w-full">
                  <WidgetLabel icon={Flame} label="Streak" />
                </div>
                <div className="mt-auto pt-2">
                  <StreakRing current={metrics.currentStreak} best={metrics.longestStreak} />
                </div>
                <p className="mt-auto pt-2 text-[11px] leading-snug text-ink-500">
                  {metrics.currentStreak > 0
                    ? `day${metrics.currentStreak === 1 ? '' : 's'} in a row`
                    : 'Start one today'}
                </p>
              </Widget>

              {/* Academy */}
              <a
                href={AI_UGC_ACADEMY_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={riseStyle(slot(3))}
                className={`widget-rise group relative col-span-6 flex flex-col p-4 sm:col-span-3 lg:min-h-[176px] ${WIDGET_SHELL} ${WIDGET_INTERACTIVE}`}
              >
                <ArrowUpRight
                  className="absolute right-3.5 top-3.5 h-4 w-4 text-ink-600 transition-colors group-hover:text-dashboard-400"
                  strokeWidth={2}
                />
                <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-dashboard-500/15">
                  <GraduationCap className="h-[22px] w-[22px] text-dashboard-400" strokeWidth={1.75} />
                </span>
                <div className="mt-auto pt-3">
                  <p className="text-[19px] italic font-normal leading-tight tracking-tight text-ink-50" style={DISPLAY_FONT}>
                    AI UGC Academy
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-ink-500">Trainings for every tool.</p>
                </div>
              </a>

              {/* Best streak. The two counters centre their content — small
                  tiles hold a label and a number, and anchoring those to
                  opposite edges leaves a hole down the middle. */}
              <Widget index={slot(4)} className="col-span-6 justify-center sm:col-span-3 lg:min-h-[176px]" pad="p-4">
                <WidgetLabel icon={Trophy} label="Best streak" />
                <div className="pt-3">
                  <WidgetFigure size="small" value={metrics.longestStreak > 0 ? `${metrics.longestStreak}` : '—'} />
                  <p className="mt-1.5 text-[11px] leading-snug text-ink-500">
                    {metrics.longestStreak === 1 ? 'day in a row' : 'days in a row'}
                  </p>
                </div>
              </Widget>

              {/* Active days */}
              <Widget index={slot(5)} className="col-span-6 justify-center sm:col-span-3 lg:min-h-[176px]" pad="p-4">
                <WidgetLabel icon={CalendarCheck} label="Active days" />
                <div className="pt-3">
                  <WidgetFigure size="small" value={metrics.activeDays.toLocaleString()} />
                  <p className="mt-1.5 text-[11px] leading-snug text-ink-500">
                    {sinceLabel ? `since ${sinceLabel}` : 'on the tools'}
                  </p>
                </div>
              </Widget>
              {/* Activity */}
              <Widget index={slot(6)} className="col-span-12 lg:min-h-[176px]">
                <div className="flex items-center justify-between gap-3">
                  <WidgetLabel icon={CalendarCheck} label="Activity" />
                  {/* The empty grid is 26 weeks of blank cells; without a caption
                      it reads as a broken widget rather than a waiting one. */}
                  <p className="text-[11px] text-ink-500">
                    {hasActivity
                      ? `${metrics.totalGenerations.toLocaleString()} generations · last 6 months`
                      : 'Every generation lights up a day'}
                  </p>
                </div>
                <div className="mt-auto flex items-end justify-between gap-5 pt-3">
                  <ActivityHeatmap days={usageDays} />
                  <HeatmapLegend />
                </div>
              </Widget>

            </div>

            {/* Below lg the icons can't sit in a right-hand column, so they run
                as a row under the widgets. */}
            <DesktopIcons className="grid grid-cols-4 gap-x-2 gap-y-3 pt-1 sm:grid-cols-8 xl:hidden" />
          </div>

          {/* The orrery sits beside the widget wall, centred against it. */}
          <SolarSystem className="hidden shrink-0 self-center xl:block" />
        </div>
      </div>
    </div>
  )
}

// Last 14 days of time saved, as a bar per day. It answers a question the
// running total can't: whether this week looked like the ones before it.
function Sparkline({ values }: { values: number[] }) {
  const peak = Math.max(...values)
  if (peak === 0) return null
  return (
    <div className="mt-3 flex h-7 items-end gap-[3px]" aria-hidden>
      {values.map((minutes, i) => {
        const last = i === values.length - 1
        return (
          <span
            key={i}
            className={`flex-1 rounded-[2px] ${
              minutes === 0
                ? 'bg-ink/[0.08] light:bg-black/[0.07]'
                : last
                  ? 'bg-dashboard-400'
                  : 'bg-dashboard-500/70'
            }`}
            // 3px floor so a quiet day still reads as a day, not a gap.
            style={{ height: `${Math.max(3, Math.round((minutes / peak) * 28))}px` }}
          />
        )
      })}
    </div>
  )
}

// What the same generations cost here versus on the providers' own APIs. The
// filled sliver is what you actually paid — the widget's number is the rest.
function SpendBar({ spent, elsewhere, format }: { spent: number; elsewhere: number; format: (usd: number) => string }) {
  if (elsewhere <= 0) return null
  const share = Math.min(1, spent / elsewhere)
  return (
    <div className="mt-3" aria-hidden>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08] light:bg-black/[0.07]">
        <div
          className="h-full rounded-full bg-dashboard-500 transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(2, share * 100)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] tabular-nums text-ink-600">
        <span>{format(spent)} on kie.ai</span>
        <span>{format(elsewhere)} elsewhere</span>
      </div>
    </div>
  )
}
