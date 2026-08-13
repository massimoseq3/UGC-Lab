import { useState } from 'react'
import { AlertCircle, CheckCircle2, Lock, ExternalLink, X } from 'lucide-react'
import Spinner from '../Spinner'
import AppLogo from '../AppLogo'
import AppBackground from '../AppBackground'
import { useAuthStore } from '../../stores/authStore'
import { POLICY_VERSION } from '../../legal/version'
import { SKOOL_COMMUNITY_URL } from '../../utils/constants'

type Mode = 'login' | 'signup'

export default function AuthScreen() {
  const signIn = useAuthStore((s) => s.signIn)
  const signUp = useAuthStore((s) => s.signUp)
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNeedsConfirm(false)
    if (!email.trim() || !password) return
    if (mode === 'signup' && (!firstName.trim() || !lastName.trim() || !signupCode.trim())) return
    setBusy(true)
    try {
      if (mode === 'login') {
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
    <div className="relative h-dvh w-screen overflow-hidden bg-surface-0 text-ink antialiased">
      <AppBackground />

      <div className="relative z-10 flex h-full w-full items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6">
          {/* Brand */}
          <div className="flex flex-col items-center gap-2">
            <AppLogo className="h-12 w-12" />
            <div className="space-y-1 text-center">
              <h1 className="text-2xl font-bold tracking-tight text-ink-100">UGC OS</h1>
              <p className="text-sm text-ink-500">
                {mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}
              </p>
            </div>
          </div>

          {/* Card */}
          <form
            onSubmit={handleSubmit}
            className="space-y-3 rounded-xl border border-ink/10 bg-ink/[0.03] p-5 backdrop-blur-xl"
          >
            {mode === 'signup' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-500">
                    First name
                  </label>
                  <input
                    type="text"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2.5 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
                    placeholder="Jane"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-500">
                    Surname
                  </label>
                  <input
                    type="text"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2.5 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
                    placeholder="Doe"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-500">
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2.5 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-500">
                Password
              </label>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2.5 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
                placeholder={mode === 'login' ? '••••••••' : 'Min 8 characters'}
              />
            </div>

            {mode === 'signup' && (
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-500">
                  Access code
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={signupCode}
                  onChange={(e) => setSignupCode(e.target.value)}
                  required
                  className="w-full rounded-lg border border-ink/10 bg-ink/5 px-3 py-2.5 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
                  placeholder="Code from the community"
                />
                <p className="mt-1 text-[11px] text-ink-600">
                  Posted in the Skool community — ask there if you don't have it.
                </p>
              </div>
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

            <button
              type="submit"
              disabled={busy || !email.trim() || !password || (mode === 'signup' && (!firstName.trim() || !lastName.trim() || !signupCode.trim()))}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-ink-900 transition-colors hover:bg-ink-100 disabled:opacity-60"
            >
              {busy && <Spinner className="h-4 w-4" />}
              {mode === 'login' ? 'Sign in' : 'Create account'}
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
                  onClick={() => { setMode('signup'); setError(null); setNeedsConfirm(false) }}
                  className="text-ink-300 transition-colors hover:text-ink"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(null); setNeedsConfirm(false); setFirstName(''); setLastName(''); setSignupCode('') }}
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

          <div className="flex items-center justify-center gap-3 text-[11px] text-ink-600">
            <a href="/legal/terms" className="transition-colors hover:text-ink-300">Terms</a>
            <span aria-hidden>·</span>
            <a href="/legal/privacy" className="transition-colors hover:text-ink-300">Privacy</a>
            <span aria-hidden>·</span>
            <a href="/legal/aup" className="transition-colors hover:text-ink-300">AUP</a>
          </div>
        </div>
      </div>

      {accessRevoked && <MembersOnlyModal onClose={clearAccessRevoked} />}
    </div>
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

        <h2 className="mt-4 text-base font-semibold tracking-tight text-ink-100">Members only</h2>
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
