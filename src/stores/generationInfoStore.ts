import { create } from 'zustand'

// "Generation info" — the model-name pill on generated media (Playground's
// history list rows, B-Roll's cards and gallery tiles).
//
// ON for everyone, and only the operator ever sees the switch (Settings →
// Admin). It exists for screen recording, where naming the model on every tile
// is one more thing on camera; a member has no reason to want their own outputs
// unlabelled, so hiding the row from them is deliberate rather than an
// oversight.
//
// Per-browser, like the theme: its own localStorage key, never cloud-synced,
// and untouched by the sign-out wipe — this is a preference about the machine
// the recording is made on, not account data.

const STORAGE_KEY = 'ai-ugc-lab-generation-info'

function loadShow(): boolean {
  try {
    // Only an explicit 'off' turns it off. An absent, corrupt or unreadable
    // value means ON, so every member who never touches this lands on the
    // default without a migration.
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

interface GenerationInfoState {
  show: boolean
  setShow: (show: boolean) => void
}

export const useGenerationInfoStore = create<GenerationInfoState>((set) => ({
  show: loadShow(),

  setShow: (show) => {
    try { localStorage.setItem(STORAGE_KEY, show ? 'on' : 'off') } catch { /* ignore */ }
    set({ show })
  },
}))

/** Subscribe to the preference. */
export function useShowGenerationInfo(): boolean {
  return useGenerationInfoStore((s) => s.show)
}
