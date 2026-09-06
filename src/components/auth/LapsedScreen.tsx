import { useState } from 'react'
import { AlertCircle, ExternalLink } from 'lucide-react'
import Spinner from '../Spinner'
import AuthShell, { AuthField } from './AuthShell'
import { useAuthStore } from '../../stores/authStore'
import { SKOOL_ACCESS_CODE_URL } from '../../utils/constants'

// Shown to a member whose account is Lapsed (migration 0023) — cancelled, but
// not banned. Their workspace is untouched behind RLS; the current shared
// access code is what opens it again, which is why the code is worth rotating.
export default function LapsedScreen() {
  const email = useAuthStore((s) => s.profile?.email ?? s.user?.email ?? '')
  const redeemAccessCode = useAuthStore((s) => s.redeemAccessCode)
  const signOut = useAuthStore((s) => s.signOut)

  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!code.trim()) return
    setBusy(true)
    try {
      const res = await redeemAccessCode(code)
      // On success the profile reloads without lapsed_at and AuthGate hands
      // over to the workspace — nothing left to render here.
      if (!res.ok) setError(res.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell subtitle="Welcome back">
      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-xl border border-ink/10 bg-ink/[0.03] p-5 backdrop-blur-xl"
      >
        {/* No explanatory paragraph above the field. "Welcome back" is the
            heading, the field is labelled Access code and carries its own hint,
            and the button says Unlock my workspace — a sentence restating all
            three is the one thing on this screen nobody has to read. */}
        <AuthField
          label="Access Code"
          type="text"
          autoComplete="off"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          placeholder="Code from the community"
          hint="It changes from time to time, so use the current one."
        />

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300 light:text-red-700">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-ink-900 transition-colors hover:bg-ink-100 disabled:opacity-60"
        >
          {busy && <Spinner className="h-4 w-4" />}
          Unlock my workspace
        </button>
      </form>

      <div className="flex flex-col items-center gap-2">
        <a
          href={SKOOL_ACCESS_CODE_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/5 px-4 py-2 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/10 hover:text-ink"
        >
          Get the code on Skool
          <ExternalLink className="h-3 w-3" />
        </a>
        <button
          onClick={() => void signOut()}
          className="text-[11px] text-ink-600 transition-colors hover:text-ink-300"
        >
          {email ? `Sign out of ${email}` : 'Sign out'}
        </button>
      </div>
    </AuthShell>
  )
}
