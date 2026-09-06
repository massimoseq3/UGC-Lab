import { useEffect, useRef, useState } from 'react'
import { Check, Plus } from 'lucide-react'

// The primary button a history rail leads with — the Ad Analyzer's "New
// Analysis" shape, in the host app's accent.
//
// `h-[38px]` is STATED rather than left to fall out of `text-[13px]`'s line
// box, because a second surface now matches it: B-Roll's storyboard bar sits
// directly across the seam from this button and its pills are pinned to the
// same number, so the two bands read level (Massimo's call, September 2026).
// Left to the font metric it measured 37.5px here — half a pixel, and a
// different fallback face would have moved it without anything else changing.
//
// `confirm` is the two-click arm, and which callers take it is a question about
// what the press throws away. Voiceovers' clears the takes panel and nothing
// else — the run it clears is a row in the list directly underneath, so there
// is nothing to confirm and it stays a single click. Scripts' and B-Roll's now
// clear the INPUT column with the canvas (September 2026, Massimo's call): a
// pasted transcript, a brief, a picked product and character are a few minutes
// of setup that no history row holds a copy of, so those two ask first.
//
// The armed state is MONOCHROME (Massimo's call). Every other armed control in
// the app goes amber or red, which on a button whose resting state is already a
// saturated accent reads as a second accent rather than as a change of state —
// and there is nothing dangerous here to warn about, since the outputs all stay
// in History. Dropping the colour entirely is the clearest way to say "this is
// not the button you just pressed": `bg-ink text-paper` is the app's own
// inverse pair, so it flips with the theme and can't collide with any app's
// accent.
export default function RailNewButton({
  label,
  onClick,
  accentClass,
  title,
  className = '',
  confirm = false,
  confirmLabel = 'Confirm',
}: {
  label: string
  onClick: () => void
  // The fill, as a literal class — Tailwind can't build one from a prop.
  accentClass: string
  title?: string
  className?: string
  // Arm on the first click, act on the second, disarm after 3s or when the
  // pointer leaves — the same contract `ClearAllButton` carries, so a stray
  // click is always harmless.
  confirm?: boolean
  confirmLabel?: string
}) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | null>(null)

  const disarm = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
    setArmed(false)
  }

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const handleClick = () => {
    if (!confirm) { onClick(); return }
    if (armed) { disarm(); onClick(); return }
    setArmed(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { setArmed(false); timer.current = null }, 3000)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseLeave={armed ? disarm : undefined}
      title={armed ? 'Click again to clear. Everything you generated stays in History' : title}
      className={`flex h-[38px] min-w-0 items-center justify-center gap-2 rounded-full border px-4 text-[13px] font-bold tracking-tight transition-all btn-soft-shadow hover:brightness-110 ${
        armed
          ? 'border-ink/15 bg-ink text-paper'
          : `border-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] glass-fill glass-fill-soft ${accentClass}`
      } ${className}`}
    >
      {armed
        ? <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} />
        : <Plus className="h-4 w-4 shrink-0" strokeWidth={2.5} />}
      <span className="truncate">{armed ? confirmLabel : label}</span>
    </button>
  )
}
