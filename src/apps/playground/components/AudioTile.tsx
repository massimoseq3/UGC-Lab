import { useState } from 'react'
import { ArrowLeft, Copy, Download, Music as MusicIcon, Pause, Play } from 'lucide-react'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { useAudioPlayback, type AudioPlayback } from '../../../hooks/useAudioPlayback'
import { formatClock } from '../../../utils/audioPlayback'
import { formatRelative } from '../../../utils/history'
import Waveform from '../../../components/Waveform'
import type { MusicHistoryItem } from '../../../stores/types'
import { TileActionStack, TileActionButton, TileDeleteButton } from '../../../components/tileActions'

// The played portion of the strip, in the host app's accent.
const WAVE_PLAYED = 'bg-playground-300'

/**
 * The track's artwork, doubling as its play button — the same idea as the
 * voice avatar Voiceovers plays a clip from. Click anywhere on it.
 *
 * A native `<audio controls>` lived here until September 2026: the browser's
 * own player is the one control in the app that ignores the theme entirely
 * (a light-grey slab in dark mode, its own type, its own overflow menu), and
 * it sat under every track in a panel whose other tiles are all custom chrome.
 */
export function MusicArtwork({
  coverUrl,
  instrumental,
  isPlaying,
  onToggle,
  children,
  className = 'relative aspect-square',
}: {
  coverUrl: string | null | undefined
  instrumental: boolean
  isPlaying: boolean
  onToggle: () => void
  children?: React.ReactNode
  // Placement, including its own `position` — a list row hands it
  // `absolute inset-0` to fill the row's aspect-ratio frame, so the base
  // classes below can't carry `relative` of their own.
  className?: string
}) {
  return (
    // Album art stands in for media, so it stays dark in both themes.
    <div className={`overflow-hidden bg-gradient-to-br from-fuchsia-900/30 via-zinc-900 to-black ${className}`}>
      {coverUrl ? (
        <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <MusicIcon className="h-8 w-8 text-fuchsia-300/40" strokeWidth={1.5} />
        </div>
      )}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        title={isPlaying ? 'Pause' : 'Play'}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className="absolute inset-0 flex items-center justify-center"
      >
        <span
          className={`flex h-14 w-14 items-center justify-center rounded-full border border-white/25 text-white shadow-lg transition-transform hover:scale-105 ${
            isPlaying ? 'bg-black/70' : 'bg-black/55'
          }`}
        >
          {isPlaying
            ? <Pause className="h-6 w-6 fill-current" />
            : <Play className="h-6 w-6 translate-x-px fill-current" />}
        </span>
      </button>

      {instrumental && (
        <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-zinc-200">
          Instrumental
        </span>
      )}

      {children}
    </div>
  )
}

/**
 * The waveform, collapsed until the track is playing — same rule as
 * Voiceovers' history card: a tile at rest is something you read, not
 * something you watch. The grid-rows trick animates it open without a fixed
 * height to keep in step with.
 */
export function MusicWaveStrip({ player, className = '' }: { player: AudioPlayback; className?: string }) {
  const open = player.isLoaded && (player.isPlaying || player.position > 0)
  const { duration } = player

  return (
    <div
      className={`grid transition-all duration-300 ease-out ${
        open ? 'mt-3 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'
      } ${className}`}
    >
      <div className="overflow-hidden">
        <div className="flex items-center gap-2 rounded-2xl border border-ink/[0.07] bg-ink/[0.02] px-3 py-1.5">
          <Waveform
            peaks={player.peaks}
            progress={duration > 0 ? player.position / duration : 0}
            onSeek={player.isLoaded && duration > 0 ? (f) => player.seekTo(f * duration) : undefined}
            playedClass={WAVE_PLAYED}
            className="min-w-0 flex-1"
          />
          <span className="shrink-0 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] tabular-nums text-ink-400">
            {formatClock(player.position)}
          </span>
        </div>
      </div>
    </div>
  )
}

interface AudioTileProps {
  item: MusicHistoryItem
  onDownload: () => void
  onDelete: () => void
  // Copy this track's prompt to the clipboard.
  onCopyPrompt: () => void
  // Put this track's prompt back in the prompt box, replacing what's there.
  onReuse?: () => void
}

// Music history tile: artwork that plays, then the track's name, when it was
// made and how long it runs, its prompt, and the waveform once it's playing.
// Actions ride in the standard hover column, the same place the image and video
// tiles beside it keep theirs.
export default function AudioTile({ item, onDownload, onDelete, onCopyPrompt, onReuse }: AudioTileProps) {
  const coverUrl = useAssetUrl(item.coverImageRef ?? null)
  const player = useAudioPlayback(item.audioRef, item.durationSeconds ?? 0)
  const [deleteArmed, setDeleteArmed] = useState(false)

  return (
    <div className="group overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.02] transition-colors hover:border-ink/15 hover:bg-ink/[0.04]">
      <MusicArtwork
        coverUrl={coverUrl}
        instrumental={item.instrumental}
        isPlaying={player.isPlaying}
        onToggle={player.toggle}
      >
        {/* Canonical order, minus save — music doesn't go to a bank. */}
        <TileActionStack forceVisible={deleteArmed}>
          <TileActionButton title="Download" onClick={onDownload}>
            <Download className="h-4 w-4" />
          </TileActionButton>
          {item.prompt && (
            <TileActionButton title="Copy prompt" onClick={onCopyPrompt}>
              <Copy className="h-4 w-4" />
            </TileActionButton>
          )}
          {onReuse && (
            <TileActionButton title="Reuse this prompt" onClick={onReuse}>
              <ArrowLeft className="h-4 w-4" />
            </TileActionButton>
          )}
          <TileDeleteButton onDelete={onDelete} onArmedChange={setDeleteArmed} />
        </TileActionStack>
      </MusicArtwork>

      <div className="p-3">
        <p className="truncate text-[13px] font-semibold text-ink-100" title={item.title || undefined}>
          {item.title || 'Untitled track'}
        </p>
        <p className="text-[11px] text-ink-500">
          {formatRelative(item.createdAt)}
          {player.duration > 0 && ` · ${formatClock(player.duration)}`}
        </p>
        {item.prompt && (
          <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-ink-400">{item.prompt}</p>
        )}
        <MusicWaveStrip player={player} />
      </div>
    </div>
  )
}
