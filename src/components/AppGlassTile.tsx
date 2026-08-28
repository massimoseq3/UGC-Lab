import type { ReactNode } from 'react'
import type { AppConfig } from '../utils/constants'
import { getTeamMember } from '../utils/team'
import CrabSprite from './CrabSprite'

// The macOS-app-icon tile: the app's accent as the fill, `glass-fill`
// (index.css) laying the diffuse bloom and body gradient over it, the tile's
// own rims and accent glow finishing it, and the app's crab persona peeking up
// over the top-right corner on hover.
//
// Lifted out of the dock (August 2026) so Meet Your Team wears the SAME icon a
// member reaches for afterwards — it introduced the crew with the crab alone,
// which is the one picture that appears nowhere else in the workspace. The crab
// is still here, in the place the dock puts it: tucked behind the tile until
// the pointer arrives.
//
// The hover reveal rides on `group-hover:`, so the caller's own hoverable
// element has to carry `group`.
export default function AppGlassTile({
  app,
  size = 48,
  overlay,
}: {
  app: AppConfig
  // Edge length in px — the tile is a square and the crab scales with it.
  size?: number
  // Extra chrome positioned against the tile (the dock's update badge).
  overlay?: ReactNode
}) {
  const Icon = app.icon
  // Admin's accent is near-white — a white glyph would vanish on it.
  const iconColor = app.id === 'admin' ? '#27272a' : '#ffffff'
  const member = getTeamMember(app.id)
  const scale = size / 48
  const radius = Math.round(14 * scale)

  return (
    <span className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Tucked behind the tile (z-0) and hidden until hover, then it rises and
          fades in so the crew pokes out of the icon. Coloured in the teammate's
          accent (not white) so it reads as "the new colour". */}
      {member && (
        <CrabSprite
          variant={member.appId}
          body={member.roleColor ?? app.accent}
          className="pointer-events-none absolute right-0 z-0 translate-y-2 rotate-6 opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.3))] group-hover:translate-y-0 group-hover:opacity-100"
          style={{ top: -12 * scale, height: 24 * scale, width: 22 * scale }}
        />
      )}
      <span
        className="glass-fill relative z-10 flex items-center justify-center overflow-hidden"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          // The accent is the fill; `glass-fill` frosts it. Keeping the flat
          // colour here rather than baking a gradient in is what lets the
          // dock and every Generate button share one definition of glass.
          backgroundColor: app.accent,
          // A contact shadow, a whisper of the tile's own colour below it, then
          // the two rims. Both are lit, and the shaded band sits just ABOVE the
          // bottom one (glass-fill's last stop): light entering the top of a
          // solid piece of glass exits along its far edge, so a dark bottom rim
          // reads as a printed sticker.
          boxShadow: `0 1px 2px rgba(0,0,0,0.2), 0 6px 14px -10px color-mix(in oklab, ${app.accent} 60%, transparent), inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -1px 0 rgba(255,255,255,0.14)`,
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
