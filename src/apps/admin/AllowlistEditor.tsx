import { useEffect, useRef, useState } from 'react'
import { Loader2, Trash2, Plus, RefreshCw, Upload, X, AlertTriangle } from 'lucide-react'
import { getSupabase } from '../../lib/supabase'
import { QUERY_TIMEOUT_MS, readyAdminSession, withTimeout } from './adminQuery'

interface AllowlistRow {
  email: string
  source: string
  added_at: string
  notes: string | null
  first_name: string | null
  last_name: string | null
}

interface CsvEntry {
  email: string
  firstName: string | null
  lastName: string | null
}

// Parse one CSV line, respecting double-quoted fields with embedded commas/quotes.
// Skool's export uses simple unquoted CSV but other tools (Numbers, Excel) quote
// fields containing commas, so we handle both.
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Find the email column from a header row + body. Prefers a column literally
// named "email" (case-insensitive); falls back to the first column where the
// majority of values look like email addresses.
function detectEmailColumn(header: string[], rows: string[][]): number {
  const idxByName = header.findIndex((h) => h.toLowerCase().trim() === 'email')
  if (idxByName !== -1) return idxByName

  let bestIdx = -1
  let bestScore = 0
  for (let col = 0; col < header.length; col++) {
    let hits = 0
    for (const row of rows) {
      const v = (row[col] ?? '').trim()
      if (v && EMAIL_RE.test(v)) hits++
    }
    if (hits > bestScore) { bestScore = hits; bestIdx = col }
  }
  return bestIdx
}

// Match Skool's CSV header variants for name columns. Returns -1 if absent.
function detectNameColumn(header: string[], kind: 'first' | 'last'): number {
  const firstNames = ['first name', 'firstname', 'first', 'given name', 'givenname']
  const lastNames = ['last name', 'lastname', 'last', 'surname', 'family name', 'familyname']
  const wanted = kind === 'first' ? firstNames : lastNames
  return header.findIndex((h) => wanted.includes(h.toLowerCase().trim()))
}

interface ImportPreview {
  fileName: string
  newEntries: CsvEntry[]      // brand-new emails (with optional names)
  // Existing allowlist rows whose names we'll refresh from the CSV (no email
  // change, just name fields). Skipped when the CSV row carries no name.
  nameUpdates: CsvEntry[]
  duplicates: string[]         // already on allowlist, no name change to push
  invalid: string[]            // failed regex
  // Allowlist emails NOT present in the CSV. Only removed if the user opts in
  // to sync mode in the modal. Excludes admin sources to avoid accidentally
  // booting yourself.
  removable: string[]
}

export default function AllowlistEditor() {
  const [rows, setRows] = useState<AllowlistRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draftEmail, setDraftEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [slowHint, setSlowHint] = useState(false)

  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Global allowlist-enforcement toggle (public.app_config). null = unknown
  // (still loading or query failed).
  const [enforced, setEnforced] = useState<boolean | null>(null)
  const [enforceBusy, setEnforceBusy] = useState(false)

  // Shared signup access code (public.app_config.signup_code, migration 0021).
  // `savedCode` is what's in the database; `draftCode` is the input. null on
  // either = the column isn't there yet (migration not run).
  const [savedCode, setSavedCode] = useState<string | null>(null)
  const [draftCode, setDraftCode] = useState('')
  const [codeBusy, setCodeBusy] = useState(false)
  const [codeSupported, setCodeSupported] = useState(true)

  async function loadConfig() {
    try {
      await readyAdminSession()
      const sb = getSupabase()
      const run = (cols: string) => withTimeout(
        (signal) => sb.from('app_config').select(cols).eq('id', true).abortSignal(signal).maybeSingle(),
        QUERY_TIMEOUT_MS,
        'app_config query',
      ) as Promise<{ data: { enforce_allowlist: boolean; signup_code?: string | null } | null; error: { message: string; code?: string } | null }>

      let { data, error } = await run('enforce_allowlist, signup_code')
      // Migration 0021 not applied here yet — fall back so the enforcement
      // toggle still loads instead of the whole card reading as broken.
      if (error && /column .* does not exist|42703/i.test(`${error.message} ${error.code ?? ''}`)) {
        setCodeSupported(false)
        ;({ data, error } = await run('enforce_allowlist'))
      }
      if (error) throw error
      setEnforced(data?.enforce_allowlist ?? true)
      const code = data?.signup_code ?? null
      setSavedCode(code ?? '')
      setDraftCode(code ?? '')
    } catch {
      // Leave as null — the toggle card shows a "couldn't load" hint and the
      // allowlist table below still works.
      setEnforced(null)
    }
  }

  async function saveCode() {
    const next = draftCode.trim()
    if (next === (savedCode ?? '')) return
    if (!next && !confirm('Clear the access code? Anyone who gets past the allowlist will be able to create an account without one.')) return
    setCodeBusy(true)
    try {
      await readyAdminSession()
      const sb = getSupabase()
      const { error } = await withTimeout(
        (signal) => sb.from('app_config')
          .update({ signup_code: next || null, updated_at: new Date().toISOString() })
          .eq('id', true)
          .abortSignal(signal),
        QUERY_TIMEOUT_MS,
        'app_config update',
      ) as { error: { message: string } | null }
      if (error) throw error
      setSavedCode(next)
      setDraftCode(next)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setCodeBusy(false)
    }
  }

  async function toggleEnforce() {
    if (enforced === null) return
    const next = !enforced
    if (!next && !confirm('Turn the allowlist OFF? Anyone with the link will be able to create an account until you turn it back on.')) return
    setEnforceBusy(true)
    try {
      await readyAdminSession()
      const sb = getSupabase()
      const { error } = await withTimeout(
        (signal) => sb.from('app_config')
          .update({ enforce_allowlist: next, updated_at: new Date().toISOString() })
          .eq('id', true)
          .abortSignal(signal),
        QUERY_TIMEOUT_MS,
        'app_config update',
      ) as { error: { message: string } | null }
      if (error) throw error
      setEnforced(next)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setEnforceBusy(false)
    }
  }

  async function load() {
    setLoading(true)
    setError(null)
    setSlowHint(false)
    const slowTimer = setTimeout(() => setSlowHint(true), 3000)
    try {
      await readyAdminSession()
      const sb = getSupabase()
      const { data, error } = await withTimeout(
        (signal) => sb.from('allowlist')
          .select('email, source, added_at, notes, first_name, last_name')
          .order('added_at', { ascending: false })
          .abortSignal(signal),
        QUERY_TIMEOUT_MS,
        'allowlist query',
      ) as { data: AllowlistRow[] | null; error: { message: string } | null }
      if (error) throw error
      setRows(data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      clearTimeout(slowTimer)
      setLoading(false)
    }
  }

  useEffect(() => { load(); loadConfig() }, [])

  async function handleAdd() {
    const email = draftEmail.trim().toLowerCase()
    if (!email) return
    setAdding(true)
    try {
      await readyAdminSession()
      const sb = getSupabase()
      const { error } = await withTimeout(
        (signal) => sb.from('allowlist').insert({ email, source: 'manual' }).abortSignal(signal),
        QUERY_TIMEOUT_MS,
        'allowlist insert',
      ) as { error: { message: string } | null }
      if (error) throw error
      setDraftEmail('')
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(email: string) {
    if (!confirm(`Remove ${email} from the allowlist? They will be signed out and disabled.`)) return
    try {
      await readyAdminSession()
      const sb = getSupabase()
      const { error } = await withTimeout(
        (signal) => sb.from('allowlist').delete().eq('email', email).abortSignal(signal),
        QUERY_TIMEOUT_MS,
        'allowlist delete',
      ) as { error: { message: string } | null }
      if (error) throw error
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  // ── CSV bulk import ────────────────────────────────────────────────

  function pickFile() {
    fileInputRef.current?.click()
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-pick of the same file later
    if (!file) return

    try {
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
      if (lines.length === 0) {
        alert('CSV is empty.')
        return
      }

      const header = parseCsvLine(lines[0])
      const body = lines.slice(1).map(parseCsvLine)
      const emailCol = detectEmailColumn(header, body)
      const firstCol = emailCol === -1 ? -1 : detectNameColumn(header, 'first')
      const lastCol = emailCol === -1 ? -1 : detectNameColumn(header, 'last')

      // Collect (email, firstName, lastName) tuples. If we couldn't detect an
      // email column we fall back to "every cell is a possible email" and
      // skip name columns entirely.
      let candidates: CsvEntry[] = []
      const norm = (v: string | undefined): string | null => {
        const t = (v ?? '').trim()
        return t.length > 0 ? t : null
      }
      if (emailCol === -1) {
        candidates = [header, ...body].flat()
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
          .map((email) => ({ email, firstName: null, lastName: null }))
      } else {
        candidates = body
          .map((row) => ({
            email: (row[emailCol] ?? '').trim().toLowerCase(),
            firstName: firstCol === -1 ? null : norm(row[firstCol]),
            lastName: lastCol === -1 ? null : norm(row[lastCol]),
          }))
          .filter((e) => e.email.length > 0)
      }

      // De-dupe within the file (last occurrence wins for name fields).
      const byEmail = new Map<string, CsvEntry>()
      for (const c of candidates) byEmail.set(c.email, c)
      const deduped = Array.from(byEmail.values())

      const valid: CsvEntry[] = []
      const invalid: string[] = []
      for (const c of deduped) {
        if (EMAIL_RE.test(c.email)) valid.push(c)
        else invalid.push(c.email)
      }

      const existingByEmail = new Map(rows.map((r) => [r.email.toLowerCase(), r]))
      const newEntries: CsvEntry[] = []
      const nameUpdates: CsvEntry[] = []
      const duplicates: string[] = []
      for (const v of valid) {
        const existing = existingByEmail.get(v.email)
        if (!existing) {
          newEntries.push(v)
        } else if (
          (v.firstName !== null && v.firstName !== existing.first_name) ||
          (v.lastName !== null && v.lastName !== existing.last_name)
        ) {
          nameUpdates.push(v)
        } else {
          duplicates.push(v.email)
        }
      }

      // Sync candidates: rows that are on the allowlist but NOT in the CSV.
      // Skip rows whose source is anything other than 'manual' or 'csv-import'
      // — that protects 'admin'-flagged or future Zapier-flagged seeds from
      // being clobbered by a stale CSV. If you want to remove an admin you
      // can still do it manually with the trash button.
      const csvSet = new Set(valid.map((v) => v.email))
      const removable: string[] = rows
        .filter((r) => !csvSet.has(r.email.toLowerCase()))
        .filter((r) => r.source === 'manual' || r.source === 'csv-import')
        .map((r) => r.email.toLowerCase())

      setPreview({
        fileName: file.name,
        newEntries,
        nameUpdates,
        duplicates,
        invalid,
        removable,
      })
    } catch (e) {
      alert(`Failed to read CSV: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function confirmImport(syncMode: boolean) {
    if (!preview) return
    const willAdd = preview.newEntries.length
    const willUpdate = preview.nameUpdates.length
    const willRemove = syncMode ? preview.removable.length : 0
    if (willAdd === 0 && willUpdate === 0 && willRemove === 0) { setPreview(null); return }
    setImporting(true)
    try {
      await readyAdminSession()
      const sb = getSupabase()
      // Adds first, then name-only updates, then optional removes. RLS on
      // `allowlist` is admin-only, so each batch is a single round trip. The
      // on_allowlist_insert + on_allowlist_update_names triggers cascade
      // names into the matching profile rows.
      if (willAdd > 0) {
        const { error } = await withTimeout(
          (signal) => sb.from('allowlist').upsert(
            preview.newEntries.map((e) => ({
              email: e.email,
              source: 'csv-import',
              first_name: e.firstName,
              last_name: e.lastName,
            })),
            { onConflict: 'email', ignoreDuplicates: true },
          ).abortSignal(signal),
          30_000,
          'bulk import (add)',
        ) as { error: { message: string } | null }
        if (error) throw error
      }
      if (willUpdate > 0) {
        // Per-row UPDATE (not upsert) so we don't clobber source/added_at.
        // Batched in parallel for speed.
        const results = await Promise.allSettled(preview.nameUpdates.map((e) =>
          withTimeout(
            (signal) => sb.from('allowlist').update({
              first_name: e.firstName,
              last_name: e.lastName,
            }).eq('email', e.email).abortSignal(signal),
            30_000,
            `name update ${e.email}`,
          ) as Promise<{ error: { message: string } | null }>,
        ))
        const failures = results.filter((r) => r.status === 'rejected'
          || (r.status === 'fulfilled' && r.value.error))
        if (failures.length > 0) {
          const first = failures[0]
          const msg = first.status === 'rejected'
            ? (first.reason instanceof Error ? first.reason.message : String(first.reason))
            : (first.value.error?.message ?? 'unknown error')
          throw new Error(`${failures.length} name update(s) failed: ${msg}`)
        }
      }
      if (willRemove > 0) {
        const { error } = await withTimeout(
          (signal) => sb.from('allowlist').delete().in('email', preview.removable).abortSignal(signal),
          30_000,
          'bulk import (remove)',
        ) as { error: { message: string } | null }
        if (error) throw error
      }
      setPreview(null)
      await load()
    } catch (e) {
      alert(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Global enforcement toggle */}
      <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-ink-100">Allowlist enforcement</div>
            <p className="mt-0.5 text-[12px] text-ink-500">
              {enforced === false
                ? 'OFF — anyone with the link can create an account.'
                : 'ON — only emails on the list below can sign up.'}
            </p>
          </div>
          <button
            onClick={toggleEnforce}
            disabled={enforced === null || enforceBusy}
            role="switch"
            aria-checked={enforced === true}
            title={enforced === null ? "Couldn't load enforcement state" : undefined}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              enforced ? 'bg-emerald-500' : 'bg-ink/20'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enforced ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        {enforced === false && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200 light:text-amber-800">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>Signups are open. Review new members below and disable anyone who isn't in your Skool community. Turn this back on once Zapier sync is wired.</span>
          </div>
        )}
        {enforced === null && (
          <p className="mt-2 text-[11px] text-ink-600">Couldn't load enforcement state — run migration 0013, then refresh.</p>
        )}
      </div>

      {/* Shared signup access code. Never shipped to the browser — the signup
          form posts what the member typed and the trigger compares. */}
      <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4">
        <div className="text-[13px] font-medium text-ink-100">Signup access code</div>
        <p className="mt-0.5 text-[12px] text-ink-500">
          {!codeSupported
            ? "Not available — run migration 0021, then refresh."
            : savedCode
              ? 'New accounts must enter this code. Post it in the Skool community.'
              : 'No code set — the Create account form will accept any code.'}
        </p>
        {codeSupported && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={draftCode}
              onChange={(e) => setDraftCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveCode() }}
              placeholder="Set a code"
              className="min-w-[160px] flex-1 rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-[12px] text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
            />
            <button
              onClick={saveCode}
              disabled={codeBusy || draftCode.trim() === (savedCode ?? '')}
              className="flex items-center gap-1.5 rounded-lg bg-ink py-2 px-3 text-[12px] font-medium text-ink-900 transition-colors hover:bg-ink-100 disabled:opacity-60"
            >
              {codeBusy && <Loader2 className="h-3 w-3 animate-spin" />}
              Save
            </button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink-600">
          Only affects new signups — members who already have an account sign in as usual.
        </p>
      </div>

      <p className="text-[12px] text-ink-500">
        Emails on this list can sign up. Until your Zapier zap is wired, you can bulk-import a Skool members CSV — and re-upload it later with sync mode enabled to also remove members who left. Removing an email also signs out and disables the matching account.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={draftEmail}
          onChange={(e) => setDraftEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
          placeholder="email@example.com"
          className="min-w-[220px] flex-1 rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-[12px] text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
        />
        <button
          onClick={handleAdd}
          disabled={!draftEmail.trim() || adding}
          className="flex items-center gap-1.5 rounded-lg bg-ink py-2 px-3 text-[12px] font-medium text-ink-900 transition-colors hover:bg-ink-100 disabled:opacity-60"
        >
          {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add
        </button>
        <button
          onClick={pickFile}
          className="flex items-center gap-1.5 rounded-lg border border-ink/15 bg-ink/[0.04] py-2 px-3 text-[12px] font-medium text-ink-200 transition-colors hover:bg-ink/[0.08]"
          title="Bulk-import emails from a CSV (e.g. Skool member export)"
        >
          <Upload className="h-3 w-3" />
          Import CSV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onFileChosen}
          className="hidden"
        />
        <button onClick={load} className="flex items-center gap-1.5 rounded-md border border-ink/10 px-2.5 py-2 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05]">
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {error && (
        <div className="space-y-2">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-300 light:text-red-700">{error}</div>
          <button onClick={load} className="flex items-center gap-1.5 rounded-md border border-ink/10 px-2.5 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink/[0.05]">
            <RefreshCw className="h-3 w-3" /> Try again
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          {slowHint && <span className="text-[11px]">Still loading… will time out if it stalls.</span>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-ink/10">
          <table className="w-full text-[12px]">
            <thead className="bg-ink/[0.03] text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">Added</th>
                <th className="px-3 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-500">Empty — Zapier zap not yet wired, or no members yet.</td></tr>
              )}
              {rows.map((r) => {
                const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ')
                return (
                <tr key={r.email}>
                  <td className="px-3 py-2 text-ink-200">
                    {fullName || <span className="text-ink-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-200">{r.email}</td>
                  <td className="px-3 py-2 text-ink-400">{r.source}</td>
                  <td className="px-3 py-2 text-ink-400">{new Date(r.added_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleDelete(r.email)}
                      className="rounded-md p-1.5 text-ink-500 transition-colors hover:bg-red-500/10 hover:text-red-300 light:hover:text-red-700"
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <ImportPreviewModal
          preview={preview}
          importing={importing}
          onCancel={() => setPreview(null)}
          onConfirm={confirmImport}
        />
      )}
    </div>
  )
}

function ImportPreviewModal({
  preview,
  importing,
  onCancel,
  onConfirm,
}: {
  preview: ImportPreview
  importing: boolean
  onCancel: () => void
  onConfirm: (syncMode: boolean) => void
}) {
  const [syncMode, setSyncMode] = useState(false)
  const willRemove = syncMode ? preview.removable.length : 0
  const willAdd = preview.newEntries.length
  const willUpdate = preview.nameUpdates.length

  let cta: string
  if (willAdd === 0 && willUpdate === 0 && willRemove === 0) cta = 'Nothing to do'
  else {
    const bits: string[] = []
    if (willAdd > 0) bits.push(`add ${willAdd}`)
    if (willUpdate > 0) bits.push(`update ${willUpdate}`)
    if (willRemove > 0) bits.push(`remove ${willRemove}`)
    cta = bits.map((b, i) => i === 0 ? b[0].toUpperCase() + b.slice(1) : b).join(' & ')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-ink/10 bg-surface-2 p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink-100">Import preview</h3>
            <p className="mt-0.5 text-[11px] text-ink-500">From <span className="text-ink-300">{preview.fileName}</span></p>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 text-ink-500 transition-colors hover:bg-ink/[0.05] hover:text-ink-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <Stat color="emerald" label="New emails to add" value={preview.newEntries.length} />
          {preview.nameUpdates.length > 0 && (
            <Stat color="sky" label="Existing — name update" value={preview.nameUpdates.length} />
          )}
          <Stat color="zinc" label="Already on allowlist" value={preview.duplicates.length} />
          {preview.invalid.length > 0 && (
            <Stat color="amber" label="Invalid (skipped)" value={preview.invalid.length} />
          )}
          {preview.removable.length > 0 && (
            <Stat color="red" label="On list but not in CSV" value={preview.removable.length} dim={!syncMode} />
          )}
        </div>

        {preview.newEntries.length > 0 && (
          <details className="mt-3" open>
            <summary className="cursor-pointer text-[11px] text-ink-400 hover:text-ink-200">
              New emails ({preview.newEntries.length})
            </summary>
            <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-ink/10 bg-ink/[0.02] p-2 text-[11px] text-ink-400">
              {preview.newEntries.map((e) => {
                const name = [e.firstName, e.lastName].filter(Boolean).join(' ')
                return (
                  <div key={e.email} className="flex items-baseline justify-between gap-2 truncate">
                    <span className="truncate">{e.email}</span>
                    {name && <span className="shrink-0 text-ink-600">{name}</span>}
                  </div>
                )
              })}
            </div>
          </details>
        )}

        {preview.invalid.length > 0 && (
          <details className="mt-2 text-[11px] text-ink-500">
            <summary className="cursor-pointer hover:text-ink-300">Show invalid rows ({preview.invalid.length})</summary>
            <div className="mt-1 max-h-24 overflow-y-auto rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 font-mono text-[10px] text-amber-200/90 light:text-amber-800/90">
              {preview.invalid.map((e, i) => <div key={i} className="truncate">{e || '<empty>'}</div>)}
            </div>
          </details>
        )}

        {preview.removable.length > 0 && (
          <div className="mt-3 space-y-2 rounded-lg border border-red-500/20 bg-red-500/[0.05] p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={syncMode}
                onChange={(e) => setSyncMode(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-red-400"
              />
              <div className="flex-1">
                <div className="text-[12px] font-medium text-red-200 light:text-red-800">
                  Sync mode — also remove {preview.removable.length} {preview.removable.length === 1 ? 'email' : 'emails'} not in this CSV
                </div>
                <div className="mt-0.5 text-[11px] text-red-300/70 light:text-red-700/70">
                  Removed members are signed out and disabled. Admin-seeded entries are protected.
                </div>
              </div>
            </label>
            {syncMode && (
              <details>
                <summary className="cursor-pointer text-[11px] text-red-300/80 light:text-red-700/80 hover:text-red-200 light:hover:text-red-800">
                  Show {preview.removable.length} that would be removed
                </summary>
                <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-red-500/20 bg-red-500/[0.04] p-2 text-[11px] text-red-200/80 light:text-red-800/80">
                  {preview.removable.map((e) => <div key={e} className="truncate">{e}</div>)}
                </div>
              </details>
            )}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={importing}
            className="rounded-lg border border-ink/10 px-3 py-1.5 text-[12px] text-ink-300 transition-colors hover:bg-ink/[0.05] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(syncMode)}
            disabled={importing || (willAdd === 0 && willUpdate === 0 && willRemove === 0)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-60 ${
              willRemove > 0
                ? 'bg-red-500 text-white hover:bg-red-400'
                : 'bg-ink text-ink-900 hover:bg-ink-100'
            }`}
          >
            {importing && <Loader2 className="h-3 w-3 animate-spin" />}
            {cta}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ color, label, value, dim }: { color: 'emerald' | 'zinc' | 'amber' | 'red' | 'sky'; label: string; value: number; dim?: boolean }) {
  const dot =
    color === 'emerald' ? 'bg-emerald-400'
      : color === 'amber' ? 'bg-amber-400'
      : color === 'red' ? 'bg-red-400'
      : color === 'sky' ? 'bg-sky-400'
      : 'bg-ink-500'
  return (
    <div className={`flex items-center justify-between rounded-lg border border-ink/5 bg-ink/[0.02] px-3 py-2 text-[12px] ${dim ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 text-ink-300">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="font-mono tabular-nums text-ink-200">{value}</div>
    </div>
  )
}
