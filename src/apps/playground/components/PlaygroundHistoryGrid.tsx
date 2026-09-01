import { memo, useMemo, useRef, useState, useEffect } from 'react'
import { ArrowLeft,
  Download, Bookmark, Check, Film, Image as ImageIcon, Music as MusicIcon, Play, Pause, Volume2, VolumeX, X, ImagePlay, Copy, LayoutGrid, List, Maximize2,
} from 'lucide-react'
import Spinner from '../../../components/Spinner'
import { useBankStore } from '../../../stores/bankStore'
import { useAssetUrlState, useAssetUrl } from '../../../hooks/useAssetUrl'
import { useInlineVideo, useExclusiveVideo } from '../../../hooks/useInlineVideo'
import { useAppStore } from '../../../stores/appStore'
import { getUrl } from '../../../utils/assetStore'
import { VideoFrameActions } from '../../../components/VideoLightbox'
import { getModel } from '../../../utils/models'
import { usePersistedState } from '../../../hooks/usePersistedState'
import { sectionLabel, groupByDay } from '../../../utils/history'
import { downloadImage } from '../../../utils/downloadImage'
import type { ImageHistoryItem, VideoHistoryItem, MusicHistoryItem } from '../../../stores/types'
import AudioTile, { MusicArtwork, MusicWaveStrip } from './AudioTile'
import { useAudioPlayback } from '../../../hooks/useAudioPlayback'
import GenerationProgress from '../../../components/GenerationProgress'
import { TileActionStack, TileActionButton, TileDeleteButton } from '../../../components/tileActions'
import DayPill from '../../../components/DayPill'
import ModelPill from '../../../components/ModelPill'
import GeneratingBackdrop from '../../../components/GeneratingBackdrop'
import SegmentedToggle from '../../../components/SegmentedToggle'
import type { PlaygroundMode, InFlightGen } from '../types'
import { humanizeError } from '../../../utils/friendlyError'
import { useBackdropClose } from '../../../hooks/useBackdropClose'
import useNearViewport from '../../../hooks/useNearViewport'
import { useVideoPoster } from '../../../hooks/useVideoPoster'
import { useThumbUrl } from '../../../hooks/useThumbUrl'
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
  // Carry a finished still over to the Video tab as its start frame, with the
  // prompt that made it. Omitted → the Animate action is hidden.
  onAnimateImage?: (item: ImageHistoryItem) => void
  // Put this generation's prompt back in the prompt box, replacing what's
  // there. Threaded to every card shape rather than lifted onto one, because
  // the grid, the list and the preview modal are three different action rows.
  onReusePrompt?: (prompt: string) => void
}

// Memoized: this grid renders every generation the member has ever made (the
// history banks are uncapped), and it sits beside the prompt bar. Without the
// bail-out, typing one character re-rendered the whole list — hundreds of rows,
// each with an asset lookup and its own hover machinery. Its three props are
// all stable while typing, so the subtree is skipped entirely.
//
// Keep them stable: `onAnimateImage` is wrapped in useCallback by the parent.
export default memo(function PlaygroundHistoryGrid({ inFlight, filterMode, onAnimateImage, onReusePrompt }: PlaygroundHistoryGridProps) {
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

  // No zip picker here. B-Roll keeps one because its list is ONE storyboard —
  // a finite set of takes you export together as an edit. Playground's is every
  // clip the member has ever generated, which is a reel to scroll, not a
  // deliverable to package; every tile already downloads in one tap from its own
  // hover stack. `ClipDownloadModal` still lives in `src/components/` for
  // B-Roll's two modes.
  // The scroller every tile observes itself against — see hooks/useNearViewport.
  // This list is uncapped, so without it a member with a few dozen clips paid
  // for every one of them (a blob read each, a decoder each) on mount.
  const scrollRef = useRef<HTMLDivElement | null>(null)

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

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {visibleInFlight.length > 0 && (
          <>
            <DayPill label="In progress" className="my-5" />
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
            <DayPill label={sectionLabel(dayTs)} className="my-5" />
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
                        scrollRoot={scrollRef}
                        onClick={() => setPreviewItem(entry)}
                        onSave={() => handleSaveImage(entry.data)}
                        onDelete={() => deleteImageHistory(entry.data.id)}
                        onCopyPrompt={() => handleCopyPrompt(entry.data.prompt)}
                        onReuse={onReusePrompt && entry.data.prompt ? () => onReusePrompt(entry.data.prompt) : undefined}
                        onAnimate={onAnimateImage ? () => onAnimateImage(entry.data) : undefined}
                      />
                    )}
                    {entry.kind === 'video' && (
                      <VideoTile
                        item={entry.data}
                        scrollRoot={scrollRef}
                        onClick={() => setPreviewItem(entry)}
                        onDelete={() => deleteVideoHistory(entry.data.id)}
                        onCopyPrompt={() => handleCopyPrompt(entry.data.prompt)}
                        onReuse={onReusePrompt && entry.data.prompt ? () => onReusePrompt(entry.data.prompt) : undefined}
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
                        onReuse={onReusePrompt && entry.data.prompt ? () => onReusePrompt(entry.data.prompt) : undefined}
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
                    scrollRoot={scrollRef}
                    onClickImage={entry.kind === 'image' ? () => setPreviewItem(entry) : undefined}
                    onCopyPrompt={() => handleCopyPrompt(entry.data.prompt)}
                    onReuse={onReusePrompt && entry.data.prompt ? () => onReusePrompt(entry.data.prompt) : undefined}
                    onSave={entry.kind === 'image' ? () => handleSaveImage(entry.data) : undefined}
                    onAnimate={entry.kind === 'image' && onAnimateImage ? () => onAnimateImage(entry.data) : undefined}
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
          onAnimate={
            previewItem.kind === 'image' && onAnimateImage
              ? () => onAnimateImage(previewItem.data)
              : undefined
          }
          onReuse={onReusePrompt && previewItem.data.prompt ? () => onReusePrompt(previewItem.data.prompt) : undefined}
        />
      )}
    </div>
  )
})

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
  scrollRoot,
  onClickImage,
  onCopyPrompt,
  onReuse,
  onSave,
  onDownload,
  onDelete,
  onAnimate,
}: {
  entry: HistoryEntry
  mediaAspect: number
  isSaving: boolean
  scrollRoot: React.RefObject<HTMLElement | null>
  onClickImage?: () => void
  onCopyPrompt: () => void
  onReuse?: () => void
  onSave?: () => void
  onDownload: () => void
  onDelete: () => void
  onAnimate?: () => void
}) {
  // The row's media loads once the row is near the window — see the note on
  // `scrollRef` above. Everything else about the row renders regardless.
  // A clip keeps releasing its decoder; a still holds what it loaded, since
  // re-reading it costs nothing and un-painting it costs a black row on the way
  // back up. See useNearViewport.
  const { ref: rowRef, near } = useNearViewport<HTMLDivElement>(scrollRoot, undefined, { release: entry.kind === 'video' })
  // A still is drawn from a thumbnail sized to the media column (see
  // hooks/useThumbUrl); a clip is the clip. The row element is what's measured
  // — the media column is a fixed share of it.
  const still = useThumbUrl(near && entry.kind === 'image' ? entry.data.imageUrl : null, rowRef)
  const clip = useAssetUrlState(near && entry.kind === 'video' ? entry.data.videoUrl : null)
  const { url, status } = entry.kind === 'image' ? still : clip
  const { poster, posterProps } = useVideoPoster()
  // Music rows play from their own artwork, with the waveform under the prompt
  // — the same transport the grid tile and Voiceovers' history cards use.
  const coverUrl = useAssetUrl(entry.kind === 'music' ? entry.data.coverImageRef ?? null : null)
  const musicPlayer = useAudioPlayback(
    entry.kind === 'music' ? entry.data.audioRef : null,
    entry.kind === 'music' ? entry.data.durationSeconds ?? 0 : 0,
  )
  // Native controls here, but the same one-clip-at-a-time rule as the tiles.
  const rowVideo = useExclusiveVideo()
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
    // Instrumental is a chip on the artwork already — the pills carry what it
    // doesn't say.
    if (entry.data.durationSeconds) meta.push(`${Math.round(entry.data.durationSeconds)}s`)
    else if (musicPlayer.duration > 0) meta.push(`${Math.round(musicPlayer.duration)}s`)
    if (!entry.data.instrumental) meta.push('With lyrics')
  }

  return (
    <div ref={rowRef} className="flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.02] card-soft-shadow">
      {/* Media — fixed-width column (the larger share of the row). Landscape
          outputs keep their own 16:9-style frame (no letterbox bars) at any slider
          position; portraits follow the slider-driven aspect, growing taller as it
          moves right. */}
      <div className="relative min-w-0 flex-[3] bg-black light:bg-[#EAEAEC]" style={{ aspectRatio: frameAspect }}>
        {entry.kind === 'music' ? (
          <MusicArtwork
            coverUrl={coverUrl}
            instrumental={entry.data.instrumental}
            isPlaying={musicPlayer.isPlaying}
            onToggle={musicPlayer.toggle}
            className="absolute inset-0"
          />
        ) : status === 'ready' && url ? (
          entry.kind === 'video' ? (
            // `#t=0.1` is load-bearing, not decoration: with `preload="metadata"`
            // Safari fetches the duration and dimensions but decodes no frame, so
            // the element painted as an empty black box — the clip was there and
            // invisible until you pressed play, while the grid tiles (which
            // autoplay muted on hover) looked fine. The media fragment makes it
            // seek to 0.1s, which forces that frame to decode and show. Same fix
            // as B-Roll's history CoverTile.
            <video
              {...rowVideo}
              src={`${url}#t=0.1`}
              {...posterProps}
              poster={poster}
              controls
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            <img
              src={url}
              alt=""
              loading="lazy"
              decoding="async"
              onClick={onClickImage}
              className={`absolute inset-0 h-full w-full object-contain ${onClickImage ? 'cursor-zoom-in' : ''}`}
            />
          )
        ) : poster ? (
          <img src={poster} alt="" className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {status === 'loading'
              ? <Spinner className="h-6 w-6 text-ink-600" />
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
        {/* Which model made this, on its own line above the meta pills — the
            same reading order Characters' list row uses, so a row looks the
            same across the two apps. Hidden when generation info is off. */}
        <ModelPill modelId={entry.data.modelId} className="self-start" />
        {entry.kind === 'music' && entry.data.title && (
          <p className="truncate text-[13px] font-semibold text-ink-100">{entry.data.title}</p>
        )}
        {meta.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {meta.map((m) => (
              <span key={m} className="rounded-full bg-ink/[0.06] px-1.5 py-0.5 text-[9px] font-medium text-ink-400">{m}</span>
            ))}
          </div>
        )}
        {prompt && (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-ink/[0.03] px-3 py-2 text-[12px] leading-relaxed text-ink-300">
            {prompt}
          </div>
        )}
        {entry.kind === 'music' && <MusicWaveStrip player={musicPlayer} className="shrink-0" />}
        {/* Canonical action order: download · save · copy · [reuse] · [animate] · delete. */}
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
              {isSaved ? <Check className="h-4 w-4" /> : isSaving ? <Spinner className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            </ListRowButton>
          )}
          {prompt && (
            <ListRowButton title="Copy prompt" onClick={onCopyPrompt}>
              <Copy className="h-4 w-4" />
            </ListRowButton>
          )}
          {onReuse && (
            <ListRowButton title="Reuse this prompt" onClick={onReuse}>
              <ArrowLeft className="h-4 w-4" />
            </ListRowButton>
          )}
          {onAnimate && (
            <ListRowButton title="Animate in Video" onClick={onAnimate}>
              <ImagePlay className="h-4 w-4" />
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
  scrollRoot,
  onClick,
  onSave,
  onDelete,
  onCopyPrompt,
  onReuse,
  onAnimate,
}: {
  item: ImageHistoryItem
  isSaving: boolean
  scrollRoot: React.RefObject<HTMLElement | null>
  onClick: () => void
  onSave: () => void
  onDelete: () => void
  onCopyPrompt: () => void
  onReuse?: () => void
  onAnimate?: () => void
}) {
  // `loading="lazy"` only defers the <img> — the blob behind it still came out
  // of IndexedDB for every tile in the list. This defers the read itself. It
  // never gives the picture back: a still holds no decoder, its blob read and
  // object URL are cached for good the moment it resolves, and this tile is
  // sized by the picture — so dropping one on the way past would resize a tile
  // ABOVE the scroll position and shove the grid around under the pointer.
  // See useNearViewport.
  const { ref: tileRef, near } = useNearViewport<HTMLDivElement>(scrollRoot)
  // …and what it loads is a thumbnail sized to this tile, not the still the
  // model returned: a 4K picture is 36 MB decoded whatever size it's drawn at,
  // and a gallery of them is what made scrolling hitch. The full picture is
  // still what the preview modal, Download and Save read. See utils/thumbStore.
  const { url, status } = useThumbUrl(near ? item.imageUrl : null, tileRef)
  const isSaved = !!item.linkedBRollId

  return (
      <div
        ref={tileRef}
        onClick={onClick}
        className="group relative cursor-pointer overflow-hidden rounded-lg border border-ink/10 light:border-ink/5 bg-black light:bg-zinc-200 transition-all hover:border-ink/20 light:hover:border-ink/10 hover:-translate-y-px card-soft-shadow"
      >
        {status === 'ready' && url ? (
          <img src={url} alt="" loading="lazy" decoding="async" className="block h-auto w-full" />
        ) : (
          // Shaped like the picture that's coming, not square: a tile whose
          // media loads on scroll would otherwise resize under the pointer and
          // shove the rest of the column around as it goes.
          <div className="flex w-full items-center justify-center" style={aspectStyle(item.aspectRatio)}>
            {status === 'loading'
              ? <Spinner className="h-5 w-5 text-ink-500" />
              : <ImageIcon className="h-6 w-6 text-ink-700" />}
          </div>
        )}
        {/* Hover action stack — top-right vertical column, app-wide standard
            order: download · save · copy · [animate] · delete. */}
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
            {isSaved ? <Check className="h-4 w-4" /> : isSaving ? <Spinner className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          </TileActionButton>
          {item.prompt && (
            <TileActionButton title="Copy prompt" onClick={(e) => { e.stopPropagation(); onCopyPrompt() }}>
              <Copy className="h-4 w-4" />
            </TileActionButton>
          )}
          {/* Reuse — put this prompt back in the box, replacing what's
              there. It sits right after Copy prompt because the two are
              siblings: one hands the words to the clipboard, the other hands
              them straight back to the field, which is what you actually
              wanted every time you copied one. The arrow points LEFT, at the
              panel the prompt is going to. */}
          {onReuse && (
            <TileActionButton title="Reuse this prompt" onClick={(e) => { e.stopPropagation(); onReuse() }}>
              <ArrowLeft className="h-4 w-4" />
            </TileActionButton>
          )}
          {onAnimate && (
            <TileActionButton
              title="Animate in Video"
              onClick={(e) => { e.stopPropagation(); onAnimate() }}
            >
              <ImagePlay className="h-4 w-4" />
            </TileActionButton>
          )}
          <TileDeleteButton onDelete={onDelete} />
        </TileActionStack>
      </div>
  )
}

// ── Video tile ──────────────────────────────────────────────────

function VideoTile({
  item,
  scrollRoot,
  onClick,
  onDelete,
  onCopyPrompt,
  onReuse,
}: {
  item: VideoHistoryItem
  scrollRoot: React.RefObject<HTMLElement | null>
  onClick: () => void
  onDelete: () => void
  onCopyPrompt: () => void
  onReuse?: () => void
}) {
  // Off-window tiles hold no clip: a <video> each is a blob in memory and a
  // decoder, and the browser runs out of the second long before this list does.
  // Safe to release where a still isn't, because the frame below is sized by
  // the tile's own aspect ratio and so keeps its height either way.
  const { ref: tileRef, near } = useNearViewport<HTMLDivElement>(scrollRoot, undefined, { release: true })
  const { url, status } = useAssetUrlState(near ? item.videoUrl : null)
  // …but it keeps the frame. Handing the decoder back is what makes the grid
  // survive sixty clips; painting nothing until the next one is built is what
  // made scrolling back up look like a reload.
  const { poster, posterProps } = useVideoPoster()
  // Hover-autoplay must stay muted (browsers block unmuted autoplay), but an
  // explicit Play click is a user gesture and plays in place with sound — and
  // stops whatever clip was playing elsewhere in the app.
  const inline = useInlineVideo()
  const { hovering, unmuted, togglePlay, toggleMute } = inline
  const ratio = aspectStyle(item.aspectRatio)

  return (
      <div
        ref={tileRef}
        {...inline.hoverProps}
        onClick={onClick}
        className="group relative cursor-pointer overflow-hidden rounded-lg border border-ink/10 light:border-ink/5 bg-black light:bg-zinc-200 transition-all hover:border-ink/20 light:hover:border-ink/10 hover:-translate-y-px card-soft-shadow"
        style={ratio}
      >
        {status === 'ready' && url ? (
          // `#t=0.1` for the same reason the list row carries it: with
          // `preload="metadata"` Safari decodes no frame, so a tile nobody has
          // hovered paints as an empty black box. It is also what makes the
          // frame readable back off a canvas — see hooks/useVideoPoster.
          <video
            {...inline.videoProps}
            {...posterProps}
            src={`${url}#t=0.1`}
            poster={poster}
            className="h-full w-full object-cover"
          />
        ) : poster ? (
          <img src={poster} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {status === 'loading'
              ? <Spinner className="h-5 w-5 text-ink-500" />
              : <Film className="h-6 w-6 text-ink-700" />}
          </div>
        )}

        {/* Click-to-play overlay (top-left) — always on the tile, so a clip
            playing with sound can still be paused once the pointer has moved
            off it. stopPropagation lets the user watch the clip in place
            without opening the lightbox. */}
        {url && (
          <button
            type="button"
            title={inline.watching ? 'Pause' : 'Play with sound'}
            onClick={togglePlay}
            className="absolute left-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80"
          >
            {inline.watching ? <Pause className="h-3.5 w-3.5 fill-white text-white" /> : <Play className="h-3.5 w-3.5 fill-white text-white" />}
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
            order: download · copy · delete (video has no save-to-bank). It
            deliberately does NOT step aside while the clip plays with sound:
            watching a take is exactly when you decide to keep it, and having
            Download / Copy prompt / Delete vanish under the pointer meant
            pausing first to reach them. It sits top-right, clear of the
            play/pause and mute buttons on the left, and only fades in on
            hover — so it never covers a clip you're just watching. */}
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
          {onReuse && (
            <TileActionButton title="Reuse this prompt" onClick={(e) => { e.stopPropagation(); onReuse() }}>
              <ArrowLeft className="h-4 w-4" />
            </TileActionButton>
          )}
          <TileDeleteButton onDelete={onDelete} />
        </TileActionStack>
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
      <div className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/30 text-playground-100">
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
  onAnimate,
  onReuse,
}: {
  entry: HistoryEntry
  onClose: () => void
  onSave: () => void
  isSaving: boolean
  onAnimate?: () => void
  onReuse?: () => void
}) {
  const imageUrl = useAssetUrl(entry.kind === 'image' ? entry.data.imageUrl : null)
  const videoUrl = useAssetUrl(entry.kind === 'video' ? entry.data.videoUrl : null)
  const addToast = useAppStore((s) => s.addToast)
  const [copied, setCopied] = useState(false)
  const backdrop = useBackdropClose(onClose)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const prompt = entry.kind === 'image' || entry.kind === 'video' ? entry.data.prompt : ''
  // Video previews lay out side-by-side FROM `md` (clip left, prompt + actions
  // + frames in a column to the right) and stack below it; images stay stacked
  // at every width.
  const isVideo = entry.kind === 'video' && !!videoUrl
  const lightboxVideo = useExclusiveVideo()
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
      {...backdrop}
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
            // The side column is a fixed 380px and `shrink-0`, which on a 375px
            // phone claimed the whole row and squeezed the clip — the thing the
            // modal is for — into a sliver against the left edge. Below `md` the
            // two stack and the wrapper scrolls: clip first at its own size,
            // then the frames, the prompt and the actions under it.
            ? 'mx-auto flex h-full w-full max-w-6xl flex-col items-center justify-start gap-4 overflow-y-auto px-4 py-14 md:flex-row md:justify-center md:gap-8 md:overflow-hidden md:px-6 md:py-16'
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
          <div className="flex min-h-0 w-full flex-1 items-center justify-center max-md:flex-none">
            {/* Autoplays with sound, so it claims the app-wide playback slot
                — opening the lightbox stops whatever tile was playing. */}
            <video
              {...lightboxVideo}
              src={videoUrl}
              controls
              autoPlay
              loop
              onClick={(e) => e.stopPropagation()}
              className="max-h-[52vh] max-w-full rounded-xl border border-white/10 object-contain md:max-h-[72vh]"
            />
          </div>
        )}

        <div
          onClick={(e) => e.stopPropagation()}
          className={
            isVideo
              ? 'flex w-full shrink-0 flex-col items-center gap-4 md:h-full md:w-[380px] md:justify-center md:overflow-y-auto md:py-4'
              : 'flex w-full max-w-2xl shrink-0 flex-col items-center gap-3'
          }
        >
          {/* Frame grabs sit at the top of the side column — pull the first/last
              still out of the clip to reuse as a start frame / reference (save to
              bank) or keep (download). */}
          {entry.kind === 'video' && videoUrl && (
            <VideoFrameActions
              videoUrl={videoUrl}
              prompt={prompt}
              fileStem={`playground-${entry.data.id}`}
              aspectRatio={entry.data.aspectRatio}
              sourceApp="playground"
            />
          )}
          {/* Which model made this, above the prompt it was given. The `media`
              variant, not `chrome`: this modal is a literal black overlay in
              both themes, like everything else in it. */}
          <ModelPill modelId={entry.data.modelId} variant="media" className="shrink-0" />
          {prompt && (
            <div className="w-full overflow-y-auto rounded-lg bg-white/[0.02] px-4 py-3 text-center text-[12px] leading-relaxed text-zinc-400 md:max-h-[18vh]">
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
            {/* Beside Copy prompt, because this is the surface where an output
                is actually judged — "make another like this one" is the decision
                you came here to take. Closes on the way out, since what it
                changed is behind the overlay. */}
            {onReuse && (
              <ModalBarButton onClick={() => { onReuse(); onClose() }}>
                <ArrowLeft className="h-4 w-4" />
                <span>Reuse prompt</span>
              </ModalBarButton>
            )}
            {/* Save-to-bank is stills-only — videos are download-only. */}
            {entry.kind === 'image' && (
              <ModalBarButton
                onClick={onSave}
                disabled={linked || isSaving}
                tone={linked ? 'saved' : 'default'}
              >
                {isSaving ? <Spinner className="h-4 w-4" /> : linked ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                <span>{linked ? 'Saved to Bank' : 'Save to Bank'}</span>
              </ModalBarButton>
            )}
            {entry.kind === 'image' && onAnimate && (
              <ModalBarButton onClick={() => { onAnimate(); onClose() }}>
                <ImagePlay className="h-4 w-4" />
                <span>Animate</span>
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
