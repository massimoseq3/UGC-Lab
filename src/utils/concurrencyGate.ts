// A counting semaphore for work that is fine one at a time and disastrous all
// at once: R2 uploads and downloads (`lib/r2.ts`), and the thumbnail / poster
// generation in `utils/mediaThumbs.ts`, where every tile that scrolls into a
// fresh browser would otherwise open its own decoder in the same tick.
//
// FIFO on purpose — the tiles nearest the window asked first, so they are the
// ones a member is looking at while the rest of the queue drains.

export interface ConcurrencyGate {
  acquire(): Promise<void>
  release(): void
  /** Run `work` inside one slot, releasing it however the work ends. */
  run<T>(work: () => Promise<T>): Promise<T>
}

export function makeConcurrencyGate(max: number): ConcurrencyGate {
  let active = 0
  const queue: Array<() => void> = []
  const gate: ConcurrencyGate = {
    acquire(): Promise<void> {
      if (active < max) {
        active++
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => { queue.push(resolve) })
    },
    release(): void {
      const next = queue.shift()
      // Hand the slot straight over rather than decrementing and re-incrementing
      // — the count is unchanged because it never actually goes idle.
      if (next) next()
      else active--
    },
    async run<T>(work: () => Promise<T>): Promise<T> {
      await gate.acquire()
      try {
        return await work()
      } finally {
        gate.release()
      }
    },
  }
  return gate
}
