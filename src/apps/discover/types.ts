// Outliers — one normalised card type for both platforms.
//
// The app id is 'discover' (stable, keys the persisted state); the display
// name is "Outliers". Folder, ids and types keep the discover naming.

export type DiscoverPlatform = 'tiktok' | 'meta'

/** Which band a video's view-to-follower multiple falls into. */
export type OutlierBand = '2x' | '5x' | '10x'

export interface OutlierScore {
  /** views ÷ the creator's follower count. */
  multiple: number
  band: OutlierBand
}

export interface DiscoverAuthor {
  handle: string
  name: string
  avatarUrl?: string
  followerCount?: number
}

export interface DiscoverStats {
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
}

export interface DiscoverAdMeta {
  isActive: boolean
  /** Whole days the ad has been live. Meta's own counter where available. */
  daysRunning: number | null
  ctaText?: string
  landingUrl?: string
  /** FACEBOOK / INSTAGRAM / etc. */
  platforms: string[]
}

/**
 * One card in the grid, whichever platform it came from.
 *
 * `stats`/`outlier` and `ad` are deliberately mutually exclusive in practice:
 * only TikTok publishes a real view count, and only Meta publishes how long an
 * ad has run. Meta returns `spend` and `reach_estimate` as null for every
 * commercial ad, so there is no honest outlier score to compute there — the
 * card renders whichever block it was given and never invents the other.
 */
export interface DiscoverResult {
  /** aweme_id (TikTok) or ad_archive_id (Meta). Unique within a platform. */
  id: string
  platform: DiscoverPlatform
  /** Caption (TikTok) or the ad's body copy (Meta). */
  caption: string
  /** Permalink to the original post. */
  postUrl: string
  coverUrl?: string
  /** Direct media URL. TikTok's is the no-watermark render. */
  videoUrl?: string
  durationSeconds?: number
  /** Unix milliseconds. */
  createdAt: number

  author: DiscoverAuthor

  stats?: DiscoverStats
  outlier?: OutlierScore
  ad?: DiscoverAdMeta
}

// ── Search inputs ───────────────────────────────────────────────

export type DiscoverSort = 'outlier' | 'views' | 'recent'

export interface DiscoverFilters {
  /** Videos below this view count never score, however good the ratio. */
  minViews: number
  datePosted: 'yesterday' | 'this-week' | 'this-month' | 'last-3-months' | 'last-6-months' | 'all-time'
  sort: DiscoverSort
  /** Meta only — 2-letter code. */
  country: string
  /** Meta only. */
  activeOnly: boolean
  /**
   * Meta only. Meta's own keyword search is loose by default — it matches
   * advertiser names and its own relevance model, which is why a search for
   * one product returns ads for other things. This switches it to
   * `keyword_exact_phrase`, the only lever the API exposes over that.
   */
  exactPhrase: boolean
}

export const DEFAULT_FILTERS: DiscoverFilters = {
  minViews: 10_000,
  datePosted: 'last-3-months',
  sort: 'outlier',
  country: 'US',
  activeOnly: true,
  exactPhrase: false,
}
