// Per-user orphan asset cleanup. Walks the user's `assets` table and
// cross-references every `asset-…` ref embedded anywhere in their bank
// rows; anything in the assets table that no bank row references is an
// orphan and gets deleted (IDB + Supabase row + R2 object).
//
// Sound for the signed-in user only — relies on the local bank state being
// fully hydrated from cloud (which startCloudSync guarantees on sign-in).

import { getSupabase, isCloudEnabled, selectAllRows } from '../lib/supabase'
import type { BankKey } from '../lib/cloudSync'
import { deleteAssetFromR2 } from '../lib/r2'
import { useAuthStore } from '../stores/authStore'
import { useBankStore } from '../stores/bankStore'
import { assetIdFromRef, deleteAsset, isAssetRef } from './assetStore'

// Every bank that stores `asset-…` refs anywhere in its `data` JSONB. This MUST
// list every bank — a missing entry causes that bank's assets to be wrongly
// classified as orphans and purged on the next cloud sign-in (this previously
// silently deleted imageHistory/musicHistory, then characterHistory gens). The
// `satisfies Record<BankKey, true>` guard forces the compiler to fail if a new
// BankKey is added without listing it here, so the list can't drift again. A
// type-only import of BankKey keeps this free of the cloudSync import cycle.
const BANK_KEYS = Object.keys({
  products: true, models: true, scripts: true, voices: true, brolls: true, styles: true,
  swipes: true,
  voiceHistory: true, videoHistory: true, imageHistory: true, musicHistory: true,
  scriptHistory: true, brollHistory: true, characterHistory: true, adAnatomyHistory: true,
  usageDays: true,
} satisfies Record<BankKey, true>) as BankKey[]

function walkAssetRefs(value: unknown, out: Set<string>) {
  if (typeof value === 'string') {
    // Refs appear in two shapes (bare "asset-x" and "asset://asset-x") but the
    // `assets` table is keyed by bare ids only — compare normalised, or every
    // prefixed ref (B-Roll videos) reads as an orphan and gets purged.
    if (isAssetRef(value)) out.add(assetIdFromRef(value))
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) walkAssetRefs(v, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) walkAssetRefs(v, out)
  }
}

export interface OrphanAsset {
  id: string
  byte_size: number
  mime_type: string
  created_at: string
}

export async function findOrphanAssets(): Promise<{
  orphans: OrphanAsset[]
  totalBytes: number
  // Total cloud-known assets and bytes — useful as denominators in the UI.
  total: number
  totalAssetBytes: number
}> {
  if (!isCloudEnabled()) return { orphans: [], totalBytes: 0, total: 0, totalAssetBytes: 0 }
  const userId = useAuthStore.getState().user?.id
  if (!userId) return { orphans: [], totalBytes: 0, total: 0, totalAssetBytes: 0 }

  const sb = getSupabase()
  // Paged — this list is the DELETE candidate set, so a truncated read is the
  // most dangerous kind here: it would pair a partial asset list against a
  // partial ref set and purge live blobs that only the unread rows referenced.
  const { data, error } = await selectAllRows<OrphanAsset>((from, to) =>
    sb
      .from('assets')
      .select('id, byte_size, mime_type, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .range(from, to),
  )
  if (error) throw new Error(`assets read: ${error.message}`)

  const all = data
  const totalAssetBytes = all.reduce((s, a) => s + Number(a.byte_size ?? 0), 0)

  const refs = new Set<string>()
  const bankState = useBankStore.getState()
  for (const key of BANK_KEYS) {
    const arr = bankState[key] as unknown[]
    for (const item of arr) walkAssetRefs(item, refs)
  }

  // Safety tripwire: an empty in-use ref set while the cloud holds assets almost
  // always means bank state didn't actually hydrate (a failed/empty hydrate, a
  // corrupted localStorage fallback, an IDB eviction) — NOT that every asset is
  // genuinely orphaned. Refuse to classify the user's entire asset store as
  // orphans; deleting it (IDB + R2) is irreversible. Returning zero orphans is
  // always safe — the user can re-run cleanup once state is healthy.
  if (refs.size === 0 && all.length > 0) {
    console.warn(`[orphanCleanup] aborting: 0 in-use refs but ${all.length} cloud asset(s) — bank state looks unhydrated, not classifying as orphans`)
    return { orphans: [], totalBytes: 0, total: all.length, totalAssetBytes }
  }

  // Normalise the row-id side too, as pure insurance. Bare ids are the only
  // shape the assets table can hold (the R2 sign/delete Edge functions reject
  // anything with `:`/`/`, so a prefixed row can't be written) — but if a
  // "asset://asset-x" row ever appeared by any path, normalising here keeps it
  // from being classified as an orphan while its bare id is still referenced,
  // which would otherwise let deleteAsset normalise the id and destroy the
  // LIVE bare-id blob instead.
  const orphans = all.filter((a) => !refs.has(assetIdFromRef(a.id)))
  const totalBytes = orphans.reduce((s, a) => s + Number(a.byte_size ?? 0), 0)
  return { orphans, totalBytes, total: all.length, totalAssetBytes }
}

export async function purgeOrphans(
  ids: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; failed: Array<{ id: string; error: string }> }> {
  let ok = 0
  const failed: Array<{ id: string; error: string }> = []
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    try {
      if (id.startsWith('asset://')) {
        // Legacy duplicate row keyed by a raw ref — delete it VERBATIM.
        // deleteAsset normalises ids, which here would destroy the live
        // bare-id blob/row instead of the duplicate.
        await deleteAssetFromR2(id)
      } else {
        await deleteAsset(id)
      }
      ok++
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : String(e) })
    }
    onProgress?.(i + 1, ids.length)
  }
  return { ok, failed }
}

// Per-user storage cap. Mirrors the same value enforced in api/r2-sign.ts —
// keep them in sync if either ever changes.
export const STORAGE_CAP_BYTES = 10 * 1024 * 1024 * 1024 // 10 GB

// Lightweight aggregate read for the Settings storage bar. Uses the same
// `assets` table read as findOrphanAssets but only returns totals.
export async function getStorageUsage(): Promise<{ totalBytes: number; assetCount: number }> {
  if (!isCloudEnabled()) return { totalBytes: 0, assetCount: 0 }
  const userId = useAuthStore.getState().user?.id
  if (!userId) return { totalBytes: 0, assetCount: 0 }

  const sb = getSupabase()
  // Paged, or the Settings storage bar plateaus at the row cap and a member
  // near the 10 GB ceiling is told they've used a fraction of what they have.
  const { data: rows, error } = await selectAllRows<{ byte_size: number }>((from, to) =>
    sb.from('assets').select('byte_size', { count: 'exact' }).eq('user_id', userId).range(from, to),
  )
  if (error) throw new Error(`storage usage: ${error.message}`)
  return {
    totalBytes: rows.reduce((s, r) => s + Number(r.byte_size ?? 0), 0),
    assetCount: rows.length,
  }
}

export function formatBytes(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
