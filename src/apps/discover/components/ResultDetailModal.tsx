import { useState } from 'react'
import { Eye, ExternalLink, Loader2, PenLine, Sparkles, X } from 'lucide-react'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import { useBackdropClose } from '../../../hooks/useBackdropClose'
import { useExclusiveVideo } from '../../../hooks/useInlineVideo'
import { formatCount, formatMultiple } from '../services/scoring'
import type { DiscoverResult } from '../types'

interface ResultDetailModalProps {
  result: DiscoverResult
  onClose: () => void
  onAnalyze: (result: DiscoverResult) => void
  /** `useAi` spends 10 extra credits, so it's only ever passed from the
      explicit retry below — never from the first attempt. */
  onRemix: (result: DiscoverResult, useAi?: boolean) => Promise<void>
  busy?: 'analyze' | 'remix' | null
}

export default function ResultDetailModal({
  result,
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

  // Set when the cheap transcript call came back empty, which is a normal
  // outcome: plenty of TikToks have no caption track at all.
  const [noCaptions, setNoCaptions] = useState(false)

  async function handleRemix(useAi: boolean) {
    setNoCaptions(false)
    try {
      await onRemix(result, useAi)
    } catch (e) {
      if (e instanceof Error && e.message === 'NO_TRANSCRIPT') setNoCaptions(true)
      // Anything else has already been toasted by the caller.
    }
  }

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
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                {([
                  ['Views', result.stats.views],
                  ['Likes', result.stats.likes],
                  ['Comments', result.stats.comments],
                  ['Shares', result.stats.shares],
                ] as const).map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-ink/[0.03] py-2">
                    <div className="text-[13px] font-medium text-ink-100">{formatCount(value)}</div>
                    <div className="text-[10px] text-ink-600">{label}</div>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-4 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-300">
              {result.caption || 'No caption'}
            </p>

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

          <footer className="shrink-0 border-t border-ink/5 p-4">
            {noCaptions && (
              <div className="mb-2.5 rounded-xl bg-ink/[0.03] p-3">
                <p className="text-[12px] leading-relaxed text-ink-400">
                  This video has no captions to pull.
                </p>
                <button
                  type="button"
                  onClick={() => handleRemix(true)}
                  disabled={busy === 'remix'}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-3 py-1.5 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5 disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Transcribe with AI — 10 credits
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onAnalyze(result)}
                disabled={busy === 'analyze' || !result.videoUrl}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-ink py-2.5 text-[13px] font-medium text-ink-900 transition-colors hover:bg-ink-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'analyze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Analyze
              </button>
              <button
                type="button"
                onClick={() => handleRemix(false)}
                disabled={busy === 'remix'}
                className="flex flex-1 items-center justify-center gap-2 rounded-full border border-ink/10 py-2.5 text-[13px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'remix' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
                {result.platform === 'meta' ? 'Remix copy' : 'Remix transcript'}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
