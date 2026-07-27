import { useEffect, useRef } from 'react'

const BARS = 44
const REST = 0.06
// Sample every other frame — ~30 readings a second, so the 44 bars hold about
// a second and a half of the voice. Faster and the bars blur; slower and the
// strip lags behind what you're hearing.
const FRAMES_PER_SAMPLE = 2

interface WaveformProps {
  // Live levels for the clip that's playing. Null when the Web Audio rig
  // couldn't be built (see audio.ts) — the bars then drift on their own rather
  // than sitting dead flat.
  analyser: AnalyserNode | null
  playing: boolean
  className?: string
}

// A scrolling amplitude envelope: each frame reads how loud the voice is right
// now, pushes it onto the right edge and shifts the rest left, so the strip
// draws the take as it plays. A frequency spectrum was tried first and read
// wrong — speech piles its energy into the low bins, so the left of the strip
// was always tall and the right always flat, whatever was being said.
//
// The bars are driven by writing `transform` straight onto the DOM nodes — 44
// React re-renders a frame is exactly the work a visualiser shouldn't do.
export default function Waveform({ analyser, playing, className = '' }: WaveformProps) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([])
  const rafRef = useRef(0)

  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current)
      // The bars carry a CSS transition while stopped, so this eases them down.
      barsRef.current.forEach((el) => { if (el) el.style.transform = `scaleY(${REST})` })
      return
    }

    const samples = analyser ? new Uint8Array(analyser.fftSize) : null
    const levels = new Array<number>(BARS).fill(REST)
    let frame = 0

    const draw = () => {
      frame++
      if (frame % FRAMES_PER_SAMPLE === 0) {
        let level: number
        if (samples && analyser) {
          analyser.getByteTimeDomainData(samples)
          let sum = 0
          for (let i = 0; i < samples.length; i++) {
            const v = (samples[i] - 128) / 128
            sum += v * v
          }
          // RMS is quiet even on a loud take; the curve lifts normal speech
          // into the top half of the strip without pinning it there.
          level = Math.min(1, Math.pow(Math.sqrt(sum / samples.length) * 2.8, 0.7))
        } else {
          level = 0.3 + 0.2 * Math.sin(frame * 0.09) + 0.12 * Math.sin(frame * 0.031)
        }

        levels.shift()
        levels.push(Math.max(REST, level))
        for (let i = 0; i < BARS; i++) {
          const el = barsRef.current[i]
          if (el) el.style.transform = `scaleY(${levels[i]})`
        }
      }
      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, analyser])

  return (
    <div
      className={`flex h-9 items-center gap-[3px] ${className}`}
      // Fade the oldest bars out so the envelope reads as streaming in from the
      // right rather than as a fixed chart that happens to wobble.
      style={{ maskImage: 'linear-gradient(to right, transparent, black 18%)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 18%)' }}
    >
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => { barsRef.current[i] = el }}
          className={`h-full flex-1 origin-center rounded-full bg-voice-300 ${
            playing ? '' : 'transition-transform duration-500'
          }`}
          style={{ transform: `scaleY(${REST})` }}
        />
      ))}
    </div>
  )
}
