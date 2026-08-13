// ScrapeCreators API client — the search side of Outliers.
//
// Unlike kie.ai there is no task/poll cycle: every call is one request and one
// JSON body. ScrapeCreators sends `access-control-allow-origin: *` and allows
// the `x-api-key` header, so the BROWSER calls it directly and the member's key
// never touches our servers — the same doctrine as the kie.ai key.
//
// Docs: https://docs.scrapecreators.com (machine-readable: /openapi.json)
//
// Every response carries `credits_remaining`, so the app can show a live
// balance without a separate billing endpoint — that's also how a key is
// validated (see scTestConnection).
//
// This module is the ONLY place that knows endpoint paths and raw field names.
// Normalising the two platforms into one card type is apps/discover/services.

const BASE_URL = 'https://api.scrapecreators.com'
const DEFAULT_TIMEOUT_MS = 30_000

// A search page. Confirmed against the documented `cursor: 30` in their own
// example response — one credit buys 30 results.
export const RESULTS_PER_PAGE = 30

// ── Errors ──────────────────────────────────────────────────────

// Messages are deliberately prefixed "ScrapeCreators" so friendlyError can tell
// them apart from kie.ai failures — otherwise a 401 here would tell the member
// to go and replace their kie.ai key, which is the wrong key entirely.
export class ScrapeCreatorsError extends Error {
  readonly status: number
  constructor(status: number, detail: string) {
    super(`ScrapeCreators request failed (${status}): ${detail}`)
    this.name = 'ScrapeCreatorsError'
    this.status = status
  }
}

// ── Raw response shapes ─────────────────────────────────────────
//
// Only the fields we actually read are declared, and every one is optional:
// these are scraped payloads, so a field present in the vendor's example can be
// missing on a real row. The normalisers use optional chaining throughout and
// must never assume a shape.

interface UrlList {
  url_list?: string[]
}

interface TikTokAuthor {
  unique_id?: string
  nickname?: string
  follower_count?: number
  avatar_thumb?: UrlList
}

interface TikTokStatistics {
  play_count?: number
  digg_count?: number
  comment_count?: number
  share_count?: number
  collect_count?: number
}

interface TikTokVideo {
  /** Milliseconds, despite the bare name. */
  duration?: number
  cover?: UrlList
  origin_cover?: UrlList
  dynamic_cover?: UrlList
  download_no_watermark_addr?: UrlList
  play_addr?: UrlList
  download_addr?: UrlList
}

export interface TikTokSearchItem {
  aweme_id?: string
  desc?: string
  /** Unix seconds. */
  create_time?: number
  url?: string
  is_ad?: boolean
  statistics?: TikTokStatistics
  video?: TikTokVideo
  author?: TikTokAuthor
}

// A row of `search_item_list`. ScrapeCreators' own docs disagree with their own
// example here: the endpoint DESCRIPTION says each row wraps the video in
// `aweme_info`, while the example response shows the fields sitting at the top
// level of the row. Reading only the top level meant every row failed the
// `aweme_id` check and the grid came back empty on every search. Accept both.
interface TikTokSearchRow extends TikTokSearchItem {
  aweme_info?: TikTokSearchItem
}

interface TikTokSearchResponse {
  success?: boolean
  credits_remaining?: number
  search_item_list?: TikTokSearchRow[]
  cursor?: number
}

// Every url field below is `string | null | undefined` on purpose. Meta does
// not omit a creative field it has nothing for — it sends the key with a null,
// which is why `a ?? b` chains over these read as "found it" and then hand back
// nothing. Anything selecting from them has to test the VALUE, not the key.
interface MetaImage {
  original_image_url?: string | null
  resized_image_url?: string | null
  /** Meta's own render, with its overlay burned in. Last resort — see below. */
  watermarked_resized_image_url?: string | null
}

// `video_preview_image_url` is NOT always present — a plain video ad in the
// live payload carries only the url/handle fields and no poster at all, which
// is why those cards rendered as empty black tiles. Everything here is optional
// and the card falls back to painting a frame of the video itself.
interface MetaVideo {
  video_hd_url?: string | null
  video_sd_url?: string | null
  video_preview_image_url?: string | null
  video_hd_handle?: string | null
  video_sd_handle?: string | null
  // Meta blanks the clean urls on plenty of ads and publishes only these. A
  // watermarked render is a worse source for the Ad Analyzer's vision read, so
  // it's the last thing tried — but it is an ad you can watch, which beats the
  // blank tile those ads used to render as.
  watermarked_video_hd_url?: string | null
  watermarked_video_sd_url?: string | null
}

/**
 * One slot the ad's creative can be filed in.
 *
 * `videos`, `images`, `extra_*` and a carousel/DCO `cards[]` entry are all the
 * same bag of url fields, so they normalise as one type rather than four.
 */
export interface MetaCreative extends MetaImage, MetaVideo {
  body?: string
  title?: string
  link_url?: string
}

export interface MetaSnapshot {
  body?: { text?: string }
  title?: string
  caption?: string
  cta_text?: string
  link_url?: string
  page_name?: string
  page_profile_picture_url?: string
  page_like_count?: number
  images?: MetaCreative[]
  videos?: MetaCreative[]
  extra_images?: MetaCreative[]
  extra_videos?: MetaCreative[]
  cards?: MetaCreative[]
  /**
   * A boosted organic post keeps its creative on the POST, so the ad's own
   * `videos`/`images` come back empty and everything worth showing is one
   * level down here.
   */
  root_reshared_post?: MetaSnapshot
  /** IMAGE / VIDEO / CAROUSEL / DCO / MEME … */
  display_format?: string
}

export interface MetaAdItem {
  ad_archive_id?: string
  page_id?: string
  page_name?: string
  is_active?: boolean
  /** Unix seconds. */
  start_date?: number
  end_date?: number
  /** Seconds the ad has been live, per Meta's own counter. */
  total_active_time?: number
  publisher_platform?: string[]
  url?: string
  snapshot?: MetaSnapshot
}

interface MetaSearchResponse {
  success?: boolean
  credits_remaining?: number
  searchResults?: MetaAdItem[] | MetaAdItem[][]
  cursor?: string
}

interface TranscriptResponse {
  success?: boolean
  credits_remaining?: number
  transcript?: string
}

interface MetaTranscriptResponse {
  success?: boolean
  credits_remaining?: number
  data?: {
    transcript?: string | null
    transcript_available?: boolean
  }
}

/** What every endpoint hands back: the rows, a cursor, and the live balance. */
export interface SearchPage<T> {
  items: T[]
  /** Pass back as `cursor` to fetch the next page. Null when exhausted. */
  cursor: string | number | null
  creditsRemaining: number | null
}

// ── Transport ───────────────────────────────────────────────────

/** Reads the first entry of TikTok's `{ url_list: [...] }` wrapper. */
export function firstUrl(list: UrlList | undefined): string | undefined {
  const url = list?.url_list?.[0]
  return typeof url === 'string' && url ? url : undefined
}

async function scFetch<T>(
  apiKey: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  if (!apiKey) throw new ScrapeCreatorsError(401, 'No API key configured.')

  const url = new URL(path, BASE_URL)
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue
    url.searchParams.set(k, String(v))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
      signal: controller.signal,
    })
  } catch (e) {
    // AbortError and a genuine network drop both land here. Both are worded so
    // friendlyError's network/timeout rules can pick them up.
    const aborted = e instanceof Error && e.name === 'AbortError'
    throw new ScrapeCreatorsError(
      0,
      aborted ? 'request timed out' : 'connection failed',
    )
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    // Their errors come back as JSON ({ success: false, message }) but a
    // gateway can return text/plain, so read defensively either way.
    const raw = await res.text().catch(() => '')
    let detail = raw.slice(0, 300)
    try {
      const parsed = JSON.parse(raw) as { message?: string; error?: string }
      detail = parsed.message ?? parsed.error ?? detail
    } catch { /* not JSON — keep the raw text */ }
    throw new ScrapeCreatorsError(res.status, detail || res.statusText)
  }

  const body = await res.json().catch(() => null) as T | null
  if (!body) throw new ScrapeCreatorsError(res.status, 'empty response')
  return body
}

// ── Endpoints ───────────────────────────────────────────────────

export type TikTokDatePosted =
  | 'yesterday' | 'this-week' | 'this-month'
  | 'last-3-months' | 'last-6-months' | 'all-time'

export type TikTokSortBy = 'relevance' | 'most-liked' | 'date-posted'

export async function searchTikTokKeyword(
  apiKey: string,
  opts: {
    query: string
    datePosted?: TikTokDatePosted
    sortBy?: TikTokSortBy
    cursor?: number
  },
): Promise<SearchPage<TikTokSearchItem>> {
  const body = await scFetch<TikTokSearchResponse>(apiKey, '/v1/tiktok/search/keyword', {
    query: opts.query,
    date_posted: opts.datePosted,
    sort_by: opts.sortBy,
    cursor: opts.cursor,
  })

  // Unwrap here rather than downstream, so everything past this point sees one
  // shape whichever variant the API is serving today.
  const items = (body.search_item_list ?? []).map((row) => row.aweme_info ?? row)

  return {
    items,
    // TikTok keeps handing back a cursor forever; a short page is the real
    // end-of-results signal.
    cursor: items.length < RESULTS_PER_PAGE ? null : body.cursor ?? null,
    creditsRemaining: body.credits_remaining ?? null,
  }
}

export type MetaAdStatus = 'ALL' | 'ACTIVE' | 'INACTIVE'
export type MetaMediaType = 'ALL' | 'IMAGE' | 'VIDEO' | 'MEME' | 'IMAGE_AND_MEME' | 'NONE'

export async function searchMetaAds(
  apiKey: string,
  opts: {
    query: string
    country?: string
    status?: MetaAdStatus
    mediaType?: MetaMediaType
    exactPhrase?: boolean
    cursor?: string
  },
): Promise<SearchPage<MetaAdItem>> {
  const body = await scFetch<MetaSearchResponse>(apiKey, '/v1/facebook/adLibrary/search/ads', {
    query: opts.query,
    country: opts.country,
    status: opts.status,
    media_type: opts.mediaType,
    search_type: opts.exactPhrase ? 'keyword_exact_phrase' : 'keyword_unordered',
    cursor: opts.cursor,
  })

  // Meta groups collated ad variants, so `searchResults` can arrive as an array
  // of arrays. Flatten one level — a nested group is the same creative running
  // under several archive ids, and the grid wants one card per ad.
  const raw = body.searchResults ?? []
  const items = (raw as Array<MetaAdItem | MetaAdItem[]>).flatMap((r) =>
    Array.isArray(r) ? r : [r],
  )

  return {
    items,
    cursor: body.cursor ?? null,
    creditsRemaining: body.credits_remaining ?? null,
  }
}

/**
 * TikTok's own captions for a video, as WEBVTT.
 *
 * `useAiFallback` costs an EXTRA 10 credits, so it is never on by default —
 * the UI offers it as an explicit retry after a miss rather than silently
 * billing 11 credits for what the member asked to cost 1.
 */
export async function fetchTikTokTranscript(
  apiKey: string,
  videoUrl: string,
  opts: { useAiFallback?: boolean; language?: string } = {},
): Promise<{ transcript: string; creditsRemaining: number | null }> {
  const body = await scFetch<TranscriptResponse>(apiKey, '/v1/tiktok/video/transcript', {
    url: videoUrl,
    language: opts.language,
    use_ai_as_fallback: opts.useAiFallback ? 'true' : undefined,
  }, 60_000)

  return {
    transcript: body.transcript ?? '',
    creditsRemaining: body.credits_remaining ?? null,
  }
}

/**
 * The words SPOKEN in a Meta ad's video, by archive id.
 *
 * Not to be confused with the ad's body copy, which rides on the search result
 * already — that's the written caption, and remixing it gives you somebody's
 * ad copy rather than the script their creator actually performed.
 *
 * Uses Facebook's captions when exposed and transcribes the public video URL
 * otherwise. **Credits are only charged when a transcript comes back**, so
 * calling this speculatively on an image ad is free — which is what makes
 * auto-fetching it on modal open reasonable.
 */
export async function fetchMetaAdTranscript(
  apiKey: string,
  adArchiveId: string,
): Promise<{ transcript: string; creditsRemaining: number | null }> {
  const body = await scFetch<MetaTranscriptResponse>(apiKey, '/v1/facebook/adLibrary/ad/transcript', {
    id: adArchiveId,
  }, 90_000)

  return {
    transcript: body.data?.transcript ?? '',
    creditsRemaining: body.credits_remaining ?? null,
  }
}

/**
 * Validates a key by spending one credit on a trivial search and reading the
 * balance off the response. There is no free balance endpoint — but since a
 * connected key needs a working search anyway, proving it end-to-end is worth
 * more than saving a credit. Mirrors kieTestConnection's shape.
 *
 * Infra surface: the caller shows the RAW message, not humanizeError copy.
 */
export async function scTestConnection(
  apiKey: string,
): Promise<{ ok: true; credits: number | null } | { ok: false; error: string }> {
  try {
    const page = await searchTikTokKeyword(apiKey, { query: 'ugc' })
    return { ok: true, credits: page.creditsRemaining }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ── WEBVTT ──────────────────────────────────────────────────────

/**
 * Strips WEBVTT scaffolding down to plain spoken prose.
 *
 * Drops the header, cue numbers and `00:00:01.000 --> 00:00:03.000` timing
 * lines, then collapses consecutive duplicate lines — TikTok's caption tracks
 * routinely repeat a line across cues as it scrolls on screen, and Scripts'
 * Remix box should receive the words once.
 */
export function vttToPlainText(vtt: string): string {
  const lines = vtt.split(/\r?\n/)
  const out: string[] = []

  for (const line of lines) {
    const text = line.trim()
    if (!text) continue
    if (text === 'WEBVTT' || text.startsWith('NOTE ')) continue
    if (text.includes('-->')) continue
    if (/^\d+$/.test(text)) continue
    if (out[out.length - 1] === text) continue
    out.push(text)
  }

  return out.join(' ').replace(/\s+/g, ' ').trim()
}
