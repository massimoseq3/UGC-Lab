// Turns each platform's raw payload into the single DiscoverResult the grid
// renders. Everything vendor-shaped stops here.

import {
  searchTikTokKeyword,
  searchMetaAds,
  firstUrl,
  type TikTokSearchItem,
  type MetaAdItem,
} from '../../../utils/scrapecreators'
import type { DiscoverFilters, DiscoverResult, DiscoverSort } from '../types'
import { scoreOutlier } from './scoring'

const DAY_MS = 86_400_000

export interface DiscoverPage {
  results: DiscoverResult[]
  cursor: string | number | null
  creditsRemaining: number | null
}

// ── TikTok ──────────────────────────────────────────────────────

function normaliseTikTok(item: TikTokSearchItem): DiscoverResult | null {
  const id = item.aweme_id
  if (!id) return null

  const stats = item.statistics ?? {}
  const author = item.author ?? {}
  const video = item.video ?? {}

  const views = stats.play_count ?? 0
  const followers = author.follower_count

  // The handle is what builds the permalink when `url` is absent, so a row
  // with neither is unusable — every action needs somewhere to point.
  const handle = author.unique_id ?? ''
  const postUrl = item.url ?? (handle ? `https://www.tiktok.com/@${handle}/video/${id}` : '')
  if (!postUrl) return null

  return {
    id,
    platform: 'tiktok',
    caption: item.desc ?? '',
    postUrl,
    // origin_cover is the full-size still; `cover` is a smaller crop. Either
    // beats nothing, and the dynamic (animated) cover is deliberately not used
    // as the poster — it's a video file wearing an image's field name.
    coverUrl: firstUrl(video.origin_cover) ?? firstUrl(video.cover),
    // Prefer the clean render: a watermark burned across the frame would end up
    // in the Ad Analyzer's vision read and in any B-Roll built off it.
    videoUrl:
      firstUrl(video.download_no_watermark_addr) ??
      firstUrl(video.play_addr) ??
      firstUrl(video.download_addr),
    // `duration` is milliseconds despite the name (22874 → 22.9s).
    durationSeconds: video.duration ? Math.round(video.duration / 1000) : undefined,
    createdAt: item.create_time ? item.create_time * 1000 : 0,
    author: {
      handle,
      name: author.nickname ?? handle,
      avatarUrl: firstUrl(author.avatar_thumb),
      followerCount: followers,
    },
    stats: {
      views,
      likes: stats.digg_count ?? 0,
      comments: stats.comment_count ?? 0,
      shares: stats.share_count ?? 0,
      saves: stats.collect_count ?? 0,
    },
    // Deliberately unscored here — see applyMinViews. Scoring at fetch time
    // baked the min-views threshold into the row, so moving the filter
    // afterwards changed nothing until the member searched again.
  }
}

// ── Meta ────────────────────────────────────────────────────────

function daysRunning(ad: MetaAdItem): number | null {
  // Meta's own counter, in seconds, is the truth when present.
  if (typeof ad.total_active_time === 'number' && ad.total_active_time > 0) {
    return Math.max(1, Math.floor(ad.total_active_time / 86_400))
  }
  // Otherwise derive it. An inactive ad stopped at end_date; a live one is
  // still running, so it counts to now.
  if (typeof ad.start_date === 'number' && ad.start_date > 0) {
    const end = ad.is_active === false && ad.end_date ? ad.end_date * 1000 : Date.now()
    const days = Math.floor((end - ad.start_date * 1000) / DAY_MS)
    return days >= 0 ? Math.max(1, days) : null
  }
  return null
}

function normaliseMeta(ad: MetaAdItem): DiscoverResult | null {
  const id = ad.ad_archive_id
  if (!id) return null

  const snap = ad.snapshot ?? {}
  const video = snap.videos?.[0]
  const image = snap.images?.[0]

  return {
    id,
    platform: 'meta',
    // The ad's body copy IS its script — that's what the member wants to read,
    // and on Meta there's no separate transcript endpoint feeding the remix.
    caption: snap.body?.text ?? snap.title ?? '',
    postUrl: ad.url ?? `https://www.facebook.com/ads/library/?id=${id}`,
    coverUrl:
      video?.video_preview_image_url ??
      image?.original_image_url ??
      image?.resized_image_url,
    videoUrl: video?.video_hd_url ?? video?.video_sd_url,
    createdAt: ad.start_date ? ad.start_date * 1000 : 0,
    author: {
      handle: ad.page_name ?? snap.page_name ?? '',
      name: ad.page_name ?? snap.page_name ?? 'Unknown advertiser',
      avatarUrl: snap.page_profile_picture_url,
      followerCount: snap.page_like_count,
    },
    // No stats and no outlier on purpose: Meta returns spend and
    // reach_estimate as null for commercial ads, so longevity is the only
    // honest signal and it gets its own block.
    ad: {
      isActive: ad.is_active ?? false,
      daysRunning: daysRunning(ad),
      ctaText: snap.cta_text,
      landingUrl: snap.link_url,
      platforms: ad.publisher_platform ?? [],
    },
  }
}

// ── Scoring + filtering ─────────────────────────────────────────

/**
 * Drops anything under the view floor and scores what's left.
 *
 * Runs on every render rather than at fetch time, so moving the Min views
 * filter re-ranks the grid you're already looking at instead of silently
 * doing nothing until the next search (which costs a credit).
 *
 * Cards with no view count of their own — every Meta ad — pass through
 * untouched: a view threshold can't be applied to a number the platform
 * doesn't publish, and filtering them out would empty that whole tab.
 */
export function applyMinViews(results: DiscoverResult[], minViews: number): DiscoverResult[] {
  return results.reduce<DiscoverResult[]>((acc, r) => {
    if (!r.stats) {
      acc.push(r)
      return acc
    }
    if (r.stats.views < minViews) return acc
    acc.push({
      ...r,
      outlier: scoreOutlier(r.stats.views, r.author.followerCount, minViews),
    })
    return acc
  }, [])
}

// ── Sorting ─────────────────────────────────────────────────────

/**
 * Client-side sort. The vendor's own `sort_by` covers relevance and recency
 * per page, but the outlier multiple is ours — it doesn't exist upstream, so
 * it can only be applied to what's already been fetched.
 */
export function sortResults(results: DiscoverResult[], sort: DiscoverSort): DiscoverResult[] {
  const out = [...results]
  if (sort === 'recent') {
    out.sort((a, b) => b.createdAt - a.createdAt)
  } else if (sort === 'views') {
    out.sort((a, b) => (b.stats?.views ?? 0) - (a.stats?.views ?? 0))
  } else {
    // Outlier: scored cards first by multiple, then everything else by views.
    // Meta cards have neither, so they fall back to days running — which keeps
    // the sort meaningful on that tab instead of freezing it in fetch order.
    out.sort((a, b) => {
      const am = a.outlier?.multiple ?? 0
      const bm = b.outlier?.multiple ?? 0
      if (am !== bm) return bm - am
      const ad = a.ad?.daysRunning ?? 0
      const bd = b.ad?.daysRunning ?? 0
      if (ad !== bd) return bd - ad
      return (b.stats?.views ?? 0) - (a.stats?.views ?? 0)
    })
  }
  return out
}

// ── Entry point ─────────────────────────────────────────────────

/**
 * Shouts when a page came back full and normalised to nothing.
 *
 * That combination means the vendor changed a field name, not that the search
 * found nothing — and it is otherwise indistinguishable from "no results" in
 * the UI. It's exactly how the `aweme_info` wrapper silently emptied every
 * TikTok search: the rows were all there, and every one failed its id check.
 */
function warnIfAllDropped(platform: string, raw: number, kept: number): void {
  if (raw > 0 && kept === 0) {
    console.warn(
      `[outliers] ${platform}: ${raw} row(s) came back and all were dropped in normalisation. ` +
      'The response shape has probably changed — check the field names in utils/scrapecreators.ts.',
    )
  }
}

export async function runSearch(
  apiKey: string,
  platform: 'tiktok' | 'meta',
  query: string,
  filters: DiscoverFilters,
  cursor?: string | number,
): Promise<DiscoverPage> {
  if (platform === 'tiktok') {
    const page = await searchTikTokKeyword(apiKey, {
      query,
      datePosted: filters.datePosted,
      // Our own outlier sort is applied client-side afterwards, so ask the
      // vendor for the widest useful net rather than a pre-sorted page:
      // most-liked biases hard toward big accounts, which is the opposite of
      // what an outlier hunt wants.
      sortBy: filters.sort === 'recent' ? 'date-posted' : 'relevance',
      cursor: typeof cursor === 'number' ? cursor : undefined,
    })
    const results = page.items
      .map(normaliseTikTok)
      .filter((r): r is DiscoverResult => r !== null)
    warnIfAllDropped('tiktok', page.items.length, results.length)
    return { results, cursor: page.cursor, creditsRemaining: page.creditsRemaining }
  }

  const page = await searchMetaAds(apiKey, {
    query,
    country: filters.country,
    status: filters.activeOnly ? 'ACTIVE' : 'ALL',
    exactPhrase: filters.exactPhrase,
    cursor: typeof cursor === 'string' ? cursor : undefined,
  })
  const results = page.items
    .map(normaliseMeta)
    .filter((r): r is DiscoverResult => r !== null)
  warnIfAllDropped('meta', page.items.length, results.length)
  return { results, cursor: page.cursor, creditsRemaining: page.creditsRemaining }
}

/**
 * Merges a new page into the existing list, dropping duplicates by id.
 * TikTok's own docs warn that keyword search can return the same video twice
 * across pages, and a duplicate card would look like a bug in the grid.
 */
export function mergeResults(existing: DiscoverResult[], incoming: DiscoverResult[]): DiscoverResult[] {
  const seen = new Set(existing.map((r) => `${r.platform}:${r.id}`))
  const fresh = incoming.filter((r) => !seen.has(`${r.platform}:${r.id}`))
  return [...existing, ...fresh]
}
