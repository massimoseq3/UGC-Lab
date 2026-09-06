import { useEffect, useRef, useState } from 'react'
import { Check, Plus } from 'lucide-react'

interface ClearAllButtonProps {
  onClear: () => void
  className?: string
  // Idle-state label. Defaults to "Create new"; callers can shorten it (e.g.
  // "New") where horizontal space is tight.
  label?: string
  // Drop the label for a 36px circle carrying just the glyph — the same button
  // the output panels use to clear their canvas. For a header row where the
  // word is the only thing making it a pill.
  iconOnly?: boolean
}

// Shared "New" affordance: a subtle gray pill in the top-left of every
// create/tool input panel. Click once to arm ("Confirm"), click again to
// clear — an inline two-step instead of a modal, so starting fresh is two
// quick clicks in the same spot. The armed state reverts after a few seconds
// or when the pointer leaves, so a stray first click is harmless. Framed as
// "New" (not "Clear") because it clears *inputs only* — generated outputs
// stay on screen and in the history banks.
export default function ClearAllButton({ onClear, className = '', label = 'Create new', iconOnly = false }: ClearAllButtonProps) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | null>(null)

  const disarm = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
    setArmed(false)
  }

  // Clean up the auto-disarm timer if the button unmounts mid-arm.
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const handleClick = () => {
    if (armed) {
      disarm()
      onClear()
      return
    }
    setArmed(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { setArmed(false); timer.current = null }, 3000)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseLeave={armed ? disarm : undefined}
      title={armed ? 'Click again to clear inputs. Your outputs stay in history' : iconOnly ? label : undefined}
      aria-label={iconOnly ? (armed ? 'Click again to clear inputs' : label) : undefined}
      className={`flex items-center transition-colors ${
        iconOnly
          ? 'h-9 w-9 shrink-0 justify-center rounded-full border border-ink/10'
          : 'gap-1 rounded-full px-2 py-0.5 text-[10px]'
      } ${
        armed
          ? 'bg-amber-500/15 text-amber-300 light:text-amber-700 hover:bg-amber-500/25'
          : iconOnly
            ? 'bg-ink/[0.03] text-ink-300 hover:bg-ink/[0.08] hover:text-ink-100'
            : 'bg-ink/[0.03] text-ink-500 hover:bg-ink/[0.06] hover:text-ink-300'
      } ${className}`}
    >
      {armed
        ? <Check className={iconOnly ? 'h-4 w-4' : 'h-2.5 w-2.5'} strokeWidth={2.5} />
        : <Plus className={iconOnly ? 'h-4 w-4' : 'h-2.5 w-2.5'} strokeWidth={2.5} />}
      {!iconOnly && (armed ? 'Confirm' : label)}
    </button>
  )
}
