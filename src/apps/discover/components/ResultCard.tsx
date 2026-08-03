import { memo, type ElementType } from 'react'
import {
  Bookmark, Eye, ExternalLink, Heart, Loader2, MessageCircle,
  PenLine, Play, Share2, Volume2, VolumeX,
} from 'lucide-react'
import { TileActionStack, TileActionButton } from '../../../components/tileActions'
import { useInlineVideo } from '../../../hooks/useInlineVideo'
import { engagementRate, formatCount, formatMultiple, formatRate } from '../services/scoring'
import type { DiscoverResult } from '../types'

// The action icons are the DESTINATION app's dock glyph — Eye is Ad Analyzer,
// PenLine is Scripts — so the hover row reads as "where this goes" rather than
// as four anonymous circles.

interface ResultCardProps {
  result: DiscoverResult
  onAnalyze: (result: DiscoverResult) => void
  onRemix: (result: DiscoverResult) => void
  onOpen: (result: DiscoverResult) => void
  /** Which action is mid-flight, so its button shows a spinner. */
  busy?: 'analyze' | 'remix' | null
}

function ResultCardImpl({ result, onAnalyze, onRemix, onOpen, busy = null }: ResultCardProps) {
  const video = useInlineVideo()
  const hasVideo = !!result.videoUrl
  const er = result.stats ? engagementRate(result.stats) : null

  return (
    <div
      {...video.hoverProps}
      onClick={() => onOpen(result)}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.02] transition-colors hover:border-ink/15"
    >
      {/* A 4:5 frame with the vertical video LETTERBOXED inside it, not cropped
          to fill. Two reasons, and the second is the important one:
            · A true 9:16 tile is ~1.8x its own width, so barely a row and a
              half fits on screen and the grid stops being scannable.
            · object-cover would crop the top and bottom of a 9:16 frame —
              which is exactly where UGC puts its hook text and its caption.
              Cropping the hook off an ad-research tool defeats the tool. */}
      <div className="relative aspect-[4/5] overflow-hidden bg-black">
        {result.coverUrl && (
          <img
            src={result.coverUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}
        {hasVideo && (
          <video
            {...video.videoProps}
            src={result.videoUrl}
            poster={result.coverUrl}
            className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${
              video.playing ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        {/* Badge: an outlier multiple where we have one, days-running where we
            don't. Never both, and never an invented score on a Meta card. */}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
          {result.outlier && (
            <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-black shadow-sm">
              {formatMultiple(result.outlier.multiple)}
            </span>
          )}
          {result.ad?.daysRunning != null && (
            <span className="rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
              {result.ad.daysRunning}d running
            </span>
          )}
          {result.ad && !result.ad.isActive && (
            <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white/70">
              Inactive
            </span>
          )}
        </div>

        {/* Engagement rate rides the media, bottom-left, opposite the runtime.
            It answers a different question from the outlier badge above it —
            how hard the video worked the people who saw it, versus how far it
            travelled past its own audience — so the two never merge. */}
        {er !== null && (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
            ER {formatRate(er)}
          </span>
        )}

        {result.durationSeconds != null && (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
            {formatDuration(result.durationSeconds)}
          </span>
        )}

        <TileActionStack hidden={video.watching}>
          <TileActionButton
            title="Analyze Ad — opens in Ad Analyzer"
            onClick={() => onAnalyze(result)}
            disabled={busy === 'analyze' || !hasVideo}
          >
            {busy === 'analyze'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Eye className="h-3.5 w-3.5" />}
          </TileActionButton>
          <TileActionButton
            title="Remix Transcript — opens in Scripts"
            onClick={() => onRemix(result)}
            disabled={busy === 'remix'}
          >
            {busy === 'remix'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <PenLine className="h-3.5 w-3.5" />}
          </TileActionButton>
          <TileActionButton
            title="Open the original"
            onClick={() => window.open(result.postUrl, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </TileActionButton>
        </TileActionStack>

        {/* Media controls live ON the media, and are the only thing left when
            the member is actually watching with sound. */}
        {hasVideo && (
          <div className={`absolute bottom-2 left-2 flex gap-1 ${video.watching ? '' : 'opacity-0 transition-opacity group-hover:opacity-100'}`}>
            <button
              type="button"
              onClick={video.togglePlay}
              title={video.watching ? 'Pause' : 'Play with sound'}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white transition-colors hover:bg-black/70"
            >
              <Play className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={video.toggleMute}
              title={video.unmuted ? 'Mute' : 'Unmute'}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white transition-colors hover:bg-black/70"
            >
              {video.unmuted ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-2.5">
        {/* Author leads: whose video this is frames every number under it. */}
        <div className="flex items-center gap-1.5">
          {result.author.avatarUrl && (
            <img src={result.author.avatarUrl} alt="" loading="lazy" className="h-5 w-5 shrink-0 rounded-full object-cover" />
          )}
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-200">
            {result.platform === 'tiktok' ? `@${result.author.handle}` : result.author.name}
          </span>
        </div>
        {result.author.followerCount != null && (
          <span className="-mt-1.5 pl-[26px] text-[10px] text-ink-600">
            {formatCount(result.author.followerCount)} {result.platform === 'tiktok' ? 'followers' : 'likes'}
          </span>
        )}

        <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-500">
          {result.caption || 'No caption'}
        </p>

        {/* The full engagement row. Five numbers on one line only stay readable
            because each is glyph-led and they always appear in the same order,
            so the eye lands on a position rather than reading labels. */}
        {result.stats && (
          <div className="flex items-center justify-between gap-1 border-t border-ink/5 pt-2 text-[10px] text-ink-500">
            <Stat icon={Eye} value={result.stats.views} title="Views" strong />
            <Stat icon={Heart} value={result.stats.likes} title="Likes" />
            <Stat icon={MessageCircle} value={result.stats.comments} title="Comments" />
            <Stat icon={Share2} value={result.stats.shares} title="Shares" />
            <Stat icon={Bookmark} value={result.stats.saves} title="Saves" />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-[10px] text-ink-600">
          {result.ad?.ctaText
            ? <span className="truncate font-medium text-ink-400">{result.ad.ctaText}</span>
            : <span />}
          {result.createdAt > 0 && <span className="shrink-0">{relativeTime(result.createdAt)}</span>}
        </div>
      </div>
    </div>
  )
}

/** One glyph-led figure in the engagement row. */
function Stat({
  icon: Icon,
  value,
  title,
  strong = false,
}: {
  icon: ElementType
  value: number
  title: string
  strong?: boolean
}) {
  return (
    <span className={`flex items-center gap-0.5 ${strong ? 'text-ink-200' : ''}`} title={title}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="tabular-nums">{formatCount(value)}</span>
    </span>
  )
}

/** 70 → "1:10", 9 → "0:09" — the runtime shape people read on a video. */
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** "3d ago" / "2mo ago" — how old the winner is, which decides how repeatable it is. */
function relativeTime(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

// The grid runs to hundreds of cards, each with its own <video> and hover
// state, and it re-renders on every keystroke in the search field above it.
// Same reasoning as Playground's history grid.
export default memo(ResultCardImpl)
