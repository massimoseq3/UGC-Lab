import { downloadAssetFromR2, deleteAssetFromR2, uploadAssetToR2 } from '../lib/r2'
import { isCloudEnabled } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useAppStore } from '../stores/appStore'

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
let fallbackStore: Map<string, StoredAsset> | null = null
let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        console.warn('IndexedDB unavailable, using in-memory fallback')
        fallbackStore = new Map()
        reject(request.error)
      }
    } catch {
      console.warn('IndexedDB unavailable, using in-memory fallback')
      fallbackStore = new Map()
      reject(new Error('IndexedDB not available'))
    }
  })
  return dbPromise
}

function generateAssetId(): string {
  return `asset-${crypto.randomUUID()}`
}

export function isAssetRef(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return false
  // Two shapes are in use across the app: bare ids ("asset-xxx") from
  // saveBase64Asset / saveFromDataUrl paths, and asset:// URIs from
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
  if (fallbackStore) { fallbackStore.set(asset.id, asset); return }
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(asset)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    if (!fallbackStore) fallbackStore = new Map()
    fallbackStore.set(asset.id, asset)
  }
}

async function idbDelete(id: string): Promise<void> {
  if (fallbackStore) { fallbackStore.delete(id); return }
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
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

  if (!opts.skipCloud && cloudActive()) {
    void uploadAssetToR2(id, blob).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[assetStore] R2 mirror failed', err)
      // Says "will upload" rather than "is saved locally" because that's what
      // happens: cloudSync's reconcileAssets re-uploads any bank-referenced blob
      // R2 doesn't have yet, on the next load. The old wording read as data loss.
      useAppStore.getState().addToast(
        `Cloud sync failed: ${msg}. Saved on this device — it'll upload on your next reload.`,
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

export async function saveBase64Asset(base64: string, mimeType: string): Promise<string> {
  const res = await fetch(`data:${mimeType};base64,${base64}`)
  const blob = await res.blob()
  return saveAsset(blob, mimeType)
}

// ── Read ─────────────────────────────────────────────────────────────

export async function getBlob(refOrId: string): Promise<Blob | null> {
  // Callers pass either a bare id or an asset:// URI — IDB only knows the
  // bare key, so normalise up front.
  const assetId = assetIdFromRef(refOrId)
  let local: Blob | null = null
  if (fallbackStore) {
    local = fallbackStore.get(assetId)?.blob ?? null
  } else {
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
    return await cached
  } catch {
    // Blob missing (or resolution failed) — drop the cached rejection so a
    // later call can retry once the asset lands.
    urlCache.delete(assetId)
    return null
  }
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
  fallbackStore = null

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
    cached.then((url) => { try { URL.revokeObjectURL(url) } catch { /* ignore */ } }).catch(() => { /* never resolved */ })
  }

  await idbDelete(assetId)

  if (cloudActive()) {
    try {
      await deleteAssetFromR2(assetId)
    } catch (e) {
      console.warn('[assetStore] R2 metadata delete failed', e)
    }
  }
}
