import { useLayoutEffect, useRef, useState } from 'react'
import type { ElementType, ReactNode } from 'react'

export interface SegmentedToggleOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ElementType
  // Small count chip rendered after the label (e.g. history length).
  badge?: ReactNode
}

interface SegmentedToggleProps<T extends string> {
  options: Array<SegmentedToggleOption<T>>
  value: T
  onChange: (value: T) => void
  className?: string
  // Default: fills its column with equal-width segments. When true, the
  // control shrinks to its content (segments sized to their labels) so it
  // doesn't stretch across the full width.
  fitContent?: boolean
  // Slimmer padding + smaller icons, sized to sit inline with compact rows
  // (e.g. the sidebar). Keeps the same sliding-indicator animation.
  dense?: boolean
  // Accent for the active pill. Default 'ink' is the neutral house fill; the app
  // families ('scripts', 'influencers') are glassy accent tints — a translucent
  // fill + soft accent edge + faint sheen — keyed to the app's own colour.
  accent?: SegmentedAccent
}

// 'products' maps to the gold family (deep purple #4C1D95, the product accent);
// 'voice'/'broll' map to their app families. Keyed by intent, not family name.
export type SegmentedAccent = 'ink' | 'scripts' | 'influencers' | 'products' | 'voice' | 'broll' | 'playground'

// Active-pill fill + the active label color that reads on top of it. Literal
// class strings (Tailwind can't build names from props at runtime).
const ACCENT_INDICATOR: Record<SegmentedAccent, string> = {
  ink: 'bg-ink/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] light:shadow-none',
  // Translucent accent fill + a soft (not harsh) accent edge + a faint top
  // sheen, so the pill reads glassy rather than as a solid block or hard outline.
  scripts: 'bg-scripts-500/10 ring-1 ring-inset ring-scripts-500/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
  influencers: 'bg-influencers-500/10 ring-1 ring-inset ring-influencers-500/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
  products: 'bg-gold-500/10 ring-1 ring-inset ring-gold-500/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
  voice: 'bg-voice-500/10 ring-1 ring-inset ring-voice-500/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
  broll: 'bg-broll-500/10 ring-1 ring-inset ring-broll-500/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
  playground: 'bg-playground-500/10 ring-1 ring-inset ring-playground-500/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
}
const ACCENT_ACTIVE_TEXT: Record<SegmentedAccent, string> = {
  ink: 'text-ink-100',
  // Active label + icon use the dedicated scripts-text token: a light steel
  // blue (#8FA6CE) on dark, the navy (#2C4A78) in light.
  scripts: 'text-scripts-text',
  influencers: 'text-influencers-300',
  products: 'text-gold-300',
  voice: 'text-voice-300',
  broll: 'text-broll-300',
  playground: 'text-playground-300',
}

// Rounded pill segmented control — the house replacement for the old
// underline tab strips. Fills its column, segments share the width equally,
// and the active pill slides between segments (measured indicator, 200 ms).
export default function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  className = '',
  fitContent = false,
  dense = false,
  accent = 'ink',
}: SegmentedToggleProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRefs = useRef<Map<T, HTMLButtonElement | null>>(new Map())
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  // Re-measured every render (badge counts change segment widths) and on
  // container resize; setState is guarded so it only commits real moves.
  useLayoutEffect(() => {
    const measure = () => {
      const btn = buttonRefs.current.get(value)
      if (!btn) return
      setIndicator((prev) =>
        prev && prev.left === btn.offsetLeft && prev.width === btn.offsetWidth
          ? prev
          : { left: btn.offsetLeft, width: btn.offsetWidth },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  })

  return (
    <div
      ref={containerRef}
      className={`relative ${fitContent ? 'inline-flex w-auto' : 'flex w-full'} items-center gap-0.5 rounded-full border border-ink/10 bg-ink/[0.03] ${dense ? 'p-1' : 'p-1.5'} ${className}`}
    >
      {indicator && (
        <div
          aria-hidden
          className={`absolute bottom-1 top-1 rounded-full ${ACCENT_INDICATOR[accent]} transition-[left,width] duration-200 ease-out`}
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
      {options.map((opt) => {
        const active = opt.value === value
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            ref={(el) => { buttonRefs.current.set(opt.value, el) }}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`relative z-[1] flex min-w-0 ${fitContent ? '' : 'flex-1'} items-center justify-center rounded-full font-medium tracking-tight transition-colors duration-200 ${
              dense ? 'gap-1.5 px-3 py-1 text-[12px]' : 'gap-2 px-4 py-2.5 text-[13px]'
            } ${
              active ? ACCENT_ACTIVE_TEXT[accent] : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            {Icon && <Icon className={`${dense ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0`} />}
            {opt.label !== '' && opt.label != null && <span className="truncate">{opt.label}</span>}
            {opt.badge != null && (
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums transition-colors duration-200 ${
                  active ? 'bg-ink/10 text-ink-300' : 'bg-ink/[0.04] text-ink-500'
                }`}
              >
                {opt.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
