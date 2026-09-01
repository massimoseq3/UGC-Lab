import { useEffect, useMemo } from 'react'
import { Clock, PiggyBank, Flame, CalendarCheck, GraduationCap, ArrowUpRight } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useBankStore, backfillUsageLedger } from '../../stores/bankStore'
import { isCloudEnabled } from '../../lib/supabase'
import { creditsToUsd } from '../../utils/models'
import { computeUsageMetrics, dailyMinutesSaved, usageDayStart } from '../../utils/usage'
import { AI_UGC_ACADEMY_URL } from '../../utils/constants'
import ActivityHeatmap from './ActivityHeatmap'
import AnnouncementsTile from './AnnouncementsTile'
import ConnectKeyCard from './ConnectKeyCard'
import DesktopWallpaper from '../../components/DesktopWallpaper'
import StreakRing from './StreakRing'
import Widget, { WidgetLabel, WidgetFigure, WidgetDelta } from './Widget'
import { WIDGET_SHELL, WIDGET_INTERACTIVE, DISPLAY_FONT, riseStyle } from './widgetStyles'

// Dashboard — the workspace's "what you're getting out of this" screen and the
// default landing page, staged as a desk in deep space: a starfield wallpaper
// with the value widgets laid across it. Everything derives from the usage
// ledger (bankStore.usageDays); nothing here writes data.
//
// The crew used to orbit the wall as a solar system on the right — nine planets
// on nine rotating arms, hidden below xl. It is gone (September 2026, Massimo's
// call): it was a permanent animation on the app's DEFAULT landing page, and
// permanent motion under a wall of backdrop-blurred widgets is the one shape
// docs/performance.md tells you not to build. The dock is the launcher.

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

  // Whether each figure tile has floor art under its number. Both charts render
  // NOTHING before there is data (Sparkline bails on a flat zero peak, SpendBar
  // on nothing spent elsewhere), which used to leave the figure hanging off the
  // label with the whole bottom half of the tile empty under it. Mirrors each
  // chart's own bail condition, so the tile and its floor can't disagree.
  const hasSpark = spark.some((minutes) => minutes > 0)
  const hasSpend = metrics.officialUsd > 0

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
        <div className="flex flex-col gap-3.5">
          {/* Centred on a PHONE, where the bento under it is centred too.
              From `sm` the wall is the desktop wall and this reads from the
              left edge like every other page in the app. */}
          <header className="text-center sm:text-left">
            {/* ONE face for the whole line — `DISPLAY_FONT`, italic,
                `tracking-tighter` (Massimo's call, August 2026). It was two
                for a while, Geist for the salutation and the serif for the
                name alone; the masthead reads better as a single mark.
                `font-normal` and it stays that way: Instrument Serif ships a
                single weight, so `font-bold` here only asks the browser to
                synthesize one, which thickens the strokes without the face
                ever drawing a real bold.
                30px on a phone rather than 36 so "Good afternoon, <name>"
                can't gain a second line and push the bento's last row under
                the fold. */}
            <h1
              className="text-[30px] leading-tight font-normal italic tracking-tighter text-ink-50 sm:text-4xl sm:leading-normal md:text-[46px] md:leading-[1.1]"
              style={DISPLAY_FONT}
            >
              {salutation}
              {displayName && <>, {displayName}</>}
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
              dock, so nothing here is allowed to push the heatmap
              below the fold. Row 1 is the three figures (time, money,
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
          <div className="grid grid-cols-12 gap-3.5 sm:auto-rows-fr">
            {/* Activity */}
            <Widget index={slot(0)} className="col-span-6 items-center text-center lg:col-span-4">
              <WidgetLabel icon={CalendarCheck} label="Activity" />
              <div className="mt-auto flex w-full items-end pt-3">
                <ActivityHeatmap days={usageDays} />
              </div>
              {/* The tally reads UNDER the grid it counts, the way Streak's
                  record reads under its ring — it sat beside the label in the
                  header until the wall went to six equal centred tiles, where
                  a note in that row is what knocks the label off centre. Still
                  gone below `sm`, where the bento can't spare the line.
                  There is nothing here before there is activity: "Every
                  generation lights up a day" held the slot on the reasoning
                  that 26 weeks of blank cells read as a broken widget rather
                  than a waiting one, and came out because the label already
                  says Activity and the empty grid says there hasn't been
                  any. */}
              {hasActivity && (
                <p className="mt-2 hidden max-w-full truncate text-[11px] text-ink-500 sm:block">
                  {`${metrics.totalGenerations.toLocaleString()} generations · ${metrics.activeDays.toLocaleString()} active days${sinceLabel ? ` since ${sinceLabel}` : ''}`}
                </p>
              )}
            </Widget>
            {/* Time saved */}
            <Widget index={slot(1)} className="col-span-6 items-center text-center lg:col-span-4">
              <WidgetLabel icon={Clock} label="Time saved" />
              {/* NOT `mt-auto`: bottom-aligning this block lands the figure
                  at a different height in each tile, because Money saved's
                  floor art (a bar plus two captions) is taller than a
                  sparkline and pushes its block further up. The text stacks
                  from the label down in both, so hero / caption / delta line
                  up across the pair, and only the CHART takes `mt-auto`.

                  With no floor art yet it CENTRES instead (Massimo's call,
                  September 2026): a "0 min" pinned under the label left the
                  bottom half of the tile visibly empty, which reads as a
                  widget missing a piece rather than one waiting for its first
                  generation. The pair still line up with each other, because
                  neither has a chart to be pushed up by — which is exactly
                  the condition the rule above is about. */}
              <div className={`w-full ${hasSpark ? 'pt-4' : 'flex flex-1 flex-col justify-center'}`}>
                <WidgetFigure value={formatTimeSaved(metrics.minutesSaved)} />
                {/* The workdays line is the figure in a second unit and
                    nothing else — "≈ 7.6 workdays of production and
                    tool-hopping" was a sentence explaining a number that
                    doesn't need explaining, and the ≈ hedged a figure the
                    widget above it already states exactly. */}
                <p className="mt-1.5 text-[12px] leading-snug text-ink-500">
                  {workdays >= 1
                    ? `${workdays < 10 ? Math.round(workdays * 10) / 10 : Math.round(workdays)} workdays`
                    : hasActivity
                      ? `across ${metrics.totalGenerations.toLocaleString()} generation${metrics.totalGenerations === 1 ? '' : 's'}`
                      : 'vs doing it by hand'}
                </p>
                {metrics.minutesSavedLast7d > 0 && (
                  <WidgetDelta>{`+${formatTimeSaved(metrics.minutesSavedLast7d)} this week`}</WidgetDelta>
                )}
              </div>
              <div className="mt-auto w-full">
                <Sparkline values={spark} />
              </div>
            </Widget>

            {/* Money saved */}
            <Widget index={slot(2)} className="col-span-6 items-center text-center lg:col-span-4">
              <WidgetLabel icon={PiggyBank} label="Money saved" />
              {/* Centres with no bar under it — see Time saved above. */}
              <div className={`w-full ${hasSpend ? 'pt-4' : 'flex flex-1 flex-col justify-center'}`}>
                <WidgetFigure value={formatUsd(metrics.usdSaved)} />
                <p className="mt-1.5 text-[12px] leading-snug text-ink-500">
                  vs official APIs
                  <span className="hidden sm:inline"> &amp; creator platforms</span>
                </p>
                {metrics.usdSavedLast7d >= 0.01 && (
                  <WidgetDelta>{`+${formatUsd(metrics.usdSavedLast7d)} this week`}</WidgetDelta>
                )}
              </div>
              <div className="mt-auto w-full">
                <SpendBar spent={metrics.kieUsd} elsewhere={metrics.officialUsd} format={formatUsd} />
              </div>
            </Widget>

            {/* Streak — the ring is the desktop's signature widget. The record
                it's measured against reads under it rather than in a tile of
                its own; the ring already draws the comparison. */}
            <Widget index={slot(3)} className="col-span-6 items-center text-center lg:col-span-4">
              <div className="w-full">
                <WidgetLabel icon={Flame} label="Streak" />
              </div>
              <div className="mt-auto pt-2">
                <StreakRing current={metrics.currentStreak} best={metrics.longestStreak} />
              </div>
              <p className="mt-auto pt-2 text-[11px] leading-snug text-ink-500">{streakNote}</p>
            </Widget>


            {/* The row ends in two shortcuts, each with a column of its own
                and each SIZED TO THE WIDGET ABOVE IT (August 2026, Massimo's
                call): Announcements takes Money saved's four columns and
                Academy takes Streak's three, so the desktop's two rows share
                one set of gridlines instead of two unrelated splits. They were
                stacked in a single three-column slot until then, because the
                heatmap drew at a fixed 361px and Activity couldn't give up the
                width to fund them. Making the grid FILL its tile (see
                ActivityHeatmap) is what removed that constraint — there is no
                longer a width Activity has to have. See SHORTCUT_TILE in
                Widget.tsx for the card shape.

                Below `lg` both are `col-span-6`, which is the same two-across
                bento row they have always been — they don't need a wrapper to
                get it, and without one they can differ from each other above
                `lg`. */}

            {/* Academy — the wall's one pure LINK, and the one tile with
                nothing of the member's own in it, so it keeps the centred
                disc-over-title card rather than taking a WidgetLabel header
                like the five that report something. Announcements wore this
                same shape until it became a log; the shape lived in
                Widget.tsx as a shared constant for exactly as long as two
                cards wore it.

                It comes BEFORE Announcements in the row (August 2026,
                Massimo's call), so the wall ends on the log — the one tile
                that changes because someone else did something. */}
            <a
              href={AI_UGC_ACADEMY_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={riseStyle(slot(4))}
              className={`widget-rise group relative col-span-6 flex flex-col items-center justify-center gap-3 p-4 text-center lg:col-span-4 ${WIDGET_SHELL} ${WIDGET_INTERACTIVE}`}
            >
              {/* Disc and title step up from `sm` (Massimo's call, September
                  2026): this tile carries two short words where the other
                  five carry a figure, so at the five's supporting sizes it
                  read as the quietest thing on a wall of equal squares. The
                  phone keeps the smaller pair — the tile is half a screen
                  wide there and "AI UGC Academy" is one line by a hair. */}
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-dashboard-500/15 sm:h-[52px] sm:w-[52px] sm:rounded-[17px]">
                <GraduationCap className="h-6 w-6 text-dashboard-400 sm:h-7 sm:w-7" strokeWidth={1.75} />
              </span>
              <span>
                <span
                  className="block text-[15px] italic font-normal leading-tight tracking-tight text-ink-50 sm:text-[18px]"
                  style={DISPLAY_FONT}
                >
                  AI UGC Academy
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-500 sm:text-[12px]">Trainings</span>
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

            <AnnouncementsTile index={slot(5)} className="col-span-6 lg:col-span-4" />
          </div>
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
