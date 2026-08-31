// The "this is generating" backdrop — three soft accent lobes behind a frosted
// surface. Drop in as the first child of a `relative overflow-hidden` container;
// foreground content layers on top (give it z-10).
//
// The lobes DON'T MOVE, and that is deliberate — see the long note above
// `.gen-blob` in index.css. Short version: they used to drift, first under a
// live `filter: blur()` and then with the Gaussian baked into a mask. Baking the
// blur fixed the re-blur-per-frame cost but not the rest of it, because a moving
// element is a composited layer of its own: three of them per tile, each ~2x the
// tile, on every card of a storyboard batch at once. The only motion left here
// is one slow alpha breathe over the group, which rasterises once and then just
// varies its own opacity; the tile's real "something is happening" signal is the
// progress bar and the rotating status line sitting on top of this.
type Family = 'playground' | 'broll' | 'influencers'

// The base is the original frosted gradient with a TOUCH of the app's own accent
// mixed in (Massimo's call, August 2026). It was `from-ink-900 to-ink-950`, so
// everything the lobes didn't cover read as neutral grey — on a 9:16 tile that
// is most of the card. A full accent wash was tried first and was too much: the
// grey is what makes this read as frosted glass rather than as a coloured card,
// so the tint stays low enough that you'd only notice it beside the old one.
// Mixed from the lighter end of the ramp (400/500) so the three families land at
// comparable brightness — Playground's accent is a very dark teal, and mixing
// its 600 into near-black tinted nothing at all.
const BASE: Record<Family, string> = {
  playground:
    'linear-gradient(to bottom right, color-mix(in oklab, var(--color-playground-400) 14%, var(--color-ink-900)), color-mix(in oklab, var(--color-playground-500) 11%, var(--color-ink-950)))',
  broll:
    'linear-gradient(to bottom right, color-mix(in oklab, var(--color-broll-400) 14%, var(--color-ink-900)), color-mix(in oklab, var(--color-broll-500) 11%, var(--color-ink-950)))',
  influencers:
    'linear-gradient(to bottom right, color-mix(in oklab, var(--color-influencers-400) 14%, var(--color-ink-900)), color-mix(in oklab, var(--color-influencers-500) 11%, var(--color-ink-950)))',
}

// Literal class triples per app (Tailwind can't build class names from props).
const BLOBS: Record<Family, [string, string, string]> = {
  playground: ['bg-playground-300', 'bg-playground-500', 'bg-playground-400'],
  broll: ['bg-broll-300', 'bg-broll-500', 'bg-broll-400'],
  influencers: ['bg-influencers-300', 'bg-influencers-500', 'bg-influencers-400'],
}

export default function GeneratingBackdrop({
  family = 'playground',
  // Drop the breathe too, leaving a completely still wash. For a decorative use
  // of this surface that isn't reporting on work in progress — the Bank's preset
  // covers, where a bank of saved recipes would otherwise all breathe at once.
  still = false,
}: {
  family?: Family
  still?: boolean
}) {
  const [a, b, c] = BLOBS[family]
  return (
    // `offscreen-idle` is `content-visibility: auto` — the browser skips this
    // subtree entirely while it's outside the viewport, which defers the mask
    // raster until the tile is scrolled to. The element is `absolute inset-0`,
    // so the size containment that comes with the skip has nothing to collapse.
    <div aria-hidden className="offscreen-idle absolute inset-0 overflow-hidden">
      {/* Frosted base, faintly accent-tinted — dark in dark mode, light in light
          mode (the ink ramp flips). */}
      <div className="absolute inset-0" style={{ backgroundImage: BASE[family] }} />
      {/* The lobes share one wrapper so the breathe is a single layer, and that
          wrapper CLIPS: each lobe's box is ~2x the tile (a mask can't paint
          outside its element the way a filter could), so without the clip the
          layer's bounds would be the union of all three. */}
      <div className={`absolute inset-0 overflow-hidden${still ? '' : ' gen-lobes'}`}>
        <div className={`gen-blob absolute left-[-69%] top-[-69%] h-[168%] w-[168%] ${a} opacity-50`} />
        <div className={`gen-blob absolute right-[-77%] top-[-52%] h-[197%] w-[197%] ${b} opacity-40`} />
        <div className={`gen-blob absolute bottom-[-68%] left-[-18%] h-[166%] w-[166%] ${c} opacity-35`} />
      </div>
    </div>
  )
}
