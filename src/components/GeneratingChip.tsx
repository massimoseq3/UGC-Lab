// The "still working" marker for history rows — a pulsing accent dot plus a
// label, and a matching ring for the row's thumbnail. Borrowed from the Ad
// Analyzer's history rail, which is the app's reference for a history list that
// shows queued/in-progress work rather than only finished work.
//
// Deliberately tiny and static: a history row is a list item, not a generation
// surface, so it gets a status marker rather than the full GeneratingMedia face.

type Family = 'broll' | 'voice' | 'playground' | 'influencers' | 'scripts'

// Literal per-family classes — Tailwind can't build class names from props.
const ACCENT: Record<Family, { text: string; dot: string; ring: string; wash: string }> = {
  broll: { text: 'text-broll-300', dot: 'bg-broll-400', ring: 'ring-broll-400/40', wash: 'bg-broll-500/10' },
  voice: { text: 'text-voice-300', dot: 'bg-voice-400', ring: 'ring-voice-400/40', wash: 'bg-voice-500/10' },
  playground: { text: 'text-playground-300', dot: 'bg-playground-400', ring: 'ring-playground-400/40', wash: 'bg-playground-500/10' },
  influencers: { text: 'text-influencers-300', dot: 'bg-influencers-400', ring: 'ring-influencers-400/40', wash: 'bg-influencers-500/10' },
  scripts: { text: 'text-scripts-300', dot: 'bg-scripts-400', ring: 'ring-scripts-400/40', wash: 'bg-scripts-500/10' },
}

export function GeneratingChip({ label, family = 'broll' }: { label: string; family?: Family }) {
  const a = ACCENT[family]
  return (
    <span className={`flex shrink-0 items-center gap-1 font-medium ${a.text}`}>
      <span className="relative flex h-1.5 w-1.5">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${a.dot}`} />
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${a.dot}`} />
      </span>
      {label}
    </span>
  )
}

// Overlay for a history thumbnail while its row has work in flight. `shape`
// matches what it sits on: 'circle' for a round row thumb, 'rect' for a card
// cover — which draws the ring inside, since a card cover clips its overflow
// and an outset ring would be invisible.
const SHAPE = {
  circle: 'rounded-full',
  rect: 'rounded-none ring-inset',
} as const

export function GeneratingPulseRing({
  family = 'broll',
  shape = 'circle',
}: {
  family?: Family
  shape?: keyof typeof SHAPE
}) {
  const a = ACCENT[family]
  return (
    <span className={`pointer-events-none absolute inset-0 ring-2 ${SHAPE[shape]} ${a.ring}`}>
      <span className={`absolute inset-0 animate-pulse ${shape === 'circle' ? 'rounded-full' : ''} ${a.wash}`} />
    </span>
  )
}
