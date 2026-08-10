import { useEffect } from 'react'
import { create } from 'zustand'
import { getSupabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/authStore'
import { QUERY_TIMEOUT_MS, readyAdminSession, reasonOf, withTimeout } from './adminQuery'

export interface MemberRow {
  id: string
  email: string
  display_name: string | null
  first_name: string | null
  last_name: string | null
  is_admin: boolean
  disabled_at: string | null
  created_at: string
  last_active_at: string | null
  total_bytes: number
  asset_count: number
  // Activity counters from member_activity view
  products: number
  models: number
  scripts: number
  voices: number
  brolls: number
  voice_history: number
  video_history: number
  assets_last_7d: number
}

// Members past this many days since last activity are flagged as churn risk.
export const INACTIVE_DAYS = 30

// How long a loaded directory counts as fresh. Switching between the Members
// and Insights tabs inside this window reads the cache instead of refiring
// three queries — the tab switch is what used to drop both tabs back to a
// spinner every single time.
const STALE_AFTER_MS = 60_000

// Render "First Last" with whichever fields are present; falls back to
// display_name, otherwise an empty string (callers render an em-dash).
export function memberName(r: Pick<MemberRow, 'first_name' | 'last_name' | 'display_name'>): string {
  const joined = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
  if (joined) return joined
  return (r.display_name ?? '').trim()
}

// Days since a member was last active (falls back to join date). null = never.
export function daysSinceActive(r: Pick<MemberRow, 'last_active_at' | 'created_at'>): number {
  const ref = r.last_active_at ?? r.created_at
  if (!ref) return Infinity
  return Math.floor((Date.now() - new Date(ref).getTime()) / (24 * 60 * 60_000))
}

// A non-disabled member who hasn't been active in INACTIVE_DAYS+ days.
export function isInactive(r: MemberRow): boolean {
  return !r.disabled_at && daysSinceActive(r) >= INACTIVE_DAYS
}

// Has the member ever produced anything? asset_count covers every stored blob,
// so 0 means a signup that never created a single asset (never activated).
export function isActivated(r: MemberRow): boolean {
  return r.asset_count > 0
}

export function formatBytes(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// "2 days ago", "3h ago", etc. Used for last_active_at.
export function formatRelative(s: string | null): string {
  if (!s) return 'never'
  const d = new Date(s).getTime()
  const diff = Date.now() - d
  if (diff < 60_000) return 'just now'
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 24 * 60 * 60_000) return `${Math.round(diff / (60 * 60_000))}h ago`
  const days = Math.round(diff / (24 * 60 * 60_000))
  if (days < 30) return `${days}d ago`
  return formatDate(s)
}

interface DirectoryState {
  rows: MemberRow[]
  loadedAt: number | null
  // Who the cached rows were loaded for. The store is module-level, so it
  // outlives the sign-out that remounts the workspace — without this, the next
  // admin on the same browser would open Admin to the previous one's list.
  loadedForUser: string | null
  // First load with nothing to show yet — the only state that renders a spinner.
  loading: boolean
  // A background refresh over rows we already have. Never blanks the table.
  refreshing: boolean
  slowHint: boolean
  profilesError: string | null
  storageWarning: string | null
  activityWarning: string | null
  load: (opts?: { force?: boolean; userId?: string | null }) => Promise<void>
}

type Setter = (partial: Partial<DirectoryState>) => void

// Module-level rather than store state so a second caller awaits the SAME
// request instead of starting its own — Members and Insights mount together.
let inflight: Promise<void> | null = null

async function fetchDirectory(set: Setter, hadRows: boolean): Promise<void> {
  set({
    loading: !hadRows,
    refreshing: true,
    slowHint: false,
    profilesError: null,
    storageWarning: null,
    activityWarning: null,
  })
  const slowTimer = setTimeout(() => set({ slowHint: true }), 3000)

  try {
    await readyAdminSession()
    const sb = getSupabase()
    const [profilesRes, storageRes, activityRes] = await Promise.allSettled([
      withTimeout(
        (signal) => sb.from('profiles')
          .select('id, email, display_name, first_name, last_name, is_admin, disabled_at, created_at, last_active_at')
          .abortSignal(signal),
        QUERY_TIMEOUT_MS,
        'profiles query',
      ),
      withTimeout(
        (signal) => sb.from('member_storage').select('user_id, total_bytes, asset_count').abortSignal(signal),
        QUERY_TIMEOUT_MS,
        'storage view',
      ),
      withTimeout(
        (signal) => sb.from('member_activity')
          .select('user_id, products, models, scripts, voices, brolls, voice_history, video_history, assets_last_7d')
          .abortSignal(signal),
        QUERY_TIMEOUT_MS,
        'activity view',
      ),
    ])

    if (profilesRes.status === 'rejected' || profilesRes.value.error) {
      // Keep whatever rows we already had — a failed refresh is not a reason to
      // empty the table under the admin.
      set({ profilesError: reasonOf(profilesRes) })
      return
    }

    const storageMap = new Map<string, { total_bytes: number; asset_count: number }>()
    if (storageRes.status === 'fulfilled' && !storageRes.value.error) {
      for (const s of storageRes.value.data ?? []) {
        storageMap.set(s.user_id, { total_bytes: Number(s.total_bytes), asset_count: Number(s.asset_count) })
      }
    } else {
      set({ storageWarning: `Storage stats unavailable (${reasonOf(storageRes)}).` })
    }

    const activityMap = new Map<string, Omit<ActivityRow, 'user_id'>>()
    if (activityRes.status === 'fulfilled' && !activityRes.value.error) {
      for (const a of activityRes.value.data ?? []) {
        activityMap.set(a.user_id, {
          products: Number(a.products), models: Number(a.models),
          scripts: Number(a.scripts), voices: Number(a.voices),
          brolls: Number(a.brolls), voice_history: Number(a.voice_history),
          video_history: Number(a.video_history), assets_last_7d: Number(a.assets_last_7d),
        })
      }
    } else {
      set({ activityWarning: `Activity counts unavailable (${reasonOf(activityRes)}). Did you run 0002_member_activity.sql?` })
    }

    const merged: MemberRow[] = (profilesRes.value.data ?? []).map((p) => {
      const s = storageMap.get(p.id)
      const a = activityMap.get(p.id)
      return {
        ...p,
        total_bytes: s?.total_bytes ?? 0,
        asset_count: s?.asset_count ?? 0,
        products: a?.products ?? 0,
        models: a?.models ?? 0,
        scripts: a?.scripts ?? 0,
        voices: a?.voices ?? 0,
        brolls: a?.brolls ?? 0,
        voice_history: a?.voice_history ?? 0,
        video_history: a?.video_history ?? 0,
        assets_last_7d: a?.assets_last_7d ?? 0,
      }
    })
    set({ rows: merged, loadedAt: Date.now() })
  } catch (e) {
    set({ profilesError: e instanceof Error ? e.message : String(e) })
  } finally {
    clearTimeout(slowTimer)
    set({ loading: false, refreshing: false })
  }
}

type ActivityRow = {
  user_id: string
  products: number; models: number; scripts: number; voices: number
  brolls: number; voice_history: number; video_history: number; assets_last_7d: number
}

// The member directory: profiles joined with the member_storage and
// member_activity views. profiles is load-bearing; the two views each fall back
// to zeros (with a warning) so one bad view never blanks the table.
//
// It's a store, not per-component state, because MembersTable and Insights both
// read it and the admin flips between them constantly. Cached across tab
// switches and across leaving/re-entering the Admin app; `reload()` is the
// explicit refresh.
export const useMemberDirectory = create<DirectoryState>((set, get) => ({
  rows: [],
  loadedAt: null,
  loadedForUser: null,
  loading: true,
  refreshing: false,
  slowHint: false,
  profilesError: null,
  storageWarning: null,
  activityWarning: null,

  load: async ({ force = false, userId = null } = {}) => {
    if (inflight) return inflight
    const { loadedAt, loadedForUser, rows } = get()
    // A different account signed in — the cache belongs to someone else.
    const wrongUser = userId !== null && loadedForUser !== null && loadedForUser !== userId
    if (wrongUser) set({ rows: [], loadedAt: null, loadedForUser: null })

    if (!force && !wrongUser && loadedAt !== null && Date.now() - loadedAt < STALE_AFTER_MS) {
      // Cache is warm — make sure a stale `loading` from a first mount can't
      // leave a tab stuck on its spinner.
      set({ loading: false })
      return
    }
    set({ loadedForUser: userId })
    inflight = fetchDirectory(set, !wrongUser && rows.length > 0)
    try {
      await inflight
    } finally {
      inflight = null
    }
  },
}))

export interface UseMembersResult {
  rows: MemberRow[]
  // When `rows` was loaded (epoch ms; 0 before the first successful fetch).
  // Age-of-row maths reads this instead of calling Date.now() during render,
  // which would be an impure render call and make the React Compiler skip the
  // whole component. Same clock the store's own staleness check uses.
  fetchedAt: number
  loading: boolean
  refreshing: boolean
  slowHint: boolean
  profilesError: string | null
  storageWarning: string | null
  activityWarning: string | null
  reload: () => Promise<void>
}

// Subscribes to the shared directory and loads it if it's cold or stale.
// Shared by MembersTable and the Insights tab so both read one fetch.
export function useMembers(): UseMembersResult {
  const state = useMemberDirectory()
  const load = useMemberDirectory((s) => s.load)
  const userId = useAuthStore((s) => s.user?.id ?? null)

  useEffect(() => { void load({ userId }) }, [load, userId])

  return {
    rows: state.rows,
    fetchedAt: state.loadedAt ?? 0,
    loading: state.loading,
    refreshing: state.refreshing,
    slowHint: state.slowHint,
    profilesError: state.profilesError,
    storageWarning: state.storageWarning,
    activityWarning: state.activityWarning,
    reload: () => load({ force: true, userId }),
  }
}
