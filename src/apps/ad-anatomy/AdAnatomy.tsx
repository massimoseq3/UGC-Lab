import { useEffect, useRef, useState } from 'react'
import { AlertCircle, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import UploadView from './components/UploadView'
import ResultsView from './components/ResultsView'
import HistoryRail from './components/HistoryRail'
import type { AnalysisResult } from './types'
import type { AdAnatomyHistoryItem } from '../../stores/types'
import { usePersistedState, useProjectScopedKey } from '../../hooks/usePersistedState'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { saveAsset, deleteAsset } from '../../utils/assetStore'
import { enqueueAnalysis, resumeAnalysis } from './services/analysisQueue'
import { useBankStore } from '../../stores/bankStore'
import { useReportActivity } from '../../stores/activityStore'


export default function AdAnatomy() {
  const baseKey = useProjectScopedKey('ad-anatomy')
  const [selectedId, setSelectedId] = usePersistedState<string | null>(`${baseKey}:selectedId`, null)

  const adAnatomyHistory = useBankStore((s) => s.adAnatomyHistory)

  // Pulse the dock dot while any analysis row is still working.
  useReportActivity('ad-anatomy', adAnatomyHistory.some((h) => h.status === 'analyzing'))

  const addAdAnatomyHistory = useBankStore((s) => s.addAdAnatomyHistory)
  const updateAdAnatomyHistory = useBankStore((s) => s.updateAdAnatomyHistory)
  const deleteAdAnatomyHistory = useBankStore((s) => s.deleteAdAnatomyHistory)

  // Mount-time reconciler. Two passes:
  //  1. Resume any 'analyzing' row carrying a kie taskId (createTask
  //     transport — refresh-safe). Flip the rest to 'error', since a row that
  //     fell back to streaming has nothing to re-attach to.
  //  2. One-time dedupe of duplicate-pair rows from the pre-fix bulk-drop bug
  //     (same fileName + createdAt within 2s). Guarded by a localStorage flag
  //     so it runs once per browser.
  useEffect(() => {
    const items = useBankStore.getState().adAnatomyHistory

    // Pass 1: resume / fail in-flight rows
    for (const item of items) {
      if (item.status !== 'analyzing') continue
      if (item.taskId) {
        resumeAnalysis(item)
      } else {
        void updateAdAnatomyHistory(item.id, {
          status: 'error',
          errorMessage: 'Analysis was interrupted. Re-upload to retry.',
          uploadedRef: undefined,
        })
      }
    }

    // Pass 1.5: TTL sweep for retained source videos. Idempotent — only
    // fires for `complete` rows still carrying an uploadedRef older than the
    // window. The thumbnail + saved analysis stay; the playback source goes.
    const SOURCE_TTL_MS = 14 * 86_400_000
    let purgedSources = 0
    for (const item of items) {
      if (item.status !== 'complete') continue
      if (!item.uploadedRef) continue
      if (Date.now() - item.createdAt < SOURCE_TTL_MS) continue
      const refToDrop = item.uploadedRef
      void updateAdAnatomyHistory(item.id, { uploadedRef: undefined })
      deleteAsset(refToDrop).catch(() => {})
      purgedSources++
    }
    if (purgedSources > 0) {
      console.log(`[ad-anatomy] TTL sweep dropped ${purgedSources} source video(s)`)
    }

    // Pass 2: one-time dedupe of duplicate-pair rows
    const DEDUP_FLAG = 'ugc-lab:ad-anatomy-dedup-v1'
    try {
      if (!localStorage.getItem(DEDUP_FLAG)) {
        const groups = new Map<string, typeof items>()
        for (const item of items) {
          const bucket = Math.floor(item.createdAt / 2000)
          const key = `${item.fileName}::${bucket}`
          const arr = groups.get(key) ?? []
          arr.push(item)
          groups.set(key, arr)
        }
        const { deleteAdAnatomyHistory: deleteRow } = useBankStore.getState()
        for (const group of groups.values()) {
          if (group.length <= 1) continue
          // Prefer the row with a thumbnailRef (analysis actually started);
          // otherwise keep the newest.
          const keeper =
            group.find((r) => !!r.thumbnailRef) ??
            group.slice().sort((a, b) => b.createdAt - a.createdAt)[0]
          for (const row of group) {
            if (row.id !== keeper.id) void deleteRow(row.id)
          }
        }
        localStorage.setItem(DEDUP_FLAG, '1')
      }
    } catch (e) {
      console.warn('[ad-anatomy] dedupe pass failed', e)
    }
    // Only run once on mount; we deliberately don't want this firing on later
    // status flips back to 'analyzing' from genuine new uploads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAnalyze = async (files: File[]) => {
    let firstId: string | null = null
    for (const file of files) {
      try {
        // Source ad blob is local-only: kept in IndexedDB for playback, never
        // mirrored to R2. Evicted by the mount-time TTL sweep after 14 days.
        const uploadedRef = await saveAsset(file, file.type, { skipCloud: true })
        const id = crypto.randomUUID()
        const item: AdAnatomyHistoryItem = {
          id,
          createdAt: Date.now(),
          status: 'analyzing',
          adTitle: '',
          fileName: file.name,
          mediaKind: file.type.startsWith('image/') ? 'image' : 'video',
          uploadedRef,
        }
        await addAdAnatomyHistory(item)
        enqueueAnalysis(id, file)
        if (firstId === null) firstId = id
      } catch (e) {
        console.warn('[ad-anatomy] failed to enqueue analysis for', file.name, e)
      }
    }
    if (firstId) setSelectedId(firstId)
  }

  const handleDelete = (id: string) => {
    void deleteAdAnatomyHistory(id)
    if (selectedId === id) setSelectedId(null)
  }

  const selected = selectedId
    ? adAnatomyHistory.find((h) => h.id === selectedId) ?? null
    : null

  return (
    // Phones stack: compact history strip on top, analysis below. md+ keeps
    // the desktop split with the 280px rail on the left.
    <div className="flex h-full flex-col overflow-hidden md:flex-row">
      <HistoryRail
        items={adAnatomyHistory}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onNew={() => setSelectedId(null)}
        onDelete={handleDelete}
      />
      <div className="min-h-0 flex-1 md:min-w-0">
        {!selected ? (
          <UploadView onAnalyze={handleAnalyze} />
        ) : selected.status === 'analyzing' ? (
          <AnalyzingPane item={selected} />
        ) : selected.status === 'error' ? (
          <ErrorPane item={selected} onRetry={() => setSelectedId(null)} />
        ) : (
          <CompletePane item={selected} onReset={() => setSelectedId(null)} />
        )}
      </div>
    </div>
  )
}

// ── Pane: completed analysis ────────────────────────────────────────
function CompletePane({ item, onReset }: { item: AdAnatomyHistoryItem; onReset: () => void }) {
  const result = item.result as AnalysisResult | null
  // Source video lives locally for up to 14 days (mount-time TTL sweep evicts
  // older ones). When resolvable, ResultsView renders a real <video controls>;
  // otherwise it falls back to the still-frame thumbnail + caption.
  const sourceUrl = useAssetUrl(item.uploadedRef ?? null) ?? null
  const thumbUrl = useAssetUrl(item.thumbnailRef ?? null) ?? null
  if (!result) {
    return (
      <ErrorPane
        item={{ ...item, status: 'error', errorMessage: 'Result missing — please re-analyse.' }}
        onRetry={onReset}
      />
    )
  }
  return (
    <ResultsView
      result={result}
      videoSrc={sourceUrl}
      restoredThumbUrl={thumbUrl}
      fileName={item.fileName}
    />
  )
}

// ── Pane: analysis in progress ──────────────────────────────────────
function AnalyzingPane({ item }: { item: AdAnatomyHistoryItem }) {
  // Prefer the live source asset (gives us a playing preview) over the
  // stamped thumbnail. Falls back to thumbnail once source is cleaned up.
  const sourceUrl = useAssetUrl(item.uploadedRef ?? null)
  const thumbUrl = useAssetUrl(item.thumbnailRef ?? null)
  const videoRef = useRef<HTMLVideoElement>(null)
  // Autoplay only survives muted, so it starts muted — but the member is
  // watching their own ad play, and wanting to hear it is the obvious next
  // thought. One button, on the media.
  const [muted, setMuted] = useState(true)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 py-8">
      <div className="flex flex-col items-center gap-1 text-center">
        <h2 className="text-xl font-semibold tracking-tight text-ink-100">
          Analyzing the ad
        </h2>
      </div>

      {(sourceUrl || thumbUrl) && (
        <div
          className="group relative max-h-80 max-w-72 overflow-hidden rounded-2xl border border-ink/10 shadow-[0_0_90px_-28px_rgba(255,82,87,0.45)]"
          style={{ aspectRatio: '9 / 16' }}
        >
          {sourceUrl ? (
            <video ref={videoRef} src={sourceUrl} className="h-full w-full object-cover" muted={muted} autoPlay loop playsInline />
          ) : (
            <img src={thumbUrl!} alt="" className="h-full w-full object-cover" />
          )}
          {/* Scanning sweep — a bright, glowing leading line with a trailing
              glow band that travels top→bottom. A faint scrim over the media
              keeps the sweep legible even while the video plays underneath. */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
            <div className="absolute inset-0 bg-black/20" />
            <div
              className="absolute inset-x-0 -top-1/4 h-1/4"
              style={{ animation: 'ad-scan 2.8s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#FF5257]/20 to-[#FF5257]/40" />
              <div className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-[#FF5257] to-transparent shadow-[0_0_16px_3px_rgba(255,82,87,0.85)]" />
            </div>
          </div>
          {sourceUrl && (
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              title={muted ? 'Turn sound on' : 'Turn sound off'}
              className="absolute bottom-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          )}
          <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/5" />
        </div>
      )}

      <p className="text-[11px] text-ink-600">This keeps running if you switch tools.</p>

      <style>{`
        @keyframes ad-scan {
          0% { transform: translateY(0); }
          100% { transform: translateY(500%); }
        }
      `}</style>
    </div>
  )
}

// ── Pane: error ─────────────────────────────────────────────────────
function ErrorPane({ item, onRetry }: { item: AdAnatomyHistoryItem; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6">
      <AlertCircle className="h-10 w-10 text-[#FF5257]/70" strokeWidth={1.5} />
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-lg font-semibold tracking-tight text-ink-100">Analysis failed</h2>
        <p className="max-w-md text-xs text-ink-500">{item.fileName}</p>
      </div>
      <div className="max-w-md rounded-xl border border-[#FF5257]/20 bg-[#FF5257]/[0.06] px-4 py-3 text-center">
        <p className="text-sm text-ink-300">{item.errorMessage || 'Something went wrong.'}</p>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 rounded-full border border-[#FF5257]/20 bg-[#FF5257]/10 px-4 py-2 text-sm font-medium text-[#FF5257] transition-colors hover:bg-[#FF5257]/20"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Re-upload to retry
      </button>
    </div>
  )
}
