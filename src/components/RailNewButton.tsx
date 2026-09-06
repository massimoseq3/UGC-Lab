import { Plus } from 'lucide-react'

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
// SINGLE click, no arm. Every caller clears an OUTPUT canvas whose contents are
// a row in the list directly underneath, so there is nothing to confirm: what
// it clears is on screen the moment it happens. Voiceovers' was the exception
// for a day — it wipes a typed script — and lost the arm in September 2026
// (Massimo's call: "there's no need to say that confirm thing"). If a caller
// ever needs the two-click promise back, that is `ClearAllButton`, not a flag
// here.
export default function RailNewButton({
  label,
  onClick,
  accentClass,
  title,
  className = '',
}: {
  label: string
  onClick: () => void
  // The fill, as a literal class — Tailwind can't build one from a prop.
  accentClass: string
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-[38px] min-w-0 items-center justify-center gap-2 rounded-full border border-white/15 px-4 text-[13px] font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] transition-all glass-fill glass-fill-soft btn-soft-shadow hover:brightness-110 ${accentClass} ${className}`}
    >
      <Plus className="h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span className="truncate">{label}</span>
    </button>
  )
}
