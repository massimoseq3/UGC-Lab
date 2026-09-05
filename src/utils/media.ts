// Reads an audio/video clip's duration from its metadata without fully
// decoding it. Used to enforce kie.ai's reference-clip length caps client-side
// before burning an upload + a failed task on an over-long file.
//
// Bounded, because every caller AWAITS this behind an upload the member just
// made: a media element that neither loads nor errors — a container the browser
// half-recognises, a stalled decode, a file whose metadata never arrives — would
// otherwise leave the attach spinner up forever with nothing to cancel. Failing
// is recoverable (the caller reports it and the member can pick another file);
// hanging is not.
const METADATA_TIMEOUT_MS = 15_000

export function readMediaDuration(src: string, kind: 'audio' | 'video'): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind)
    let settled = false
    // Drop the source so the browser stops buffering a file nobody is waiting
    // on any more — without this, a rejected read keeps its download alive.
    const cleanup = () => {
      el.removeAttribute('src')
      el.load()
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('Could not read media metadata. The file took too long to load.'))
    }, METADATA_TIMEOUT_MS)
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      const duration = el.duration
      finish(() => {
        cleanup()
        // A live or unseekable stream reports Infinity, and NaN means the
        // metadata parsed to nothing — neither can be range-checked, so say so
        // rather than hand a caller a number it will silently compare against.
        if (!Number.isFinite(duration)) {
          reject(new Error('Could not read media metadata. This file reports no fixed duration.'))
          return
        }
        resolve(duration)
      })
    }
    el.onerror = () => finish(() => {
      cleanup()
      reject(new Error('Could not read media metadata.'))
    })
    el.src = src
  })
}
