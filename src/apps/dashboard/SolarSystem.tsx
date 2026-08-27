import { useState, type CSSProperties } from 'react'
import { useAppStore } from '../../stores/appStore'
import { getAppConfig } from '../../utils/constants'
import { TEAM } from '../../utils/team'
import CrabSprite from '../../components/CrabSprite'
import { DISPLAY_FONT } from './Widget'

// The crew in orbit — the desktop's launcher and its signature. One planet per
// crew member, the workspace at the centre: the app already frames itself as
// one system everything else revolves around, so the dashboard says it outright.
// The ring spacing tightened when the ninth app (Outliers) joined — the outer
// radius is pinned by the 400px box, so a new planet divides the same space.
//
// Three things keep it usable rather than merely pretty:
//   · Orbits run in minutes (5 → 15), so a planet is a stationary target at the
//     speed a hand moves, and hovering anywhere freezes the whole system. Half
//     these periods was tried and read as drift rather than depth.
//   · The planet carries the app's own dock glyph on its own accent, so it is
//     identifiable at 36px without a label orbiting alongside it (eight labels
//     in motion would collide constantly).
//   · One caption slot under the system names whatever the cursor is on, crab
//     and all — the same idiom as the Meet-your-team roster.
//
// Fixed 400px because the geometry is in pixels; below xl the Dashboard renders
// the plain icon grid instead (see DesktopIcons).

const SIZE = 400
const CENTRE = SIZE / 2

// Radius, period and start angle per planet, in dock order (Bank outward to
// Playground). Periods rise with radius — an inner planet that lapped a slower
// outer one would look wrong to anyone who has seen an orrery. The negative
// delay is what sets each planet's starting angle: it drops the animation into
// a period already in progress, so they don't launch from a single line.
// There must be one entry here per TEAM member — the two are zipped by index,
// so a crew member with no orbit simply never renders.
const ORBITS = [
  { radius: 55, period: 300, offset: -16 },   //  20°
  { radius: 70, period: 366, offset: -160 },  // 155°
  { radius: 85, period: 432, offset: -358 },  // 290°
  { radius: 100, period: 500, offset: -94 },  //  65°
  { radius: 115, period: 570, offset: -334 }, // 200°
  { radius: 130, period: 645, offset: -640 }, // 335°
  { radius: 145, period: 725, offset: -238 }, // 110°
  { radius: 161, period: 800, offset: -598 }, // 245°
  { radius: 177, period: 880, offset: -430 }, // 175°
]

export default function SolarSystem({ className = '' }: { className?: string }) {
  const openApp = useAppStore((s) => s.openApp)
  const [hovered, setHovered] = useState<number | null>(null)
  const active = hovered === null ? null : TEAM[hovered]
  const activeApp = active ? getAppConfig(active.appId) : null

  return (
    <div className={className}>
      <div
        className="solar-system relative"
        style={{ width: SIZE, height: SIZE }}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Orbit paths */}
        {ORBITS.map((orbit) => (
          <span
            key={orbit.radius}
            aria-hidden
            className="absolute rounded-full border border-ink/[0.06] light:border-black/[0.05]"
            style={{ inset: CENTRE - orbit.radius }}
          />
        ))}

        {/* The sun: the workspace itself. Corona is a pair of stacked glows so
            it falls off softly instead of ending at a hard disc edge. */}
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(242,178,49,0.20),transparent_68%)] light:bg-[radial-gradient(circle,rgba(242,178,49,0.28),transparent_68%)]"
        />
        {/* No mark on the sun: anything dark enough to read on gold turns into
            a sunspot. The corona and the colour carry it. */}
        <span className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_38%_32%,#FFF3D2,#F7C65A_38%,#F2B231_62%,#D18E1E)] shadow-[0_0_38px_-2px_rgba(242,178,49,0.7)]" />

        {TEAM.map((member, i) => {
          const app = getAppConfig(member.appId)
          const orbit = ORBITS[i]
          if (!app || !orbit) return null
          const Icon = app.icon
          const spin: CSSProperties = {
            animationDuration: `${orbit.period}s`,
            animationDelay: `${orbit.offset}s`,
          }
          return (
            // Each arm is a full-size box stacked over the last, so every one of
            // them has to be transparent to the cursor — otherwise the topmost
            // arm (the outermost planet) swallows every hover and click meant
            // for the seven planets underneath it. Only the planet itself takes
            // pointer events back.
            <div key={member.appId} className="orbit-arm pointer-events-none absolute inset-0" style={spin}>
              <div
                className="absolute left-1/2 top-1/2"
                style={{ transform: `translate(-50%, -50%) translateY(-${orbit.radius}px)` }}
              >
                <div className="orbit-counter" style={spin}>
                  <button
                    onClick={() => openApp(member.appId)}
                    onMouseEnter={() => setHovered(i)}
                    onFocus={() => setHovered(i)}
                    onBlur={() => setHovered(null)}
                    title={`Open ${app.name} — ${member.name}, ${member.role}`}
                    aria-label={`Open ${app.name}`}
                    // The `before` ring is an invisible 44px hit area around a
                    // 36px planet — a moving 36px target is a hard one, and the
                    // system freezes the moment the cursor is anywhere near.
                    // Kept under the 17px orbit spacing so it can't reach the
                    // planet on the next ring out.
                    className="group pointer-events-auto relative flex h-9 w-9 items-center justify-center rounded-full outline-none transition-transform duration-200 before:absolute before:-inset-1 before:rounded-full before:content-[''] hover:scale-[1.18] focus-visible:scale-[1.18]"
                  >
                    {/* Hover halo, and it sits BEHIND the sphere — as a later
                        sibling it painted over the planet's own face instead,
                        so hovering flattened a shaded ball into a fuzzy disc of
                        flat accent and took the rim light with it. It is also a
                        radial gradient rather than a `blur()` of a solid disc
                        (the same idiom DesktopIcons' tile glow uses): the button
                        scales on the very same hover, and scaling a filtered
                        layer re-rasters the blur every frame of the transition —
                        the one thing the blob-drift note in index.css says not
                        to do. A gradient is painted once and composited. */}
                    <span
                      aria-hidden
                      className="absolute -inset-4 rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-90 group-focus-visible:opacity-90"
                      style={{ backgroundImage: `radial-gradient(circle, ${app.accent} 48%, transparent 82%)` }}
                    />
                    {/* Lit from the sun's side — top-left, where the sun is for
                        a planet drawn at the top of its orbit. */}
                    <span
                      className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/20"
                      style={{
                        backgroundImage: `radial-gradient(circle at 34% 28%, color-mix(in oklab, ${app.accent} 55%, white), ${app.accent} 58%, color-mix(in oklab, ${app.accent} 72%, black))`,
                        boxShadow: '0 2px 8px -2px rgba(0,0,0,0.5)',
                      }}
                    />
                    <Icon
                      className="relative h-[15px] w-[15px] text-white [filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.35))]"
                      strokeWidth={2}
                    />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Caption slot — fixed height so a hover never nudges the layout. */}
      <div className="mt-3 flex min-h-[46px] items-center justify-center gap-2.5 px-2 text-center">
        {active && activeApp ? (
          <>
            <CrabSprite
              variant={active.appId}
              body={active.roleColor ?? activeApp.accent}
              className="h-6 w-8 shrink-0"
            />
            <span className="min-w-0 text-left">
              <span className="block truncate text-[13px] italic leading-tight text-ink-100" style={DISPLAY_FONT}>
                {activeApp.name}
              </span>
              <span className="block truncate text-[11px] leading-tight text-ink-500">
                {active.name} · {active.role}
              </span>
            </span>
          </>
        ) : (
          <span className="text-[12px] leading-snug text-ink-500">Click a planet to open its app.</span>
        )}
      </div>
    </div>
  )
}
