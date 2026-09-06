import { useCallback, useEffect, useRef, useState } from 'react'
import { usePersistedState } from '../../hooks/usePersistedState'
import { humanizeError } from '../../utils/friendlyError'
import { analyzeImage } from './services/analyzeImage'
import { flattenDna, profileFromFlat, type CharacterRefItem } from './types'
import { makeThumbnail } from './utils/thumbnail'

export const ACCEPTED_REF_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_REF_SIZE = 10 * 1024 * 1024

// Bulk drops run a few at a time rather than all at once — a dozen parallel
// vision calls on one key gets rate-limited, and the rows land in a readable
// order this way.
const ANALYZE_CONCURRENCY = 3

// The library is a recognition aid, not an archive. Oldest rows drop off the
// end so a heavy user can't walk the localStorage quota into a wall.
const LIBRARY_CAP = 60

// How long the same file is ignored after being accepted. This is a guard
// against one gesture reaching addFiles twice — a nested drop zone whose event
// bubbles to the app-wide one, which is exactly the bug that billed members for
// two vision calls per dropped photo. The zones now stopPropagation, but this
// is the entry every path shares and a vision call costs real credits, so the
// cheap check lives here too. Re-dropping a photo on purpose a second later
// still works.
const DOUBLE_FIRE_WINDOW_MS = 1500
const fileSignature = (f: File) => `${f.name}:${f.size}:${f.lastModified}`

/** Run `fn` over `items` with at most `limit` in flight. */
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

/**
 * The Characters reference library — every photo the member has dropped to
 * autofill the form, with the DNA it produced, kept so a face can be reused
 * without paying for the analysis again.
 *
 * Lives here rather than inside the modal so a bulk analysis keeps running
 * when the panel is closed (the same rule the app's generations follow).
 * `onApply` fires only for a SINGLE dropped file — that's the "drop a photo,
 * the form fills" gesture. A bulk add never overwrites the form on its own;
 * the member picks the face they want from the list.
 */
export function useReferenceLibrary(
  baseKey: string,
  onApply: (item: CharacterRefItem) => void,
) {
  const [items, setItems] = usePersistedState<CharacterRefItem[]>(`${baseKey}:refs`, [])
  const [analyzingIds, setAnalyzingIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  // Source files for the rows added this session, so a failed analysis can be
  // retried without asking for the file again. Not persisted — after a refresh
  // a failed row can only be removed.
  const filesRef = useRef(new Map<string, File>())

  // file signature → when it was last accepted. See DOUBLE_FIRE_WINDOW_MS.
  const recentDropsRef = useRef(new Map<string, number>())

  const onApplyRef = useRef(onApply)
  useEffect(() => { onApplyRef.current = onApply }, [onApply])

  const analyze = useCallback(async (id: string, file: File) => {
    setAnalyzingIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    try {
      const profile = profileFromFlat(flattenDna(await analyzeImage(file)))
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, profile, error: undefined } : it)))
      return profile
    } catch (err) {
      const message = humanizeError(err, 'Failed to extract DNA from image.')
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, error: message } : it)))
      setError(message)
      return null
    } finally {
      setAnalyzingIds((prev) => prev.filter((x) => x !== id))
    }
  }, [setItems])

  const addFiles = useCallback(async (files: File[]) => {
    setError(null)

    const accepted: File[] = []
    for (const file of files) {
      if (!ACCEPTED_REF_TYPES.includes(file.type)) {
        setError(`${file.name}: unsupported format. Use JPG, PNG, or WebP.`)
        continue
      }
      if (file.size > MAX_REF_SIZE) {
        setError(`${file.name}: too large. Maximum size is 10 MB.`)
        continue
      }
      accepted.push(file)
    }
    if (accepted.length === 0) return

    // Drop anything that arrived moments ago — the same gesture reaching this
    // function twice. Stale entries are swept on the way through so the map
    // can't grow across a session.
    const now = Date.now()
    for (const [sig, at] of recentDropsRef.current) {
      if (now - at >= DOUBLE_FIRE_WINDOW_MS) recentDropsRef.current.delete(sig)
    }
    const fresh = accepted.filter((file) => {
      const sig = fileSignature(file)
      if (recentDropsRef.current.has(sig)) return false
      recentDropsRef.current.set(sig, now)
      return true
    })
    if (fresh.length === 0) return

    // A lone photo keeps the original gesture: it fills the form the moment its
    // DNA lands. Several at once do not — see the note on onApply above.
    const autoApply = fresh.length === 1

    const queued = await Promise.all(fresh.map(async (file) => {
      const id = crypto.randomUUID()
      filesRef.current.set(id, file)
      return {
        file,
        row: {
          id,
          name: file.name.replace(/\.[^.]+$/, '') || file.name,
          thumb: await makeThumbnail(file),
          createdAt: Date.now(),
        } satisfies CharacterRefItem,
      }
    }))

    setItems((prev) => [...queued.map((q) => q.row), ...prev].slice(0, LIBRARY_CAP))

    await runPool(queued, ANALYZE_CONCURRENCY, async ({ row, file }) => {
      const profile = await analyze(row.id, file)
      if (profile && autoApply) onApplyRef.current({ ...row, profile })
    })
  }, [analyze, setItems])

  const retry = useCallback((id: string) => {
    const file = filesRef.current.get(id)
    if (!file) return
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, error: undefined } : it)))
    setError(null)
    void analyze(id, file)
  }, [analyze, setItems])

  const canRetry = useCallback((id: string) => filesRef.current.has(id), [])

  const remove = useCallback((id: string) => {
    filesRef.current.delete(id)
    setItems((prev) => prev.filter((it) => it.id !== id))
  }, [setItems])

  return {
    items,
    analyzingIds,
    error,
    clearError: useCallback(() => setError(null), []),
    addFiles: useCallback((files: File[]) => { void addFiles(files) }, [addFiles]),
    retry,
    canRetry,
    remove,
  }
}
