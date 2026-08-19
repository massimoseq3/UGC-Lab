// The Outlier Vault — a curated library that ships WITH the app.
//
// Deliberately not a `DiscoverResult`. A search card is a live row off a
// vendor: signed urls that expire, stats pulled minutes ago, a platform whose
// quirks the normaliser has to hide. A vault row is the opposite — a static
// entry harvested once, carrying the two things a search result never has (the
// hook line lifted out of the transcript, and the reusable template behind it)
// and missing the ones it always has (views, shares, saves, a playable video).
//
// Built by `scripts/build-vault.py` into `public/vault/library.json`.

export interface VaultItem {
  /** The Instagram shortcode, sanitized to a safe path segment. */
  id: string
  /** Permalink to the reel. */
  url: string
  /** The opening line, as spoken. The reason this library exists. */
  hook: string
  /** The hook as a reusable formula — "This is what you would (insert verb)…". */
  template: string
  /** EDUCATIONAL / STORYTELLING / MYTH BUSTING / … Empty on a handful of rows. */
  category: string
  /** Structural tags for the opening line: big_number, curiosity_gap, … */
  patterns: string[]
  /** The whole spoken script. Empty on 18 of the 872 (music-only, no speech). */
  transcript: string
  author: string
  authorName: string
  caption: string
  /** Unix milliseconds. */
  createdAt: number
  likes: number
  comments: number
  /**
   * Engagement ÷ the median engagement of the whole library.
   *
   * A different denominator from Outliers' search score (views ÷ the creator's
   * followers) and it must never be printed as if it were the same figure —
   * see `MULTIPLE_TITLE` in the service for the wording that says what it is.
   */
  multiple: number | null
  /** Where this row ranks by engagement within the library, 0–100. */
  percentile: number | null
  hasThumb: boolean
}

export type VaultSort = 'outlier' | 'recent' | 'likes'

export interface VaultFilters {
  /** '' means every category. */
  category: string
  /** '' means every pattern. */
  pattern: string
  sort: VaultSort
  /** Show only the rows the member starred. */
  starredOnly: boolean
}

export const DEFAULT_VAULT_FILTERS: VaultFilters = {
  category: '',
  pattern: '',
  sort: 'outlier',
  starredOnly: false,
}

/**
 * A vault row's resolved video, once someone has spent the credit on it.
 *
 * Session-only by design: the url is a signed Instagram link that expires
 * within hours, so persisting it would restore a library full of dead players
 * — the exact failure the search tab's 6-hour TTL exists to avoid, with none
 * of the upside, since the row itself is already permanent.
 */
export interface ResolvedVideo {
  url: string
  /** Fresher than the shipped cover, and free once we've paid for the post. */
  coverUrl: string | null
}
