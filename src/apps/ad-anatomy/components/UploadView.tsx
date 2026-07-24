import { useRef, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Upload, Eye, Coins, X, Film } from 'lucide-react'
import { formatCredits } from '../../../utils/models'
import { readMediaDuration } from '../../../utils/media'
import { useCreditsStore } from '../../../stores/creditsStore'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import { estimateAnalysisCredits } from '../services/analysisCost'

// IMPORTANT: The drop overlay lives on the panel root. Do NOT add an onDrop
// handler to the button — React onDrop on a child + native drop on the panel
// fire both, which causes every file to enqueue twice (5 files → 10 rows).

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const MAX_SIZE_MB = 50

interface UploadViewProps {
  onAnalyze: (files: File[]) => void
}

interface RejectedFile {
  name: string
  reason: string
}

// A dropped-but-not-yet-analysed clip. Duration is read lazily from metadata
// (null until it resolves) and only feeds the cost estimate.
interface StagedFile {
  id: string
  file: File
  durationSec: number | null
}

function validate(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Unsupported format'
  if (file.size > MAX_SIZE_MB * 1024 * 1024) return `Larger than ${MAX_SIZE_MB}MB`
  return null
}

export default function UploadView({ onAnalyze }: UploadViewProps) {
  // Panel-scoped drag overlay — visible whenever a file drag enters the
  // Ad Analyzer surface (not the sidebar or app chrome). Tracks a counter
  // so nested dragenter/leave from child elements don't flicker the overlay.
  const [panelDragActive, setPanelDragActive] = useState(false)
  const dragCounterRef = useRef(0)
  const [rejected, setRejected] = useState<RejectedFile[]>([])
  // Dropped clips waiting on the "Analyze Ad Creative" click. Analysis no
  // longer fires straight off the drop — the cost-confirm popup gates it.
  const [staged, setStaged] = useState<StagedFile[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const balance = useCreditsStore((s) => s.balance)
  const refreshBalance = useCreditsStore((s) => s.refresh)

  useCloseOnAppSwitch(confirmOpen, () => setConfirmOpen(false))

  const handleFiles = useCallback((files: File[]) => {
    setRejected([])
    const accepted: StagedFile[] = []
    const failed: RejectedFile[] = []
    for (const f of files) {
      const reason = validate(f)
      if (reason) failed.push({ name: f.name, reason })
      else accepted.push({ id: crypto.randomUUID(), file: f, durationSec: null })
    }
    if (failed.length > 0) setRejected(failed)
    if (accepted.length === 0) return
    setStaged((prev) => [...prev, ...accepted])
    // Read each clip's duration in the background to sharpen the estimate; a
    // metadata read that fails just leaves it null (the estimate falls back to
    // a default duration). Object URLs are revoked once metadata resolves.
    for (const s of accepted) {
      const url = URL.createObjectURL(s.file)
      readMediaDuration(url, 'video')
        .then((d) => setStaged((prev) => prev.map((x) => (x.id === s.id ? { ...x, durationSec: d } : x))))
        .catch(() => {})
        .finally(() => URL.revokeObjectURL(url))
    }
  }, [])

  // Panel-scoped drag-drop: listen on the Ad Analyzer panel only so the
  // overlay covers just this surface — not the sidebar or app chrome.
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    function isFileDrag(e: DragEvent): boolean {
      return Array.from(e.dataTransfer?.types ?? []).includes('Files')
    }
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      dragCounterRef.current += 1
      setPanelDragActive(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
    }
    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      dragCounterRef.current -= 1
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0
        setPanelDragActive(false)
      }
    }
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      dragCounterRef.current = 0
      setPanelDragActive(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length > 0) handleFiles(files)
    }
    el.addEventListener('dragenter', onDragEnter)
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragenter', onDragEnter)
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', onDrop)
    }
  }, [handleFiles])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) handleFiles(files)
    if (inputRef.current) inputRef.current.value = ''
  }

  const removeStaged = (id: string) => setStaged((prev) => prev.filter((s) => s.id !== id))

  const openConfirm = () => {
    if (staged.length === 0) return
    if (balance === null) void refreshBalance()
    setConfirmOpen(true)
  }

  const confirmAnalyze = () => {
    const files = staged.map((s) => s.file)
    setConfirmOpen(false)
    setStaged([])
    onAnalyze(files)
  }

  // Total estimated credits across every staged clip. estimateAnalysisCredits
  // only returns null if the chat model loses its pricing entry (never in
  // practice), so a simple sum is enough; null total → no staged clips.
  const totalCredits = staged.length === 0
    ? null
    : staged.reduce((sum, s) => sum + (estimateAnalysisCredits(s.durationSec ?? 0) ?? 0), 0)
  const overBudget = balance !== null && totalCredits !== null && totalCredits > balance

  const hasStaged = staged.length > 0

  return (
    <div ref={panelRef} className="relative flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <Eye className="h-8 w-8 text-[#FF5257]/60" strokeWidth={1.5} />
        <h2 className="text-lg font-semibold tracking-tight text-ink-200">
          Reverse Engineer Any Ad
        </h2>
        <p className="max-w-sm text-sm text-ink-500">
          Drop in one or more ads and we&apos;ll analyze them with extreme precision so you can reverse-engineer every detail.
        </p>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`flex ${hasStaged ? 'h-36' : 'h-56'} w-full max-w-md flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed transition-all duration-200 ${panelDragActive
          ? 'border-[#FF5257]/40 bg-[#FF5257]/5'
          : 'border-ink/10 bg-ink/[0.02] hover:border-ink/20 hover:bg-ink/[0.04]'
          }`}
      >
        <Upload className={`h-6 w-6 transition-colors ${panelDragActive ? 'text-[#FF5257]' : 'text-ink-600'}`} />
        <span className="text-sm text-ink-400">
          {hasStaged ? 'Add another ad, or ' : 'Drag & drop one or more ads, or '}
          <span className="text-ink-200 underline underline-offset-2">browse</span>
        </span>
        <span className="text-[11px] text-ink-600">MP4, MOV, WebM — max {MAX_SIZE_MB}MB each</span>
        {!hasStaged && (
          <span className="text-[10px] uppercase tracking-widest text-ink-700">Up to 5 analyse in parallel · the rest queue</span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />

      {/* Staged clips + the Analyze button. Analysis is now a two-step flow:
          drop → review → confirm cost — so nothing fires unpriced. */}
      {hasStaged && (
        <div className="flex w-full max-w-md flex-col gap-2">
          {staged.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2.5 rounded-full border border-ink/10 bg-ink/[0.03] py-1.5 pl-3 pr-1.5"
            >
              <Film className="h-3.5 w-3.5 shrink-0 text-[#FF5257]/70" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate text-xs text-ink-300">{s.file.name}</span>
              {s.durationSec != null && (
                <span className="shrink-0 text-[11px] tabular-nums text-ink-600">{Math.round(s.durationSec)}s</span>
              )}
              <button
                type="button"
                onClick={() => removeStaged(s.id)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/10 hover:text-ink-200"
                aria-label={`Remove ${s.file.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={openConfirm}
            className="mt-1 flex items-center justify-center gap-2 rounded-full bg-[#FF5257] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#FF5257]/90"
          >
            <Eye className="h-4 w-4" strokeWidth={2} />
            <span>Analyze Ad Creative</span>
            {staged.length > 1 && (
              <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-medium tabular-nums">×{staged.length}</span>
            )}
            {totalCredits !== null && (
              <span
                title="Estimated credits to analyse — rough and rounded up. The real charge is metered per token on your key."
                className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight"
              >
                <Coins className="h-3 w-3" strokeWidth={2} />
                ~{formatCredits(totalCredits)}
              </span>
            )}
          </button>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="flex w-full max-w-md flex-col gap-1 rounded-lg border border-[#FF5257]/20 bg-[#FF5257]/[0.06] px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-widest text-[#FF5257]/80">Skipped</p>
          {rejected.map((r) => (
            <p key={r.name} className="truncate text-xs text-[#FF5257]/90">
              <span className="text-ink-400">{r.name}</span> — {r.reason}
            </p>
          ))}
        </div>
      )}

      {/* Panel-scoped drag overlay — covers the Ad Analyzer surface only
          (sidebar and app chrome remain visible). */}
      {panelDragActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[#FF5257]/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-[#FF5257]/50 bg-surface-2 px-12 py-10 text-center shadow-2xl">
            <Upload className="h-10 w-10 text-[#FF5257]" />
            <p className="text-xl font-semibold tracking-tight text-ink-100">
              Drop your ads here to analyse
            </p>
            <p className="text-sm text-ink-400">MP4, MOV, WebM — max {MAX_SIZE_MB}MB each</p>
          </div>
        </div>
      )}

      {/* Cost-confirm popup — the "credits it's about to take" prompt. Mirrors
          B-Roll's Generate popup so the whole app confirms spend the same way. */}
      {confirmOpen && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-ink/10 bg-ink-950/95 p-5 shadow-2xl"
          >
            <h3 className="text-sm font-medium text-ink-100">
              Analyze {staged.length} ad{staged.length === 1 ? '' : 's'}?
            </h3>
            <p className="mt-1 text-xs text-ink-500">
              Two passes at high reasoning · up to 5 run in parallel, the rest queue.
            </p>
            <div className="mt-4 flex items-center justify-between rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5 text-xs">
              <span className="text-ink-400">Estimated cost</span>
              <span className="flex items-center gap-1 font-medium text-ink-100">
                <Coins className="h-3 w-3" strokeWidth={2} />
                {totalCredits !== null ? `~${formatCredits(totalCredits)}` : '— credits'}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-600">
              Rough, rounded up — the real charge is metered per token on your key.
            </p>
            {balance !== null && (
              <p className={`mt-1 text-[11px] ${overBudget ? 'text-red-400 light:text-red-600' : 'text-ink-500'}`}>
                Your balance: {balance.toLocaleString()} credits{overBudget ? ' — not enough' : ''}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-1.5 text-[12px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.06]"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAnalyze}
                className="flex items-center gap-1.5 rounded-full border border-white/15 bg-[#FF5257] px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#FF5257]/90"
              >
                <Eye className="h-3.5 w-3.5" />
                Analyze
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
