import { useState, type CSSProperties } from 'react'
import { useAppStore } from '../../stores/appStore'
import { getAppConfig } from '../../utils/constants'
import { TEAM } from '../../utils/team'
import CrabSprite from '../../components/CrabSprite'
import { DISPLAY_FONT } from './Widget'

// The crew in orbit — the desktop's launcher and its signature. Eight apps,
// eight planets, the workspace at the centre: the app already frames itself as
// one system everything else revolves around, so the dashboard says it outright.
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
const ORBITS = [
  { radius: 58, period: 300, offset: -16 },   //  20°
  { radius: 75, period: 372, offset: -160 },  // 155°
  { radius: 92, period: 444, offset: -358 },  // 290°
  { radius: 109, period: 520, offset: -94 },  //  65°
  { radius: 126, period: 600, offset: -334 }, // 200°
  { radius: 143, period: 688, offset: -640 }, // 335°
  { radius: 160, period: 780, offset: -238 }, // 110°
  { radius: 177, period: 880, offset: -598 }, // 245°
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
                    {/* Lit from the sun's side — top-left, where the sun is for
                        a planet drawn at the top of its orbit. */}
                    <span
                      className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/20 transition-shadow duration-200"
                      style={{
                        backgroundImage: `radial-gradient(circle at 34% 28%, color-mix(in oklab, ${app.accent} 55%, white), ${app.accent} 58%, color-mix(in oklab, ${app.accent} 72%, black))`,
                        boxShadow: `0 2px 8px -2px rgba(0,0,0,0.5), 0 0 0 0 ${app.accent}`,
                      }}
                    />
                    <span
                      aria-hidden
                      className="absolute -inset-1.5 rounded-full opacity-0 blur-[6px] transition-opacity duration-200 group-hover:opacity-70 group-focus-visible:opacity-70"
                      style={{ backgroundColor: app.accent }}
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
