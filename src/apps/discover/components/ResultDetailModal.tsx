import type { ReactNode } from 'react'
import { ArrowUpRight, Eye, ExternalLink, Loader2, PenLine, Sparkles, X } from 'lucide-react'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import { useBackdropClose } from '../../../hooks/useBackdropClose'
import { useExclusiveVideo } from '../../../hooks/useInlineVideo'
import { engagementRate, formatCount, formatMultiple, formatRate } from '../services/scoring'
import type { TranscriptState } from '../Discover'
import type { DiscoverResult } from '../types'

interface ResultDetailModalProps {
  result: DiscoverResult
  /** Fetched by the parent when the card opens, so it's on screen by the time
      you've read the caption — and already paid for when Remix fires. */
  transcript: TranscriptState
  onClose: () => void
  onAnalyze: (result: DiscoverResult) => void
  /** `useAi` spends 10 extra credits, so it's only ever passed from the
      explicit retry below — never from the first attempt. */
  onRemix: (result: DiscoverResult, useAi?: boolean) => Promise<void>
  busy?: 'analyze' | 'remix' | 'save' | null
}

export default function ResultDetailModal({
  result,
  transcript,
  onClose,
  onAnalyze,
  onRemix,
  busy = null,
}: ResultDetailModalProps) {
  // Called above any early return — the hook order has to be stable.
  const backdrop = useBackdropClose(onClose)
  useCloseOnEscape(true, onClose)
  useCloseOnAppSwitch(true, onClose)
  const video = useExclusiveVideo()

  const er = result.stats ? engagementRate(result.stats) : null
  const hasTranscript = transcript.phase === 'ready'

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
              src={result.videoUrl}
              poster={result.coverUrl}
              controls
              autoPlay
              className="max-h-[80vh] w-full object-contain"
            />
          ) : result.coverUrl ? (
            <img src={result.coverUrl} alt="" className="max-h-[80vh] w-full object-contain" />
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-ink-600">No preview</div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[57px] shrink-0 items-center justify-between border-b border-ink/5 px-4">
            <div className="flex min-w-0 items-center gap-2">
              {result.author.avatarUrl && (
                <img src={result.author.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
              )}
              <span className="truncate text-[13px] font-medium text-ink-100">
                {result.platform === 'tiktok' ? `@${result.author.handle}` : result.author.name}
              </span>
              {result.author.followerCount != null && (
                <span className="shrink-0 text-[11px] text-ink-600">
                  {formatCount(result.author.followerCount)} {result.platform === 'tiktok' ? 'followers' : 'likes'}
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

            {result.stats && (
              <div className="mt-3 grid grid-cols-5 gap-1.5 text-center">
                {([
                  ['Views', result.stats.views],
                  ['Likes', result.stats.likes],
                  ['Comments', result.stats.comments],
                  ['Shares', result.stats.shares],
                  ['Saves', result.stats.saves],
                ] as const).map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-ink/[0.03] py-2">
                    <div className="text-[13px] font-medium tabular-nums text-ink-100">{formatCount(value)}</div>
                    <div className="text-[10px] text-ink-600">{label}</div>
                  </div>
                ))}
              </div>
            )}

            <Section label={result.platform === 'meta' ? 'Ad copy' : 'Caption'}>
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-300">
                {result.caption || 'No caption'}
              </p>
            </Section>

            {/* The spoken words, which is what Remix actually sends — shown
                here so you can read them before deciding, rather than finding
                out what you sent once you're already in Scripts. */}
            <Section label="Transcript">
              {transcript.phase === 'loading' && (
                <p className="flex items-center gap-2 text-[12px] text-ink-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Pulling the transcript…
                </p>
              )}
              {transcript.phase === 'ready' && (
                <p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-ink-300">
                  {transcript.text}
                </p>
              )}
              {transcript.phase === 'empty' && (
                <div>
                  <p className="text-[12px] leading-relaxed text-ink-500">
                    {result.platform === 'meta'
                      ? 'No captions on this ad — it may be an image, or have no speech.'
                      : 'This video has no captions to pull.'}
                  </p>
                  {result.platform === 'tiktok' && (
                    <button
                      type="button"
                      onClick={() => void onRemix(result, true)}
                      disabled={busy === 'remix'}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-3 py-1.5 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5 disabled:opacity-50"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Transcribe with AI — 10 credits
                    </button>
                  )}
                </div>
              )}
              {transcript.phase === 'error' && (
                <p className="text-[12px] leading-relaxed text-red-300 light:text-red-700">
                  {transcript.message}
                </p>
              )}
            </Section>

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

          {/* Both buttons LEAVE this app, so both carry the arrow — the label
              names the job and the glyph says you're being taken somewhere. */}
          <footer className="flex shrink-0 gap-2 border-t border-ink/5 p-4">
            <button
              type="button"
              onClick={() => onAnalyze(result)}
              disabled={busy === 'analyze' || !result.videoUrl}
              title="Opens in Ad Analyzer"
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-ink py-2.5 text-[13px] font-medium text-ink-900 transition-colors hover:bg-ink-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'analyze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Analyze Ad
              <ArrowUpRight className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={() => void onRemix(result)}
              // Held back until there are words to send: the whole point of
              // this button is the transcript, and firing it on an empty one
              // would bounce you to Scripts with nothing in the box.
              disabled={busy === 'remix' || !hasTranscript}
              title={hasTranscript ? 'Opens in Scripts' : 'No transcript to remix yet'}
              className="flex flex-1 items-center justify-center gap-2 rounded-full border border-ink/10 py-2.5 text-[13px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'remix' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
              Remix Transcript
              <ArrowUpRight className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
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
