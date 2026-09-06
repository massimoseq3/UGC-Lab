import type { LucideIcon } from 'lucide-react'

// The one "drop it anywhere on this surface" overlay: a full-bleed dashed
// frame with a light accent tint over the panel, and a SINGLE centred pill
// naming what the drop will do.
//
// The shape is deliberately not a card on a dimming scrim, which is what the
// Ad Analyzer had until September 2026 (Massimo's call). A card covers the
// drop zone it is describing — the member drags a clip over the panel and the
// thing they were aiming at disappears behind an opaque slab quoting the file
// formats that were already written on it. The frame tints the panel instead:
// the drop zone stays where it was, the dashed border says the whole surface
// is the target rather than that box alone, and the pill carries the one line
// the panel underneath doesn't already say.
//
// It ARRIVES like a modal — `modal-fade` on the frame, `modal-pop` on the pill
// (see index.css). A drag overlay is the one piece of chrome that appears
// while the pointer is already moving, and snapping in at full strength read
// as a flash. The 200ms fade is a one-shot over a static panel, which is the
// one case where opacity over a `backdrop-filter` is fine — nothing here keeps
// animating once it has arrived, and the overlay is `pointer-events-none` so
// the drag itself is handled by the surface underneath.
//
// The label NAMES AN ACTION, so it is Title Case from the verb onward — the
// register every other action in the app uses ("Analyze Ad Creative", "Extract
// Character DNA", "Save to Script Bank"). These four pills were the outliers
// (Massimo's call, September 2026).
//
// Accents are a closed set rather than free class strings, so a new caller
// picks a look that already exists instead of inventing a fifth tint. The Ad
// Analyzer's is a literal hex because that app's accent isn't a Tailwind
// family (see the root CLAUDE.md).
const ACCENTS = {
  green: { frame: 'border-green-400/60 bg-green-500/10', pill: 'text-green-200' },
  emerald: { frame: 'border-emerald-400/60 bg-emerald-500/10', pill: 'text-emerald-200' },
  analyzer: { frame: 'border-[#FF5257]/60 bg-[#FF5257]/10', pill: 'text-[#FF5257]' },
} as const

export type DropOverlayAccent = keyof typeof ACCENTS

export default function DropOverlay({
  icon: Icon,
  label,
  accent,
  // The stacking context is the caller's, not this component's: it has to clear
  // whatever that panel already puts on top of its content.
  className = 'z-30',
}: {
  icon: LucideIcon
  label: string
  accent: DropOverlayAccent
  className?: string
}) {
  const tint = ACCENTS[accent]
  return (
    <div
      className={`modal-fade pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 border-dashed backdrop-blur-sm ${tint.frame} ${className}`}
    >
      <div className={`modal-pop flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium ${tint.pill}`}>
        <Icon className="h-4 w-4" />
        {label}
      </div>
    </div>
  )
}
