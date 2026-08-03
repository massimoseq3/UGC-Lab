import { memo } from 'react'
import { Eye, ExternalLink, Loader2, PenLine, Play, Volume2, VolumeX, Heart, MessageCircle } from 'lucide-react'
import { TileActionStack, TileActionButton } from '../../../components/tileActions'
import { useInlineVideo } from '../../../hooks/useInlineVideo'
import { formatCount, formatMultiple } from '../services/scoring'
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

  return (
    <div
      {...video.hoverProps}
      onClick={() => onOpen(result)}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.02] transition-colors hover:border-ink/15"
    >
      <div className="relative aspect-[9/16] overflow-hidden bg-ink/5">
        {result.coverUrl && (
          <img
            src={result.coverUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {hasVideo && (
          <video
            {...video.videoProps}
            src={result.videoUrl}
            poster={result.coverUrl}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
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

        {result.durationSeconds != null && (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
            {result.durationSeconds}s
          </span>
        )}

        <TileActionStack hidden={video.watching}>
          <TileActionButton
            title="Analyze in Ad Analyzer"
            onClick={() => onAnalyze(result)}
            disabled={busy === 'analyze' || !hasVideo}
          >
            {busy === 'analyze'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Eye className="h-3.5 w-3.5" />}
          </TileActionButton>
          <TileActionButton
            title={result.platform === 'meta' ? 'Remix this ad copy in Scripts' : 'Remix this transcript in Scripts'}
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

      <div className="flex flex-col gap-1.5 p-2.5">
        {result.stats ? (
          <div className="flex items-center gap-3 text-[11px] text-ink-400">
            <span className="font-medium text-ink-200">{formatCount(result.stats.views)} views</span>
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3" />{formatCount(result.stats.likes)}
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle className="h-3 w-3" />{formatCount(result.stats.comments)}
            </span>
          </div>
        ) : (
          result.ad?.ctaText && (
            <div className="text-[11px] font-medium text-ink-200">{result.ad.ctaText}</div>
          )
        )}

        <p className="line-clamp-2 text-[11px] leading-relaxed text-ink-500">
          {result.caption || 'No caption'}
        </p>

        <div className="flex items-center gap-1.5 text-[11px] text-ink-600">
          {result.author.avatarUrl && (
            <img src={result.author.avatarUrl} alt="" loading="lazy" className="h-4 w-4 shrink-0 rounded-full object-cover" />
          )}
          <span className="truncate">
            {result.platform === 'tiktok' ? `@${result.author.handle}` : result.author.name}
          </span>
          {result.author.followerCount != null && (
            <span className="shrink-0 text-ink-700">· {formatCount(result.author.followerCount)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// The grid runs to hundreds of cards, each with its own <video> and hover
// state, and it re-renders on every keystroke in the search field above it.
// Same reasoning as Playground's history grid.
export default memo(ResultCardImpl)
