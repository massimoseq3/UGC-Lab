import { useEffect, useState } from 'react'
import {  } from 'lucide-react'
import Spinner from '../Spinner'
import { useAuthStore } from '../../stores/authStore'
import { isCloudEnabled } from '../../lib/supabase'
import { startCloudSync, stopCloudSync } from '../../lib/cloudSync'
import AuthScreen from './AuthScreen'

interface AuthGateProps {
  children: React.ReactNode
}

export default function AuthGate({ children }: AuthGateProps) {
  const bootstrapping = useAuthStore((s) => s.bootstrapping)
  const session = useAuthStore((s) => s.session)
  const profile = useAuthStore((s) => s.profile)
  const bootstrap = useAuthStore((s) => s.bootstrap)
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
  const userId = session?.user.id
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isCloudEnabled()) { setSyncReady(true); return }
    if (!userId) { stopCloudSync(); setSyncReady(false); return }
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
  }, [userId])
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

  if (!session || !profile) {
    return <AuthScreen />
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
