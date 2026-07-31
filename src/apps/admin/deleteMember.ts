// Hard-deleting a member — the two-step sequence behind Admin → Members →
// Delete. Disabling locks an account; this removes it.
//
//   1. /api/r2-delete-user  purges every R2 object under auth/<userId>/
//   2. admin_delete_member() RPC deletes the auth.users row, which cascades
//      every bank row, asset row, usage_days row and the profile itself
//
// R2 goes first on purpose: once the Postgres rows are gone nothing points at
// those objects any more, so a failure there would leave binaries nobody can
// find. It is still best-effort — a member with no storage, or a deploy with no
// R2 env, must not be undeletable — so a failure comes back as a warning
// alongside a completed delete rather than aborting it.

import { getSupabase, ensureFreshSession } from '../../lib/supabase'

// Each /api/r2-delete-user call works to its own time budget and reports
// done:false if objects remain. Bounded so a pathological library can't spin.
const MAX_R2_PASSES = 10

export interface DeleteMemberResult {
  email: string
  // Non-null when the account is gone but some R2 objects survived it.
  storageWarning: string | null
}

async function purgeR2(userId: string): Promise<string | null> {
  const token = await ensureFreshSession()
  if (!token) return 'Not signed in — R2 objects were left in place.'

  let totalFailed = 0
  let lastError: string | null = null

  for (let pass = 0; pass < MAX_R2_PASSES; pass++) {
    const res = await fetch('/api/r2-delete-user', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let msg = text || res.statusText
      try {
        const parsed = JSON.parse(text) as { error?: string }
        if (parsed.error) msg = parsed.error
      } catch { /* not JSON — keep the raw text */ }
      return `Storage purge failed (${res.status}): ${msg}`
    }
    const body = await res.json() as { deleted: number; failed: number; done: boolean; error?: string }
    totalFailed += body.failed
    if (body.error) lastError = body.error
    if (body.done) {
      return totalFailed > 0
        ? `${totalFailed} storage object${totalFailed === 1 ? '' : 's'} could not be deleted (${lastError ?? 'unknown error'}).`
        : null
    }
  }

  return 'Storage purge did not finish — some objects may remain in R2.'
}

export async function deleteMember(
  userId: string,
  opts: { removeFromAllowlist: boolean },
): Promise<DeleteMemberResult> {
  const storageWarning = await purgeR2(userId)

  const sb = getSupabase()
  const { data, error } = await sb.rpc('admin_delete_member', {
    target_id: userId,
    remove_from_allowlist: opts.removeFromAllowlist,
  })
  if (error) {
    // A missing function is the one failure worth translating — it means the
    // migration hasn't been run against this project yet.
    if (/admin_delete_member/.test(error.message) && /(does not exist|not find)/i.test(error.message)) {
      throw new Error('Deletion is not set up on this project yet — run migration 0018_admin_delete_member.sql.')
    }
    throw new Error(error.message)
  }

  return { email: typeof data === 'string' ? data : '', storageWarning }
}
