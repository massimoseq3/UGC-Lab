const REST = 0.06

interface WaveformProps {
  // One 0–1 peak per bar for the whole clip, or null while it's still being
  // decoded (see `waveformPeaks` in utils/audioPlayback.ts).
  peaks: number[] | null
  // How far through the clip playback is, 0–1.
  progress: number
  // Click-to-seek. Omitted while there's nothing loaded to seek.
  onSeek?: (fraction: number) => void
  // Tailwind class for the played portion — the host app's accent.
  playedClass?: string
  className?: string
}

// The whole clip, drawn once, filling left to right as it plays — the shape you
// can read before you press play, and a position you can see and click.
//
// It used to be a live spectrum analyzer: 44 bars driven by an AnalyserNode off
// the playing element. Two problems, one of them fatal. The gain staging pinned
// every bar at full height on a normally-loud voiceover, so it read as noise
// rather than as speech; and routing the element through the Web Audio graph
// meant a suspended AudioContext played the clip SILENTLY. Decoded peaks have
// neither failure mode — nothing touches the playback path.
export default function Waveform({ peaks, progress, onSeek, playedClass = 'bg-voice-300', className = '' }: WaveformProps) {
  const bars = peaks ?? []
  const played = Math.round(progress * bars.length)

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek) return
    const box = e.currentTarget.getBoundingClientRect()
    onSeek(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)))
  }

  return (
    <div
      onClick={(e) => { e.stopPropagation(); seek(e) }}
      className={`flex h-9 items-center gap-[2px] ${onSeek ? 'cursor-pointer' : ''} ${className}`}
    >
      {/* Nothing decoded yet: a flat line at rest height, same geometry, so the
          strip doesn't jump when the peaks arrive. */}
      {(bars.length > 0 ? bars : new Array(56).fill(REST)).map((peak, i) => (
        <span
          key={i}
          className={`h-full min-w-[2px] flex-1 origin-center rounded-full transition-colors duration-150 ${
            bars.length > 0 && i < played ? playedClass : 'bg-ink/15'
          }`}
          style={{ transform: `scaleY(${Math.max(REST, peak)})` }}
        />
      ))}
    </div>
  )
}
