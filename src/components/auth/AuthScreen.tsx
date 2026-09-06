import { useState } from 'react'
import { AlertCircle, CheckCircle2, Lock, ExternalLink, X } from 'lucide-react'
import Spinner from '../Spinner'
import AuthShell, { AuthField } from './AuthShell'
import { useAuthStore } from '../../stores/authStore'
import { POLICY_VERSION } from '../../legal/version'
import { SKOOL_ACCESS_CODE_URL, SKOOL_COMMUNITY_URL } from '../../utils/constants'

type Mode = 'login' | 'signup' | 'forgot'

const SUBTITLES: Record<Mode, string> = {
  login: 'Sign in to your workspace',
  signup: 'Create your account',
  forgot: 'Reset your password',
}

export default function AuthScreen() {
  const signIn = useAuthStore((s) => s.signIn)
  const signUp = useAuthStore((s) => s.signUp)
  const requestPasswordReset = useAuthStore((s) => s.requestPasswordReset)
  const acceptPolicies = useAuthStore((s) => s.acceptPolicies)
  const accessRevoked = useAuthStore((s) => s.accessRevoked)
  const clearAccessRevoked = useAuthStore((s) => s.clearAccessRevoked)

  const [mode, setMode] = useState<Mode>('login')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // Shared community access code, checked server-side by the signup trigger
  // (migration 0021). Signup only — existing members sign in as before.
  const [signupCode, setSignupCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setNeedsConfirm(false)
    setResetSent(false)
    if (next !== 'signup') {
      setFirstName('')
      setLastName('')
      setSignupCode('')
    }
  }

  const ready =
    mode === 'forgot'
      ? !!email.trim()
      : !!email.trim() && !!password &&
        (mode === 'login' || (!!firstName.trim() && !!lastName.trim() && !!signupCode.trim()))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNeedsConfirm(false)
    setResetSent(false)
    if (!ready) return
    setBusy(true)
    try {
      if (mode === 'forgot') {
        const res = await requestPasswordReset(email)
        if (!res.ok) setError(res.error)
        else setResetSent(true)
      } else if (mode === 'login') {
        const res = await signIn(email, password)
        // A revoked account surfaces via the "members only" popup (driven by
        // accessRevoked in the store), not the inline error row.
        if (!res.ok && !res.revoked) setError(res.error)
      } else {
        const res = await signUp(email, password, firstName, lastName, signupCode)
        if (!res.ok) setError(res.error)
        else if (res.needsConfirm) setNeedsConfirm(true)
        else {
          // Session was returned immediately — stamp acceptance now. If
          // needsConfirm was true the row isn't reachable yet (RLS sees no
          // session); LegalAcceptModal will capture consent on first signin.
          await acceptPolicies(POLICY_VERSION)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell subtitle={SUBTITLES[mode]}>
      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-xl border border-ink/10 bg-ink/[0.03] p-5 backdrop-blur-xl"
      >
        {mode === 'signup' && (
          <div className="grid grid-cols-2 gap-3">
            <AuthField
              label="First Name"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              placeholder="Jane"
            />
            <AuthField
              label="Surname"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              placeholder="Doe"
            />
          </div>
        )}

        <AuthField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="you@example.com"
          hint={mode === 'forgot' ? 'We’ll send a link to set a new one.' : undefined}
        />

        {mode !== 'forgot' && (
          <div>
            <AuthField
              label="Password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder={mode === 'login' ? '••••••••' : 'Min 8 characters'}
            />
            {mode === 'login' && (
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="mt-1.5 text-[11px] text-ink-500 transition-colors hover:text-ink-300"
              >
                Forgot your password?
              </button>
            )}
          </div>
        )}

        {mode === 'signup' && (
          <AuthField
            label="Access Code"
            type="text"
            autoComplete="off"
            value={signupCode}
            onChange={(e) => setSignupCode(e.target.value)}
            required
            placeholder="Code from the community"
            hint={
              <a
                href={SKOOL_ACCESS_CODE_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-ink-400 underline transition-colors hover:text-ink-200"
              >
                Get the code on Skool
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            }
          />
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300 light:text-red-700">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {needsConfirm && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-300 light:text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
            <span>Check your inbox to confirm your email, then sign in.</span>
          </div>
        )}

        {resetSent && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-300 light:text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
            {/* Deliberately says "if" — confirming which addresses have an
                account would answer that question for anyone who asked. */}
            <span>If that email has an account, a reset link is on its way. The link lasts an hour.</span>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !ready}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-ink-900 transition-colors hover:bg-ink-100 disabled:opacity-60"
        >
          {busy && <Spinner className="h-4 w-4" />}
          {mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>

        {mode === 'signup' && (
          <p className="pt-1 text-center text-[11px] leading-snug text-ink-500">
            By creating an account, you agree to our{' '}
            <a href="/legal/terms" target="_blank" rel="noreferrer" className="text-ink-300 underline">Terms</a>,{' '}
            <a href="/legal/privacy" target="_blank" rel="noreferrer" className="text-ink-300 underline">Privacy Policy</a>, and{' '}
            <a href="/legal/aup" target="_blank" rel="noreferrer" className="text-ink-300 underline">Acceptable Use Policy</a>.
          </p>
        )}
      </form>

      <div className="text-center text-[12px] text-ink-500">
        {mode === 'login' ? (
          <>
            New to UGC OS?{' '}
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className="text-ink-300 transition-colors hover:text-ink"
            >
              Create an account
            </button>
          </>
        ) : (
          <>
            {mode === 'signup' ? 'Already have an account?' : 'Remembered it?'}{' '}
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="text-ink-300 transition-colors hover:text-ink"
            >
              Sign in
            </button>
          </>
        )}
      </div>

      {/* Access is gated by the Skool allowlist, so a non-member who finds
          the URL can't sign up — send them to the community instead. */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-center text-[11px] text-ink-600">
          Access is limited to members of the Skool community.
        </p>
        <a
          href={SKOOL_COMMUNITY_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/5 px-4 py-2 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/10 hover:text-ink"
        >
          Join the community
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {accessRevoked && <MembersOnlyModal onClose={clearAccessRevoked} />}
    </AuthShell>
  )
}

// Shown when a disabled account tries to sign in (or loads with a stale
// session). Points them back to the Skool community to (re)join.
function MembersOnlyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-sm rounded-2xl border border-ink/10 bg-surface-2 p-6 text-center shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1 text-ink-500 transition-colors hover:bg-ink/[0.05] hover:text-ink-200"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-ink/5 text-ink-300">
          <Lock className="h-5 w-5" />
        </div>

        <h2 className="mt-4 text-base font-semibold tracking-tight text-ink-100">Members Only</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-400">
          Access is only for members of the UGC OS Skool community. Join (or rejoin) on Skool to get back in.
        </p>

        <a
          href={SKOOL_COMMUNITY_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-ink py-2.5 text-sm font-medium text-ink-900 transition-colors hover:bg-ink-100"
        >
          Go to the Skool community
          <ExternalLink className="h-3.5 w-3.5" />
        </a>

        <button
          onClick={onClose}
          className="mt-2 w-full rounded-full py-2 text-[12px] text-ink-500 transition-colors hover:text-ink-300"
        >
          Back to sign in
        </button>
      </div>
    </div>
  )
}
