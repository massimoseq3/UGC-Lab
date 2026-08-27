import { useEffect } from 'react'

import { BUILD_ID, fetchDeployedBuildId } from '../utils/appVersion'
import { useAppStore } from '../stores/appStore'
import { consumeUpdateReloadFlag, useUpdateStore } from '../stores/updateStore'

// Mounted once, in the workspace. It answers one question on a slow loop: is
// what's deployed still what this tab is running?
//
// The point is to get in FRONT of the failure. Left to itself, a member finds
// out about a deploy by opening an app whose chunk no longer exists — which
// used to be a white screen and is now at best an interruption. A notice they
// can act on between jobs is better than either.

// Slow on purpose. Deploys are minutes apart at the very worst, the file is a
// few dozen bytes, and the check also fires whenever the tab is brought back to
// the front — which is when most of these are actually caught, since the tab
// was in the background for the whole deploy.
const POLL_MS = 10 * 60 * 1000

// Floor between checks, so tabbing in and out repeatedly doesn't turn into a
// request per switch.
const MIN_GAP_MS = 60 * 1000

export function useAppUpdateCheck() {
  const addToast = useAppStore((s) => s.addToast)

  // Close the loop after a reload: a page that reloads itself, or that the
  // member reloaded on our say-so, should say what it was for.
  useEffect(() => {
    if (consumeUpdateReloadFlag()) {
      addToast('UGC OS updated to the latest version.')
    }
  }, [addToast])

  useEffect(() => {
    // Dev serves modules straight from source — there is no deploy to notice,
    // and no /version.json to read.
    if (import.meta.env.DEV) return

    let cancelled = false
    let inFlight = false
    let lastCheck = 0

    const check = async () => {
      const { available, markAvailable } = useUpdateStore.getState()
      // Once it's true it stays true — nothing left to ask.
      if (available || inFlight) return
      // Deliberately NOT gated on the tab being visible. A backgrounded tab
      // costs one 40-byte request per interval, and finding out while it's
      // hidden is the better outcome anyway: the pill is already up when the
      // member comes back. Some embedded contexts also report `hidden` for
      // their whole life, and a check that never runs there is worse than a
      // request nobody notices.
      const now = Date.now()
      if (now - lastCheck < MIN_GAP_MS) return
      lastCheck = now
      inFlight = true
      const deployed = await fetchDeployedBuildId()
      inFlight = false
      if (cancelled || !deployed) return
      if (deployed !== BUILD_ID) markAvailable()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void check()
    }

    // Vite's own signal that a lazy chunk failed to load. It fires before the
    // import rejection surfaces, so the notice is already armed by the time the
    // error boundary renders. Left un-prevented deliberately: the error still
    // propagates, and the boundary is what tells the member which pane died.
    const onPreloadError = () => useUpdateStore.getState().markAvailable()

    const timer = setInterval(() => void check(), POLL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('vite:preloadError', onPreloadError)
    void check()

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('vite:preloadError', onPreloadError)
    }
  }, [])
}
