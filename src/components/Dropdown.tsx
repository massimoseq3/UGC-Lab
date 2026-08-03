import { useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import AnchoredPopover from './video/AnchoredPopover'

// Per-app accent for the open-state border and the selected row. Explicit class
// strings (not template interpolation) so Tailwind sees them.
const ACCENTS = {
  voice: { border: 'border-voice-500/40', selected: 'bg-voice-500/15', check: 'text-voice-300' },
  scripts: { border: 'border-scripts-500/40', selected: 'bg-scripts-500/15', check: 'text-scripts-text' },
  broll: { border: 'border-broll-500/40', selected: 'bg-broll-500/15', check: 'text-broll-300' },
  // For chrome that belongs to no app accent — Outliers' filter row sits above
  // a results grid, alongside a monochrome search field and Search button.
  neutral: { border: 'border-ink/25', selected: 'bg-ink/10', check: 'text-ink-200' },
} as const

export type DropdownAccent = keyof typeof ACCENTS

/**
 * A value that is its own label, or a value/label pair for a control whose
 * stored value is a code ('US', 'VIDEO') rather than the words on screen.
 */
export type DropdownOption = string | { value: string; label: string }

interface DropdownProps {
  value: string
  options: readonly DropdownOption[]
  onChange: (value: string) => void
  // Compact trigger (smaller padding) for side-by-side rows.
  compact?: boolean
  accent?: DropdownAccent
  // Optional dim label inside the trigger, left of the value — for a control
  // whose value alone ("3", "30s") doesn't say what it sets.
  label?: string
  // 'above' pins the menu upward regardless of viewport room — for a trigger
  // sitting just above a Generate button, where a downward menu covers it.
  placement?: 'auto' | 'above'
  // Shrinks the trigger to its own content, for a wrapping row of filters
  // rather than a settings panel's full-width stack.
  fitContent?: boolean
  className?: string
}

// A rounded-full select whose menu is portaled via AnchoredPopover, so it
// escapes a scrolling panel's `overflow-y-auto` clip and flips above the
// trigger when it's near the bottom edge. Replaces the native <select>, whose
// menu used the browser's default (unstyled) popup.
//
// Lives in components/ rather than voice-studio/ because Scripts pairs two of
// these above its Generate button; one copy, two accents.
export default function Dropdown({
  value,
  options,
  onChange,
  compact,
  accent = 'voice',
  label,
  placement = 'auto',
  fitContent = false,
  className = '',
}: DropdownProps) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [width, setWidth] = useState(0)
  const tone = ACCENTS[accent]

  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  // Falls back to the raw value so a persisted pick with no matching option
  // still renders something rather than an empty trigger.
  const current = items.find((o) => o.value === value)?.label ?? value

  const toggle = () => {
    if (open) { setOpen(false); return }
    // A fit-content trigger can be narrower than its own longest option
    // ("Match: Broad" against "Exact phrase"), so the menu takes a floor.
    const measured = anchorRef.current?.offsetWidth ?? 0
    setWidth(fitContent ? Math.max(measured, 168) : measured)
    setOpen(true)
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={toggle}
        // 13px, matching the Preset and Voice rows in Voiceovers — every trigger
        // in a settings panel reads at one size.
        className={`flex ${fitContent ? 'w-auto' : 'w-full'} items-center justify-between gap-2 rounded-full border bg-ink/[0.03] text-left text-[13px] font-medium text-ink-100 outline-none transition-colors hover:bg-ink/[0.06] ${
          open ? tone.border : 'border-ink/10'
        } ${compact ? 'px-3 py-2' : 'px-3.5 py-2.5'} ${className}`}
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          {label && <span className="shrink-0 text-[11px] font-normal text-ink-600">{label}</span>}
          <span className="truncate">{current}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnchoredPopover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        width={width}
        estimatedHeight={Math.min(options.length * 38 + 8, 280)}
        placement={placement}
      >
        <div className="max-h-[280px] overflow-y-auto rounded-2xl border border-ink/10 bg-surface-2 p-1 shadow-xl shadow-black/20">
          {items.map((o) => {
            const selected = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`flex w-full items-center justify-between gap-2 rounded-full px-3 py-2 text-left text-sm transition-colors ${
                  selected ? `${tone.selected} text-ink-50` : 'text-ink-200 hover:bg-ink/[0.06]'
                }`}
              >
                <span className="truncate">{o.label}</span>
                {selected && <Check className={`h-3.5 w-3.5 shrink-0 ${tone.check}`} />}
              </button>
            )
          })}
        </div>
      </AnchoredPopover>
    </>
  )
}
