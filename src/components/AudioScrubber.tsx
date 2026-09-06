import { useRef, useState } from 'react'

// The one progress line for a playing clip: a 6px track, the played portion in
// the host accent, and a thumb that shows while you are on it.
//
// Lifted out of Voiceovers' `BottomPlayer` when its History cards dropped their
// waveform for the same line (September 2026, Massimo's call). A waveform is
// worth its space on a music track, where you scan for the drop; on a
// six-second read it is decoration over the one thing you actually want from a
// player, which is where you are in it — and a card and the player under it
// showing the same clip two different ways read as two different controls.
//
// **Drag as well as click, and the pointer capture is what makes it usable.**
// The track can be a ~150px sliver in a row full of buttons, and without
// capture the drag dies the moment the pointer leaves it. Captured, the pointer
// keeps reporting here wherever it travels, including outside the window.
export default function AudioScrubber({
  progress,
  onSeek,
  accentClass = 'bg-voice-500',
  className = '',
}: {
  // 0–1. Clamped here, so a caller mid-load can hand over anything.
  progress: number
  // Fraction of the clip to jump to, or undefined for a track that can't be
  // seeked yet (nothing loaded) — it still draws, it just doesn't take the press.
  onSeek?: (fraction: number) => void
  // The played fill and thumb. A literal class: Tailwind can't build one from a
  // prop, and the ink ramp is wrong here — `ink-100` is near-black in light
  // mode, which reads as a dead bar beside the accent-filled play button.
  accentClass?: string
  className?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [scrubbing, setScrubbing] = useState(false)

  const pct = Math.max(0, Math.min(1, progress || 0)) * 100

  // One code path for the press and every move of a drag, so a click and a
  // scrub can't disagree.
  const seekToClientX = (clientX: number) => {
    if (!onSeek || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)))
  }

  return (
    <div
      ref={trackRef}
      onPointerDown={(e) => {
        if (!onSeek) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        setScrubbing(true)
        seekToClientX(e.clientX)
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        seekToClientX(e.clientX)
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        setScrubbing(false)
      }}
      onPointerCancel={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        setScrubbing(false)
      }}
      // The bar is 6px; the grab area is the `py-2` around it, held off the
      // row's height by `-my-2`. A hit target the height of the line itself is
      // a click you have to aim and a drag you can't start. `mx-1` is the
      // thumb's overhang — it is `-translate-x-1/2`, so at 0:00 half of it sits
      // outside the track, and on a touch screen it is permanently visible.
      className={`group relative mx-1 -my-2 flex touch-none items-center py-2 ${
        onSeek ? 'cursor-pointer' : ''
      } ${className}`}
    >
      <div className="relative h-1.5 w-full rounded-full bg-ink/[0.08]">
        <div className={`absolute inset-y-0 left-0 rounded-full ${accentClass}`} style={{ width: `${pct}%` }} />
        <div
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow transition-opacity group-hover:opacity-100 touch:opacity-100 ${accentClass} ${
            scrubbing ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  )
}
