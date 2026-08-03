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

  const hit = BANDS.find((b) => multiple >= b.threshold)
  if (!hit) return undefined

  return { multiple, band: hit.band }
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
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
}): number | null {
  if (!stats.views || !Number.isFinite(stats.views)) return null
  const interactions = stats.likes + stats.comments + stats.shares + stats.saves
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
