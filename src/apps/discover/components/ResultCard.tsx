import { memo, useState, type ElementType } from 'react'
import {
  Bookmark, BookmarkCheck, Download, Eye, ExternalLink, Heart, ImageOff, Loader2,
  MessageCircle, Pause, PenLine, Play, Share2, Volume2, VolumeX,
} from 'lucide-react'
import { TileActionStack, TileActionButton } from '../../../components/tileActions'
import { useInlineVideo } from '../../../hooks/useInlineVideo'
import { engagementRate, formatCount, formatMultiple, formatRate } from '../services/scoring'
import type { DiscoverAction } from '../Discover'
import type { DiscoverResult } from '../types'

// The action icons are the DESTINATION app's dock glyph — Eye is Ad Analyzer,
// PenLine is Scripts — so the hover row reads as "where this goes" rather than
// as four anonymous circles.

interface ResultCardProps {
  result: DiscoverResult
  onAnalyze: (result: DiscoverResult) => void
  onRemix: (result: DiscoverResult) => void
  onSave: (result: DiscoverResult) => void
  /** Saves the ad's video to the member's own disk. */
  onDownload: (result: DiscoverResult) => void
  onOpen: (result: DiscoverResult) => void
  /** Already in the swipe file — the button becomes a filled un-save. */
  saved?: boolean
  /** Which action is mid-flight, so its button shows a spinner. */
  busy?: DiscoverAction | null
}

function ResultCardImpl({ result, onAnalyze, onRemix, onSave, onDownload, onOpen, saved = false, busy = null }: ResultCardProps) {
  const video = useInlineVideo()
  const hasVideo = !!result.videoUrl
  const isMeta = result.platform === 'meta'
  const er = result.stats ? engagementRate(result.stats) : null

  // TikTok's image CDN refuses plenty of its own cover URLs from a browser, so
  // a card that has a coverUrl still can't be trusted to render one — the grid
  // came back as rows of black rectangles with a broken-image glyph in each.
  // Failing over to the video means the card shows SOMETHING either way.
  const [coverFailed, setCoverFailed] = useState(false)
  const showCover = !!result.coverUrl && !coverFailed
  /** A clip with nothing to show behind it — it has to be its own thumbnail. */
  const posterless = hasVideo && !showCover

  // Only TikTok publishes a runtime; Meta's payload carries none at all, so a
  // Meta card would never show one. The browser knows it either way once it
  // has the file's metadata, which is why every video card preloads that far
  // below — a runtime that only appears on hover isn't a thing you can scan.
  const [probedDuration, setProbedDuration] = useState<number | null>(null)
  const duration = result.durationSeconds ?? probedDuration

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
        {showCover && (
          <img
            src={result.coverUrl}
            alt=""
            loading="lazy"
            // A broken <img> doesn't just fail quietly — the browser paints its
            // own placeholder box, which is where the stray outlines around
            // every TikTok card were coming from. Drop the element entirely.
            onError={() => setCoverFailed(true)}
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}
        {hasVideo && (
          <video
            {...video.videoProps}
            // `#t=0.1` asks the browser to seek a tenth of a second in, which
            // makes it decode and PAINT that frame. Without it a poster-less
            // <video> renders as an empty black box. The fragment is always in
            // the src (it costs nothing when a cover is showing) so that a
            // cover FAILING later only flips `preload` — changing the src would
            // tear down and reload the element mid-grid.
            src={`${result.videoUrl}#t=0.1`}
            poster={showCover ? result.coverUrl : undefined}
            // 'metadata' on EVERY video card, not just the poster-less ones.
            // It costs a small range request per card, and it buys the runtime
            // pill on cards whose platform doesn't publish a duration — which
            // is every Meta ad. A card you have to hover to identify isn't
            // doing the job the grid exists for.
            preload="metadata"
            onLoadedMetadata={(e) => {
              // Infinity for a live/unseekable stream; guard rather than
              // rendering "Infinity:NaN".
              const d = e.currentTarget.duration
              if (Number.isFinite(d) && d > 0) setProbedDuration(Math.round(d))
            }}
            // A poster-less clip IS the thumbnail, so it can't fade out.
            className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-200 ${
              video.playing || posterless ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
        {/* A glyph alone on a black tile reads as the app failing to load
            something. It has to say which — Meta does publish the occasional ad
            whose creative isn't fetchable, and the honest answer is that this
            card is a link to the original rather than something gone wrong. */}
        {!hasVideo && !showCover && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
            <ImageOff className="h-6 w-6 text-white/25" strokeWidth={1.5} />
            <span className="text-[10px] leading-relaxed text-white/35">
              No preview — open the original
            </span>
          </div>
        )}

        {/* Badge: an outlier multiple where we have one, days-running where we
            don't. Never both, and never an invented score on a Meta card. */}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
          {result.outlier && (
            <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-black shadow-sm">
              {formatMultiple(result.outlier.multiple)}
            </span>
          )}
          {/* Green, not the house monochrome. On the Meta tab this is the ONLY
              performance signal there is — a long-running ad is a profitable
              one — so it has to read as a score at a glance rather than as
              another grey timestamp. Emerald matches the app's other
              "this is good" affordance (the saved/connected states). */}
          {result.ad?.daysRunning != null && (
            <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
              {result.ad.daysRunning}d running
            </span>
          )}
          {result.ad && !result.ad.isActive && (
            <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white/70">
              Inactive
            </span>
          )}
        </div>

        {/* Bottom-left column: engagement rate over the media controls.
            ER rides the media, opposite the runtime, and answers a different
            question from the outlier badge above it — how hard the video
            worked the people who saw it, versus how far it travelled past its
            own audience — so the two never merge into one figure. It stacks
            ABOVE the controls rather than sharing the corner with them:
            both used to sit at bottom-2 left-2 and only got away with it
            because the controls appeared on hover. Now that they're always on,
            that overlap would be permanent. */}
        <div className="absolute bottom-2 left-2 flex flex-col items-start gap-1.5">
          {er !== null && (
            <span className="pointer-events-none rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
              ER {formatRate(er)}
            </span>
          )}

          {/* Always visible, never hover-gated: these two buttons are how you
              tell a video card from a still one at a glance, which is most of
              what the grid is scanned for. */}
          {hasVideo && (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={video.togglePlay}
                title={video.watching ? 'Pause' : 'Play with sound'}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white transition-colors hover:bg-black/70"
              >
                {/* The glyph has to agree with the title — a Play triangle on a
                    button whose job is Pause is why pausing felt like a hunt. */}
                {video.watching ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
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

        {/* The runtime, opposite the controls. `duration` prefers what the
            platform published and falls back to what the file itself reports. */}
        {duration != null && (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
            {formatDuration(duration)}
          </span>
        )}

        {/* Deliberately NOT hidden while the clip is playing. On a generated
            media tile the picture is the point, so the stack steps aside — but
            these are research cards, and Save / Analyze / Remix are decisions
            you make WHILE watching the ad. Stepping aside meant pausing the
            video to reach the button that saves it. */}
        <TileActionStack forceVisible={saved}>
          {/* Download leads, per the canonical stack order. */}
          <TileActionButton
            title="Download the video"
            onClick={() => onDownload(result)}
            disabled={busy === 'download' || !hasVideo}
          >
            {busy === 'download'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Download className="h-3.5 w-3.5" />}
          </TileActionButton>
          {/* Save sits under it and, once filed, stays visible without a
              hover — same rule as TileStarButton: a pin you can't see isn't
              telling you anything. */}
          <TileActionButton
            title={saved ? 'Remove from swipe file' : 'Save to swipe file'}
            onClick={() => onSave(result)}
            tone={saved ? 'saved' : 'default'}
            disabled={busy === 'save'}
          >
            {busy === 'save'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : saved
                ? <BookmarkCheck className="h-3.5 w-3.5" />
                : <Bookmark className="h-3.5 w-3.5" />}
          </TileActionButton>
          <TileActionButton
            title="Analyze Ad — opens in Ad Analyzer"
            onClick={() => onAnalyze(result)}
            disabled={busy === 'analyze' || !hasVideo}
          >
            {busy === 'analyze'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Eye className="h-3.5 w-3.5" />}
          </TileActionButton>
          {/* The one-click shortcut past the modal: this pulls the transcript
              AND opens Scripts, so it does spend a credit. That's fine here —
              it's a deliberate press on a labelled button, unlike opening a
              card — but the title has to say so, since the modal's route now
              charges on its own separate "Get transcript" step. */}
          <TileActionButton
            title="Remix Transcript — 1 credit, opens in Scripts"
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
        {/* Rendered even when the count is missing, so the caption below starts
            at the same height on every card in the row. Height is per-platform
            because the two carry different things: on TikTok this is the
            creator's following — context for the outlier score above it, and
            dim on purpose — while on Meta it's page likes, the only audience
            figure the Ad Library gives at all, so it takes a pill. As dim text
            beside a dim glyph it was the easiest thing on the card to miss. */}
        <span
          className={`-mt-1.5 flex items-center gap-1 pl-[26px] ${
            isMeta ? 'h-[18px]' : 'h-[14px] text-[10px] text-ink-600'
          }`}
        >
          {result.author.followerCount != null && (
            isMeta ? (
              <span className="flex items-center gap-1 rounded-full bg-ink/[0.07] px-2 py-0.5 text-[10px] font-medium text-ink-300">
                <Heart className="h-2.5 w-2.5 shrink-0" />
                {formatCount(result.author.followerCount)} likes
              </span>
            ) : (
              <>{formatCount(result.author.followerCount)} followers</>
            )
          )}
        </span>

        {/* EXACTLY two lines tall, whatever the caption. The stats row below is
            meant to be read ACROSS the grid — comparing five numbers on four
            cards at once — which only works if it sits at the same height on
            every card. `leading-relaxed` is 1.625, so two lines is 3.25em; a
            min-height short of that (2.6em) still let a two-line caption push
            its own card 7px lower than its neighbours. */}
        <p className="line-clamp-2 h-[3.25em] overflow-hidden text-[11px] leading-relaxed text-ink-500">
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
