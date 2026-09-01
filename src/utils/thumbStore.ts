// A grid tile draws a THUMBNAIL of a still, never the still itself.
//
// Every history grid in the app is a wall of ~200px tiles, and each one used
// to hand the browser the picture the model returned: 768×1365 for a 1K
// portrait, 1536×2731 at 2K, 2304×4096 at 4K. A decoded picture costs four
// bytes a pixel whatever size it is drawn at — 4 MB, 16 MB and 36 MB
// respectively — and the near-viewport gate (`hooks/useNearViewport.ts`)
// keeps every tile the member has scrolled past, so a session's worth of
// scrolling holds a gigabyte or more of bitmap behind a column of thumbnails.
// The browser's decoded-image cache can't hold that, so it evicts, and every
// scroll back across an evicted tile re-decodes a 4K JPEG (~30 ms on a fast
// machine, worse for a real photograph) before the tile can paint. That is the
// hitch on every row, and the tiles that go blank and pop back in. Safari is
// the worst of the browsers here — it has no scaled decode at all, so a 4K
// still is 36 MB there even inside a 200px tile.
//
// So a tile asks for a copy sized to itself. The thumbnail is made once per
// asset per browser — decoded off the full blob, drawn down onto a canvas and
// encoded as a ~50 KB JPEG — then kept in its own IndexedDB store so a reload
// never pays the full decode again. It is keyed on a WIDTH BUCKET, because the
// column is what a grid tile is sized by: a portrait fills the column, a
// landscape spans two, and the same still in the list view wants three times
// the width. `bucketFor` rounds the tile's device-pixel width up to the next
// bucket, so a thumbnail is never softer than the tile it sits in and a bigger
// screen simply asks for the next size up. A source no wider than the bucket
// is handed back as-is — nothing is ever upscaled, and nothing is copied for
// no gain.
//
// The full picture is still what everything ELSE reads: the preview modal, the
// lightbox, download, save-to-bank and every reference slot go through
// `getUrl` / `getBlob` exactly as before. Only the <img> inside a tile changes.
// assetStore imports this module back for delete/reset. The cycle is safe:
// both sides only call each other's functions at runtime, never at load.
import { assetIdFromRef, getBlob, getUrl } from './assetStore'

const DB_NAME = 'ai-ugc-lab-thumbs'
const DB_VERSION = 1
const STORE_NAME = 'thumbs'

// Device-pixel widths. A 200px column on a 2× display needs 400 → 512; a
// two-column landscape at ~410px needs 820 → 1024; the list view's media
// column at ~620px needs 1240 → 1536. Ascending, and the last one is the cap:
// anything a tile asks for beyond it gets the original.
export const THUMB_BUCKETS = [512, 768, 1024, 1536] as const
export type ThumbBucket = (typeof THUMB_BUCKETS)[number]

// The bucket for a tile of `cssWidth` CSS pixels on this display. A tile that
// hasn't been laid out yet (width 0) gets the middle of the range rather than
// the smallest, so a measurement that never lands can't hand a large tile a
// tiny picture.
export function bucketFor(cssWidth: number, dpr = window.devicePixelRatio || 1): ThumbBucket {
  const needed = Math.ceil(cssWidth * dpr)
  if (needed <= 0) return 1024
  for (const b of THUMB_BUCKETS) if (b >= needed) return b
  return THUMB_BUCKETS[THUMB_BUCKETS.length - 1]
}

interface StoredThumb {
  key: string
  assetId: string
  bucket: number
  // Null means "the original is already no wider than this bucket" — remembered
  // so the next visit doesn't decode the full picture just to find that out.
  blob: Blob | null
  createdAt: number
}

function thumbKey(assetId: string, bucket: number): string {
  return `${assetId}@${bucket}`
}

// ── IndexedDB ────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null

// Same shape as assetStore's open: bounded, and a failed open is never cached,
// so one blocked upgrade can't turn every later read into a full decode for
// the rest of the tab.
const DB_OPEN_TIMEOUT_MS = 10_000

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    const fail = (reason: string, err?: unknown) => {
      if (settled) return
      settled = true
      reject(err instanceof Error ? err : new Error(`thumb IndexedDB ${reason}`))
    }
    const timer = setTimeout(() => fail('open timed out'), DB_OPEN_TIMEOUT_MS)
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => {
        clearTimeout(timer)
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
  dbPromise = attempt
  attempt.catch(() => { if (dbPromise === attempt) dbPromise = null })
  return attempt
}

async function idbGet(key: string): Promise<StoredThumb | undefined> {
  try {
    const db = await openDB()
    return await new Promise<StoredThumb | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(key)
      req.onsuccess = () => resolve(req.result as StoredThumb | undefined)
      req.onerror = () => reject(req.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    return undefined
  }
}

async function idbPut(row: StoredThumb): Promise<void> {
  // Best effort: a thumbnail that doesn't land on disk is simply made again
  // next session. Never let a full quota take the tile down with it.
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(row)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch { /* cache write only */ }
}

async function idbDelete(keys: string[]): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      for (const k of keys) store.delete(k)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch { /* best effort */ }
}

// ── Making one ───────────────────────────────────────────────────────

// A thumbnail is a full decode of the source, and a grid coming into view asks
// for a dozen at once. Two at a time keeps the main thread answering scroll
// while the backlog drains; the near-viewport gate already bounds the backlog
// to what the member actually scrolled to.
const MAX_CONCURRENT_BUILDS = 2
let building = 0
const buildQueue: Array<() => void> = []

function withBuildSlot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      building += 1
      fn().then(resolve, reject).finally(() => {
        building -= 1
        buildQueue.shift()?.()
      })
    }
    if (building < MAX_CONCURRENT_BUILDS) run()
    else buildQueue.push(run)
  })
}

// A JPEG has no alpha, so a PNG / WebP source (the two formats a generated
// picture can carry transparency in) is encoded as WebP where the browser can,
// and the browser's fallback (PNG) where it can't — never as a JPEG that would
// paint a black square behind a cut-out.
function encodingFor(sourceType: string): { type: string; quality: number } {
  if (sourceType === 'image/png' || sourceType === 'image/webp') return { type: 'image/webp', quality: 0.86 }
  return { type: 'image/jpeg', quality: 0.86 }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('thumb encode failed'))), type, quality)
  })
}

// Decodes the full picture, draws it down to `bucket` wide (or hands back null
// when the source is already no wider than that), and encodes the result.
async function buildThumb(source: Blob, bucket: number): Promise<Blob | null> {
  const bitmap = await createImageBitmap(source)
  try {
    if (bitmap.width <= bucket) return null
    const scale = bucket / bitmap.width
    const canvas = document.createElement('canvas')
    canvas.width = bucket
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const { type, quality } = encodingFor(source.type)
    return await canvasToBlob(canvas, type, quality)
  } finally {
    bitmap.close()
  }
}

// ── Read ─────────────────────────────────────────────────────────────

// Object URLs by thumb key. Like assetStore's `urlCache`, this holds the
// in-flight promise so two tiles asking for the same picture in one tick share
// a single build.
const urlCache = new Map<string, Promise<string | null>>()

// The URL a tile at `bucket` device pixels wide should draw for `ref`. Resolves
// to the thumbnail's object URL; to the ORIGINAL's URL when the source is
// already small enough or the thumbnail can't be made on this browser (so a
// tile never goes blank over a cache problem); to null only when the asset
// itself is missing.
export async function getThumbUrl(ref: string, bucket: ThumbBucket): Promise<string | null> {
  const assetId = assetIdFromRef(ref)
  const key = thumbKey(assetId, bucket)
  let cached = urlCache.get(key)
  if (!cached) {
    cached = (async () => {
      const stored = await idbGet(key)
      if (stored) {
        if (stored.blob) return URL.createObjectURL(stored.blob)
        // Remembered as "original is small enough" — draw that instead.
        return getUrl(assetId)
      }
      const source = await getBlob(assetId)
      if (!source) throw new Error('asset-miss')
      let thumb: Blob | null = null
      try {
        thumb = await withBuildSlot(() => buildThumb(source, bucket))
      } catch (err) {
        // createImageBitmap / canvas refused it — draw the original rather than
        // nothing, and don't remember the failure, so a later visit can retry.
        console.warn('[thumbStore] could not build thumbnail; using the original', { assetId, bucket, err })
        return URL.createObjectURL(source)
      }
      void idbPut({ key, assetId, bucket, blob: thumb, createdAt: Date.now() })
      // The original's own URL comes from assetStore's cache so it is shared
      // with the lightbox / download rather than minted a second time.
      if (!thumb) return getUrl(assetId)
      return URL.createObjectURL(thumb)
    })()
    urlCache.set(key, cached)
  }
  try {
    return await cached
  } catch {
    urlCache.delete(key)
    return null
  }
}

// ── Delete / reset ───────────────────────────────────────────────────

// Called by assetStore.deleteAsset: every bucket the asset might have been
// thumbed at, so no orphan survives its source.
export async function deleteThumbs(refOrId: string): Promise<void> {
  const assetId = assetIdFromRef(refOrId)
  const keys = THUMB_BUCKETS.map((b) => thumbKey(assetId, b))
  for (const k of keys) {
    const cached = urlCache.get(k)
    if (cached) {
      urlCache.delete(k)
      cached.then((url) => { if (url) { try { URL.revokeObjectURL(url) } catch { /* ignore */ } } }).catch(() => { /* never resolved */ })
    }
  }
  await idbDelete(keys)
}

// Called by assetStore.resetAssetStore on sign-out: a thumbnail is a picture
// too, and the next member on a shared browser must not inherit it.
export async function resetThumbStore(): Promise<void> {
  for (const p of urlCache.values()) {
    p.then((url) => { if (url) { try { URL.revokeObjectURL(url) } catch { /* ignore */ } } }).catch(() => { /* never resolved */ })
  }
  urlCache.clear()
  if (dbPromise) {
    try { (await dbPromise).close() } catch { /* ignore */ }
    dbPromise = null
  }
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })
  } catch { /* ignore */ }
}
