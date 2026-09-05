import type { ReactNode } from 'react'
import { ArrowUpRight, Bookmark, BookmarkCheck, Download, Eye, ExternalLink, FileText, PenLine, RotateCw, Sparkles, X } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import { useBackdropClose } from '../../../hooks/useBackdropClose'
import { useExclusiveVideo } from '../../../hooks/useInlineVideo'
import { engagementRate, formatCount, formatMultiple, formatRate } from '../services/scoring'
import type { DiscoverAction, TranscriptState } from '../Discover'
import type { DiscoverResult } from '../types'

interface ResultDetailModalProps {
  result: DiscoverResult
  /** Starts 'idle' — a transcript costs a credit, so opening a card never
      fetches one. The Transcript block below is where it's asked for. */
  transcript: TranscriptState
  onClose: () => void
  onAnalyze: (result: DiscoverResult) => void
  /** Pulls the transcript and nothing else — it stays in this panel rather
      than bouncing to Scripts, which is Remix's job. `useAi` is the 10-credit
      fallback, only ever passed from the explicit retry below. */
  onFetchTranscript: (result: DiscoverResult, useAi?: boolean) => void
  /** Sends the words to Scripts. Never fetches — by the time this is clickable
      the transcript is already in hand and already paid for. */
  onRemix: (result: DiscoverResult, useAi?: boolean) => Promise<void>
  /** Omit to drop the Save button — the swipe file opens this on rows that are
      already filed, where "Save to Swipe File" has nothing left to say. */
  onSave?: (result: DiscoverResult) => void
  /** Saves the ad's video to the member's own disk. */
  onDownload: (result: DiscoverResult) => void
  saved?: boolean
  busy?: DiscoverAction | null
  /**
   * The media failed to load. Only ever fires for the swipe file: a search grid
   * is minutes old, but a saved row's `mediaUrl` is a signed link that has long
   * since expired, and the player erroring is the first honest evidence of it.
   */
  onMediaError?: () => void
  /** Rendered over the media column — the swipe file's "restore this" prompt. */
  mediaOverlay?: ReactNode
}

export default function ResultDetailModal({
  result,
  transcript,
  onClose,
  onAnalyze,
  onFetchTranscript,
  onRemix,
  onSave,
  onDownload,
  saved = false,
  busy = null,
  onMediaError,
  mediaOverlay,
}: ResultDetailModalProps) {
  // Called above any early return — the hook order has to be stable.
  const backdrop = useBackdropClose(onClose)
  useCloseOnEscape(true, onClose)
  useCloseOnAppSwitch(true, onClose)
  const video = useExclusiveVideo()

  const er = result.stats ? engagementRate(result.stats) : null
  const hasTranscript = transcript.phase === 'ready'
  const isTikTok = result.platform === 'tiktok'
  const isInstagram = result.platform === 'instagram'
  const isMeta = result.platform === 'meta'
  // The two platforms whose words we can buy. Meta's ad-transcript endpoint
  // reads Facebook's exposed captions, which Ad Library video ads don't carry,
  // so it came back empty every time — there the route to the script is
  // Analyze Ad, which reads the video itself.
  const canTranscribe = isTikTok || isInstagram
  // Only the figures this platform published — see DiscoverStats.
  const statCells = result.stats ? presentStats(result.stats) : []

  return (
    <div
      {...backdrop}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl overflow-hidden rounded-3xl border border-ink/10 bg-surface-1 shadow-2xl"
      >
        <div className="relative flex w-1/2 shrink-0 items-center justify-center bg-black">
          {result.videoUrl ? (
            <video
              {...video}
              // Keyed on the url so a restored link actually reloads: swapping
              // `src` on a media element the browser has already failed on is
              // not enough to make it try again.
              key={result.videoUrl}
              src={result.videoUrl}
              poster={result.coverUrl}
              onError={onMediaError}
              controls
              autoPlay
              className="max-h-[80dvh] w-full object-contain"
            />
          ) : result.coverUrl ? (
            <img
              src={result.coverUrl}
              alt=""
              onError={onMediaError}
              className="max-h-[80dvh] w-full object-contain"
            />
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-ink-600">No preview</div>
          )}
          {mediaOverlay}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[57px] shrink-0 items-center justify-between border-b border-ink/5 px-4">
            <div className="flex min-w-0 items-center gap-2">
              {result.author.avatarUrl && (
                <img src={result.author.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
              )}
              <span className="truncate text-[13px] font-medium text-ink-100">
                {/* A creator is their handle; an advertiser is its page name. */}
                {isMeta ? result.author.name : `@${result.author.handle}`}
              </span>
              {result.author.followerCount != null && (
                <span className="shrink-0 text-[11px] text-ink-600">
                  {/* Followers on the creator platforms; on Meta this field
                      carries page likes, the only audience figure the Ad
                      Library publishes at all. */}
                  {formatCount(result.author.followerCount)} {isMeta ? 'likes' : 'followers'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 text-ink-500 transition-colors hover:text-ink-200"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {result.outlier && (
                <span className="rounded-full bg-amber-400 px-2.5 py-1 text-[12px] font-semibold text-black">
                  {formatMultiple(result.outlier.multiple)} outlier
                </span>
              )}
              {er !== null && (
                <span className="rounded-full bg-ink/10 px-2.5 py-1 text-[12px] font-medium text-ink-200">
                  {formatRate(er)} engagement
                </span>
              )}
              {result.ad?.daysRunning != null && (
                <span className="rounded-full bg-ink/10 px-2.5 py-1 text-[12px] font-medium text-ink-200">
                  Running {result.ad.daysRunning} days
                </span>
              )}
              {result.ad?.platforms.map((p) => (
                <span key={p} className="rounded-full bg-ink/5 px-2.5 py-1 text-[11px] text-ink-400">
                  {p.toLowerCase()}
                </span>
              ))}
            </div>

            {/* One tile per figure the platform actually published. A cell for
                a number nobody reported would read as a zero — "0 saves" on a
                reel Instagram doesn't count saves for — so the grid narrows
                instead. */}
            {statCells.length > 0 && (
              <div className={`mt-3 grid gap-1.5 text-center ${STAT_GRID_COLS[statCells.length] ?? 'grid-cols-5'}`}>
                {statCells.map(({ label, value }) => (
                  <div key={label} className="rounded-xl bg-ink/[0.03] py-2">
                    <div className="text-[13px] font-medium tabular-nums text-ink-100">{formatCount(value)}</div>
                    <div className="text-[10px] text-ink-600">{label}</div>
                  </div>
                ))}
              </div>
            )}

            <Section label={isMeta ? 'Ad copy' : 'Caption'}>
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-300">
                {result.caption || 'No caption'}
              </p>
            </Section>

            {/* The creator platforms only. Meta's ad-transcript endpoint returns
                nothing for the ads that actually matter here — it reads
                Facebook's exposed captions, and video ads in the Ad Library
                don't carry them — so showing an empty Transcript block on every
                Meta ad was a promise the platform can't keep. On that tab the
                route to the words is Analyze Ad, which reads the video itself. */}
            {canTranscribe && (
            <Section label="Transcript">
              {/* Asked for, never assumed. Opening a card used to fetch this on
                  its own, which billed a ScrapeCreators credit for the act of
                  looking — the one thing here you do idly, thirty cards to a
                  page. The cost is on the button because it is the whole
                  reason the button exists. */}
              {transcript.phase === 'idle' && (
                <button
                  type="button"
                  onClick={() => onFetchTranscript(result)}
                  // Instagram exposes no caption track at all, so its endpoint
                  // is speech-to-text every time — there is no 1-credit tier to
                  // offer first, and no flat price published to quote. The
                  // label names what it does and what it costs in TIME, which
                  // is the part a member is about to wait through; the credits
                  // chip in the header carries the rest.
                  title={isInstagram
                    ? 'Instagram publishes no captions, so this runs speech-to-text on your ScrapeCreators key. The reel has to be under 2 minutes.'
                    : undefined}
                  className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-3 py-1.5 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5"
                >
                  {isInstagram ? <Sparkles className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                  {isInstagram ? 'Transcribe with AI — 10-30s' : 'Get transcript — 1 credit'}
                </button>
              )}
              {transcript.phase === 'loading' && (
                <p className="flex items-center gap-2 text-[12px] text-ink-500">
                  <Spinner className="h-3.5 w-3.5" />
                  {isInstagram ? 'Transcribing the audio — 10-30 seconds…' : 'Pulling the transcript…'}
                </p>
              )}
              {transcript.phase === 'ready' && (
                <p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-ink-300">
                  {transcript.text}
                </p>
              )}
              {transcript.phase === 'empty' && (isInstagram ? (
                // Instagram's answer is already the AI one, so there is no
                // better attempt to offer behind it — an empty result here
                // means nobody spoke, or the reel runs past two minutes.
                <p className="text-[12px] leading-relaxed text-ink-500">
                  No speech came back for this reel. Reels over two minutes
                  can’t be transcribed — Analyze Ad reads the video itself.
                </p>
              ) : (
                <div>
                  <p className="text-[12px] leading-relaxed text-ink-500">
                    This video has no captions to pull.
                  </p>
                  {/* Fetches through the AI path and stays here. It used to
                      call onRemix, which pulled the words AND threw you into
                      Scripts — so a button labelled "Transcribe" quietly left
                      the app. */}
                  <button
                    type="button"
                    onClick={() => onFetchTranscript(result, true)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-3 py-1.5 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Transcribe with AI — 10 credits
                  </button>
                </div>
              ))}
              {transcript.phase === 'error' && (
                <div>
                  <p className="text-[12px] leading-relaxed text-red-300 light:text-red-700">
                    {transcript.message}
                  </p>
                  <button
                    type="button"
                    onClick={() => onFetchTranscript(result)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-3 py-1.5 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    Try again
                  </button>
                </div>
              )}
            </Section>
            )}

            {result.ad?.landingUrl && (
              <a
                href={result.ad.landingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-[12px] text-ink-500 transition-colors hover:text-ink-300"
              >
                {result.ad.landingUrl.replace(/^https?:\/\//, '').slice(0, 60)}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Anything that LEAVES the app carries the arrow — the label names
              the job and the glyph says you're being taken somewhere. On Meta,
              Analyze is also the only route to the words, so it stands alone
              on the top row rather than beside a Remix that can't fire. */}
          <footer className="shrink-0 border-t border-ink/5 p-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onAnalyze(result)}
                disabled={busy === 'analyze' || !result.videoUrl}
                title={canTranscribe ? 'Opens in Ad Analyzer' : 'Reads the video itself — the way to get this ad’s script'}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-ink py-2.5 text-[13px] font-medium text-ink-900 transition-colors hover:bg-ink-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'analyze' ? <Spinner className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                Analyze Ad
                <ArrowUpRight className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />
              </button>
              {canTranscribe && (
                <button
                  type="button"
                  onClick={() => void onRemix(result)}
                  // Held back until Get transcript has actually returned words.
                  // Two reasons, and both matter: firing it on an empty
                  // transcript bounces you to Scripts with nothing in the box,
                  // and gating it here is what keeps the credit on a button the
                  // member pressed rather than on opening a card. By the time
                  // this is live the words are cached, so Remix costs nothing.
                  disabled={busy === 'remix' || !hasTranscript}
                  title={hasTranscript ? 'Opens in Scripts' : 'Get the transcript first'}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full border border-ink/10 py-2.5 text-[13px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'remix' ? <Spinner className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
                  Remix Transcript
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />
                </button>
              )}
            </div>

            <div className="mt-2 flex gap-2">
              {onSave && (
              <button
                type="button"
                onClick={() => onSave(result)}
                disabled={busy === 'save'}
                className={`flex flex-1 items-center justify-center gap-2 rounded-full border py-2.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  saved
                    ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300 light:text-emerald-700'
                    : 'border-ink/10 text-ink-200 hover:border-ink/20 hover:bg-ink/5'
                }`}
              >
                {busy === 'save'
                  ? <Spinner className="h-4 w-4" />
                  : saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                {saved ? 'Saved to Swipe File' : 'Save to Swipe File'}
              </button>
              )}
              <button
                type="button"
                onClick={() => window.open(result.postUrl, '_blank', 'noopener,noreferrer')}
                className="flex flex-1 items-center justify-center gap-2 rounded-full border border-ink/10 py-2.5 text-[13px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5"
              >
                {isTikTok ? 'Open on TikTok' : isInstagram ? 'Open on Instagram' : 'Open in Meta Ad Library'}
                <ArrowUpRight className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />
              </button>
              {/* Glyph only: the row's other two buttons carry sentences, and a
                  third label would squeeze all three past reading. */}
              <button
                type="button"
                onClick={() => onDownload(result)}
                disabled={busy === 'download' || !result.videoUrl}
                title="Download the video"
                aria-label="Download the video"
                className="flex w-11 shrink-0 items-center justify-center rounded-full border border-ink/10 py-2.5 text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'download'
                  ? <Spinner className="h-4 w-4" />
                  : <Download className="h-4 w-4" />}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}

/**
 * The figures this result actually carries, in the canonical order.
 *
 * Same rule as the card's engagement row: a platform that doesn't publish a
 * number gets no tile for it, rather than a tile reading zero.
 */
function presentStats(stats: NonNullable<DiscoverResult['stats']>) {
  return ([
    { label: 'Views', value: stats.views },
    { label: 'Likes', value: stats.likes },
    { label: 'Comments', value: stats.comments },
    { label: 'Shares', value: stats.shares },
    { label: 'Saves', value: stats.saves },
  ] as const).flatMap((cell) => (cell.value == null ? [] : [{ ...cell, value: cell.value }]))
}

/** Static class strings — Tailwind can't see a template-built column count. */
const STAT_GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
}

/**
 * A labelled block in the reading column.
 *
 * The label earns its keep on Caption vs Transcript especially: they are two
 * different pieces of text with two different jobs — what the advertiser wrote
 * versus what the creator said — and the Remix button sends only one of them.
 * Unlabelled, the pair reads as one wall of copy.
 */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-600">{label}</p>
      {children}
    </div>
  )
}
