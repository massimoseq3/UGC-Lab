import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Key, Check, ExternalLink, Loader2, AlertCircle, HardDrive, Trash2, LogOut, User, Sun, Moon, Monitor, Palette, FlaskConical, Shield, ChevronRight } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeStore, type ThemePref } from '../stores/themeStore'
import SegmentedToggle from './SegmentedToggle'
import useCloseOnEscape from '../hooks/useCloseOnEscape'
import { useAuthStore } from '../stores/authStore'
import { isCloudEnabled } from '../lib/supabase'
import { kieTestConnection } from '../utils/kie'
import { seedMockData, removeMockData, hasMockData } from '../utils/mockData'
import {
  findOrphanAssets,
  purgeOrphans,
  formatBytes,
  getStorageUsage,
  STORAGE_CAP_BYTES,
  type OrphanAsset,
} from '../utils/orphanCleanup'

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

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  useCloseOnEscape(open, onClose)
  const storedKieKey = useSettingsStore((s) => s.kieApiKey)
  const setKieApiKey = useSettingsStore((s) => s.setKieApiKey)
  const openApp = useAppStore((s) => s.openApp)
  const profile = useAuthStore((s) => s.profile)
  const signOut = useAuthStore((s) => s.signOut)
  const updateDisplayName = useAuthStore((s) => s.updateDisplayName)
  // Call the hook unconditionally (not behind `isCloudEnabled() &&`) so hook
  // order is stable across renders — rules-of-hooks.
  const authUser = useAuthStore((s) => s.user)
  const cloudOn = isCloudEnabled() && !!authUser

  const [kieDraft, setKieDraft] = useState(storedKieKey)
  const [showKie, setShowKie] = useState(false)

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
  // it again. Visible to me only: in local-only mode, on any localhost dev
  // build (cloud env set or not), or to an admin on the live domain. Regular
  // members on the production domain never see it.
  const isLocalhost =
    typeof window !== 'undefined' &&
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(window.location.hostname)
  const showDemoTool = !isCloudEnabled() || isLocalhost || !!profile?.is_admin
  const [demoLoaded, setDemoLoaded] = useState(false)
  const [demoBusy, setDemoBusy] = useState(false)

  useEffect(() => {
    if (open) {
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
      setTestResult({ ok: true, message: `Connected — ${result.credits} credits remaining.` })
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

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="w-full max-w-md mx-4 lg:mx-0 max-h-[90vh] overflow-y-auto rounded-3xl border border-ink/10 bg-surface-1 p-5 lg:p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 id="settings-title" className="text-lg font-semibold tracking-tight text-ink-100">Settings</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-full p-1.5 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* kie.ai key */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm font-medium text-ink-300">
              <Key className="h-3.5 w-3.5 text-ink-500" />
              kie.ai API Key
            </label>
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
          <div className="relative">
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
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-500 transition-colors hover:text-ink-300"
            >
              {showKie ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <p className="text-[11px] leading-relaxed text-ink-500">
            Stored only in this browser. Do not share with anyone.
          </p>

          <button
            type="button"
            onClick={handleTest}
            disabled={!kieDraft.trim() || testing}
            className="flex items-center justify-center gap-2 rounded-full border border-ink/10 bg-ink/[0.03] px-4 py-2 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-ink/[0.03]"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-ink-400" />}
            {testing ? 'Testing connection…' : 'Test connection'}
          </button>

          {testResult && (
            <div
              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px] ${
                testResult.ok
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300 light:text-emerald-700'
                  : 'border-red-500/20 bg-red-500/10 text-red-300 light:text-red-700'
              }`}
            >
              {testResult.ok ? (
                <Check className="mt-0.5 h-3 w-3 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        {(() => {
          const trimmedDraft = kieDraft.trim()
          // Allow clearing a saved key (empty draft) — the only no-op is when
          // the trimmed draft already matches what's stored.
          const hasPendingChange = trimmedDraft !== storedKieKey
          const disabled = saving || saved || !hasPendingChange
          const primary = hasPendingChange && !saving && !saved
          return (
            <button
              onClick={handleSave}
              disabled={disabled}
              className={`mt-4 flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium transition-colors ${
                saved
                  ? 'bg-emerald-500/15 text-emerald-300 light:text-emerald-700'
                  : primary
                    ? 'bg-ink text-ink-900 hover:bg-ink-200'
                    : 'bg-ink/10 text-ink-400 disabled:cursor-not-allowed disabled:opacity-60'
              }`}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
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
          )
        })()}

        {/* Appearance — Dark / Light / System */}
        <div className="mt-6 border-t border-ink/5 pt-5">
          <div className="flex items-center gap-2">
            <Palette className="h-3.5 w-3.5 text-ink-500" />
            <span className="text-sm font-medium text-ink-300">Appearance</span>
          </div>
          <ThemeToggle className="mt-3" />
        </div>

        {/* Account card — email + sign out, only when signed in */}
        {cloudOn && profile && (
          <div className="mt-6 border-t border-ink/5 pt-5">
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-ink-500" />
              <span className="text-sm font-medium text-ink-300">Account</span>
            </div>

            {/* Preferred name — what the Dashboard greeting calls you. */}
            <div className="mt-3">
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
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : nameSaved ? (
                    <><Check className="h-3.5 w-3.5" />Saved</>
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
              {nameError && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300 light:text-red-700">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{nameError}</span>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center gap-3 rounded-lg border border-ink/5 bg-ink/[0.02] px-3 py-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-orange-500 text-[12px] font-semibold text-ink">
                {(profile.email[0] || '?').toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-300">
                {profile.email}
              </span>
            </div>
            <button
              type="button"
              onClick={() => { onClose(); signOut() }}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-ink/10 py-2 text-[12px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.05]"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        )}

        {/* Storage card — only when cloud is active */}
        {cloudOn && (
          <div className="mt-6 border-t border-ink/5 pt-5">
            <div className="flex items-center gap-2">
              <HardDrive className="h-3.5 w-3.5 text-ink-500" />
              <span className="text-sm font-medium text-ink-300">Storage</span>
            </div>

            {/* Usage bar */}
            <div className="mt-3 space-y-1.5">
              {usageLoading ? (
                <div className="flex items-center gap-2 text-[11px] text-ink-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking usage…
                </div>
              ) : usageError ? (
                <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300 light:text-red-700">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{usageError}</span>
                </div>
              ) : (
                <>
                  <div className="flex items-baseline justify-between text-[12px]">
                    <span className="text-ink-200 font-medium">
                      {formatBytes(usedBytes)}
                      <span className="text-ink-500"> of {formatBytes(STORAGE_CAP_BYTES)}</span>
                    </span>
                    <span className="text-[10px] text-ink-500">
                      {usage?.assetCount ?? 0} {usage?.assetCount === 1 ? 'asset' : 'assets'}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.05]">
                    <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  {pct >= 90 && (
                    <p className="text-[10px] text-red-300 light:text-red-700">
                      You're near the {formatBytes(STORAGE_CAP_BYTES)} cap. Free up space below or delete unused items in your banks.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Manual orphan cleanup (auto-cleanup runs on sign-in; this is a power-user fallback) */}
            <div className="mt-4 rounded-lg border border-ink/5 bg-ink/[0.02] p-3">
              <div className="text-[11px] text-ink-500">
                Removes files in your cloud storage that no item in your banks references. Cleanup runs automatically when you sign in — this button is for on-demand sweeps.
              </div>

              {storage.phase === 'idle' && (
                <button
                  type="button"
                  onClick={() => setStorage({ phase: 'confirming' })}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-ink/10 py-1.5 text-[12px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.05]"
                >
                  Clean up storage
                </button>
              )}

              {storage.phase === 'confirming' && (
                <div className="mt-2 space-y-2 rounded-md border border-amber-500/20 bg-amber-500/[0.06] p-2.5">
                  <div className="flex items-start gap-2 text-[11px] text-amber-200 light:text-amber-800">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <div className="space-y-1.5 leading-relaxed">
                      <p className="font-medium text-amber-100 light:text-amber-900">Are you sure you want to do this?</p>
                      <p className="text-amber-200 light:text-amber-800/90">
                        This permanently deletes every file in your cloud storage that no item in your banks or history references. Anything you generated but never saved (or whose history entry you've since cleared) will be removed and cannot be recovered.
                      </p>
                      <p className="text-amber-200 light:text-amber-800/90">
                        Before continuing, make sure anything you want to keep — Playground generations, B-Roll variations, characters, voiceovers, music — has been saved to its bank.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={handleScanOrphans}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-red-500/15 py-1.5 text-[11px] font-medium text-red-200 light:text-red-800 transition-colors hover:bg-red-500/25"
                    >
                      <Trash2 className="h-3 w-3" />
                      Continue
                    </button>
                    <button
                      type="button"
                      onClick={() => setStorage({ phase: 'idle' })}
                      className="rounded-md border border-ink/10 px-2 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05]"
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
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-ink/10 py-1.5 text-[12px] font-medium text-ink-400"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Scanning…
                </button>
              )}

              {storage.phase === 'scanned' && (
                <div className="mt-2 space-y-2">
                  <div className="rounded-md bg-ink/[0.03] px-2.5 py-1.5 text-[11px] text-ink-300">
                    {storage.orphans.length === 0 ? (
                      <span className="flex items-center gap-1.5 text-emerald-400 light:text-emerald-600">
                        <Check className="h-3 w-3" />
                        Clean — no orphans found.
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
                        <div className="max-h-24 overflow-y-auto rounded-md border border-ink/10 bg-ink/[0.02] p-1.5 text-[9px] font-mono text-ink-500">
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
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-red-500/15 py-1.5 text-[11px] font-medium text-red-200 light:text-red-800 transition-colors hover:bg-red-500/25"
                        >
                          <Trash2 className="h-3 w-3" />
                          Free {formatBytes(storage.totalBytes)}
                        </button>
                        <button
                          type="button"
                          onClick={() => setStorage({ phase: 'idle' })}
                          className="rounded-md border border-ink/10 px-2 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05]"
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
                <div className="mt-2 rounded-md bg-ink/[0.03] px-2.5 py-2 text-[11px] text-ink-300">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin text-ink-400" />
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
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300 light:text-emerald-700">
                    <Check className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>Cleaned {storage.cleaned} — freed {formatBytes(storage.bytes)}.{storage.failed > 0 ? ` ${storage.failed} failed.` : ''}</span>
                  </div>
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
                <div className="mt-2 space-y-1.5">
                  <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300 light:text-red-700">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{storage.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStorage({ phase: 'idle' })}
                    className="text-[10px] text-ink-400 transition-colors hover:text-ink-200"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Legal — compact inline footer, docs open in a new tab */}
        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-ink/5 pt-4 text-[11px] text-ink-500">
          {[
            { href: '/legal/terms', label: 'Terms' },
            { href: '/legal/privacy', label: 'Privacy' },
            { href: '/legal/aup', label: 'AUP' },
            { href: '/legal/dmca', label: 'DMCA' },
          ].map((item, i) => (
            <span key={item.href} className="flex items-center gap-2">
              {i > 0 && <span className="text-ink-700">·</span>}
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-ink-300"
              >
                {item.label}
              </a>
            </span>
          ))}
        </div>

        {/* Admin — the Admin app moved out of the dock; this row is the only
            entry point and renders solely for admins. */}
        {profile?.is_admin && (
          <div className="mt-6 border-t border-ink/5 pt-5">
            <div className="flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-ink-500" />
              <span className="text-sm font-medium text-ink-300">Admin</span>
            </div>
            <button
              type="button"
              onClick={() => { onClose(); openApp('admin') }}
              className="mt-3 flex w-full items-center gap-3 rounded-lg border border-ink/5 bg-ink/[0.02] px-3 py-2.5 text-left transition-colors hover:bg-ink/[0.05]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-ink-200">Open Admin panel</span>
                <span className="block text-[11px] text-ink-500">Members, insights, and the allowlist.</span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-500" />
            </button>
          </div>
        )}

        {/* Demo-data tool — deliberately tiny + low-contrast. Admin-only (or
            local-only mode). Populates / wipes placeholder content for review. */}
        {showDemoTool && (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={handleToggleDemo}
              disabled={demoBusy}
              title={demoLoaded ? 'Remove the placeholder demo content from every bank' : 'Fill every bank + generation history with placeholder demo content'}
              className="flex items-center gap-1.5 text-[10px] text-ink-700 transition-colors hover:text-ink-400 disabled:opacity-60"
            >
              {demoBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
              {demoBusy ? (demoLoaded ? 'Removing…' : 'Loading…') : demoLoaded ? 'Remove demo data' : 'Load demo data'}
            </button>
          </div>
        )}
      </div>
    </div>
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
