// Outliers — one normalised card type for every platform.
//
// The app id is 'discover' (stable, keys the persisted state); the display
// name is "Outliers". Folder, ids and types keep the discover naming.

export type DiscoverPlatform = 'tiktok' | 'instagram' | 'meta'

/**
 * Which of Outliers' five tabs is on screen.
 *
 * Two of them are not platforms and never become one. The vault is a fixed
 * library that ships with the app; accounts is a tracked list the member
 * curates. Neither has a keyword search, a page cursor or a per-tab query, so
 * keeping both out of `DiscoverPlatform` is what stops every
 * `Record<DiscoverPlatform, …>` in the app growing keys that mean nothing.
 */
export type DiscoverView = 'vault' | 'accounts' | DiscoverPlatform

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

/**
 * Whatever numbers the platform actually published — every field optional,
 * and an absent one is never filled with a zero.
 *
 * TikTok publishes all five. Instagram's reel search publishes likes and
 * comments and nothing else: no view count (so no outlier multiple and no
 * engagement rate, both of which divide BY views), and no shares or saves. A
 * zero in those cells would read as "this reel got no saves" rather than as
 * "Instagram doesn't say", which is the same lie the Meta tab refuses to tell
 * with a made-up outlier score. Every surface renders the cells it was given
 * and leaves out the rest.
 */
export interface DiscoverStats {
  views?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
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
 * Instagram sits between the two: real likes and comments, no views, so it
 * carries `stats` with three of its five cells empty and no `outlier`.
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

export type DiscoverSort = 'outlier' | 'views' | 'likes' | 'recent'

export interface DiscoverFilters {
  /** Videos below this view count never score, however good the ratio. */
  minViews: number
  datePosted: 'yesterday' | 'this-week' | 'this-month' | 'last-3-months' | 'last-6-months' | 'all-time'
  sort: DiscoverSort
  /**
   * Instagram only. Its search reads GOOGLE'S INDEX of Instagram, which offers
   * three windows and nothing finer — so it keeps its own field rather than
   * borrowing `datePosted`. Mapping "3 months" onto the nearest of the three
   * would search a year and say otherwise.
   */
  instagramDatePosted: 'last-week' | 'last-month' | 'last-year' | 'all-time'
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
  /**
   * Meta only. The Ad Library is mostly static images, which are no use when
   * you're hunting UGC video ads to tear down — this filters at the API rather
   * than client-side, so a page of 30 is 30 videos instead of 30 mixed.
   */
  mediaType: 'ALL' | 'VIDEO' | 'IMAGE'
}

export const DEFAULT_FILTERS: DiscoverFilters = {
  minViews: 10_000,
  datePosted: 'last-3-months',
  sort: 'outlier',
  // The widest window Instagram offers, since its index is patchy enough that
  // a narrow one on a niche phrase returns nothing at all.
  instagramDatePosted: 'last-year',
  country: 'US',
  activeOnly: true,
  exactPhrase: false,
  // Defaults to video: this is a tool for finding UGC ads to take apart, and
  // a static image has no hook, no delivery and no transcript to remix.
  mediaType: 'VIDEO',
}

// ── The Accounts tab ────────────────────────────────────────────

export type AccountSort = 'score' | 'plays' | 'recent'

/**
 * The Accounts tab's own filter set, deliberately separate from
 * `DiscoverFilters`.
 *
 * Nothing here is sent to the vendor — this endpoint takes an account and a
 * page and nothing else — so all three run client-side over reels already
 * paid for. That is also why the score floor is a MULTIPLE rather than the
 * search tabs' view floor: on one account the interesting cut is "show me
 * everything that beat their usual", not "hide the small stuff".
 */
export interface AccountFilters {
  sort: AccountSort
  /** 0 = any. Matches the badge's own bands so the control and the pill agree. */
  minMultiple: 0 | 2 | 3 | 5 | 10
  posted: 'all' | '1m' | '3m' | '6m' | '12m'
}

export const DEFAULT_ACCOUNT_FILTERS: AccountFilters = {
  // The tab exists to surface an account's outliers, so it opens on them —
  // unlike the search tabs, where the newest page is the thing just bought.
  sort: 'score',
  minMultiple: 0,
  posted: 'all',
}
