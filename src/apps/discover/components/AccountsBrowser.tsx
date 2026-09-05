import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCw, Users } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import GridCanvas, { AwaitingBody } from '../../../components/GridCanvas'
import { TileDeleteButton } from '../../../components/tileActions'
import FilterSelect from './FilterSelect'
import ResultCard from './ResultCard'
import { usePersistedState, useProjectScopedKey } from '../../../hooks/usePersistedState'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { useAppStore } from '../../../stores/appStore'
import { useBankStore } from '../../../stores/bankStore'
import { humanizeError } from '../../../utils/friendlyError'
import type { TrackedAccount } from '../../../stores/types'
import { applyAccountFilters, fetchAccountReels, mergeReels, scoreAgainstAccount } from '../services/accounts'
import { accountBaseline, formatCount, MIN_BASELINE_SAMPLE } from '../services/scoring'
import type { AccountFilters, AccountSort, DiscoverResult } from '../types'
import type { DiscoverAction } from '../Discover'

/**
 * How long a cached page of reels is trusted.
 *
 * The same trade the search grid makes and a longer window, because the two
 * platforms rot at different speeds: a TikTok result's urls are signed for
 * hours, Instagram's for rather longer. 24h means a day's work never re-buys
 * the same page, and a member who comes back on Monday gets a clean empty
 * state with the account's snapshot still in the rail rather than a wall of
 * dead thumbnails.
 *
 * The NUMBERS never rot — plays, likes and the median are facts about a day —
 * so what expires here is only the media the cards render.
 */
const REELS_TTL_MS = 24 * 60 * 60 * 1000

/** Accounts whose reels survive a reload, newest-viewed first. */
const CACHED_ACCOUNTS = 4

/** Reels persisted per account. Roughly two pages, ~40KB an account. */
const CACHED_REELS = 40

const SORT_OPTIONS: Array<{ value: AccountSort; label: string }> = [
  { value: 'score', label: 'Biggest outliers' },
  { value: 'plays', label: 'Most played' },
  { value: 'recent', label: 'Newest' },
]

const MIN_MULTIPLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '0', label: 'Any' },
  { value: '2', label: '2x+' },
  { value: '3', label: '3x+' },
  { value: '5', label: '5x+' },
  { value: '10', label: '10x+' },
]

const POSTED_OPTIONS: Array<{ value: AccountFilters['posted']; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '1m', label: 'Last month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: '12m', label: '12 months' },
]

/** One account's reels as last fetched. */
interface CachedReels {
  results: DiscoverResult[]
  cursor: string | null
  fetchedAt: number
}

type ReelCache = Record<string, CachedReels>

/** Drops every account's reels past the freshness window. */
function restoreCache(stored: ReelCache | null | undefined): ReelCache {
  const now = Date.now()
  const out: ReelCache = {}
  for (const [id, entry] of Object.entries(stored ?? {})) {
    if (!entry || !Array.isArray(entry.results)) continue
    if (typeof entry.fetchedAt !== 'number' || now - entry.fetchedAt >= REELS_TTL_MS) continue
    out[id] = { results: entry.results, cursor: entry.cursor ?? null, fetchedAt: entry.fetchedAt }
  }
  return out
}

/**
 * Caps what reaches localStorage. The in-memory cache is untouched.
 *
 * Truncation drops whole trailing pages and takes the cursor with them, for the
 * same reason the search grid's does: a Load more continuing from past a page
 * we didn't keep opens a gap in the middle that nothing on screen explains.
 */
function pruneCache(cache: ReelCache): ReelCache {
  const newest = Object.entries(cache)
    .sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt)
    .slice(0, CACHED_ACCOUNTS)
  return Object.fromEntries(newest.map(([id, entry]) => [
    id,
    entry.results.length <= CACHED_REELS
      ? entry
      : { ...entry, results: entry.results.slice(0, CACHED_REELS), cursor: null },
  ]))
}

/** "2h ago" / "3d ago" — how stale the numbers under it are. */
function agoLabel(at: number): string {
  const mins = Math.round((Date.now() - at) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

interface AccountsBrowserProps {
  accounts: TrackedAccount[]
  selectedId: string | null
  onSelect: (id: string) => void
  filters: AccountFilters
  onFiltersChange: (next: (f: AccountFilters) => AccountFilters) => void
  apiKey: string
  onCredits: (remaining: number) => void
  /** Card actions, owned by Discover so every tab spends them the same way. */
  onAnalyze: (result: DiscoverResult) => void
  onRemix: (result: DiscoverResult) => void
  onSave: (result: DiscoverResult) => void
  onDownload: (result: DiscoverResult) => void
  onOpen: (result: DiscoverResult) => void
  savedKeys: Set<string>
  busyId: string | null
  busyKind: DiscoverAction | null
}

export default function AccountsBrowser({
  accounts, selectedId, onSelect, filters, onFiltersChange, apiKey, onCredits,
  onAnalyze, onRemix, onSave, onDownload, onOpen, savedKeys, busyId, busyKind,
}: AccountsBrowserProps) {
  const baseKey = useProjectScopedKey('discover')
  const addToast = useAppStore((s) => s.addToast)

  const [cache, setCache] = usePersistedState<ReelCache>(
    `${baseKey}:account-reels`,
    {},
    { sanitize: restoreCache, prune: pruneCache },
  )
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  // Falls back to the first account rather than leaving the pane empty: the
  // rail is never blank when there is something in it, and a selection that
  // has since been untracked resolves to a neighbour instead of nothing.
  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0] ?? null
  const entry = selected ? cache[selected.id] : undefined

  // The live cache, read by `load` without closing over it — otherwise every
  // landed page would hand the memoized card grid a fresh handler identity.
  const cacheRef = useRef(cache)
  cacheRef.current = cache

  /**
   * Buys a page of reels and writes the account's snapshot back.
   *
   * The snapshot (baseline, sample size, refreshed-at) goes on the BANK row
   * rather than staying in the cache, so the rail can say what an account
   * normally does on a device that has never fetched a single reel — which is
   * what stops a second machine looking like an empty app.
   */
  const load = useCallback(async (account: TrackedAccount, cursor?: string) => {
    if (!apiKey) return
    if (cursor) setLoadingMore(true)
    else setLoadingId(account.id)

    try {
      const page = await fetchAccountReels(apiKey, account, cursor)
      if (page.creditsRemaining !== null) onCredits(page.creditsRemaining)

      // Merged against what is cached for THIS account as of NOW — read
      // through the ref rather than the render's closure, because a refresh
      // and a Load more can be in flight together and the second to land must
      // not drop the first. A Refresh replaces rather than merges: it exists
      // to correct numbers that have moved, and merging would keep the old
      // ones alongside the new.
      const previous = cursor ? cacheRef.current[account.id]?.results ?? [] : []
      const results = mergeReels(previous, page.results)
      setCache((all) => ({
        ...all,
        [account.id]: { results, cursor: page.cursor, fetchedAt: Date.now() },
      }))

      // The snapshot is taken off that same merge, so the median stored on the
      // account can't disagree with the grid it is printed above.
      const plays = results.map((r) => r.stats?.views)
      void useBankStore.getState().updateTrackedAccount(account.id, {
        baseline: accountBaseline(plays) ?? undefined,
        sampleSize: plays.filter((p) => typeof p === 'number' && p > 0).length,
        refreshedAt: Date.now(),
      })
    } catch (e) {
      addToast(humanizeError(e, `Couldn't load @${account.handle}'s reels.`), 'error')
    } finally {
      setLoadingId(null)
      setLoadingMore(false)
    }
    // `setCache` is useState's own setter via usePersistedState, so it's
    // stable — declared rather than disabled, since an eslint-disable of a
    // react-hooks rule anywhere in a file makes the React Compiler skip the
    // whole component, and this one owns a grid.
  }, [apiKey, onCredits, addToast, setCache])

  /**
   * ARRIVING on this tab costs nothing. PICKING an account costs a credit.
   *
   * The distinction is the whole rule, and the vault section of this app's
   * CLAUDE.md is why it's worth the ref dance: billing for the act of looking
   * is a mistake Outliers has already made once. A member whose cached reels
   * have aged out past the 24h window would otherwise be charged a credit per
   * tracked account simply for opening the app on the tab they left it on.
   *
   * So the account that is selected when the tab loads is treated as already
   * handled; anything the member selects AFTERWARDS — a click in the rail, or
   * the row `handleTrack` just created — is a deliberate ask and fetches. An
   * arriving account with nothing cached shows the priced Refresh instead.
   *
   * Seeded on the first render that actually HAS accounts, not on mount: the
   * bank hydrates a tick later, so seeding an empty set on render one would
   * make the restored selection look like a fresh pick and bill for it.
   */
  const arrivedWith = useRef<string | null | undefined>(undefined)
  if (arrivedWith.current === undefined && accounts.length > 0) {
    arrivedWith.current = selected?.id ?? null
  }

  /**
   * Accounts already asked for, so a rejected fetch isn't retried forever.
   *
   * Without it a failed load leaves the cache empty and the effect fires again
   * on the next render — a retry loop that spends a credit each time round.
   */
  const attempted = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!selected || !apiKey) return
    if (arrivedWith.current === undefined || selected.id === arrivedWith.current) return
    if (cache[selected.id] || attempted.current.has(selected.id)) return
    attempted.current.add(selected.id)
    void load(selected, undefined)
  }, [selected, apiKey, cache, load])

  const handleUntrack = useCallback((account: TrackedAccount) => {
    void useBankStore.getState().deleteTrackedAccount(account.id)
    setCache((all) => {
      const next = { ...all }
      delete next[account.id]
      return next
    })
    attempted.current.delete(account.id)
  }, [setCache])

  // Scored over everything loaded, then filtered — in that order, so narrowing
  // the date window never moves the median the badges were computed against.
  const scored = scoreAgainstAccount(entry?.results ?? [])
  const visible = applyAccountFilters(scored.results, filters)
  const hiddenByFilters = scored.results.length - visible.length
  const loading = !!selected && loadingId === selected.id

  if (accounts.length === 0) {
    return (
      <GridCanvas>
        <AwaitingBody
          icon={Users}
          title="No accounts tracked"
          hint="Paste a creator's Instagram profile link or their @handle above. Outliers pulls their reels and scores each one against that account's own median — so you see which of their posts actually popped, not just which ones are big."
        />
      </GridCanvas>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 max-md:flex-col">
      {/* The rail is ONE list in two directions: a column beside the grid from
          `md`, and a single scrolling line of chips under the header below it.
          Never a wrapping grid of chips — a second row of accounts would push
          the reels themselves off a phone screen. */}
      <div
        className="flex shrink-0 gap-1 border-ink/5 p-2 max-md:w-full max-md:overflow-x-auto max-md:border-b md:w-56 md:flex-col md:overflow-y-auto md:border-r"
      >
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            selected={account.id === selectedId}
            busy={loadingId === account.id}
            onSelect={() => onSelect(account.id)}
            onUntrack={() => handleUntrack(account)}
          />
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {selected && (
          // The account's own header, and the baseline every badge below it was
          // divided by. It is not decoration: the amber pill on a card means
          // "this many times the median", and this line is the only thing on
          // screen that says what the median IS.
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink/5 px-4 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col md:flex-none">
              <span className="truncate text-[13px] font-medium text-ink-200">@{selected.handle}</span>
              <span className="truncate text-[11px] text-ink-600">
                {selected.followerCount != null && `${formatCount(selected.followerCount)} followers · `}
                {scored.baseline != null
                  ? `median ${formatCount(scored.baseline)} plays over ${scored.sampleSize} reels`
                  : scored.sampleSize > 0
                    // Honest about WHY there is no badge on any card, rather
                    // than leaving a grid of unscored reels unexplained.
                    ? `${scored.sampleSize} reels — needs ${MIN_BASELINE_SAMPLE} to set a median`
                    : selected.refreshedAt
                      ? `refreshed ${agoLabel(selected.refreshedAt)}`
                      : 'not loaded yet'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => void load(selected, undefined)}
              disabled={loading}
              title="Re-fetch this account's reels and refresh its numbers"
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-ink/10 px-3 text-[12px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/5 disabled:opacity-50"
            >
              {loading ? <Spinner className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
              Refresh — 1 credit
            </button>

            {/* Three selects on a 375px line, where the vault's row has two —
                so `flex-auto` alone isn't enough: a flex item's min-width is
                its min-content, which for these buttons is the whole label +
                value + chevron, and the row overflowed the screen rather than
                sharing the shortfall. `min-w-0` is what lets each one shrink
                onto the `truncate` its trigger already carries. */}
            <div className="flex min-w-0 items-center gap-2 max-md:w-full">
              <FilterSelect
                dense
                className="max-md:min-w-0 max-md:flex-auto"
                label="Sort"
                value={filters.sort}
                options={SORT_OPTIONS}
                onChange={(sort) => onFiltersChange((f) => ({ ...f, sort }))}
              />
              <FilterSelect
                dense
                className="max-md:min-w-0 max-md:flex-auto"
                label="Score"
                value={String(filters.minMultiple)}
                options={MIN_MULTIPLE_OPTIONS}
                onChange={(v) => onFiltersChange((f) => ({
                  ...f, minMultiple: Number(v) as AccountFilters['minMultiple'],
                }))}
              />
              <FilterSelect
                dense
                className="max-md:min-w-0 max-md:flex-auto"
                label="Posted"
                value={filters.posted}
                options={POSTED_OPTIONS}
                onChange={(posted) => onFiltersChange((f) => ({ ...f, posted }))}
              />
            </div>
          </div>
        )}

        {!selected ? (
          <GridCanvas>
            <AwaitingBody
              icon={Users}
              title="Pick an account"
              hint="Choose a creator to see their reels ranked by how far each one beat their own median."
            />
          </GridCanvas>
        ) : loading ? (
          <GridCanvas>
            <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-ink-500">
              <Spinner className="h-4 w-4" />
              Loading @{selected.handle}'s reels…
            </div>
          </GridCanvas>
        ) : visible.length === 0 ? (
          <GridCanvas>
            <AwaitingBody
              icon={Users}
              title={entry ? 'Nothing matches' : 'Nothing loaded'}
              hint={
                entry
                  ? hiddenByFilters > 0
                    // The fetch DID return — the filters ate it. Telling this
                    // member to refresh would spend a credit on the same grid.
                    ? `All ${hiddenByFilters} reels are filtered out. Widen the score or date filter to see them.`
                    : 'This account has no public reels to rank.'
                  : "Refresh to pull this account's reels — 1 credit."
              }
            />
          </GridCanvas>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {hiddenByFilters > 0 && (
              <p className="mb-3 text-[11px] text-ink-600">
                {hiddenByFilters} more hidden by the filters.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visible.map((result) => (
                <ResultCard
                  key={result.id}
                  result={result}
                  onAnalyze={onAnalyze}
                  onRemix={onRemix}
                  onSave={onSave}
                  onDownload={onDownload}
                  onOpen={onOpen}
                  saved={savedKeys.has(`instagram:${result.id}`)}
                  busy={busyId === result.id ? busyKind : null}
                />
              ))}
            </div>

            {entry?.cursor && (
              <div className="flex justify-center py-6">
                <button
                  type="button"
                  onClick={() => void load(selected, entry.cursor ?? undefined)}
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
      </div>
    </div>
  )
}

/**
 * One account in the rail.
 *
 * Carries its own snapshot line — the median it last measured — because that is
 * what makes the rail scannable as a list of creators rather than a list of
 * names: you pick the account whose usual is worth beating.
 */
function AccountRow({
  account, selected, busy, onSelect, onUntrack,
}: {
  account: TrackedAccount
  selected: boolean
  busy: boolean
  onSelect: () => void
  onUntrack: () => void
}) {
  const avatarUrl = useAssetUrl(account.avatarRef)

  return (
    <div
      className={`group relative flex shrink-0 items-center gap-2 rounded-xl px-2 py-1.5 transition-colors max-md:w-44 ${
        selected ? 'bg-ink/[0.07]' : 'hover:bg-ink/[0.04]'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink/10 text-[10px] font-medium uppercase text-ink-400">
            {account.handle.slice(0, 2)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[12px] ${selected ? 'text-ink-100' : 'text-ink-300'}`}>
            {account.handle}
          </span>
          <span className="block truncate text-[10px] text-ink-600">
            {busy
              ? 'loading…'
              : account.baseline != null
                ? `median ${formatCount(account.baseline)}`
                : account.refreshedAt
                  // A refreshed account with no median is one under the sample
                  // floor, which is a fact about the account, not a failure.
                  ? 'no median yet'
                  : 'not loaded'}
          </span>
        </span>
      </button>

      {/* Two-click, like every other delete in the app — and `chrome`, because
          this sits on a panel surface rather than over media. */}
      <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 touch:opacity-100">
        <TileDeleteButton
          variant="chrome"
          size="sm"
          title={`Stop tracking @${account.handle}`}
          onDelete={onUntrack}
        />
      </span>
    </div>
  )
}
