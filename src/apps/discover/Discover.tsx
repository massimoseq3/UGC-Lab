import { useCallback, useRef, useState } from 'react'
import { Key, Loader2, Plus, Radar, Search } from 'lucide-react'
import GridCanvas, { AwaitingBody } from '../../components/GridCanvas'
import SegmentedToggle from '../../components/SegmentedToggle'
import Dropdown from '../../components/Dropdown'
import ResultCard from './components/ResultCard'
import ResultDetailModal from './components/ResultDetailModal'
import ConnectScrapeCreators from './components/ConnectScrapeCreators'
import { usePersistedState, useProjectScopedKey } from '../../hooks/usePersistedState'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAppStore } from '../../stores/appStore'
import { useBankStore } from '../../stores/bankStore'
import { humanizeError } from '../../utils/friendlyError'
import { applyMinViews, mergeResults, runSearch, sortResults } from './services/search'
import { downloadResultVideo, fetchResultTranscript, saveResultVideoToDisk, saveThumbnail } from './services/handoff'
import { DEFAULT_FILTERS, type DiscoverFilters, type DiscoverPlatform, type DiscoverResult, type DiscoverSort } from './types'

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
}

const BLANK_SEARCH: PlatformSearch = { query: '', results: [], cursor: null, searched: false }
const EMPTY_SEARCHES: Record<DiscoverPlatform, PlatformSearch> = {
  tiktok: BLANK_SEARCH,
  meta: BLANK_SEARCH,
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
  const [platform, setPlatform] = usePersistedState<DiscoverPlatform>(`${baseKey}:platform`, 'tiktok')
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
  // One search per platform, kept side by side. Flipping to the other tab used
  // to throw the grid away, which meant a credit spent and a page of 30 winners
  // lost to a glance. Each tab keeps its own query too, so the box always says
  // what produced the grid under it.
  //
  // Session memory, deliberately not localStorage: a result carries signed CDN
  // urls that expire within days, so a restored grid would be a wall of broken
  // thumbnails — and 60 rows of captions is not what the quota is for. Its real
  // lifetime is the app staying mounted, which covers dock switches too.
  const [searches, setSearches] = useState<Record<DiscoverPlatform, PlatformSearch>>(EMPTY_SEARCHES)
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
  }, [])

  const [openResult, setOpenResult] = useState<DiscoverResult | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyKind, setBusyKind] = useState<DiscoverAction | null>(null)

  // Transcripts, keyed by card. Fetched at most once per card and reused by
  // Remix, so pulling the words and then sending them is ONE credit rather than
  // two. Lives here (not in the modal) so it survives closing the modal — a
  // card you paid for once stays paid for.
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptState>>({})

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
  const [connectOpen, setConnectOpen] = useState(!apiKey)
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
  const transcriptCache = useRef<Record<string, string>>({})

  const search = useCallback(async (nextCursor?: string | number) => {
    const q = queryRef.current.trim()
    if (!q || !apiKey) return

    // Pinned for the whole call: the member can flip tabs while a page is in
    // flight, and the results belong to the tab that asked for them.
    const target = platform
    const more = nextCursor !== undefined
    if (more) setLoadingMore(true)
    else { setSearching(true); patchSearch(target, { results: [] }) }

    try {
      const page = await runSearch(apiKey, target, q, filters, nextCursor)
      patchSearch(target, (s) => ({
        results: more ? mergeResults(s.results, page.results) : page.results,
        cursor: page.cursor,
        searched: true,
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
  }, [apiKey])

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
      <header className="flex h-[57px] shrink-0 items-center gap-3 border-b border-ink/5 px-4">
        <SegmentedToggle
          options={[
            { value: 'tiktok', label: 'TikTok' },
            { value: 'meta', label: 'Meta Ads' },
          ]}
          value={platform}
          // Nothing is thrown away on a flip — each tab keeps its own search
          // and its own grid, so glancing at the other platform costs nothing
          // and coming back costs no credits.
          onChange={setPlatform}
          fitContent
          dense
        />

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-600" />
          <input
            value={query}
            onChange={(e) => patchSearch(platform, { query: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') void search() }}
            placeholder={isTikTok ? 'Search TikTok — a product, a pain point, a hook…' : 'Search the Meta Ad Library…'}
            className="w-full rounded-full border border-ink/10 bg-ink/5 py-2 pl-10 pr-4 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
          />
        </div>

        <button
          type="button"
          onClick={() => void search()}
          disabled={!query.trim() || !apiKey || searching}
          className="flex shrink-0 items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-ink-900 transition-colors hover:bg-ink-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
          Search
        </button>

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
        {(query || results.length > 0) && (
          <button
            type="button"
            title="New search — clears this tab"
            onClick={() => patchSearch(platform, BLANK_SEARCH)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-ink/[0.03] text-ink-300 transition-colors hover:bg-ink/[0.08] hover:text-ink-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </header>

      {apiKey && (
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

      {!apiKey ? (
        <ConnectKeyPanel onConnect={() => setConnectOpen(true)} />
      ) : searching ? (
        <GridCanvas>
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-ink-500">
            <Loader2 className="h-4 w-4 animate-spin" />
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
                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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

/**
 * A compact labelled select for the filter row.
 *
 * Wraps the app's own `Dropdown` rather than a native `<select>`: the browser's
 * stock popup is the one piece of unstyled OS chrome left in the app, and it
 * ignores the theme entirely (a white system menu over the dark workspace).
 */
function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <Dropdown
      compact
      fitContent
      // No app accent: this row is chrome above the grid, sitting under a
      // monochrome search field and Search button.
      accent="neutral"
      label={label}
      value={value}
      options={options}
      onChange={(v) => onChange(v as T)}
    />
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
