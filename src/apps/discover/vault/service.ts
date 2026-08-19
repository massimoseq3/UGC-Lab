// Loading, filtering and un-freezing the Outlier Vault.

import { fetchInstagramPost } from '../../../utils/scrapecreators'
import type { ResolvedVideo, VaultFilters, VaultItem, VaultSort } from './types'

/**
 * An error whose message is ALREADY the sentence to show the member.
 *
 * `humanizeError` translates a vendor's wording into ours by matching known
 * substrings, and returns the caller's generic fallback for anything it
 * doesn't recognise — so a friendly message we wrote ourselves gets swallowed
 * and replaced by "Couldn't download that video." These two cases (no key
 * configured, Instagram no longer serving the post) are the member's actual
 * problem and name their actual fix, so they're marked and passed through
 * verbatim rather than being fed to a translator that has nothing to add.
 */
export class VaultMessage extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultMessage'
  }
}

/** A library row with its search haystack folded in — see `loadVault`. */
export type VaultRow = VaultItem & { search: string }

/**
 * What the amber badge on a vault card actually measures.
 *
 * Outliers' search tab scores a video against its own creator's following;
 * this one scores it against the rest of the library. Both are honest
 * multiples and neither is the other, so the badge says which out loud rather
 * than letting a member read a 12x here as the 12x they saw on the TikTok tab.
 */
export const MULTIPLE_TITLE = 'Engagement against the median of this library'

// One fetch per page load, shared by every mount. The payload is ~1.7MB of
// JSON (~550KB over the wire, gzipped by the host) and never changes between
// deploys, so the browser's own HTTP cache does the rest.
let cache: Promise<VaultRow[]> | null = null

export function loadVault(): Promise<VaultRow[]> {
  if (!cache) {
    cache = fetchVault().catch((e) => {
      // A failed load must not poison the cache — the empty state offers a
      // retry, and a rejected promise held here would fail it forever.
      cache = null
      throw e
    })
  }
  return cache
}

async function fetchVault(): Promise<VaultRow[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}vault/library.json`)
  if (!res.ok) throw new Error(`Could not load the vault (${res.status}).`)
  const rows = await res.json() as VaultItem[]
  if (!Array.isArray(rows)) throw new Error('The vault library is malformed.')

  // The haystack is built ONCE, here, rather than per keystroke in the filter.
  // Searching includes the transcript — "every reel that mentions creatine" is
  // the query this library is for — which is ~2MB of text; lowercasing that on
  // every character typed is the difference between an instant filter and a
  // laggy one.
  return rows.map((r) => ({
    ...r,
    search: [r.hook, r.template, r.author, r.authorName, r.caption, r.transcript]
      .join(' ')
      .toLowerCase(),
  }))
}

/** Where a row's cover lives. Ships with the app — no signed url, no expiry. */
export function thumbUrl(item: VaultItem): string {
  return `${import.meta.env.BASE_URL}vault/thumbs/${item.id}.webp`
}

/** "big_number" → "Big number". The corpus tags in the words on a chip. */
export function patternLabel(pattern: string): string {
  const words = pattern.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "MYTH BUSTING" → "Myth busting". The corpus shouts; the UI doesn't. */
export function categoryLabel(category: string): string {
  return category.charAt(0) + category.slice(1).toLowerCase()
}


/**
 * The facets present in the library, each with its count, commonest first.
 *
 * Derived from the rows rather than hardcoded, so re-running the build script
 * over a bigger corpus grows the filters without a code change.
 */
export function facetCounts(
  rows: VaultItem[],
  read: (r: VaultItem) => string[],
): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>()
  for (const r of rows) {
    for (const v of read(r)) {
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
}

const SORTS: Record<VaultSort, (a: VaultItem, b: VaultItem) => number> = {
  outlier: (a, b) => (b.multiple ?? 0) - (a.multiple ?? 0),
  recent: (a, b) => b.createdAt - a.createdAt,
  likes: (a, b) => b.likes - a.likes,
}

/**
 * The rows on screen, given what's typed and which chips are on.
 *
 * Pure and cheap enough to run on every render — the library is fixed at 872
 * rows and the expensive half (lowercasing every transcript) is already paid
 * for at load.
 */
export function filterVault(
  rows: VaultRow[],
  query: string,
  filters: VaultFilters,
  starred: ReadonlySet<string>,
): VaultRow[] {
  const q = query.trim().toLowerCase()

  const out = rows.filter((r) => {
    if (filters.starredOnly && !starred.has(r.id)) return false
    if (filters.category && r.category !== filters.category) return false
    if (filters.pattern && !r.patterns.includes(filters.pattern)) return false
    if (q && !r.search.includes(q)) return false
    return true
  })

  return out.sort(SORTS[filters.sort] ?? SORTS.outlier)
}

/**
 * Resolves a row's playable video url. Costs the member 1 ScrapeCreators credit.
 *
 * The library deliberately stores no video (see `fetchInstagramPost`), so this
 * is the moment a frozen row becomes something you can watch, download, or
 * hand to the Ad Analyzer. Callers cache the result for the session and must
 * say what it costs on the button that fires it.
 */
export async function resolveVaultVideo(
  apiKey: string,
  item: VaultItem,
): Promise<{ video: ResolvedVideo; creditsRemaining: number | null }> {
  const { videoUrl, coverUrl, creditsRemaining } = await fetchInstagramPost(apiKey, item.url)
  if (!videoUrl) {
    // A real outcome, not a fault: Instagram serves nothing playable for a
    // post that has been taken down, and the row stays useful without it.
    throw new VaultMessage('Instagram no longer serves a video for this post. Open the original to check it is still up.')
  }
  return { video: { url: videoUrl, coverUrl }, creditsRemaining }
}

/**
 * Instagram's own playable embed for a row — the free way to WATCH one.
 *
 * This is what keeps the credit honest. The library ships frozen and resolving
 * a real media url costs 1 credit, but watching a reel should never have: a
 * member browsing 872 hooks is doing the one thing you do idly, and charging
 * for it would train them not to look. Instagram serves a player at
 * `/{p|reel}/{code}/embed` that needs no login and no key, so the credit is
 * spent only on Analyze and Download — the two that need an actual FILE.
 *
 * Verified live against the corpus (August 2026): the embed renders, and its
 * <video> plays inline with real audio and a real duration. Two limits are
 * structural and neither has a workaround, because the frame is cross-origin:
 * we cannot autoplay it (so the member presses play inside Instagram's own
 * player), and we cannot read the media url out of it — which is exactly why
 * Analyze still has to buy one. Don't try to harvest it; the browser will not
 * let you, and the attempt would be a bug that looks like a feature.
 */
export function embedUrl(item: VaultItem): string | null {
  const m = /instagram\.com\/(reel|p)\/([A-Za-z0-9_-]+)/.exec(item.url)
  return m ? `https://www.instagram.com/${m[1]}/${m[2]}/embed` : null
}

/** Whether anything is narrowing the library — drives the header's reset. */
export function vaultFiltersActive(f: VaultFilters): boolean {
  return f.category !== '' || f.pattern !== '' || f.starredOnly || f.sort !== 'outlier'
}

/** "outlier-blakemenardcooks-C8FTNDKualt.mp4" — readable in a Downloads folder. */
export function vaultFileName(item: VaultItem): string {
  const who = (item.author || 'reel')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `outlier-${who || 'reel'}-${item.id}.mp4`
}
