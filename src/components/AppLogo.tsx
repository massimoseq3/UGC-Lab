// App brand mark — the user-supplied portrait illustration in public/logo.png.
// Single asset, used for the menu bar, the empty workspace, and the auth
// screen. The image is already a finished black-and-white composition with
// its own oval frame, so we render it bare (no extra tile / gradient).
//
// Serves the 192px derivative, not the 1000×1000 master: the largest place it
// renders is 48 CSS px (h-12), so 192 still covers a 4× display, while the
// master costs 576 KB on the wire and a ~4 MB decoded bitmap held for the whole
// session — the menu-bar copy alone is 20px. Regenerate the derivative with
//   sips -Z 192 public/logo.png --out public/logo-192.png

interface AppLogoProps {
  className?: string
}

export default function AppLogo({ className = 'h-10 w-10' }: AppLogoProps) {
  return (
    <img
      src="/logo-192.png"
      alt="UGC OS"
      // The mark is chrome, never the thing the member came to look at, so it
      // must not compete for the main thread while a screen is painting.
      decoding="async"
      className={`shrink-0 object-contain ${className}`}
    />
  )
}
