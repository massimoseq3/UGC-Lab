// The desktop's night sky: two tiled star layers over the workspace's own
// background, and nothing else.
//
// Shared, not Dashboard-only: Edit is the other full-page screen with no panels
// of its own to fill the window, so it sits on the same sky. Drop it into any
// `relative` full-height root — it paints behind everything and takes no events.
//
// THE GRADIENT UNDERNEATH IS `AppBackground`, the same one every other page in
// the app shows (September 2026, Massimo's call). This layer used to paint its
// own — three white blooms off the top-left, top-right and bottom-centre — plus
// a vignette to seat the widgets on the surface, so the two full-page screens
// had a background of their own while every panelled app had the shared ramp.
// They are gone: the Dashboard now reads as the same room as the rest of the
// workspace, with stars in it.
//
// NOTHING HERE MOVES, and that is deliberate — see the note in index.css. The
// star layers drifted and breathed and a meteor crossed every 22 seconds, all of
// it composited properly, and it still cost real CPU for as long as either page
// was on screen: this is the backdrop that ten `backdrop-filter` widgets sit on,
// and a backdrop-filter re-runs whenever its backdrop changes. A still sky costs
// nothing at all — the page is drawn once and then left alone.
//
// Dark mode only. A starfield needs a night sky: white dots vanish on a bright
// wallpaper and dark ones read as dust, so light mode is the bare gradient.
export default function DesktopWallpaper() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Geometry and colour are in index.css — the two layers tile at
          different sizes, which is what reads as depth. */}
      <div className="desktop-stars-far absolute light:hidden" />
      <div className="desktop-stars-near absolute light:hidden" />
    </div>
  )
}
