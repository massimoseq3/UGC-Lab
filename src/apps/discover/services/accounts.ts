// The Accounts tab: one creator at a time, their own reels, scored against
// their own median.
//
// This is the half of Outliers that answers a different question from search.
// A keyword search asks "who is winning with this angle?" and ranks strangers
// against each other. Tracking an account asks "which of THIS creator's reels
// popped?" — the question you have once you've found somebody worth watching,
// and the one you come back to every week.
//
// It runs on two endpoints the search tabs don't touch, and the reason the tab
// can exist at all is that both publish a play count: `/v1/instagram/profile`
// (1 credit, free inside its cache window) and `/v1/instagram/user/reels`
// (1 credit a page). Instagram's keyword search publishes neither, which is why
// that tab has no score.

import {
  fetchInstagramProfile,
  fetchInstagramUserReels,
  type InstagramProfile,
  type InstagramUserReelMedia,
} from '../../../utils/scrapecreators'
import { FriendlyError } from '../../../utils/friendlyError'
import type { TrackedAccount } from '../../../stores/types'
import { accountBaseline, scoreAgainstBaseline } from './scoring'
import type { AccountFilters, DiscoverResult } from '../types'

/** Path segments that are Instagram's own routes, never somebody's handle. */
const RESERVED_PATHS = new Set([
  'reel', 'reels', 'p', 'tv', 'stories', 'explore', 'accounts', 'direct',
  'about', 'legal', 'privacy', 'developer', 'challenge', 's',
])

/**
 * The handle out of whatever the member pasted.
 *
 * Takes a bare handle, an @handle, a profile url, and a post or reel url that
 * carries the owner in its path (`instagram.com/nike/reel/ABC/`) — which is the
 * shape you get from Instagram's own share button on a profile's own reel.
 *
 * Deliberately does NOT accept a bare `instagram.com/reel/ABC/`: that url
 * names the reel and not its owner, and resolving one would cost a credit to
 * discover we already can't get an owner off that endpoint's payload. Returns
 * null and lets the caller say what to paste instead.
 */
export function parseInstagramHandle(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null

  // Is this a LINK or a NAME? Decided on the things that only a link has: a
  // scheme, a path separator, or Instagram's own host. It used to be decided
  // on "contains a dot", which quietly rejected a huge share of real accounts
  // — a dot is legal in an Instagram handle and extremely common, so typing
  // `honeydew.skin` was read as a hostname, failed the instagram.com check and
  // came back "that doesn't look like an Instagram account".
  const looksLikeLink = /^https?:\/\//i.test(raw)
    || raw.includes('/')
    || /^(www\.)?instagram\.com$/i.test(raw)

  if (!looksLikeLink) {
    // The @ is optional and always has been on Instagram itself — a member
    // typing the bare name means the same thing, so infer it.
    const handle = raw.replace(/^@/, '').toLowerCase()
    return /^[a-z0-9._]{1,30}$/.test(handle) ? handle : null
  }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null

  const segments = url.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase())
  const first = segments[0]
  if (!first || RESERVED_PATHS.has(first)) return null
  return /^[a-z0-9._]{1,30}$/.test(first) ? first : null
}

/**
 * Looks up a profile so it can be tracked.
 *
 * Throws a `FriendlyError` rather than returning a null the caller has to word:
 * everything that can go wrong here is a sentence we wrote ourselves (a handle
 * that isn't a handle, a profile that isn't there), and `humanizeError`'s rule
 * table only knows how to translate VENDOR phrasing.
 */
export async function resolveAccount(
  apiKey: string,
  input: string,
): Promise<{ profile: InstagramProfile; creditsRemaining: number | null }> {
  const handle = parseInstagramHandle(input)
  if (!handle) {
    throw new FriendlyError(
      "That doesn't look like an Instagram account. Paste their profile link or their @handle.",
    )
  }

  const { profile, creditsRemaining } = await fetchInstagramProfile(apiKey, handle)
  if (!profile) {
    throw new FriendlyError(
      `Instagram has no public profile at @${handle}. Check the spelling. Private accounts can't be tracked.`,
    )
  }
  return { profile, creditsRemaining }
}

/** Instagram's caption is an object on the live shape and a string in the docs. */
function captionText(caption: InstagramUserReelMedia['caption']): string {
  if (typeof caption === 'string') return caption
  return caption?.text ?? ''
}

/** The widest still Instagram offered. Candidates are ordered largest-first. */
function coverUrl(media: InstagramUserReelMedia): string | undefined {
  const candidates = media.image_versions2?.candidates ?? []
  const best = candidates.find((c) => typeof c?.url === 'string' && /^https?:\/\//.test(c.url))
  return best?.url
}

function videoUrl(media: InstagramUserReelMedia): string | undefined {
  const best = (media.video_versions ?? []).find(
    (v) => typeof v?.url === 'string' && /^https?:\/\//.test(v.url),
  )
  return best?.url
}

/** Plays, whichever of the three names this response used. */
export function reelPlays(media: InstagramUserReelMedia): number | undefined {
  const plays = media.play_count ?? media.ig_play_count ?? media.view_count
  return typeof plays === 'number' && Number.isFinite(plays) && plays >= 0 ? plays : undefined
}

/**
 * One of an account's reels as a card.
 *
 * The author is stamped from the ACCOUNT, not from the row: this endpoint
 * returns the media and leaves the owner implicit, since you asked for one
 * profile's reels. Carrying the account's own follower count onto every card
 * keeps the card component unchanged — it renders `author.followerCount` the
 * same way it does on a search result.
 */
function normaliseAccountReel(
  media: InstagramUserReelMedia,
  account: TrackedAccount,
): DiscoverResult | null {
  const code = media.code ?? media.shortcode
  const id = code ?? media.id ?? (media.pk != null ? String(media.pk) : '')
  if (!id) return null

  // The permalink is what Analyze, Remix and Open all point at, and on this
  // platform it doubles as the API's own handle for a reel (the transcript
  // endpoint takes a url, not an id) — so a row without a shortcode is
  // unusable even when it carries media.
  if (!code) return null

  const createdAt = typeof media.taken_at === 'number'
    ? media.taken_at * 1000
    : media.created_at
      ? Date.parse(media.created_at) || 0
      : 0

  return {
    id,
    platform: 'instagram',
    caption: captionText(media.caption),
    postUrl: `https://www.instagram.com/reel/${code}/`,
    coverUrl: coverUrl(media),
    videoUrl: videoUrl(media),
    durationSeconds: media.video_duration ? Math.round(media.video_duration) : undefined,
    createdAt,
    author: {
      handle: account.handle,
      name: account.name || account.handle,
      followerCount: account.followerCount,
    },
    stats: {
      // Plays are the whole point of this endpoint. Likes and comments ride
      // along; shares and saves are absent here exactly as they are on the
      // search tab, and are left out rather than zeroed.
      ...(reelPlays(media) != null ? { views: reelPlays(media) } : {}),
      likes: media.like_count,
      comments: media.comment_count,
    },
    // Unscored here on purpose — the denominator is the median of the whole
    // list, which isn't known until the page has landed. See scoreAgainstAccount.
  }
}

export interface AccountReelsPage {
  results: DiscoverResult[]
  cursor: string | null
  creditsRemaining: number | null
}

/** A page of one account's reels, newest first. 1 credit. */
export async function fetchAccountReels(
  apiKey: string,
  account: TrackedAccount,
  cursor?: string,
): Promise<AccountReelsPage> {
  const page = await fetchInstagramUserReels(apiKey, {
    userId: account.userId || undefined,
    handle: account.handle,
    cursor,
  })

  const results = page.items
    .map((media) => normaliseAccountReel(media, account))
    .filter((r): r is DiscoverResult => r !== null)

  // A full page that normalised to nothing means a field moved, not that the
  // account is empty — and the two are indistinguishable in the UI otherwise.
  if (page.items.length > 0 && results.length === 0) {
    console.warn(
      `[outliers] instagram accounts: ${page.items.length} reel(s) came back and all were dropped in ` +
      'normalisation. The response shape has probably changed — check the field names in utils/scrapecreators.ts.',
    )
  }

  return {
    results,
    cursor: typeof page.cursor === 'string' ? page.cursor : null,
    creditsRemaining: page.creditsRemaining,
  }
}

export interface AccountScoring {
  /** Median plays across the reels on screen, or null under the sample floor. */
  baseline: number | null
  /** How many reels carried a real play count — the median's own sample. */
  sampleSize: number
  results: DiscoverResult[]
}

/**
 * Scores a whole list against its own median.
 *
 * Recomputed over everything currently loaded rather than pinned to the first
 * page, so loading more reels sharpens the baseline instead of leaving the
 * grid ranked against a sample it has outgrown. The badges do shift when a
 * second page lands — which is why the header states the median and the sample
 * it was taken over, directly above the cards it scored.
 */
export function scoreAgainstAccount(results: DiscoverResult[]): AccountScoring {
  const plays = results.map((r) => r.stats?.views)
  const baseline = accountBaseline(plays)
  const sampleSize = plays.filter((p) => typeof p === 'number' && p > 0).length

  return {
    baseline,
    sampleSize,
    results: results.map((r) => ({
      ...r,
      outlier: scoreAgainstBaseline(r.stats?.views, baseline),
    })),
  }
}

const DAY_MS = 86_400_000

const POSTED_WINDOWS: Record<AccountFilters['posted'], number | null> = {
  all: null,
  '1m': 30 * DAY_MS,
  '3m': 90 * DAY_MS,
  '6m': 180 * DAY_MS,
  '12m': 365 * DAY_MS,
}

/**
 * Filters and sorts a scored list, client-side.
 *
 * Every one of these runs on rows already paid for, so moving a control
 * re-ranks the grid without spending a credit — the same contract the search
 * tabs' Sort and Min views filters keep.
 *
 * The date window filters what is SHOWN and never what the median was taken
 * over: narrowing to "last month" is a question about which reels to look at,
 * not a claim that the account's typical reel changed.
 */
export function applyAccountFilters(
  results: DiscoverResult[],
  filters: AccountFilters,
): DiscoverResult[] {
  const window = POSTED_WINDOWS[filters.posted]
  const cutoff = window == null ? null : Date.now() - window

  const visible = results.filter((r) => {
    if (cutoff != null && (!r.createdAt || r.createdAt < cutoff)) return false
    if (filters.minMultiple > 0) {
      if (!r.outlier || r.outlier.multiple < filters.minMultiple) return false
    }
    return true
  })

  const sorted = [...visible]
  if (filters.sort === 'recent') {
    sorted.sort((a, b) => b.createdAt - a.createdAt)
  } else if (filters.sort === 'plays') {
    sorted.sort((a, b) => (b.stats?.views ?? 0) - (a.stats?.views ?? 0))
  } else {
    // Score: scored cards first by multiple, then the unscored by plays, so an
    // account under the sample floor still ranks sensibly rather than freezing
    // in fetch order.
    sorted.sort((a, b) => {
      const am = a.outlier?.multiple ?? 0
      const bm = b.outlier?.multiple ?? 0
      if (am !== bm) return bm - am
      return (b.stats?.views ?? 0) - (a.stats?.views ?? 0)
    })
  }
  return sorted
}

/** Merges a new page in, dropping anything already on screen. */
export function mergeReels(existing: DiscoverResult[], incoming: DiscoverResult[]): DiscoverResult[] {
  const seen = new Set(existing.map((r) => r.id))
  return [...existing, ...incoming.filter((r) => !seen.has(r.id))]
}
