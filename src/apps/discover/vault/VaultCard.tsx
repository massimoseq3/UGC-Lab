import { memo } from 'react'
import { Download, ExternalLink, Eye, Heart, ImageOff, MessageCircle, Pause, PenLine, Play, Volume2, VolumeX } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import { TileActionStack, TileActionButton, TileStarButton } from '../../../components/tileActions'
import { useInlineVideo } from '../../../hooks/useInlineVideo'
import { bandFor } from '../services/scoring'
import { formatCount, formatMultiple } from '../services/scoring'
import { MULTIPLE_TITLE, categoryLabel, thumbUrl } from './service'
import type { ResolvedVideo, VaultItem } from './types'

// Same action glyphs as the search grid — Eye is Ad Analyzer, PenLine is
// Scripts — so a member who has learned the hover row on one tab already knows
// it on the other.

export type VaultAction = 'analyze' | 'download'

interface VaultCardProps {
  item: VaultItem
  starred: boolean
  onStar: (item: VaultItem) => void
  onOpen: (item: VaultItem) => void
  onAnalyze: (item: VaultItem) => void
  onRemix: (item: VaultItem) => void
  onDownload: (item: VaultItem) => void
  /** Set once someone has spent a credit un-freezing this row this session. */
  video?: ResolvedVideo
  busy?: VaultAction | null
}

function VaultCardImpl({
  item, starred, onStar, onOpen, onAnalyze, onRemix, onDownload, video, busy = null,
}: VaultCardProps) {
  const player = useInlineVideo()
  const band = item.multiple != null ? bandFor(item.multiple) : undefined
  const hasTranscript = !!item.transcript.trim()

  return (
    <div
      {...player.hoverProps}
      onClick={() => onOpen(item)}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.02] transition-colors hover:border-ink/15"
    >
      {/* The same 4:5 letterboxed frame the search grid uses: a true 9:16 tile
          is nearly twice its own width in height, and object-cover would crop
          exactly the top and bottom where the hook text sits. */}
      <div className="relative aspect-[4/5] overflow-hidden bg-black">
        {item.hasThumb ? (
          <img
            src={thumbUrl(item)}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          // The build script keeps a row whose cover it couldn't make rather
          // than dropping a hook over a missing picture. Render the gap as a
          // glyph: a bare <img> with no file paints the browser's own
          // broken-image box, which is what put stray outlines on every
          // TikTok card in the search grid.
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageOff className="h-6 w-6 text-white/25" strokeWidth={1.5} />
          </div>
        )}
        {/* Only after a credit has been spent. Until then the row is a still —
            which is the whole point of shipping the library frozen. */}
        {video && (
          <video
            {...player.videoProps}
            src={`${video.url}#t=0.1`}
            poster={video.coverUrl ?? thumbUrl(item)}
            preload="metadata"
            className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${
              player.playing ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        {/* Category only. The outlier multiple used to stack above it here and
            now rides in the stats row below, where it belongs: it is a NUMBER
            about this reel, and the numbers are read across the grid as a row.
            Stacked on the picture it was two badges deep in the corner and
            competing with the reel's own on-screen hook text, which is the one
            thing the frame exists to show. */}
        {item.category && (
          <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white/80">
            {categoryLabel(item.category)}
          </span>
        )}

        {/* A signal, not a control: every row in the vault is a reel, and
            since Instagram's embed made watching free, clicking any card gets
            you a playable video. The card is already the button — this glyph
            takes `pointer-events-none` so the click falls through rather than
            adding a second control that does the same thing. It sits where the
            search grid's play button sits, so the two tabs read alike. It
            steps aside once a real player is on the tile. */}
        {!video && (
          <span className="pointer-events-none absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white">
            <Play className="h-3 w-3" />
          </span>
        )}

        {/* Real controls, once Analyze or Download has bought a real file. */}
        {video && (
          <div className="absolute bottom-2 left-2 flex gap-1">
            <button
              type="button"
              onClick={player.togglePlay}
              title={player.watching ? 'Pause' : 'Play with sound'}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white transition-colors hover:bg-black/70"
            >
              {player.watching ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={player.toggleMute}
              title={player.unmuted ? 'Mute' : 'Unmute'}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white transition-colors hover:bg-black/70"
            >
              {player.unmuted ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
            </button>
          </div>
        )}

        {/* Canonical order: Star → Download → extras. No Save — a vault row is
            a library entry, not something to file into a bank it already
            outlives. Held visible while starred, same rule as everywhere. */}
        <TileActionStack forceVisible={starred}>
          <TileStarButton
            starred={starred}
            onToggle={() => onStar(item)}
            title="Star — starred hooks filter to the top of the vault"
          />
          <TileActionButton
            title={video ? 'Download the video' : 'Download the video — 1 credit to fetch it from Instagram'}
            onClick={() => onDownload(item)}
            // Never disabled for a missing key — the handler opens the popup
            // that fixes it. Only an in-flight action holds these.
            disabled={busy != null}
          >
            {busy === 'download' ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
          </TileActionButton>
          <TileActionButton
            title={video ? 'Analyze Ad — opens in Ad Analyzer' : 'Analyze Ad — 1 credit to fetch the video, then opens in Ad Analyzer'}
            onClick={() => onAnalyze(item)}
            disabled={busy != null}
          >
            {busy === 'analyze' ? <Spinner className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </TileActionButton>
          {/* Free, unlike its opposite number on the search grid: the words are
              already in the library, transcribed once when it was built. */}
          <TileActionButton
            title={hasTranscript ? 'Remix Transcript — free, opens in Scripts' : 'This reel has no spoken words'}
            onClick={() => onRemix(item)}
            disabled={!hasTranscript}
          >
            <PenLine className="h-3.5 w-3.5" />
          </TileActionButton>
          <TileActionButton
            title="Open on Instagram"
            onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </TileActionButton>
        </TileActionStack>
      </div>

      <div className="flex flex-col gap-2 p-2.5">
        {/* The hook leads, and it is the biggest type on the card. Every other
            grid in the app puts the picture first because the picture is the
            output; here the output is the sentence. Fixed at three lines
            (3 × leading-relaxed) so the numbers under it line up across the
            row and can be read as a column. */}
        <p className="line-clamp-3 h-[4.875em] overflow-hidden text-[12px] font-medium leading-relaxed text-ink-100">
          {item.hook || item.caption || 'No hook'}
        </p>

        <span className="truncate text-[11px] text-ink-500">@{item.author}</span>

        <div className="flex items-center justify-between gap-1 border-t border-ink/5 pt-2 text-[10px] text-ink-500">
          {/* Leads the row: it is the reason this reel is in the library at
              all, and the only figure here that ranks it against the other
              871. Kept solid amber — the same badge it was on the frame — so
              it still reads as a score rather than as a third statistic. */}
          {band && item.multiple != null && (
            <span
              title={MULTIPLE_TITLE}
              className="shrink-0 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-black"
            >
              {formatMultiple(item.multiple)}
            </span>
          )}
          <span className="flex items-center gap-1 text-ink-200" title="Likes">
            <Heart className="h-3 w-3 shrink-0" />
            <span className="tabular-nums">{formatCount(item.likes)}</span>
          </span>
          <span className="flex items-center gap-1" title="Comments">
            <MessageCircle className="h-3 w-3 shrink-0" />
            <span className="tabular-nums">{formatCount(item.comments)}</span>
          </span>
          {item.createdAt > 0 && (
            <span className="shrink-0 text-ink-600">{postedOn(item.createdAt)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * "Mar 2025" — a month and a year, not "8mo ago".
 *
 * The search grid counts backwards because a two-week-old winner is a live
 * trend and a two-year-old one isn't. Every row here is months old by
 * construction, so a relative count would just print a wall of "1y ago" that
 * says nothing about which era a hook comes from.
 */
function postedOn(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

// 872 cards in one grid, re-rendered on every keystroke in the filter field
// above it. Same reasoning as ResultCard and Playground's history grid.
export default memo(VaultCardImpl)
