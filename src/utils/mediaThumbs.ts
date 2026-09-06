// Grid-sized copies of generated media: a downscaled STILL for every image
// asset, and a POSTER frame for every clip.
//
// Every history grid used to hand the browser the original file for every tile
// — a 4K still (a 2304x4096 PNG is a ~38 MB bitmap once decoded) drawn into a
// 150px cell. Two things follow from that, and both were reported as the grids
// being "choppy". The browser purges decoded bitmaps it can't see, so scrolling
// back up meant re-decoding every one of those originals, and with
// `decoding="async"` the tile paints its black background until the decode
// lands — which is the "cards go black then appear" on the way back up. And a
// freshly landed generation decoded its original the moment its row appeared,
// on the same main thread the remaining in-flight tiles were animating on.
//
// A thumbnail is the ordinary answer. It is made ONCE per asset per browser
// (at save time for a generation that lands here, or on first view for one
// pulled down from R2), kept in its own IndexedDB so a reload doesn't pay
// again, and it is what a grid tile renders. A 1024px-edge JPEG decodes in a
// few milliseconds and is small enough that the browser keeps it; the original
// is still what every download, lightbox and generation input reads, through
// `getUrl` as before. Only the picture on the tile changed.
//
// Clips get the same treatment as a POSTER: the first frame, made off a hidden
// element at save time, or — for a clip this browser has never had a poster for
// (generated before posters existed, or pulled down from R2 on a second device)
// — the first time a tile asks for it, through `posterGate`. It used to wait
// for the tile's own <video> to decode a frame and grab that, which sounds free
// and wasn't: the grid mounted a <video> for every tile near the window, Safari
// runs a handful of decoders and parks the rest, and a parked element never
// fires `loadeddata` — so the tiles it parked stayed black, with no poster to
// fall back to, and the ones it did decode arrived one at a time (September
// 2026, Massimo's recording). The queue is what makes a first look at a fresh
// browser fill in order at a steady pace instead: two hidden decoders at a
// time, oldest ask first, each result kept on disk so it is paid for once.
//
// The other half of that fix is on the tile: a grid <video> is
// `preload="none"` and wears its poster, so a wall of clips holds NO decoder
// until one is hovered or played. `capturePoster` off the tile's own element
// still exists and is still wired, as a bonus for a clip that gets played
// before its queued poster lands. A video tile RELEASES its clip when it
// scrolls well clear of the window and shows the poster instead; the <video>
// that comes back wears the same poster until its first frame decodes, so a
// clip leaving and returning is never seen as anything but its picture.
//
// Its own database rather than a second store in the assets one: bumping that
// DB's version blocks while another tab holds the old one open, and a blocked
// upgrade there would take every asset read down with it for a thumbnail.
// A missing thumbnail costs nothing but a regeneration.
import { assetIdFromRef, getBlob, isAssetRef } from './assetStore'
import { makeConcurrencyGate } from './concurrencyGate'

// Long edge of a still thumbnail and of a poster frame. A grid tile is ~150–300
// CSS px wide and a list row's media column ~500 on a half pane, both on 2x
// screens, so 1024 covers every grid surface at native density; the lightbox
// and the preview modal read the original.
export const THUMB_EDGE = 1024
const THUMB_QUALITY = 0.85

const DB_NAME = 'ai-ugc-lab-thumbs'
const DB_VERSION = 1
const STORE_NAME = 'thumbs'
const DB_OPEN_TIMEOUT_MS = 10_000
const POSTER_LOAD_TIMEOUT_MS = 15_000
const POSTER_SEEK_TIMEOUT_MS = 3_000
// The frame a poster is taken from. Not 0: several encoders (and Safari on
// most of them) hand back a black or half-decoded first frame at t=0, which
// is exactly the picture that would then sit on the tile for good.
const POSTER_AT_SECONDS = 0.1

// How many thumbnails / posters are MADE at once. Generation is the expensive
// half — a full-size decode for a still, a whole hidden <video> for a clip —
// and a fresh browser scrolling a gallery asks for a window's worth in one
// tick. Two hidden decoders is what Safari keeps running without parking one;
// three still decodes are enough to stay ahead of a scroll without stalling
// the main thread, where WebKit does its `createImageBitmap` work. Reads of a
// thumbnail that already exists are NOT gated — those are an IndexedDB get.
const posterGate = makeConcurrencyGate(2)
const stillGate = makeConcurrencyGate(3)

interface StoredThumb {
  id: string
  blob: Blob
  createdAt: number
}

// ── IndexedDB ───────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null

// Same shape as assetStore's: a deadline, an `onblocked`, and a failed open is
// never cached, so one bad open doesn't cost the whole session its thumbnails.
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    const fail = (reason: string, err?: unknown) => {
      if (settled) return
      settled = true
      reject(err instanceof Error ? err : new Error(`thumbs IndexedDB ${reason}`))
    }
    const timer = setTimeout(() => fail('open timed out'), DB_OPEN_TIMEOUT_MS)
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' })
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

async function idbGet(id: string): Promise<Blob | null> {
  try {
    const db = await openDB()
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(id)
      req.onsuccess = () => resolve((req.result as StoredThumb | undefined)?.blob ?? null)
      req.onerror = () => reject(req.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    return null
  }
}

async function idbPut(id: string, blob: Blob): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put({ id, blob, createdAt: Date.now() } satisfies StoredThumb)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    // A thumbnail that didn't land on disk is regenerated next session. Not
    // worth a warning: the member's asset is untouched.
  }
}

async function idbDelete(id: string): Promise<void> {
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

// ── Memory tier ─────────────────────────────────────────────────────────

// Resolved object URLs, kept for the life of the tab like assetStore's.
const thumbUrls = new Map<string, string>()
// One lookup / generation in flight per id, shared by every tile asking.
const pending = new Map<string, Promise<string | null>>()
// Looked up and found nothing this session: a still too small to be worth a
// thumbnail (the tile uses the original), or a clip whose poster hasn't been
// captured yet. Cleared the moment a capture lands.
const missing = new Set<string>()

/** A thumbnail or poster already resolved in this tab, synchronously. */
export function peekThumbUrl(ref: string): string | undefined {
  return thumbUrls.get(assetIdFromRef(ref))
}

/** True once this tab has established there is no thumbnail to show. */
export function isThumbMissing(ref: string): boolean {
  return missing.has(assetIdFromRef(ref))
}

function remember(id: string, blob: Blob): string {
  // Two roads can arrive with a poster for one id — the queued generation and
  // a `capturePoster` off a tile that got played first. Whoever is second
  // keeps the URL already on the tile rather than swapping it for a twin.
  const known = thumbUrls.get(id)
  if (known) return known
  const url = URL.createObjectURL(blob)
  thumbUrls.set(id, url)
  missing.delete(id)
  return url
}

function share(id: string, work: () => Promise<string | null>): Promise<string | null> {
  const inFlight = pending.get(id)
  if (inFlight) return inFlight
  const p = work().catch(() => null).finally(() => { if (pending.get(id) === p) pending.delete(id) })
  pending.set(id, p)
  return p
}

// ── Encoding ────────────────────────────────────────────────────────────

async function encodeFrame(source: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  if (w < 1 || h < 1) return null
  // JPEG: no alpha, but a generated still or a video frame has none either, and
  // a JPEG is a fifth the bytes of the same picture as PNG — bytes that are read
  // back off disk on every fresh mount of a gallery.
  //
  // A VIDEO frame always goes through a DOM canvas. WebKit's OffscreenCanvas
  // does not take an HTMLVideoElement as a source (it throws, or draws
  // nothing, depending on the version) — and since every failure here is
  // swallowed into "no poster", Safari quietly never had a poster for any clip.
  // An ImageBitmap is fine either way, and OffscreenCanvas keeps that encode
  // off the main thread where the browser can.
  if (typeof OffscreenCanvas !== 'undefined' && !(source instanceof HTMLVideoElement)) {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(source, 0, 0, w, h)
    return canvas.convertToBlob({ type: 'image/jpeg', quality: THUMB_QUALITY })
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, w, h)
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', THUMB_QUALITY))
}

function fitEdge(w: number, h: number): { w: number; h: number } | null {
  const longest = Math.max(w, h)
  if (!longest) return null
  const scale = Math.min(1, THUMB_EDGE / longest)
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

// The still, downscaled. `null` when the original is already no bigger than a
// thumbnail — then the tile shows the original and nothing is stored twice.
async function downscaleStill(blob: Blob): Promise<Blob | null> {
  let bitmap: ImageBitmap
  try {
    // Decodes off the main thread where the browser can (Chromium does), which
    // is the point: the one full-size decode this asset ever needs on this
    // machine happens here, not on the tile.
    bitmap = await createImageBitmap(blob)
  } catch {
    return null
  }
  try {
    if (Math.max(bitmap.width, bitmap.height) <= THUMB_EDGE) return null
    const size = fitEdge(bitmap.width, bitmap.height)
    if (!size) return null
    return await encodeFrame(bitmap, size.w, size.h)
  } finally {
    bitmap.close()
  }
}

function frameFromVideo(video: HTMLVideoElement): Promise<Blob | null> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve(null)
  const size = fitEdge(video.videoWidth, video.videoHeight)
  if (!size) return Promise.resolve(null)
  return encodeFrame(video, size.w, size.h)
}

// A poster off a clip that isn't on screen: a hidden element, a frame just
// past the start, then torn down. Used at save time, and by `getPosterUrl` for
// a clip that has no poster on this browser yet. Always called inside
// `posterGate` — this is a whole decoder for the few hundred milliseconds it
// runs, and a window's worth of them at once is the stall the gate exists for.
async function posterFromBlob(blob: Blob): Promise<Blob | null> {
  const objectUrl = URL.createObjectURL(blob)
  const v = document.createElement('video')
  try {
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('poster load timed out')), POSTER_LOAD_TIMEOUT_MS)
      v.onloadeddata = () => { clearTimeout(timer); resolve() }
      v.onerror = () => { clearTimeout(timer); reject(new Error('poster load failed')) }
      v.src = objectUrl
    })
    // Nudge off t=0 (see POSTER_AT_SECONDS). A seek that doesn't land in time
    // falls back to whatever frame the element has — a poster a little early
    // beats no poster.
    const target = Math.min(POSTER_AT_SECONDS, Number.isFinite(v.duration) ? v.duration / 2 : POSTER_AT_SECONDS)
    if (target > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, POSTER_SEEK_TIMEOUT_MS)
        v.onseeked = () => { clearTimeout(timer); resolve() }
        try { v.currentTime = target } catch { clearTimeout(timer); resolve() }
      })
    }
    return await frameFromVideo(v)
  } catch {
    return null
  } finally {
    v.removeAttribute('src')
    v.load()
    URL.revokeObjectURL(objectUrl)
  }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * The grid-sized copy of a still: stored → generated from the original →
 * `null` when the original is small enough to be its own thumbnail (the caller
 * falls back to `getUrl`). Shared across concurrent callers.
 */
export function getStillThumbUrl(ref: string): Promise<string | null> {
  if (!isAssetRef(ref)) return Promise.resolve(null)
  const id = assetIdFromRef(ref)
  const known = thumbUrls.get(id)
  if (known) return Promise.resolve(known)
  if (missing.has(id)) return Promise.resolve(null)
  return share(id, async () => {
    let blob = await idbGet(id)
    if (!blob) {
      const original = await getBlob(id)
      if (!original) return null
      blob = await stillGate.run(() => downscaleStill(original))
      if (!blob) { missing.add(id); return null }
      await idbPut(id, blob)
    }
    return remember(id, blob)
  })
}

/**
 * A clip's poster frame: stored → made off the clip through `posterGate` →
 * `null` only when the clip itself can't be decoded here (then `missing` stops
 * every tile re-asking, and a later `capturePoster` off a played clip can still
 * fill it). Shared across concurrent callers, so a mosaic asking for the same
 * clip three times costs one decoder.
 */
export function getPosterUrl(ref: string): Promise<string | null> {
  if (!isAssetRef(ref)) return Promise.resolve(null)
  const id = assetIdFromRef(ref)
  const known = thumbUrls.get(id)
  if (known) return Promise.resolve(known)
  if (missing.has(id)) return Promise.resolve(null)
  return share(id, async () => {
    let blob = await idbGet(id)
    if (!blob) {
      const clip = await getBlob(id)
      if (!clip) return null
      blob = await posterGate.run(() => posterFromBlob(clip))
      if (!blob) { missing.add(id); return null }
      await idbPut(id, blob)
    }
    return remember(id, blob)
  })
}

/**
 * Grab the current frame off a mounted <video> as the clip's poster. Cheap
 * (one draw of a frame the element has already decoded) and idempotent, so a
 * tile can call it from every `loadeddata` without checking anything first.
 */
export async function capturePoster(ref: string, video: HTMLVideoElement): Promise<string | null> {
  if (!isAssetRef(ref)) return null
  const id = assetIdFromRef(ref)
  const known = thumbUrls.get(id)
  if (known) return known
  // This element already holds a decoded frame, which is the whole cost of a
  // poster — so it is taken now, even if a queued generation for the same clip
  // is still waiting its turn. `remember` keeps whichever lands first.
  const blob = await frameFromVideo(video)
  if (!blob) {
    const inFlight = pending.get(id)
    return inFlight ? inFlight : null
  }
  const url = remember(id, blob)
  await idbPut(id, blob)
  return url
}

/**
 * Save-time hook: make the thumbnail (still) or poster (clip) for a blob that
 * has just been saved under `id`, so the tile it lands in finds one ready.
 * Fire-and-forget by design — the asset is saved either way.
 */
export function ensureThumbForSavedAsset(id: string, blob: Blob, mimeType: string): void {
  const kind = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : null
  if (!kind || thumbUrls.has(id) || pending.has(id)) return
  void share(id, async () => {
    const thumb = kind === 'image'
      ? await stillGate.run(() => downscaleStill(blob))
      : await posterGate.run(() => posterFromBlob(blob))
    // A still that failed here is one too small to need a thumbnail (the
    // tile uses the original). A clip that failed is NOT marked: save-time is
    // the busiest moment in the tab, so `getPosterUrl` gets one more try
    // when a tile first asks.
    if (!thumb) { if (kind === 'image') missing.add(id); return null }
    await idbPut(id, thumb)
    return remember(id, thumb)
  })
}

/** Drop the thumbnail with its asset. */
export function deleteThumb(ref: string): void {
  const id = assetIdFromRef(ref)
  const url = thumbUrls.get(id)
  if (url) { thumbUrls.delete(id); try { URL.revokeObjectURL(url) } catch { /* ignore */ } }
  missing.delete(id)
  void idbDelete(id)
}

/** Sign-out: nothing of one member's media may be readable by the next. */
export async function resetThumbs(): Promise<void> {
  for (const url of thumbUrls.values()) { try { URL.revokeObjectURL(url) } catch { /* ignore */ } }
  thumbUrls.clear()
  missing.clear()
  pending.clear()
  if (dbPromise) {
    try { (await dbPromise).close() } catch { /* ignore */ }
    dbPromise = null
  }
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}
