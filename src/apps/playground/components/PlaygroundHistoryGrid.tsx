import { memo, useMemo, useRef, useState, useEffect } from 'react'
import { CornerDownLeft,
  Download, Bookmark, Check, Film, Image as ImageIcon, Music as MusicIcon, Play, Pause, Volume2, VolumeX, X, ImagePlay, Copy, LayoutGrid, List, Maximize2,
} from 'lucide-react'
import Spinner from '../../../components/Spinner'
import { useBankStore } from '../../../stores/bankStore'
import { useAssetUrlState, useAssetUrl, useAssetThumb, useAssetPoster, posterVideoProps, posterPending } from '../../../hooks/useAssetUrl'
import { useInlineVideo, useExclusiveVideo } from '../../../hooks/useInlineVideo'
import { useAppStore } from '../../../stores/appStore'
import { getUrl } from '../../../utils/assetStore'
import { CurrentFrameButton, VideoFrameActions } from '../../../components/VideoLightbox'
import { getModel } from '../../../utils/models'
import { usePersistedState } from '../../../hooks/usePersistedState'
import { sectionLabel, groupByDay } from '../../../utils/history'
import { downloadImage } from '../../../utils/downloadImage'
import { downloadAssetsZip } from '../../../utils/downloadZip'
import type { ImageHistoryItem, VideoHistoryItem, MusicHistoryItem } from '../../../stores/types'
import MusicRow from './MusicRow'
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
  // Pick-several-clips-and-zip mode. It lives on the grid itself rather than in
  // a modal listing the clips a second time (B-Roll's `ClipDownloadModal` shape,
  // which this app tried and dropped): the wall of tiles you are already
  // scrolling IS the picker, so choosing four takes out of a week of them is
  // four clicks in the view you found them in. Nothing is preselected — this
  // list runs back weeks, and pre-ticking it would mean unticking dozens.
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [zipping, setZipping] = useState(false)
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

  // The clips this grid is currently showing, newest first — what Download
  // clips works over, and the order they land in the zip.
  const videoEntries = useMemo(
    () => entries.filter((e): e is Extract<HistoryEntry, { kind: 'video' }> => e.kind === 'video'),
    [entries],
  )
  // Selecting is a GRID gesture: the tile is the checkbox. A list row is a card
  // you read and play, not a thing you tick, so the control doesn't offer
  // itself there — and switching views or tabs drops a selection that would
  // otherwise be invisible while it survived.
  const canSelect = viewMode === 'grid' && videoEntries.length > 0
  // The Music tab renders one row shape in both views (see MusicRow).
  const musicOnly = filterMode === 'music'
  useEffect(() => {
    setSelecting(false)
    setPicked(new Set())
  }, [filterMode, viewMode])

  const pickedCount = videoEntries.reduce((n, e) => n + (picked.has(e.data.id) ? 1 : 0), 0)
  const allPicked = pickedCount === videoEntries.length && videoEntries.length > 0

  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function handleDownloadZip() {
    if (zipping || pickedCount === 0) return
    setZipping(true)
    const clips = videoEntries.filter((e) => picked.has(e.data.id)).map((e) => e.data)
    const outcome = await zipClips(clips)
    setZipping(false)
    if (outcome.ok) {
      addToast(`Downloading ${outcome.count} clip${outcome.count === 1 ? '' : 's'} as a zip`, 'success')
      setSelecting(false)
      setPicked(new Set())
    } else {
      addToast(outcome.message, 'error')
    }
  }

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
          <p className="text-sm text-ink-500">No Generations Yet</p>
          <p className="max-w-[300px] text-xs leading-relaxed text-ink-600">
            Pick a preset or type a prompt below and hit Generate.
            Everything you make lands here, sorted by day.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Header — card-size slider (list view only) + view switch (Grid / List).
          Matches the prompt panel's h-[57px] mode-toggle bar so the left/right
          tabs sit on the same line.

          It is PINNED OVER the scroller and frosted, the shape B-Roll's
          storyboard bar already has (Massimo's call, September 2026): the grid
          passes under it instead of stopping at it, so the wall of stills reads
          as one surface running the height of the pane rather than as a panel
          bolted under a strip. `app-backdrop-frost` is the one definition of
          that material — it carries the page's own gradient at 90% plus the
          blur on a pseudo-element, which is what keeps the tint anchored to the
          viewport (see the note beside it in index.css). `absolute` rather than
          `sticky`: this bar never scrolls away, and the app-wide rule is that
          chrome which doesn't move shouldn't be sticky. */}
      <div className="absolute inset-x-0 top-0 z-20 flex h-[57px] items-center justify-end gap-3 border-b border-ink/5 app-backdrop-frost px-4">
        {/* Selecting takes over the header rather than raising a band under the
            scroll port: the bar is already there, already pinned, and already
            where the gesture was started from — a second strip at the other end
            of the panel made a member look away from the clips to read a count
            about them. There's no "N of M selected" tally: the count rides on
            the Download button, and a second copy of it beside Select all was
            the thing that clipped that link at panel width (this pane's width
            doesn't track the viewport's, so no breakpoint fixes it). */}
        {selecting && (
          <button
            type="button"
            onClick={() => setPicked(allPicked ? new Set() : new Set(videoEntries.map((e) => e.data.id)))}
            className="mr-auto shrink-0 text-[11px] font-medium text-ink-400 underline-offset-2 transition-colors hover:text-ink-200 hover:underline"
          >
            {allPicked ? 'Clear all' : 'Select all'}
          </button>
        )}
        {selecting && (
          <button
            type="button"
            onClick={() => void handleDownloadZip()}
            disabled={zipping || pickedCount === 0}
            className="flex h-10 shrink-0 items-center gap-1.5 glass-fill glass-fill-soft rounded-full border border-white/15 bg-playground-500 px-4 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
          >
            {zipping ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
            {zipping ? 'Zipping…' : `Download ${pickedCount} clip${pickedCount === 1 ? '' : 's'}`}
          </button>
        )}
        {viewMode === 'list' && !musicOnly && (
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
              aria-label="List Card Size"
            />
          </div>
        )}
        {canSelect && (
          <button
            type="button"
            onClick={() => {
              setSelecting((on) => !on)
              setPicked(new Set())
            }}
            title={selecting ? 'Leave select mode' : 'Pick clips to download as a zip'}
            className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors ${
              selecting
                ? 'border-playground-500/50 bg-playground-500/15 text-playground-200 light:text-playground-700'
                : 'border-ink/10 text-ink-400 hover:bg-ink/5 hover:text-ink-200'
            }`}
          >
            {selecting ? <X className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
            {selecting ? 'Cancel' : 'Download Clips'}
          </button>
        )}
        {/* Neither control has anything to do in the Music tab: a track has no
            thumbnail, so it wears the same row in both views and the size
            slider drives a media frame it doesn't have. A switch that changes
            nothing is worse than no switch. */}
        {!musicOnly && <ViewToggle value={viewMode} onChange={setViewMode} />}
      </div>

      {/* The scroll port runs the FULL height of the pane, behind the absolute
          bar, which is what lets tiles pass under it blurred. `pt-[69px]` is
          the bar's own 57px plus the 12px the content already stood off by —
          change the bar's height and change this with it. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-3 pt-[69px]">
        {visibleInFlight.length > 0 && (
          <>
            <DayPill label="In Progress" className="my-5" />
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
                  // A track has no thumbnail, so it wears the same row in both
                  // views and takes the full width to do it — a Voiceovers-shaped
                  // card squeezed into a quarter-width cell would truncate the
                  // prompt that is the only thing naming the track.
                  <div key={`${entry.kind}-${entry.data.id}`} className={entry.kind === 'music' ? 'col-span-full' : ar && isLandscape(ar) ? 'col-span-2' : ''}>
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
                        selecting={selecting}
                        selected={picked.has(entry.data.id)}
                        onToggleSelect={() => togglePicked(entry.data.id)}
                        onClick={() => setPreviewItem(entry)}
                        onDelete={() => deleteVideoHistory(entry.data.id)}
                        onCopyPrompt={() => handleCopyPrompt(entry.data.prompt)}
                        onReuse={onReusePrompt && entry.data.prompt ? () => onReusePrompt(entry.data.prompt) : undefined}
                      />
                    )}
                    {entry.kind === 'music' && (
                      <MusicRow
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
                {dayItems.map((entry) => entry.kind === 'music' ? (
                  // Same row as the grid draws — audio has no thumbnail, so
                  // there is no second shape for the list to put it in.
                  <MusicRow
                    key={`music-${entry.data.id}`}
                    item={entry.data}
                    onDownload={async () => {
                      const u = await getUrl(entry.data.audioRef)
                      if (u) downloadImage(u, `playground-${entry.data.id}`, 'mp3')
                    }}
                    onDelete={() => deleteMusicHistory(entry.data.id)}
                    onCopyPrompt={() => handleCopyPrompt(entry.data.prompt)}
                    onReuse={onReusePrompt && entry.data.prompt ? () => onReusePrompt(entry.data.prompt) : undefined}
                  />
                ) : (
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
                      } else {
                        const u = await getUrl(entry.data.videoUrl)
                        if (u) downloadImage(u, `playground-${entry.data.id}`, 'mp4')
                      }
                    }}
                    onDelete={() => {
                      if (entry.kind === 'image') deleteImageHistory(entry.data.id)
                      else deleteVideoHistory(entry.data.id)
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
  // Never a track: music has no thumbnail and wears `MusicRow` in both views,
  // so this row only ever frames a still or a clip.
  entry: Exclude<HistoryEntry, { kind: 'music' }>
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
  // Only a CLIP releases: the media frame here is a fixed aspect, so a clip
  // coming and going moves nothing, while a still that released would resize
  // this row from above the viewport. See useNearViewport.
  const { ref: rowRef, near, seen } = useNearViewport<HTMLDivElement>(scrollRoot, undefined, { release: entry.kind === 'video' })
  const mediaRef = entry.kind === 'image' ? entry.data.imageUrl : entry.data.videoUrl
  // A still renders its grid-sized copy, never the original (see
  // utils/mediaThumbs); a clip renders the original, with its poster frame
  // standing in while it loads and after it's released.
  const still = useAssetThumb(near && entry.kind === 'image' ? mediaRef : null)
  const clip = useAssetUrlState(near && entry.kind === 'video' ? mediaRef : null)
  const { url, status } = entry.kind === 'video' ? clip : still
  const poster = useAssetPoster(seen && entry.kind === 'video' ? mediaRef : null)
  // Native controls here, but the same one-clip-at-a-time rule as the tiles.
  const rowVideo = useExclusiveVideo()
  const prompt = entry.data.prompt
  const isSaved = entry.kind === 'image' ? !!entry.data.linkedBRollId : false

  const frameAspect = frameAspectFor(entry.data.aspectRatio, mediaAspect)

  const meta: string[] = []
  if (entry.kind === 'image') {
    if (entry.data.resolution) meta.push(entry.data.resolution)
    if (entry.data.aspectRatio) meta.push(entry.data.aspectRatio)
  } else {
    if (entry.data.resolution) meta.push(entry.data.resolution)
    if (entry.data.durationSeconds) meta.push(`${entry.data.durationSeconds}s`)
    if (entry.data.aspectRatio) meta.push(entry.data.aspectRatio)
  }

  return (
    <div ref={rowRef} className="flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.02] card-soft-shadow">
      {/* Media — fixed-width column (the larger share of the row). Landscape
          outputs keep their own 16:9-style frame (no letterbox bars) at any slider
          position; portraits follow the slider-driven aspect, growing taller as it
          moves right. */}
      <div className="relative min-w-0 flex-[3] bg-black light:bg-[#EAEAEC]" style={{ aspectRatio: frameAspect }}>
        {status === 'ready' && url ? (
          entry.kind === 'video' ? (
            // `preload="none"` wearing its poster (posterVideoProps), like the
            // grid tile: a list of clips holds no decoder until one is played.
            <video
              {...rowVideo}
              {...posterVideoProps(url, poster)}
              controls
              playsInline
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
        ) : poster.url ? (
          // The clip is released (or still loading): its poster holds the frame,
          // so a row scrolled back to never shows a black box.
          <img src={poster.url} alt="" decoding="async" className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {status === 'loading' || (entry.kind === 'video' && poster.status === 'loading')
              ? <Spinner className="h-6 w-6 text-ink-600" />
              : entry.kind === 'video' ? <Film className="h-7 w-7 text-ink-700" /> : <ImageIcon className="h-7 w-7 text-ink-700" />}
          </div>
        )}
        {/* The clip before its poster: nothing paints until it's played, so
            the busy face sits over the controls until the picture lands. */}
        {entry.kind === 'video' && status === 'ready' && !!url && posterPending(poster) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner className="h-6 w-6 text-ink-600" />
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
              <CornerDownLeft className="h-4 w-4" />
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
  // of IndexedDB for every tile in the list. This defers the read itself, and
  // what it reads is the grid-sized thumbnail, not the original: a 4K still
  // drawn into a 150px cell is a decode the browser throws away off screen and
  // redoes on the way back, which is the tile going black on the way up.
  const { ref: tileRef, near } = useNearViewport<HTMLDivElement>(scrollRoot)
  const { url, status } = useAssetThumb(near ? item.imageUrl : null)
  const isSaved = !!item.linkedBRollId

  return (
      <div
        ref={tileRef}
        onClick={onClick}
        className="group relative cursor-pointer overflow-hidden rounded-lg border border-ink/10 light:border-ink/5 bg-black light:bg-zinc-200 transition-all hover:border-ink/20 light:hover:border-ink/10 card-soft-shadow"
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
              <CornerDownLeft className="h-4 w-4" />
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
  selecting,
  selected,
  onToggleSelect,
  onClick,
  onDelete,
  onCopyPrompt,
  onReuse,
}: {
  item: VideoHistoryItem
  scrollRoot: React.RefObject<HTMLElement | null>
  // In select mode the whole tile IS the checkbox — it toggles instead of
  // opening the preview, and the play / mute / action chrome stands down so a
  // click anywhere on the picture means one thing.
  selecting?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  onClick: () => void
  onDelete: () => void
  onCopyPrompt: () => void
  onReuse?: () => void
}) {
  // Off-window tiles hold no clip: a <video> each is a blob in memory, and the
  // element goes with the tile when it scrolls well clear. Safe to release
  // because the tile's height is `ratio`, not the clip's.
  const { ref: tileRef, near, seen } = useNearViewport<HTMLDivElement>(scrollRoot, undefined, { release: true })
  const { url, status } = useAssetUrlState(near ? item.videoUrl : null)
  // The poster is keyed on SEEN, not near: it's the picture the tile IS at
  // rest, the one it keeps once the clip is released, and the one the <video>
  // wears until its first frame decodes — so releasing is invisible.
  const poster = useAssetPoster(seen ? item.videoUrl : null)
  const showVideo = status === 'ready' && !!url
  // Something is on its way: the clip itself, or the poster the tile shows
  // until it's hovered. A tile nobody has scrolled near yet is neither.
  const busy = status === 'loading' || posterPending(poster)
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
        onClick={selecting ? onToggleSelect : onClick}
        title={selecting ? (selected ? 'Leave out of the zip' : 'Add to the zip') : undefined}
        className={`group relative cursor-pointer overflow-hidden rounded-lg border transition-all card-soft-shadow bg-black light:bg-zinc-200 ${
          selecting && selected
            ? 'border-playground-500/70 ring-2 ring-playground-500/40'
            : 'border-ink/10 light:border-ink/5 hover:border-ink/20 light:hover:border-ink/10'
        }`}
        style={ratio}
      >
        {/* `preload="none"` wearing its poster (posterVideoProps), on purpose
            and load-bearing: a wall of clips holds NO decoder until one is
            hovered or played. Mounted as `metadata`, every tile near the window
            opened its own decoder in the same tick, and Safari — which runs a
            handful and parks the rest — left the parked ones black and brought
            the others in one at a time. The poster is what the tile shows;
            `play()` on hover loads the clip from a blob already in memory, and
            the poster stays up until its first frame lands. */}
        {showVideo ? (
          <video
            {...inline.videoProps}
            {...posterVideoProps(url, poster)}
            className={`h-full w-full object-cover transition-opacity ${
              selecting && !selected ? 'opacity-60 group-hover:opacity-100' : ''
            }`}
          />
        ) : poster.url ? (
          <img
            src={poster.url}
            alt=""
            decoding="async"
            className={`h-full w-full object-cover transition-opacity ${
              selecting && !selected ? 'opacity-60 group-hover:opacity-100' : ''
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {busy
              ? <Spinner className="h-5 w-5 text-ink-500" />
              : <Film className="h-6 w-6 text-ink-700" />}
          </div>
        )}
        {/* The clip is here before its poster: the element paints nothing
            until it's played, so the busy face sits over it until the picture
            lands. */}
        {showVideo && posterPending(poster) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner className="h-5 w-5 text-ink-500" />
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
        {!selecting && (
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
                <CornerDownLeft className="h-4 w-4" />
              </TileActionButton>
            )}
            <TileDeleteButton onDelete={onDelete} />
          </TileActionStack>
        )}

        {/* The tick takes the top-RIGHT corner the action stack vacates, leaving
            the left edge to play/mute: picking clips is exactly when you want to
            watch them, so the transport stays live and both its handlers
            stopPropagation so pressing one never ticks the tile. The tick itself
            is not a button — the whole tile already carries that click. */}
        {selecting && (
          <span
            className={`pointer-events-none absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
              selected ? 'border-playground-300 bg-playground-500 text-white' : 'border-white/40 bg-black/50'
            }`}
          >
            {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
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
          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 max-md:flex-none">
            {/* Autoplays with sound, so it claims the app-wide playback slot
                — opening the lightbox stops whatever tile was playing. */}
            <video
              {...lightboxVideo}
              src={videoUrl}
              controls
              autoPlay
              loop
              onClick={(e) => e.stopPropagation()}
              className="max-h-[52vh] max-w-full rounded-xl border border-white/10 object-contain md:max-h-[68vh]"
            />
            {/* The first/last cards on the right are fixed positions; this
                takes whatever moment the member scrubbed to. */}
            <CurrentFrameButton
              videoRef={lightboxVideo.ref}
              fileStem={`playground-${entry.data.id}`}
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
                <span>{copied ? 'Copied' : 'Copy Prompt'}</span>
              </ModalBarButton>
            )}
            {/* Beside Copy prompt, because this is the surface where an output
                is actually judged — "make another like this one" is the decision
                you came here to take. Closes on the way out, since what it
                changed is behind the overlay. */}
            {onReuse && (
              <ModalBarButton onClick={() => { onReuse(); onClose() }}>
                <CornerDownLeft className="h-4 w-4" />
                <span>Reuse Prompt</span>
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

// Zip the picked clips. Module scope on purpose: a try/catch inside the
// component body makes the React Compiler skip the whole component, and this
// grid is the one that must not re-render while the member types next to it.
// It returns a verdict rather than throwing, so the caller stays branch-simple.
async function zipClips(
  clips: VideoHistoryItem[],
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  try {
    const stamp = new Date().toISOString().slice(0, 10)
    const count = await downloadAssetsZip(
      clips.map((clip, i) => ({
        ref: clip.videoUrl,
        // The index prefix is what keeps names unique (two takes of one prompt
        // slug the same) and holds the zip in the order the grid showed them.
        name: `${String(i + 1).padStart(2, '0')}-${fileSlug(clip.prompt)}`,
      })),
      `playground-clips-${stamp}`,
    )
    return { ok: true, count }
  } catch (err) {
    return { ok: false, message: humanizeError(err, 'Could not download the clips.') }
  }
}

// A prompt is the only name a Playground clip has — trimmed to something a
// file system will take, and never empty.
function fileSlug(prompt: string | undefined): string {
  const slug = (prompt ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return slug || 'clip'
}

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
