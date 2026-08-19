import { useEffect, useState } from 'react'
import { Library, RotateCw, Star } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import GridCanvas, { AwaitingBody } from '../../../components/GridCanvas'
import SegmentedToggle from '../../../components/SegmentedToggle'
import FilterSelect from '../components/FilterSelect'
import VaultCard, { type VaultAction } from './VaultCard'
import VaultDetailModal from './VaultDetailModal'
import { usePersistedState, useProjectScopedKey } from '../../../hooks/usePersistedState'
import { useAppStore } from '../../../stores/appStore'
import { humanizeError } from '../../../utils/friendlyError'
import { downloadVideoFile, saveFileToDisk } from '../services/handoff'
import {
  categoryLabel, facetCounts, filterVault, loadVault, patternLabel,
  resolveVaultVideo, thumbUrl, vaultFileName, VaultMessage, type VaultRow,
} from './service'
import type { ResolvedVideo, VaultFilters, VaultItem, VaultSort } from './types'

/**
 * How many cards reach the DOM at once.
 *
 * The whole library is 872 rows and every one carries a cover, a hover stack
 * and (once resolved) a player. `content-visibility` is the usual lever and is
 * wrong here — it carries size containment, so it may only go on a box sized by
 * its own geometry, and these cards are sized by their text. Paging is the
 * boring fix, and the search tab already taught the button: this one just
 * costs nothing.
 */
const PAGE = 60

const SORT_OPTIONS: Array<{ value: VaultSort; label: string }> = [
  { value: 'outlier', label: 'Biggest outliers' },
  { value: 'likes', label: 'Most liked' },
  { value: 'recent', label: 'Newest' },
]

interface VaultBrowserProps {
  /** The header's field, which filters live in this mode rather than searching. */
  query: string
  filters: VaultFilters
  onFiltersChange: (next: (f: VaultFilters) => VaultFilters) => void
  /** Needed only to un-freeze a row's video — browsing and watching cost nothing. */
  apiKey: string
  onCredits: (remaining: number) => void
  /** Opens the ScrapeCreators popup Discover owns. See `requireKey`. */
  onNeedKey: () => void
}

export default function VaultBrowser({
  query, filters, onFiltersChange, apiKey, onCredits, onNeedKey,
}: VaultBrowserProps) {
  const [rows, setRows] = useState<VaultRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Both writes land in the promise's callbacks rather than in the effect
  // body: a synchronous setState inside an effect is a second render pass
  // before paint, and this one owns the grid. Clearing the error is the retry
  // button's job, where it is an event rather than a cascade.
  useEffect(() => {
    let live = true
    loadVault().then(
      (r) => { if (live) { setRows(r); setLoadError(null) } },
      (e: unknown) => { if (live) setLoadError(humanizeError(e, "Couldn't load the vault.")) },
    )
    return () => { live = false }
  }, [attempt])

  // Stars are browser-local on purpose. They mark rows in a read-only library
  // that is identical for every member, so there is nothing here worth a
  // Postgres table and a migration — and unlike a bank row, losing one costs a
  // member nothing they made.
  const starKey = useProjectScopedKey('discover:vault-stars')
  const [starIds, setStarIds] = usePersistedState<string[]>(starKey, [])
  const starred = new Set(starIds)

  // Resolved videos, session-only: an Instagram media url is signed and dies
  // within hours, so persisting one would restore a library of dead players.
  // Held here rather than per-card so paying once covers the grid AND the
  // modal, and so paging a card out of the DOM doesn't lose what it cost.
  const [videos, setVideos] = useState<Record<string, ResolvedVideo>>({})

  const [openItem, setOpenItem] = useState<VaultItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyKind, setBusyKind] = useState<VaultAction | null>(null)

  // Back to one page whenever what's IN the list changes — a member who
  // filtered to 12 hooks after scrolling 300 deep should not have to press
  // Show more to see them.
  //
  // Adjusted DURING render against a signature rather than in an effect:
  // an effect would paint the old page count first and then correct it, and
  // React re-runs this render before committing anything, so nothing flashes.
  const listSignature = `${query}|${filters.category}|${filters.pattern}|${filters.sort}|${filters.starredOnly}`
  const [shown, setShown] = useState(PAGE)
  const [shownFor, setShownFor] = useState(listSignature)
  if (shownFor !== listSignature) {
    setShownFor(listSignature)
    setShown(PAGE)
  }

  const addToast = useAppStore((s) => s.addToast)
  const sendToApp = useAppStore((s) => s.sendToApp)
  const openApp = useAppStore((s) => s.openApp)

  // No hand-written useCallback anywhere below, on purpose. The React Compiler
  // memoizes this component's handlers for us, and it can only do that if it
  // can compile the component at all — a manual `useCallback` whose declared
  // deps don't match what the compiler infers (a useState setter, typically)
  // makes it skip the WHOLE component, which would take the memo on 60 cards
  // down with it. Hand-rolling the memoization here was the thing preventing
  // the memoization.
  const handleStar = (item: VaultItem) => {
    setStarIds((ids) => ids.includes(item.id) ? ids.filter((i) => i !== item.id) : [...ids, item.id])
  }

  /**
   * The row's playable video, paying the credit only if we don't already hold it.
   *
   * Every button that needs a file goes through here, so a member who loads the
   * video, watches it, then presses Analyze spends one credit rather than two.
   */
  const ensureVideo = async (item: VaultItem): Promise<ResolvedVideo> => {
    const held = videos[item.id]
    if (held) return held
    if (!apiKey) throw new VaultMessage('Connect your ScrapeCreators key to pull this video from Instagram.')

    const { video, creditsRemaining } = await resolveVaultVideo(apiKey, item)
    if (creditsRemaining !== null) onCredits(creditsRemaining)
    setVideos((v) => ({ ...v, [item.id]: video }))
    return video
  }

  const runFor = async (
    item: VaultItem,
    kind: VaultAction,
    fallback: string,
    work: () => Promise<void>,
  ) => {
    setBusyId(item.id)
    setBusyKind(kind)
    const result = await settle(work)
    setBusyId(null)
    setBusyKind(null)
    if (!result.ok) {
      // Our own copy goes out as written; anything from a vendor gets
      // translated. See VaultMessage.
      const { error } = result
      addToast(
        error instanceof VaultMessage ? error.message : humanizeError(error, fallback),
        'error',
      )
    }
  }

  /**
   * True when the press can't proceed, having already opened the fix.
   *
   * Analyze and Download need a real file, which needs a credit, which needs a
   * key. Those buttons used to be DISABLED without one, explained by a tooltip
   * — which is how a member ends up staring at a dead primary button with no
   * idea why, and no route to the fix from where they're standing. Pressing it
   * now opens the same ScrapeCreators popup the search tabs use, so the button
   * answers its own question. Same doctrine as `ConnectKeyPanel`: an empty
   * state is never a dead end.
   */
  const requireKey = (): boolean => {
    if (apiKey) return false
    onNeedKey()
    return true
  }

  const handleAnalyze = (item: VaultItem) => {
    if (requireKey()) return
    void runFor(item, 'analyze', "Couldn't import that video. Try opening the original instead.", async () => {
      const video = await ensureVideo(item)
      const file = await downloadVideoFile(video.url, vaultFileName(item))
      sendToApp({
        targetApp: 'ad-anatomy',
        targetField: 'adVideo',
        data: { file, sourceUrl: item.url, caption: item.caption },
      })
      openApp('ad-anatomy')
      setOpenItem(null)
    })
  }

  const handleDownload = (item: VaultItem) => {
    if (requireKey()) return
    void runFor(item, 'download', "Couldn't download that video. Try opening the original instead.", async () => {
      const video = await ensureVideo(item)
      const name = vaultFileName(item)
      saveFileToDisk(await downloadVideoFile(video.url, name), name)
    })
  }

  /**
   * Straight to Scripts, free.
   *
   * The search tab's Remix costs a credit because the words have to be bought
   * from the platform; every row here was transcribed when the library was
   * built, so there is nothing to fetch and nothing to bill.
   */
  const handleRemix = (item: VaultItem) => {
    const text = item.transcript.trim()
    if (!text) {
      addToast('This reel has no spoken words to remix.', 'info')
      return
    }
    sendToApp({ targetApp: 'script-architect', targetField: 'winningTranscript', data: text })
    openApp('script-architect')
    setOpenItem(null)
  }

  const openCard = (item: VaultItem) => setOpenItem(item)

  if (loadError) {
    return (
      <GridCanvas>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Library className="h-8 w-8 text-ink-800" strokeWidth={1.5} />
          <p className="text-sm text-ink-500">The vault didn’t load</p>
          <p className="max-w-[340px] text-xs leading-relaxed text-ink-600">{loadError}</p>
          <button
            type="button"
            onClick={() => { setRows(null); setAttempt((a) => a + 1) }}
            className="flex items-center gap-2 rounded-full border border-ink/10 px-4 py-2 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Try again
          </button>
        </div>
      </GridCanvas>
    )
  }

  if (!rows) {
    return (
      <GridCanvas>
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-ink-500">
          <Spinner className="h-4 w-4" />
          Opening the vault…
        </div>
      </GridCanvas>
    )
  }

  // The stable segment list: every category the LIBRARY holds, in library
  // order. Validation and the toggle's shape both read this, never the scoped
  // counts below — otherwise picking a hook that empties a folder would make
  // that folder's segment vanish, or silently reset the member's folder.
  const allCategories = facetCounts(rows, (r) => [r.category])

  // `filters.category` doubles as the open folder — one piece of state, so the
  // header's reset already returns to All and none of this needed a migration.
  //
  // Coerced the same way the search tab coerces a persisted sort with no
  // option on the current platform: a category dropped by a corpus rebuild
  // would otherwise leave every chip unlit over an empty grid, with nothing on
  // screen saying why.
  const openFolder = filters.category && allCategories.some((c) => c.value === filters.category)
    ? filters.category
    : ''
  const active = { ...filters, category: openFolder }
  const matches = filterVault(rows, query, active, starred)
  const page = matches.slice(0, shown)

  // ── Faceted counts ────────────────────────────────────────────
  //
  // Every count is taken over the rows matching all the OTHER filters, never
  // over the whole library. That is the difference between a number that
  // describes the corpus and a number that predicts what clicking it gives
  // you, and only the second is any use next to a control.
  //
  // The library-wide version shipped first and was wrong in both directions:
  // inside Authority (35 rows) the hook menu still advertised "Plain statement
  // 286" when 10 of them were in reach, and **13 of its 27 options had nothing
  // there at all** — so picking one produced an empty grid with a number on
  // screen insisting there were hundreds. Same the other way: with a hook
  // picked, every folder still claimed its full size.
  const folderScope = filterVault(rows, query, { ...active, category: '' }, starred)
  const folderCounts = new Map<string, number>()
  for (const r of folderScope) {
    if (r.category) folderCounts.set(r.category, (folderCounts.get(r.category) ?? 0) + 1)
  }

  const hookScope = filterVault(rows, query, { ...active, pattern: '' }, starred)
  const patterns = facetCounts(hookScope, (r) => r.patterns)
  const hookOptions = [
    { value: '', label: 'Any' },
    ...patterns.map((p) => ({ value: p.value, label: patternLabel(p.value), count: p.count })),
  ]
  // A hook with nothing in this folder is simply absent from `patterns`, which
  // is what stops a member picking a dead end. The one that must survive is
  // the one already PICKED: dropping it would orphan the trigger, and its 0 is
  // the on-screen explanation for the empty grid it just produced.
  if (filters.pattern && !patterns.some((p) => p.value === filters.pattern)) {
    hookOptions.push({ value: filters.pattern, label: patternLabel(filters.pattern), count: 0 })
  }

  // The denominator is the FOLDER, not the library: inside Educational, "34 of
  // 432" is the number being narrowed. Note the folder counts deliberately sum
  // to 866 rather than 872 — six rows carry no category at all, so they live
  // in All and belong to no folder. That is the harvest being honest, not an
  // off-by-six.
  const folderTotal = openFolder
    ? allCategories.find((c) => c.value === openFolder)?.count ?? 0
    : rows.length

  return (
    <>
      {/* Folders, as ONE segmented control rather than seven loose chips —
          the same shape (and the same `dense` size) as the Outlier Vault /
          TikTok / Meta toggle directly above it, so the two read as a pair of
          switches rather than a switch over a row of buttons. The sliding
          indicator is what makes it a toggle: it carries the eye from the old
          folder to the new one instead of one pill going dark as another
          lights up. Counts ride in its own `badge` slot.

          All leads and is where a member lands — a folder screen with nothing
          behind it would put the vault's one job (something worth stealing, on
          screen, immediately) back behind a click. Ordered by size, since
          `facetCounts` sorts by count.

          The wrapper still scrolls on a phone: seven segments are wider than
          375px, and a segmented control can't wrap. */}
      {/* Folders get the whole row. Sharing it with the filters was tried and
          reverted: the two need ~1310px to sit together un-scrolled, so on
          anything narrower the toggle had to scroll and the last folders sat
          off screen behind a swipe. A row of chrome is cheaper than a folder
          you can't see. The strip still scrolls on a phone, where nothing
          could have fitted anyway. */}
      <div className="scrollbar-hide flex shrink-0 items-center overflow-x-auto border-b border-ink/5 px-4 py-2.5">
        <SegmentedToggle
          options={[
            { value: '', label: 'All', badge: folderScope.length },
            ...allCategories.map((c) => ({
              value: c.value,
              label: categoryLabel(c.value),
              badge: folderCounts.get(c.value) ?? 0,
            })),
          ]}
          value={openFolder}
          onChange={(category) => onFiltersChange((f) => ({ ...f, category }))}
          accent="outliers"
          fitContent
          dense
        />
      </div>

      {/* Sort / Hook / Starred, on their own row under the folders. Same 36px
          as the toggles above, so the three bands read as one stack. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink/5 px-4 py-2.5">
        <FilterSelect
          dense
          label="Sort"
          value={filters.sort}
          options={SORT_OPTIONS}
          onChange={(sort) => onFiltersChange((f) => ({ ...f, sort }))}
        />
        {/* The structure of the opening line, which is the lens this library is
            actually for: "show me every big-number open" is a question no
            search tool answers. */}
        <FilterSelect
          dense
          label="Hook"
          menuMinWidth={232}
          value={filters.pattern}
          options={hookOptions}
          onChange={(pattern) => onFiltersChange((f) => ({ ...f, pattern }))}
        />
        <button
          type="button"
          onClick={() => onFiltersChange((f) => ({ ...f, starredOnly: !f.starredOnly }))}
          title="Show only the hooks you starred"
          // 36px — the height of the folder toggle beside it and of the two
          // dropdowns, so everything on this row sits on one line.
          className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors ${
            filters.starredOnly
              ? 'border-amber-400/40 bg-amber-400/10 text-amber-300 light:text-amber-700'
              : 'border-ink/10 text-ink-300 hover:border-ink/20 hover:bg-ink/5'
          }`}
        >
          <Star className={`h-3.5 w-3.5 ${filters.starredOnly ? 'fill-current' : ''}`} />
          Starred
          {starIds.length > 0 && <span className="tabular-nums opacity-60">{starIds.length}</span>}
        </button>

        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-600">
          {matches.length === folderTotal
            ? `${folderTotal} hooks`
            : `${matches.length} of ${folderTotal}`}
        </span>
      </div>

      {matches.length === 0 ? (
        <GridCanvas>
          <AwaitingBody
            icon={Library}
            title="Nothing matches"
            hint={
              filters.starredOnly && starIds.length === 0
                ? 'You haven’t starred anything yet. Star a hook from its card and it lands here.'
                : openFolder
                  // Naming the folder is the difference between "nothing
                  // matches" and "nothing matches IN HERE" — the second tells
                  // a member the fix is one chip away rather than a rewrite.
                  ? `Nothing in ${categoryLabel(openFolder)} matches that. Try All, or a shorter phrase.`
                  : 'No hook, script or creator in the vault matches that. Try a shorter phrase, or clear the filters.'
            }
          />
        </GridCanvas>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {page.map((item) => (
              <VaultCard
                key={item.id}
                item={item}
                starred={starred.has(item.id)}
                onStar={handleStar}
                onOpen={openCard}
                onAnalyze={handleAnalyze}
                onRemix={handleRemix}
                onDownload={handleDownload}
                video={videos[item.id]}
                busy={busyId === item.id ? busyKind : null}
              />
            ))}
          </div>

          {/* Where the search tab says "Load more — 1 credit", this one is
              free: the rows are already on the member's machine and the only
              thing being spent is DOM. */}
          {shown < matches.length && (
            <div className="flex justify-center py-6">
              <button
                type="button"
                onClick={() => setShown((n) => n + PAGE)}
                className="rounded-full border border-ink/10 px-5 py-2.5 text-[13px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5"
              >
                Show more — {matches.length - shown} left
              </button>
            </div>
          )}
        </div>
      )}

      {openItem && (
        <VaultDetailModal
          item={openItem}
          video={videos[openItem.id]}
          starred={starred.has(openItem.id)}
          hasKey={!!apiKey}
          onNeedKey={onNeedKey}
          busy={busyId === openItem.id ? busyKind : null}
          onClose={() => setOpenItem(null)}
          onStar={handleStar}
          onAnalyze={handleAnalyze}
          onRemix={handleRemix}
          onDownload={handleDownload}
          coverUrl={thumbUrl(openItem)}
        />
      )}
    </>
  )
}

/**
 * Runs an async action and reports rather than throws.
 *
 * Module scope on purpose: a `try` inside a component body makes the React
 * Compiler skip that component entirely, and this one owns an 872-row grid.
 */
async function settle(work: () => Promise<void>): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await work()
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}
