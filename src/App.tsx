import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import AppLogo from './components/AppLogo'
import AppBackground from './components/AppBackground'

import Dock from './components/Dock'
import MenuBar from './components/MenuBar'
import MeetTheTeam from './components/MeetTheTeam'
import ToastContainer from './components/Toast'
import AuthGate from './components/auth/AuthGate'
import RouterSync from './components/RouterSync'
import LegalAcceptModal from './components/LegalAcceptModal'
import { useAppStore } from './stores/appStore'
import { useAuthStore } from './stores/authStore'
import { getAppConfig } from './utils/constants'

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

  return (
    // h-dvh (not h-screen): 100vh overflows behind mobile browser URL bars,
    // which would push the dock half off-screen on iOS Safari.
    <div key={userId ?? 'local'} className="relative h-dvh w-screen overflow-hidden text-ink antialiased bg-surface-0">
      {/* Universal Background Gradient */}
      <AppBackground />

      <div className="relative z-10 h-full w-full">
        <MenuBar />
        <Dock />

        {/* macOS-style app "window": a rounded, bordered frame floating between
            the menu bar and the dock, desktop gradient peeking around it. App
            chrome clips at the window edge instead of ending in a hard line
            against the dock gutter. */}
        <div className="absolute inset-x-2 bottom-[108px] top-11 overflow-hidden rounded-2xl border border-ink/10 bg-surface-0/60 shadow-2xl shadow-black/25 backdrop-blur-xl md:inset-x-3">
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
      </div>
    </div>
  )
}
