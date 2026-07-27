import type { CSSProperties } from 'react'
import { useAppStore } from '../../stores/appStore'
import { getAppConfig } from '../../utils/constants'
import { TEAM } from '../../utils/team'
import CrabSprite from '../../components/CrabSprite'
import { riseStyle } from './Widget'

// The crew as desktop icons — pinned top-right and filling downward in two
// columns, where macOS puts them. One click opens the app.
//
// The tile is glass with the app's accent glowing inside it rather than a solid
// accent fill: the crab IS the app's colour (CrabSprite takes the same accent),
// so a filled tile swallows its own mascot. Colour arrives on hover, the same
// discipline the dock and the team roster use.

export default function DesktopIcons({ className = '' }: { className?: string }) {
  const openApp = useAppStore((s) => s.openApp)

  return (
    <div className={className}>
      {TEAM.map((member, i) => {
        const app = getAppConfig(member.appId)
        if (!app) return null
        return (
          <button
            key={member.appId}
            onClick={() => openApp(member.appId)}
            title={`Open ${app.name} — ${member.name}, ${member.role}`}
            style={{ ...riseStyle(i), '--tint': `${app.accent}59` } as CSSProperties}
            className="widget-rise group flex flex-col items-center gap-1.5 rounded-2xl px-1 py-1.5 outline-none"
          >
            <span className="relative flex h-14 w-14 items-center justify-center rounded-[17px] border border-ink/10 bg-ink/[0.05] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_10px_20px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl transition-all duration-200 group-hover:-translate-y-1 group-hover:border-ink/20 group-focus-visible:-translate-y-1 light:border-black/[0.05] light:bg-white/70 light:shadow-[0_6px_16px_-10px_rgba(0,0,0,0.35)]">
              {/* Accent glow, off at rest. */}
              <span className="absolute inset-0 rounded-[17px] bg-[radial-gradient(circle_at_50%_115%,var(--tint),transparent_72%)] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
              <CrabSprite
                variant={member.appId}
                body={member.roleColor ?? app.accent}
                className="relative h-7 w-9 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5"
              />
            </span>
            {/* Finder-style label: the name gets a selection pill on hover. */}
            <span className="max-w-[76px] truncate rounded-md px-1.5 py-px text-[11px] font-medium leading-tight tracking-tight text-ink-300 transition-colors group-hover:bg-ink/10 group-hover:text-ink-100 group-focus-visible:bg-ink/10">
              {app.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}
