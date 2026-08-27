import { useCallback, useRef, useState } from 'react'
import { Key, Plus, Radar, Search } from 'lucide-react'
import Spinner from '../../components/Spinner'
import GridCanvas, { AwaitingBody } from '../../components/GridCanvas'
import SegmentedToggle from '../../components/SegmentedToggle'
import FilterSelect from './components/FilterSelect'
import ResultCard from './components/ResultCard'
import ResultDetailModal from './components/ResultDetailModal'
import ConnectScrapeCreators from './components/ConnectScrapeCreators'
import VaultBrowser from './vault/VaultBrowser'
import { vaultFiltersActive } from './vault/service'
import { DEFAULT_VAULT_FILTERS, type VaultFilters } from './vault/types'
import { usePersistedState, useProjectScopedKey } from '../../hooks/usePersistedState'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAppStore } from '../../stores/appStore'
import { useBankStore } from '../../stores/bankStore'
import { humanizeError } from '../../utils/friendlyError'
import { applyMinViews, isPreviewable, mergeResults, runSearch, sortResults } from './services/search'
import { downloadResultVideo, fetchResultTranscript, saveResultVideoToDisk, saveThumbnail } from './services/handoff'
import { DEFAULT_FILTERS, type DiscoverFilters, type DiscoverPlatform, type DiscoverResult, type DiscoverSort, type DiscoverView } from './types'

// Outliers — search TikTok and the Meta Ad Library for ads worth stealing,
// then hand one straight to the Ad Analyzer or to Scripts.
//
// Unlike every generation surface in the app, nothing here costs kie credits:
// the searches run on the member's own ScrapeCreators key (1 credit a page)
// and the transcript path never touches a model at all.

const DATE_OPTIONS: Array<{ value: DiscoverFilters['datePosted']; label: string }> = [
  { value: 'this-week', label: 'This week' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-3-months', label: '3 months' },
  { value: 'last-6-months', label: '6 months' },
  { value: 'all-time', label: 'All time' },
]

// Sort labels are platform-specific because the underlying signal is. The
// default 'outlier' sort falls back to days-running on a Meta card (see
// sortResults), so on that tab it is HONESTLY named "Longest running" — Meta
// publishes no view counts, and a control offering to rank by a score that
// doesn't exist would be a lie in a dropdown. 'views' isn't offered there at
// all for the same reason.
const SORT_OPTIONS: Record<DiscoverPlatform, Array<{ value: DiscoverSort; label: string }>> = {
  tiktok: [
    { value: 'outlier', label: 'Outlier score' },
    { value: 'views', label: 'Most viewed' },
    { value: 'recent', label: 'Newest' },
  ],
  meta: [
    { value: 'outlier', label: 'Longest running' },
    { value: 'recent', label: 'Newest' },
  ],
}

const MIN_VIEW_OPTIONS = [0, 10_000, 100_000, 1_000_000]

/** 10_000 → "10K". Shared by the filter's own options and the hidden-count line. */
function minViewsLabel(v: number): string {
  return v >= 1_000_000 ? `${v / 1_000_000}M` : `${v / 1000}K`
}

/** The per-card actions that can be mid-flight, so the right button spins. */
export type DiscoverAction = 'analyze' | 'remix' | 'save' | 'download'

/** One tab's search: what was asked, what came back, and where the next page starts. */
interface PlatformSearch {
  query: string
  results: DiscoverResult[]
  cursor: string | number | null
  /** True once a search has actually run — tells "no results" from "not yet". */
  searched: boolean
  /**
   * When the FIRST page of this grid was fetched, or null if nothing has landed.
   * It dates the oldest signed media url on screen, which is the one that
   * expires first — see RESULTS_TTL_MS.
   */
  fetchedAt: number | null
}

const BLANK_SEARCH: PlatformSearch = { query: '', results: [], cursor: null, searched: false, fetchedAt: null }
const EMPTY_SEARCHES: Record<DiscoverPlatform, PlatformSearch> = {
  tiktok: BLANK_SEARCH,
  meta: BLANK_SEARCH,
}

/**
 * How long a restored grid is trusted.
 *
 * Every media url on a card is a signed CDN link with an expiry — TikTok's
 * measured in hours, Meta's in days — which is why this state was session-only
 * to begin with: restore a day-old grid and you get a wall of dead tiles. The
 * window is deliberately short, because the two ways of being wrong don't cost
 * the same. Expire too early and the member gets the empty state they used to
 * get on every refresh anyway, with the query still in the box. Expire too late
 * and they get a broken-looking grid, which reads as the app failing.
 */
const RESULTS_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Rows persisted per tab (two pages — what the overwhelming majority of
 * sessions ever fetch), bounding this slot at roughly 150KB a tab.
 *
 * The cap is not politeness: localStorage is shared with the bank blob, and
 * `bankStore.flushSaveToStorage` responds to a refused write by SHEDDING
 * HISTORY ROWS. An uncapped grid of 30-a-page search results would be paid for
 * out of a member's saved work.
 */
const PERSIST_RESULT_CAP = 60

/** Cards whose transcript text is kept across a refresh. See `transcripts`. */
const PERSIST_TRANSCRIPT_CAP = 40

/**
 * Rebuilds both tabs from a stored blob, dropping anything past its freshness
 * window. Runs on every hydrate, so it doubles as the shape guard for a blob
 * written by an older build.
 */
function restoreSearches(stored: Record<DiscoverPlatform, PlatformSearch> | null | undefined): Record<DiscoverPlatform, PlatformSearch> {
  const now = Date.now()
  const restore = (s: PlatformSearch | undefined): PlatformSearch => {
    if (!s || typeof s !== 'object') return BLANK_SEARCH
    const query = typeof s.query === 'string' ? s.query : ''
    const fresh = Array.isArray(s.results)
      && typeof s.fetchedAt === 'number'
      && now - s.fetchedAt < RESULTS_TTL_MS
    // The QUERY outlives the results on purpose. When the grid has aged out the
    // box still says what you were hunting, so re-running it is one click and
    // one credit rather than trying to remember the phrase.
    if (!fresh) return { ...BLANK_SEARCH, query }
    return {
      query,
      // Filtered on the way back in as well as on the way out of a search: a
      // grid persisted before the unpreviewable rule existed still holds the
      // blank tiles it was saved with, and it stays fresh for six hours.
      results: s.results.filter(isPreviewable),
      cursor: s.cursor ?? null,
      searched: true,
      fetchedAt: s.fetchedAt,
    }
  }
  return { tiktok: restore(stored?.tiktok), meta: restore(stored?.meta) }
}

/** Caps what reaches localStorage. The in-memory grid is untouched. */
function pruneSearches(all: Record<DiscoverPlatform, PlatformSearch>): Record<DiscoverPlatform, PlatformSearch> {
  const trim = (s: PlatformSearch): PlatformSearch => {
    if (s.results.length <= PERSIST_RESULT_CAP) return s
    // Truncation drops whole trailing PAGES, so what comes back is contiguous
    // from the top of the grid rather than holed. The cursor goes with them: a
    // "Load more" continuing from past a page we didn't keep would open a gap
    // in the middle that nothing on screen explains.
    return { ...s, results: s.results.slice(0, PERSIST_RESULT_CAP), cursor: null }
  }
  return { tiktok: trim(all.tiktok), meta: trim(all.meta) }
}

/**
 * The transcript phases worth a storage slot: the two settled ones.
 *
 * 'loading' and 'error' are deliberately dropped — restoring either would put a
 * card back into a state no fetch is going to finish, which is exactly the
 * stuck-spinner case `usePersistedState`'s sanitize exists for. Oldest entries
 * are shed first (a Record keeps its insertion order for these keys).
 */
function keepSettledTranscripts(map: Record<string, TranscriptState>): Record<string, TranscriptState> {
  const settled = Object.entries(map ?? {}).filter(
    ([, v]) => v?.phase === 'ready' || v?.phase === 'empty',
  )
  return Object.fromEntries(settled.slice(-PERSIST_TRANSCRIPT_CAP))
}

/** The resolved-text view of the transcript map, for seeding the lookup ref. */
function transcriptTexts(map: Record<string, TranscriptState>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, state] of Object.entries(map)) {
    if (state.phase === 'ready') out[key] = state.text
  }
  return out
}

/**
 * Where a card's transcript has got to.
 *
 * 'idle' is the state every card opens in — a transcript costs a ScrapeCreators
 * credit, so it is never fetched by the act of looking at a card. 'empty' is a
 * normal outcome (the video genuinely has no captions), not a failure.
 */
export type TranscriptState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; text: string }
  | { phase: 'empty' }
  | { phase: 'error'; message: string }

export default function Discover() {
  const baseKey = useProjectScopedKey('discover')
  // Three tabs behind one toggle: the Outlier Vault, which ships with the app
  // and costs nothing to browse, and the two paid searches. It takes its OWN
  // storage key rather than the old `:platform` slot, so every member — new or
  // returning — lands on the vault once. That is the point of making it the
  // default: the friction this app was losing members to was having to go and
  // find something worth tearing down before it could help.
  const [view, setView] = usePersistedState<DiscoverView>(`${baseKey}:view`, 'vault')
  const isVault = view === 'vault'
  // Only the two search tabs have search state. The vault borrows TikTok's
  // slot while it is on screen so the per-platform records below stay
  // two-keyed and nothing has to grow a branch for a tab that never searches.
  const platform: DiscoverPlatform = isVault ? 'tiktok' : view
  // Merged over the defaults on every hydrate, not just when the slot is
  // empty. `usePersistedState` hands back a stored blob verbatim, so a filter
  // saved before a field existed carries that field as `undefined` for good —
  // which is how a member could end up searching with no Media filter at all
  // rather than the VIDEO default. Any field added to DiscoverFilters from
  // here on gets its default on the next load.
  const [filters, setFilters] = usePersistedState<DiscoverFilters>(
    `${baseKey}:filters`,
    DEFAULT_FILTERS,
    { sanitize: (f) => ({ ...DEFAULT_FILTERS, ...f }) },
  )
  // The vault's query and filters live here rather than inside VaultBrowser
  // for the same reason the search ones do: they are persisted UI state of
  // this app, and the header's reset button has to be able to clear them.
  const [vaultQuery, setVaultQuery] = usePersistedState<string>(`${baseKey}:vault-query`, '')
  const [vaultFilters, setVaultFilters] = usePersistedState<VaultFilters>(
    `${baseKey}:vault-filters`,
    DEFAULT_VAULT_FILTERS,
    { sanitize: (f) => ({ ...DEFAULT_VAULT_FILTERS, ...f }) },
  )

  // One search per platform, kept side by side. Flipping to the other tab used
  // to throw the grid away, which meant a credit spent and a page of 30 winners
  // lost to a glance. Each tab keeps its own query too, so the box always says
  // what produced the grid under it.
  //
  // Persisted, and it took a freshness window to make that safe. This was
  // session-only for a real reason — a result carries signed CDN urls that
  // expire, so a stale restore is a wall of dead tiles — but "its real lifetime
  // is the app staying mounted" quietly meant a refresh binned a grid of 30
  // winners the member had PAID a credit for, which is the one loss here that
  // costs money. `restoreSearches` drops a grid past RESULTS_TTL_MS instead of
  // rendering it broken, and `pruneSearches` caps what reaches the quota.
  const [searches, setSearches] = usePersistedState<Record<DiscoverPlatform, PlatformSearch>>(
    `${baseKey}:searches`,
    EMPTY_SEARCHES,
    { sanitize: restoreSearches, prune: pruneSearches },
  )
  const active = searches[platform]
  const { query, results, cursor, searched } = active

  const [credits, setCredits] = useState<number | null>(null)
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Always writes the tab it was given rather than "the current tab", so a
  // search that lands after a toggle flip fills its own grid, not the one on
  // screen.
  const patchSearch = useCallback((
    target: DiscoverPlatform,
    patch: Partial<PlatformSearch> | ((s: PlatformSearch) => Partial<PlatformSearch>),
  ) => {
    setSearches((all) => ({
      ...all,
      [target]: { ...all[target], ...(typeof patch === 'function' ? patch(all[target]) : patch) },
    }))
    // `setSearches` comes out of usePersistedState, so it's useState's own
    // setter and stable — but the lint rule can't see through a custom hook to
    // know that. Declared rather than disabled: an eslint-disable of any
    // react-hooks rule anywhere in a file makes the React Compiler skip the
    // whole component, and this one owns a 30-card grid.
  }, [setSearches])

  const [openResult, setOpenResult] = useState<DiscoverResult | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyKind, setBusyKind] = useState<DiscoverAction | null>(null)

  // Transcripts, keyed by card. Fetched at most once per card and reused by
  // Remix, so pulling the words and then sending them is ONE credit rather than
  // two. Lives here (not in the modal) so it survives closing the modal — a
  // card you paid for once stays paid for.
  //
  // Persisted for the same reason, and specifically because the grid above now
  // is: restoring the cards without the words they'd already bought would hand
  // a member back a card whose transcript costs a second credit to read again —
  // a way to re-pay that only exists BECAUSE the card survived the refresh.
  // Unlike the results these never rot (text, no signed urls), so they carry a
  // count cap rather than a clock.
  const [transcripts, setTranscripts] = usePersistedState<Record<string, TranscriptState>>(
    `${baseKey}:transcripts`,
    {},
    { sanitize: keepSettledTranscripts, prune: keepSettledTranscripts },
  )

  const apiKey = useSettingsStore((s) => s.scrapeCreatorsKey)

  // Which cards are already filed. Derived as a Set of "platform:sourceId" so
  // a card can answer "am I saved?" without scanning the whole bank per tile —
  // the grid is 30+ cards and the swipe file grows without bound.
  const swipes = useBankStore((s) => s.swipes)
  const savedKeys = new Set(swipes.map((s) => `${s.platform}:${s.sourceId}`))

  // Onboarding pops up the first time Outliers is opened without a key. Seeded
  // from the store at mount and never re-armed, so dismissing it is respected
  // for as long as the app stays open — the empty state behind it keeps a
  // "Connect key" button, so closing this is never a dead end.
  // Armed only for the paid tabs. The vault is where a fresh member lands and
  // it needs no key at all, so popping a credentials dialog over it would put
  // a paywall-shaped thing in front of the one part of Outliers that is free.
  // Flipping to TikTok or Meta without a key arms it there instead.
  const [connectOpen, setConnectOpen] = useState(!apiKey && !isVault)
  const addToast = useAppStore((s) => s.addToast)
  const sendToApp = useAppStore((s) => s.sendToApp)
  const openApp = useAppStore((s) => s.openApp)

  // The live query, read by callbacks without closing over it — otherwise every
  // keystroke would hand the memoized card grid a fresh handler identity.
  const queryRef = useRef(query)
  queryRef.current = query

  // The resolved text behind `transcripts`, in a ref so ensureTranscript can
  // check the cache without taking the state as a dependency — which would
  // hand the memoized card grid a new handler on every transcript that lands.
  // Seeded from the hydrated map, since `useRef` only ever uses this argument
  // on the first render — which is the one where `transcripts` is what came
  // back out of localStorage.
  const transcriptCache = useRef<Record<string, string>>(transcriptTexts(transcripts))

  const search = useCallback(async (nextCursor?: string | number) => {
    const q = queryRef.current.trim()
    if (!q || !apiKey) return

    // Pinned for the whole call: the member can flip tabs while a page is in
    // flight, and the results belong to the tab that asked for them.
    const target = platform
    const more = nextCursor !== undefined
    if (more) setLoadingMore(true)
    // Clearing `fetchedAt` alongside the rows is what keeps a refresh taken
    // mid-search from restoring an empty grid as "No results" — with no stamp
    // it reads as never having run, which is the truth.
    else { setSearching(true); patchSearch(target, { results: [], fetchedAt: null }) }

    try {
      const page = await runSearch(apiKey, target, q, filters, nextCursor)
      patchSearch(target, (s) => ({
        results: more ? mergeResults(s.results, page.results) : page.results,
        cursor: page.cursor,
        searched: true,
        // Stamped by the FIRST page only. It dates the oldest signed url in the
        // grid, which is the first one to expire; refreshing it on every "Load
        // more" would keep page one alive on the strength of page three's links.
        fetchedAt: more ? s.fetchedAt : Date.now(),
      }))
      if (page.creditsRemaining !== null) setCredits(page.creditsRemaining)
    } catch (e) {
      addToast(humanizeError(e, 'That search failed. Try again in a moment.'), 'error')
    } finally {
      setSearching(false)
      setLoadingMore(false)
    }
  }, [apiKey, platform, filters, addToast, patchSearch])

  const handleAnalyze = useCallback(async (result: DiscoverResult) => {
    setBusyId(result.id)
    setBusyKind('analyze')
    try {
      const file = await downloadResultVideo(result)
      sendToApp({
        targetApp: 'ad-anatomy',
        targetField: 'adVideo',
        data: { file, sourceUrl: result.postUrl, caption: result.caption },
      })
      openApp('ad-anatomy')
      setOpenResult(null)
    } catch (e) {
      addToast(humanizeError(e, "Couldn't import that video. Try opening the original instead."), 'error')
    } finally {
      setBusyId(null)
      setBusyKind(null)
    }
  }, [sendToApp, openApp, addToast])

  // Saves the ad itself to disk. Same fetch as Analyze — CDN direct, then our
  // proxy for TikTok — because a cross-origin `download` link would open the
  // video in a tab rather than save it.
  const handleDownload = useCallback(async (result: DiscoverResult) => {
    setBusyId(result.id)
    setBusyKind('download')
    try {
      await saveResultVideoToDisk(result)
    } catch (e) {
      addToast(humanizeError(e, "Couldn't download that video. Try opening the original instead."), 'error')
    } finally {
      setBusyId(null)
      setBusyKind(null)
    }
  }, [addToast])

  /**
   * Resolves a card's transcript, fetching it at most once.
   *
   * Returns the text (empty string when the video genuinely has no captions).
   * `useAi` forces a re-fetch through the 10-credit AI path, which is the only
   * reason a cached entry is ever discarded.
   */
  const ensureTranscript = useCallback(async (
    result: DiscoverResult,
    useAi = false,
  ): Promise<string> => {
    if (!apiKey) return ''
    const cacheKey = `${result.platform}:${result.id}`
    const cached = transcriptCache.current[cacheKey]
    if (cached && !useAi) return cached

    setTranscripts((t) => ({ ...t, [cacheKey]: { phase: 'loading' } }))
    try {
      const { text, creditsRemaining } = await fetchResultTranscript(apiKey, result, useAi)
      if (creditsRemaining !== null) setCredits(creditsRemaining)
      transcriptCache.current[cacheKey] = text
      setTranscripts((t) => ({
        ...t,
        [cacheKey]: text.trim() ? { phase: 'ready', text } : { phase: 'empty' },
      }))
      return text
    } catch (e) {
      const message = humanizeError(e, "Couldn't pull that transcript.")
      setTranscripts((t) => ({ ...t, [cacheKey]: { phase: 'error', message } }))
      throw e
    }
    // Stable (useState's setter, via usePersistedState) — see patchSearch.
  }, [apiKey, setTranscripts])

  const handleRemix = useCallback(async (result: DiscoverResult, useAi = false) => {
    if (!apiKey) return
    setBusyId(result.id)
    setBusyKind('remix')
    try {
      const text = await ensureTranscript(result, useAi)
      if (!text.trim()) {
        addToast(
          'This video has no captions to pull. Open it and try AI transcription.',
          'info',
        )
        return
      }
      sendToApp({ targetApp: 'script-architect', targetField: 'winningTranscript', data: text })
      openApp('script-architect')
      setOpenResult(null)
    } catch (e) {
      addToast(humanizeError(e, "Couldn't pull that transcript. Try again in a moment."), 'error')
    } finally {
      setBusyId(null)
      setBusyKind(null)
    }
  }, [apiKey, ensureTranscript, sendToApp, openApp, addToast])

  /**
   * Files an ad in the swipe bank, or takes it back out if it's already there.
   *
   * The transcript rides along when it's already been fetched — never re-billed
   * for the sake of the save. Numbers are snapshotted as they are today,
   * because a swipe is a record of what a winner looked like when you found it.
   */
  const handleSave = useCallback(async (result: DiscoverResult) => {
    const existing = useBankStore.getState().getSwipeBySource(result.platform, result.id)
    if (existing) {
      await useBankStore.getState().deleteSwipe(existing.id)
      return
    }

    setBusyId(result.id)
    setBusyKind('save')
    try {
      const thumbRef = await saveThumbnail(result)
      await useBankStore.getState().addSwipe({
        platform: result.platform,
        sourceId: result.id,
        postUrl: result.postUrl,
        thumbRef,
        mediaUrl: result.videoUrl,
        authorHandle: result.author.handle,
        authorName: result.author.name,
        caption: result.caption,
        transcript: transcriptCache.current[`${result.platform}:${result.id}`] || undefined,
        views: result.stats?.views,
        likes: result.stats?.likes,
        comments: result.stats?.comments,
        shares: result.stats?.shares,
        saves: result.stats?.saves,
        followerCount: result.author.followerCount,
        outlierMultiple: result.outlier?.multiple,
        daysRunning: result.ad?.daysRunning ?? undefined,
      })
    } catch (e) {
      addToast(humanizeError(e, "Couldn't save that to your swipe file."), 'error')
    } finally {
      setBusyId(null)
      setBusyKind(null)
    }
  }, [addToast])

  /**
   * Pulls a card's transcript on an explicit click, and nothing else.
   *
   * Errors land in the modal's own Transcript block (that's what the 'error'
   * phase is for), so the rejection is swallowed rather than toasted twice.
   */
  const handleFetchTranscript = useCallback((result: DiscoverResult, useAi = false) => {
    void ensureTranscript(result, useAi).catch(() => {})
  }, [ensureTranscript])

  // Opening a card costs NOTHING. It used to pull the transcript straight away
  // so the words were on screen by the time you'd read the caption — but that
  // spent a ScrapeCreators credit for the act of looking at a card, which is
  // the one thing in this app you can do idly. The modal now offers an explicit
  // "Get transcript" and Remix stays disabled until it has been pressed.
  const openCard = useCallback((result: DiscoverResult) => {
    setOpenResult(result)
  }, [])

  const isTikTok = platform === 'tiktok'
  // A member who picked "Most viewed" on TikTok and switched to Meta has a
  // persisted sort with no option on this tab — coerce rather than render an
  // empty select.
  const sortOptions = SORT_OPTIONS[platform]
  const activeSort: DiscoverSort = sortOptions.some((o) => o.value === filters.sort)
    ? filters.sort
    : 'outlier'
  // Both derived on every render: moving Min views or Sort re-ranks what's on
  // screen without spending another credit.
  const visible = applyMinViews(results, filters.minViews)
  const sorted = sortResults(visible, activeSort)
  // A page is 30 rows, and the Min views floor (10K by default) removes every
  // card under it CLIENT-SIDE — so a niche keyword can pay for 30 results and
  // render four. That used to happen in total silence, which reads as a broken
  // search rather than as a filter doing its job. Say so.
  const hiddenByMinViews = results.length - visible.length

  return (
    <div className="flex h-full flex-col">
      {/* Wraps on a phone: the platform toggle, a search field, a Search button
          and the credits chip don't fit on one 390px line — the field ended up
          ~60px wide, showing neither the placeholder nor what you typed. The
          field + button take their own full-width row (`order-last`); md+ is the
          single 57px band, unchanged, because the wrapper holding them turns
          into `display: contents` there and puts them straight back in place.
          Everything else — the toggle, the credits chip, the + — shares ONE
          row, and the toggle gives up the width they need rather than claiming
          the line: full-width it wrapped them onto a row of their own, 40px of
          a phone's header spent on a 36px circle. */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink/5 px-4 py-2 md:h-[57px] md:flex-nowrap md:gap-3 md:py-0">
        <SegmentedToggle
          options={[
            // The segments share the width equally, so the longest label sets
            // what all three can show — and on a phone this row also carries
            // the credits chip and the +, which left "Outlier Vault" reading
            // "Outlie…" and "Meta Ads" as "Meta …". Both shorten there: the
            // app is already called Outliers and the other two are platform
            // names either way. Two spans, no JS media query.
            {
              value: 'vault',
              label: (
                <>
                  <span className="md:hidden">Vault</span>
                  <span className="max-md:hidden">Outlier Vault</span>
                </>
              ),
            },
            { value: 'tiktok', label: 'TikTok' },
            {
              value: 'meta',
              label: (
                <>
                  <span className="md:hidden">Meta</span>
                  <span className="max-md:hidden">Meta Ads</span>
                </>
              ),
            },
          ]}
          value={view}
          // Nothing is thrown away on a flip — each tab keeps its own search
          // and its own grid, so glancing at the other platform costs nothing
          // and coming back costs no credits.
          onChange={(next) => {
            setView(next)
            // Arriving on a paid tab without a key is the moment the popup is
            // for; it stays out of the way while the free tab is on screen.
            if (next !== 'vault' && !apiKey) setConnectOpen(true)
          }}
          // Fits its content from `md` up, where it shares the 57px header band
          // with the search field, the Search button and the credits chip. On a
          // phone it takes the width instead — but as `flex-1`, not `w-full`:
          // full width forced a wrap, which pushed the + and the credits chip
          // onto a line of their own under the toggle, 40px of header spent on
          // one 36px circle. Sharing the row leaves the toggle everything the
          // two of them don't take.
          className="max-md:min-w-0 max-md:flex-1"
          fitContent="md"
          dense
        />

        <div className="order-last flex w-full min-w-0 items-center gap-2 md:order-none md:contents">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-600" />
          {/* The same field on all three tabs, and the verb changes with the
              tab: on TikTok and Meta it BUYS a page of results, in the vault
              it filters 872 rows already sitting on the member's machine. */}
          <input
            value={isVault ? vaultQuery : query}
            onChange={(e) => {
              if (isVault) setVaultQuery(e.target.value)
              else patchSearch(platform, { query: e.target.value })
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isVault) void search() }}
            placeholder={
              isVault
                ? 'Filter the vault — a topic, a phrase, a creator…'
                : isTikTok
                  ? 'Search TikTok — a product, a pain point, a hook…'
                  : 'Search the Meta Ad Library…'
            }
            className="w-full rounded-full border border-ink/10 bg-ink/5 py-2 pl-10 pr-4 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
          />
        </div>

        {/* The vault filters as you type. There is nothing to submit and
            nothing to bill, so it carries no button — a Search button that
            spends no credit next to one that does would teach the wrong
            thing about both. */}
        {!isVault && (
          <button
            type="button"
            onClick={() => void search()}
            disabled={!query.trim() || !apiKey || searching}
            className="flex shrink-0 items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-ink-900 transition-colors hover:bg-ink-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {searching ? <Spinner className="h-3.5 w-3.5" /> : <Radar className="h-3.5 w-3.5" />}
            Search
          </button>
        )}
        </div>

        {credits !== null && (
          <span className="shrink-0 rounded-full bg-ink/5 px-2.5 py-1 text-[11px] text-ink-500" title="ScrapeCreators credits remaining">
            {credits.toLocaleString()} credits
          </span>
        )}

        {/* The same + every panel header carries: back to a blank slate. It
            clears THIS tab only — the other platform's search is the thing the
            per-tab state exists to protect, and a member reaching for a fresh
            search on TikTok isn't asking to bin the Meta grid too. Nothing here
            is recoverable by re-running for free, so it only appears once there
            is something to clear. */}
        {(isVault
          ? vaultQuery.trim() !== '' || vaultFiltersActive(vaultFilters)
          : query !== '' || results.length > 0) && (
          <button
            type="button"
            title={isVault ? 'Back to the folders — clears the vault filters' : 'New search — clears this tab'}
            onClick={() => {
              if (isVault) {
                setVaultQuery('')
                setVaultFilters(DEFAULT_VAULT_FILTERS)
              } else {
                patchSearch(platform, BLANK_SEARCH)
              }
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-ink/[0.03] text-ink-300 transition-colors hover:bg-ink/[0.08] hover:text-ink-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </header>

      {!isVault && apiKey && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink/5 px-4 py-2.5">
          <FilterSelect
            label="Sort"
            value={activeSort}
            options={sortOptions}
            onChange={(sort) => setFilters((f) => ({ ...f, sort }))}
          />
          {isTikTok ? (
            <>
              <FilterSelect
                label="Posted"
                value={filters.datePosted}
                options={DATE_OPTIONS}
                onChange={(datePosted) => setFilters((f) => ({ ...f, datePosted }))}
              />
              <FilterSelect
                label="Min views"
                value={String(filters.minViews)}
                options={MIN_VIEW_OPTIONS.map((v) => ({
                  value: String(v),
                  label: v === 0 ? 'Any' : `${minViewsLabel(v)}+`,
                }))}
                onChange={(v) => setFilters((f) => ({ ...f, minViews: Number(v) }))}
              />
            </>
          ) : (
            <>
              <FilterSelect
                label="Country"
                value={filters.country}
                options={[
                  { value: 'US', label: 'United States' },
                  { value: 'GB', label: 'United Kingdom' },
                  { value: 'CA', label: 'Canada' },
                  { value: 'AU', label: 'Australia' },
                  { value: 'DE', label: 'Germany' },
                ]}
                onChange={(country) => setFilters((f) => ({ ...f, country }))}
              />
              <FilterSelect
                label="Media"
                value={filters.mediaType}
                options={[
                  { value: 'VIDEO', label: 'Videos' },
                  { value: 'IMAGE', label: 'Images' },
                  { value: 'ALL', label: 'All' },
                ]}
                onChange={(mediaType) => setFilters((f) => ({ ...f, mediaType }))}
              />
              <FilterSelect
                label="Status"
                value={filters.activeOnly ? 'active' : 'all'}
                options={[
                  { value: 'active', label: 'Active only' },
                  { value: 'all', label: 'All ads' },
                ]}
                onChange={(v) => setFilters((f) => ({ ...f, activeOnly: v === 'active' }))}
              />
              {/* The only lever Meta's API gives over its own loose matching —
                  by default it scores relevance its own way and matches
                  advertiser names, so a product search returns unrelated ads. */}
              <FilterSelect
                label="Match"
                value={filters.exactPhrase ? 'exact' : 'broad'}
                options={[
                  { value: 'broad', label: 'Broad' },
                  { value: 'exact', label: 'Exact phrase' },
                ]}
                onChange={(v) => setFilters((f) => ({ ...f, exactPhrase: v === 'exact' }))}
              />
            </>
          )}
        </div>
      )}

      {/* The vault renders its own filter row and grid as a fragment, so both
          land as siblings in this column exactly like the search tab's do. */}
      {isVault ? (
        <VaultBrowser
          query={vaultQuery}
          filters={vaultFilters}
          onFiltersChange={setVaultFilters}
          onClearQuery={() => setVaultQuery('')}
          apiKey={apiKey}
          onCredits={setCredits}
          onNeedKey={() => setConnectOpen(true)}
        />
      ) : !apiKey ? (
        <ConnectKeyPanel onConnect={() => setConnectOpen(true)} />
      ) : searching ? (
        <GridCanvas>
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-ink-500">
            <Spinner className="h-4 w-4" />
            Searching {isTikTok ? 'TikTok' : 'the Meta Ad Library'}…
          </div>
        </GridCanvas>
      ) : sorted.length === 0 ? (
        <GridCanvas>
          <AwaitingBody
            icon={Radar}
            title={searched ? 'No results' : 'Awaiting search'}
            hint={
              searched
                ? hiddenByMinViews > 0
                  // The search DID return — the floor ate all of it. Telling
                  // this member to try a broader keyword would send them to
                  // spend another credit on the same outcome.
                  ? `All ${hiddenByMinViews} results are under ${minViewsLabel(filters.minViews)} views. Lower Min views to see them.`
                  : 'Nothing came back for that phrase. Try a broader keyword, or widen the date range.'
                : isTikTok
                  ? 'Search a phrase and Outliers ranks what comes back by views against each creator’s own following.'
                  : 'Search a phrase to see the ads running against it, ranked by how long they’ve been live.'
            }
          />
        </GridCanvas>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {hiddenByMinViews > 0 && (
            <p className="mb-3 text-[11px] text-ink-600">
              {hiddenByMinViews} more hidden under {minViewsLabel(filters.minViews)} views.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">

            {sorted.map((result) => (
              <ResultCard
                key={`${result.platform}:${result.id}`}
                result={result}
                onAnalyze={handleAnalyze}
                onRemix={handleRemix}
                onSave={handleSave}
                onDownload={handleDownload}
                onOpen={openCard}
                saved={savedKeys.has(`${result.platform}:${result.id}`)}
                busy={busyId === result.id ? busyKind : null}
              />
            ))}
          </div>

          {cursor !== null && (
            <div className="flex justify-center py-6">
              <button
                type="button"
                onClick={() => void search(cursor)}
                disabled={loadingMore}
                className="flex items-center gap-2 rounded-full border border-ink/10 px-5 py-2.5 text-[13px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5 disabled:opacity-50"
              >
                {loadingMore && <Spinner className="h-3.5 w-3.5" />}
                {loadingMore ? 'Loading…' : 'Load more — 1 credit'}
              </button>
            </div>
          )}
        </div>
      )}

      {connectOpen && <ConnectScrapeCreators onClose={() => setConnectOpen(false)} />}

      {openResult && (
        <ResultDetailModal
          result={openResult}
          transcript={transcripts[`${openResult.platform}:${openResult.id}`] ?? { phase: 'idle' }}
          onClose={() => setOpenResult(null)}
          onAnalyze={handleAnalyze}
          onFetchTranscript={handleFetchTranscript}
          onRemix={handleRemix}
          onSave={handleSave}
          onDownload={handleDownload}
          saved={savedKeys.has(`${openResult.platform}:${openResult.id}`)}
          busy={busyId === openResult.id ? busyKind : null}
        />
      )}
    </div>
  )
}

/** Shown until a ScrapeCreators key is saved, behind the onboarding popup. */
function ConnectKeyPanel({ onConnect }: { onConnect: () => void }) {
  return (
    <GridCanvas>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <Key className="h-8 w-8 text-ink-800" strokeWidth={1.5} />
        <p className="text-sm text-ink-500">Connect ScrapeCreators</p>
        <p className="max-w-[340px] text-xs leading-relaxed text-ink-600">
          Outliers searches TikTok and the Meta Ad Library on your own key —
          1 credit a search, and 100 free when you sign up.
        </p>
        {/* Reopens the popup rather than linking out, so dismissing the
            onboarding can't strand a member with nowhere to paste a key. */}
        <button
          type="button"
          onClick={onConnect}
          className="rounded-full bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity hover:opacity-90"
        >
          Connect key
        </button>
      </div>
    </GridCanvas>
  )
}
