import { useId } from 'react'
import { DISPLAY_FONT } from './Widget'

// The desktop's signature widget: a closing ring, Fitness-style, where the arc
// is the current streak measured against the member's own best. It encodes
// something true — you are chasing your record, and the ring completes the day
// you match it — which is why the number and the arc can share one tile without
// either being decoration.
//
// Before there's a record to chase, the ring's target is a week: the first
// streak needs a finish line too, and seven days is the one the app implies.

const SIZE = 96
const STROKE = 8
// Breathing room for the glow. A filter's output is clipped twice — by the
// element's own filter region and by the SVG viewport — and either clip lands
// as a hard square edge around the ring. The viewport is padded here; the
// regions are declared explicitly below.
const PAD = 16
const BOX = SIZE + PAD * 2
const R = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * R
const FIRST_TARGET = 7

export default function StreakRing({ current, best }: { current: number; best: number }) {
  const uid = useId()
  const arcGlow = `streak-arc-glow-${uid}`
  const headGlow = `streak-head-glow-${uid}`
  const target = Math.max(best, FIRST_TARGET)
  const progress = target > 0 ? Math.min(1, current / target) : 0
  const record = current > 0 && current >= best

  // Today rides at the head of the arc, like a body at its point in orbit.
  // Angle starts at twelve o'clock and sweeps clockwise, matching the arc's
  // own -90° rotation.
  const angle = progress * 2 * Math.PI - Math.PI / 2
  const head = { x: SIZE / 2 + R * Math.cos(angle), y: SIZE / 2 + R * Math.sin(angle) }

  return (
    <div className="relative flex items-center justify-center" style={{ width: SIZE, height: SIZE }}>
      <svg
        width={BOX}
        height={BOX}
        viewBox={`${-PAD} ${-PAD} ${BOX} ${BOX}`}
        className="absolute -rotate-90"
        style={{ left: -PAD, top: -PAD }}
      >
        <defs>
          {/* Regions are generous on purpose: the default (bbox + 10%) cuts a
              blurred glow off mid-falloff, which reads as a square block. */}
          <filter id={arcGlow} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#059669" floodOpacity="0.55" />
          </filter>
          <filter id={headGlow} x="-400%" y="-400%" width="900%" height="900%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#059669" floodOpacity="0.9" />
          </filter>
        </defs>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-ink/[0.08] light:stroke-black/[0.07]"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          filter={record ? `url(#${arcGlow})` : undefined}
          className="stroke-dashboard-500 transition-[stroke-dashoffset] duration-700 ease-out"
        />
        {current > 0 && (
          <circle cx={head.x} cy={head.y} r={3.5} filter={`url(#${headGlow})`} className="fill-dashboard-300" />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="text-[34px] italic font-normal leading-none tracking-tight text-ink-50" style={DISPLAY_FONT}>
          {current}
        </span>
      </span>
    </div>
  )
}
