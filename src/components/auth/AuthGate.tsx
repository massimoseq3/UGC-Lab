import { useEffect, useState } from 'react'
import Spinner from '../Spinner'
import { useAuthStore } from '../../stores/authStore'
import { isCloudEnabled } from '../../lib/supabase'
import { startCloudSync, stopCloudSync } from '../../lib/cloudSync'
import AuthScreen from './AuthScreen'
import ResetPasswordScreen from './ResetPasswordScreen'
import LapsedScreen from './LapsedScreen'

interface AuthGateProps {
  children: React.ReactNode
}

export default function AuthGate({ children }: AuthGateProps) {
  const bootstrapping = useAuthStore((s) => s.bootstrapping)
  const session = useAuthStore((s) => s.session)
  const profile = useAuthStore((s) => s.profile)
  const bootstrap = useAuthStore((s) => s.bootstrap)
  const recovery = useAuthStore((s) => s.recovery)
  // A lapsed member holds a valid session but no data access — RLS locks every
  // bank table until they redeem the access code (migration 0023).
  const lapsed = !!profile?.lapsed_at
  const [syncing, setSyncing] = useState(false)
  const [syncReady, setSyncReady] = useState(!isCloudEnabled())

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  // Run cloud sync once we have a session + profile. Re-runs if the user
  // signs out and a different account signs in (we stop + restart). This
  // effect orchestrates an external subscription (start/stopCloudSync) with
  // cleanup, so the synchronous loading-flag setState calls are the standard
  // async-effect pattern, not a cascading-render smell.
  //
  // Neither a lapsed member nor a half-finished password reset may start a
  // sync: the first would hydrate against tables RLS refuses, reporting a
  // per-table error for every bank, and the second hasn't decided who is
  // signed in yet.
  const userId = session?.user.id
  const syncBlocked = lapsed || recovery
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isCloudEnabled()) { setSyncReady(true); return }
    if (!userId || syncBlocked) { stopCloudSync(); setSyncReady(false); return }
    let cancelled = false
    setSyncing(true)
    setSyncReady(false)
    startCloudSync()
      .catch((e) => console.error('[AuthGate] cloud sync failed', e))
      .finally(() => {
        if (!cancelled) {
          setSyncing(false)
          setSyncReady(true)
        }
      })
    return () => { cancelled = true; stopCloudSync() }
  }, [userId, syncBlocked])
  /* eslint-enable react-hooks/set-state-in-effect */

  // No Supabase env configured — fall back to local-only mode so the app runs
  // fully client-side without a backend.
  if (!isCloudEnabled()) {
    return <>{children}</>
  }

  if (bootstrapping) {
    return (
      <div className="flex h-dvh w-screen items-center justify-center bg-surface-0 text-ink-500">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  // Before the session check: a recovery link carries a real session, so
  // without this the member lands in the workspace with the password they
  // came here to change still set.
  if (recovery) {
    return <ResetPasswordScreen />
  }

  if (!session || !profile) {
    return <AuthScreen />
  }

  if (lapsed) {
    return <LapsedScreen />
  }

  if (syncing || !syncReady) {
    return (
      <div className="flex h-dvh w-screen flex-col items-center justify-center gap-3 bg-surface-0 text-ink-400">
        <Spinner className="h-5 w-5" />
        <span className="text-[12px]">Syncing your workspace…</span>
      </div>
    )
  }

  return <>{children}</>
}
