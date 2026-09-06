import { useState, useEffect } from 'react'

interface GenerationProgressProps {
  isActive: boolean
  color?: string
  messages?: string[]
  className?: string
  // Show the static "You can keep working — we'll save this when it's done."
  // helper line. Defaults to true (matches B-Roll Images' framing). Tight
  // surfaces like the Playground in-flight tile pass false to reduce clutter.
  showHelper?: boolean
  // Override the rotating status line's type size AND tint (it replaces the
  // default outright, so a caller passing this must include its own text color).
  // In-flight media tiles pass the same size + accent as their model label.
  messageClassName?: string
  // Optional named phase for multi-stage jobs, e.g. {step: 1, of: 2, label:
  // 'logging every cut'} → "Pass 1 of 2 — logging every cut". Borrowed from the
  // Ad Analyzer's analyzing pane: on a job with real stages, knowing WHICH
  // stage you're in is far more reassuring than a rotating status line alone.
  // Omit it for single-stage generations.
  phase?: { step: number; of: number; label?: string; noun?: string }
}

const DEFAULT_MESSAGES = ['Preparing...', 'Sending request...', 'Processing...', 'Almost done...']

// The phase line is tinted with the app accent to match the bar, so callers
// don't have to pass the same accent twice. Spelled out as literals rather than
// built from `color` — Tailwind only emits classes it can find as whole strings
// in the source, so `text-${...}` would compile to nothing.
const PHASE_TEXT: Record<string, string> = {
  'bg-broll-500': 'text-broll-300',
  'bg-influencers-500': 'text-influencers-300',
  'bg-playground-500': 'text-playground-300',
  'bg-scripts-500': 'text-scripts-text',
  'bg-voice-500': 'text-voice-300',
  'bg-green-500': 'text-green-400',
}

function accentTextClass(color: string): string {
  return PHASE_TEXT[color] ?? 'text-ink-400'
}
const ROTATE_MS = 4000

// Indeterminate generation indicator. No percentage, no elapsed counter —
// both produce anxiety. A shimmer band conveys "alive", a rotating status
// line suggests "real work is happening", and the static expectation line
// keeps users from refreshing the tab mid-job (which cancels the kie task).
export default function GenerationProgress({
  isActive,
  color = 'bg-sky-500',
  messages,
  className = '',
  showHelper = true,
  messageClassName = 'text-xs text-ink-300',
  phase,
}: GenerationProgressProps) {
  const msgs = messages && messages.length > 0 ? messages : DEFAULT_MESSAGES
  const [index, setIndex] = useState(0)

  // Reset the rotating message to the first line whenever a new generation
  // starts. Done during render (React's "adjust state on prop change" pattern)
  // rather than in an effect, so it doesn't trigger a cascading re-render.
  const [prevActive, setPrevActive] = useState(isActive)
  if (isActive !== prevActive) {
    setPrevActive(isActive)
    setIndex(0)
  }

  useEffect(() => {
    if (!isActive) return
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % msgs.length)
    }, ROTATE_MS)
    return () => clearInterval(id)
  }, [isActive, msgs.length])

  if (!isActive) return null

  return (
    <div className={`w-full ${className}`}>
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-ink/10">
        <div className={`shimmer-band absolute inset-y-0 left-0 w-1/2 ${color} animate-shimmer-sweep`} />
      </div>
      {phase && (
        <p className={`mt-2 text-[11px] font-medium uppercase tracking-widest ${accentTextClass(color)}`}>
          {phase.noun ?? 'Step'} {phase.step} of {phase.of}
          {phase.label ? ` · ${phase.label}` : ''}
        </p>
      )}
      <div className={`${phase ? 'mt-1' : showHelper ? 'mt-2' : 'mt-1.5'} space-y-0.5`}>
        {/* When the helper line is shown, reserve 2 lines for the rotating
            message so the layout doesn't jump on long-message wraps. When
            it's hidden (Scripts / B-Roll prompt-gen), tighten to 1 line so
            there's no awkward gap between the bar and the content below. */}
        <p className={`${showHelper ? 'min-h-[2.25rem]' : ''} ${messageClassName} leading-snug`}>{msgs[index]}</p>
        {showHelper && (
          <p className="text-[11px] text-ink-600">This can take a couple of minutes. Keep this tab open.</p>
        )}
      </div>
    </div>
  )
}
