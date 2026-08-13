// How many outputs one press of Generate produces.
//
// Capped at 4 everywhere: a batch is a set you PICK from, and past four you're
// auditioning rather than choosing — while the bill multiplies by the same
// number. Voiceovers passes a lower `max` for the same reason.
//
// Lives here rather than beside the chip so services and app shells can clamp
// a persisted value without importing a component.
export const MAX_BATCH_COUNT = 4
export const DEFAULT_BATCH_COUNT = 1

// Persisted counts come back from localStorage as `unknown` (and from an older
// build as absent), so every read goes through this rather than trusting the
// blob. Anything unusable lands on 1 — a surprise batch is a surprise bill.
export function clampBatchCount(raw: unknown, max: number = MAX_BATCH_COUNT): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1) return DEFAULT_BATCH_COUNT
  return Math.min(n, max)
}
