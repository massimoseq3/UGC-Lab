import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import AppLogo from './components/AppLogo'
import AppBackground from './components/AppBackground'

import Dock from './components/Dock'
import MenuBar from './components/MenuBar'
import MeetTheTeam from './components/MeetTheTeam'
import AnnouncementsHost from './components/announcements/AnnouncementsHost'
import ToastContainer from './components/Toast'
import AuthGate from './components/auth/AuthGate'
import RouterSync from './components/RouterSync'
import LegalAcceptModal from './components/LegalAcceptModal'
import { useAppStore } from './stores/appStore'
import { useChromeHidden } from './stores/chromeStore'
import { useChromeAutoHide } from './hooks/useChromeAutoHide'
import { useAuthStore } from './stores/authStore'
import { getAppConfig } from './utils/constants'
import { startAppUsageTracking, stopAppUsageTracking } from './utils/appUsageTracker'

// Apps are code-split: each chunk loads on first activation, not at startup.
// They stay mounted after first open (see runningApps below), so switching
// back to an already-opened app is instant.
const Finder = lazy(() => import('./apps/finder/Finder'))
const AdAnatomy = lazy(() => import('./apps/ad-anatomy/AdAnatomy'))
const ScriptArchitect = lazy(() => import('./apps/script-architect/ScriptArchitect'))
const CharacterStudio = lazy(() => import('./apps/character-studio/CharacterStudio'))
const VoiceStudio = lazy(() => import('./apps/voice-studio/VoiceStudio'))
const BrollStudio = lazy(() => import('./apps/broll-studio/BrollStudio'))
const Playground = lazy(() => import('./apps/playground/Playground'))
const EditStudio = lazy(() => import('./apps/edit-studio/EditStudio'))
const Discover = lazy(() => import('./apps/discover/Discover'))
const Dashboard = lazy(() => import('./apps/dashboard/Dashboard'))
const AdminPanel = lazy(() => import('./apps/admin/AdminPanel'))

import TermsOfService from './legal/TermsOfService'
import PrivacyPolicy from './legal/PrivacyPolicy'
import AcceptableUsePolicy from './legal/AcceptableUsePolicy'
import DMCAPolicy from './legal/DMCAPolicy'

const APP_COMPONENTS: Record<string, React.ComponentType> = {
  'finder': Finder,
  'ad-anatomy': AdAnatomy,
  'script-architect': ScriptArchitect,
  'character-studio': CharacterStudio,
  'voice-studio': VoiceStudio,
  'broll-studio': BrollStudio,
  'playground': Playground,
  'discover': Discover,
  'edit-studio': EditStudio,
  'dashboard': Dashboard,
  'admin': AdminPanel,
}

function AppPlaceholder({ appId }: { appId: string }) {
  const config = getAppConfig(appId)
  if (!config) return null
  const Icon = config.icon

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <Icon className="h-10 w-10 text-ink-600" strokeWidth={1.5} />
      <span className="text-sm font-medium tracking-tight text-ink-600">
        {config.name}
      </span>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <AppLogo className="h-12 w-12" />
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-ink-100">
          UGC OS
        </h1>
        <p className="text-sm text-ink-500">
          Pick a tool from the dock to get started.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Legal pages render outside AuthGate so signed-out visitors can read */}
        <Route path="/legal/terms" element={<TermsOfService />} />
        <Route path="/legal/privacy" element={<PrivacyPolicy />} />
        <Route path="/legal/aup" element={<AcceptableUsePolicy />} />
        <Route path="/legal/dmca" element={<DMCAPolicy />} />
        <Route
          path="*"
          element={
            <AuthGate>
              <RouterSync />
              <Workspace />
              <LegalAcceptModal />
            </AuthGate>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

function Workspace() {
  const activeApp = useAppStore((s) => s.activeApp)
  const runningApps = useAppStore((s) => s.runningApps)
  const userId = useAuthStore((s) => s.user?.id)
  // Phone only: scrolling down inside an app rolls the menu bar and the dock
  // off screen and hands the pane those ~144px.
  const chromeHidden = useChromeHidden()
  useChromeAutoHide()

  // Per-app attention tracking runs for the life of the workspace. The `key`
  // below already remounts this on a user change, so start/stop lands exactly
  // on the session boundary — and stop DISCARDS its buffer on purpose, so one
  // member's minutes can't land in the next member's ledger on a shared
  // browser (see appUsageTracker).
  useEffect(() => {
    startAppUsageTracking()
    return stopAppUsageTracking
  }, [])

  return (
    // h-dvh (not h-screen): 100vh overflows behind mobile browser URL bars,
    // which would push the dock half off-screen on iOS Safari.
    <div key={userId ?? 'local'} className="relative h-dvh w-screen overflow-hidden text-ink antialiased bg-surface-0">
      {/* Universal Background Gradient */}
      <AppBackground />

      <div className="relative z-10 h-full w-full">
        <MenuBar />
        <Dock />

        {/* The workspace pane. It was a macOS-style floating "window" — a
            rounded, bordered, translucent frame with the desktop gradient
            peeking around it — until August 2026, when the frame came off:
            it fills the space between the menu bar and the dock flush now, so
            every app gets the full width and nothing draws a box around them.
            Keep `overflow-hidden` (app chrome still clips to the pane) and the
            bottom inset (the dock floats over that strip; content underneath
            it would be unreachable). NO `backdrop-blur` here, deliberately:
            a `backdrop-filter` element is a backdrop root, and a repaint
            ANYWHERE inside it invalidates the whole backdrop. This pane
            contains the entire workspace, so every animating pixel in every
            app — a dozen generating tiles during a B-Roll batch especially —
            dragged a full-viewport filter recompute behind it. That surfaced
            as laggy generation animations, laggy zoom (a zoom re-rasters
            everything, the backdrop included), and images going blocky, since
            a browser under that much compositing pressure drops its raster
            scale. Glass belongs on small, static chrome over real content
            (B-Roll's pinned storyboard strips), not on a full-window
            container.

            The insets are phone-aware: when the chrome collapses on a scroll
            (useChromeAutoHide) the pane takes the whole window. Deliberately
            NOT transitioned — `top`/`bottom` are layout, so animating them
            relayouts the entire app on every frame, and a storyboard's worth
            of cards can't pay that for 300ms. The chrome slides; the pane
            simply grows underneath it, which is invisible because content is
            laid out from the top. */}
        <div
          className={`absolute inset-x-0 overflow-hidden md:bottom-[108px] md:top-9 ${
            chromeHidden ? 'bottom-0 top-0' : 'bottom-[108px] top-9'
          }`}
        >
          {/* Empty state — visible when no app is active */}
          <div
            className={`absolute inset-0 ${
              activeApp ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
            }`}
          >
            <EmptyState />
          </div>

          {/* Running apps */}
          {runningApps.map((appId) => {
            const Component = APP_COMPONENTS[appId]
            const isActive = activeApp === appId
            return (
              // data-app-pane is what index.css hangs the "stop painting"
              // rule off. An app stays MOUNTED after its first open (running
              // generations, in-flight polls and unsaved input all have to
              // survive a dock switch) — but opacity-0 does not stop a single
              // frame of work: CSS animations keep ticking, and the Dashboard
              // is the default landing app, so its wallpaper and orrery were
              // animating behind every other screen for the whole session.
              <div
                key={appId}
                data-app-pane={isActive ? 'active' : 'inactive'}
                className={`absolute inset-0 ${
                  isActive ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                }`}
              >
                {/* The app fills the pane exactly — ONE scroll container, the
                    app's own. A `min-h-[600px]` layout floor lived here for a
                    while so a very short window (200% browser zoom) scrolled the
                    app rather than crushing its scrolling middle. It cost more
                    than it bought: below the floor the pane became a SECOND
                    scroller wrapping the whole app, so every panel header and
                    pinned strip — B-Roll's Storyboard/History toggle and its
                    "N Scenes" batch bar especially — slid up the screen as the
                    member scrolled the storyboard. A bar that is `sticky` inside
                    the panel can't hold its ground against a scroller ABOVE the
                    panel, and the two ports rubber-band against each other in
                    between. Pinned chrome that actually stays pinned is worth
                    more than a graceful 450px viewport. */}
                <div className="h-full overflow-y-auto bg-transparent">
                  {Component ? (
                    <Suspense fallback={<AppPlaceholder appId={appId} />}>
                      <Component />
                    </Suspense>
                  ) : (
                    <AppPlaceholder appId={appId} />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <ToastContainer />
        <MeetTheTeam />
        <AnnouncementsHost />
      </div>
    </div>
  )
}
