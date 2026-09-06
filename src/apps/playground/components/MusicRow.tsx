import { useState } from 'react'
import { CornerDownLeft, Copy, Download, Music as MusicIcon, Pause, Play } from 'lucide-react'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { useAudioPlayback } from '../../../hooks/useAudioPlayback'
import { formatClock } from '../../../utils/audioPlayback'
import { formatRelative } from '../../../utils/history'
import AudioScrubber from '../../../components/AudioScrubber'
import { TileDeleteButton } from '../../../components/tileActions'
import type { MusicHistoryItem } from '../../../stores/types'

/**
 * A generated track, in the shape Voiceovers' History cards use (September
 * 2026, Massimo's call): something you press on the left, the name and when it
 * was made beside it, the prompt underneath, and the progress line opening on
 * play.
 *
 * It was a tall gradient cover tile in a four-up grid with a waveform under it.
 * Both halves cost more than they paid. The artwork is not a picture of
 * anything — it is a seeded gradient with the title written across it — so a
 * grid of music tiles was a wall of coloured rectangles carrying no information
 * you couldn't read faster in a line of text, and it pushed the prompt (the one
 * thing that says what the track IS) to the bottom of a card two thirds of the
 * way down the pane. The waveform went with it: it earns its space where you
 * scan for the drop across a long track, and these are short beds under an ad,
 * judged by pressing play. The clip's own COLOUR survives on the play disc, so
 * a track is still recognised by its artwork at a glance.
 *
 * Audio has no thumbnail, so this row is the same in the grid and the list
 * view — there is no second shape for it to take.
 */
export default function MusicRow({
  item,
  onDownload,
  onDelete,
  onCopyPrompt,
  onReuse,
}: {
  item: MusicHistoryItem
  onDownload: () => void
  onDelete: () => void
  // Copy this track's prompt to the clipboard.
  onCopyPrompt: () => void
  // Put this track's prompt back in the prompt box, replacing what's there.
  onReuse?: () => void
}) {
  const coverUrl = useAssetUrl(item.coverImageRef ?? null)
  const player = useAudioPlayback(item.audioRef, item.durationSeconds ?? 0)
  const [deleteArmed, setDeleteArmed] = useState(false)

  const duration = player.duration
  // The scrubber belongs to a clip that is actually running — it opens on the
  // first play and closes when the clip ends. Same rule as Voiceovers': a card
  // at rest is something you read, not something you watch.
  const open = player.isLoaded && (player.isPlaying || player.position > 0)

  const meta = [
    formatRelative(item.createdAt),
    duration > 0 ? formatClock(duration) : null,
    // The delivery used to be a chip on the artwork. With the artwork gone it
    // joins the line that already carries the track's other facts.
    item.instrumental ? 'Instrumental' : 'Lyrics',
  ].filter(Boolean).join(' · ')

  return (
    <div className="group rounded-2xl border border-ink/10 bg-ink/[0.02] p-3 transition-colors hover:border-ink/15 hover:bg-ink/[0.04]">
      <div className="flex items-center gap-2.5">
        {/* The cover art, at avatar size, doubling as the play button — the
            same control Voiceovers builds out of the voice's own disc. One big
            target, and the colour still says which track it is. */}
        <button
          type="button"
          onClick={player.toggle}
          title={player.isPlaying ? 'Pause' : 'Play'}
          aria-label={player.isPlaying ? 'Pause' : 'Play'}
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-white ring-2 transition-all hover:brightness-110 ${
            player.isPlaying ? 'ring-playground-400/60' : 'ring-transparent'
          }`}
        >
          {/* Artwork stands in for media, so it stays dark in both themes. */}
          <span className="absolute inset-0 bg-gradient-to-br from-fuchsia-900/60 via-zinc-900 to-black" />
          {coverUrl
            ? <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            : <MusicIcon className="absolute h-4 w-4 text-fuchsia-300/40" strokeWidth={1.5} />}
          <span className="absolute inset-0 flex items-center justify-center bg-black/40">
            {player.isPlaying
              ? <Pause className="h-3.5 w-3.5 fill-current" />
              : <Play className="h-3.5 w-3.5 translate-x-px fill-current" />}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ink-100" title={item.title || undefined}>
            {item.title || 'Untitled track'}
          </p>
          <p className="truncate text-[11px] text-ink-500">{meta}</p>
        </div>

        {/* Hover-only action cluster, in the canonical order minus save — music
            doesn't go to a bank. It stays put while the track is loaded, the
            same as Voiceovers': the row you are listening to is the row you
            reach for. */}
        <div
          className={`flex items-center gap-0.5 transition-opacity ${
            player.isLoaded || deleteArmed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 touch:opacity-100'
          }`}
        >
          <RowButton title="Download" onClick={onDownload}>
            <Download className="h-3.5 w-3.5" />
          </RowButton>
          {item.prompt && (
            <RowButton title="Copy prompt" onClick={onCopyPrompt}>
              <Copy className="h-3.5 w-3.5" />
            </RowButton>
          )}
          {onReuse && (
            <RowButton title="Reuse this prompt" onClick={onReuse}>
              <CornerDownLeft className="h-3.5 w-3.5" />
            </RowButton>
          )}
          <TileDeleteButton
            variant="chrome"
            size="sm"
            onDelete={onDelete}
            onArmedChange={setDeleteArmed}
            alwaysVisible
          />
        </div>
      </div>

      {item.prompt && (
        <p className="mt-2.5 line-clamp-2 text-[12px] leading-snug text-ink-200">{item.prompt}</p>
      )}

      {/* The progress line. The grid-rows trick animates it in and out with no
          fixed height to keep in step with. */}
      <div
        className={`grid transition-all duration-300 ease-out ${
          open ? 'mt-2.5 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="flex items-center gap-2 px-0.5 py-1">
            <span className="shrink-0 text-[10px] tabular-nums text-ink-500">{formatClock(player.position)}</span>
            <AudioScrubber
              progress={duration > 0 ? player.position / duration : 0}
              onSeek={player.isLoaded && duration > 0 ? (f) => player.seekTo(f * duration) : undefined}
              accentClass="bg-playground-400"
              className="min-w-0 flex-1"
            />
            <span className="shrink-0 text-[10px] tabular-nums text-ink-500">{formatClock(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// The row's small ghost buttons — Voiceovers' history-card size, so the two
// lists read as one control set.
function RowButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full text-ink-300 transition-colors hover:bg-ink/5 hover:text-ink-100"
    >
      {children}
    </button>
  )
}
