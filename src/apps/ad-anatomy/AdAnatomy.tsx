import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Eye, History, RotateCcw, Upload, Volume2, VolumeX } from 'lucide-react'
import Spinner from '../../components/Spinner'
import MobilePaneTabs from '../../components/MobilePaneTabs'
import { paneClass } from '../../components/paneClass'
import UploadView from './components/UploadView'
import ResultsView from './components/ResultsView'
import HistoryRail from './components/HistoryRail'
import type { AnalysisResult } from './types'
import type { AdAnatomyHistoryItem, DiscoverVideoPayload } from '../../stores/types'
import { usePersistedState, useProjectScopedKey } from '../../hooks/usePersistedState'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { saveAsset, deleteAsset } from '../../utils/assetStore'
import { enqueueAnalysis, resumeAnalysis, retryAnalysis } from './services/analysisQueue'
import { useBankStore } from '../../stores/bankStore'
import { useAppStore } from '../../stores/appStore'
import { useReportActivity } from '../../stores/activityStore'


export default function AdAnatomy() {
  const baseKey = useProjectScopedKey('ad-anatomy')
  const [selectedId, setSelectedId] = usePersistedState<string | null>(`${baseKey}:selectedId`, null)
  // Phone-only: which of the two panes is on screen (ignored from md up).
  const [pane, setPane] = useState<'history' | 'result'>('result')

  const adAnatomyHistory = useBankStore((s) => s.adAnatomyHistory)

  const activeApp = useAppStore((s) => s.activeApp)
  const interAppPayload = useAppStore((s) => s.interAppPayload)
  const consumePayload = useAppStore((s) => s.consumePayload)

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
        // No taskId means the refresh landed before kie accepted the job, so
        // there is nothing to re-attach to — that request died with the page.
        // The SOURCE stays, though: dropping it made a refresh cost the member
        // their upload as well as their place in the queue, and re-dragging a
        // 50MB clip is the part that actually hurts. ErrorPane offers Retry.
        void updateAdAnatomyHistory(item.id, {
          status: 'error',
          errorMessage: 'Analysis was interrupted by a page refresh. Your ad is still here. Retry to run it again.',
        })
      }
    }

    // Pass 1.5: TTL sweep for retained source videos. Idempotent — only fires
    // for settled rows (complete or error) still carrying an uploadedRef older
    // than the window. The thumbnail + saved analysis stay; the playback source
    // (and, on an error row, the ability to retry without re-uploading) goes.
    const SOURCE_TTL_MS = 14 * 86_400_000
    let purgedSources = 0
    for (const item of items) {
      if (item.status !== 'complete' && item.status !== 'error') continue
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

  // Storing a 50MB clip in IndexedDB takes real time, and until the row lands
  // there is no `selected` to render — which dropped the screen back to a bare
  // upload zone with the member's click apparently ignored. This flag holds a
  // "getting your ad ready" face over that gap. No try/finally: the per-file
  // catch below swallows everything, so the reset after the loop always runs
  // (and a try/finally here would make the React Compiler skip this component).
  const [preparing, setPreparing] = useState(false)

  const handleAnalyze = async (files: File[]) => {
    // On a phone only one pane is on screen — follow the run to the analysis.
    setPane('result')
    setPreparing(true)
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
    setPreparing(false)
  }

  // Outliers hands over a found ad as a live File (targetField 'adVideo') and
  // switches here. It goes through the same handleAnalyze the drop zone uses,
  // so a searched ad and an uploaded one are the same thing from here on.
  useEffect(() => {
    if (activeApp !== 'ad-anatomy') return
    if (!interAppPayload || interAppPayload.targetApp !== 'ad-anatomy') return
    if (interAppPayload.targetField !== 'adVideo') return

    const payload = interAppPayload.data as DiscoverVideoPayload
    consumePayload()
    if (payload?.file) void handleAnalyze([payload.file])
    // handleAnalyze is redefined every render; keying on the payload is what
    // makes this fire once per handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interAppPayload, activeApp])

  const handleDelete = (id: string) => {
    void deleteAdAnatomyHistory(id)
    if (selectedId === id) setSelectedId(null)
  }

  const selected = selectedId
    ? adAnatomyHistory.find((h) => h.id === selectedId) ?? null
    : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <MobilePaneTabs
        options={[
          { value: 'history', label: 'Analyses', icon: History },
          { value: 'result', label: 'Analysis', icon: Eye },
        ]}
        value={pane}
        onChange={setPane}
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className={paneClass(pane === 'history', 'md:w-[280px] md:shrink-0 md:border-r md:border-ink/5')}>
        <HistoryRail
          items={adAnatomyHistory}
          selectedId={selectedId}
          // Picking an analysis on a phone means "show me it" — the list and
          // the reading surface are two tabs, not two columns.
          onSelect={(id) => { setSelectedId(id); setPane('result') }}
          onNew={() => { setSelectedId(null); setPane('result') }}
          onDelete={handleDelete}
        />
      </div>
      <div className={paneClass(pane === 'result', 'md:min-w-0 md:flex-1')}>
        {!selected ? (
          preparing ? <PreparingPane /> : <UploadView onAnalyze={handleAnalyze} />
        ) : selected.status === 'analyzing' ? (
          <AnalyzingPane item={selected} />
        ) : selected.status === 'error' ? (
          <ErrorPane item={selected} onRetry={() => setSelectedId(null)} />
        ) : (
          <CompletePane item={selected} onReset={() => setSelectedId(null)} />
        )}
      </div>
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
        item={{ ...item, status: 'error', errorMessage: 'Result missing. Please re-analyse.' }}
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
      mediaKind={item.mediaKind}
    />
  )
}

// ── Pane: storing the upload, before the first row exists ───────────
// Covers the gap between the Analyze click and the history row landing (an
// IndexedDB write of the whole clip). Deliberately the same two-line shape as
// AnalyzingPane, so the wait reads as one continuous step.
function PreparingPane() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <Spinner className="h-7 w-7 text-[#FF5257]/70" />
      <div className="flex flex-col items-center gap-1">
        <h2 className="text-lg font-semibold tracking-tight text-ink-100">Getting your ad ready</h2>
        <p className="text-xs text-ink-500">Storing the clip before the analysis starts.</p>
      </div>
    </div>
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

  // Ask for playback once the source resolves. `autoPlay` alone is not enough
  // on Safari, which refuses it far more readily than Chromium does — a per-site
  // Auto-Play setting is by itself sufficient — and a refused autoplay on an
  // element with no poster is a black rectangle where the member's ad should
  // be. A refusal here is fine and expected: the poster below is what the
  // screen falls back to, so this only ever upgrades a still into a preview.
  useEffect(() => {
    if (!sourceUrl) return
    videoRef.current?.play().catch(() => { /* autoplay refused — the poster stands in */ })
  }, [sourceUrl])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 py-8">
      <div className="flex flex-col items-center gap-1 text-center">
        <h2 className="text-xl font-semibold tracking-tight text-ink-100">
          {item.compressing ? 'Shrinking the ad to fit' : 'Analyzing the ad'}
        </h2>
      </div>

      {/* The frame grows into whatever height the pane has left (aspect-ratio
          derives the width from it), capped so it can't balloon on a tall display. */}
      {(sourceUrl || thumbUrl) && (
        <div
          className="group relative min-h-0 w-auto max-w-full flex-1 overflow-hidden rounded-2xl border border-ink/10 shadow-[0_0_90px_-28px_rgba(255,82,87,0.45)] max-h-[34rem]"
          style={{ aspectRatio: '9 / 16' }}
        >
          {sourceUrl ? (
            /* `poster` is the saved first frame: Safari's default `preload` is
               "metadata", so it reads the clip's header and then paints nothing
               until playback starts — and if it also declines the autoplay above,
               nothing ever starts it. Without a poster that is a black box under
               the scanning sweep for the whole analysis. */
            <video
              ref={videoRef}
              src={sourceUrl}
              poster={thumbUrl}
              className="h-full w-full object-cover"
              muted={muted}
              autoPlay
              loop
              playsInline
            />
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

      {/* The one thing this screen has to say. A full-video read is a single
          long chat call with no progress to report, so without a stated
          expectation the sweep animation reads as a hung page — which is what
          sent members reloading and losing their place in the queue. */}
      <div className="flex flex-col items-center gap-1 text-center">
        {/* The compress pass runs in realtime, so it takes about as long as the
            ad itself — a wait BEFORE the analysis starts. Naming it is the
            whole point: unexplained, it is just the sweep sitting there for
            another minute on a screen that already asks for patience. */}
        <p className="text-xs text-ink-400">
          {item.compressing
            ? 'This ad is too big to send as-is, so it’s being compressed first, which takes about as long as the ad runs.'
            : 'Please wait. This can take a couple of minutes.'}
        </p>
        {/* Deliberately not "survives a refresh": it usually does, but a reload
            in the window before kie accepts the job can't be resumed, and a
            promise the app breaks once is worse than one it never made. */}
        {/* True of the compress pass too: its frame clock runs on a worker, so
            a hidden tab no longer throttles it (see utils/compressVideo.ts). */}
        <p className="text-[11px] text-ink-600">No need to reload. It keeps running if you switch tools.</p>
      </div>

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
// A failed or interrupted row keeps its source ad, so the primary action is
// "run it again" — no re-upload, no re-drag. It falls back to the old
// re-upload route when the source is gone (TTL-swept, or a pre-fix row).
function ErrorPane({ item, onRetry }: { item: AdAnatomyHistoryItem; onRetry: () => void }) {
  const [retrying, setRetrying] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const canRerun = !!item.uploadedRef && !retrying

  const handleRerun = () => {
    setRetrying(true)
    retryAnalysis(item)
      .then((ok) => {
        if (!ok) {
          addToast('That ad is no longer stored. Upload it again to retry.', 'error')
          setRetrying(false)
        }
        // On success the row flips to 'analyzing' and this pane unmounts.
      })
      .catch(() => {
        addToast('Could not restart the analysis. Upload the ad again.', 'error')
        setRetrying(false)
      })
  }

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
      <div className="flex items-center gap-2">
        {item.uploadedRef && (
          <button
            onClick={handleRerun}
            disabled={!canRerun}
            className="flex items-center gap-2 rounded-full border border-white/15 bg-[#FF5257] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#FF5257]/90 disabled:opacity-60"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Restarting…' : 'Retry analysis'}
          </button>
        )}
        <button
          onClick={onRetry}
          className="flex items-center gap-2 rounded-full border border-[#FF5257]/20 bg-[#FF5257]/10 px-4 py-2 text-sm font-medium text-[#FF5257] transition-colors hover:bg-[#FF5257]/20"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload another
        </button>
      </div>
    </div>
  )
}
