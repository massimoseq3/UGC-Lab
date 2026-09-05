// The outlier maths — the one thing Outliers computes rather than fetches.
//
// Nobody publishes "outliers". What TikTok gives us is a view count and a
// follower count, and the interesting signal is the ratio: 400k views from a
// 2M-follower account is a normal day, 400k from 3k followers is somebody who
// found an angle worth stealing.

import type { OutlierBand, OutlierScore } from '../types'

/**
 * Below this, the denominator is too small to mean anything — a brand-new or
 * near-empty account divides a handful of views into a spectacular multiple.
 * Those cards show raw views and no badge rather than a made-up 40x.
 */
export const MIN_FOLLOWERS_FOR_SCORE = 500

/** Descending, so the first match is the strongest band that applies. */
const BANDS: Array<{ threshold: number; band: OutlierBand }> = [
  { threshold: 10, band: '10x' },
  { threshold: 5, band: '5x' },
  { threshold: 2, band: '2x' },
]

/**
 * Scores a video against its own creator's following.
 *
 * Returns undefined — meaning "show the raw views, no badge" — when either
 * side of the ratio is unusable or the result is under 2x. Two separate floors
 * do that work and both are load-bearing:
 *
 *  - `minViews` kills the absolute-noise case (800 views from 40 followers is
 *    20x and completely meaningless).
 *  - MIN_FOLLOWERS_FOR_SCORE kills the tiny-denominator case.
 *
 * Without both, the grid's top row is reliably junk.
 */
export function scoreOutlier(
  views: number | undefined,
  followers: number | undefined,
  minViews: number,
): OutlierScore | undefined {
  if (!views || !Number.isFinite(views) || views < minViews) return undefined
  if (!followers || !Number.isFinite(followers) || followers < MIN_FOLLOWERS_FOR_SCORE) return undefined

  const multiple = views / followers
  if (!Number.isFinite(multiple)) return undefined

  const band = bandFor(multiple)
  if (!band) return undefined

  return { multiple, band }
}

/**
 * The band a multiple falls into, or undefined below 2x.
 *
 * Split out because the swipe file stores the multiple it snapshotted but not
 * the band — rebuilding one from the other beats widening the persisted row for
 * a value that is a pure function of it.
 */
export function bandFor(multiple: number): OutlierBand | undefined {
  return BANDS.find((b) => multiple >= b.threshold)?.band
}

/**
 * Engagement rate: every interaction as a share of the views that produced it.
 *
 *   (likes + comments + shares + saves) ÷ views
 *
 * Reverse-engineered from the reference tool and checked against four of its
 * cards — 134.6K views / 976 / 7 / 16 / 86 gives 0.81% against its printed
 * 0.8%, and 10.3K / 860 / 24 / 4 / 53 gives 9.14% against its 9.1%. Saves are
 * IN the numerator, which is the part worth not "simplifying" later: on a UGC
 * ad a save is the strongest buying signal of the four.
 *
 * Distinct from the outlier multiple: ER asks how hard a video worked the
 * people who saw it, the multiple asks how far it travelled beyond its own
 * audience. A video can be strong on one and flat on the other.
 */
export function engagementRate(stats: {
  views?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
}): number | null {
  // No views, no rate — the figure is a share OF the views, so a platform that
  // publishes none (Instagram's reel search, every Meta ad) gets null rather
  // than a percentage of a number nobody reported.
  if (!stats.views || !Number.isFinite(stats.views)) return null
  const interactions = (stats.likes ?? 0) + (stats.comments ?? 0) + (stats.shares ?? 0) + (stats.saves ?? 0)
  return (interactions / stats.views) * 100
}

/** "9.1%" — one decimal, which is the precision the numbers deserve. */
export function formatRate(rate: number): string {
  return `${rate.toFixed(1)}%`
}

/** "12.4x" / "3.1x" — one decimal below 10, whole numbers above. */
export function formatMultiple(multiple: number): string {
  return multiple >= 10 ? `${Math.round(multiple)}x` : `${multiple.toFixed(1)}x`
}

/** 1_282_645 → "1.3M". Used on the stats strip, where space is tight. */
export function formatCount(n: number | undefined): string {
  if (!n || !Number.isFinite(n)) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(Math.round(n))
}

// ── The account baseline ────────────────────────────────────────
//
// A second denominator, for the Accounts tab only.
//
// The multiple above asks how far a video travelled beyond its creator's own
// audience (views ÷ followers) and is comparable ACROSS accounts, which is what
// a keyword search needs — thirty cards from thirty strangers.
//
// Browsing one account asks a different question: which of THIS creator's reels
// popped? A 200k-view reel is a flop on an account that does 400k as a matter
// of course and the find of the month on one that does 20k. So a card on that
// tab is scored against the median of the reels around it.
//
// The two never share a grid. The Accounts tab shows one account at a time and
// states its baseline in the header directly above the cards, so the amber
// badge still means exactly one thing everywhere it appears — the header says
// which denominator produced it. Mixing both ratios into one grid is what the
// badge rule exists to prevent, and nothing here does that.

/**
 * Reels needed before a median is worth trusting.
 *
 * Six rather than three: a median over three is one reel away from being a
 * single reel, and a profile whose whole output is three posts is exactly the
 * new account whose numbers mean nothing yet. Under this the cards render with
 * raw plays and no badge — the same "show the number, invent nothing" rule the
 * follower floor follows.
 */
export const MIN_BASELINE_SAMPLE = 6

/** The middle value. Even counts average the two either side of the middle. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * An account's typical reel, in plays.
 *
 * Deliberately the MEDIAN of the whole pool rather than a mean, and rather than
 * a pool with the outliers taken out. A mean is dragged by the one 40x reel the
 * member is hunting for — it would raise the bar in proportion to how good the
 * find is, which is backwards. A median barely moves for it, so the account's
 * ordinary day stays the ordinary day. For the same reason the reel being
 * scored is left IN the pool: taking it out changes a median by at most one
 * position and costs a per-card recompute over the whole list.
 *
 * Returns null under MIN_BASELINE_SAMPLE, and null if every reel came back
 * with no play count — a zero baseline would divide every card into infinity.
 */
export function accountBaseline(plays: Array<number | undefined>): number | null {
  const real = plays.filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0)
  if (real.length < MIN_BASELINE_SAMPLE) return null
  const mid = median(real)
  return mid && mid > 0 ? mid : null
}

/**
 * A reel against its own account's median.
 *
 * Same bands and same "undefined means show no badge" contract as
 * `scoreOutlier`, so the card renders one amber pill either way and neither
 * tab needs its own badge.
 */
export function scoreAgainstBaseline(
  plays: number | undefined,
  baseline: number | null,
): OutlierScore | undefined {
  if (!plays || !Number.isFinite(plays)) return undefined
  if (!baseline || baseline <= 0) return undefined

  const multiple = plays / baseline
  if (!Number.isFinite(multiple)) return undefined

  const band = bandFor(multiple)
  if (!band) return undefined

  return { multiple, band }
}
