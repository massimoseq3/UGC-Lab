import { useState, useEffect } from 'react'
import type { ElementType, ReactNode } from 'react'
import { X, Eye, EyeOff, Key, Check, ExternalLink, AlertCircle, HardDrive, Trash2, LogOut, User, Sun, Moon, Monitor, Palette, FlaskConical, Shield, ChevronRight, FileText } from 'lucide-react'
import Spinner from './Spinner'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore, type ThemePref } from '../stores/themeStore'
import { useGenerationInfoStore } from '../stores/generationInfoStore'
import { useAppVisible, useAppVisibilityStore, useFeatureEnabled } from '../stores/appVisibilityStore'
import SegmentedToggle from './SegmentedToggle'
import useCloseOnEscape from '../hooks/useCloseOnEscape'
import { useCloseOnAppSwitch } from '../hooks/useCloseOnAppSwitch'
import { useAuthStore } from '../stores/authStore'
import { isCloudEnabled } from '../lib/supabase'
import { kieTestConnection } from '../utils/kie'
import { scTestConnection } from '../utils/scrapecreators'
import { seedMockData, removeMockData, hasMockData } from '../utils/mockData'
import {
  findOrphanAssets,
  purgeOrphans,
  formatBytes,
  getStorageUsage,
  STORAGE_CAP_BYTES,
  type OrphanAsset,
} from '../utils/orphanCleanup'
import { useBackdropClose } from '../hooks/useBackdropClose'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

type StorageState =
  | { phase: 'idle' }
  | { phase: 'confirming' }
  | { phase: 'scanning' }
  | { phase: 'scanned'; orphans: OrphanAsset[]; totalBytes: number }
  | { phase: 'purging'; orphans: OrphanAsset[]; totalBytes: number; done: number; total: number }
  | { phase: 'done'; cleaned: number; bytes: number; failed: number }
  | { phase: 'error'; message: string }

// One pane per concern, listed in the left rail. 'api' is the landing pane —
// it's the setting the app can't run without, and the Dashboard's connect-key
// card opens Settings expecting it.
type SectionId = 'api' | 'account' | 'appearance' | 'experimental' | 'storage' | 'advanced' | 'about'

const DEFAULT_SECTION: SectionId = 'api'

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  useCloseOnEscape(open, onClose)
  useCloseOnAppSwitch(open, onClose)
  const storedKieKey = useSettingsStore((s) => s.kieApiKey)
  const setKieApiKey = useSettingsStore((s) => s.setKieApiKey)
  const storedScKey = useSettingsStore((s) => s.scrapeCreatorsKey)
  const setScrapeCreatorsKey = useSettingsStore((s) => s.setScrapeCreatorsKey)
  const openApp = useAppStore((s) => s.openApp)
  const openTeamIntro = useAppStore((s) => s.openTeamIntro)
  const profile = useAuthStore((s) => s.profile)
  const signOut = useAuthStore((s) => s.signOut)
  const updateDisplayName = useAuthStore((s) => s.updateDisplayName)
  // Call the hook unconditionally (not behind `isCloudEnabled() &&`) so hook
  // order is stable across renders — rules-of-hooks.
  const authUser = useAuthStore((s) => s.user)
  const cloudOn = isCloudEnabled() && !!authUser

  const [section, setSection] = useState<SectionId>(DEFAULT_SECTION)

  const [kieDraft, setKieDraft] = useState(storedKieKey)
  const [showKie, setShowKie] = useState(false)

  // ScrapeCreators — the Outliers search key. Optional: everything else in the
  // app works without it, so it never gates the rail's alert dot.
  const [scDraft, setScDraft] = useState(storedScKey)
  const [showSc, setShowSc] = useState(false)
  const [scSaving, setScSaving] = useState(false)
  const [scSaved, setScSaved] = useState(false)
  const [scTesting, setScTesting] = useState(false)
  const [scTestResult, setScTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // "What should we call you?" — edits profiles.display_name.
  const storedName = profile?.display_name ?? ''
  const [nameDraft, setNameDraft] = useState(storedName)
  const [nameSaving, setNameSaving] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Storage panel state
  const [usage, setUsage] = useState<{ totalBytes: number; assetCount: number } | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [storage, setStorage] = useState<StorageState>({ phase: 'idle' })
  const [showOrphanList, setShowOrphanList] = useState(false)

  // Demo-data tool — populates every bank + the generation histories with
  // placeholder content to review the UI without spending credits, then wipes
  // it again. Visible to me only: whenever there are accounts at all it takes
  // `is_admin`, so a member never sees it wherever they run the app (a
  // localhost exception was here and is gone — it let a signed-in member
  // running a dev build against the live cloud seed their own banks). A
  // local-only build has no accounts and no members, so the tool stays.
  const showDemoTool = !isCloudEnabled() || !!profile?.is_admin
  const [demoLoaded, setDemoLoaded] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)

  // Generation info — the model-name pill on generated media. Same "me only"
  // gate as the demo tool above: it's on for every member and they never see
  // the switch, which exists so a screen recording can be made without the
  // model named on every tile.
  const showGenerationInfo = useGenerationInfoStore((s) => s.show)
  const setShowGenerationInfo = useGenerationInfoStore((s) => s.setShow)

  // Outliers — the one app a member can switch off, and it ships on; B-Roll's
  // Continuous mode is the same deal one level down, and ships off. See
  // stores/appVisibilityStore for what each switch actually moves.
  const outliersOn = useAppVisible('discover')
  const continuousOn = useFeatureEnabled('broll-continuous')
  const setOptionalEnabled = useAppVisibilityStore((s) => s.setOptionalEnabled)

  useEffect(() => {
    if (open) {
      setSection(DEFAULT_SECTION)
      setKieDraft(storedKieKey)
      setNameDraft(storedName)
      setNameSaving(false)
      setNameSaved(false)
      setNameError(null)
      setSaving(false)
      setSaved(false)
      setShowKie(false)
      setTestResult(null)
      setStorage({ phase: 'idle' })
      setShowOrphanList(false)
      setDemoLoaded(hasMockData())
      setDemoBusy(false)
      if (cloudOn) loadUsage()
    }
    // Intentionally depend only on `open` — re-running this when storedKieKey
    // changes (e.g. right after a save) would wipe the just-set `saved` flash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const backdrop = useBackdropClose(onClose)

  async function loadUsage() {
    setUsageLoading(true)
    setUsageError(null)
    try {
      const u = await getStorageUsage()
      setUsage(u)
    } catch (e) {
      setUsageError(e instanceof Error ? e.message : String(e))
    } finally {
      setUsageLoading(false)
    }
  }

  if (!open) return null

  async function handleSave() {
    setSaving(true)
    // Brief delay so the user sees the spinner — the underlying write to
    // localStorage is synchronous and would otherwise look unresponsive.
    await new Promise((resolve) => setTimeout(resolve, 350))
    setKieApiKey(kieDraft.trim())
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleSaveSc() {
    setScSaving(true)
    // Same cosmetic delay as the kie save — the write itself is synchronous.
    await new Promise((resolve) => setTimeout(resolve, 350))
    setScrapeCreatorsKey(scDraft.trim())
    setScSaving(false)
    setScSaved(true)
    setTimeout(() => setScSaved(false), 2000)
  }

  async function handleTestSc() {
    if (!scDraft.trim()) return
    setScTesting(true)
    setScTestResult(null)
    // Infra surface — show ScrapeCreators' own message, not humanizeError copy.
    const result = await scTestConnection(scDraft.trim())
    if (result.ok) {
      setScTestResult({
        ok: true,
        message: result.credits === null
          ? 'Connected.'
          : `Connected · ${result.credits.toLocaleString()} credits remaining.`,
      })
    } else {
      setScTestResult({ ok: false, message: result.error })
    }
    setScTesting(false)
  }

  async function handleSaveName() {
    setNameSaving(true)
    setNameError(null)
    const result = await updateDisplayName(nameDraft)
    setNameSaving(false)
    if (result.ok) {
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 2000)
    } else {
      setNameError(result.error)
    }
  }

  async function handleTest() {
    if (!kieDraft.trim()) return
    setTesting(true)
    setTestResult(null)
    const result = await kieTestConnection(kieDraft.trim())
    if (result.ok) {
      setTestResult({ ok: true, message: `Connected · ${result.credits} credits remaining.` })
    } else {
      setTestResult({ ok: false, message: result.error })
    }
    setTesting(false)
  }

  async function handleScanOrphans() {
    setStorage({ phase: 'scanning' })
    setShowOrphanList(false)
    try {
      const result = await findOrphanAssets()
      setStorage({ phase: 'scanned', orphans: result.orphans, totalBytes: result.totalBytes })
    } catch (e) {
      setStorage({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function handlePurgeOrphans() {
    if (storage.phase !== 'scanned') return
    const orphans = storage.orphans
    const totalBytes = storage.totalBytes
    setStorage({ phase: 'purging', orphans, totalBytes, done: 0, total: orphans.length })
    const result = await purgeOrphans(
      orphans.map((o) => o.id),
      (done, total) => setStorage({ phase: 'purging', orphans, totalBytes, done, total }),
    )
    setStorage({
      phase: 'done',
      cleaned: result.ok,
      bytes: orphans.slice(0, result.ok).reduce((s, o) => s + Number(o.byte_size ?? 0), 0),
      failed: result.failed.length,
    })
    // Refresh the bar
    loadUsage()
  }

  async function handleToggleDemo() {
    if (demoBusy) return
    setDemoBusy(true)
    try {
      if (demoLoaded) {
        await removeMockData()
        setDemoLoaded(false)
      } else {
        await seedMockData()
        setDemoLoaded(true)
      }
    } catch {
      // Best-effort dev tool — re-sync the button to the actual manifest state.
      setDemoLoaded(hasMockData())
    } finally {
      setDemoBusy(false)
    }
  }

  // Storage usage bar tier colors
  const usedBytes = usage?.totalBytes ?? 0
  const pct = Math.min(100, (usedBytes / STORAGE_CAP_BYTES) * 100)
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500'

  const hasKey = storedKieKey.trim().length > 0
  const showAdvanced = !!profile?.is_admin || showDemoTool

  // The rail is built from what this member actually has — a local-only build
  // has no Account or Storage pane, and Advanced only exists for me.
  const sections: Array<{ id: SectionId; label: string; icon: ElementType; alert?: boolean }> = [
    // Two keys live here now (kie.ai + the optional ScrapeCreators one), so the
    // label is plural. The alert dot still tracks kie.ai alone — it's the only
    // one the app can't function without.
    { id: 'api', label: 'API keys', icon: Key, alert: !hasKey },
    ...(cloudOn && profile ? [{ id: 'account' as const, label: 'Account', icon: User }] : []),
    { id: 'appearance', label: 'Appearance', icon: Palette },
    // The opt-in apps. Its own pane rather than a card under Appearance: what
    // renders in the dock is not a matter of how the workspace looks, and this
    // is the list that grows every time something ships behind a switch.
    { id: 'experimental', label: 'Experimental', icon: FlaskConical },
    ...(cloudOn ? [{ id: 'storage' as const, label: 'Storage', icon: HardDrive }] : []),
    ...(showAdvanced ? [{ id: 'advanced' as const, label: profile?.is_admin ? 'Admin' : 'Advanced', icon: Shield }] : []),
    { id: 'about', label: 'About', icon: FileText },
  ]
  // A pane can disappear under us (sign-out drops Account), so never trust the
  // stored id blindly.
  const active = sections.find((s) => s.id === section) ?? sections[0]

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        /* A fixed height keeps the rail steady — a modal that resized per
           section would jump under the cursor on every switch. */
        className="flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-ink/10 bg-surface-1 shadow-2xl sm:h-[520px] sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Nav rail — a recessed column on desktop, a scrolling pill row on phones */}
        <nav className="flex shrink-0 flex-col gap-3 border-b border-ink/5 bg-surface-0 p-3 sm:w-[196px] sm:border-b-0 sm:border-r sm:p-4">
          <h2 id="settings-title" className="px-2 text-sm font-semibold tracking-tight text-ink-100">
            Settings
          </h2>
          <div className="scrollbar-hide flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
            {sections.map((s) => (
              <RailItem
                key={s.id}
                icon={s.icon}
                label={s.label}
                active={s.id === active.id}
                alert={s.alert}
                onClick={() => setSection(s.id)}
              />
            ))}
          </div>
        </nav>

        {/* Pane */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[57px] shrink-0 items-center justify-between border-b border-ink/5 px-5">
            <div className="flex min-w-0 items-center gap-2">
              <active.icon className="h-4 w-4 shrink-0 text-ink-500" />
              <span className="truncate text-sm font-medium text-ink-200">{active.label}</span>
            </div>
            <button
              onClick={onClose}
              aria-label="Close settings"
              className="rounded-full p-1.5 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {active.id === 'api' && (
              <Section>
                <Card>
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-medium text-ink-300">kie.ai API key</label>
                    <a
                      href="https://kie.ai/api-key"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-ink-500 transition-colors hover:text-ink-300"
                    >
                      Get key
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="relative mt-2">
                    <input
                      type={showKie ? 'text' : 'password'}
                      value={kieDraft}
                      onChange={(e) => {
                        setKieDraft(e.target.value)
                        setTestResult(null)
                      }}
                      placeholder="sk-..."
                      className="w-full rounded-full border border-ink/10 bg-ink/5 px-4 py-2.5 pr-10 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKie(!showKie)}
                      aria-label={showKie ? 'Hide kie.ai API key' : 'Show kie.ai API key'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-500 transition-colors hover:text-ink-300"
                    >
                      {showKie ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  <div className="mt-2.5 flex items-center gap-2 text-[11px] text-ink-500">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasKey ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                    {hasKey ? 'Key saved.' : 'No key saved yet.'}
                  </div>

                  {(() => {
                    const trimmedDraft = kieDraft.trim()
                    // Allow clearing a saved key (empty draft) — the only no-op is
                    // when the trimmed draft already matches what's stored.
                    const hasPendingChange = trimmedDraft !== storedKieKey
                    const disabled = saving || saved || !hasPendingChange
                    const primary = hasPendingChange && !saving && !saved
                    return (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={handleTest}
                          disabled={!kieDraft.trim() || testing}
                          className="flex shrink-0 items-center justify-center gap-2 rounded-full border border-ink/10 bg-ink/[0.03] px-4 py-2.5 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-ink/[0.03]"
                        >
                          {testing ? <Spinner className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5 text-ink-400" />}
                          {testing ? 'Testing…' : 'Test connection'}
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={disabled}
                          className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-medium transition-colors ${
                            saved
                              ? 'bg-emerald-500/15 text-emerald-300 light:text-emerald-700'
                              : primary
                                ? 'bg-ink text-ink-900 hover:bg-ink-200'
                                : 'bg-ink/10 text-ink-400 disabled:cursor-not-allowed disabled:opacity-60'
                          }`}
                        >
                          {saving ? (
                            <>
                              <Spinner className="h-4 w-4" />
                              <span>Saving…</span>
                            </>
                          ) : saved ? (
                            <>
                              <Check className="h-4 w-4" />
                              <span>Saved</span>
                            </>
                          ) : (
                            'Save'
                          )}
                        </button>
                      </div>
                    )
                  })()}

                  {testResult && (
                    <Banner tone={testResult.ok ? 'ok' : 'error'} className="mt-3">
                      {testResult.message}
                    </Banner>
                  )}
                </Card>

                {/* The ScrapeCreators key powers Outliers and nothing else,
                    so it goes with the app: a member who has switched Outliers
                    off is not asked for a key they have no use for. The saved
                    value is kept, and comes back with the app. */}
                {outliersOn && (
                  <Card>
                    <div className="flex items-center justify-between">
                      <label className="text-[12px] font-medium text-ink-300">
                        ScrapeCreators key
                        <span className="ml-1.5 text-[11px] font-normal text-ink-600">(for Outliers)</span>
                      </label>
                      <a
                        href="https://scrapecreators.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] text-ink-500 transition-colors hover:text-ink-300"
                      >
                        Get key
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="relative mt-2">
                      <input
                        type={showSc ? 'text' : 'password'}
                        value={scDraft}
                        onChange={(e) => {
                          setScDraft(e.target.value)
                          setScTestResult(null)
                        }}
                        placeholder="Paste your ScrapeCreators key"
                        className="w-full rounded-full border border-ink/10 bg-ink/5 px-4 py-2.5 pr-10 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSc(!showSc)}
                        aria-label={showSc ? 'Hide ScrapeCreators key' : 'Show ScrapeCreators key'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-500 transition-colors hover:text-ink-300"
                      >
                        {showSc ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    <div className="mt-2.5 flex items-center gap-2 text-[11px] text-ink-500">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${storedScKey ? 'bg-emerald-500' : 'bg-ink/20'}`} />
                      {storedScKey ? 'Key saved.' : 'No key saved yet.'}
                    </div>

                    {(() => {
                      const trimmedDraft = scDraft.trim()
                      const hasPendingChange = trimmedDraft !== storedScKey
                      const disabled = scSaving || scSaved || !hasPendingChange
                      const primary = hasPendingChange && !scSaving && !scSaved
                      return (
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={handleTestSc}
                            disabled={!trimmedDraft || scTesting}
                            className="flex shrink-0 items-center justify-center gap-2 rounded-full border border-ink/10 bg-ink/[0.03] px-4 py-2.5 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-ink/[0.03]"
                          >
                            {scTesting ? <Spinner className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5 text-ink-400" />}
                            {scTesting ? 'Testing…' : 'Test connection'}
                          </button>
                          <button
                            onClick={handleSaveSc}
                            disabled={disabled}
                            className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-medium transition-colors ${
                              scSaved
                                ? 'bg-emerald-500/15 text-emerald-300 light:text-emerald-700'
                                : primary
                                  ? 'bg-ink text-ink-900 hover:bg-ink-200'
                                  : 'bg-ink/10 text-ink-400 disabled:cursor-not-allowed disabled:opacity-60'
                            }`}
                          >
                            {scSaving ? (
                              <>
                                <Spinner className="h-4 w-4" />
                                <span>Saving…</span>
                              </>
                            ) : scSaved ? (
                              <>
                                <Check className="h-4 w-4" />
                                <span>Saved</span>
                              </>
                            ) : (
                              'Save'
                            )}
                          </button>
                        </div>
                      )
                    })()}

                    {scTestResult && (
                      <Banner tone={scTestResult.ok ? 'ok' : 'error'} className="mt-3">
                        {scTestResult.message}
                      </Banner>
                    )}
                  </Card>
                )}

                <p className="text-[11px] leading-relaxed text-ink-500">
                  Stored only in this browser. Do not share with anyone.
                </p>
              </Section>
            )}

            {active.id === 'appearance' && (
              <Section>
                <ThemeToggle />
              </Section>
            )}

            {active.id === 'experimental' && (
              <Section>
                {/* One switch per optional app or feature — each carries its
                    own default (Outliers on, Continuous off); see
                    stores/appVisibilityStore for what each one moves. */}
                <Card>
                  <ToggleRow
                    label="Outliers"
                    hint="Ad research: the Outlier Vault, plus TikTok and Meta Ad Library search. Off hides the Bank's Swipe File tab too. Nothing is deleted."
                    checked={outliersOn}
                    onChange={(next) => setOptionalEnabled('discover', next)}
                  />
                </Card>
                <Card>
                  <ToggleRow
                    label="Continuous B-Roll"
                    hint="B-Roll's second mode: one keyframe chain instead of a shot per line. Off holds B-Roll in Line-by-Line and hides Continuous sessions in its History. Nothing is deleted."
                    checked={continuousOn}
                    onChange={(next) => setOptionalEnabled('broll-continuous', next)}
                  />
                </Card>
              </Section>
            )}

            {active.id === 'account' && profile && (
              <Section>
                <div className="flex items-center gap-3 rounded-2xl border border-ink/5 bg-ink/[0.02] px-4 py-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-orange-500 text-sm font-semibold text-white">
                    {(profile.display_name?.[0] || profile.first_name?.[0] || profile.email[0] || '?').toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    {(profile.display_name || profile.first_name) && (
                      <span className="block truncate text-[13px] font-medium text-ink-100">
                        {profile.display_name || profile.first_name}
                      </span>
                    )}
                    <span className="block truncate text-[12px] text-ink-500">{profile.email}</span>
                  </span>
                </div>

                {/* Preferred name — what the Dashboard greeting calls you. */}
                <Card>
                  <label className="text-[12px] font-medium text-ink-300">What should we call you?</label>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={nameDraft}
                      onChange={(e) => {
                        setNameDraft(e.target.value)
                        setNameError(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && nameDraft.trim() !== storedName.trim() && !nameSaving) handleSaveName()
                      }}
                      placeholder={profile.first_name ?? 'Your name'}
                      maxLength={40}
                      className="min-w-0 flex-1 rounded-full border border-ink/10 bg-ink/5 px-4 py-2 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
                    />
                    <button
                      type="button"
                      onClick={handleSaveName}
                      disabled={nameSaving || nameSaved || nameDraft.trim() === storedName.trim()}
                      className={`flex shrink-0 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-medium transition-colors ${
                        nameSaved
                          ? 'bg-emerald-500/15 text-emerald-300 light:text-emerald-700'
                          : nameDraft.trim() !== storedName.trim() && !nameSaving
                            ? 'bg-ink text-ink-900 hover:bg-ink-200'
                            : 'bg-ink/10 text-ink-400 disabled:cursor-not-allowed disabled:opacity-60'
                      }`}
                    >
                      {nameSaving ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : nameSaved ? (
                        <><Check className="h-3.5 w-3.5" />Saved</>
                      ) : (
                        'Save'
                      )}
                    </button>
                  </div>
                  {nameError && (
                    <Banner tone="error" className="mt-2">{nameError}</Banner>
                  )}
                </Card>

                <button
                  type="button"
                  onClick={() => { onClose(); signOut() }}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-ink/10 py-2.5 text-[12px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.05]"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </Section>
            )}

            {active.id === 'storage' && (
              <Section>
                <Card>
                  {usageLoading ? (
                    <div className="flex items-center gap-2 text-[11px] text-ink-500">
                      <Spinner className="h-3 w-3" />
                      Checking usage…
                    </div>
                  ) : usageError ? (
                    <Banner tone="error">{usageError}</Banner>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[13px] font-medium text-ink-100">
                          {formatBytes(usedBytes)}
                          <span className="text-ink-500"> of {formatBytes(STORAGE_CAP_BYTES)}</span>
                        </span>
                        <span className="text-[11px] text-ink-500">
                          {usage?.assetCount ?? 0} {usage?.assetCount === 1 ? 'asset' : 'assets'}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.05]">
                        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      {pct >= 90 && (
                        <p className="mt-2 text-[10px] text-red-300 light:text-red-700">
                          You're near the {formatBytes(STORAGE_CAP_BYTES)} cap. Free up space below or delete unused items in your banks.
                        </p>
                      )}
                    </>
                  )}
                </Card>

                {/* Manual orphan cleanup (auto-cleanup runs on sign-in; this is a power-user fallback) */}
                <Card>
                  <span className="text-[12px] font-medium text-ink-300">Clean Up Unused Files</span>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                    Removes cloud files no item in your banks references. Runs automatically on sign-in. This is the on-demand sweep.
                  </p>

                  {storage.phase === 'idle' && (
                    <button
                      type="button"
                      onClick={() => setStorage({ phase: 'confirming' })}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-ink/10 py-2 text-[12px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.05]"
                    >
                      Clean up storage
                    </button>
                  )}

                  {storage.phase === 'confirming' && (
                    <div className="mt-3 space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
                      <div className="flex items-start gap-2 text-[11px] text-amber-200 light:text-amber-800">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        <div className="space-y-1.5 leading-relaxed">
                          <p className="font-medium text-amber-100 light:text-amber-900">Are you sure you want to do this?</p>
                          <p className="text-amber-200 light:text-amber-800/90">
                            This permanently deletes every file in your cloud storage that no item in your banks or history references. Anything you generated but never saved (or whose history entry you've since cleared) will be removed and cannot be recovered.
                          </p>
                          <p className="text-amber-200 light:text-amber-800/90">
                            Before continuing, make sure anything you want to keep, from Playground generations, B-Roll variations, characters, voiceovers and music, has been saved to its bank.
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={handleScanOrphans}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-red-500/15 py-2 text-[11px] font-medium text-red-200 light:text-red-800 transition-colors hover:bg-red-500/25"
                        >
                          <Trash2 className="h-3 w-3" />
                          Continue
                        </button>
                        <button
                          type="button"
                          onClick={() => setStorage({ phase: 'idle' })}
                          className="rounded-full border border-ink/10 px-3 py-2 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {storage.phase === 'scanning' && (
                    <button
                      type="button"
                      disabled
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-ink/10 py-2 text-[12px] font-medium text-ink-400"
                    >
                      <Spinner className="h-3 w-3" />
                      Scanning…
                    </button>
                  )}

                  {storage.phase === 'scanned' && (
                    <div className="mt-3 space-y-2">
                      <div className="rounded-lg bg-ink/[0.03] px-3 py-2 text-[11px] text-ink-300">
                        {storage.orphans.length === 0 ? (
                          <span className="flex items-center gap-1.5 text-emerald-400 light:text-emerald-600">
                            <Check className="h-3 w-3" />
                            Clean. No orphans found.
                          </span>
                        ) : (
                          <>
                            Found <span className="font-mono text-ink-100">{storage.orphans.length}</span> orphan{storage.orphans.length === 1 ? '' : 's'} ({formatBytes(storage.totalBytes)}).
                          </>
                        )}
                      </div>

                      {storage.orphans.length > 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => setShowOrphanList((v) => !v)}
                            className="text-[10px] text-ink-400 transition-colors hover:text-ink-200"
                          >
                            {showOrphanList ? 'Hide' : 'Show'} details
                          </button>
                          {showOrphanList && (
                            <div className="max-h-24 overflow-y-auto rounded-lg border border-ink/10 bg-ink/[0.02] p-1.5 text-[9px] font-mono text-ink-500">
                              {storage.orphans.map((o) => (
                                <div key={o.id} className="truncate">
                                  {o.id} · {formatBytes(Number(o.byte_size ?? 0))} · {o.mime_type}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={handlePurgeOrphans}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-red-500/15 py-2 text-[11px] font-medium text-red-200 light:text-red-800 transition-colors hover:bg-red-500/25"
                            >
                              <Trash2 className="h-3 w-3" />
                              Free {formatBytes(storage.totalBytes)}
                            </button>
                            <button
                              type="button"
                              onClick={() => setStorage({ phase: 'idle' })}
                              className="rounded-full border border-ink/10 px-3 py-2 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05]"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      )}

                      {storage.orphans.length === 0 && (
                        <button
                          type="button"
                          onClick={() => setStorage({ phase: 'idle' })}
                          className="text-[10px] text-ink-400 transition-colors hover:text-ink-200"
                        >
                          Done
                        </button>
                      )}
                    </div>
                  )}

                  {storage.phase === 'purging' && (
                    <div className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-[11px] text-ink-300">
                      <div className="flex items-center gap-2">
                        <Spinner className="h-3 w-3 text-ink-400" />
                        Cleaning… {storage.done} of {storage.total}
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.04]">
                        <div
                          className="h-full bg-emerald-400/60 transition-all"
                          style={{ width: `${storage.total === 0 ? 0 : Math.round((storage.done / storage.total) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {storage.phase === 'done' && (
                    <div className="mt-3 space-y-1.5">
                      <Banner tone="ok">
                        Cleaned {storage.cleaned} · freed {formatBytes(storage.bytes)}.{storage.failed > 0 ? ` ${storage.failed} failed.` : ''}
                      </Banner>
                      <button
                        type="button"
                        onClick={() => setStorage({ phase: 'idle' })}
                        className="text-[10px] text-ink-400 transition-colors hover:text-ink-200"
                      >
                        Done
                      </button>
                    </div>
                  )}

                  {storage.phase === 'error' && (
                    <div className="mt-3 space-y-1.5">
                      <Banner tone="error">{storage.message}</Banner>
                      <button
                        type="button"
                        onClick={() => setStorage({ phase: 'idle' })}
                        className="text-[10px] text-ink-400 transition-colors hover:text-ink-200"
                      >
                        Try again
                      </button>
                    </div>
                  )}
                </Card>
              </Section>
            )}

            {active.id === 'advanced' && (
              <Section>
                {/* The Admin app moved out of the dock; this row is its only
                    entry point and renders solely for admins. */}
                {profile?.is_admin && (
                  <button
                    type="button"
                    onClick={() => { onClose(); openApp('admin') }}
                    className="flex w-full items-center gap-3 rounded-2xl border border-ink/5 bg-ink/[0.02] px-4 py-3 text-left transition-colors hover:bg-ink/[0.05]"
                  >
                    <Shield className="h-4 w-4 shrink-0 text-ink-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium text-ink-200">Open Admin Panel</span>
                      <span className="block text-[11px] text-ink-500">Members, insights, and the allowlist.</span>
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-500" />
                  </button>
                )}

                {/* Generation info. On for every member, and this row is the
                    only place it can be turned off — same operator-only gate as
                    the demo tool below, and browser-local, so switching it off
                    to record a clean screen never touches anyone else. */}
                {showDemoTool && (
                  <Card>
                    <ToggleRow
                      label="Generation Info"
                      hint="Name the model on generated media: Playground's list rows and preview, and B-Roll's cards. On for everyone; this switch is yours alone and only affects this browser."
                      checked={showGenerationInfo}
                      onChange={setShowGenerationInfo}
                    />
                  </Card>
                )}

                {showDemoTool && (
                  <Card>
                    <span className="text-[12px] font-medium text-ink-300">Demo Data</span>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                      Placeholder content in every bank and history. Fully reversible.
                    </p>
                    <button
                      type="button"
                      onClick={handleToggleDemo}
                      disabled={demoBusy}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-ink/10 py-2 text-[12px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {demoBusy ? <Spinner className="h-3.5 w-3.5" /> : <FlaskConical className="h-3.5 w-3.5" />}
                      {demoBusy ? (demoLoaded ? 'Removing…' : 'Loading…') : demoLoaded ? 'Remove demo data' : 'Load demo data'}
                    </button>
                  </Card>
                )}
              </Section>
            )}

            {active.id === 'about' && (
              <Section>
                {/* The way back into the intro, now that the menu bar no longer
                    carries one. Settings closes first — the intro is a modal of
                    its own and would otherwise open over this one. */}
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    openTeamIntro()
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-ink/5 bg-ink/[0.02] px-4 py-3 text-left transition-colors hover:bg-ink/[0.05]"
                >
                  <span className="min-w-0 flex-1 text-[12px] font-medium text-ink-200">Meet Your Team</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-500" />
                </button>
                <div className="overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.02]">
                  {LEGAL_LINKS.map((item, i) => (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink/[0.05] ${i > 0 ? 'border-t border-ink/5' : ''}`}
                    >
                      <span className="min-w-0 flex-1 text-[12px] font-medium text-ink-200">{item.label}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-ink-500" />
                    </a>
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const LEGAL_LINKS = [
  { href: '/legal/terms', label: 'Terms of Service' },
  { href: '/legal/privacy', label: 'Privacy Policy' },
  { href: '/legal/aup', label: 'Acceptable Use Policy' },
  { href: '/legal/dmca', label: 'DMCA' },
]

// A pane — stacked cards, evenly spaced.
function Section({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>
}

// A labelled switch inside a Card — the one toggle shape in this modal. The
// label doubles as the accessible name, so a new row can't ship without one.
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-ink-300">{label}</span>
        <span className="mt-1 block text-[11px] leading-relaxed text-ink-500">{hint}</span>
      </span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-emerald-500' : 'bg-ink/20'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-ink/5 bg-ink/[0.02] p-4">{children}</div>
}

function Banner({ tone, className = '', children }: { tone: 'ok' | 'error'; className?: string; children: ReactNode }) {
  const ok = tone === 'ok'
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
        ok
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300 light:text-emerald-700'
          : 'border-red-500/20 bg-red-500/10 text-red-300 light:text-red-700'
      } ${className}`}
    >
      {ok ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />}
      <span>{children}</span>
    </div>
  )
}

function RailItem({
  icon: Icon,
  label,
  active,
  alert,
  onClick,
}: {
  icon: ElementType
  label: string
  active: boolean
  alert?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-medium tracking-tight transition-colors ${
        active
          ? 'bg-ink/10 text-ink-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] light:shadow-none'
          : 'text-ink-400 hover:bg-ink/5 hover:text-ink-200'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
      {alert && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 sm:ml-auto" />}
    </button>
  )
}

const THEME_OPTIONS: Array<{ value: ThemePref; label: string; icon: typeof Sun }> = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
]

function ThemeToggle({ className = '' }: { className?: string }) {
  const pref = useThemeStore((s) => s.pref)
  const setPref = useThemeStore((s) => s.setPref)

  return (
    <SegmentedToggle<ThemePref>
      className={className}
      value={pref}
      onChange={setPref}
      options={THEME_OPTIONS.map(({ value, label, icon }) => ({ value, label, icon }))}
    />
  )
}
