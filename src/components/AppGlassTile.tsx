import type { ElementType, ReactNode } from 'react'
import type { AppConfig } from '../utils/constants'

// The macOS-app-icon tile: an accent as the fill, `glass-fill` (index.css)
// laying the diffuse bloom and body gradient over it, and the tile's own rims
// and accent glow finishing it.
//
// Lifted out of the dock (August 2026) so Meet Your Team wears the SAME icon a
// member reaches for afterwards.
//
// The crab persona used to peek out of the top-right corner on hover, here and
// therefore in the dock. It came out in September 2026 (Massimo's call): a
// pixel-art sprite sliding out from behind a glass icon is a different visual
// language from everything around it, and on a row of eight it fired eight
// times as the cursor crossed the row. The crabs still live where they are the
// subject rather than a garnish — Meet Your Team, Edit's skill folder, the
// Outliers connect card. (The orrery's caption was a fourth until the orrery
// itself came out, days later.)

/**
 * The tile itself, addressed by icon + colour rather than by app — so a mark
 * that is NOT a dock app can wear the same face. The kie.ai key card uses it
 * for its bolt, which is the point: the key belongs to the same set of objects
 * as the apps it powers, so it should be cut from the same material.
 */
export function GlassTile({
  icon: Icon,
  accent,
  size = 48,
  iconColor = '#ffffff',
  overlay,
}: {
  icon: ElementType
  accent: string
  // Edge length in px — everything inside scales with it.
  size?: number
  iconColor?: string
  // Extra chrome positioned against the tile (the dock's update badge).
  overlay?: ReactNode
}) {
  const scale = size / 48
  const radius = Math.round(14 * scale)

  return (
    <span className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <span
        className="glass-fill relative z-10 flex items-center justify-center overflow-hidden"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          // The accent is the fill; `glass-fill` frosts it. Keeping the flat
          // colour here rather than baking a gradient in is what lets the
          // dock and every Generate button share one definition of glass.
          backgroundColor: accent,
          // A contact shadow, a whisper of the tile's own colour below it, then
          // the two rims. Both are lit, and the shaded band sits just ABOVE the
          // bottom one (glass-fill's last stop): light entering the top of a
          // solid piece of glass exits along its far edge, so a dark bottom rim
          // reads as a printed sticker.
          boxShadow: `0 1px 2px rgba(0,0,0,0.2), 0 6px 14px -10px color-mix(in oklab, ${accent} 60%, transparent), inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -1px 0 rgba(255,255,255,0.14)`,
        }}
      >
        <span
          className="absolute inset-0 ring-1 ring-inset ring-white/15"
          style={{ borderRadius: radius }}
        />
        <Icon
          className="relative"
          style={{
            width: 22 * scale,
            height: 22 * scale,
            color: iconColor,
            filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.18))',
          }}
          strokeWidth={1.9}
        />
      </span>
      {overlay}
    </span>
  )
}

/** A dock app's tile, in its own accent. */
export default function AppGlassTile({
  app,
  size = 48,
  overlay,
}: {
  app: AppConfig
  size?: number
  overlay?: ReactNode
}) {
  return (
    <GlassTile
      icon={app.icon}
      accent={app.accent}
      size={size}
      // Admin's accent is near-white — a white glyph would vanish on it.
      iconColor={app.id === 'admin' ? '#27272a' : '#ffffff'}
      overlay={overlay}
    />
  )
}
