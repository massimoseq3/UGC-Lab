import { create } from 'zustand'

// What a member can switch OFF in Settings → Experimental — whole apps, and
// single features inside an app. One map, one localStorage blob, because it is
// one question: which parts of this workspace does this person want on screen?
//
// Outliers is the optional APP, and it ships ON (September 2026, Massimo's
// call): it shipped off on the reasoning that ad research is a side quest next
// to the production line, and enough members went looking for it that the tile
// is worth more than the row it costs. It stays in this list — switching it off
// takes the whole app, not just the tile: its dock entry, its planet on the
// Dashboard, its teammate in the intro, and the Bank's Swipe File tab, which is
// Outliers' own bank and points at an app that isn't there without it.
//
// A default here is only the fallback for a member who has never touched the
// switch, so flipping it moves everyone who never opted out and nobody who did
// — a stored `false` is a real choice and outlives the default.
//
// B-Roll's Continuous mode is the optional FEATURE, and it ships OFF too: the
// keyframe chain is a second shape of workspace beside Line-by-Line, and for a
// member who only ever storyboards line by line the toggle above the inputs is
// a choice they make once and then pay for on every visit. Off hides the mode
// toggle, holds the app in Line-by-Line, and drops Continuous sessions out of
// History — there is no mode left to open one in, the same rule the retired
// One-Shot rows follow. Nothing is deleted: every keyframe, clip and history
// row is still on disk and in the cloud, and switching it back on restores all
// of them exactly where they were.
//
// Something NOT listed here is always on: this is a short opt-out list, not a
// permissions layer, so nothing can accidentally hide the production line.
//
// Per-browser, like the theme and the generation-info switch: its own
// localStorage key, never cloud-synced, and untouched by the sign-out wipe.
// This is a preference about a workspace, not account data — the cost being
// that a member who wants Outliers back switches it on once per browser.

const STORAGE_KEY = 'ai-ugc-lab-optional-apps'

// One-time opt-in resets. Flipping a `defaultOn` only moves a member who never
// touched that switch — a stored boolean is a real choice and outlives it — so
// turning something back on for EVERYONE takes a run listed here: the stored
// value for that id is dropped once per browser and the id falls back to its
// default above. It is a reset, not a lock: the very next flick of the switch
// writes a fresh choice that no later run can touch, because each run is
// remembered under its own marker key and never repeats.
//
// `discover` is here because Outliers came back on in September 2026 and the
// members asking for it are exactly the ones who had switched it off while it
// was a side quest; leaving their stored `false` in place would have hidden the
// flip from the people who wanted it.
const RESETS: Array<{ id: string; marker: string }> = [
  { id: 'discover', marker: 'ai-ugc-lab-optional-apps:reset:discover-on-2026-09' },
]

export const OPTIONAL_APPS: Array<{ id: string; defaultOn: boolean }> = [
  { id: 'discover', defaultOn: true },
]

/** Optional features — not apps, so they have no dock tile or route to hide. */
export const OPTIONAL_FEATURES: Array<{ id: string; defaultOn: boolean }> = [
  { id: 'broll-continuous', defaultOn: false },
]

const OPTIONAL = [...OPTIONAL_APPS, ...OPTIONAL_FEATURES]

const DEFAULTS: Record<string, boolean> = Object.fromEntries(
  OPTIONAL.map((a) => [a.id, a.defaultOn]),
)

// Only a stored boolean for a still-optional id is honoured — a corrupt blob,
// an unreadable localStorage, or a leftover id for something that is no longer
// optional all fall through to the defaults above rather than hiding anything.
function load(): Record<string, boolean> {
  const stored: Record<string, boolean> = {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (parsed && typeof parsed === 'object') {
      for (const { id } of OPTIONAL) {
        const value = (parsed as Record<string, unknown>)[id]
        if (typeof value === 'boolean') stored[id] = value
      }
    }
  } catch { /* ignore */ }
  applyResets(stored)
  return { ...DEFAULTS, ...stored }
}

// Drops each un-run reset's stored value and REWRITES the blob without it, in
// that order: ignoring the value without erasing it would turn the app on for
// this load and off again on the next one. A failed write leaves the marker
// unset too, so the pair stays consistent and the reset simply runs again.
function applyResets(stored: Record<string, boolean>): void {
  for (const { id, marker } of RESETS) {
    try {
      if (localStorage.getItem(marker)) continue
    } catch { return }
    const had = id in stored
    delete stored[id]
    try {
      // Only a real deletion rewrites the blob, so a corrupt or unreadable one
      // is never overwritten by a reset that had nothing to remove.
      if (had) localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
      localStorage.setItem(marker, '1')
    } catch { /* ignore — the reset runs again next load */ }
  }
}

interface AppVisibilityState {
  visible: Record<string, boolean>
  setOptionalEnabled: (id: string, enabled: boolean) => void
}

export const useAppVisibilityStore = create<AppVisibilityState>((set, get) => ({
  visible: load(),

  setOptionalEnabled: (id, enabled) => {
    const next = { ...get().visible, [id]: enabled }
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

/** Subscribe to one optional feature. Same map as the apps, different word. */
export function useFeatureEnabled(featureId: string): boolean {
  return useAppVisibilityStore((s) => s.visible[featureId] ?? true)
}
