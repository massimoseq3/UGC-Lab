import { useMemo, useState, useEffect, useRef } from 'react'
import {
  Loader2, Download, Bookmark, Check, Film, Image as ImageIcon,
  Music as MusicIcon, Play, Pause, Volume2, VolumeX, X, ImagePlay, Copy,
  LayoutGrid, List, Maximize2,
} from 'lucide-react'
import { useBankStore } from '../../../stores/bankStore'
import { useAssetUrlState, useAssetUrl } from '../../../hooks/useAssetUrl'
import { useAppStore } from '../../../stores/appStore'
import { getUrl, saveAsset } from '../../../utils/assetStore'
import { extractVideoFrame } from '../../../utils/videoFrames'
import { getModel } from '../../../utils/models'
import { usePersistedState } from '../../../hooks/usePersistedState'
import { sectionLabel, groupByDay } from '../../../utils/history'
import { downloadImage } from '../../../utils/downloadImage'
import type { ImageHistoryItem, VideoHistoryItem, MusicHistoryItem } from '../../../stores/types'
import AudioTile from './AudioTile'
import GenerationProgress from '../../../components/GenerationProgress'
import { TileActionStack, TileActionButton, TileDeleteButton } from '../../../components/tileActions'
import GeneratingBackdrop from '../../../components/GeneratingBackdrop'
import SegmentedToggle from '../../../components/SegmentedToggle'
import type { PlaygroundMode, InFlightGen } from '../types'
import { humanizeError } from '../../../utils/friendlyError'
export type { InFlightGen }

// List-view size-slider bounds. The raw value drives the slider fill % and the
// media frame's aspect ratio (see `mediaAspect`) — not a pixel height. Min → a
// 16:9 frame (landscape fills, no bars); max → a tall frame that grows portraits.
const LIST_CARD_MIN = 200
const LIST_CARD_MAX = 560

// A single unified history entry. Image/Video/Music streams flow into this
// shape so day-bucketing + masonry can stay one code path.
type HistoryEntry =
  | { kind: 'image'; createdAt: number; data: ImageHistoryItem }
  | { kind: 'video'; createdAt: number; data: VideoHistoryItem }
  | { kind: 'music'; createdAt: number; data: MusicHistoryItem }

interface PlaygroundHistoryGridProps {
  inFlight: InFlightGen[]
  // Active mode filter — null shows everything.
  filterMode: PlaygroundMode | null
}

export default function PlaygroundHistoryGrid({ inFlight, filterMode }: PlaygroundHistoryGridProps) {
  const imageHistory = useBankStore((s) => s.imageHistory)
  const videoHistory = useBankStore((s) => s.videoHistory)
  const musicHistory = useBankStore((s) => s.musicHistory)
  const deleteImageHistory = useBankStore((s) => s.deleteImageHistory)
  const deleteVideoHistory = useBankStore((s) => s.deleteVideoHistory)
  const deleteMusicHistory = useBankStore((s) => s.deleteMusicHistory)
  const updateImageHistory = useBankStore((s) => s.updateImageHistory)
  const addBRoll = useBankStore((s) => s.addBRoll)
  const addToast = useAppStore((s) => s.addToast)

  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set())
  const [previewItem, setPreviewItem] = useState<HistoryEntry | null>(null)
  // Grid (masonry) vs List (stacked rows). Persisted globally so the choice
  // sticks across reloads and modes — mirrors the competitor's List/Grid switch.
  const [viewMode, setViewMode] = usePersistedState<'grid' | 'list'>('ai-ugc-lab:playground:history-view', 'grid')
  // List-view card size — the media frame height (px), set by the header slider.
  // Cards are full-width (2/3 media · 1/3 info); the slider grows the media taller
  // so the clip is more watchable. Max ≈ two of the smallest cards stacked.
  const [listCardHeight, setListCardHeight] = usePersistedState<number>('ai-ugc-lab:playground:list-card-height', 300)
  const cardPct = ((listCardHeight - LIST_CARD_MIN) / (LIST_CARD_MAX - LIST_CARD_MIN)) * 100
  // The list media frame keeps a constant width (its column) and grows taller as
  // the slider moves right. At the minimum it's a perfect 16:9 (landscape fills,
  // no bars); sliding right lowers the ratio toward 9:16, letterboxing landscape
  // while portraits get bigger. Mirrors the Influencers gallery.
  const mediaAspect = 16 / 9 + (cardPct / 100) * (9 / 16 - 16 / 9)

  const entries = useMemo<HistoryEntry[]>(() => {
    const out: HistoryEntry[] = []
    for (const i of imageHistory) out.push({ kind: 'image', createdAt: i.createdAt, data: i })
    // Playground's history grid only shows generations that originated in
    // Playground. B-Roll's per-card video gens write to the same
    // videoHistory bank (so refresh-resume keeps working) but they belong
    // in the B-Roll tab, not here. Legacy entries (no sourceApp field) are
    // kept visible — they pre-date the field and would otherwise vanish.
    for (const v of videoHistory) {
      if (v.sourceApp === 'broll-studio') continue
      out.push({ kind: 'video', createdAt: v.createdAt, data: v })
    }
    for (const m of musicHistory) out.push({ kind: 'music', createdAt: m.createdAt, data: m })
    out.sort((a, b) => b.createdAt - a.createdAt)
    if (filterMode) return out.filter((e) => e.kind === filterMode)
    return out
  }, [imageHistory, videoHistory, musicHistory, filterMode])

  const dayGroups = useMemo(() => groupByDay(entries, (e) => e.createdAt), [entries])

  const visibleInFlight = filterMode ? inFlight.filter((g) => g.mode === filterMode) : inFlight

  // Save an image-history entry to the B-Rolls bank. Tracks in-flight ids so
  // the user can't double-tap into duplicate BRolls.
  async function handleSaveImage(item: ImageHistoryItem) {
    if (item.linkedBRollId || savingIds.has(item.id)) return
    setSavingIds((prev) => new Set(prev).add(item.id))
    try {
      const id = await addBRoll({ imageUrl: item.imageUrl, prompt: item.prompt, sourceApp: 'playground' })
      await updateImageHistory(item.id, { linkedBRollId: id })
    } catch (err) {
      addToast(humanizeError(err, 'Save failed'), 'error')
    } finally {
      setSavingIds((prev) => { const next = new Set(prev); next.delete(item.id); return next })
    }
  }

  // Copy a generation's prompt to the clipboard. Replaces the old "reuse into
  // inputs" tile action — a plain copy is what users actually reach for.
  async function handleCopyPrompt(prompt: string) {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      addToast('Prompt copied', 'success')
    } catch {
      addToast('Could not copy the prompt', 'error')
    }
  }

  if (entries.length === 0 && visibleInFlight.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <ImagePlay className="h-9 w-9 text-ink-800" strokeWidth={1.5} />
          <p className="text-sm text-ink-500">No generations yet</p>
          <p className="max-w-[300px] text-xs leading-relaxed text-ink-600">
            Pick a preset or type a prompt below and hit Generate.
            Everything you make lands here, sorted by day.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header — card-size slider (list view only) + view switch (Grid / List).
          Matches the prompt panel's h-[57px] mode-toggle bar so the left/right
          tabs sit on the same line. */}
      <div className="flex h-[57px] shrink-0 items-center justify-end gap-3 border-b border-ink/5 px-4">
        {viewMode === 'list' && (
          <div className="flex items-center gap-2.5" title="Card size">
            <Maximize2 className="h-3.5 w-3.5 text-ink-500" />
            <input
              type="range"
              min={LIST_CARD_MIN}
              max={LIST_CARD_MAX}
              step={10}
              value={listCardHeight}
              onChange={(e) => setListCardHeight(Number(e.target.value))}
              className="slider-thin w-28"
              style={{
                ['--slider-pct' as string]: `${cardPct}%`,
                ['--slider-fill' as string]: 'var(--color-playground-500)',
              }}
              aria-label="List card size"
            />
          </div>
        )}
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {visibleInFlight.length > 0 && (
          <>
            <DayPill label="In progress" />
            {viewMode === 'grid' ? (
              <div className="grid grid-cols-2 items-start gap-2.5 [grid-auto-flow:dense] lg:grid-cols-3 xl:grid-cols-4">
                {visibleInFlight.map((gen) => {
                  const ar = gen.imageParams?.aspectRatio ?? gen.videoParams?.aspectRatio
                  return (
                    <div key={gen.id} className={ar && isLandscape(ar) ? 'col-span-2' : ''}>
                      <InFlightTile gen={gen} />
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {visibleInFlight.map((gen) => <InFlightRow key={gen.id} gen={gen} mediaAspect={mediaAspect} />)}
              </div>
            )}
          </>
        )}

        {dayGroups.map(([dayTs, dayItems]) => (
          <div key={dayTs}>
            <DayPill label={sectionLabel(dayTs)} />
            {viewMode === 'grid' ? (
              <div className="grid grid-cols-2 items-start gap-2.5 [grid-auto-flow:dense] lg:grid-cols-3 xl:grid-cols-4">
                {dayItems.map((entry) => {
                  const ar = entry.kind === 'music' ? null : entry.data.aspectRatio
                  return (
                  <div key={`${entry.kind}-${entry.data.id}`} className={ar && isLandscape(ar) ? 'col-span-2' : ''}>
                    {entry.kind === 'image' && (
                      <ImageTile
                        item={entry.data}
                        isSaving={savingIds.has(entry.data.id)}
                        onClick={() => setPreviewItem(entry)}
                        onSave={() => handleSaveImage(entry.data)}
                        onDelete={() => deleteImageHistory(entry.data.id)}
                        onCopyPrompt={() => handleCopyPrompt(entry.data.prompt)}
                      />
                    )}
                    {entry.kind === 'video' && (
                      <VideoTile
                        item={entry.data}
                        onClick={() => setPreviewItem(entry)}
                        onDelete={() => deleteVideoHistory(entry.data.id)}
                        onCopyPrompt={() => handleCopyPrompt(entry.data.prompt)}
                      />
                    )}
                    {entry.kind === 'music' && (
                      <AudioTile
                        item={entry.data}
                        onDownload={async () => {
                          const url = await getUrl(entry.data.audioRef)
                          if (url) downloadImage(url, `playground-${entry.data.id}`, 'mp3')
                        }}
                        onDelete={() => deleteMusicHistory(entry.data.id)}
                        onCopyPrompt={() => handleCopyPrompt(entry.data.prompt)}
                      />
                    )}
                  </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {dayItems.map((entry) => (
                  <HistoryListRow
                    key={`${entry.kind}-${entry.data.id}`}
                    entry={entry}
                    mediaAspect={mediaAspect}
                    isSaving={savingIds.has(entry.data.id)}
                    onClickImage={entry.kind === 'image' ? () => setPreviewItem(entry) : undefined}
                    onCopyPrompt={() => handleCopyPrompt(entry.data.prompt)}
                    onSave={entry.kind === 'image' ? () => handleSaveImage(entry.data) : undefined}
                    onDownload={async () => {
                      if (entry.kind === 'image') {
                        const u = await getUrl(entry.data.imageUrl)
                        if (u) downloadImage(u, `playground-${entry.data.id}`)
                      } else if (entry.kind === 'video') {
                        const u = await getUrl(entry.data.videoUrl)
                        if (u) downloadImage(u, `playground-${entry.data.id}`, 'mp4')
                      } else {
                        const u = await getUrl(entry.data.audioRef)
                        if (u) downloadImage(u, `playground-${entry.data.id}`, 'mp3')
                      }
                    }}
                    onDelete={() => {
                      if (entry.kind === 'image') deleteImageHistory(entry.data.id)
                      else if (entry.kind === 'video') deleteVideoHistory(entry.data.id)
                      else deleteMusicHistory(entry.data.id)
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {previewItem && (
        <PreviewModal
          entry={previewItem}
          onClose={() => setPreviewItem(null)}
          isSaving={savingIds.has(previewItem.data.id)}
          onSave={() => {
            if (previewItem.kind === 'image') handleSaveImage(previewItem.data)
          }}
        />
      )}
    </div>
  )
}

function DayPill({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center justify-center">
      <span className="rounded-full bg-ink/[0.06] px-3 py-1 text-[11px] font-medium text-ink-300">{label}</span>
    </div>
  )
}

// ── View toggle ─────────────────────────────────────────────────

// Grid / List switch in the history header. Built on SegmentedToggle with the
// same `h-10 !p-1` sizing as the Video/Image/Music mode toggle so the two tabs
// read as a matched pair across the panel split.
function ViewToggle({ value, onChange }: { value: 'grid' | 'list'; onChange: (v: 'grid' | 'list') => void }) {
  return (
    <SegmentedToggle<'grid' | 'list'>
      fitContent
      className="h-10 !p-1"
      value={value}
      onChange={onChange}
      options={[
        { value: 'list', label: 'List', icon: List },
        { value: 'grid', label: 'Grid', icon: LayoutGrid },
      ]}
    />
  )
}

// ── List row ────────────────────────────────────────────────────

// One generation as a full-width row: a large media frame taking two-thirds of
// the width (clips/images letterbox on black) you can play inline, and a side
// panel (the remaining third) with the model, prompt, metadata, and actions.
// The header slider drives `cardHeight`, growing the media taller. Mirrors the
// competitor's List view — scroll the feed, hit play, copy from the side box.
function HistoryListRow({
  entry,
  mediaAspect,
  isSaving,
  onClickImage,
  onCopyPrompt,
  onSave,
  onDownload,
  onDelete,
}: {
  entry: HistoryEntry
  mediaAspect: number
  isSaving: boolean
  onClickImage?: () => void
  onCopyPrompt: () => void
  onSave?: () => void
  onDownload: () => void
  onDelete: () => void
}) {
  const { url, status } = useAssetUrlState(
    entry.kind === 'image' ? entry.data.imageUrl : entry.kind === 'video' ? entry.data.videoUrl : null,
  )
  const audioUrl = useAssetUrl(entry.kind === 'music' ? entry.data.audioRef : null)
  const modelLabel = getModel(entry.data.modelId)?.displayName ?? entry.data.modelId
  const prompt = entry.data.prompt
  const isSaved = entry.kind === 'image' ? !!entry.data.linkedBRollId : false

  const ratioStr = entry.kind === 'music' ? null : entry.data.aspectRatio
  const frameAspect = frameAspectFor(ratioStr, mediaAspect)

  const meta: string[] = []
  if (entry.kind === 'image') {
    if (entry.data.resolution) meta.push(entry.data.resolution)
    if (entry.data.aspectRatio) meta.push(entry.data.aspectRatio)
  } else if (entry.kind === 'video') {
    if (entry.data.resolution) meta.push(entry.data.resolution)
    if (entry.data.durationSeconds) meta.push(`${entry.data.durationSeconds}s`)
    if (entry.data.aspectRatio) meta.push(entry.data.aspectRatio)
  } else {
    if (entry.data.durationSeconds) meta.push(`${Math.round(entry.data.durationSeconds)}s`)
    meta.push(entry.data.instrumental ? 'Instrumental' : 'With lyrics')
  }

  return (
    <div className="flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.02] card-soft-shadow">
      {/* Media — fixed-width column (the larger share of the row). Landscape
          outputs keep their own 16:9-style frame (no letterbox bars) at any slider
          position; portraits follow the slider-driven aspect, growing taller as it
          moves right. */}
      <div className="relative min-w-0 flex-[3] bg-black light:bg-[#EAEAEC]" style={{ aspectRatio: frameAspect }}>
        {entry.kind === 'music' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/[0.04]">
            <MusicIcon className="h-8 w-8 text-ink-600" />
            {entry.data.title && <span className="px-4 text-center text-[12px] text-ink-400">{entry.data.title}</span>}
          </div>
        ) : status === 'ready' && url ? (
          entry.kind === 'video' ? (
            <video src={url} controls playsInline preload="metadata" className="absolute inset-0 h-full w-full object-contain" />
          ) : (
            <img
              src={url}
              alt=""
              onClick={onClickImage}
              className={`absolute inset-0 h-full w-full object-contain ${onClickImage ? 'cursor-zoom-in' : ''}`}
            />
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {status === 'loading'
              ? <Loader2 className="h-6 w-6 animate-spin text-ink-600" />
              : entry.kind === 'video' ? <Film className="h-7 w-7 text-ink-700" /> : <ImageIcon className="h-7 w-7 text-ink-700" />}
          </div>
        )}
      </div>

      {/* Side panel — the remaining quarter: model, prompt, meta, actions. Its
          content is absolutely filled so the panel contributes no intrinsic
          height — the media's aspect ratio alone drives the row height. The
          prompt scrolls within the stretched panel. */}
      <div className="relative min-w-0 flex-[1]">
        <div className="absolute inset-0 flex flex-col gap-2 py-3 pr-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-playground-500/15 px-2 py-0.5 text-[10px] font-semibold text-playground-200">{modelLabel}</span>
          {meta.map((m) => (
            <span key={m} className="rounded-full bg-ink/[0.06] px-1.5 py-0.5 text-[9px] font-medium text-ink-400">{m}</span>
          ))}
        </div>
        {prompt && (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-ink/[0.03] px-3 py-2 text-[12px] leading-relaxed text-ink-300">
            {prompt}
          </div>
        )}
        {entry.kind === 'music' && audioUrl && (
          <audio src={audioUrl} controls className="h-8 w-full" />
        )}
        {/* Canonical action order: download · save · copy · delete. */}
        <div className="flex items-center gap-1">
          <ListRowButton title="Download" onClick={onDownload}>
            <Download className="h-4 w-4" />
          </ListRowButton>
          {onSave && (
            <ListRowButton
              title={isSaved ? 'Saved to B-Rolls' : isSaving ? 'Saving…' : 'Save to B-Rolls Bank'}
              tone={isSaved ? 'saved' : 'default'}
              onClick={() => { if (!isSaved && !isSaving) onSave() }}
            >
              {isSaved ? <Check className="h-4 w-4" /> : isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
            </ListRowButton>
          )}
          {prompt && (
            <ListRowButton title="Copy prompt" onClick={onCopyPrompt}>
              <Copy className="h-4 w-4" />
            </ListRowButton>
          )}
          <TileDeleteButton variant="chrome" onDelete={onDelete} />
        </div>
        </div>
      </div>
    </div>
  )
}

// In-flight generation as a list row — placeholder + progress, matching the
// finished-row layout (2/3 media · 1/3 info) so the feed doesn't jump.
function InFlightRow({ gen, mediaAspect }: { gen: InFlightGen; mediaAspect: number }) {
  const modelLabel = getModel(gen.modelId)?.displayName ?? gen.modelId
  const Icon = gen.mode === 'image' ? ImageIcon : gen.mode === 'video' ? Film : MusicIcon
  // Match HistoryListRow: landscape gens keep a wide frame; portraits follow the
  // slider so the placeholder doesn't jump when the result lands.
  const frameAspect = frameAspectFor(gen.imageParams?.aspectRatio ?? gen.videoParams?.aspectRatio, mediaAspect)
  return (
    <div className="flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border border-playground-500/20 bg-playground-500/[0.04] card-soft-shadow">
      <div className="relative min-w-0 flex-[3]" style={{ aspectRatio: frameAspect }}>
        <GeneratingBackdrop family="playground" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Icon className="h-7 w-7 text-playground-100" />
          <GenerationProgress
            isActive
            color="bg-playground-500"
            showHelper={false}
            messageClassName="text-[11px] font-medium text-playground-100"
            messages={['Sending request...', 'Working on it...', 'Almost there...']}
            className="max-w-[220px]"
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-[1] flex-col justify-center gap-2 py-3 pr-3">
        <span className="text-[12px] font-semibold tracking-wide text-playground-200">{modelLabel}</span>
        {gen.prompt && <p className="line-clamp-4 text-[12px] leading-relaxed text-ink-400">{gen.prompt}</p>}
      </div>
    </div>
  )
}

// Round icon button for list rows — matches the grid tiles' TileButton but
// tuned for the lighter list surface.
function ListRowButton({
  children,
  onClick,
  title,
  tone = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  tone?: 'default' | 'saved'
}) {
  const toneClass = tone === 'saved'
    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300 light:text-emerald-700'
    : 'border-ink/10 bg-ink/[0.03] text-ink-300 hover:bg-ink/[0.08] hover:text-ink-100'
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${toneClass}`}
    >
      {children}
    </button>
  )
}

// ── Image tile ──────────────────────────────────────────────────

function ImageTile({
  item,
  isSaving,
  onClick,
  onSave,
  onDelete,
  onCopyPrompt,
}: {
  item: ImageHistoryItem
  isSaving: boolean
  onClick: () => void
  onSave: () => void
  onDelete: () => void
  onCopyPrompt: () => void
}) {
  const { url, status } = useAssetUrlState(item.imageUrl)
  const isSaved = !!item.linkedBRollId
  const modelLabel = getModel(item.modelId)?.displayName ?? item.modelId

  return (
    <div>
      <div
        onClick={onClick}
        className="group relative cursor-pointer overflow-hidden rounded-lg border border-ink/10 light:border-ink/5 bg-black light:bg-zinc-200 transition-all hover:border-ink/20 light:hover:border-ink/10 hover:-translate-y-px card-soft-shadow"
      >
        {status === 'ready' && url ? (
          <img src={url} alt="" className="block h-auto w-full" />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center">
            {status === 'loading'
              ? <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
              : <ImageIcon className="h-6 w-6 text-ink-700" />}
          </div>
        )}
        {/* Hover action stack — top-right vertical column, app-wide standard
            order: download · save · copy · delete. */}
        <TileActionStack>
          <TileActionButton
            title="Download"
            onClick={async (e) => {
              e.stopPropagation()
              const u = await getUrl(item.imageUrl)
              if (u) downloadImage(u, `playground-${item.id}`)
            }}
          >
            <Download className="h-4 w-4" />
          </TileActionButton>
          <TileActionButton
            title={isSaved ? 'Saved to B-Rolls' : isSaving ? 'Saving…' : 'Save to B-Rolls Bank'}
            tone={isSaved ? 'saved' : 'default'}
            onClick={(e) => { e.stopPropagation(); if (!isSaved && !isSaving) onSave() }}
          >
            {isSaved ? <Check className="h-4 w-4" /> : isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
          </TileActionButton>
          {item.prompt && (
            <TileActionButton title="Copy prompt" onClick={(e) => { e.stopPropagation(); onCopyPrompt() }}>
              <Copy className="h-4 w-4" />
            </TileActionButton>
          )}
          <TileDeleteButton onDelete={onDelete} />
        </TileActionStack>
      </div>
      {modelLabel && (
        <p className="mt-1 truncate text-center text-[10px] font-medium tracking-wider text-ink-500">
          {modelLabel}
        </p>
      )}
    </div>
  )
}

// ── Video tile ──────────────────────────────────────────────────

function VideoTile({
  item,
  onClick,
  onDelete,
  onCopyPrompt,
}: {
  item: VideoHistoryItem
  onClick: () => void
  onDelete: () => void
  onCopyPrompt: () => void
}) {
  const { url, status } = useAssetUrlState(item.videoUrl)
  const videoElRef = useRef<HTMLVideoElement>(null)
  const [hovering, setHovering] = useState(false)
  const [playing, setPlaying] = useState(false)
  // Hover-autoplay must stay muted (browsers block unmuted autoplay), but an
  // explicit Play click is a user gesture and should play in place with sound.
  const [unmuted, setUnmuted] = useState(false)
  const ratio = aspectStyle(item.aspectRatio)
  const modelLabel = getModel(item.modelId)?.displayName ?? item.modelId

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    const v = videoElRef.current
    if (!v) return
    if (v.paused) {
      // Explicit play → unmute so the clip is watchable right here in the grid.
      setUnmuted(true)
      v.muted = false
      v.play().catch(() => {})
    } else {
      v.pause()
    }
  }

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation()
    const v = videoElRef.current
    setUnmuted((prev) => {
      const next = !prev
      if (v) v.muted = !next
      return next
    })
  }

  return (
    <div>
      <div
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={onClick}
        className="group relative cursor-pointer overflow-hidden rounded-lg border border-ink/10 light:border-ink/5 bg-black light:bg-zinc-200 transition-all hover:border-ink/20 light:hover:border-ink/10 hover:-translate-y-px card-soft-shadow"
        style={ratio}
      >
        {status === 'ready' && url ? (
          <video
            ref={videoElRef}
            src={url}
            muted={!unmuted}
            loop
            playsInline
            autoPlay={hovering}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {status === 'loading'
              ? <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
              : <Film className="h-6 w-6 text-ink-700" />}
          </div>
        )}

        {/* Click-to-play overlay (top-left). Play shows when paused; Pause shows
            while playing + hovering. stopPropagation lets the user watch the clip
            in place without opening the lightbox. */}
        {url && !playing && (
          <button
            type="button"
            title="Play"
            onClick={togglePlay}
            className="absolute left-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
          >
            <Play className="h-3.5 w-3.5 fill-white text-white" />
          </button>
        )}
        {url && playing && hovering && (
          <button
            type="button"
            title="Pause"
            onClick={togglePlay}
            className="absolute left-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
          >
            <Pause className="h-3.5 w-3.5 fill-white text-white" />
          </button>
        )}
        {url && (hovering || unmuted) && (
          <button
            type="button"
            title={unmuted ? 'Mute' : 'Unmute'}
            onClick={toggleMute}
            className="absolute left-11 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
          >
            {unmuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>
        )}

        {/* Hover action stack — top-right vertical column, app-wide standard
            order: download · copy · delete (video has no save-to-bank). */}
        <TileActionStack>
          <TileActionButton
            title="Download"
            onClick={async (e) => {
              e.stopPropagation()
              const u = await getUrl(item.videoUrl)
              if (u) downloadImage(u, `playground-${item.id}`, 'mp4')
            }}
          >
            <Download className="h-4 w-4" />
          </TileActionButton>
          {item.prompt && (
            <TileActionButton title="Copy prompt" onClick={(e) => { e.stopPropagation(); onCopyPrompt() }}>
              <Copy className="h-4 w-4" />
            </TileActionButton>
          )}
          <TileDeleteButton onDelete={onDelete} />
        </TileActionStack>
      </div>
      {modelLabel && (
        <p className="mt-1 truncate text-center text-[10px] font-medium tracking-wider text-ink-500">
          {modelLabel}
        </p>
      )}
    </div>
  )
}

// ── In-flight tile ──────────────────────────────────────────────

function InFlightTile({ gen }: { gen: InFlightGen }) {
  const modelLabel = getModel(gen.modelId)?.displayName ?? gen.modelId

  const Icon =
    gen.mode === 'image' ? ImageIcon
    : gen.mode === 'video' ? Film
    : MusicIcon

  // Shape the placeholder to match the image/video that's coming so the grid
  // doesn't jump when the result lands. Music has no aspect — keep it square.
  const ar = gen.imageParams?.aspectRatio ?? gen.videoParams?.aspectRatio

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-playground-500/20"
      style={ar ? aspectStyle(ar) : { aspectRatio: '1 / 1' }}
    >
      <GeneratingBackdrop family="playground" />
      {/* Mode glyph, top-left — mirrors the reference framing. */}
      <div className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/25 text-playground-100 backdrop-blur-sm">
        <Icon className="h-4 w-4" />
      </div>
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-[11px] font-medium text-playground-100">{modelLabel}</p>
        <GenerationProgress
          isActive
          color="bg-playground-500"
          showHelper={false}
          messageClassName="text-[11px] font-medium text-playground-100"
          messages={
            gen.mode === 'image'
              ? [
                  'Sending request...',
                  'Composing the scene...',
                  'Rendering details...',
                  'Finalizing the frame...',
                ]
              : gen.mode === 'video'
              ? [
                  'Sending request...',
                  'Storyboarding frames...',
                  'Rendering motion...',
                  'Finalizing the clip...',
                ]
              : [
                  'Sending request...',
                  'Composing the melody...',
                  'Mixing the track...',
                  'Mastering the audio...',
                ]
          }
          className="max-w-[180px]"
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6">
        <p className="line-clamp-2 text-[10px] text-zinc-300">{gen.prompt}</p>
      </div>
    </div>
  )
}

// ── Preview modal ───────────────────────────────────────────────

// Centered lightbox for the clicked tile. Esc + click-the-backdrop closes.
// Action cluster (Save / Download / Trash / Close) sits top-right. Prompt
// area is scrollable so a long prompt never pushes the media off-screen.
function PreviewModal({
  entry,
  onClose,
  onSave,
  isSaving,
}: {
  entry: HistoryEntry
  onClose: () => void
  onSave: () => void
  isSaving: boolean
}) {
  const imageUrl = useAssetUrl(entry.kind === 'image' ? entry.data.imageUrl : null)
  const videoUrl = useAssetUrl(entry.kind === 'video' ? entry.data.videoUrl : null)
  const addToast = useAppStore((s) => s.addToast)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const prompt = entry.kind === 'image' || entry.kind === 'video' ? entry.data.prompt : ''
  // Video previews lay out side-by-side (clip left, prompt + actions + frames
  // in a column to the right); images stay stacked.
  const isVideo = entry.kind === 'video' && !!videoUrl
  // Already-saved entries link a B-Roll id; show a tick instead of the bookmark.
  const linked =
    entry.kind === 'image'
      ? !!entry.data.linkedBRollId
      : entry.kind === 'video'
      ? !!entry.data.linkedBRollId
      : false

  async function handleDownload() {
    const url = entry.kind === 'image' ? imageUrl : videoUrl
    if (!url) return
    await downloadImage(url, `playground-${entry.data.id}`, entry.kind === 'image' ? 'png' : 'mp4')
  }

  async function handleCopyPrompt() {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      addToast('Could not copy the prompt', 'error')
    }
  }

  // The bar is glassmorphic + lives in the playground tree, but the modal
  // needs to overlay EVERYTHING — including the prompt bar. We use `fixed`
  // at the top of the stack with z-[60]. A scrim above the prompt bar
  // (z-50) is enough since the bar isn't capturing pointer events outside
  // its `pointer-events-auto` inner div.
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Top-right holds only Close now — Save + Download moved down to
          labeled buttons beside Copy prompt. Delete lives on the grid tile. */}
      <div
        className="absolute right-4 top-4 z-10 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalActionButton title="Close" onClick={onClose}>
          <X className="h-4 w-4" />
        </ModalActionButton>
      </div>

      {/* Centered content — media gets the upper space, prompt block sits
          underneath with its own scroll so long prompts never push the
          media off-screen. Only the media + prompt block swallow clicks;
          anywhere else inside the wrapper bubbles up to the backdrop and
          closes the modal. The media element shrinks to the image's real
          rendered size (max-h/max-w in a centered flex box), so the border
          hugs the picture — no letterbox bars. */}
      <div
        className={
          isVideo
            ? 'mx-auto flex h-full w-full max-w-6xl flex-row items-center justify-center gap-8 overflow-hidden px-6 py-16'
            : 'mx-auto flex h-full w-full max-w-5xl flex-col items-center justify-center gap-4 overflow-hidden px-6 py-16'
        }
      >
        {entry.kind === 'image' && imageUrl && (
          <div className="flex min-h-0 w-full flex-1 items-center justify-center">
            <img
              src={imageUrl}
              alt=""
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full rounded-xl border border-white/10 object-contain"
            />
          </div>
        )}
        {entry.kind === 'video' && videoUrl && (
          <div className="flex min-h-0 w-full flex-1 items-center justify-center">
            <video
              src={videoUrl}
              controls
              autoPlay
              loop
              onClick={(e) => e.stopPropagation()}
              className="max-h-[72vh] max-w-full rounded-xl border border-white/10 object-contain"
            />
          </div>
        )}

        <div
          onClick={(e) => e.stopPropagation()}
          className={
            isVideo
              ? 'flex h-full w-[380px] shrink-0 flex-col items-center justify-center gap-4 overflow-y-auto py-4'
              : 'flex w-full max-w-2xl shrink-0 flex-col items-center gap-3'
          }
        >
          {/* Frame grabs sit at the top of the side column — pull the first/last
              still out of the clip to reuse as a start frame / reference (save to
              bank) or keep (download). */}
          {entry.kind === 'video' && videoUrl && (
            <VideoFrameActions videoUrl={videoUrl} prompt={prompt} videoId={entry.data.id} aspectRatio={entry.data.aspectRatio} />
          )}
          {prompt && (
            <div className="max-h-[18vh] w-full overflow-y-auto rounded-lg bg-white/[0.02] px-4 py-3 text-center text-[12px] leading-relaxed text-zinc-400">
              {prompt}
            </div>
          )}
          {/* Primary actions — labeled pills. "Copy prompt" copies the prompt
              text to the clipboard. */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {prompt && (
              <ModalBarButton onClick={handleCopyPrompt} tone={copied ? 'saved' : 'accent'}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied ? 'Copied' : 'Copy prompt'}</span>
              </ModalBarButton>
            )}
            {/* Save-to-bank is stills-only — videos are download-only. */}
            {entry.kind === 'image' && (
              <ModalBarButton
                onClick={onSave}
                disabled={linked || isSaving}
                tone={linked ? 'saved' : 'default'}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : linked ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                <span>{linked ? 'Saved to Bank' : 'Save to Bank'}</span>
              </ModalBarButton>
            )}
            <ModalBarButton onClick={handleDownload}>
              <Download className="h-4 w-4" />
              <span>{entry.kind === 'video' ? 'Download Video' : 'Download Image'}</span>
            </ModalBarButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Video frame grabs ───────────────────────────────────────────

function VideoFrameActions({ videoUrl, prompt, videoId, aspectRatio }: { videoUrl: string; prompt: string; videoId: string; aspectRatio?: string }) {
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Frames</span>
      <div className="grid w-full grid-cols-2 items-start gap-2.5">
        <FrameCard label="First frame" position="first" videoUrl={videoUrl} prompt={prompt} videoId={videoId} aspectRatio={aspectRatio} />
        <FrameCard label="Last frame" position="last" videoUrl={videoUrl} prompt={prompt} videoId={videoId} aspectRatio={aspectRatio} />
      </div>
    </div>
  )
}

function FrameCard({
  label,
  position,
  videoUrl,
  prompt,
  videoId,
  aspectRatio,
}: {
  label: string
  position: 'first' | 'last'
  videoUrl: string
  prompt: string
  videoId: string
  aspectRatio?: string
}) {
  const addBRoll = useBankStore((s) => s.addBRoll)
  const addToast = useAppStore((s) => s.addToast)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // The thumbnail box matches the frame's real aspect ratio. Seed it from the
  // video's declared ratio (so there's no layout shift while the frame loads),
  // then refine from the decoded image's actual dimensions on load.
  const [ratio, setRatio] = useState<React.CSSProperties>(
    aspectRatio ? aspectStyle(aspectRatio) : { aspectRatio: '9 / 16' },
  )

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setStatus('loading')
    extractVideoFrame(videoUrl, position)
      .then((b) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(b)
        setBlob(b)
        setThumbUrl(objectUrl)
        setStatus('ready')
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [videoUrl, position])

  async function handleSave() {
    if (!blob || saving || saved) return
    setSaving(true)
    try {
      const id = await saveAsset(blob, 'image/png')
      await addBRoll({ imageUrl: id, prompt, sourceApp: 'playground' })
      setSaved(true)
    } catch {
      addToast('Could not save the frame', 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleDownload() {
    if (!thumbUrl) return
    void downloadImage(thumbUrl, `playground-${videoId}-${position}-frame`, 'png')
  }

  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2.5">
      <div
        style={ratio}
        className="flex w-full items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40"
      >
        {status === 'ready' && thumbUrl ? (
          <img
            src={thumbUrl}
            alt={`${label} preview`}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget
              if (w && h) setRatio({ aspectRatio: `${w} / ${h}` })
            }}
            className="h-full w-full object-cover"
          />
        ) : status === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        ) : (
          <Film className="h-5 w-5 text-zinc-600" />
        )}
      </div>
      <span className="text-[11px] font-medium text-zinc-300">{label}</span>
      <div className="flex w-full flex-col gap-1.5">
        <FrameButton
          className="w-full justify-center"
          title={saved ? 'Saved to B-Rolls' : 'Save to Bank'}
          disabled={status !== 'ready' || saving || saved}
          tone={saved ? 'saved' : 'default'}
          onClick={handleSave}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          <span>{saved ? 'Saved' : 'Save'}</span>
        </FrameButton>
        <FrameButton className="w-full justify-center" title="Download frame" disabled={status !== 'ready'} onClick={handleDownload}>
          <Download className="h-4 w-4" />
          <span>Download</span>
        </FrameButton>
      </div>
    </div>
  )
}

function FrameButton({
  children,
  onClick,
  title,
  disabled,
  tone = 'default',
  className = '',
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
  tone?: 'default' | 'saved'
  className?: string
}) {
  const toneClass = tone === 'saved'
    ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200'
    : 'border-white/15 bg-white/[0.06] text-zinc-100 hover:bg-white/[0.12]'
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClass} ${className}`}
    >
      {children}
    </button>
  )
}

function ModalActionButton({
  children,
  onClick,
  title,
  disabled,
  tone = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
  tone?: 'default' | 'saved' | 'danger'
}) {
  const toneClass = tone === 'saved'
    ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
    : tone === 'danger'
    ? 'border-white/15 bg-black/40 text-zinc-200 hover:bg-red-500/30 hover:text-red-200 hover:border-red-500/40'
    : 'border-white/15 bg-black/40 text-white hover:bg-black/60'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      {children}
    </button>
  )
}

// Labeled action pill for the preview modal's bottom bar — thicker/bigger
// than the corner icon buttons so Save / Download / Copy read clearly.
function ModalBarButton({
  children,
  onClick,
  disabled,
  tone = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'saved' | 'accent'
}) {
  const toneClass = tone === 'saved'
    ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
    : tone === 'accent'
    ? 'border-playground-500/40 bg-playground-500/20 text-playground-100 hover:bg-playground-500/30'
    : 'border-white/15 bg-white/[0.06] text-zinc-100 hover:bg-white/[0.12]'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-full border px-5 py-3 text-[13px] font-semibold tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      {children}
    </button>
  )
}

// ── Shared bits ─────────────────────────────────────────────────

function aspectStyle(ar: string): React.CSSProperties {
  const [w, h] = ar.split(':').map(Number)
  if (!w || !h) return { aspectRatio: '9 / 16' }
  return { aspectRatio: `${w} / ${h}` }
}

// Landscape (wider-than-tall) outputs claim two grid columns so the wide frame
// is readable instead of squeezed into a single square-width column.
function isLandscape(ar: string): boolean {
  const [w, h] = ar.split(':').map(Number)
  return !!w && !!h && w > h
}

// List-view media frame aspect. Landscape outputs always render in their own
// (wider) aspect ratio so they fill edge-to-edge with no letterbox bars, whatever
// the slider is set to. Portrait/square (and music, which has no ratio) follow the
// slider-driven `mediaAspect` — taller as it moves right.
function frameAspectFor(ar: string | null | undefined, mediaAspect: number): number {
  if (!ar) return mediaAspect
  const [w, h] = ar.split(':').map(Number)
  if (w && h && w > h) return w / h
  return mediaAspect
}
