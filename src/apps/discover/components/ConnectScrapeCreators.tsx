import { useState } from 'react'
import { ArrowUpRight, Eye, EyeOff, X } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import { useSettingsStore } from '../../../stores/settingsStore'
import { scTestConnection } from '../../../utils/scrapecreators'
import { useBackdropClose } from '../../../hooks/useBackdropClose'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import CrabSprite from '../../../components/CrabSprite'

// The one-screen setup for Outliers, shown when the app opens without a key.
//
// Same doctrine as ApiKeyGuide: the key is checked against a live call BEFORE
// it is saved, so "connected" means connected rather than "something is
// stored". Deliberately shorter than the kie.ai version — that one carries a
// two-step rail because the member has to go and generate a key first; here
// signing up hands you one with 100 credits on it, so a rail would be
// scaffolding around a single paste.
//
// Infra surface: a failed check shows ScrapeCreators' own message, not
// humanizeError copy.

type Status =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'connected'; credits: number | null }
  | { phase: 'error'; message: string }

export default function ConnectScrapeCreators({ onClose }: { onClose: () => void }) {
  const backdrop = useBackdropClose(onClose)
  useCloseOnEscape(true, onClose)
  useCloseOnAppSwitch(true, onClose)

  const setScrapeCreatorsKey = useSettingsStore((s) => s.setScrapeCreatorsKey)
  const [draft, setDraft] = useState('')
  const [reveal, setReveal] = useState(false)
  const [status, setStatus] = useState<Status>({ phase: 'idle' })

  const key = draft.trim()
  const connected = status.phase === 'connected'

  async function connect() {
    if (!key || status.phase === 'checking') return
    setStatus({ phase: 'checking' })
    const result = await scTestConnection(key)
    if (!result.ok) {
      setStatus({ phase: 'error', message: result.error })
      return
    }
    setScrapeCreatorsKey(key)
    setStatus({ phase: 'connected', credits: result.credits })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" {...backdrop}>
      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-ink/10 bg-surface-1 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gold wash, matching the app's own accent — the same trick the kie
            guide uses to tie its panel to kie.ai's colour. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(420px_180px_at_18%_0%,rgba(217,164,4,0.18),transparent_75%)]"
        />

        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative p-5 lg:p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#D9A404]/10">
            <CrabSprite variant="discover" className="h-8 w-[2.7rem]" />
          </span>

          <h2 className="mt-3 text-lg font-semibold tracking-tight text-ink-100">
            {connected ? 'You’re connected' : 'Connect ScrapeCreators'}
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
            {connected
              ? 'Search TikTok and the Meta Ad Library, then send anything you find straight to Ad Analyzer or Scripts.'
              : 'Outliers runs on your own ScrapeCreators key — 1 credit a search, and 100 free when you sign up.'}
          </p>

          {connected ? (
            <p className="mt-4 text-[12px] text-ink-500">
              {status.credits !== null && (
                <span className="tabular-nums text-ink-200">{status.credits.toLocaleString()}</span>
              )}
              {status.credits !== null ? ' credits on your account.' : 'Key saved to this browser.'}
            </p>
          ) : (
            <>
              <a
                href="https://scrapecreators.com"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/[0.06]"
              >
                Get a free key
                <ArrowUpRight className="h-3.5 w-3.5 text-ink-500" strokeWidth={2} />
              </a>

              <div className="relative mt-3">
                <input
                  type={reveal ? 'text' : 'password'}
                  value={draft}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    setStatus({ phase: 'idle' })
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') void connect() }}
                  placeholder="Paste your ScrapeCreators key"
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
                <>
                  <p className="mt-2 text-[12px] leading-relaxed text-red-300 light:text-red-700">{status.message}</p>
                  {/* ScrapeCreators answers an unrecognised key with 402 "out of
                      credits" rather than 401 (verified live), so their own text
                      sends a member off to buy credits they may already have.
                      The raw message stays — this is an infra surface and the
                      real reason matters — with one line to decode it. */}
                  {status.message.includes('402') && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                      A key that isn’t recognised returns this same message. Check you
                      copied the whole key before topping up.
                    </p>
                  )}
                </>
              )}

              {/* Said out loud because there's no free balance endpoint to check
                  against — the only way to prove a key works is to use it. */}
              <p className="mt-2 text-[11px] leading-relaxed text-ink-600">
                Stored only in this browser. Connecting spends 1 credit to check the key.
              </p>
            </>
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={connected ? onClose : connect}
              disabled={!connected && (!key || status.phase === 'checking')}
              className="flex h-9 items-center gap-2 rounded-full bg-ink px-5 text-[13px] font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status.phase === 'checking' && <Spinner className="h-3.5 w-3.5" />}
              {connected ? 'Start searching' : status.phase === 'checking' ? 'Checking…' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
