import { useEffect, useMemo } from 'react'
import { Clock, PiggyBank, Flame, CalendarCheck, GraduationCap, ArrowUpRight } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useBankStore, backfillUsageLedger } from '../../stores/bankStore'
import { isCloudEnabled } from '../../lib/supabase'
import { creditsToUsd } from '../../utils/models'
import { computeUsageMetrics, dailyMinutesSaved, usageDayStart } from '../../utils/usage'
import { AI_UGC_ACADEMY_URL } from '../../utils/constants'
import ActivityHeatmap, { HeatmapLegend } from './ActivityHeatmap'
import AnnouncementsTile from './AnnouncementsTile'
import ConnectKeyCard from './ConnectKeyCard'
import DesktopWallpaper from '../../components/DesktopWallpaper'
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

// Title Case: this is the page's masthead, not a sentence, and it reads as one
// beside the member's own name in the display face.
function greetingForHour(hour: number): string {
  if (hour < 5) return 'Up Late'
  if (hour < 12) return 'Good Morning'
  if (hour < 18) return 'Good Afternoon'
  return 'Good Evening'
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
  const salutation = greetingForHour(now.getHours())
  const today = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  const workdays = metrics.minutesSaved / 60 / 8
  const sinceLabel = metrics.firstActiveDay
    ? new Date(usageDayStart(metrics.firstActiveDay)).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null

  const hasActivity = metrics.totalGenerations > 0

  // One line under the ring, carrying the record the arc is measured against —
  // and saying so outright on the day you match it, which is the whole point of
  // drawing the streak as a closing ring.
  const streakNote = metrics.currentStreak > 0
    ? metrics.currentStreak >= metrics.longestStreak
      ? `day${metrics.currentStreak === 1 ? '' : 's'} in a row · your best yet`
      : `days in a row · best ${metrics.longestStreak}`
    : metrics.longestStreak > 0
      ? `Start one today · best ${metrics.longestStreak}`
      : 'Start one today'

  // Widgets rise in reading order; the banner (when shown) takes slot 0.
  const slot = (n: number) => (needsKey ? n + 1 : n)

  return (
    <div className="relative flex min-h-full flex-col">
      <DesktopWallpaper />

      {/* `safe center` centres the desktop on a tall window without ever
          clipping the greeting off the top when the content outgrows it. */}
      <div
        className="relative mx-auto flex w-full max-w-[1240px] flex-1 flex-col px-5 py-4 md:px-8"
        style={{ justifyContent: 'safe center' }}
      >
        <div className="flex gap-7">
          <div className="flex min-w-0 flex-1 flex-col gap-3.5">
            {/* Centred on a PHONE, where the bento under it is centred too.
                From `sm` the wall is the desktop wall and this reads from the
                left edge like every other page in the app. */}
            <header className="text-center sm:text-left">
              {/* Two faces on one line: the salutation is chrome and takes
                  the app's own Geist, the NAME is the display face — it's the
                  one word on the page that's about this member, and the serif
                  is what marks it as such. Both were Instrument Serif, which
                  made the whole line ornament and left nothing for the name to
                  be set apart by. */}
              {/* 30px on a phone, not 36: Geist is a wider face than the
                  Instrument Serif this line used to be set in, so "Good
                  afternoon, <name>" gained a second line at the old size and
                  pushed the bento's last row under the fold. */}
              <h1 className="text-[30px] leading-tight font-normal tracking-tight text-ink-50 sm:text-4xl sm:leading-normal md:text-[46px] md:leading-[1.1]">
                {salutation}
                {displayName && (
                  <>
                    ,{' '}
                    <span className="italic font-normal" style={DISPLAY_FONT}>{displayName}</span>
                  </>
                )}
              </h1>
              {/* The date, and — for a member with nothing yet — the one line
                  that says where the numbers come from. "Here's what UGC OS has
                  saved you so far" rode here for every OTHER member and said
                  nothing the four widgets underneath don't say themselves. */}
              <p className="mt-1 text-[13px] text-ink-400">
                {today}
                {!hasActivity && (
                  <>
                    <span className="mx-1.5 text-ink-700">·</span>
                    Generate your first asset and your savings start counting.
                  </>
                )}
              </p>
            </header>

            {needsKey && <ConnectKeyCard />}

            {/* The widget wall — two rows on a desktop, and deliberately no
                more: the whole desktop has to sit inside one screen with the
                dock, so nothing here is allowed to push the orrery or the
                heatmap below the fold. Row 1 is the three figures (time, money,
                streak), row 2 is the activity grid with the Academy card
                beside it. Best streak and active days used to be tiles of their
                own — three streak-shaped numbers in a row — and now ride as
                sub-lines on the widgets they actually belong to.

                **Below `lg` it is a bento, two tiles across** (August 2026).
                Every widget was `col-span-12` there, so a phone got six
                full-width slabs stacked one under another and the Dashboard
                became a page you scroll rather than a desktop you look at.
                Three rows of two, in DOM order: the two figures, then Streak
                and Activity, then the Announcements/Academy pair unstacked to
                sit side by side. Activity earns a half tile by dropping to
                `PHONE_WEEKS` columns of smaller cells (see ActivityHeatmap) —
                a quarter of the history at a size you can read, rather than
                half a year squeezed into 128px. */}
            <div className="grid grid-cols-12 gap-3.5">
              {/* Time saved */}
              <Widget index={slot(0)} className="col-span-6 max-sm:items-center max-sm:text-center lg:col-span-5">
                <WidgetLabel icon={Clock} label="Time saved" />
                <div className="mt-auto w-full pt-4">
                  <WidgetFigure
                    value={formatTimeSaved(metrics.minutesSaved)}
                    delta={metrics.minutesSavedLast7d > 0 ? `+${formatTimeSaved(metrics.minutesSavedLast7d)} this week` : undefined}
                  />
                  {/* Two spans, not two strings: the tail is what wraps a
                      half-width bento tile onto a third line, and a phone gets
                      the fact without it. */}
                  <p className="mt-1.5 text-[12px] leading-snug text-ink-500">
                    {workdays >= 1 ? (
                      <>
                        {`≈ ${workdays < 10 ? Math.round(workdays * 10) / 10 : Math.round(workdays)} workdays`}
                        <span className="hidden sm:inline"> of production and tool-hopping</span>
                      </>
                    ) : hasActivity ? (
                      `across ${metrics.totalGenerations.toLocaleString()} generation${metrics.totalGenerations === 1 ? '' : 's'}`
                    ) : (
                      <>
                        vs doing it by hand
                        <span className="hidden sm:inline"> — every asset</span>
                      </>
                    )}
                  </p>
                  <Sparkline values={spark} />
                </div>
              </Widget>

              {/* Money saved */}
              <Widget index={slot(1)} className="col-span-6 max-sm:items-center max-sm:text-center lg:col-span-4">
                <WidgetLabel
                  icon={PiggyBank}
                  label="Money saved"
                  note={hasActivity ? `${Math.round(metrics.creditsSpent).toLocaleString()} credits` : undefined}
                />
                <div className="mt-auto w-full pt-4">
                  <WidgetFigure
                    value={formatUsd(metrics.usdSaved)}
                    delta={metrics.usdSavedLast7d >= 0.01 ? `+${formatUsd(metrics.usdSavedLast7d)} this week` : undefined}
                  />
                  <p className="mt-1.5 text-[12px] leading-snug text-ink-500">
                    vs official APIs
                    <span className="hidden sm:inline"> &amp; creator platforms</span>
                  </p>
                  <SpendBar spent={metrics.kieUsd} elsewhere={metrics.officialUsd} format={formatUsd} />
                </div>
              </Widget>

              {/* Streak — the ring is the desktop's signature widget. The record
                  it's measured against reads under it rather than in a tile of
                  its own; the ring already draws the comparison. */}
              <Widget index={slot(2)} className="col-span-6 items-center text-center lg:col-span-3">
                <div className="w-full">
                  <WidgetLabel icon={Flame} label="Streak" />
                </div>
                <div className="mt-auto pt-2">
                  <StreakRing current={metrics.currentStreak} best={metrics.longestStreak} />
                </div>
                <p className="mt-auto pt-2 text-[11px] leading-snug text-ink-500">{streakNote}</p>
              </Widget>

              {/* Activity */}
              <Widget index={slot(3)} className="col-span-6 max-sm:items-center max-sm:text-center lg:col-span-9">
                <div className="flex w-full items-center justify-between gap-3 max-sm:justify-center">
                  <WidgetLabel icon={CalendarCheck} label="Activity" />
                  {/* The empty grid is 26 weeks of blank cells; without a caption
                      it reads as a broken widget rather than a waiting one. */}
                  <p className={`max-w-full truncate text-[11px] text-ink-500 ${hasActivity ? 'hidden sm:block' : ''}`}>
                    {hasActivity
                      ? `${metrics.totalGenerations.toLocaleString()} generations · ${metrics.activeDays.toLocaleString()} active days${sinceLabel ? ` since ${sinceLabel}` : ''}`
                      : 'Every generation lights up a day'}
                  </p>
                </div>
                {/* Centred as a block on a phone, where the tile is half a
                    screen and the legend isn't rendered anyway; from `sm` the
                    grid and its legend sit at the two edges as before. */}
                <div className="mt-auto flex w-full items-end justify-between gap-5 pt-3 max-sm:justify-center">
                  <ActivityHeatmap days={usageDays} />
                  <HeatmapLegend />
                </div>
              </Widget>

              {/* The row's last three columns hold two shortcuts, stacked.
                  They can't sit side by side: the slot is ~177px, which halves
                  into squares too narrow for either title — and they can't take
                  a column each either, because the 26-week heatmap needs ~364px
                  and Activity dropping below nine columns puts a scrollbar
                  inside it. Stacked, both get the full width at half the height,
                  and the wall stays two rows. On a phone they are SIDE BY SIDE
                  instead — the bento's third row is theirs alone, so each gets
                  a square of its own rather than half of one. */}
              <div className="col-span-12 grid grid-cols-2 gap-3.5 lg:col-span-3 lg:grid-cols-1">
                <AnnouncementsTile index={slot(4)} />

                {/* Academy */}
                <a
                  href={AI_UGC_ACADEMY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={riseStyle(slot(5))}
                  className={`widget-rise group relative flex items-center gap-2.5 p-3.5 max-sm:aspect-square max-sm:flex-col max-sm:justify-center max-sm:gap-3 max-sm:text-center ${WIDGET_SHELL} ${WIDGET_INTERACTIVE}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-dashboard-500/15 max-sm:h-11 max-sm:w-11 max-sm:rounded-[15px]">
                    <GraduationCap className="h-[18px] w-[18px] text-dashboard-400 max-sm:h-6 max-sm:w-6" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1 max-sm:flex-none">
                    {/* Truncating rather than wrapping FROM `sm`: there the card
                        is half a row tall, so a second title line pushes the
                        sub-line out of the box entirely. The phone's square has
                        the height for two lines and none of the width to lose
                        to an ellipsis. */}
                    <span
                      className="block text-[15px] italic font-normal leading-tight tracking-tight text-ink-50 sm:truncate"
                      style={DISPLAY_FONT}
                    >
                      AI UGC Academy
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-500 sm:truncate">Trainings</span>
                  </span>
                  {/* Out of flow — in it, the arrow costs the title 28px it
                      doesn't have. Gone entirely below `sm`, where the tile is
                      half a phone's width: out of flow it doesn't reserve the
                      space either, so it simply landed on the last letter of
                      the title. The card is the link with or without it. */}
                  <ArrowUpRight
                    className="absolute right-3 top-3 hidden h-3.5 w-3.5 text-ink-600 transition-colors group-hover:text-dashboard-400 sm:block"
                    strokeWidth={2}
                  />
                </a>
              </div>
            </div>

            {/* Below lg the icons can't sit in a right-hand column, so they run
                as a grid under the widgets — and the column count DIVIDES the
                nine apps rather than merely fitting them. Four across left a
                4/4/1 wall with one crab stranded on a line of its own, and
                eight across (the old `sm`) did the same with 8/1. Three is a
                square block on a phone; nine is one clean row from `sm`, where
                there's 66px+ per cell for a 56px tile. Adding a tenth app means
                revisiting BOTH numbers. */}
            <DesktopIcons className="grid grid-cols-3 gap-x-2 gap-y-3 pt-1 sm:grid-cols-9 xl:hidden" />
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
    <div className="mt-2.5 flex h-6 items-end gap-[3px]" aria-hidden>
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
            style={{ height: `${Math.max(3, Math.round((minutes / peak) * 24))}px` }}
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
    // `justify-between` survives the phone's centring: these two figures label
    // the two ENDS of the bar above them, so centring them would detach each
    // number from the thing it measures. `w-full` because a centred widget's
    // `items-center` shrinks every child to its content.
    <div className="mt-3 w-full" aria-hidden>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08] light:bg-black/[0.07]">
        <div
          className="h-full rounded-full bg-dashboard-500 transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(2, share * 100)}%` }}
        />
      </div>
      {/* 10px below `sm`: at half a phone's width the pair wrapped to two lines
          each, which reads as four numbers instead of a comparison of two. */}
      <div className="mt-1.5 flex items-center justify-between gap-2 whitespace-nowrap text-[10px] tabular-nums text-ink-600 sm:text-[11px]">
        <span>{format(spent)} on kie.ai</span>
        <span>{format(elsewhere)} elsewhere</span>
      </div>
    </div>
  )
}
