import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, Coins, ExternalLink, Flame, Moon, RefreshCw, Sun, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useCreditsStore } from '../stores/creditsStore'
import { useBankStore } from '../stores/bankStore'
import { useThemeStore, type ThemePref } from '../stores/themeStore'
import { useCloseOnAppSwitch } from '../hooks/useCloseOnAppSwitch'
import { getAppConfig, SKOOL_COMMUNITY_URL } from '../utils/constants'
import { computeUsageMetrics } from '../utils/usage'
import { creditsToUsd } from '../utils/models'
import AppLogo from './AppLogo'
import CrabSprite from './CrabSprite'
import SettingsModal from './SettingsModal'
import { API_KEY_STEPS } from './apiKeySteps'
import { useBackdropClose } from '../hooks/useBackdropClose'

// Thin macOS-style menu bar: branding + the active app's name on the left,
// credits balance + external quick links + the theme toggle on the right. Pure chrome —
// app navigation stays in the dock.

export default function MenuBar() {
  const activeApp = useAppStore((s) => s.activeApp)
  const openTeamIntro = useAppStore((s) => s.openTeamIntro)
  const appName = activeApp ? getAppConfig(activeApp)?.name : null

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-9 select-none items-center gap-2 border-b border-ink/5 bg-surface-1/75 px-3 backdrop-blur-2xl light:bg-white/75">
      {/* Brand doubles as the "About" menu — clicking it reopens the Meet
          the Team intro (macOS: Apple menu → About This Mac). */}
      <button
        onClick={openTeamIntro}
        title="Meet Your Team"
        className="-mx-1.5 flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-ink/[0.06]"
      >
        <AppLogo className="h-5 w-5" />
        <span className="whitespace-nowrap text-[13px] font-bold tracking-tight text-ink-100">
          UGC{' '}
          <span
            className="italic font-normal"
            style={{ fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }}
          >
            OS
          </span>
        </span>
      </button>
      {/* Active app name, like macOS shows the frontmost app beside the logo,
          set off by a thin divider slash. */}
      {appName && (
        <>
          <span className="text-[12px] font-light leading-none text-ink-500/40" aria-hidden>
            /
          </span>
          <span className="truncate text-[13px] font-medium text-ink-400">{appName}</span>
        </>
      )}

      <div className="flex-1" />

      <StreakItem />
      <CreditsItem />
      {/* External links are desktop chrome — on phones they overflowed the bar. */}
      <MenuLink href="https://kie.ai/billing" label="Get Credits" />
      <MenuLink href={SKOOL_COMMUNITY_URL} label="Community" />
      {/* Explicit Meet your team entry (the wordmark also opens it) — desktop
          only, like the links above; on phones the wordmark stays the way in.
          Sits at the far right of the bar. */}
      <button
        onClick={openTeamIntro}
        className="hidden h-6 shrink-0 items-center rounded-md px-2 text-[12px] text-ink-300 transition-colors hover:bg-ink/[0.06] hover:text-ink-100 sm:flex"
      >
        Meet Your Team
      </button>
      <ThemeItem />
    </header>
  )
}

// Dark ↔ light switch, far right of the bar — System stays a Settings-only
// option. When the preference is System the item shows whichever theme it
// currently resolves to, and clicking flips to the opposite explicit theme.
function ThemeItem() {
  const pref = useThemeStore((s) => s.pref)
  const resolved = useThemeStore((s) => s.resolved)
  const setPref = useThemeStore((s) => s.setPref)

  const current: ThemePref = pref === 'system' ? resolved : pref
  const next: ThemePref = current === 'dark' ? 'light' : 'dark'
  const Icon = current === 'dark' ? Moon : Sun
  const label = current === 'dark' ? 'Dark' : 'Light'

  return (
    <button
      onClick={() => setPref(next)}
      title={`Theme: ${label} — click for ${next === 'dark' ? 'Dark' : 'Light'}`}
      aria-label={`Switch to ${next} mode`}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-300 transition-colors hover:bg-ink/[0.06] hover:text-ink-100"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </button>
  )
}

// Current generation streak as a menu-bar item — hidden until a streak
// exists, clicking opens the Dashboard. Reads the same ledger the Dashboard
// derives everything from.
function StreakItem() {
  const usageDays = useBankStore((s) => s.usageDays)
  const openApp = useAppStore((s) => s.openApp)
  const streak = useMemo(
    () => computeUsageMetrics(usageDays, creditsToUsd).currentStreak,
    [usageDays],
  )
  if (streak === 0) return null

  return (
    <button
      onClick={() => openApp('dashboard')}
      title={`${streak}-day generation streak — open Dashboard`}
      className="flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] text-ink-300 transition-colors hover:bg-ink/[0.06] hover:text-ink-100"
    >
      <Flame className="h-3.5 w-3.5 text-dashboard-400" strokeWidth={1.75} />
      <span className="tabular-nums">{streak}</span>
      {/* Phones get flame + number; the suffix would crowd the bar. */}
      <span className="hidden text-ink-500 sm:inline"> day streak</span>
    </button>
  )
}

// kie.ai balance as a menu-bar item — clicking refreshes it (the coin glyph
// swaps to a spinner). Same polling as the old dock tile: mount + 60s +
// window focus. With no API key saved, the item becomes a red pulsing
// call-to-action that opens a setup guide (nothing can generate without it).
function CreditsItem() {
  const apiKey = useSettingsStore((s) => s.kieApiKey)
  const balance = useCreditsStore((s) => s.balance)
  const refresh = useCreditsStore((s) => s.refresh)
  const [refreshing, setRefreshing] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Both overlays portal to document.body (the blurred menu bar is a
  // containing block for fixed descendants), so they must close on app switch.
  useCloseOnAppSwitch(guideOpen, () => setGuideOpen(false))
  useCloseOnAppSwitch(settingsOpen, () => setSettingsOpen(false))

  useEffect(() => {
    if (!apiKey) return
    refresh()
    const interval = window.setInterval(refresh, 60_000)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [apiKey, refresh])

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  if (!apiKey) {
    return (
      <>
        <button
          onClick={() => setGuideOpen(true)}
          title="No kie.ai API key yet — click for setup instructions"
          className="flex h-6 shrink-0 items-center gap-2 rounded-md px-2 text-[12px] text-red-300 transition-colors hover:bg-ink/[0.06] light:text-red-700"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          {/* Phones get just the pulsing dot — the tooltip + popup carry the message. */}
          <span className="hidden sm:inline">Connect your kie.ai API key</span>
        </button>
        {guideOpen &&
          createPortal(
            <ApiKeyGuide
              onClose={() => setGuideOpen(false)}
              onOpenSettings={() => {
                setGuideOpen(false)
                setSettingsOpen(true)
              }}
            />,
            document.body,
          )}
        {createPortal(
          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />,
          document.body,
        )}
      </>
    )
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={refreshing}
      title="kie.ai credits remaining — click to refresh"
      aria-label="Refresh credits balance"
      className="group flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-300 transition-colors hover:bg-ink/[0.06] hover:text-ink-100 disabled:opacity-60"
    >
      <span className="relative flex h-3.5 w-3.5 items-center justify-center">
        {refreshing ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-ink-400" strokeWidth={1.75} />
        ) : (
          <>
            <Coins className="h-3.5 w-3.5 text-ink-400 group-hover:opacity-0" strokeWidth={1.75} />
            <RefreshCw className="absolute h-3.5 w-3.5 text-ink-300 opacity-0 group-hover:opacity-100" strokeWidth={1.75} />
          </>
        )}
      </span>
      <span>
        <span className="tabular-nums">{balance !== null ? balance.toLocaleString() : '—'}</span>
        {/* On phones the coin glyph + number is enough — the suffix overflowed. */}
        <span className="hidden text-ink-500 sm:inline"> credits left</span>
      </span>
    </button>
  )
}

// Setup guide shown when the user clicks the "no API key" alert (also reused
// by the Dashboard's get-started row). Explains where the key comes from and
// hands off to Settings for the paste + test.
export function ApiKeyGuide({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const backdrop = useBackdropClose(onClose)
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        className="mx-4 w-full max-w-md rounded-3xl border border-ink/10 bg-surface-1 p-5 shadow-2xl lg:mx-0 lg:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/10">
              <CrabSprite variant="kie" className="h-8 w-[2.7rem]" />
            </span>
            <h2 className="text-lg font-semibold tracking-tight text-ink-100">Connect your kie.ai API key</h2>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
              Every generation runs on your own kie.ai key. Add one to start generating.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ol className="space-y-3">
          {API_KEY_STEPS.map((step, i) => (
            <li key={i} className="flex items-start gap-3 text-[13px] leading-relaxed text-ink-400">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-[11px] font-semibold text-ink-300">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-5 flex items-center justify-end gap-2">
          <a
            href="https://kie.ai/api-key"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 items-center gap-1.5 rounded-full border border-ink/10 px-4 text-[13px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/[0.04]"
          >
            Get your key
            <ExternalLink className="h-3.5 w-3.5 text-ink-500" />
          </a>
          <button
            onClick={onOpenSettings}
            className="flex h-9 items-center rounded-full bg-ink px-4 text-[13px] font-medium text-paper transition-opacity hover:opacity-90"
          >
            Open Settings
          </button>
        </div>
      </div>
    </div>
  )
}

function MenuLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hidden h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] text-ink-300 transition-colors hover:bg-ink/[0.06] hover:text-ink-100 sm:flex"
    >
      {label}
      <ArrowUpRight className="h-3 w-3 text-ink-500" strokeWidth={2} />
    </a>
  )
}
