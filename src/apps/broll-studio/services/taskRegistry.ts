// Module-level registry of kie task ids that have a live polling promise
// somewhere in the B-Roll studio. The mode views unmount on a History-tab or
// mode switch, but their generation promises keep running (the state setters
// live in BrollStudio and stay valid) — so a fresh mount's resume walker must
// not start a second poll for a task the original promise still owns: both
// would complete and append the output twice, double-writing history and the
// usage ledger. A per-mount ref can't see across mounts; this set can.

const polling = new Set<string>()

/** Claim a task for polling. Returns false if a live promise already owns it. */
export function claimTask(kind: 'image' | 'video', taskId: string): boolean {
  const key = `${kind}:${taskId}`
  if (polling.has(key)) return false
  polling.add(key)
  return true
}

/**
 * Release a claim once the poll settles — success, failure, or poll timeout.
 * After a poll timeout the owning promise is dead, so releasing lets the next
 * mount's resume walker pick the task back up.
 */
export function releaseTask(kind: 'image' | 'video', taskId: string): void {
  polling.delete(`${kind}:${taskId}`)
}
