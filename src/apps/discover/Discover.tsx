import { useCallback, useRef, useState } from 'react'
import { Key, Loader2, Radar, Search } from 'lucide-react'
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

/** The per-card actions that can be mid-flight, so the right button spins. */
export type DiscoverAction = 'analyze' | 'remix' | 'save' | 'download'

/** Where a card's transcript has got to. 'empty' is a normal outcome, not a failure. */
export type TranscriptState =
  | { phase: 'loading' }
  | { phase: 'ready'; text: string }
  | { phase: 'empty' }
  | { phase: 'error'; message: string }

export default function Discover() {
  const baseKey = useProjectScopedKey('discover')
  const [platform, setPlatform] = usePersistedState<DiscoverPlatform>(`${baseKey}:platform`, 'tiktok')
  const [filters, setFilters] = usePersistedState<DiscoverFilters>(`${baseKey}:filters`, DEFAULT_FILTERS)
  const [query, setQuery] = useState('')

  const [results, setResults] = useState<DiscoverResult[]>([])
  const [cursor, setCursor] = useState<string | number | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searched, setSearched] = useState(false)

  const [openResult, setOpenResult] = useState<DiscoverResult | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyKind, setBusyKind] = useState<DiscoverAction | null>(null)

  // Transcripts, keyed by card. Fetched once when a card is opened and reused
  // by Remix, so reading the words and then sending them is ONE credit rather
  // than two. Lives here (not in the modal) so it survives closing the modal.
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

    const more = nextCursor !== undefined
    if (more) setLoadingMore(true)
    else { setSearching(true); setResults([]) }

    try {
      const page = await runSearch(apiKey, platform, q, filters, nextCursor)
      setResults((prev) => (more ? mergeResults(prev, page.results) : page.results))
      setCursor(page.cursor)
      if (page.creditsRemaining !== null) setCredits(page.creditsRemaining)
      setSearched(true)
    } catch (e) {
      addToast(humanizeError(e, 'That search failed. Try again in a moment.'), 'error')
    } finally {
      setSearching(false)
      setLoadingMore(false)
    }
  }, [apiKey, platform, filters, addToast])

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

  // Opening a card pulls its transcript straight away, so the words are on
  // screen rather than one click and one credit away. On Meta this is free
  // when the ad has no video — that endpoint only charges when it returns
  // something. Errors surface inside the modal, so nothing is toasted here.
  const openCard = useCallback((result: DiscoverResult) => {
    setOpenResult(result)
    // TikTok only. Meta's ad-transcript endpoint reads Facebook's exposed
    // captions, which Ad Library video ads don't carry, so it came back empty
    // every time — the modal drops the Transcript block there and routes the
    // words through Analyze Ad instead. `fetchResultTranscript` keeps its Meta
    // branch so re-enabling this is a one-line change if that ever improves.
    if (result.platform === 'tiktok') void ensureTranscript(result).catch(() => {})
  }, [ensureTranscript])

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
  const sorted = sortResults(applyMinViews(results, filters.minViews), activeSort)

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[57px] shrink-0 items-center gap-3 border-b border-ink/5 px-4">
        <SegmentedToggle
          options={[
            { value: 'tiktok', label: 'TikTok' },
            { value: 'meta', label: 'Meta Ads' },
          ]}
          value={platform}
          onChange={(v) => {
            setPlatform(v)
            // Results from the other platform would be answering a different
            // question — clear rather than leave a stale grid under a new tab.
            setResults([])
            setCursor(null)
            setSearched(false)
          }}
          fitContent
          dense
        />

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
                  label: v === 0 ? 'Any' : v >= 1_000_000 ? `${v / 1_000_000}M+` : `${v / 1000}K+`,
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
                ? 'Nothing came back for that phrase. Try a broader keyword, or widen the date range.'
                : isTikTok
                  ? 'Search a phrase and Outliers ranks what comes back by views against each creator’s own following.'
                  : 'Search a phrase to see the ads running against it, ranked by how long they’ve been live.'
            }
          />
        </GridCanvas>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
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
          transcript={transcripts[`${openResult.platform}:${openResult.id}`] ?? { phase: 'loading' }}
          onClose={() => setOpenResult(null)}
          onAnalyze={handleAnalyze}
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
