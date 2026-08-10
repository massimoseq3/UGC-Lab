import { create } from 'zustand'
import { getSupabase, isCloudEnabled, ensureFreshSession } from '../lib/supabase'
import { useAuthStore } from './authStore'

// Announcements — the operator's broadcast channel (migration 0020).
//
// This is deliberately NOT a bank. Every bank row belongs to one member and
// rides bankStore + cloudSync's per-user diff push; an announcement is a single
// global list written by an admin and read by everyone, so it gets its own tiny
// store that reads Supabase directly on sign-in.
//
// Two levels:
//   'update' → a red dot on the Dashboard tile, and nothing else.
//   'alert'  → also opens once as a modal on the next load, then never again.
// One control, so an outage notice can interrupt without training members to
// dismiss every feature note on sight.
//
// Read state lives per ACCOUNT (announcement_reads), not per browser: read on
// the laptop means read on the phone, and it's what makes the Admin read
// receipts possible.

export type AnnouncementLevel = 'update' | 'alert'

export interface Announcement {
  id: string
  title: string
  body: string
  level: AnnouncementLevel
  /** True when a picture exists — the list query never carries the payload. */
  hasImage: boolean
  videoUrl: string | null
  ctaLabel: string | null
  ctaUrl: string | null
  ctaApp: string | null
  publishedAt: string | null
  expiresAt: string | null
  pinned: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Every column except `image`. The image is a base64 JPEG living inline in the
 * row (see the migration's note on why), so pulling it for a whole log of
 * announcements would mean megabytes on every sign-in. Cards fetch their own.
 */
export const ANNOUNCEMENT_COLUMNS =
  'id, title, body, level, has_image, video_url, cta_label, cta_url, cta_app, published_at, expires_at, pinned, created_at, updated_at'

export interface AnnouncementRow {
  id: string
  title: string
  body: string | null
  level: string | null
  has_image?: boolean | null
  video_url: string | null
  cta_label: string | null
  cta_url: string | null
  cta_app: string | null
  published_at: string | null
  expires_at: string | null
  pinned: boolean | null
  created_at: string
  updated_at: string
}

export function rowToAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? '',
    level: row.level === 'alert' ? 'alert' : 'update',
    hasImage: row.has_image === true,
    videoUrl: row.video_url,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    ctaApp: row.cta_app,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    pinned: row.pinned === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Pinned first, then newest published. The order of the log and the feed. */
export function sortAnnouncements(items: Announcement[]): Announcement[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const at = a.publishedAt ?? a.createdAt
    const bt = b.publishedAt ?? b.createdAt
    return bt.localeCompare(at)
  })
}

interface AnnouncementState {
  items: Announcement[]
  /** Ids this member has already seen. */
  readIds: string[]
  /** id → data URI, or null once we know the fetch came back empty. */
  images: Record<string, string | null>
  loading: boolean
  /** Set when the fetch failed — the tile stays quiet rather than shouting. */
  error: string | null
  loaded: boolean

  /** The log panel (the Dashboard tile opens it). */
  panelOpen: boolean
  /** The unread 'alert' currently being shown as a modal, if any. */
  alertId: string | null

  load: () => Promise<void>
  openPanel: () => void
  closePanel: () => void
  dismissAlert: () => void
  markRead: (id: string) => void
  markAllRead: () => void
  loadImage: (id: string) => Promise<void>
  reset: () => void
}

const initialState = {
  items: [] as Announcement[],
  readIds: [] as string[],
  images: {} as Record<string, string | null>,
  loading: false,
  error: null as string | null,
  loaded: false,
  panelOpen: false,
  alertId: null as string | null,
}

export const useAnnouncementStore = create<AnnouncementState>((set, get) => ({
  ...initialState,

  load: async () => {
    if (!isCloudEnabled()) return
    const userId = useAuthStore.getState().user?.id
    if (!userId || get().loading) return
    set({ loading: true })
    try {
      // Same reason every other cloud path awaits this: supabase-js takes its
      // auth lock on every request, and a backgrounded tab can leave the first
      // query queued behind the SDK's own refresh.
      await ensureFreshSession()
      const sb = getSupabase()
      const [listed, receipts] = await Promise.all([
        sb.from('announcements').select(ANNOUNCEMENT_COLUMNS).order('published_at', { ascending: false }),
        sb.from('announcement_reads').select('announcement_id').eq('user_id', userId),
      ])
      if (listed.error) throw new Error(listed.error.message)

      const items = sortAnnouncements((listed.data as AnnouncementRow[] ?? []).map(rowToAnnouncement))
      // A receipts failure is not worth failing the load over — worst case a
      // member sees the dot once more than they should.
      const readIds = receipts.error
        ? get().readIds
        : (receipts.data as Array<{ announcement_id: string }> ?? []).map((r) => r.announcement_id)

      // The interrupt: the oldest unread alert, so a run of them arrives in
      // the order it was written rather than newest-first.
      const alert = [...items]
        .reverse()
        .find((a) => a.level === 'alert' && !readIds.includes(a.id))

      set({ items, readIds, loading: false, loaded: true, error: null, alertId: alert?.id ?? null })
    } catch (e) {
      // Never toasted: a member who can't reach announcements is not blocked
      // from anything, and a startup toast about it is pure noise.
      console.warn('[announcements] load failed', e)
      set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    }
  },

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),

  dismissAlert: () => {
    const id = get().alertId
    if (id) get().markRead(id)
    // Show at most one alert per load. A second one waits for the next visit
    // rather than stacking modals on a member trying to start work.
    set({ alertId: null })
  },

  markRead: (id) => {
    if (get().readIds.includes(id)) return
    // Local first, cloud in the background — the same contract as bankStore:
    // the UI never awaits a round trip, and a failed write just means the dot
    // comes back on the next load.
    set({ readIds: [...get().readIds, id] })
    void pushRead([id])
  },

  markAllRead: () => {
    const { items, readIds } = get()
    const fresh = items.filter((a) => !readIds.includes(a.id)).map((a) => a.id)
    if (fresh.length === 0) return
    set({ readIds: [...readIds, ...fresh], alertId: null })
    void pushRead(fresh)
  },

  loadImage: async (id) => {
    if (id in get().images) return
    if (!isCloudEnabled()) return
    // Claim the slot before awaiting so two cards mounting together can't both
    // fire the fetch.
    set({ images: { ...get().images, [id]: null } })
    try {
      await ensureFreshSession()
      const { data, error } = await getSupabase()
        .from('announcements')
        .select('image')
        .eq('id', id)
        .maybeSingle()
      if (error) throw new Error(error.message)
      const image = (data as { image: string | null } | null)?.image ?? null
      set({ images: { ...get().images, [id]: image } })
    } catch (e) {
      console.warn('[announcements] image fetch failed', e)
    }
  },

  reset: () => set({ ...initialState }),
}))

async function pushRead(ids: string[]): Promise<void> {
  if (!isCloudEnabled() || ids.length === 0) return
  const userId = useAuthStore.getState().user?.id
  if (!userId) return
  try {
    await ensureFreshSession()
    const { error } = await getSupabase()
      .from('announcement_reads')
      .upsert(ids.map((announcement_id) => ({ user_id: userId, announcement_id })), {
        onConflict: 'user_id,announcement_id',
      })
    if (error) throw new Error(error.message)
  } catch (e) {
    console.warn('[announcements] read receipt failed', e)
  }
}

/** Count for the Dashboard tile's dot. */
export function unreadCount(items: Announcement[], readIds: string[]): number {
  return items.reduce((n, a) => (readIds.includes(a.id) ? n : n + 1), 0)
}

/** Wipe on sign-out, alongside the bank/settings resets in authStore. */
export function resetAnnouncementStore(): void {
  useAnnouncementStore.getState().reset()
}
