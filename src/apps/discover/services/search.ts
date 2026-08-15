// Turns each platform's raw payload into the single DiscoverResult the grid
// renders. Everything vendor-shaped stops here.

import {
  searchTikTokKeyword,
  searchMetaAds,
  fetchTikTokVideo,
  fetchMetaAd,
  firstUrl,
  type TikTokSearchItem,
  type MetaAdItem,
  type MetaCreative,
  type MetaSnapshot,
} from '../../../utils/scrapecreators'
import type { DiscoverFilters, DiscoverPlatform, DiscoverResult, DiscoverSort } from '../types'
import { scoreOutlier } from './scoring'

const DAY_MS = 86_400_000

export interface DiscoverPage {
  results: DiscoverResult[]
  cursor: string | number | null
  creditsRemaining: number | null
}

// ── TikTok ──────────────────────────────────────────────────────

/**
 * A TikTok row's playable urls.
 *
 * Shared by the search normaliser and the single-video refresh below so the two
 * can't drift on which render they prefer — a watermark burned across the frame
 * would end up in the Ad Analyzer's vision read and in any B-Roll built off it.
 */
function tikTokMedia(item: TikTokSearchItem): { videoUrl?: string; coverUrl?: string } {
  const video = item.video ?? {}
  return {
    videoUrl:
      firstUrl(video.download_no_watermark_addr) ??
      firstUrl(video.play_addr) ??
      firstUrl(video.download_addr),
    // origin_cover is the full-size still; `cover` is a smaller crop. Either
    // beats nothing, and the dynamic (animated) cover is deliberately not used
    // as the poster — it's a video file wearing an image's field name.
    coverUrl: firstUrl(video.origin_cover) ?? firstUrl(video.cover),
  }
}

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
    ...tikTokMedia(item),
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

// Meta files an ad's creative in one of several places depending on its format,
// and every url field it doesn't have comes back as an explicit `null` rather
// than being omitted. Those two facts together are what put blank tiles in the
// grid: `snap.videos?.[0] ?? snap.cards?.[0]` picks the first SLOT that exists,
// so a DCO ad carrying `videos: [{ video_hd_url: null, … }]` locked onto that
// empty entry and the real creative sitting in `cards[]` was never reached.
// Select on the VALUE instead — the first slot that actually yields a url.

/** Video sources, best first. Clean renders before Meta's watermarked ones. */
const VIDEO_URL_FIELDS = [
  'video_hd_url', 'video_sd_url',
  'video_hd_handle', 'video_sd_handle',
  'watermarked_video_hd_url', 'watermarked_video_sd_url',
] as const satisfies readonly (keyof MetaCreative)[]

/** Cover sources, best first. A video's own poster beats a carousel still. */
const COVER_URL_FIELDS = [
  'video_preview_image_url',
  'original_image_url', 'resized_image_url',
  'watermarked_resized_image_url',
] as const satisfies readonly (keyof MetaCreative)[]

/**
 * Every slot an ad's creative could be filed in, in the order we prefer them.
 *
 * All of them, not just `[0]` of each: a carousel whose first card is text-only
 * still has its video two cards along, and reading one index dropped it.
 */
function creativeSlots(snap: MetaSnapshot | undefined, depth = 0): MetaCreative[] {
  // A reshared post can in principle nest again; two levels is plenty and the
  // guard is what stops a self-referencing payload spinning here.
  if (!snap || depth > 2) return []
  return [
    ...(snap.videos ?? []),
    ...(snap.cards ?? []),
    ...(snap.images ?? []),
    ...(snap.extra_videos ?? []),
    ...(snap.extra_images ?? []),
    ...creativeSlots(snap.root_reshared_post, depth + 1),
  ]
}

/** The first real url across those slots, or undefined if the ad carries none. */
function pickCreativeUrl(
  slots: MetaCreative[],
  fields: readonly (keyof MetaCreative)[],
): string | undefined {
  for (const slot of slots) {
    for (const field of fields) {
      const value = slot[field]
      // An absolute url or nothing. `null` is the common case, and a non-url
      // handle landing in videoUrl renders play controls over a black frame
      // that will never load — worse than the card admitting it has no video.
      if (typeof value === 'string' && /^https?:\/\//.test(value)) return value
    }
  }
  return undefined
}

function normaliseMeta(ad: MetaAdItem): DiscoverResult | null {
  const id = ad.ad_archive_id
  if (!id) return null

  const snap = ad.snapshot ?? {}
  const slots = creativeSlots(snap)

  return {
    id,
    platform: 'meta',
    // The written caption. NOT the script — that's the transcript, fetched
    // separately, and the modal labels the two apart.
    caption: snap.body?.text ?? snap.title ?? '',
    postUrl: ad.url ?? `https://www.facebook.com/ads/library/?id=${id}`,
    // May still be undefined (a video ad with no poster anywhere). The card
    // handles that by painting a frame of the video itself.
    coverUrl: pickCreativeUrl(slots, COVER_URL_FIELDS),
    videoUrl: pickCreativeUrl(slots, VIDEO_URL_FIELDS),
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

// ── Re-resolving expired media ──────────────────────────────────

/** What a refresh can hand back. Both may be absent — the ad may be gone. */
export interface RefreshedMedia {
  videoUrl?: string
  coverUrl?: string
  creditsRemaining: number | null
}

/**
 * Fresh, playable urls for an ad we already know the identity of. **1 credit.**
 *
 * This exists for the swipe file. A saved row keeps its thumbnail as our own
 * asset, but the video is only ever a signed CDN link, and those die within
 * hours (TikTok) or days (Meta) — so a swipe filed last week opens with a dead
 * player and an Analyze button that can't fetch anything. Asking the platform
 * again is the only way back to the video, since we deliberately don't store it.
 *
 * It returns MEDIA ONLY, never stats. A swipe is a record of what a winner
 * looked like when you found it, so today's view count has no business
 * overwriting the one you saved — the numbers on the row are the whole reason
 * it's a swipe file rather than a bookmark.
 */
export async function refreshResultMedia(
  apiKey: string,
  platform: DiscoverPlatform,
  ref: { sourceId: string; postUrl?: string },
): Promise<RefreshedMedia> {
  if (platform === 'meta') {
    const { ad, creditsRemaining } = await fetchMetaAd(apiKey, ref.sourceId)
    const slots = creativeSlots(ad?.snapshot)
    return {
      videoUrl: pickCreativeUrl(slots, VIDEO_URL_FIELDS),
      coverUrl: pickCreativeUrl(slots, COVER_URL_FIELDS),
      creditsRemaining,
    }
  }

  const { item, creditsRemaining } = await fetchTikTokVideo(apiKey, {
    videoId: ref.sourceId,
    url: ref.postUrl,
  })
  return { ...(item ? tikTokMedia(item) : {}), creditsRemaining }
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

/**
 * A card with something to show — a video to play or a still to look at.
 *
 * Exported because the persisted grid is filtered through it too: a search
 * restored from before this rule existed would otherwise hand back the blank
 * tiles it was saved with, for the six hours the results stay fresh.
 */
export function isPreviewable(result: DiscoverResult): boolean {
  return !!result.videoUrl || !!result.coverUrl
}

/**
 * Drops the cards there is nothing to see on.
 *
 * Meta publishes ads whose creative isn't fetchable at all — no video, no
 * poster, nothing in any of the slots. There is no research to do on one of
 * those: Analyze and Download are dead, the thumbnail is a placeholder, and the
 * only route left is the Ad Library, which answers with a sign-in wall. It is a
 * hole in a grid the member paid a credit for either way, so it shouldn't take
 * up a tile that a real ad could have.
 *
 * The drop carries the shape-change alarm that `warnIfAllDropped` carries for
 * the id checks — silently removing most of a page is exactly what a moved
 * field name looks like from the outside, and it is now indistinguishable from
 * a quiet keyword unless the console says otherwise.
 */
function dropUnpreviewable(platform: string, results: DiscoverResult[]): DiscoverResult[] {
  const kept = results.filter(isPreviewable)
  const dropped = results.length - kept.length
  if (dropped > 0 && dropped >= results.length / 2) {
    console.warn(
      `[outliers] ${platform}: ${dropped} of ${results.length} card(s) had no video and no cover and were dropped. ` +
      'Check the creative field names in utils/scrapecreators.ts against a live response.',
    )
  }
  return kept
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
    const normalised = page.items
      .map(normaliseTikTok)
      .filter((r): r is DiscoverResult => r !== null)
    warnIfAllDropped('tiktok', page.items.length, normalised.length)
    const results = dropUnpreviewable('tiktok', normalised)
    return { results, cursor: page.cursor, creditsRemaining: page.creditsRemaining }
  }

  const page = await searchMetaAds(apiKey, {
    query,
    country: filters.country,
    status: filters.activeOnly ? 'ACTIVE' : 'ALL',
    mediaType: filters.mediaType,
    exactPhrase: filters.exactPhrase,
    cursor: typeof cursor === 'string' ? cursor : undefined,
  })
  const normalised = page.items
    .map(normaliseMeta)
    .filter((r): r is DiscoverResult => r !== null)
  warnIfAllDropped('meta', page.items.length, normalised.length)
  const results = dropUnpreviewable('meta', normalised)
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
