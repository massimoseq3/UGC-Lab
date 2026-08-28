import { create } from 'zustand'

// "A newer version of the app is deployed than the one this tab is running."
//
// Two things set it: the version poll (hooks/useAppUpdateCheck.ts), which
// notices a deploy before the member walks into it, and a chunk that failed to
// load (components/AppErrorBoundary.tsx), which is the member having walked
// into it already. Either way the answer is the same one-word action — reload —
// so both feed one flag and one notice.

// Written immediately before the reload so the fresh load can say what
// happened. sessionStorage, not localStorage: it's about THIS reload, and a
// flag that outlived the tab would announce an update on some later morning.
const RELOADED_KEY = 'ugc-lab:reloaded-for-update'

interface UpdateState {
  /** A newer build is live. Never goes back to false — only a reload clears it. */
  available: boolean
  /** The member has waved the notice away; the update is still pending. */
  dismissed: boolean
  markAvailable: () => void
  dismiss: () => void
}

export const useUpdateStore = create<UpdateState>((set) => ({
  available: false,
  dismissed: false,
  markAvailable: () => set({ available: true }),
  dismiss: () => set({ dismissed: true }),
}))

/** Callable from anywhere, including the error boundary (not a component). */
export function markUpdateAvailable() {
  useUpdateStore.getState().markAvailable()
}

/**
 * Same flag, read outside React — for `AppErrorBoundary`, whose
 * `getDerivedStateFromError` is static and can't use a hook.
 */
export function isUpdateAvailable(): boolean {
  return useUpdateStore.getState().available
}

export function reloadForUpdate() {
  try {
    sessionStorage.setItem(RELOADED_KEY, '1')
  } catch {
    // A browser refusing sessionStorage just means the reload lands without
    // its confirmation toast. Nothing to recover from.
  }
  // reload() rather than a cache-busting navigation: the HTML itself is served
  // uncached, so a plain reload is what picks up the new asset names — and it's
  // exactly what members already do by hand today.
  window.location.reload()
}

/** True once, on the load that follows a reloadForUpdate(). */
export function consumeUpdateReloadFlag(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_KEY) !== '1') return false
    sessionStorage.removeItem(RELOADED_KEY)
    return true
  } catch {
    return false
  }
}
