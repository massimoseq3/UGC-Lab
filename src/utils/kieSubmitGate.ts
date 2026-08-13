// Global submit gate for kie.ai generation requests.
//
// kie rate-limits an ACCOUNT to ~20 new generation requests per 10 seconds, and
// a rejected request is NOT queued server-side — it comes back 429 and that
// generation simply never happens. Every batch surface in this app fires its
// whole run at once: B-Roll's "Generate all images / videos" over a dozen-plus
// cards, Continuous' clip run, a Playground or Voiceovers batch. A big
// storyboard therefore walked straight past the ceiling and a chunk of the
// tiles came back as errors while the member watched.
//
// So the POSTs drip through here instead of racing. Every generation surface
// pushes its in-flight tile BEFORE the network call, so a queued run still
// looks like it started the instant the button is pressed — only the request
// waits, and it waits for a couple of seconds against a generation that runs
// for minutes.
//
// Three things are deliberately NOT gated:
//   - Polling (`recordInfo` and friends). It isn't a new generation request,
//     and holding a poll behind a batch's submit queue would stall results the
//     member has already been billed for.
//   - Reference-image uploads. They hit a different host (kie's file service),
//     they aren't generation requests, and the browser's own per-host
//     connection cap already keeps them from stampeding.
//   - Chat completions. Every one of them is a click someone is waiting on
//     with a spinner — Enhance, Regenerate prompt, a storyboard — and the one
//     chat call that fans out (a Scripts batch, at most 10 variations) sits
//     inside the limit on its own. Putting them in this queue would park an
//     Enhance click behind a twenty-clip batch for fifteen seconds, which
//     trades a background failure for a foreground stall.

// One submit every 750ms is at most 14 in any rolling 10s window — a ~30%
// margin under kie's limit, which is what leaves room for the poll traffic of
// an already-running batch and for a second tab on the same key. A batch of 20
// clips is fully submitted inside 15s, which nobody sees: the tiles have been
// showing "generating" since the press.
const MIN_SUBMIT_GAP_MS = 750

// Belt-and-braces ceiling on requests actually on the wire. The gap above is
// what does the real work — this only matters if kie starts answering slowly,
// where it stops a long batch from parking dozens of open sockets.
const MAX_IN_FLIGHT = 6

// When a 429 lands anyway, the whole queue stands down rather than marching the
// next request into the same wall. Used when kie sends no Retry-After.
const RATE_LIMIT_COOLOFF_MS = 5_000
// Cap on any cool-off, Retry-After included, so a bad header can't park a
// member's batch for minutes with no way out.
const MAX_COOLOFF_MS = 30_000

let inFlight = 0
// Earliest wall-clock time the next request may leave.
let nextSlotAt = 0
const waiting: Array<() => void> = []
let timer: ReturnType<typeof setTimeout> | null = null

function pump(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (waiting.length === 0) return
  // At the in-flight ceiling — the release below re-pumps, so no timer needed.
  if (inFlight >= MAX_IN_FLIGHT) return

  const now = Date.now()
  if (now < nextSlotAt) {
    timer = setTimeout(pump, nextSlotAt - now)
    return
  }

  nextSlotAt = now + MIN_SUBMIT_GAP_MS
  inFlight++
  waiting.shift()!()
  // Exactly one grant per pump: nextSlotAt is now in the future, so the call
  // above schedules the next one on its own.
  pump()
}

function release(): void {
  inFlight--
  pump()
}

function acquire(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))

  return new Promise<void>((resolve, reject) => {
    const grant = () => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    const onAbort = () => {
      const i = waiting.indexOf(grant)
      // Already granted — the request owns the slot now and its own signal
      // handling aborts it, so leave the accounting alone.
      if (i === -1) return
      waiting.splice(i, 1)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    waiting.push(grant)
    pump()
  })
}

// Run one kie generation-creating request under the gate. Cancelling while
// still queued drops the request without ever reaching kie.
export async function submitToKie<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await acquire(signal)
  try {
    return await fn()
  } finally {
    release()
  }
}

// A 429 came back somewhere. Push the whole queue's next slot out, so the rest
// of a batch backs off together instead of each request discovering the limit
// for itself. `retryAfterMs` is kie's own Retry-After when it sent one.
export function noteRateLimited(retryAfterMs?: number): void {
  const wait = Math.min(
    retryAfterMs && retryAfterMs > 0 ? retryAfterMs : RATE_LIMIT_COOLOFF_MS,
    MAX_COOLOFF_MS,
  )
  nextSlotAt = Math.max(nextSlotAt, Date.now() + wait)
  pump()
}
