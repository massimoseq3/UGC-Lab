import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { useAuthStore } from '../stores/authStore'
import { isAppVisible, useAppVisibilityStore } from '../stores/appVisibilityStore'
import {
  DEFAULT_SLUG,
  getAppIdForSlug,
  getSlugForAppId,
  getSlugFromPath,
} from '../utils/routing'

// Mirrors `activeApp` ↔ URL in both directions. Renders nothing.
// Mount once inside <BrowserRouter>.
//
// Each direction reads its counterpart fresh (store.getState() / window.location)
// instead of via closure, so neither effect re-fires when the other side changes
// — otherwise sidebar clicks would race the URL sync and revert themselves.
export default function RouterSync() {
  const activeApp = useAppStore((s) => s.activeApp)
  const openApp = useAppStore((s) => s.openApp)
  const isAdmin = useAuthStore((s) => s.profile?.is_admin === true)
  // Subscribed for the re-run only — the guard below reads through
  // `isAppVisible` so the default for a non-optional app lives in one place.
  // Switching Outliers off while sitting in it is exactly what re-fires this.
  const appVisibility = useAppVisibilityStore((s) => s.visible)
  const location = useLocation()
  const navigate = useNavigate()

  // URL → store. Runs only when the path changes.
  //
  // `openApp` and `navigate` are intentionally NOT in the dep array: both are
  // stable in our usage (Zustand action references and React Router 7's
  // `useNavigate` both promise stability across renders), but listing them
  // turned out to be a footgun — when paired with the second effect's
  // `navigate` dep, certain back/forward transitions would re-fire both
  // effects in a tight loop until React threw "Maximum update depth
  // exceeded" and unmounted the tree, leaving the user staring at a blank
  // page. Pulling the function references out of the dep array breaks the
  // cycle without changing any observable behaviour.
  useEffect(() => {
    const slug = getSlugFromPath(location.pathname)
    const targetAppId = slug ? getAppIdForSlug(slug) : null

    if (!targetAppId) {
      navigate(`/${DEFAULT_SLUG}`, { replace: true })
      return
    }

    if (targetAppId === 'admin' && !isAdmin) {
      navigate(`/${DEFAULT_SLUG}`, { replace: true })
      return
    }

    // An app switched off in Settings has no dock tile, so its URL is the only
    // way back into it — a bookmark, or the member turning it off while it was
    // open. Same treatment as a forbidden slug: land on the Dashboard.
    if (!isAppVisible(targetAppId)) {
      navigate(`/${DEFAULT_SLUG}`, { replace: true })
      return
    }

    if (useAppStore.getState().activeApp !== targetAppId) {
      openApp(targetAppId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, isAdmin, appVisibility])

  // store → URL. Runs only when activeApp changes. Same dep-array caveat as
  // the effect above — `navigate` is omitted on purpose.
  useEffect(() => {
    const targetSlug = getSlugForAppId(activeApp)
    if (!targetSlug) return
    if (window.location.pathname !== `/${targetSlug}`) {
      navigate(`/${targetSlug}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeApp])

  return null
}
