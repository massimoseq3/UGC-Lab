import { ensureFreshSession } from '../../lib/supabase'

// One timeout budget for every admin read/write. Long enough for a cold
// Postgres view, short enough that a stalled request reports rather than sits.
export const QUERY_TIMEOUT_MS = 15_000

// Awaited ONCE at the top of every admin operation, before any supabase-js call.
//
// This is the fix for "the Admin tab spins until I reload the page". supabase-js
// asks for the access token via its auth lock on every request; after a
// long-idle or backgrounded tab that lock is held by the SDK's own
// _recoverAndRefresh, so the first queries fired on entering Admin queued behind
// it and only unblocked when a full page reload rebuilt the client. Every other
// cloud path in the app already awaits this helper (see lib/supabase.ts) —
// Admin was the one that didn't.
//
// Never throws: a failure here is not the caller's problem, the query that
// follows will surface the real error.
export async function readyAdminSession(): Promise<void> {
  try {
    await ensureFreshSession()
  } catch (e) {
    console.warn('[admin] session refresh failed — querying anyway', e)
  }
}

// Runs a supabase query on a deadline AND cancels it when the deadline passes.
//
// The `run(signal)` shape exists so the signal reaches `.abortSignal(signal)` on
// the query builder: without it a timed-out request keeps streaming in the
// background and can still resolve later, landing stale rows on top of a
// fresher retry.
export function withTimeout<T>(
  run: (signal: AbortSignal) => PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`))
    }, ms)
    Promise.resolve(run(controller.signal)).then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

// The message out of a settled query, whether it rejected or came back with a
// PostgREST `error` field.
export function reasonOf(
  result: PromiseSettledResult<{ error?: { message: string } | null }>,
): string {
  if (result.status === 'rejected') {
    return result.reason instanceof Error ? result.reason.message : String(result.reason)
  }
  return result.value.error?.message ?? 'unknown error'
}
