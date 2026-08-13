import { Minus, Plus } from 'lucide-react'
import { formatCredits } from '../utils/models'
import { MAX_BATCH_COUNT, clampBatchCount } from '../utils/batchCount'

// Tint applied once the count leaves 1, so a batch armed on one surface is
// visible without reading the number — the same idiom Playground's audio pill
// uses. Literal class strings so Tailwind's scanner sees them.
const ACCENT_ON: Record<string, string> = {
  influencers: 'border-influencers-500/30 bg-influencers-500/10 text-influencers-200',
  playground: 'border-playground-500/30 bg-playground-500/10 text-playground-200',
  broll: 'border-broll-500/30 bg-broll-500/10 text-broll-200',
  voice: 'border-voice-500/30 bg-voice-500/10 text-voice-200',
}

// Outer pill heights match ConstraintChip exactly, so the stepper sits in a
// chip row as one of them rather than as a control of its own kind.
const SIZE: Record<string, { pill: string; btn: string; text: string }> = {
  xl: { pill: 'h-[58px] px-1.5', btn: 'h-9 w-9', text: 'text-[13px]' },
  lg: { pill: 'h-12 px-1.5', btn: 'h-8 w-8', text: 'text-[13px]' },
  md: { pill: 'h-10 px-1', btn: 'h-7 w-7', text: 'text-[12px]' },
  sm: { pill: 'h-9 px-1', btn: 'h-6 w-6', text: 'text-[13px]' },
}

// How many outputs one press of Generate produces, as a −/+ stepper.
//
// A count is a scalar you nudge, so it takes a nudge control rather than a
// menu. The cost of that choice is that the ladder can't price its own rungs
// the way the resolution menu does — so the run's total rides on the Generate
// button beside it (every caller multiplies), and the pill's tooltip spells
// out what the armed count costs.
export default function BatchCountStepper({
  value,
  onChange,
  max = MAX_BATCH_COUNT,
  noun,
  label,
  accent,
  size = 'lg',
  grow = false,
  creditsFor,
}: {
  value: number
  onChange: (next: number) => void
  max?: number
  // Singular noun for the tooltip and the button labels ("image" → "2 images").
  noun: string
  // Optional dim word inside the pill, for a count whose number alone wouldn't
  // say what it counts (a row that isn't obviously a generate bar).
  label?: string
  accent: keyof typeof ACCENT_ON
  size?: 'sm' | 'md' | 'lg' | 'xl'
  grow?: boolean
  // Total credits for a run of n. Callers without a price omit it — an unknown
  // cost is never invented.
  creditsFor?: (n: number) => number | null
}) {
  const ceiling = Math.max(1, max)
  const count = clampBatchCount(value, ceiling)
  const s = SIZE[size] ?? SIZE.lg
  const credits = creditsFor ? formatCredits(creditsFor(count)) : null
  const nounPlural = `${noun}${count === 1 ? '' : 's'}`

  const step = (delta: number) => onChange(clampBatchCount(count + delta, ceiling))

  return (
    <div
      title={`${count} ${nounPlural} per press${credits ? ` · ${credits}` : ''}`}
      className={`flex items-center justify-between gap-1 rounded-full border transition-colors ${s.pill} ${
        grow ? 'min-w-0 flex-1' : ''
      } ${count > 1 ? ACCENT_ON[accent] : 'border-ink/10 bg-ink/[0.02] text-ink-300'}`}
    >
      <StepButton
        icon={Minus}
        className={s.btn}
        disabled={count <= 1}
        label={`One fewer ${noun}`}
        onClick={() => step(-1)}
      />
      <span className={`flex min-w-0 items-center justify-center gap-1.5 px-1 tabular-nums ${s.text}`}>
        {label && <span className="truncate text-[11px] text-ink-500">{label}</span>}
        {count}
      </span>
      <StepButton
        icon={Plus}
        className={s.btn}
        disabled={count >= ceiling}
        label={`One more ${noun}`}
        onClick={() => step(1)}
      />
    </div>
  )
}

function StepButton({
  icon: Icon,
  className,
  disabled,
  label,
  onClick,
}: {
  icon: React.ElementType
  className: string
  disabled: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex shrink-0 items-center justify-center rounded-full transition-colors hover:bg-ink/[0.08] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ${className}`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
    </button>
  )
}
