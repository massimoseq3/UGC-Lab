import { create } from 'zustand'

// Whether the app chrome (menu bar, dock, the phone-only pane tabs and the
// history filter bars) is currently collapsed out of the way.
//
// Phone-only, and deliberately NOT persisted: it's a scroll gesture's state,
// not a preference. `useChromeAutoHide` is the only writer.
interface ChromeState {
  hidden: boolean
  setHidden: (hidden: boolean) => void
}

export const useChromeStore = create<ChromeState>((set) => ({
  hidden: false,
  // Guarded so a scroll event that doesn't change the answer can't re-render
  // every consumer — this fires on every frame of a fling.
  setHidden: (hidden) => set((s) => (s.hidden === hidden ? s : { hidden })),
}))

export function useChromeHidden(): boolean {
  return useChromeStore((s) => s.hidden)
}
