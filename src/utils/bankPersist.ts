// The LOCAL copy of the banks — a boot cache, not the source of truth.
//
// This lived in one localStorage key and outgrew it. Not by row count: a single
// BrollHistoryItem carries whole session snapshots (`result`, `cardStates`, and
// the Continuous + retired One-Shot ones) and measures ~43 KB, so a capped-at-50
// bank is ~2 MB on its own. Add the rest of a working member's banks and the
// blob passes what Safari will take in one setItem, which threw
// QuotaExceededError on a browser holding a grand total of 0.44 MB — nowhere
// near full, just past the per-value ceiling. A row-count trim couldn't help
// (the fat bank never HAS many rows), and shedding rows was the wrong answer
// anyway: the cloud holds every one of them, so the local copy going hungry is
// a speed problem, never a data problem.
//
// IndexedDB has no comparable ceiling and the app already trusts it with the
// media blobs themselves. One record, one key.
import type { BankData } from '../stores/bankStore'

const DB_NAME = 'ai-ugc-lab-banks-db'
const DB_VERSION = 1
const STORE_NAME = 'banks'
const RECORD_KEY = 'current'

// The pre-IndexedDB home. Still read once, to carry an existing member across
// without a visible reset, then removed so it can't go stale behind us.
export const LEGACY_STORAGE_KEY = 'ai-ugc-lab-banks'

const DB_OPEN_TIMEOUT_MS = 10_000

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false
    const fail = (reason: string, err?: unknown) => {
      if (settled) return
      settled = true
      reject(err instanceof Error ? err : new Error(`banks IndexedDB ${reason}`))
    }
    // `indexedDB.open` fires neither onsuccess nor onerror while another tab
    // holds an older version, so an unbounded open would hang every save.
    const timer = setTimeout(() => fail('open timed out'), DB_OPEN_TIMEOUT_MS)
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
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

  // Never cache a rejected open — one transient failure would otherwise poison
  // every later read and write for the life of the tab.
  dbPromise = attempt
  attempt.catch(() => { if (dbPromise === attempt) dbPromise = null })
  return attempt
}

/** Read the cached banks. `null` when there is nothing stored (or it's unreadable). */
export async function readBanks(): Promise<unknown | null> {
  try {
    const db = await openDB()
    return await new Promise<unknown | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(RECORD_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    return null
  }
}

// The data fields, and ONLY these. Callers hand us the whole Zustand state,
// which carries every action alongside the banks — JSON.stringify used to drop
// those functions silently, but structured clone throws DataCloneError on them
// and takes the write down with it. Picking explicitly also stops any stray
// non-serialisable field ever reaching the store.
const BANK_DATA_KEYS = [
  'products', 'models', 'scripts', 'voices', 'brolls', 'styles', 'swipes',
  'voiceHistory', 'videoHistory', 'imageHistory', 'musicHistory', 'scriptHistory',
  'brollHistory', 'characterHistory', 'adAnatomyHistory', 'usageDays',
] as const satisfies readonly (keyof BankData)[]

/**
 * Structured-clone the banks in rather than a JSON string: it skips a
 * serialise/parse of the whole blob on every save, and IndexedDB stores the
 * object graph directly.
 */
export async function writeBanks(state: BankData): Promise<void> {
  const data: Record<string, unknown> = {}
  for (const key of BANK_DATA_KEYS) data[key] = state[key]

  const db = await openDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(data, RECORD_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    // A quota-exceeded write aborts rather than erroring; without this the
    // promise never settles and the caller waits forever.
    tx.onabort = () => reject(tx.error)
  })
}

export async function clearBanks(): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(RECORD_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch { /* best effort — the cloud is the source of truth */ }
}

/**
 * The synchronous first paint. Reads the legacy localStorage copy so an
 * existing member's Bank is populated on the very first frame, before the
 * IndexedDB read (and then the cloud) land. Returns null once that key is gone,
 * which is the steady state for everyone after one load.
 */
export function readLegacySync(): unknown | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function dropLegacy(): void {
  try { localStorage.removeItem(LEGACY_STORAGE_KEY) } catch { /* ignore */ }
}
