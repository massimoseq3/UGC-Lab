import { create } from 'zustand'

// The video editor skill is the one thing the app hands out as a FILE the
// member installs by hand, so a new version is invisible to anyone who already
// downloaded the last one — they have no reason to open Edit again. This store
// is the nudge: the dock tile dots and the folder wears a "New update" badge
// until Edit has been opened on the current version.
//
// Per browser on purpose (like the theme, never cloud-synced): the skill is
// installed into a Claude Code setup on THIS machine, so "already got it" is a
// fact about the machine, not about the account.

// Bump this whenever public/video-editor.skill is replaced, and update
// SKILL_FILE_SIZE + the changelog line in EditStudio.tsx with it.
export const SKILL_VERSION = 3

const STORAGE_KEY = 'ai-ugc-lab-skill-version-seen'

function readSeen(): number {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0
  } catch {
    return 0
  }
}

interface SkillUpdateState {
  seenVersion: number
  markSeen: () => void
}

export const useSkillUpdateStore = create<SkillUpdateState>((set) => ({
  seenVersion: readSeen(),
  markSeen: () =>
    set(() => {
      try {
        localStorage.setItem(STORAGE_KEY, String(SKILL_VERSION))
      } catch {
        // A browser refusing localStorage just means the badge shows again
        // next load — nothing to recover from.
      }
      return { seenVersion: SKILL_VERSION }
    }),
}))

// True while the member hasn't opened Edit since this version shipped.
export function useSkillUpdateUnseen(): boolean {
  return useSkillUpdateStore((s) => s.seenVersion < SKILL_VERSION)
}
