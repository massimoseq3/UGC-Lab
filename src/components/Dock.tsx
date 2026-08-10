import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Settings } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useActivityStore } from '../stores/activityStore'
import { useSkillUpdateUnseen } from '../stores/skillUpdateStore'
import { APP_REGISTRY, type AppCategory, type AppConfig } from '../utils/constants'
import { getTeamMember } from '../utils/team'
import CrabSprite from './CrabSprite'
import SettingsModal from './SettingsModal'

// macOS-style bottom dock — the sidebar's replacement for this experiment.
// Every icon carries its label underneath (no hover-only tooltips), app tiles
// are filled with each app's accent, and Settings sits on the right. Credits
// and the theme toggle live in the menu bar; Account + Admin live in the
// Settings modal.

// Dashboard leads (its own 'system' group → divider between it and Bank).
const SECTION_ORDER: AppCategory[] = ['system', 'library', 'create', 'tools']

export default function Dock() {
  const activeApp = useAppStore((s) => s.activeApp)
  const runningApps = useAppStore((s) => s.runningApps)
  const openApp = useAppStore((s) => s.openApp)
  const activityCounts = useActivityStore((s) => s.counts)
  // Edit hands out a file that never auto-updates, so a new cut of the skill
  // has to announce itself from the dock — nobody reopens a download page.
  const skillUpdate = useSkillUpdateUnseen()
  const [settingsOpen, setSettingsOpen] = useState(false)

  // On a phone the dock is wider than the screen and scrolls, so the running
  // app's tile is often off to one side — including right after a handoff moved
  // you to an app you never tapped. Bring it into view whenever it changes.
  // `inline: 'nearest'` so a tile already on screen doesn't jump, and `block:
  // 'nearest'` so this can never scroll the page itself.
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!activeApp) return
    const nav = navRef.current
    if (!nav || nav.scrollWidth <= nav.clientWidth) return
    nav.querySelector(`[data-dock-app="${activeApp}"]`)?.scrollIntoView({
      behavior: 'smooth',
      inline: 'nearest',
      block: 'nearest',
    })
  }, [activeApp])

  const groups = SECTION_ORDER.map((category) =>
    APP_REGISTRY.filter((app) => app.category === category)
  ).filter((apps) => apps.length > 0)

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {/* overflow-x-auto keeps the dock usable on narrow screens; md+ fits
            everything so overflow stays visible. */}
        <nav ref={navRef} className="pointer-events-auto flex max-w-full items-start gap-0.5 overflow-x-auto overscroll-x-contain scrollbar-hide rounded-[26px] border border-ink/10 bg-surface-1/75 px-2 pb-1.5 pt-2 shadow-2xl shadow-black/25 backdrop-blur-2xl md:overflow-visible md:px-2.5 md:pt-2.5 light:bg-white/75">
          {groups.map((apps, i) => (
            <Fragment key={apps[0].category}>
              {i > 0 && <DockDivider />}
              {apps.map((app) => (
                <DockAppTile
                  key={app.id}
                  app={app}
                  active={activeApp === app.id}
                  running={runningApps.includes(app.id)}
                  busy={(activityCounts[app.id] ?? 0) > 0}
                  badge={app.id === 'edit-studio' && skillUpdate}
                  onClick={() => openApp(app.id)}
                />
              ))}
            </Fragment>
          ))}

          <DockDivider />
          <DockItem label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
            <UtilityTile>
              <Settings className="h-[22px] w-[22px] text-ink-200" strokeWidth={1.75} />
            </UtilityTile>
          </DockItem>
        </nav>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

// Inset vertical hairline between dock sections — sized and offset to sit
// centered on the icon tiles, not the full item height (labels excluded).
function DockDivider() {
  return <span className="mx-1 mt-1.5 h-10 w-px shrink-0 self-start bg-ink/10" />
}

interface DockItemProps {
  label: string
  title?: string
  // Marks the tile so the dock can scroll the running app into view.
  appId?: string
  active?: boolean
  running?: boolean
  // A generation is in flight in this app — the dot pulses in the app accent
  // so the dock reads as "this teammate is working".
  busy?: boolean
  accent?: string
  onClick: () => void
  children: ReactNode
}

// Shared item chrome: tile on top, always-visible label under it, and a
// macOS-style running/active dot below the label. Hover gives a slow eased
// lift (no scale — that's what felt clunky); no click press, it felt slow.
function DockItem({ label, title, appId, active, running, busy, accent, onClick, children }: DockItemProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      data-dock-app={appId}
      className="group flex w-[3.4rem] shrink-0 select-none flex-col items-center gap-1 pt-0.5 md:w-16"
    >
      <span className="flex h-12 w-12 items-center justify-center will-change-transform transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-px">
        {children}
      </span>
      <span
        className={`max-w-full truncate text-[10px] leading-tight transition-colors duration-200 ${
          active ? 'font-medium text-ink' : 'text-ink-400 group-hover:text-ink-200'
        }`}
      >
        {label}
      </span>
      <span className="flex h-1 items-center">
        {busy ? (
          <span
            className="h-1 w-1 animate-pulse rounded-full"
            style={{ backgroundColor: accent }}
          />
        ) : (
          (active || running) && (
            <span
              className={`h-1 w-1 rounded-full ${active ? 'bg-ink-200' : 'bg-ink-500/60'}`}
            />
          )
        )}
      </span>
    </button>
  )
}

// Colorful macOS-app-icon-style tile: flat accent fill with a soft top
// sheen and an inset highlight ring so it reads as a "real" app icon.
function DockAppTile({
  app,
  active,
  running,
  busy,
  badge,
  onClick,
}: {
  app: AppConfig
  active: boolean
  running: boolean
  busy: boolean
  // Something new is waiting inside — a notification dot on the tile itself,
  // not the running dot under the label (that one means "this app is open").
  badge: boolean
  onClick: () => void
}) {
  const Icon = app.icon
  // Admin's accent is near-white — a white glyph would vanish on it.
  const iconColor = app.id === 'admin' ? '#27272a' : '#ffffff'
  const member = getTeamMember(app.id)

  return (
    // No title attr: the native tooltip popping over the dock on hover was
    // distracting — the persona introduction lives in Meet your team.
    <DockItem
      label={app.name}
      appId={app.id}
      active={active}
      running={running}
      busy={busy}
      accent={app.accent}
      onClick={onClick}
    >
      <span className="relative flex h-12 w-12 items-center justify-center">
        {/* On hover the app's crab persona peeks up over the top-right corner
            of the tile — tucked behind it (z-0) and hidden until hover, then it
            rises and fades in so the crew pokes out of the dock. Coloured in the
            teammate's accent (not white) so it reads as "the new colour". */}
        {member && (
          <CrabSprite
            variant={member.appId}
            body={member.roleColor ?? app.accent}
            className="pointer-events-none absolute -top-3 right-0 z-0 h-6 w-[22px] translate-y-2 rotate-6 opacity-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] [filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.3))] group-hover:translate-y-0 group-hover:opacity-100"
          />
        )}
        <span
          className="relative z-10 flex h-12 w-12 items-center justify-center overflow-hidden rounded-[14px] shadow-sm shadow-black/10"
          style={{ backgroundColor: app.accent }}
        >
          <span className="absolute inset-0 bg-gradient-to-b from-white/30 via-white/5 to-transparent" />
          <span className="absolute inset-0 rounded-[14px] ring-1 ring-inset ring-white/20" />
          <Icon
            className="relative h-[22px] w-[22px]"
            style={{ color: iconColor }}
            strokeWidth={1.9}
          />
        </span>
        {/* Top-LEFT, because the crab peeks out of the top-right on hover.
            Ringed in the dock's own fill so it reads as a badge on the tile. */}
        {badge && (
          <span
            className="absolute -left-0.5 -top-0.5 z-20 h-3 w-3 rounded-full border-2 border-surface-1 bg-red-500"
            aria-hidden
          />
        )}
      </span>
    </DockItem>
  )
}

// Neutral glass tile for the utility cluster (credits / theme / settings /
// account) so they read as chrome, not apps.
function UtilityTile({ children }: { children: ReactNode }) {
  return (
    <span className="relative flex h-12 w-12 items-center justify-center rounded-[14px] bg-ink/[0.07] ring-1 ring-inset ring-ink/10 transition-colors duration-300 group-hover:bg-ink/[0.1]">
      {children}
    </span>
  )
}

