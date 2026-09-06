import { ChevronRight, Folder, Star } from 'lucide-react'
import { categoryLabel, folderCovers, type VaultRow } from './service'
import { ALL_HOOKS } from './types'

/**
 * The vault's landing screen: the library as folders you open.
 *
 * It replaced a segmented toggle that sat above the grid with All selected, so
 * the trade is deliberate and worth writing down — arriving on hooks put
 * something worth stealing on screen immediately, arriving on folders says
 * what the 872 rows actually CONTAIN before asking anyone to scroll them.
 * Two things keep the old speed within reach: **All Outlier Videos leads the screen**,
 * so the previous landing is one click and always the first click available,
 * and typing in the header's field skips this screen entirely (a query is a
 * request to see hooks, not folders).
 *
 * Folders are derived from the rows, never hardcoded — a corpus rebuild that
 * adds a category grows this screen on its own, exactly as it grows the Hook
 * filter. Note the category folders sum to 866 rather than 872: six rows carry
 * no category at all, so they live in All Outlier Videos and belong to no folder. That
 * is the harvest being honest; don't invent an Other folder to make it tidy.
 */

interface VaultFoldersProps {
  rows: VaultRow[]
  /** Drives the Starred folder, which only exists once something is in it. */
  starredIds: string[]
  /** Opens a folder. `starredOnly` is how the Starred tile differs from All. */
  onOpen: (category: string, starredOnly?: boolean) => void
}

interface Tile {
  key: string
  label: string
  count: number
  covers: string[]
  starred?: boolean
  open: () => void
}

export default function VaultFolders({ rows, starredIds, onOpen }: VaultFoldersProps) {
  const byCategory = new Map<string, VaultRow[]>()
  for (const r of rows) {
    if (!r.category) continue
    const held = byCategory.get(r.category)
    if (held) held.push(r)
    else byCategory.set(r.category, [r])
  }

  // Biggest folder first, the order `facetCounts` uses everywhere else in this
  // app.
  const categories = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)

  const tiles: Tile[] = [
    {
      key: 'all',
      label: 'All Outlier Videos',
      count: rows.length,
      // One cover from each of the biggest folders rather than the library's
      // own top three — those all live in the same folder, so this tile came
      // out a pixel-perfect copy of the Educational one sitting next to it.
      // A tile promising everything should look like more than one thing.
      covers: categories.slice(0, 3).map(([, list]) => folderCovers(list, 1)[0]).filter(Boolean),
      open: () => onOpen(ALL_HOOKS),
    },
    ...categories.map(([value, list]) => ({
      key: value,
      label: categoryLabel(value),
      count: list.length,
      covers: folderCovers(list),
      open: () => onOpen(value),
    })),
  ]

  if (starredIds.length > 0) {
    const ids = new Set(starredIds)
    const mine = rows.filter((r) => ids.has(r.id))
    tiles.push({
      key: 'starred',
      label: 'Starred',
      count: mine.length,
      covers: folderCovers(mine),
      starred: true,
      // The one tile that isn't a category: it opens the whole library with
      // the Starred filter on, so it stays the same control the grid already
      // has rather than a fourth kind of state.
      open: () => onOpen(ALL_HOOKS, true),
    })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <FolderTile key={tile.key} tile={tile} />
        ))}
      </div>
    </div>
  )
}

function FolderTile({ tile }: { tile: Tile }) {
  const Glyph = tile.starred ? Star : Folder
  return (
    <button
      type="button"
      onClick={tile.open}
      className="group flex flex-col overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.02] text-left transition-colors hover:border-[#D9A404]/40 hover:bg-ink/[0.04]"
    >
      {/* A three-up mosaic of the folder's best covers. `object-cover` here,
          against the `object-contain` every CARD uses: a card is where the
          reel's own hook text has to survive, a preview column a third of a
          tile wide is where letterboxing would leave three slivers. */}
      <div className="relative grid aspect-[16/9] grid-cols-3 gap-px bg-black">
        {[0, 1, 2].map((i) => (
          tile.covers[i] ? (
            <img
              key={tile.covers[i]}
              src={tile.covers[i]}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover opacity-75 transition-opacity duration-200 group-hover:opacity-100"
            />
          ) : (
            <div key={i} className="h-full w-full bg-ink/[0.04]" />
          )
        ))}
        {/* The count rides on the picture, in the same badge shape a card
            wears for its category. It sat in the footer beside the name and
            had to come off it: two columns on a 375px phone leave a footer
            ~126px wide, and a name sharing that with a number and a chevron
            got ~46px — every folder read "Stor…". */}
        <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium tabular-nums text-white/80">
          {tile.count}
        </span>
      </div>

      {/* A floor rather than a fixed height: a long name wraps to two lines on
          a phone (`line-clamp-2`, no truncation — the name is the whole point
          of the tile), and the floor keeps the one-line tiles beside it level
          rather than leaving a ragged row. */}
      <div className="flex min-h-[44px] items-center gap-2.5 px-3 py-2.5">
        {/* Outliers' gold as a literal — the app's `gold-*` Tailwind family is
            #0EA5E9, which is sky blue and belongs to the Products bank. */}
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            tile.starred
              ? 'bg-amber-400/10 text-amber-300 light:text-amber-700'
              : 'bg-[#D9A404]/10 text-[#D9A404] light:text-[#8A6A00]'
          }`}
        >
          <Glyph className={`h-3.5 w-3.5 ${tile.starred ? 'fill-current' : ''}`} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 line-clamp-2 text-[13px] font-medium leading-tight text-ink-200">
          {tile.label}
        </span>
        {/* Hidden on a phone, where the grid is two columns and those 22px are
            the difference between "Educational" and "Educationa…". A one-word
            name has nowhere to wrap, and naming the folder beats decorating
            it — the tile is plainly a button either way, and there is no
            hover state on a touch screen for the chevron to answer. */}
        <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-ink-700 transition-transform group-hover:translate-x-0.5 sm:block" />
      </div>
    </button>
  )
}
