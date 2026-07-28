// The desktop's wallpaper: deep space. Colour blooms are the nebula, two tiled
// star layers give it depth, and a meteor crosses every ~22 seconds.
//
// Shared, not Dashboard-only: Edit is the other full-page screen with no panels
// of its own to fill the window, so it sits on the same sky. Drop it into any
// `relative` full-height root — it paints behind everything and takes no events.
//
// All of it is dark-mode only except the blooms. A starfield needs a night sky —
// white dots vanish on a bright wallpaper and dark ones read as dust — so light
// mode keeps the clean gradient and drops the stars, the vignette and the meteor.
// Colours and keyframes live in index.css (`.desktop-*`) so both themes stay in
// one place. Both pages take the sky exactly as it is: a `tint` prop for a
// second bloom palette lasted one commit and came back out when the Dashboard
// wanted the same neutral top-left corner Edit did.
export default function DesktopWallpaper() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="desktop-wallpaper absolute inset-0" />
      <div className="desktop-stars-far absolute inset-0 light:hidden" />
      <div className="desktop-stars-near absolute inset-0 light:hidden" />
      {/* Two meteors on the same 22s cycle, offset so they never share a pass. */}
      <span className="desktop-meteor absolute right-[12%] top-[8%] h-px w-24 light:hidden" />
      <span
        className="desktop-meteor absolute right-[38%] top-[2%] h-px w-16 light:hidden"
        style={{ animationDelay: '11s' }}
      />
      {/* Vignette — seats the widgets on the surface. In light mode it would
          just dirty the wallpaper. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.5)_100%)] light:hidden" />
    </div>
  )
}
