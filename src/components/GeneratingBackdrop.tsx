// Gemini-style generating backdrop — soft accent-colored blobs that slowly
// drift and breathe behind a dark frosted surface. Drop in as the first child of
// a `relative overflow-hidden` container; foreground content layers on top (give
// it z-10). Replaces the old harsh pulse on generating tiles.
//
// PERFORMANCE — read before touching the blobs.
//
// Each blob is a RADIAL GRADIENT, not a solid circle behind `filter: blur()`.
// A soft-edged blob is exactly what a radial gradient already is, so the two
// look the same; what they cost is not remotely the same. The old shape was
// three `blur-2xl` (a 40px blur filter) elements per tile, each promoted to its
// own compositor layer by `will-change` and each running an infinite transform
// animation. That is 3 live blurred layers per generating tile — and this
// surface's whole job is to appear in bulk: one B-Roll batch puts a dozen-plus
// cards into generation at once, which was 36+ continuously animating blur
// filters on screen at the same time. It read as the loading animation itself
// being laggy, because it was.
//
// The cost did not stop at the tile, either. The app window frame in App.tsx is
// a full-viewport element and every one of these tiles renders inside it — and
// a repaint anywhere inside a `backdrop-filter` element invalidates that
// element's whole backdrop. So each animation frame of each blob dragged a
// full-window filter recompute behind it, which is how a card-sized animation
// turned into app-wide lag (and, under that much pressure, a browser drops its
// raster scale — which is what "the images went blocky" was).
//
// A gradient has no filter, needs no layer of its own beyond the transform it
// animates, and re-rasters at zero cost. Keep it that way: animate `transform`
// and `opacity` here, nothing else, and don't reintroduce `filter`.
type Family = 'playground' | 'broll' | 'influencers'

// Literal CSS custom properties per app — Tailwind can't build class names from
// props, and these go into a gradient rather than onto a `bg-` utility.
const BLOBS: Record<Family, [string, string, string]> = {
  playground: ['--color-playground-300', '--color-playground-500', '--color-playground-400'],
  broll: ['--color-broll-300', '--color-broll-500', '--color-broll-400'],
  influencers: ['--color-influencers-300', '--color-influencers-500', '--color-influencers-400'],
}

// `closest-side` puts the gradient's edge on the element's own bounds, so the
// blob fades out inside its box exactly as the blurred circle used to. The
// middle stop is what matches the density: a blurred solid circle keeps full
// colour across its core and only falls off at the fringe, while a bare
// two-stop gradient starts fading from the centre pixel and comes out visibly
// thinner. Holding the colour to 55% lands on the old weight.
function blob(varName: string): React.CSSProperties {
  const c = `var(${varName})`
  return { background: `radial-gradient(closest-side, ${c} 0%, ${c} 55%, transparent 100%)` }
}

export default function GeneratingBackdrop({ family = 'playground' }: { family?: Family }) {
  const [a, b, c] = BLOBS[family]
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden">
      {/* Frosted base — dark in dark mode, light in light mode (ink ramp flips). */}
      <div className="absolute inset-0 bg-gradient-to-br from-ink-900 to-ink-950" />
      <div className="absolute -left-1/4 -top-1/4 h-3/4 w-3/4 opacity-50 animate-blob-1" style={blob(a)} />
      <div className="absolute -right-1/4 top-0 h-3/4 w-3/4 opacity-40 animate-blob-2" style={blob(b)} />
      <div className="absolute -bottom-1/4 left-1/4 h-2/3 w-2/3 opacity-35 animate-blob-3" style={blob(c)} />
    </div>
  )
}
