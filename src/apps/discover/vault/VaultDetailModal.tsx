import type { ReactNode } from 'react'
import { ArrowUpRight, Download, Eye, PenLine, Star, X } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import { useBackdropClose } from '../../../hooks/useBackdropClose'
import { useExclusiveVideo } from '../../../hooks/useInlineVideo'
import { formatCount, formatMultiple } from '../services/scoring'
import { MULTIPLE_TITLE, categoryLabel, embedUrl, patternLabel } from './service'
import type { VaultAction } from './VaultCard'
import type { ResolvedVideo, VaultItem } from './types'

interface VaultDetailModalProps {
  item: VaultItem
  /** Present once the credit has been spent this session. */
  video?: ResolvedVideo
  /** The shipped cover — the fallback for a row whose url won't make an embed. */
  coverUrl: string
  starred: boolean
  /** No ScrapeCreators key means no FILE — watching and reading still work. */
  hasKey: boolean
  /** Opens the ScrapeCreators popup. Pressed from the note below the footer. */
  onNeedKey: () => void
  busy: VaultAction | null
  onClose: () => void
  onStar: (item: VaultItem) => void
  onAnalyze: (item: VaultItem) => void
  onRemix: (item: VaultItem) => void
  onDownload: (item: VaultItem) => void
}

export default function VaultDetailModal({
  item, video, coverUrl, starred, hasKey, busy,
  onClose, onStar, onAnalyze, onRemix, onDownload, onNeedKey,
}: VaultDetailModalProps) {
  // Above any early return — hook order has to be stable.
  const backdrop = useBackdropClose(onClose)
  useCloseOnEscape(true, onClose)
  useCloseOnAppSwitch(true, onClose)
  const player = useExclusiveVideo()

  const hasTranscript = !!item.transcript.trim()
  const embed = embedUrl(item)
  // Analyze and Download need a real FILE, which needs a credit, which needs a
  // key. Watching and reading need none of the three.
  const needsKey = !video && !hasKey

  return (
    <div {...backdrop} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl overflow-hidden rounded-3xl border border-ink/10 bg-surface-1 shadow-2xl"
      >
        <div className="relative flex w-1/2 shrink-0 items-center justify-center bg-black">
          {video ? (
            <video
              {...player}
              key={video.url}
              src={video.url}
              poster={video.coverUrl ?? coverUrl}
              controls
              autoPlay
              className="max-h-[80dvh] w-full object-contain"
            />
          ) : embed ? (
            // Instagram's own player, free and keyless. This used to be the
            // cover behind a "Load video — 1 credit" button, which charged a
            // member for the act of WATCHING — the one thing you do idly with
            // 872 hooks in front of you, and the surest way to train someone
            // not to look. The credit now buys only what needs an actual file
            // (Analyze, Download); everything you'd do to decide whether it's
            // worth spending is free.
            //
            // Cross-origin by nature, so we can neither autoplay it nor read
            // its media url — the member presses play inside Instagram's
            // player, and Analyze still buys its own copy. A post that has
            // been taken down renders Instagram's own "unavailable" state,
            // which explains itself better than any message we'd write.
            <iframe
              src={embed}
              title={`@${item.author} on Instagram`}
              className="h-[80dvh] w-full border-0 bg-black"
              allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
              allowFullScreen
              referrerPolicy="origin-when-cross-origin"
            />
          ) : (
            <img src={coverUrl} alt="" className="max-h-[80dvh] w-full object-contain" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[57px] shrink-0 items-center justify-between gap-2 border-b border-ink/5 px-4">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] font-medium text-ink-100">@{item.author}</span>
              {item.authorName && (
                <span className="truncate text-[11px] text-ink-600">{item.authorName}</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onStar(item)}
                aria-pressed={starred}
                title={starred ? 'Unstar' : 'Star · starred hooks filter to the top of the vault'}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  starred ? 'text-amber-400' : 'text-ink-500 hover:text-ink-200'
                }`}
              >
                <Star className={`h-4 w-4 ${starred ? 'fill-current' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center text-ink-500 transition-colors hover:text-ink-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {item.multiple != null && (
                <span
                  title={MULTIPLE_TITLE}
                  className="rounded-full bg-amber-400 px-2.5 py-1 text-[12px] font-semibold text-black"
                >
                  {formatMultiple(item.multiple)} the library median
                </span>
              )}
              {item.percentile != null && (
                <span
                  title="Where this ranks by engagement inside the library"
                  className="rounded-full bg-ink/10 px-2.5 py-1 text-[12px] font-medium text-ink-200"
                >
                  Top {Math.max(1, Math.round(100 - item.percentile))}%
                </span>
              )}
              {item.category && (
                <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[11px] text-ink-400">
                  {categoryLabel(item.category)}
                </span>
              )}
              {item.patterns.map((p) => (
                <span key={p} className="rounded-full bg-ink/5 px-2.5 py-1 text-[11px] text-ink-400">
                  {patternLabel(p)}
                </span>
              ))}
            </div>

            {/* Two cells, not the search modal's five. Instagram publishes no
                view, share or save count on a reel we harvested, and a grid
                reading zero across three of them would be an invention. */}
            <div className="mt-3 grid grid-cols-2 gap-1.5 text-center">
              {([['Likes', item.likes], ['Comments', item.comments]] as const).map(([label, value]) => (
                <div key={label} className="rounded-xl bg-ink/[0.03] py-2">
                  <div className="text-[13px] font-medium tabular-nums text-ink-100">{formatCount(value)}</div>
                  <div className="text-[10px] text-ink-600">{label}</div>
                </div>
              ))}
            </div>

            <Section label="Hook">
              <p className="text-[14px] font-medium leading-relaxed text-ink-100">
                {item.hook || 'No hook transcribed'}
              </p>
            </Section>

            {/* The transferable part. The hook is what one creator said; this is
                the shape you can say something else in, which is the whole
                reason a hook library beats a folder of links. */}
            {item.template && (
              <Section label="Reusable template">
                <p className="rounded-xl bg-ink/[0.03] px-3 py-2.5 text-[13px] leading-relaxed text-ink-300">
                  {item.template}
                </p>
              </Section>
            )}

            {item.caption && (
              <Section label="Caption">
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-500">{item.caption}</p>
              </Section>
            )}

            {/* Already here, already paid for. The search tab charges a credit
                for these words because it has to buy them from the platform;
                the vault transcribed every row when it was built. */}
            <Section label="Transcript">
              {hasTranscript ? (
                <p className="max-h-52 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-ink-300">
                  {item.transcript}
                </p>
              ) : (
                <p className="text-[12px] leading-relaxed text-ink-500">
                  This reel has no spoken words. It ran on music and on-screen text.
                </p>
              )}
            </Section>
          </div>

          <footer className="shrink-0 border-t border-ink/5 p-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onAnalyze(item)}
                // Deliberately NOT disabled when the key is missing. A greyed
                // primary button with a tooltip is how a member ends up asking
                // why they can't click it; pressing this opens the key popup,
                // so the button answers its own question.
                disabled={busy != null}
                title={needsKey
                  ? 'Needs a ScrapeCreators key to fetch the video. Press to connect one'
                  : video ? 'Opens in Ad Analyzer' : 'Fetches the video (1 credit), then opens in Ad Analyzer'}
                // The app's SEND-TO-ANOTHER-APP shape, not its primary-button
                // shape: a tinted accent wash rather than a solid fill
                // (`border-500/20 bg-500/10 text-accent`, 12px). Every existing
                // handoff wears it — Scripts → Voiceovers / B-Roll /
                // Playground, Ad Analyzer → Scripts — because a solid fill is
                // what an app's OWN primary action looks like, and these two
                // leave. A literal since Ad Analyzer has no Tailwind family.
                className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full border border-[#FF5257]/20 bg-[#FF5257]/10 px-4 py-2.5 text-[12px] font-medium tracking-tight text-[#FF5257] transition-colors hover:bg-[#FF5257]/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'analyze' ? <Spinner className="h-4 w-4" /> : <Eye className="h-4 w-4" strokeWidth={1.75} />}
                Analyze Ad
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => onRemix(item)}
                disabled={!hasTranscript}
                title={hasTranscript ? 'Opens in Scripts · free, the words are already here' : 'This reel has no spoken words'}
                // Character-for-character the button Ad Analyzer already uses
                // to send ITS transcript to Scripts — same destination, same
                // job, so there was no reason to invent a second look for it.
                className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full border border-scripts-500/20 bg-scripts-500/10 px-4 py-2.5 text-[12px] font-medium tracking-tight text-scripts-text transition-colors hover:bg-scripts-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PenLine className="h-4 w-4" strokeWidth={1.75} />
                Remix Transcript
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
                className="flex flex-1 items-center justify-center gap-2 rounded-full border border-ink/10 py-2.5 text-[13px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5"
              >
                Open on Instagram
                <ArrowUpRight className="h-3.5 w-3.5 opacity-60" strokeWidth={2.5} />
              </button>
              {/* Glyph only: the row's other button carries a sentence, and a
                  second label would squeeze both past reading. */}
              <button
                type="button"
                onClick={() => onDownload(item)}
                disabled={busy != null}
                title={needsKey
                  ? 'Needs a ScrapeCreators key to fetch the video. Press to connect one'
                  : video ? 'Download the video' : 'Download the video · 1 credit to fetch it from Instagram'}
                aria-label="Download the video"
                className="flex w-11 shrink-0 items-center justify-center rounded-full border border-ink/10 py-2.5 text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'download' ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              </button>
            </div>

            {/* Visible before the press, not just in a tooltip after it. Only
                Analyze and Download are affected — watching the reel above and
                remixing its transcript are both free and both still work — so
                the line names those two rather than implying the card is
                locked. */}
            {needsKey && (
              <p className="mt-2.5 text-center text-[11px] leading-relaxed text-ink-600">
                Analyze and Download fetch the video from Instagram, which needs a{' '}
                <button
                  type="button"
                  onClick={onNeedKey}
                  className="font-medium text-ink-300 underline underline-offset-2 transition-colors hover:text-ink-100"
                >
                  ScrapeCreators key
                </button>
                . Watching and remixing are free.
              </p>
            )}
          </footer>
        </div>
      </div>
    </div>
  )
}

/** A labelled block in the reading column — same shape as the search modal's. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-600">{label}</p>
      {children}
    </div>
  )
}
