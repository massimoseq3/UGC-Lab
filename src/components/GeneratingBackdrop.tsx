// Gemini-style generating backdrop — soft, blurred accent-colored blobs that
// slowly drift and breathe behind a dark frosted surface. Drop in as the first
// child of a `relative overflow-hidden` container; foreground content layers on
// top (give it z-10). Replaces the old harsh pulse on generating tiles.
type Family = 'playground' | 'broll' | 'influencers'

// Literal class triples per app (Tailwind can't build class names from props).
const BLOBS: Record<Family, [string, string, string]> = {
  playground: ['bg-playground-300', 'bg-playground-500', 'bg-playground-400'],
  broll: ['bg-broll-300', 'bg-broll-500', 'bg-broll-400'],
  influencers: ['bg-influencers-300', 'bg-influencers-500', 'bg-influencers-400'],
}

export default function GeneratingBackdrop({ family = 'playground' }: { family?: Family }) {
  const [a, b, c] = BLOBS[family]
  return (
    // `offscreen-idle` is `content-visibility: auto` — the browser skips this
    // subtree entirely while it's outside the viewport, which stops its blobs
    // animating. Each one is a large blurred layer being scaled, so it has to be
    // re-blurred every frame, and a batch puts one of these on every card of a
    // storyboard at once: a dozen tiles is three dozen animated blur layers, and
    // the whole window starts dropping frames while the member scrolls through
    // work they can't even see yet. Nothing changes for a tile on screen, and
    // the element is `absolute inset-0`, so the size containment that comes with
    // the skip has nothing to collapse.
    <div aria-hidden className="offscreen-idle absolute inset-0 overflow-hidden">
      {/* Frosted base — dark in dark mode, light in light mode (ink ramp flips). */}
      <div className="absolute inset-0 bg-gradient-to-br from-ink-900 to-ink-950" />
      <div className={`absolute -left-1/4 -top-1/4 h-3/4 w-3/4 rounded-full ${a} opacity-50 blur-2xl animate-blob-1`} />
      <div className={`absolute -right-1/4 top-0 h-3/4 w-3/4 rounded-full ${b} opacity-40 blur-2xl animate-blob-2`} />
      <div className={`absolute -bottom-1/4 left-1/4 h-2/3 w-2/3 rounded-full ${c} opacity-35 blur-2xl animate-blob-3`} />
    </div>
  )
}
