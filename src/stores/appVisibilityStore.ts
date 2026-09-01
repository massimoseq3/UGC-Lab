import { create } from 'zustand'

// Optional apps — the ones a member can switch off in Settings → Appearance.
//
// Outliers is the only one, and it ships OFF: ad research is a side quest next
// to the production line, and a dock tile for something most members never open
// is clutter every one of them pays for. Switching it on brings back the whole
// app, not just the tile — its dock entry, its planet on the Dashboard, its
// teammate in the intro, and the Bank's Swipe File tab, which is Outliers' own
// bank and points at an app that isn't there without it.
//
// An app NOT listed here is always visible: this is a short opt-out list, not a
// permissions layer, so nothing can accidentally hide the production line.
//
// Per-browser, like the theme and the generation-info switch: its own
// localStorage key, never cloud-synced, and untouched by the sign-out wipe.
// This is a preference about a workspace, not account data — the cost being
// that a member who wants Outliers back switches it on once per browser.

const STORAGE_KEY = 'ai-ugc-lab-optional-apps'

export const OPTIONAL_APPS: Array<{ id: string; defaultOn: boolean }> = [
  { id: 'discover', defaultOn: false },
]

const DEFAULTS: Record<string, boolean> = Object.fromEntries(
  OPTIONAL_APPS.map((a) => [a.id, a.defaultOn]),
)

// Only a stored boolean for a still-optional app is honoured — a corrupt blob,
// an unreadable localStorage, or a leftover id for an app that is no longer
// optional all fall through to the defaults above rather than hiding anything.
function load(): Record<string, boolean> {
  const stored: Record<string, boolean> = {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (parsed && typeof parsed === 'object') {
      for (const { id } of OPTIONAL_APPS) {
        const value = (parsed as Record<string, unknown>)[id]
        if (typeof value === 'boolean') stored[id] = value
      }
    }
  } catch { /* ignore */ }
  return { ...DEFAULTS, ...stored }
}

interface AppVisibilityState {
  visible: Record<string, boolean>
  setAppVisible: (appId: string, visible: boolean) => void
}

export const useAppVisibilityStore = create<AppVisibilityState>((set, get) => ({
  visible: load(),

  setAppVisible: (appId, visible) => {
    const next = { ...get().visible, [appId]: visible }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    set({ visible: next })
  },
}))

/**
 * Non-reactive read, for a guard that already runs inside an effect. A caller
 * that must re-run when this changes subscribes to `visible` for the trigger
 * and still reads through here, so the `?? true` default lives in one place.
 */
export function isAppVisible(appId: string): boolean {
  return useAppVisibilityStore.getState().visible[appId] ?? true
}

/** Subscribe to one app's visibility. */
export function useAppVisible(appId: string): boolean {
  return useAppVisibilityStore((s) => s.visible[appId] ?? true)
}

/** Subscribe to the whole map, as a predicate — for a surface filtering a list. */
export function useIsAppVisible(): (appId: string) => boolean {
  const visible = useAppVisibilityStore((s) => s.visible)
  return (appId: string) => visible[appId] ?? true
}
