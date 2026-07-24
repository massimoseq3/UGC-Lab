// Presentational parts of CardDetailModal — the per-card masonry gallery, the
// image/video/in-flight tiles, the small tab/chip/reference-slot controls, and
// pure helpers. Split out of CardDetailModal.tsx so that file holds only the
// modal's orchestration (state + handlers). These all communicate via props.
import { useState, useEffect, useRef } from 'react'
import {
  ImageIcon, Video as VideoIcon, Film, Loader2, Check, Download, Bookmark, Volume2, VolumeX, Play, Pause, Copy, Circle, AlertCircle, RefreshCw, X, ImagePlus,
} from 'lucide-react'
import GenerationProgress from '../../../components/GenerationProgress'
import GeneratingBackdrop from '../../../components/GeneratingBackdrop'
import { TileActionStack, TileActionButton, TileDeleteButton } from '../../../components/tileActions'
import BankPicker from '../../../components/BankPicker'
import SlotActionMenu from '../../../components/video/SlotActionMenu'
import type { CardState, ReferenceImage } from '../types'
import type { Product, Model, Script, VoicePreset, BRoll } from '../../../stores/types'
import { useAssetUrlState, useAssetUrl } from '../../../hooks/useAssetUrl'
import { getUrl } from '../../../utils/assetStore'
import { getModel } from '../../../utils/models'
import { startOfDay, sectionLabel } from '../../../utils/history'
import { sendClipToPlayground } from '../services/sendClipToPlayground'
import { downloadImage } from '../../../utils/downloadImage'

// ─── Modal gallery — per-card masonry ────────────────────────────────────

export interface ModalGalleryProps {
  cardState: CardState
  onUpdateState: (updates: Partial<CardState>) => void
  setTab: (t: 'image' | 'video' | 'animate') => void
  savedImageIdxs: Set<number>
  savingImageIdxs: Set<number>
  onSaveImage: (index: number) => void
  onDeleteImage: (index: number) => void
  onDeleteVideo: (index: number) => void
  // Copy a tile's prompt to the clipboard.
  onCopyPrompt: (text: string) => void
  // Open the Animate tab with this image set as the start frame.
  onAnimateImage: (index: number) => void
  // Re-fire / drop a failed in-flight entry (one whose `error` is set).
  onRetryInFlight: (id: string, isVideo: boolean) => void
  onDismissInFlight: (id: string, isVideo: boolean) => void
}

type ModalEntry =
  | { kind: 'image'; idx: number; createdAt: number; imageUrl: string; prompt: string; modelId?: string }
  | { kind: 'video'; idx: number; createdAt: number; videoUrl: string; aspectRatio: string; prompt: string; modelId: string }
  | { kind: 'in-flight-image'; id: string; createdAt: number; prompt: string; aspectRatio: string; modelId?: string | null; error?: string | null }
  | { kind: 'in-flight-video'; id: string; createdAt: number; prompt: string; mode: 'animating' | 'rendering'; aspectRatio: string; modelId?: string | null; error?: string | null }

// An in-flight entry carries an `error` once its generation failed; that's the
// signal to render it as a Failed tile (retry/dismiss) instead of a spinner.
function inFlightError(e: ModalEntry): string | null | undefined {
  return e.kind === 'in-flight-image' || e.kind === 'in-flight-video' ? e.error : undefined
}

export function ModalGallery({
  cardState,
  onUpdateState,
  setTab,
  savedImageIdxs,
  savingImageIdxs,
  onSaveImage,
  onDeleteImage,
  onDeleteVideo,
  onCopyPrompt,
  onAnimateImage,
  onRetryInFlight,
  onDismissInFlight,
}: ModalGalleryProps) {
  const noSelectionYet = !cardState.selected
  useEffect(() => {
    if (!noSelectionYet) return
    if (cardState.images.length > 0) {
      onUpdateState({ selected: { kind: 'image', index: cardState.images.length - 1 } })
    } else if (cardState.videos.length > 0) {
      onUpdateState({ selected: { kind: 'video', index: cardState.videos.length - 1 } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noSelectionYet, cardState.images.length, cardState.videos.length])

  // Unified per-card output stream, newest-first.
  const entries: ModalEntry[] = []
  for (const entry of cardState.inFlightImages) {
    entries.push({ kind: 'in-flight-image', id: entry.id, createdAt: entry.startedAt, prompt: entry.prompt, aspectRatio: entry.aspectRatio, modelId: entry.modelId, error: entry.error })
  }
  for (const entry of cardState.inFlightVideos) {
    entries.push({
      kind: 'in-flight-video',
      id: entry.id,
      createdAt: entry.startedAt,
      prompt: entry.prompt,
      mode: entry.mode === 'image-to-video' ? 'animating' : 'rendering',
      aspectRatio: entry.aspectRatio,
      modelId: entry.modelId,
      error: entry.error,
    })
  }
  cardState.images.forEach((img, idx) => {
    entries.push({ kind: 'image', idx, createdAt: img.createdAt ?? 0, imageUrl: img.imageUrl, prompt: img.prompt, modelId: img.modelId })
  })
  cardState.videos.forEach((v, idx) => {
    entries.push({ kind: 'video', idx, createdAt: v.createdAt ?? 0, videoUrl: v.url, aspectRatio: v.aspectRatio, prompt: v.prompt, modelId: v.modelId })
  })
  entries.sort((a, b) => b.createdAt - a.createdAt)

  const inFlight = entries.filter((e) => e.kind === 'in-flight-image' || e.kind === 'in-flight-video')
  const inFlightActive = inFlight.filter((e) => !inFlightError(e))
  const inFlightFailed = inFlight.filter((e) => inFlightError(e))
  const finished = entries.filter((e) => e.kind === 'image' || e.kind === 'video')

  const dayGroups = new Map<number, ModalEntry[]>()
  for (const e of finished) {
    const day = startOfDay(e.createdAt)
    const arr = dayGroups.get(day) ?? []
    arr.push(e)
    dayGroups.set(day, arr)
  }
  const dayGroupList = Array.from(dayGroups.entries()).sort(([a], [b]) => b - a)

  const isImageSelected = (idx: number) =>
    cardState.selected?.kind === 'image' && cardState.selected.index === idx
  const isVideoSelected = (idx: number) =>
    cardState.selected?.kind === 'video' && cardState.selected.index === idx

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <ImageIcon className="h-8 w-8 text-ink-800" strokeWidth={1.5} />
        <p className="text-sm text-ink-500">No generations yet</p>
        <p className="max-w-[220px] text-xs leading-relaxed text-ink-600">
          Pick a model and hit Generate. Outputs land here — click any to set
          it as the cover.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {inFlightActive.length > 0 && (
        <>
          <DayPill label="In progress" />
          <div className="columns-2 gap-2 [column-fill:_balance]">
            {inFlightActive.map((entry) => (
              <div key={entry.kind === 'in-flight-image' || entry.kind === 'in-flight-video' ? entry.id : ''} className="mb-2 break-inside-avoid">
                <InFlightTile entry={entry} />
              </div>
            ))}
          </div>
        </>
      )}

      {inFlightFailed.length > 0 && (
        <>
          <DayPill label="Failed" />
          <div className="columns-2 gap-2 [column-fill:_balance]">
            {inFlightFailed.map((entry) => {
              const id = entry.kind === 'in-flight-image' || entry.kind === 'in-flight-video' ? entry.id : ''
              const isVideo = entry.kind === 'in-flight-video'
              return (
                <div key={id} className="mb-2 break-inside-avoid">
                  <FailedTile
                    entry={entry}
                    onRetry={() => onRetryInFlight(id, isVideo)}
                    onDismiss={() => onDismissInFlight(id, isVideo)}
                  />
                </div>
              )
            })}
          </div>
        </>
      )}

      {dayGroupList.map(([dayTs, items]) => (
        <div key={dayTs}>
          <DayPill label={sectionLabel(dayTs)} />
          <div className="columns-2 gap-2 [column-fill:_balance]">
            {items.map((entry) => {
              if (entry.kind === 'image') {
                return (
                  <div key={`img-${entry.idx}`} className="mb-2 break-inside-avoid">
                    <ImageTile
                      imageRef={entry.imageUrl}
                      modelId={entry.modelId}
                      selected={isImageSelected(entry.idx)}
                      saved={savedImageIdxs.has(entry.idx)}
                      saving={savingImageIdxs.has(entry.idx)}
                      onClick={() => {
                        onUpdateState({ selected: { kind: 'image', index: entry.idx }, currentImageIndex: entry.idx })
                        setTab('image')
                      }}
                      onSave={() => onSaveImage(entry.idx)}
                      onDelete={() => onDeleteImage(entry.idx)}
                      onCopyPrompt={() => onCopyPrompt(entry.prompt)}
                      onAnimate={() => onAnimateImage(entry.idx)}
                    />
                  </div>
                )
              }
              if (entry.kind === 'video') {
                return (
                  <div key={`vid-${entry.idx}`} className="mb-2 break-inside-avoid">
                    <VideoTile
                      videoRef={entry.videoUrl}
                      aspectRatio={entry.aspectRatio}
                      modelId={entry.modelId}
                      selected={isVideoSelected(entry.idx)}
                      onClick={() => {
                        onUpdateState({ selected: { kind: 'video', index: entry.idx }, currentVideoIndex: entry.idx })
                        setTab('video')
                      }}
                      onDelete={() => onDeleteVideo(entry.idx)}
                      onCopyPrompt={() => onCopyPrompt(entry.prompt)}
                      onSendToPlayground={() => {
                        const v = cardState.videos[entry.idx]
                        if (v) void sendClipToPlayground(v)
                      }}
                    />
                  </div>
                )
              }
              return null
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Tiles ──────────────────────────────────────────────────────────────

// Common hover-reveal layout: trash top-right, action row bottom-right with
// Download / Bookmark+text / Copy prompt. Icons sized at h-4 w-4 (bigger
// than the previous h-3 w-3) so they're easier to hit.
function ImageTile({
  imageRef,
  modelId,
  selected,
  saved,
  saving,
  onClick,
  onSave,
  onDelete,
  onCopyPrompt,
  onAnimate,
}: {
  imageRef: string
  modelId?: string
  selected: boolean
  saved: boolean
  saving: boolean
  onClick: () => void
  onSave: () => void
  onDelete: () => void
  onCopyPrompt: () => void
  onAnimate?: () => void
}) {
  const { url, status } = useAssetUrlState(imageRef)
  const modelLabel = modelId ? getModel(modelId)?.displayName ?? modelId : null
  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-black light:bg-zinc-200 transition-colors ${
        selected
          ? 'border-broll-500/70 ring-2 ring-broll-500/40'
          : 'border-ink/10 hover:border-ink/30'
      }`}
    >
      {status === 'ready' && url ? (
        <img src={url} alt="" className="block h-auto w-full" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center">
          {status === 'loading' ? <Loader2 className="h-5 w-5 animate-spin text-zinc-500" /> : <ImageIcon className="h-6 w-6 text-zinc-700" />}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />
      {modelLabel && (
        <p className="pointer-events-none absolute left-2 bottom-1 max-w-[70%] truncate text-[10px] text-zinc-300/90 transition-opacity group-hover:opacity-0">{modelLabel}</p>
      )}
      {selected && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-broll-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur">
          Cover
        </span>
      )}
      {/* Animate — opens the Animate tab with this still as the start frame.
          Full-width, chunky bar across the bottom so it's an easy hit target. */}
      {onAnimate && (
        <button
          type="button"
          title="Animate this image into a video"
          onClick={(e) => { e.stopPropagation(); onAnimate() }}
          className="absolute inset-x-2 bottom-2 flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-broll-400/50 bg-broll-500/90 text-[13px] font-semibold text-white opacity-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur transition-opacity hover:bg-broll-500 group-hover:opacity-100"
        >
          <Film className="h-4 w-4" />
          Animate B-Roll
        </button>
      )}
      {/* Hover action stack — top-right vertical column, app-wide standard
          order: download · save · copy · delete. The Animate bar keeps the
          bottom edge. */}
      <TileActionStack>
        <TileActionButton
          title="Download"
          onClick={async (e) => {
            e.stopPropagation()
            const u = await getUrl(imageRef)
            if (u) downloadImage(u, `broll-${Date.now()}`)
          }}
        >
          <Download className="h-4 w-4" />
        </TileActionButton>
        <TileActionButton
          title={saved ? 'Saved to bank' : saving ? 'Saving…' : 'Save to bank'}
          tone={saved ? 'saved' : 'default'}
          onClick={(e) => { e.stopPropagation(); if (!saved && !saving) onSave() }}
        >
          {saved ? <Check className="h-4 w-4" /> : saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bookmark className="h-4 w-4" />}
        </TileActionButton>
        <TileActionButton title="Copy prompt" onClick={(e) => { e.stopPropagation(); onCopyPrompt() }}>
          <Copy className="h-4 w-4" />
        </TileActionButton>
        <TileDeleteButton onDelete={onDelete} />
      </TileActionStack>
    </div>
  )
}

function VideoTile({
  videoRef,
  aspectRatio,
  modelId,
  selected,
  onClick,
  onDelete,
  onCopyPrompt,
  onSendToPlayground,
}: {
  videoRef: string
  aspectRatio: string
  modelId: string
  selected: boolean
  onClick: () => void
  onDelete: () => void
  onCopyPrompt: () => void
  onSendToPlayground: () => void
}) {
  const url = useAssetUrl(videoRef)
  const videoElRef = useRef<HTMLVideoElement>(null)
  const [hovering, setHovering] = useState(false)
  const [playing, setPlaying] = useState(false)
  // Hover-autoplay must stay muted (browsers block unmuted autoplay), but an
  // explicit Play click is a user gesture and should play with sound.
  const [unmuted, setUnmuted] = useState(false)
  const ratio = aspectStyle(aspectRatio)
  const modelLabel = getModel(modelId)?.displayName ?? modelId

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    const v = videoElRef.current
    if (!v) return
    if (v.paused) {
      // Explicit play → unmute so the generated clip is audible.
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
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={onClick}
      className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-black light:bg-zinc-200 transition-colors ${
        selected
          ? 'border-broll-500/70 ring-2 ring-broll-500/40'
          : 'border-ink/10 hover:border-ink/30'
      }`}
      style={ratio}
    >
      {url ? (
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
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      )}
      {/* Clickable play / pause overlay. Hidden while playing — autoplay on
          hover means most of the time the user never has to click it. The
          stopPropagation lets the user toggle playback without selecting the
          tile as the cover. */}
      {url && !playing && (
        <button
          type="button"
          title="Play"
          onClick={togglePlay}
          className="pointer-events-auto absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur transition-colors hover:bg-black/85"
        >
          <Play className="h-3 w-3 fill-white text-white" />
        </button>
      )}
      {url && playing && hovering && (
        <button
          type="button"
          title="Pause"
          onClick={togglePlay}
          className="pointer-events-auto absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur transition-colors hover:bg-black/85"
        >
          <Pause className="h-3 w-3 fill-white text-white" />
        </button>
      )}
      {url && (hovering || unmuted) && (
        <button
          type="button"
          title={unmuted ? 'Mute' : 'Unmute'}
          onClick={toggleMute}
          className="pointer-events-auto absolute left-10 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur transition-colors hover:bg-black/85"
        >
          {unmuted ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
        </button>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />
      <p className="pointer-events-none absolute inset-x-2 bottom-1 line-clamp-1 text-[10px] text-zinc-300/90">{modelLabel}</p>
      {selected && (
        <span className="pointer-events-none absolute left-1.5 bottom-1.5 rounded-full bg-broll-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur">
          Cover
        </span>
      )}
      {/* Hover action stack — top-right vertical column, app-wide standard
          order: download · copy · send-to-Playground · delete (video has no
          save-to-bank). */}
      <TileActionStack>
        <TileActionButton
          title="Download"
          onClick={async (e) => {
            e.stopPropagation()
            const u = await getUrl(videoRef)
            if (u) downloadImage(u, `broll-${Date.now()}`, 'mp4')
          }}
        >
          <Download className="h-4 w-4" />
        </TileActionButton>
        <TileActionButton title="Copy prompt" onClick={(e) => { e.stopPropagation(); onCopyPrompt() }}>
          <Copy className="h-4 w-4" />
        </TileActionButton>
        <TileActionButton
          title="Use in Playground as Gemini Omni source clip"
          onClick={(e) => { e.stopPropagation(); onSendToPlayground() }}
        >
          <Film className="h-4 w-4" />
        </TileActionButton>
        <TileDeleteButton onDelete={onDelete} />
      </TileActionStack>
    </div>
  )
}

function InFlightTile({ entry }: { entry: ModalEntry }) {
  if (entry.kind !== 'in-flight-image' && entry.kind !== 'in-flight-video') return null
  const isVideo = entry.kind === 'in-flight-video'
  const isAnimating = entry.kind === 'in-flight-video' && entry.mode === 'animating'
  const Icon = isVideo ? VideoIcon : ImageIcon
  const modelLabel = entry.modelId ? getModel(entry.modelId)?.displayName ?? entry.modelId : null
  return (
    <div
      className="relative overflow-hidden rounded-lg border border-broll-500/20"
      style={aspectStyle(entry.aspectRatio)}
    >
      <GeneratingBackdrop family="broll" />
      {/* Mode glyph, top-left — mirrors the Playground / Influencers in-flight framing. */}
      <div className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/25 text-broll-100 backdrop-blur-sm">
        <Icon className="h-4 w-4" />
      </div>
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center">
        {modelLabel && <p className="text-[10px] font-medium text-broll-100">{modelLabel}</p>}
        <GenerationProgress
          isActive
          color="bg-broll-500"
          showHelper={false}
          messages={
            isVideo
              ? (isAnimating
                  ? ['Sending request...', 'Animating still...', 'Rendering motion...', 'Finalizing the clip...']
                  : ['Sending request...', 'Storyboarding frames...', 'Rendering motion...', 'Finalizing the clip...'])
              : ['Sending request...', 'Composing the scene...', 'Rendering details...', 'Finalizing the frame...']
          }
          className="max-w-[160px]"
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6">
        <p className="line-clamp-2 text-[10px] text-zinc-300">{entry.prompt}</p>
      </div>
    </div>
  )
}

// A standalone 9:16 in-flight placeholder tile, shaped like the Line-by-Line
// InFlightTile above but driven by plain props instead of a ModalEntry. The
// Continuous frame/clip and One-Shot modals import this so a generating
// keyframe or clip reads as a real card in the gallery grid — the animated
// backdrop + rotating progress — rather than a flat text row.
export function PendingMediaTile({
  kind,
  prompt,
  modelId,
  aspectRatio = '9:16',
  messages,
  onDismiss,
}: {
  kind: 'image' | 'video'
  prompt?: string
  modelId?: string | null
  aspectRatio?: string
  messages?: string[]
  // Give up on this entry. A generation that died before kie returned a task id
  // (a refresh mid-createTask, say) has nothing to resume, and the in-flight
  // entry blocks every Generate button until a 30-minute sweep clears it — with
  // no way out, since only errored entries get a Retry/Dismiss row.
  onDismiss?: () => void
}) {
  const isVideo = kind === 'video'
  const Icon = isVideo ? VideoIcon : ImageIcon
  const modelLabel = modelId ? getModel(modelId)?.displayName ?? modelId : null
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-broll-500/20"
      style={aspectStyle(aspectRatio)}
    >
      <GeneratingBackdrop family="broll" />
      <div className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/25 text-broll-100 backdrop-blur-sm">
        <Icon className="h-4 w-4" />
      </div>
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center">
        {modelLabel && <p className="text-[10px] font-medium text-broll-100">{modelLabel}</p>}
        <GenerationProgress
          isActive
          color="bg-broll-500"
          showHelper={false}
          messages={
            messages ??
            (isVideo
              ? ['Sending request...', 'Rendering motion...', 'Adding detail...', 'Finalizing the clip...']
              : ['Sending request...', 'Composing the scene...', 'Rendering details...', 'Finalizing the frame...'])
          }
          className="max-w-[160px]"
        />
      </div>
      {prompt && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6">
          <p className="line-clamp-2 text-[10px] text-zinc-300">{prompt}</p>
        </div>
      )}
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
        <span className="pointer-events-none rounded-full bg-black/40 px-2 py-0.5 text-[9px] font-medium text-broll-100 backdrop-blur-sm">
          Survives refresh
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDismiss() }}
            title="Stop tracking this generation"
            className="flex h-5 w-5 items-center justify-center rounded-full bg-black/40 text-broll-100 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

// Shared modal video player — the Line-by-Line playback behaviour (hover
// autoplay muted; the top-left button plays with sound; a mute toggle appears
// while playing/unmuted). No native controls, so it reads the same as the
// Line-by-Line gallery tiles. Children are overlaid (action stack, duration
// badge). Used by the Continuous clip modal and the One-Shot modal so their
// video playback matches Line-by-Line.
export function ModalVideoPlayer({ url, children }: { url: string | null | undefined; children?: React.ReactNode }) {
  const videoElRef = useRef<HTMLVideoElement>(null)
  const [hovering, setHovering] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [unmuted, setUnmuted] = useState(false)
  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation()
    const v = videoElRef.current
    if (!v) return
    if (v.paused) { setUnmuted(true); v.muted = false; v.play().catch(() => {}) }
    else v.pause()
  }
  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation()
    const v = videoElRef.current
    setUnmuted((prev) => { const next = !prev; if (v) v.muted = !next; return next })
  }
  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="group relative overflow-hidden rounded-2xl border border-ink/10 bg-black"
    >
      {url ? (
        <video
          ref={videoElRef}
          src={url}
          muted={!unmuted}
          loop
          playsInline
          autoPlay={hovering}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="aspect-[9/16] w-full object-cover"
        />
      ) : (
        <div className="flex aspect-[9/16] w-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-white/40" /></div>
      )}
      {url && (
        <button
          type="button"
          title={playing ? 'Pause' : 'Play with sound'}
          onClick={togglePlay}
          className="absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
        >
          {playing ? <Pause className="h-3 w-3 fill-white" /> : <Play className="h-3 w-3 fill-white" />}
        </button>
      )}
      {url && (hovering || unmuted) && (
        <button
          type="button"
          title={unmuted ? 'Mute' : 'Unmute'}
          onClick={toggleMute}
          className="absolute left-10 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
        >
          {unmuted ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
        </button>
      )}
      {children}
    </div>
  )
}

// A failed generation tile — replaces the perpetual spinner once an in-flight
// entry carries an `error`. Retry re-fires the same gen; Dismiss drops it.
function FailedTile({
  entry,
  onRetry,
  onDismiss,
}: {
  entry: ModalEntry
  onRetry: () => void
  onDismiss: () => void
}) {
  if (entry.kind !== 'in-flight-image' && entry.kind !== 'in-flight-video') return null
  return (
    <div
      className="relative overflow-hidden rounded-lg border border-red-500/40 bg-gradient-to-br from-red-500/[0.1] to-ink-950"
      style={aspectStyle(entry.aspectRatio)}
    >
      <div className="absolute left-1.5 top-1.5 rounded-full bg-red-500/30 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-red-100 light:text-red-900 backdrop-blur">
        Failed
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
        <AlertCircle className="h-5 w-5 text-red-300 light:text-red-700" />
        <p className="line-clamp-3 text-[10px] leading-relaxed text-red-200 light:text-red-800">{entry.error}</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 rounded-full border border-white/15 bg-broll-500 px-2.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-broll-400"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[10px] font-medium text-ink-300 transition-colors hover:bg-ink/[0.08]"
          >
            <X className="h-3 w-3" />
            Dismiss
          </button>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
        <p className="line-clamp-1 text-[10px] text-zinc-400">{entry.prompt}</p>
      </div>
    </div>
  )
}

// ─── Shared bits ─────────────────────────────────────────────────────────

function DayPill({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center justify-center">
      <span className="rounded-full bg-ink/[0.06] px-3 py-1 text-[11px] font-medium text-ink-300">{label}</span>
    </div>
  )
}

// Reference Images slot card — Bank-picker-style. Same outer shell as
// the ModelPicker rows: rounded-xl border + bg-ink/[0.02] + p-3 with an
// icon avatar on the left. Click opens the script-level BankPicker.
export function ReferenceSlotCard({
  icon,
  accentClass,
  kind,
  name,
  imageRef,
  onClick,
  active,
  onToggleActive,
  dimmed,
  dimmedReason,
}: {
  icon: React.ReactNode
  accentClass: string
  // Slot label ('Character', 'Product', Continuous mode's 'Previous frame', …).
  kind: string
  name?: string | null
  imageRef?: string | null
  onClick: () => void
  active: boolean
  onToggleActive: () => void
  // True when the current video model doesn't support reference-to-video.
  // The card stays clickable so the user can pre-arm the toggle for a model
  // swap, but the visual state explains why nothing is highlighted.
  dimmed?: boolean
  dimmedReason?: string
}) {
  const url = useAssetUrl(imageRef)
  const hasRef = !!name
  // Only the active+populated state earns the highlight — and not when the
  // chosen model can't use refs.
  const highlight = active && hasRef && !dimmed
  // Keyed to the bank's own colour so the lit-up card matches the thing it
  // holds: amber for products, pink for influencers.
  const accent = kind === 'Product'
    ? {
        box: 'border-gold-500/40 bg-gold-500/10 ring-1 ring-inset ring-gold-500/15',
        toggle: 'border-gold-500/60 bg-gold-500/20 text-gold-300 hover:bg-gold-500/30',
      }
    : {
        box: 'border-influencers-500/40 bg-influencers-500/10 ring-1 ring-inset ring-influencers-500/15',
        toggle: 'border-influencers-500/60 bg-influencers-500/20 text-influencers-300 hover:bg-influencers-500/30',
      }
  return (
    <div
      title={dimmed ? dimmedReason : undefined}
      className={`relative flex w-full items-center gap-3 rounded-full border p-3 text-left transition-colors ${
        highlight
          ? accent.box
          : 'border-ink/10 bg-ink/[0.02] hover:border-ink/20 hover:bg-ink/[0.04]'
      } ${dimmed ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        {url ? (
          <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
        ) : (
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${accentClass}`}>
            {icon}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col pr-6">
          <span className={`truncate text-[13px] font-medium ${name ? 'text-ink-100' : 'text-ink-600'}`}>
            {name || `Select ${kind.toLowerCase()}`}
          </span>
          <span className="text-[11px] font-medium tracking-tight text-ink-400">{kind}</span>
        </div>
      </button>
      {hasRef && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleActive() }}
          title={active ? 'Active — click to disable' : 'Inactive — click to enable'}
          className={`absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border transition-colors ${
            active
              ? accent.toggle
              : 'border-ink/15 bg-ink/[0.04] text-ink-500 hover:border-ink/30 hover:text-ink-300'
          }`}
        >
          {active ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <Circle className="h-3 w-3" />}
        </button>
      )}
    </div>
  )
}

// Extra reference images — sits beneath the fixed Influencer / Product slot
// cards so the user can attach additional refs (a second product, an outfit,
// a pose) without losing the bank-keyed pills. Square Playground-style tiles
// with a "+" add tile whose hover menu offers Upload / Pick from Bank. These
// refs are memory-only (data: URIs are too big for the persisted card draft),
// so they reset on a full refresh — same trade-off as the Influencers editor.
export function ExtraRefsRow({
  refs,
  onAdd,
  onRemove,
  max = 4,
  dimmed,
}: {
  refs: ReferenceImage[]
  onAdd: (ref: ReferenceImage) => void
  onRemove: (index: number) => void
  max?: number
  dimmed?: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const remaining = max - refs.length

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') onAdd({ dataUrl: reader.result, label: 'reference' })
      }
      reader.readAsDataURL(file)
    }
  }

  // Pull the image ref off whichever bank item the user picked. Stored as-is —
  // startImageTask / the video path resolve asset:// refs at generation time.
  function handleBankPick(item: Product | Model | Script | VoicePreset | BRoll) {
    let url: string | undefined
    if ('productImage' in item) url = item.productImage
    else if ('characterImage' in item) url = item.sheetImage || item.characterImage
    else if ('imageUrl' in item) url = (item as BRoll).imageUrl
    if (url) onAdd({ dataUrl: url, label: 'reference' })
  }

  return (
    <div className={`mt-2 ${dimmed ? 'opacity-50' : ''}`}>
      {/* Picked references render as a four-up thumbnail strip above the add
          card — same layout as the Playground reference strip. */}
      {refs.length > 0 && (
        <div className="mb-2 grid grid-cols-4 gap-2">
          {refs.map((r, i) => (
            <RefThumb key={i} refStr={r.dataUrl} onRemove={() => onRemove(i)} />
          ))}
        </div>
      )}

      {/* Full-width dashed add card — mirrors the Playground "Reference Images"
          box (Optional badge left, count right, centered icon + label). Click
          opens Upload / Pick-from-Bank. */}
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={remaining <= 0}
          onClick={() => { if (remaining > 0) setMenuOpen((v) => !v) }}
          className={`group relative flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-ink/15 bg-ink/[0.02] transition-colors ${
            remaining <= 0 ? 'cursor-not-allowed opacity-50' : 'hover:border-ink/25 hover:bg-ink/[0.04]'
          }`}
        >
          <span className="absolute left-2 top-2 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[9px] font-medium capitalize tracking-tight text-ink-500">
            Optional
          </span>
          <span className="absolute right-2 top-2 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[9px] font-medium tabular-nums tracking-tight text-ink-500">
            {refs.length}/{max}
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ink/15 bg-ink/[0.03] text-ink-400 transition-colors group-hover:text-ink-200">
            <ImagePlus className="h-3.5 w-3.5" />
          </span>
          <span className="text-[12px] font-normal text-ink-500">Reference Images</span>
        </button>
        {remaining > 0 && (
          <SlotActionMenu
            anchorRef={triggerRef}
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            onUpload={() => fileInputRef.current?.click()}
            onPickFromBank={() => setPickerOpen(true)}
          />
        )}
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
      <BankPicker
        bankType="products"
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleBankPick}
        tabs={['products', 'models', { type: 'brolls', filter: (it) => !!(it as BRoll).imageUrl }]}
      />
    </div>
  )
}

// A single extra-reference thumbnail. Resolves asset:// refs through the asset
// store; data: / http refs pass through. Mirrors the Playground thumbnail tile.
function RefThumb({ refStr, onRemove }: { refStr: string; onRemove: () => void }) {
  const url = useAssetUrl(refStr)
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-ink/10 bg-ink/[0.02]">
      {url
        ? <img src={url} alt="" className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-ink-500" /></div>}
      <button
        type="button"
        title="Remove"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white/80 transition-colors hover:bg-black/90"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────
// (startOfDay + day labelling now live in utils/history — imported above.)

function aspectStyle(ar: string): React.CSSProperties {
  const [w, h] = ar.split(':').map(Number)
  if (!w || !h) return { aspectRatio: '9 / 16' }
  return { aspectRatio: `${w} / ${h}` }
}
