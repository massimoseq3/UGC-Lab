import { useState } from 'react'
import { ArrowUpRight, Check, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { useCreditsStore } from '../stores/creditsStore'
import { kieTestConnection } from '../utils/kie'
import { useBackdropClose } from '../hooks/useBackdropClose'
import useCloseOnEscape from '../hooks/useCloseOnEscape'
import { useCloseOnAppSwitch } from '../hooks/useCloseOnAppSwitch'
import CrabSprite from './CrabSprite'

// Getting started, shown from the menu bar's no-key alert and the Dashboard's
// connect banner. It used to explain the three steps and send the member to
// Settings to do the actual work — which meant reading instructions, closing
// them, finding the gear, and re-reading them from memory.
//
// So the key is pasted HERE. The guide is the setup: open kie.ai, paste, and
// the key is verified against the live balance before it's saved, so "connected"
// means connected rather than "something is stored". Settings stays the place
// to change or clear a key later; a link at the foot goes there.
//
// This is an infra surface, so a failed check shows kie.ai's own message — the
// member (or the operator helping them) needs the real reason, not friendly copy.

type Status =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'connected'; credits: number }
  | { phase: 'error'; message: string }

/**
 * The connect-a-key transaction, shared by this modal and the Meet-your-team
 * intro. The rule that has to hold in both places: the key is checked against
 * the live balance BEFORE it is saved, so nothing is ever stored that can't
 * generate. Each surface draws its own markup around it.
 */
export function useKeyConnect() {
  const setKieApiKey = useSettingsStore((s) => s.setKieApiKey)
  const refreshCredits = useCreditsStore((s) => s.refresh)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<Status>({ phase: 'idle' })

  const key = draft.trim()

  async function connect() {
    if (!key || status.phase === 'checking') return
    setStatus({ phase: 'checking' })
    const result = await kieTestConnection(key)
    if (!result.ok) {
      setStatus({ phase: 'error', message: result.error })
      return
    }
    setKieApiKey(key)
    refreshCredits()
    setStatus({ phase: 'connected', credits: result.credits })
  }

  return {
    draft,
    key,
    status,
    connected: status.phase === 'connected',
    connect,
    setDraft: (value: string) => {
      setDraft(value)
      setStatus({ phase: 'idle' })
    },
  }
}

export default function ApiKeyGuide({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const backdrop = useBackdropClose(onClose)
  const { draft, key, status, connected, connect, setDraft } = useKeyConnect()
  const [reveal, setReveal] = useState(false)
  // Step 1 ticks off when the member actually opens kie.ai — the only signal
  // this side of the browser that they went to fetch a key.
  const [visitedKie, setVisitedKie] = useState(false)

  useCloseOnEscape(true, onClose)
  useCloseOnAppSwitch(true, onClose)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" {...backdrop}>
      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-ink/10 bg-surface-1 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Amber wash behind the header ties the panel to kie.ai's own colour. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(420px_180px_at_18%_0%,rgba(242,178,49,0.16),transparent_75%)]"
        />

        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative p-5 lg:p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/10">
            <CrabSprite variant="kie" className="h-8 w-[2.7rem]" />
          </span>
          <h2 className="mt-3 text-lg font-semibold tracking-tight text-ink-100">
            {connected ? 'You’re connected' : 'Connect your kie.ai API key'}
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
            {connected
              ? 'Every app in the workspace can generate now. Top up anytime via Get Credits in the menu bar.'
              : 'Every generation runs on your own kie.ai key. It takes a minute to set up.'}
          </p>

          {/* Two real steps on a rail: fetch the key, then paste it. The rail
              runs between the markers so the pair reads as one flow. */}
          <ol className="relative mt-5 space-y-4">
            <span aria-hidden className="absolute bottom-3 left-[11px] top-3 w-px bg-ink/10" />

            <Step index={1} done={visitedKie || connected} label="Grab your API key from kie.ai">
              <a
                href="https://kie.ai/api-key"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setVisitedKie(true)}
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/[0.06]"
              >
                Open kie.ai
                <ArrowUpRight className="h-3.5 w-3.5 text-ink-500" strokeWidth={2} />
              </a>
            </Step>

            <Step index={2} done={connected} label={connected ? 'Key saved to this browser' : 'Paste it here'}>
              {connected ? (
                <p className="mt-1 text-[12px] text-ink-500">
                  <span className="tabular-nums text-dashboard-400">{status.phase === 'connected' ? status.credits.toLocaleString() : ''}</span> credits on
                  your account.
                </p>
              ) : (
                <>
                  <div className="relative mt-2">
                    <input
                      type={reveal ? 'text' : 'password'}
                      value={draft}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') connect()
                      }}
                      placeholder="sk-..."
                      className="w-full rounded-full border border-ink/10 bg-ink/5 py-2.5 pl-4 pr-10 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
                    />
                    <button
                      type="button"
                      onClick={() => setReveal((v) => !v)}
                      aria-label={reveal ? 'Hide key' : 'Show key'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-2 text-ink-500 transition-colors hover:text-ink-300"
                    >
                      {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {status.phase === 'error' && (
                    <p className="mt-2 text-[12px] leading-relaxed text-red-300 light:text-red-700">{status.message}</p>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-600">
                    Stored only in this browser. Do not share it with anyone.
                  </p>
                </>
              )}
            </Step>
          </ol>

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              onClick={onOpenSettings}
              className="text-[12px] text-ink-500 underline decoration-ink/20 underline-offset-2 transition-colors hover:text-ink-300"
            >
              Open Settings
            </button>
            {connected ? (
              <button
                onClick={onClose}
                className="flex h-9 items-center rounded-full bg-ink px-5 text-[13px] font-medium text-paper transition-opacity hover:opacity-90"
              >
                Start creating
              </button>
            ) : (
              <button
                onClick={connect}
                disabled={!key || status.phase === 'checking'}
                className="flex h-9 items-center gap-2 rounded-full bg-ink px-5 text-[13px] font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status.phase === 'checking' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {status.phase === 'checking' ? 'Checking…' : 'Connect'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Step({
  index,
  done,
  label,
  children,
}: {
  index: number
  done: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <li className="relative flex gap-3">
      <span
        className={`relative z-10 mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors ${
          done ? 'bg-dashboard-500 text-white' : 'bg-surface-2 text-ink-300 ring-1 ring-inset ring-ink/10'
        }`}
      >
        {done ? <Check className="h-3 w-3" strokeWidth={3} /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] leading-relaxed ${done ? 'text-ink-400' : 'text-ink-200'}`}>{label}</p>
        {children}
      </div>
    </li>
  )
}
