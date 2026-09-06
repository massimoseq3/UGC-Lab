import { create } from 'zustand'
import { CHANNEL_VIDEOS, videosByRecency } from '../utils/channelVideos'

// Which of Massimo's videos this member has already been shown — the state
// behind the What's New list's NEW badge and the tile's red dot. A video stops
// being new the moment its row is CLICKED — the list goes straight out to
// YouTube, so opening the video is the only "you have seen this" signal there
// is, and it is the honest one.
//
// **Browser-local, not cloud-synced**, and that is a deliberate trade rather
// than an oversight. The announcement half of this tile keeps its receipts per
// ACCOUNT (`announcement_reads`), because the Admin panel reports on who read
// what and because an outage notice has to be un-missable on every device. A
// video badge is neither: it is a nudge, it costs nothing when it fires twice,
// and giving it an account-wide home would mean a Postgres table, a migration
// to run before deploy, and a sync path — for a boolean about a link. It rides
// localStorage with the theme, which is the other thing here that is a
// property of the browser rather than of the member.

const STORAGE_KEY = 'ai-ugc-lab-videos-seen'

function writeSeen(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Private mode, or a full disk. The badge simply comes back next visit.
  }
}

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    /* Unreadable storage is the same as no record — fall through to the seed. */
  }
  // First run seeds everything EXCEPT the newest as already seen. A member who
  // signs up today has genuinely never seen any of these, but eleven NEW
  // badges is a wall of noise that means nothing — one badge on the current
  // video is the thing they would actually want pointed at. From then on NEW
  // means what it says: published since you last looked.
  return videosByRecency().slice(1).map((v) => v.id)
}

interface VideoLogState {
  /** Videos this browser has already been shown. */
  seenIds: string[]
  /** Called when a member opens a video — that row stops being NEW. */
  markSeen: (id: string) => void
}

export const useVideoLogStore = create<VideoLogState>((set, get) => ({
  seenIds: readSeen(),
  markSeen: (id) => {
    const { seenIds } = get()
    if (seenIds.includes(id)) return
    // Written whole rather than appended, so ids for videos that have since
    // been taken down get pruned on the way past.
    const next = [...seenIds, id].filter((v) => CHANNEL_VIDEOS.some((c) => c.id === v))
    writeSeen(next)
    set({ seenIds: next })
  },
}))

/** How many videos this member has not opened yet. */
export function unseenVideoCount(seenIds: string[]): number {
  return CHANNEL_VIDEOS.reduce((n, v) => (seenIds.includes(v.id) ? n : n + 1), 0)
}
