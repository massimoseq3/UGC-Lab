import { useState } from 'react'
import { AlertCircle, KeyRound } from 'lucide-react'
import Spinner from '../Spinner'
import AuthShell, { AuthField } from './AuthShell'
import { useAuthStore } from '../../stores/authStore'

const MIN_PASSWORD = 8

// Shown when this page load arrived on a Supabase recovery link. The link
// carries a real session, so the screen exists to make sure the member sets a
// password before the app lets them anywhere near the workspace.
export default function ResetPasswordScreen() {
  const session = useAuthStore((s) => s.session)
  const completePasswordReset = useAuthStore((s) => s.completePasswordReset)
  const exitRecovery = useAuthStore((s) => s.exitRecovery)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // No session on a recovery URL means the token was expired, already spent, or
  // opened in a browser that mangled it. Nothing to do here but start again.
  if (!session) {
    return (
      <AuthShell subtitle="Reset your password">
        <div className="space-y-4 rounded-xl border border-ink/10 bg-ink/[0.03] p-5 backdrop-blur-xl">
          <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300 light:text-amber-700">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>This reset link has expired or has already been used. Request a new one.</span>
          </div>
          <button
            onClick={exitRecovery}
            className="w-full rounded-lg bg-ink py-2.5 text-sm font-medium text-ink-900 transition-colors hover:bg-ink-100"
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    )
  }

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = confirm.length > 0 && password !== confirm
  const ready = password.length >= MIN_PASSWORD && password === confirm

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!ready) return
    setBusy(true)
    try {
      const res = await completePasswordReset(password)
      // On success the store drops out of recovery mode and AuthGate takes over
      // — there is nothing to render here afterwards.
      if (!res.ok) setError(res.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell subtitle="Choose a new password">
      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-xl border border-ink/10 bg-ink/[0.03] p-5 backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 text-[12px] text-ink-400">
          <KeyRound className="h-3.5 w-3.5 shrink-0 text-ink-500" />
          <span className="truncate">{session.user.email}</span>
        </div>

        <AuthField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={MIN_PASSWORD}
          placeholder={`Min ${MIN_PASSWORD} characters`}
        />

        <AuthField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          placeholder="Type it again"
        />

        {(error || tooShort || mismatch) && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300 light:text-red-700">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              {error
                ?? (tooShort ? `Use at least ${MIN_PASSWORD} characters.` : 'Those two passwords don’t match.')}
            </span>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !ready}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-ink-900 transition-colors hover:bg-ink-100 disabled:opacity-60"
        >
          {busy && <Spinner className="h-4 w-4" />}
          Set new password
        </button>

        <button
          type="button"
          onClick={exitRecovery}
          className="w-full rounded-lg py-2 text-[12px] text-ink-500 transition-colors hover:text-ink-300"
        >
          Cancel
        </button>
      </form>
    </AuthShell>
  )
}
