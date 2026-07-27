import { useEffect, useRef } from 'react'

const BARS = 44
const HALF = BARS / 2
const REST = 0.06

// Which FFT bin each half of the strip reads, low to high. Speech energy is
// crowded into the bottom of the spectrum, so the bins are spread on a curve
// and lifted by `TILT` — a linear map leaves the top of the range dead flat.
const BIN_FOR = Array.from({ length: HALF }, (_, k) =>
  Math.floor(1 + Math.pow(k / (HALF - 1), 1.8) * 44),
)
const TILT = Array.from({ length: HALF }, (_, k) => 1 + (k / (HALF - 1)) * 1.9)

interface WaveformProps {
  // Live levels for the clip that's playing. Null when the Web Audio rig
  // couldn't be built (see audio.ts) — the bars then drift on their own rather
  // than sitting dead flat.
  analyser: AnalyserNode | null
  playing: boolean
  className?: string
}

// Every bar keeps its place and only changes height with the sound. The bands
// run outward from the middle — lows at the centre, highs at both edges — so
// the strip holds the fat-in-the-middle shape of a waveform instead of the
// tall-left, flat-right ramp a plain spectrum draws on a voice.
//
// Heights are written as `transform` straight onto the DOM nodes: 44 React
// re-renders a frame is exactly the work a visualiser shouldn't do.
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

    const spectrum = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    const levels = new Array<number>(HALF).fill(REST)
    let frame = 0

    const draw = () => {
      frame++
      if (spectrum && analyser) analyser.getByteFrequencyData(spectrum)

      for (let k = 0; k < HALF; k++) {
        let target: number
        if (spectrum) {
          const bin = BIN_FOR[k]
          // Average with the neighbour so one hot bin can't spike alone.
          const raw = (spectrum[bin] + spectrum[Math.min(spectrum.length - 1, bin + 1)]) / 510
          target = Math.min(1, Math.pow(raw, 0.75) * TILT[k])
        } else {
          target = 0.28 + 0.2 * Math.sin(frame * 0.07 - k * 0.35) + 0.1 * Math.sin(frame * 0.026)
        }
        // Jump to a peak, fall away from it — the asymmetry is what reads as
        // syllables rather than as a shimmer.
        const prev = levels[k]
        levels[k] = prev + (target - prev) * (target > prev ? 0.55 : 0.14)

        const height = `scaleY(${Math.max(REST, levels[k])})`
        const left = barsRef.current[HALF - 1 - k]
        const right = barsRef.current[HALF + k]
        if (left) left.style.transform = height
        if (right) right.style.transform = height
      }
      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, analyser])

  return (
    <div className={`flex h-9 items-center gap-[3px] ${className}`}>
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
