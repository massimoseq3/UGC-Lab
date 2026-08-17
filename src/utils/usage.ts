// Usage-ledger helpers for the Dashboard: day keys, time-saved assumptions,
// and the streak/savings roll-up computed from `usageDays` (see UsageDay in
// stores/types.ts). The ledger itself is written by bankStore.recordUsage.

import type { AppUsageStat, UsageDay, UsageKind } from '../stores/types'

const DAY_MS = 86_400_000

/** Local-calendar day key ('2026-07-09') for a timestamp. */
export function usageDayId(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Midnight (local) of the day a 'YYYY-MM-DD' key names. */
export function usageDayStart(id: string): number {
  const [y, m, d] = id.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/**
 * Calendar-day ordinal for a 'YYYY-MM-DD' key — days since the Unix epoch,
 * computed in UTC so it's immune to DST. Adjacent calendar days always differ
 * by exactly 1, so streak/window math must use this, never millisecond deltas
 * on local-midnight timestamps (those are 23h/25h apart across a DST switch).
 */
export function usageDayIndex(id: string): number {
  const [y, m, d] = id.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

// Estimated minutes of manual work one generation replaces, per kind. These
// are deliberately conservative "if you produced this asset the traditional
// way" figures — shooting a b-roll clip, writing a script from scratch,
// recording VO takes — not render-time comparisons. Tune here.
export const MINUTES_SAVED_PER_GEN: Record<UsageKind, number> = {
  video: 45,      // shoot one UGC b-roll clip: setup, takes, transfer, trim
  image: 15,      // stage + shoot + pick one usable still
  voice: 15,      // record, retake, and clean up a VO line
  music: 30,      // hunt down + license a usable track
  script: 45,     // write an ad script (a run yields up to 3 variations)
  character: 20,  // source/casting a creator photo you're allowed to use
  analysis: 25,   // manually transcribe + break down a reference ad
}

// On top of the per-kind figure: the tool-hopping tax the unified workspace
// removes. Without shared banks, each generation means re-uploading the
// product/character refs into another tab, re-writing context, and moving the
// output between tools — a few minutes of switching cost per asset.
export const TASK_SWITCH_MINUTES_PER_GEN = 4

export const ALL_USAGE_KINDS: UsageKind[] = ['video', 'image', 'voice', 'script', 'character', 'analysis', 'music']

export interface UsageMetrics {
  totalGenerations: number
  countsByKind: Record<UsageKind, number>
  minutesSaved: number
  creditsSpent: number
  /** Estimated USD actually spent via kie.ai. */
  kieUsd: number
  /** Estimated USD the same generations would cost on official provider APIs. */
  officialUsd: number
  /** officialUsd − kieUsd, floored at 0. */
  usdSaved: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  /** Day key of the earliest activity, or null when the ledger is empty. */
  firstActiveDay: string | null
  /** Rolling last-7-days slice (including today) — the "this week" deltas. */
  minutesSavedLast7d: number
  usdSavedLast7d: number
}

/**
 * Attention time as a compact figure: "3h 12m", "48m", "40s". Never a decimal
 * hour — these are read down a column of apps and compared to each other, and
 * "0.8h" makes that a sum you have to do in your head.
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** Sum per-app attention stats across day rows, oldest-first order irrelevant. */
export function totalAppUsage(days: UsageDay[]): Record<string, AppUsageStat> {
  const out: Record<string, AppUsageStat> = {}
  for (const day of days) {
    for (const [appId, stat] of Object.entries(day.apps ?? {})) {
      const current = out[appId] ?? { seconds: 0, opens: 0 }
      out[appId] = { seconds: current.seconds + stat.seconds, opens: current.opens + stat.opens }
    }
  }
  return out
}

/**
 * The app someone spends the most time in, or null when there's no time at all.
 * Ties break on the app id so the answer is stable between renders rather than
 * flipping with object key order.
 */
export function topApp(usage: Record<string, AppUsageStat>): { appId: string; seconds: number } | null {
  let best: { appId: string; seconds: number } | null = null
  for (const [appId, stat] of Object.entries(usage)) {
    if (stat.seconds <= 0) continue
    if (!best || stat.seconds > best.seconds || (stat.seconds === best.seconds && appId < best.appId)) {
      best = { appId, seconds: stat.seconds }
    }
  }
  return best
}

function dayTotal(day: UsageDay): number {
  return Object.values(day.counts).reduce((sum, n) => sum + (n ?? 0), 0)
}

function dayMinutes(day: UsageDay): number {
  let minutes = 0
  for (const [kind, n] of Object.entries(day.counts) as Array<[UsageKind, number | undefined]>) {
    minutes += ((MINUTES_SAVED_PER_GEN[kind] ?? 0) + TASK_SWITCH_MINUTES_PER_GEN) * (n ?? 0)
  }
  return minutes
}

/**
 * Minutes saved on each of the last `n` calendar days, oldest → newest — the
 * Dashboard's time-saved sparkline. Days are stepped as real calendar dates so
 * the series stays one-cell-per-day across a DST switch.
 */
export function dailyMinutesSaved(days: UsageDay[], n: number): number[] {
  const byDay = new Map<string, number>()
  for (const day of days) {
    const minutes = dayMinutes(day)
    if (minutes > 0) byDay.set(day.id, minutes)
  }
  const today = new Date()
  return Array.from({ length: n }, (_, i) => {
    const cell = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1 - i))
    return byDay.get(usageDayId(cell.getTime())) ?? 0
  })
}

export function computeUsageMetrics(days: UsageDay[], creditsToUsd: (credits: number) => number): UsageMetrics {
  const countsByKind = Object.fromEntries(ALL_USAGE_KINDS.map((k) => [k, 0])) as Record<UsageKind, number>
  let minutesSaved = 0
  let creditsSpent = 0
  let officialUsd = 0
  let totalGenerations = 0
  let minutesSavedLast7d = 0
  let usdSavedLast7d = 0

  // Rolling window: today plus the six days before it, in calendar-day space.
  const todayIndex = usageDayIndex(usageDayId(Date.now()))
  const weekStartIndex = todayIndex - 6

  const activeIndices: number[] = []
  let firstActiveDay: string | null = null
  let firstActiveIndex = Infinity
  for (const day of days) {
    if (dayTotal(day) === 0) continue
    const dayIndex = usageDayIndex(day.id)
    activeIndices.push(dayIndex)
    if (dayIndex < firstActiveIndex) {
      firstActiveIndex = dayIndex
      firstActiveDay = day.id
    }
    creditsSpent += day.credits
    officialUsd += day.officialUsd
    const inWindow = dayIndex >= weekStartIndex
    if (inWindow) usdSavedLast7d += Math.max(0, day.officialUsd - creditsToUsd(day.credits))
    for (const [kind, n] of Object.entries(day.counts) as Array<[UsageKind, number | undefined]>) {
      const count = n ?? 0
      const minutes = ((MINUTES_SAVED_PER_GEN[kind] ?? 0) + TASK_SWITCH_MINUTES_PER_GEN) * count
      countsByKind[kind] = (countsByKind[kind] ?? 0) + count
      minutesSaved += minutes
      if (inWindow) minutesSavedLast7d += minutes
      totalGenerations += count
    }
  }
  activeIndices.sort((a, b) => a - b)

  // Longest run of consecutive calendar days, and the current run. The current
  // streak stays alive through "today has no activity yet" — it only breaks
  // once a full day passes with nothing generated.
  let longestStreak = 0
  let run = 0
  let prev: number | null = null
  for (const idx of activeIndices) {
    run = prev !== null && idx - prev === 1 ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run)
    prev = idx
  }
  const last = activeIndices[activeIndices.length - 1]
  const currentStreak = last === todayIndex || last === todayIndex - 1 ? run : 0

  const kieUsd = creditsToUsd(creditsSpent)
  return {
    totalGenerations,
    countsByKind,
    minutesSaved,
    creditsSpent,
    kieUsd,
    officialUsd,
    usdSaved: Math.max(0, officialUsd - kieUsd),
    activeDays: activeIndices.length,
    currentStreak,
    longestStreak,
    firstActiveDay,
    minutesSavedLast7d,
    usdSavedLast7d,
  }
}
