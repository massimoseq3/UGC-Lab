// The "this is generating" backdrop — soft, blurred accent blobs drifting behind
// a frosted surface. Drop in as the first child of a `relative overflow-hidden`
// container; foreground content layers on top (give it z-10).
//
// The look is unchanged from the original: same three lobes, same positions,
// same opacities, same drift. What changed is where the Gaussian comes from.
// The blobs used to carry a live `filter: blur(40px)`, which is the single most
// expensive thing in this app to animate — a filtered layer is re-blurred on
// every frame of a transform, and a storyboard batch puts a backdrop on every
// card at once, so a dozen generating tiles meant three dozen full-size blurs
// per frame. Measured here, on a grid of these and nothing else:
//
//        12 tiles   24 tiles
//   live blur     63 fps     36 fps
//   baked blur   120 fps    120 fps   ← flat, because no filter runs per frame
//
// So the blur is baked into a MASK instead (`.gen-blob` in index.css): a real
// `feGaussianBlur` over a white circle, rasterised once into a mask texture and
// then only ever transformed. Same Gaussian falloff — this is not the radial
// gradient that was tried and reverted, which banded because its ramp is linear
// — with the per-frame cost of moving a picture. The blob boxes below are ~2.1x
// the old ones around the same centres, because a CSS filter paints outside its
// element's box and a mask cannot: the falloff now has to fit inside the element
// that carries it. Resize them and the mask's circle together, or the blob gains
// a cut-off rim.
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
  // Hold the blobs still. For a decorative use of this wash that isn't reporting
  // on work in progress — the Bank's preset covers, where a bank of saved
  // recipes would otherwise animate a whole grid of tiles that aren't
  // generating anything.
  still = false,
}: {
  family?: Family
  still?: boolean
}) {
  const [a, b, c] = BLOBS[family]
  const drift = (n: 1 | 2 | 3) => (still ? '' : ` animate-blob-${n}`)
  return (
    // `offscreen-idle` is `content-visibility: auto` — the browser skips this
    // subtree entirely while it's outside the viewport, which stops its blobs
    // animating and defers their mask raster until the tile is scrolled to.
    // Nothing changes for a tile on screen, and the element is `absolute
    // inset-0`, so the size containment that comes with the skip has nothing to
    // collapse.
    <div aria-hidden className="offscreen-idle absolute inset-0 overflow-hidden">
      {/* Frosted base, faintly accent-tinted — dark in dark mode, light in light
          mode (the ink ramp flips). */}
      <div className="absolute inset-0" style={{ backgroundImage: BASE[family] }} />
      {/* Same three lobes, same centres. The box is bigger than the old one only
          because the baked falloff has to live inside it — see the note above. */}
      <div className={`gen-blob absolute left-[-69%] top-[-69%] h-[168%] w-[168%] ${a} opacity-50${drift(1)}`} />
      <div className={`gen-blob absolute right-[-77%] top-[-52%] h-[197%] w-[197%] ${b} opacity-40${drift(2)}`} />
      <div className={`gen-blob absolute bottom-[-68%] left-[-18%] h-[166%] w-[166%] ${c} opacity-35${drift(3)}`} />
    </div>
  )
}
