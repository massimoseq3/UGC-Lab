import { downloadAssetFromR2, deleteAssetFromR2, uploadAssetToR2 } from '../lib/r2'
import { isCloudEnabled } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'
import { deleteThumb, ensureThumbForSavedAsset, resetThumbs } from './mediaThumbs'

const DB_NAME = 'ai-ugc-lab-assets'
const DB_VERSION = 1
const STORE_NAME = 'assets'

interface StoredAsset {
  id: string
  blob: Blob
  mimeType: string
  createdAt: number
}

function cloudActive(): boolean {
  return isCloudEnabled() && !!useAuthStore.getState().user
}

// Caches the in-flight promise, not just the resolved URL, so two concurrent
// callers for the same not-yet-cached id (e.g. an <img> and a modal preview
// mounting together) share one createObjectURL instead of leaking the loser.
const urlCache = new Map<string, Promise<string>>()
// The same URLs once settled, for a synchronous read. A tile that scrolls back
// to a clip it already resolved used to render a spinner for one frame while
// it re-awaited the cached promise — a flash on every return trip.
const resolvedUrls = new Map<string, string>()
let fallbackStore: Map<string, StoredAsset> | null = null
let dbPromise: Promise<IDBDatabase> | null = null

// indexedDB.open() can do more than succeed or fail: `onblocked` fires — and
// nothing else does — while another tab holds an older version open, and a
// browser busy reclaiming storage can leave the request pending indefinitely.
// Either way the promise never settles, and saveAsset AWAITS this, so a save to
// the bank simply never completes: the member clicks Save, nothing lands, no
// error appears, and only a reload clears it.
const DB_OPEN_TIMEOUT_MS = 10_000

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    const fail = (reason: string, err?: unknown) => {
      if (settled) return
      settled = true
      console.warn(`[assetStore] IndexedDB ${reason} — using in-memory fallback for now`, err)
      if (!fallbackStore) fallbackStore = new Map()
      reject(err instanceof Error ? err : new Error(`IndexedDB ${reason}`))
    }
    const timer = setTimeout(() => fail('open timed out'), DB_OPEN_TIMEOUT_MS)
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => {
        clearTimeout(timer)
        // Lost the race against the timeout — don't leak the connection.
        if (settled) { try { request.result.close() } catch { /* ignore */ } return }
        settled = true
        resolve(request.result)
      }
      request.onerror = () => { clearTimeout(timer); fail('unavailable', request.error) }
      request.onblocked = () => { clearTimeout(timer); fail('blocked by another tab') }
    } catch (e) {
      clearTimeout(timer)
      fail('not available', e)
    }
  })

  // A FAILED open must not be cached. It used to be — `if (dbPromise) return
  // dbPromise` handed the same rejected promise back forever — so one transient
  // failure (an eviction, a blocked upgrade, a stalled open) poisoned every
  // later read and write for the life of the tab. That is precisely why
  // reloading the page "fixed" saving: it was the only way to clear this.
  dbPromise = attempt
  attempt.catch(() => { if (dbPromise === attempt) dbPromise = null })
  return attempt
}

// The in-memory tier is a stopgap for a single failed write, not a mode the
// session is stuck in — so say it once and let IndexedDB be retried after.
let degradedReported = false
function reportDegradedStorage() {
  if (degradedReported) return
  degradedReported = true
  console.warn('[assetStore] a blob was held in memory only — this browser refused to store it')
}

function generateAssetId(): string {
  return `asset-${crypto.randomUUID()}`
}

export function isAssetRef(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return false
  // Two shapes are in use across the app: bare ids ("asset-xxx") from
  // saveAsset / saveFromDataUrl paths, and asset:// URIs from
  // VariationCard's video write path. Both must be recognised or the
  // useAssetUrl hook hands the raw string to <img>/<video>, which then
  // tries to load `asset://…` (an unknown scheme) and fails silently.
  return value.startsWith('asset-') || value.startsWith('asset://')
}

// Normalise either form to the bare IDB key. Safe to call on already-bare
// ids; only strips the asset:// prefix when present.
export function assetIdFromRef(value: string): string {
  return value.startsWith('asset://') ? value.slice('asset://'.length) : value
}

async function idbPut(asset: StoredAsset): Promise<void> {
  // Always ATTEMPT the durable store, even once a memory fallback exists. The
  // old short-circuit meant the first failure made every later blob in the
  // session memory-only — saved to all appearances, gone on the next reload.
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(asset)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      // A quota-exceeded write aborts rather than erroring; without this the
      // promise never settles and the awaiting save hangs.
      tx.onabort = () => reject(tx.error)
    })
    // Landed on disk — drop any stale memory copy so the tiers can't disagree.
    fallbackStore?.delete(asset.id)
  } catch {
    if (!fallbackStore) fallbackStore = new Map()
    fallbackStore.set(asset.id, asset)
    reportDegradedStorage()
  }
}

async function idbDelete(id: string): Promise<void> {
  // Both tiers, unconditionally: now that a blob can exist in either, deleting
  // only the one we happen to look at first would leave the other behind — and
  // for a delete, a survivor is the bug.
  fallbackStore?.delete(id)
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    /* best effort */
  }
}

// ── Save ─────────────────────────────────────────────────────────────

export interface SaveAssetOptions {
  // Skip the R2 mirror entirely. Use for blobs the user explicitly does NOT
  // want stored in the cloud (e.g. Ad Analyzer source uploads — kept locally
  // for playback but never synced).
  skipCloud?: boolean
}

// The canonical save path. Writes to IndexedDB and returns immediately so the
// UI can render the asset without waiting on the network. When cloud is active,
// the R2 mirror runs in the background — failures surface as a toast but do
// not block the caller. This means a misconfigured R2/CORS won't hang the
// generation UI; the asset is always usable on the current device, and cross-
// device sync degrades gracefully.
export async function saveAsset(blob: Blob, mimeType?: string, opts: SaveAssetOptions = {}): Promise<string> {
  if (blob.size === 0) {
    throw new Error('saveAsset: refusing to save a 0-byte blob (would render as black / unplayable).')
  }
  const id = generateAssetId()
  const asset: StoredAsset = {
    id,
    blob,
    mimeType: mimeType ?? blob.type,
    createdAt: Date.now(),
  }

  await idbPut(asset)

  // The grid-sized copy, made now rather than on first view so the tile this
  // lands in has it ready and never decodes the original. See mediaThumbs.
  ensureThumbForSavedAsset(id, blob, asset.mimeType)

  if (!opts.skipCloud && cloudActive()) {
    void uploadAssetToR2(id, blob).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[assetStore] R2 mirror failed', err)
      // Says "will upload" rather than "is saved locally" because that's what
      // happens: cloudSync's reconcileAssets re-uploads any bank-referenced blob
      // R2 doesn't have yet, on the next load. The old wording read as data loss.
      useAppStore.getState().addToast(
        `Cloud sync failed: ${msg}. Saved on this device, and it'll upload on your next reload.`,
        'error',
      )
    })
  }

  return id
}

export async function saveFromDataUrl(dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid data URL')
  const mimeType = match[1]

  const res = await fetch(dataUrl)
  const blob = await res.blob()

  return saveAsset(blob, mimeType)
}

// ── Read ─────────────────────────────────────────────────────────────

export async function getBlob(refOrId: string): Promise<Blob | null> {
  // Callers pass either a bare id or an asset:// URI — IDB only knows the
  // bare key, so normalise up front.
  const assetId = assetIdFromRef(refOrId)
  // Memory tier first (it only ever holds blobs IndexedDB refused), then the
  // durable store. This used to be an either/or on `fallbackStore` being set,
  // which meant one failed write sent every subsequent READ past IndexedDB for
  // the rest of the session — so a member with a perfectly good local cache
  // went to the network for every image, and showed placeholders whenever that
  // network hop failed too.
  let local: Blob | null = fallbackStore?.get(assetId)?.blob ?? null
  if (!local) {
    try {
      const db = await openDB()
      local = await new Promise<Blob | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const request = tx.objectStore(STORE_NAME).get(assetId)
        request.onsuccess = () => {
          const asset = request.result as StoredAsset | undefined
          resolve(asset?.blob ?? null)
        }
        request.onerror = () => reject(request.error)
        tx.onabort = () => reject(tx.error)
      })
    } catch {
      local = null
    }
  }
  if (local) return local

  // Cloud miss → R2 fallback (cross-device).
  if (cloudActive()) {
    try {
      const remote = await downloadAssetFromR2(assetId)
      if (remote) {
        const asset: StoredAsset = { id: assetId, blob: remote, mimeType: remote.type, createdAt: Date.now() }
        await idbPut(asset).catch(() => { /* cache miss only, not fatal */ })
        return remote
      }
    } catch (e) {
      console.warn('[assetStore] R2 download failed', e)
    }
  }
  return null
}

export async function getUrl(refOrId: string): Promise<string | null> {
  const assetId = assetIdFromRef(refOrId)
  let cached = urlCache.get(assetId)
  if (!cached) {
    cached = (async () => {
      const blob = await getBlob(assetId)
      if (!blob) throw new Error('asset-miss')
      return URL.createObjectURL(blob)
    })()
    urlCache.set(assetId, cached)
  }
  try {
    const url = await cached
    resolvedUrls.set(assetId, url)
    return url
  } catch {
    // Blob missing (or resolution failed) — drop the cached rejection so a
    // later call can retry once the asset lands.
    urlCache.delete(assetId)
    return null
  }
}

/** The object URL for an asset this tab has already resolved, or undefined. */
export function peekUrl(refOrId: string): string | undefined {
  return resolvedUrls.get(assetIdFromRef(refOrId))
}

export async function getAsBase64(assetId: string): Promise<{ base64: string; mimeType: string } | null> {
  const blob = await getBlob(assetId)
  if (!blob) return null

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      resolve({ base64, mimeType: blob.type })
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// ── Reset (sign-out) ─────────────────────────────────────────────────

// Wipe every locally-cached blob + revoke every pending object URL. Called on
// sign-out so the next user signing in on the same browser can't read the
// previous user's assets via `getBlob(knownId)`. Cloud-mirrored blobs are
// safe — `getBlob` falls back to R2 (scoped per user) when IndexedDB misses.
export async function resetAssetStore(): Promise<void> {
  for (const p of urlCache.values()) {
    p.then((url) => { try { URL.revokeObjectURL(url) } catch { /* ignore */ } }).catch(() => { /* never resolved */ })
  }
  urlCache.clear()
  resolvedUrls.clear()
  fallbackStore = null
  await resetThumbs()

  // Drop the open connection so deleteDatabase doesn't have to wait on it.
  if (dbPromise) {
    try {
      const db = await dbPromise
      db.close()
    } catch { /* ignore */ }
    dbPromise = null
  }

  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve() // best-effort
      req.onblocked = () => resolve()
    })
  } catch { /* ignore */ }
}

// ── Delete ───────────────────────────────────────────────────────────

// Awaited delete across all three stores: IndexedDB + R2 `assets` row.
// The R2 object itself is left as a cheap leak; a sweeper job can clean it up.
export async function deleteAsset(refOrId: string): Promise<void> {
  const assetId = assetIdFromRef(refOrId)
  const cached = urlCache.get(assetId)
  if (cached) {
    urlCache.delete(assetId)
    resolvedUrls.delete(assetId)
    cached.then((url) => { try { URL.revokeObjectURL(url) } catch { /* ignore */ } }).catch(() => { /* never resolved */ })
  }
  deleteThumb(assetId)

  await idbDelete(assetId)

  if (cloudActive()) {
    try {
      await deleteAssetFromR2(assetId)
    } catch (e) {
      console.warn('[assetStore] R2 metadata delete failed', e)
    }
  }
}
