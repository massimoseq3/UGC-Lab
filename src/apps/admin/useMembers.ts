import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '../../lib/supabase'

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

const QUERY_TIMEOUT_MS = 15_000

// Members past this many days since last activity are flagged as churn risk.
export const INACTIVE_DAYS = 30

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

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

export interface UseMembersResult {
  rows: MemberRow[]
  // When `rows` was loaded (epoch ms; 0 before the first successful fetch).
  // Age-of-row maths reads this instead of calling Date.now() during render,
  // which would be an impure render call and make the React Compiler skip the
  // whole component.
  fetchedAt: number
  loading: boolean
  slowHint: boolean
  profilesError: string | null
  storageWarning: string | null
  activityWarning: string | null
  reload: () => Promise<void>
}

// Loads the member directory: profiles joined with the member_storage and
// member_activity views. profiles is load-bearing; the two views each fall
// back to zeros (with a warning) so one bad view never blanks the table.
// Shared by MembersTable and the Insights tab so both read one fetch.
export function useMembers(): UseMembersResult {
  const [rows, setRows] = useState<MemberRow[]>([])
  const [fetchedAt, setFetchedAt] = useState(0)
  const [loading, setLoading] = useState(true)
  const [slowHint, setSlowHint] = useState(false)
  const [profilesError, setProfilesError] = useState<string | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [activityWarning, setActivityWarning] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setProfilesError(null)
    setStorageWarning(null)
    setActivityWarning(null)
    setSlowHint(false)
    const slowTimer = setTimeout(() => setSlowHint(true), 3000)

    try {
      const sb = getSupabase()
      const [profilesRes, storageRes, activityRes] = await Promise.allSettled([
        withTimeout(
          sb.from('profiles').select('id, email, display_name, first_name, last_name, is_admin, disabled_at, created_at, last_active_at'),
          QUERY_TIMEOUT_MS,
          'profiles query',
        ),
        withTimeout(
          sb.from('member_storage').select('user_id, total_bytes, asset_count'),
          QUERY_TIMEOUT_MS,
          'storage view',
        ),
        withTimeout(
          sb.from('member_activity').select('user_id, products, models, scripts, voices, brolls, voice_history, video_history, assets_last_7d'),
          QUERY_TIMEOUT_MS,
          'activity view',
        ),
      ])

      if (profilesRes.status === 'rejected') {
        setProfilesError(profilesRes.reason instanceof Error ? profilesRes.reason.message : String(profilesRes.reason))
        return
      }
      if ((profilesRes.value as { error: unknown }).error) {
        const err = (profilesRes.value as { error: { message: string } }).error
        setProfilesError(err.message)
        return
      }

      const storageMap = new Map<string, { total_bytes: number; asset_count: number }>()
      if (storageRes.status === 'fulfilled' && !(storageRes.value as { error: unknown }).error) {
        const data = (storageRes.value as { data: Array<{ user_id: string; total_bytes: number; asset_count: number }> }).data ?? []
        for (const s of data) storageMap.set(s.user_id, { total_bytes: Number(s.total_bytes), asset_count: Number(s.asset_count) })
      } else {
        const reason = storageRes.status === 'rejected'
          ? (storageRes.reason instanceof Error ? storageRes.reason.message : String(storageRes.reason))
          : ((storageRes.value as { error?: { message: string } }).error?.message ?? 'unknown error')
        setStorageWarning(`Storage stats unavailable (${reason}).`)
      }

      type ActivityRow = {
        user_id: string
        products: number; models: number; scripts: number; voices: number
        brolls: number; voice_history: number; video_history: number; assets_last_7d: number
      }
      const activityMap = new Map<string, Omit<ActivityRow, 'user_id'>>()
      if (activityRes.status === 'fulfilled' && !(activityRes.value as { error: unknown }).error) {
        const data = (activityRes.value as { data: ActivityRow[] }).data ?? []
        for (const a of data) {
          activityMap.set(a.user_id, {
            products: Number(a.products), models: Number(a.models),
            scripts: Number(a.scripts), voices: Number(a.voices),
            brolls: Number(a.brolls), voice_history: Number(a.voice_history),
            video_history: Number(a.video_history), assets_last_7d: Number(a.assets_last_7d),
          })
        }
      } else {
        const reason = activityRes.status === 'rejected'
          ? (activityRes.reason instanceof Error ? activityRes.reason.message : String(activityRes.reason))
          : ((activityRes.value as { error?: { message: string } }).error?.message ?? 'unknown error')
        setActivityWarning(`Activity counts unavailable (${reason}). Did you run 0002_member_activity.sql?`)
      }

      const profilesData = (profilesRes.value as { data: Array<Pick<MemberRow, 'id' | 'email' | 'display_name' | 'first_name' | 'last_name' | 'is_admin' | 'disabled_at' | 'created_at' | 'last_active_at'>> }).data ?? []
      const merged: MemberRow[] = profilesData.map((p) => {
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
      setRows(merged)
      setFetchedAt(Date.now())
    } catch (e) {
      setProfilesError(e instanceof Error ? e.message : String(e))
    } finally {
      clearTimeout(slowTimer)
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  return { rows, fetchedAt, loading, slowHint, profilesError, storageWarning, activityWarning, reload }
}
