// Bridges the Zustand stores to Supabase Postgres. Each user-initiated change
// writes local state first (synchronous localStorage), then pushes the row to
// the cloud. A push that fails or times out is recorded in a persistent
// localStorage outbox and replayed later (on startup and on tab focus), so a
// transient cloud stall can never silently drop a row — the data-loss bug that
// flipped this module away from its earlier "no retry queue" design.
//
// Public surface:
//   • startCloudSync() / stopCloudSync() — hydrate-on-signin, reset-on-signout
//   • saveRow / deleteRow                — used by bankStore actions
//   • recordPendingUpsert / recordPendingDelete / clearPending — outbox, used
//                                          by bankStore's push/drop wrappers
//   • saveProfile                        — used by settingsStore actions
//
// Stores stay localStorage-backed (source of truth in the browser). On sign-in
// we hydrate stores from cloud, but the hydrate is non-destructive: a per-table
// fetch error keeps the existing local rows, and any outbox-pending rows are
// overlaid so an unsynced row survives a refresh.

import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'
import { useBankStore, backfillUsageLedger, persistBanksNow, localBanksReady, markCloudHydrated } from '../stores/bankStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getSupabase, isCloudEnabled, ensureFreshSession, selectAllRows } from './supabase'
import { existingRemoteAssetIds, uploadAssetToR2 } from './r2'
import { isAssetRef, assetIdFromRef, getBlob } from '../utils/assetStore'
import { findOrphanAssets, purgeOrphans } from '../utils/orphanCleanup'
import type { Product, Model, Script, VoicePreset, BRoll, StylePreset, SwipeItem, TrackedAccount, VoiceHistoryItem, VideoHistoryItem, ImageHistoryItem, MusicHistoryItem, ScriptHistoryItem, BrollHistoryItem, CharacterHistoryItem, AdAnatomyHistoryItem, UsageDay } from '../stores/types'

export type BankKey =
  | 'products' | 'models' | 'scripts' | 'voices' | 'brolls' | 'styles' | 'swipes'
  | 'trackedAccounts'
  | 'voiceHistory' | 'videoHistory' | 'imageHistory' | 'musicHistory'
  | 'scriptHistory' | 'brollHistory' | 'characterHistory' | 'adAnatomyHistory'
  | 'usageDays'

const BANK_TO_TABLE: Record<BankKey, string> = {
  products: 'products',
  models: 'models',
  scripts: 'scripts',
  voices: 'voices',
  brolls: 'brolls',
  styles: 'styles',
  swipes: 'swipes',
  trackedAccounts: 'tracked_accounts',
  voiceHistory: 'voice_history',
  videoHistory: 'video_history',
  imageHistory: 'image_history',
  musicHistory: 'music_history',
  scriptHistory: 'script_history',
  brollHistory: 'broll_history',
  characterHistory: 'character_history',
  adAnatomyHistory: 'ad_anatomy_history',
  usageDays: 'usage_days',
}

const BANK_KEYS: BankKey[] = ['products', 'models', 'scripts', 'voices', 'brolls', 'styles', 'swipes', 'trackedAccounts', 'voiceHistory', 'videoHistory', 'imageHistory', 'musicHistory', 'scriptHistory', 'brollHistory', 'characterHistory', 'adAnatomyHistory', 'usageDays']

function reportError(context: string, err: unknown) {
  const msg = err instanceof Error ? err.message : (typeof err === 'string' ? err : JSON.stringify(err))
  console.error(`[cloudSync] ${context}:`, err)
  try { useAppStore.getState().addToast(`Cloud · ${context}: ${msg}`, 'error') } catch { /* store not ready */ }
}

// ── Persistent sync outbox ──────────────────────────────────────────
//
// A localStorage-backed queue of cloud writes that haven't been confirmed.
// `upserts` keep the full row snapshot (needed to replay and to overlay during
// hydrate); `deletes` keep just the id. An upsert and a delete for the same id
// are mutually exclusive — recording one clears the other.

// Outbox key is namespaced PER USER. The full row snapshot lives here, so a
// global key was a cross-tenant leak: on a shared browser, a row user A queued
// (push failed/timed out) before signing out would be replayed by drainOutbox
// under user B's id (re-attributing A's data to B, which RLS can't catch since
// the client supplies B's own uid) and overlaid into B's UI by applyOutbox.
// Per-user namespacing means B only ever reads its own `…:<B-id>` slot, so A's
// queue is unreachable while B is signed in. wipeLocalUserData() additionally
// purges every `…:sync-outbox*` key on sign-out / account-swap so no residue
// is left for the next person. The legacy global `ugc-lab:sync-outbox` key
// (pre-namespacing) is intentionally never read again.
const OUTBOX_KEY_PREFIX = 'ugc-lab:sync-outbox'

function outboxKey(): string | null {
  const userId = useAuthStore.getState().user?.id
  return userId ? `${OUTBOX_KEY_PREFIX}:${userId}` : null
}

interface Outbox {
  upserts: Partial<Record<BankKey, Record<string, { id: string }>>>
  deletes: Partial<Record<BankKey, string[]>>
}

function readOutbox(): Outbox {
  const key = outboxKey()
  if (!key) return { upserts: {}, deletes: {} }
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Outbox>
      return { upserts: parsed.upserts ?? {}, deletes: parsed.deletes ?? {} }
    }
  } catch { /* corrupted — start empty */ }
  return { upserts: {}, deletes: {} }
}

let outboxWriteFailed = false

function writeOutbox(ob: Outbox) {
  const key = outboxKey()
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(ob))
    outboxWriteFailed = false
  } catch (e) {
    // The outbox IS the durability guarantee behind a fire-and-forget push: a
    // failed write here means a failed push has nothing to replay it from. It
    // used to be swallowed as "quota — ignore", which under a full disk took
    // out both copies of a new row at once — local blob and replay entry — and
    // the member still saw a green "Saved". Warn once per run of failures so
    // it's visible in a console the operator can ask for.
    if (!outboxWriteFailed) {
      outboxWriteFailed = true
      console.error('[cloudSync] outbox write failed — a failed push cannot be replayed', e)
    }
  }
}

// Per-row marker tokens. Every record* call mints a fresh token, and
// clearPending only removes the marker when the caller's token is still the
// row's current one. Without this, a slow write that confirms late clears the
// marker a NEWER write just recorded — e.g. update row (push stalls), delete
// row (delete marker recorded), stalled upsert finally confirms and wipes the
// delete marker → the delete is never replayed and the row resurrects on the
// next hydrate. In-memory only is enough: a stale success callback can only
// exist in the page session that started the write, and after a refresh the
// map is empty so previous-session markers clear normally (token undefined).
let markerSeq = 0
const markerTokens = new Map<string, number>()

export function pendingToken(table: BankKey, id: string): number | undefined {
  return markerTokens.get(`${table}:${id}`)
}

export function recordPendingUpsert(table: BankKey, row: { id: string }): number {
  const ob = readOutbox()
  ;(ob.upserts[table] ??= {})[row.id] = row
  if (ob.deletes[table]) ob.deletes[table] = ob.deletes[table]!.filter((d) => d !== row.id)
  writeOutbox(ob)
  const token = ++markerSeq
  markerTokens.set(`${table}:${row.id}`, token)
  return token
}

export function recordPendingDelete(table: BankKey, id: string): number {
  const ob = readOutbox()
  if (ob.upserts[table]) delete ob.upserts[table]![id]
  const list = (ob.deletes[table] ??= [])
  if (!list.includes(id)) list.push(id)
  writeOutbox(ob)
  const token = ++markerSeq
  markerTokens.set(`${table}:${id}`, token)
  return token
}

export function clearPending(table: BankKey, id: string, token?: number): void {
  if (markerTokens.get(`${table}:${id}`) !== token) return
  markerTokens.delete(`${table}:${id}`)
  const ob = readOutbox()
  if (ob.upserts[table]) delete ob.upserts[table]![id]
  if (ob.deletes[table]) ob.deletes[table] = ob.deletes[table]!.filter((d) => d !== id)
  writeOutbox(ob)
}

// Overlay the outbox onto a base array of rows for one bank: pending upserts
// add/replace by id, pending deletes remove by id. Used during hydrate so an
// unsynced local row survives the cloud pull.
function applyOutbox(table: BankKey, base: unknown[]): unknown[] {
  const ob = readOutbox()
  const upserts = ob.upserts[table]
  const deletes = ob.deletes[table]
  if (!upserts && !deletes) return base
  const byId = new Map<string, unknown>()
  for (const row of base) byId.set((row as { id: string }).id, row)
  for (const [id, row] of Object.entries(upserts ?? {})) byId.set(id, row)
  for (const id of deletes ?? []) byId.delete(id)
  return Array.from(byId.values())
}

let draining = false

function outboxHasWork(ob: Outbox = readOutbox()): boolean {
  return BANK_KEYS.some((k) => Object.keys(ob.upserts[k] ?? {}).length > 0 || (ob.deletes[k]?.length ?? 0) > 0)
}

// In-session retry timer. The startup + tab-focus drains only fire after a
// refresh or an app switch — without this, a row that failed to push sat in
// the outbox for the rest of the session, making the "will retry syncing
// automatically" toast a lie until the next reload. Doubling backoff so a
// real Supabase outage isn't hammered; reset once a drain clears the queue.
const DRAIN_RETRY_BASE_MS = 30_000
const DRAIN_RETRY_MAX_MS = 5 * 60_000
let drainRetryMs = DRAIN_RETRY_BASE_MS
let drainTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleOutboxDrain(): void {
  if (drainTimer || !outboxHasWork()) return
  drainTimer = setTimeout(() => {
    drainTimer = null
    drainRetryMs = Math.min(drainRetryMs * 2, DRAIN_RETRY_MAX_MS)
    drainOutbox().catch((e) => console.warn('[cloudSync] scheduled drain failed', e))
  }, drainRetryMs)
}

// Replay every queued write. Best-effort: a write that fails again stays
// queued for the next drain. Runs after hydrate, on tab focus, and on the
// scheduleOutboxDrain backoff timer.
export async function drainOutbox(): Promise<void> {
  if (draining) return
  if (!isCloudEnabled() || !useAuthStore.getState().user) return
  const ob = readOutbox()
  if (!outboxHasWork(ob)) return

  draining = true
  try {
    for (const key of BANK_KEYS) {
      for (const row of Object.values(ob.upserts[key] ?? {})) {
        // Capture the marker token before replaying: if the user touches the
        // row while our write is in flight, the token changes and our
        // clearPending becomes a no-op — the fresh marker survives.
        const token = pendingToken(key, row.id)
        try { await saveRow(key, row); clearPending(key, row.id, token) }
        catch (e) { console.warn(`[cloudSync] outbox upsert ${key}/${row.id} still failing`, e) }
      }
      for (const id of [...(ob.deletes[key] ?? [])]) {
        const token = pendingToken(key, id)
        try { await deleteRow(key, id); clearPending(key, id, token) }
        catch (e) { console.warn(`[cloudSync] outbox delete ${key}/${id} still failing`, e) }
      }
    }
  } finally {
    draining = false
    if (outboxHasWork()) scheduleOutboxDrain()
    else drainRetryMs = DRAIN_RETRY_BASE_MS
  }
}

function walkAssetRefs(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    // Normalise "asset://asset-x" refs (B-Roll videos) to the bare id — the
    // `assets` table and R2 keys use bare ids, so an unnormalised ref never
    // matches existingRemoteAssetIds and gets re-uploaded under a duplicate
    // prefixed key on every sign-in.
    if (isAssetRef(value)) out.push(assetIdFromRef(value))
    return out
  }
  if (Array.isArray(value)) {
    for (const v of value) walkAssetRefs(v, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) walkAssetRefs(v, out)
  }
  return out
}

// ── Public mutation helpers ─────────────────────────────────────────

// Per-attempt hard abort for single-row writes. A promise-race timeout (like
// bankStore's withTimeout backstop) only abandons the await — the underlying
// fetch keeps hanging on whatever dead connection caused the stall, and a
// retry would queue behind it. AbortController actually cancels the request,
// so the retry goes out as a fresh request on a fresh connection.
const ROW_ATTEMPT_TIMEOUT_MS = 6_000

function attemptSignal(): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ROW_ATTEMPT_TIMEOUT_MS)
  return { signal: ctrl.signal, done: () => clearTimeout(timer) }
}

async function upsertRowOnce(table: BankKey, row: { id: string }, userId: string): Promise<void> {
  const { signal, done } = attemptSignal()
  try {
    const { error } = await getSupabase().from(BANK_TO_TABLE[table]).upsert({
      id: row.id,
      user_id: userId,
      data: row,
      updated_at: new Date().toISOString(),
    }).abortSignal(signal)
    if (error) throw new Error(`${BANK_TO_TABLE[table]} upsert: ${error.message}`)
  } finally {
    done()
  }
}

// Serialise cloud writes PER ROW. Pushes are fire-and-forget, so without this
// two writes for the same row can land in Postgres out of order — the worst
// case being a stalled upsert that finally completes AFTER a delete for the
// same row, re-inserting it server-side with nothing left in the outbox to
// correct it. Each attempt is already hard-bounded (attemptSignal aborts at
// 6s, max two attempts), so a chain never grows past a few entries.
const rowWriteChains = new Map<string, Promise<void>>()

function serializedRowWrite<T>(table: BankKey, id: string, op: () => Promise<T>): Promise<T> {
  const key = `${table}:${id}`
  const prev = rowWriteChains.get(key) ?? Promise.resolve()
  const run = prev.then(op, op) // run regardless of the previous write's outcome
  const tail = run.then(() => undefined, () => undefined)
  rowWriteChains.set(key, tail)
  void tail.then(() => {
    if (rowWriteChains.get(key) === tail) rowWriteChains.delete(key)
  })
  return run
}

// Save one bank row. Awaited. Throws on failure so callers can react.
// Two bounded attempts: the common failure here is a stalled connection after
// a long-lived tab (the fetch hangs, no error ever fires), and historically a
// page refresh "fixed" it because the new page got a fresh connection. The
// abort-and-retry reproduces that recovery without bothering the user.
export function saveRow(table: BankKey, row: { id: string }): Promise<void> {
  return serializedRowWrite(table, row.id, async () => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) throw new Error('Not signed in')
    await ensureFreshSession()
    try {
      await upsertRowOnce(table, row, userId)
    } catch (first) {
      console.warn(`[cloudSync] ${BANK_TO_TABLE[table]} upsert attempt 1 failed — retrying once`, first)
      await ensureFreshSession()
      await upsertRowOnce(table, row, userId)
    }
  })
}

// Bulk variant — kept for callers that need batched writes. Sequential per
// table to keep error reporting clean.
export async function saveRows(table: BankKey, rows: Array<{ id: string }>): Promise<void> {
  if (rows.length === 0) return
  const userId = useAuthStore.getState().user?.id
  if (!userId) throw new Error('Not signed in')
  await ensureFreshSession()
  const sb = getSupabase()
  const isoNow = new Date().toISOString()
  const { error } = await sb.from(BANK_TO_TABLE[table]).upsert(rows.map((r) => ({
    id: r.id,
    user_id: userId,
    data: r,
    updated_at: isoNow,
  })))
  if (error) throw new Error(`${BANK_TO_TABLE[table]} bulk upsert: ${error.message}`)
}

async function deleteRowOnce(table: BankKey, id: string, userId: string): Promise<void> {
  const { signal, done } = attemptSignal()
  try {
    const { error } = await getSupabase().from(BANK_TO_TABLE[table])
      .delete().eq('id', id).eq('user_id', userId).abortSignal(signal)
    if (error) throw new Error(`${BANK_TO_TABLE[table]} delete: ${error.message}`)
  } finally {
    done()
  }
}

// Delete one bank row. Awaited. Same bounded-attempts shape as saveRow, and
// serialised behind any in-flight write for the same row (see above).
export function deleteRow(table: BankKey, id: string): Promise<void> {
  return serializedRowWrite(table, id, async () => {
    const userId = useAuthStore.getState().user?.id
    if (!userId) throw new Error('Not signed in')
    await ensureFreshSession()
    try {
      await deleteRowOnce(table, id, userId)
    } catch (first) {
      console.warn(`[cloudSync] ${BANK_TO_TABLE[table]} delete attempt 1 failed — retrying once`, first)
      await ensureFreshSession()
      await deleteRowOnce(table, id, userId)
    }
  })
}

// Save the profile sheet (per-app model selections only). The kie.ai API key
// is intentionally NOT included here — it lives in browser localStorage only,
// never in the database. See CLAUDE.md "Auth + cloud sync".
export async function saveProfile(): Promise<void> {
  const userId = useAuthStore.getState().user?.id
  if (!userId) throw new Error('Not signed in')
  await ensureFreshSession()
  const sb = getSupabase()
  const s = useSettingsStore.getState()
  const { error } = await sb.from('profiles').update({
    per_app_model: s.perAppModel,
  }).eq('id', userId)
  if (error) throw new Error(`profile update: ${error.message}`)
}

// ── Hydrate / startup ──────────────────────────────────────────────

// Returns true only if EVERY bank table hydrated cleanly. A false return means
// at least one table fell back to local state (cloud fetch errored), which the
// caller uses to skip the destructive orphan sweep — sweeping against a bank
// that hydrated to `[]` would classify live assets as orphans and delete them.
async function hydrateFromCloud(userId: string): Promise<boolean> {
  const sb = getSupabase()

  // Fired here, awaited below. It used to be `await`ed before the bank pull
  // started, which made it a round trip the bank tables queued behind — and
  // sign-in is BLOCKING (AuthGate holds the workspace behind "Syncing your
  // workspace…"), so on a link where a round trip costs 100ms+ rather than
  // 20ms that wait is dead time the member sits through. Nothing in the bank
  // pull reads the profile, so the two are independent.
  const profilePromise = sb
    .from('profiles')
    .select('per_app_model')
    .eq('id', userId)
    .maybeSingle()

  // The local cache read is async now (IndexedDB, not localStorage), so wait
  // for it before snapshotting local state — otherwise the fallback used when
  // a table's fetch errors would be the empty pre-load state, and a transient
  // Postgres error would blank that bank instead of keeping what we had.
  await localBanksReady
  markCloudHydrated()
  const localState = useBankStore.getState()
  let anyError = false
  const tablesPromise = Promise.all(
    BANK_KEYS.map(async (key) => {
      const table = BANK_TO_TABLE[key]
      // Paged: the history banks are uncapped by design, so a working member
      // crosses PostgREST's row ceiling and an unpaged read would hand back
      // only the first page — silently dropping the rest of their work here
      // AND from the local cache persistBanksNow writes below.
      const { data, error } = await selectAllRows<{ id: string; data: unknown }>((from, to) =>
        sb.from(table).select('id, data', { count: 'exact' }).eq('user_id', userId).range(from, to),
      )
      // On a fetch error, keep whatever loadFromStorage already gave us for this
      // bank — never replace good local rows with an empty array just because
      // the cloud was momentarily unreachable.
      if (error) anyError = true
      const base = error
        ? (reportError(`hydrate ${table}`, error), (localState[key] as unknown[]) ?? [])
        : (data ?? []).map((row) => row.data as unknown)
      // Overlay the outbox so a row that was created locally but never synced
      // (push failed/timed out) survives the pull instead of vanishing.
      const overlaid = applyOutbox(key, base)
      // Postgres returns these rows in no particular order (no ORDER BY — the
      // query only filters by user_id), but every "newest first" view (e.g.
      // Characters' Single view reading characterHistory[0]) assumes the array
      // already is sorted that way, which local unshift-on-add writes uphold
      // but a cloud pull doesn't. Restore that invariant here so a refresh
      // can't surface a random old row instead of the latest one.
      const sorted = [...overlaid].sort((a, b) =>
        ((b as { createdAt?: number }).createdAt ?? 0) - ((a as { createdAt?: number }).createdAt ?? 0))
      return [key, sorted] as const
    }),
  )

  const [{ data: profile }, tables] = await Promise.all([profilePromise, tablesPromise])

  if (profile) {
    // kieApiKey is browser-local; preserve whatever loadFromStorage already
    // hydrated from localStorage. Cloud hydration only refreshes perAppModel.
    const existingKey = useSettingsStore.getState().kieApiKey
    const nextPerAppModel = (profile.per_app_model as Record<string, string> | null) ?? {}
    useSettingsStore.setState({ perAppModel: nextPerAppModel })
    try {
      localStorage.setItem('ai-ugc-lab-settings', JSON.stringify({
        kieApiKey: existingKey,
        perAppModel: nextPerAppModel,
      }))
    } catch { /* ignore */ }
  }

  const next: Partial<Record<BankKey, unknown[]>> = {}
  for (const [key, items] of tables) next[key] = items

  useBankStore.setState({
    products: (next.products as Product[]) ?? [],
    models: (next.models as Model[]) ?? [],
    scripts: (next.scripts as Script[]) ?? [],
    voices: (next.voices as VoicePreset[]) ?? [],
    brolls: (next.brolls as BRoll[]) ?? [],
    styles: (next.styles as StylePreset[]) ?? [],
    swipes: (next.swipes as SwipeItem[]) ?? [],
    trackedAccounts: (next.trackedAccounts as TrackedAccount[]) ?? [],
    voiceHistory: (next.voiceHistory as VoiceHistoryItem[]) ?? [],
    videoHistory: (next.videoHistory as VideoHistoryItem[]) ?? [],
    imageHistory: (next.imageHistory as ImageHistoryItem[]) ?? [],
    musicHistory: (next.musicHistory as MusicHistoryItem[]) ?? [],
    scriptHistory: (next.scriptHistory as ScriptHistoryItem[]) ?? [],
    brollHistory: (next.brollHistory as BrollHistoryItem[]) ?? [],
    characterHistory: (next.characterHistory as CharacterHistoryItem[]) ?? [],
    adAnatomyHistory: (next.adAnatomyHistory as AdAnatomyHistoryItem[]) ?? [],
    usageDays: (next.usageDays as UsageDay[]) ?? [],
  })

  // Through bankStore's own persist, not a second hand-rolled copy of the
  // payload: that duplicate silently drifted out of the store's field list, and
  // it skipped the quota trim on the one write most likely to hit it.
  persistBanksNow(useBankStore.getState())

  return !anyError
}

// First cloud login on this browser: if the user already has local data and
// the cloud is empty, push everything up before subscribing to changes.
async function shouldUploadLocalSnapshot(userId: string): Promise<boolean> {
  const flag = `ugc-lab:cloud-migrated:${userId}`
  if (localStorage.getItem(flag)) return false

  const sb = getSupabase()
  const checks = await Promise.all(
    BANK_KEYS.map((k) => sb.from(BANK_TO_TABLE[k]).select('id', { count: 'exact', head: true }).eq('user_id', userId)),
  )
  const cloudHasAny = checks.some((r) => (r.count ?? 0) > 0)
  if (cloudHasAny) {
    localStorage.setItem(flag, '1')
    return false
  }

  const localState = useBankStore.getState()
  const localHasAny = BANK_KEYS.some((k) => (localState[k] as unknown[]).length > 0)
  return localHasAny
}

async function uploadEntireSnapshot(userId: string) {
  const state = useBankStore.getState()

  // First, walk all bank items for asset refs and upload any missing blobs to
  // R2. We do this BEFORE writing rows so other devices never see a row that
  // points at a missing asset.
  const allRefs = new Set<string>()
  for (const key of BANK_KEYS) {
    const arr = state[key] as Array<{ id: string }>
    for (const item of arr) for (const r of walkAssetRefs(item)) allRefs.add(r)
  }
  if (allRefs.size > 0) {
    const refList = Array.from(allRefs)
    const remote = await existingRemoteAssetIds(refList)
    for (const ref of refList) {
      if (remote.has(ref)) continue
      const blob = await getBlob(ref).catch(() => null)
      if (!blob) continue
      try { await uploadAssetToR2(ref, blob) } catch (e) {
        console.warn('[cloudSync] initial asset upload failed for', ref, e)
      }
    }
  }

  // Now push all bank rows.
  for (const key of BANK_KEYS) {
    const items = state[key] as Array<{ id: string }>
    if (items.length === 0) continue
    try {
      await saveRows(key, items)
    } catch (e) { reportError(`initial upload of ${BANK_TO_TABLE[key]}`, e) }
  }

  try { await saveProfile() } catch (e) { reportError('initial profile upload', e) }

  localStorage.setItem(`ugc-lab:cloud-migrated:${userId}`, '1')
  // The full snapshot already covered scriptHistory + brollHistory, so the
  // targeted seed below is a no-op for first-time cloud users.
  localStorage.setItem(`ugc-lab:history-cloud-seeded:${userId}`, '1')
}

// One-time rescue for users who migrated to cloud BEFORE scriptHistory and
// brollHistory became cloud banks. Their Postgres tables are empty, so an
// authoritative hydrate would wipe the on-device rows these banks still hold.
// Enqueue those rows into the outbox: applyOutbox overlays them onto the empty
// cloud pull (so they survive hydrate) and the post-hydrate drainOutbox pushes
// them up — the same path that protects any unsynced row. Runs once per user.
function seedLocalHistoryToCloud(userId: string) {
  const flag = `ugc-lab:history-cloud-seeded:${userId}`
  if (localStorage.getItem(flag)) return
  const state = useBankStore.getState()
  let seeded = 0
  for (const key of ['scriptHistory', 'brollHistory'] as const) {
    for (const row of state[key] as Array<{ id: string }>) {
      recordPendingUpsert(key, row)
      seeded++
    }
  }
  if (seeded > 0) console.log(`[cloudSync] seeded ${seeded} local history row(s) for first-time cloud sync`)
  localStorage.setItem(flag, '1')
}

// NOTE — no "legacy prefixed asset" migration is needed, and one must not be
// re-added. The concern would be duplicate `assets` rows keyed by the raw
// "asset://asset-x" ref (vs the bare "asset-x" everything else uses). But such
// rows can never have been written: uploadAssetToR2 presigns the id BEFORE the
// row upsert, and the R2 sign/delete Edge functions reject any id that isn't
// `^[a-zA-Z0-9._-]+$` (no `:` or `/`) — so a prefixed PUT 400s at presign and
// the row is never inserted. A prefixed R2 object can't exist either, for the
// same reason. The real fix for the historical data loss is the ref
// normalisation in walkAssetRefs (below) + the sweep; the sweep is
// normalisation-safe on the row-id side too, so even a prefixed row arriving
// by some unforeseen path is classified correctly rather than purging its
// live bare twin.

// After hydrate: walk any local asset blobs that aren't yet in R2 and upload
// them. Recovers users who had partial-state from prior buggy sessions.
async function reconcileAssets() {
  const state = useBankStore.getState()
  const allRefs = new Set<string>()
  for (const key of BANK_KEYS) {
    const arr = state[key] as Array<{ id: string }>
    for (const item of arr) for (const r of walkAssetRefs(item)) allRefs.add(r)
  }
  if (allRefs.size === 0) return

  const refList = Array.from(allRefs)
  const remoteSet = await existingRemoteAssetIds(refList)

  let recovered = 0
  let lost = 0
  for (const ref of refList) {
    if (remoteSet.has(ref)) continue
    const blob = await getBlob(ref).catch(() => null)
    if (blob) {
      try {
        await uploadAssetToR2(ref, blob)
        recovered++
      } catch (e) {
        console.warn('[cloudSync] reconcile upload failed for', ref, e)
      }
    } else {
      lost++
    }
  }

  if (recovered > 0) {
    console.log(`[cloudSync] recovered ${recovered} asset(s) to R2`)
  }
  if (lost > 0) {
    console.warn(`[cloudSync] ${lost} asset(s) couldn't be recovered (missing locally and in cloud)`)
  }
}

// Once-per-session orphan sweep. Runs after hydrate so the bank state is
// accurate. Logs results to the console; no UI noise — users who care can
// see exact counts via Settings → Storage.
async function sweepOrphansInBackground(): Promise<void> {
  try {
    const { orphans, totalBytes } = await findOrphanAssets()
    if (orphans.length === 0) return
    console.log(`[cloudSync] sweeping ${orphans.length} orphan asset(s) (~${(totalBytes / 1024 / 1024).toFixed(1)} MB)`)
    const result = await purgeOrphans(orphans.map((o) => o.id))
    console.log(`[cloudSync] orphan sweep done: ${result.ok} cleaned, ${result.failed.length} failed`)
  } catch (e) {
    console.warn('[cloudSync] sweepOrphansInBackground threw', e)
  }
}

// Drain the outbox when the tab regains focus — pairs with the visibility
// session-refresh in supabase.ts so a backgrounded tab that missed a sync
// catches up the moment the user comes back. Installed once.
let focusDrainInstalled = false
function installOutboxDrainOnFocus() {
  if (focusDrainInstalled || typeof document === 'undefined') return
  focusDrainInstalled = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      drainOutbox().catch((e) => console.warn('[cloudSync] focus drain failed', e))
    }
  })
}

let started = false

export async function startCloudSync() {
  if (!isCloudEnabled()) {
    console.log('[cloudSync] disabled — Supabase env vars not set')
    return
  }
  if (started) return
  const userId = useAuthStore.getState().user?.id
  if (!userId) return

  started = true
  console.log('[cloudSync] starting for user', userId)

  try {
    if (await shouldUploadLocalSnapshot(userId)) {
      console.log('[cloudSync] uploading local snapshot to cloud (first login)')
      await uploadEntireSnapshot(userId)
    }
    // Rescue scriptHistory/brollHistory rows from users who cloud-migrated
    // before these became cloud banks, so the empty-table hydrate below can't
    // wipe them. No-op once seeded (and after a full snapshot upload).
    seedLocalHistoryToCloud(userId)
    const hydratedClean = await hydrateFromCloud(userId)
    console.log(`[cloudSync] hydrated from cloud${hydratedClean ? '' : ' (with per-table errors)'}`)

    // Seed the Dashboard's usage ledger from the freshly-hydrated history
    // banks — once per user. Only after a CLEAN hydrate: a bank that fell
    // back to partial local state would backfill an undercount and the
    // once-flag would lock it in. (Local-only mode backfills on Dashboard
    // mount instead.)
    if (hydratedClean) {
      try { backfillUsageLedger() } catch (e) { console.warn('[cloudSync] usage backfill failed', e) }
    }

    // Replay any writes that didn't confirm in a previous session (push failed
    // or timed out). Best-effort; don't block startup.
    drainOutbox().catch((e) => console.warn('[cloudSync] outbox drain failed', e))
    installOutboxDrainOnFocus()

    // Stamp last_active_at so the admin members table can show "last seen"
    // instead of just join date. Fire-and-forget — failure isn't worth
    // surfacing to the user.
    getSupabase()
      .from('profiles')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', userId)
      .then(({ error }) => { if (error) console.warn('[cloudSync] last_active_at update failed', error) })

    // Best-effort recovery — don't block startup on this.
    reconcileAssets().catch((e) => console.warn('[cloudSync] reconcile failed', e))

    // Sweep orphan assets in the background. Most users will never click the
    // manual cleanup button; this keeps storage tidy without bothering them.
    // ONLY when hydrate was fully clean — a bank that fell back to local (or
    // empty) state because its cloud fetch errored would make live assets look
    // orphaned, and the sweep deletes from IDB + R2 irreversibly. The opt-in
    // Settings → Storage sweep still lets the user reclaim space deliberately.
    if (hydratedClean) {
      sweepOrphansInBackground().catch((e) => console.warn('[cloudSync] orphan sweep failed', e))
    } else {
      console.warn('[cloudSync] skipping auto orphan sweep — hydrate had per-table errors; unsafe to classify orphans')
    }
  } catch (e) {
    reportError('startup', e)
    started = false
  }
}

export function stopCloudSync() {
  started = false
}
