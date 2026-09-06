// Presentational parts of CardDetailModal — the per-card masonry gallery, the
// image/video/in-flight tiles, the small tab/chip/reference-slot controls, and
// pure helpers. Split out of CardDetailModal.tsx so that file holds only the
// modal's orchestration (state + handlers). These all communicate via props.
import { useState, useEffect, useRef } from 'react'
import {
  ImageIcon, Film, Check, Download, Bookmark, Volume2, VolumeX, Play, Pause, Copy, Circle, AlertCircle, RefreshCw, X, Palette,
} from 'lucide-react'
import Spinner from '../../../components/Spinner'
import { GeneratingMediaFill, PendingMedia, type GeneratingMediaProps } from '../../../components/GeneratingMedia'
import { ANIMATE_MESSAGES } from '../../../components/generatingMessages'
import { TileActionStack, TileActionButton, TileDeleteButton } from '../../../components/tileActions'
import { ExpandVideoButton } from '../../../components/VideoLightbox'
import DayPill from '../../../components/DayPill'
import ModelPill from '../../../components/ModelPill'
import BankPicker from '../../../components/BankPicker'
import SlotActionMenu from '../../../components/video/SlotActionMenu'
// The Playground reference-tile primitives. Aliased because this file has its
// own gallery `ImageTile` (a full-width output tile) — a different thing
// entirely from a 64px reference thumbnail.
import { ImageTile as RefImageTile, AddTile } from '../../../components/video/refInputParts'
import { SectionLabel } from '../../../components/SectionCard'
import type { CardState, ReferenceImage } from '../types'
import type { BRoll, AnyBankItem } from '../../../stores/types'
import { useAssetUrlState, useAssetUrl } from '../../../hooks/useAssetUrl'
import { useInlineVideo } from '../../../hooks/useInlineVideo'
import { getUrl } from '../../../utils/assetStore'
import { startOfDay, sectionLabel } from '../../../utils/history'
import { downloadImage } from '../../../utils/downloadImage'

// ─── Style note ──────────────────────────────────────────────────────────

// The session-wide style block, shown read-only at the top of a card's
// workspace. Both modes append it at fire time and OUTSIDE the editable prompt
// so it can't be forked per card — which also means this note is the only place
// the member can read what actually rides along with their prompt. Clamped to
// two lines; tap to expand.
//
// `label` names what's being appended: a stylized look adds the style block,
// while UGC Realism adds the app's realism stack instead. Saying which is the
// point — the note must not claim something the render won't do.
// `onChange` opens the style popup. The look is session-wide and rides outside
// every card prompt, so switching it here re-renders the SAME storyboard in a
// new style — the "I liked this ad, now give me the claymation cut" move. Left
// off (read-only note) wherever no picker is wired.
export function StyleNote({
  style,
  label = 'Style (applied automatically)',
  onChange,
}: {
  style: string
  label?: string
  onChange?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex w-full items-start gap-2 rounded-2xl border border-ink/10 bg-ink/[0.02] px-3.5 py-2.5 transition-colors hover:bg-ink/[0.04]">
      <Palette className="mt-0.5 h-3.5 w-3.5 shrink-0 text-broll-300" />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="min-w-0 flex-1 text-left"
        title={open ? 'Collapse' : 'Show the full style block'}
      >
        <span className={`text-[11px] leading-relaxed text-ink-500 ${open ? 'block' : 'line-clamp-2'}`}>
          <span className="font-semibold text-ink-400">{label}: </span>
          {style}
        </span>
      </button>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          title="Render this storyboard in a different visual style"
          className="shrink-0 rounded-full border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-[10px] font-medium tracking-tight text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.08] hover:text-ink-100"
        >
          Change
        </button>
      )}
    </div>
  )
}

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
  // Open the Animate tab with this image set as the start frame. Omitted on any
  // tab but Image: the bar is the way OUT of the Image tab, so offering it while
  // the Animate tab is already open (or on Video) is a button to where you are.
  onAnimateImage?: (index: number) => void
  // Re-fire / drop a failed in-flight entry (one whose `error` is set).
  onRetryInFlight: (id: string, isVideo: boolean) => void
  onDismissInFlight: (id: string, isVideo: boolean) => void
}

type ModalEntry =
  | { kind: 'image'; idx: number; createdAt: number; imageUrl: string; prompt: string; modelId?: string }
  | { kind: 'video'; idx: number; createdAt: number; videoUrl: string; aspectRatio: string; prompt: string; modelId?: string }
  // `resumable` — the entry still holds a kie taskId, so a failure here is a
  // result we lost rather than a generation that didn't happen. It decides
  // everything the failed tile says and does (see FailedTile).
  | { kind: 'in-flight-image'; id: string; createdAt: number; prompt: string; aspectRatio: string; modelId?: string | null; error?: string | null; resumable?: boolean }
  | { kind: 'in-flight-video'; id: string; createdAt: number; prompt: string; mode: 'animating' | 'rendering'; aspectRatio: string; modelId?: string | null; error?: string | null; resumable?: boolean }

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
    // Same two fields resumeInFlightImage needs to re-enter the finish half.
    entries.push({ kind: 'in-flight-image', id: entry.id, createdAt: entry.startedAt, prompt: entry.prompt, aspectRatio: entry.aspectRatio, modelId: entry.modelId, error: entry.error, resumable: !!(entry.taskId && entry.modelId) })
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
      resumable: !!entry.taskId,
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
          Pick a model and hit Generate. Outputs land here. Click any to set
          it as the cover.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 px-4 py-3 md:overflow-y-auto">
      {/* Two-column GRID, not CSS multi-column (August 2026). These three lists
          were `columns-2 [column-fill:_balance]` with `break-inside-avoid` on
          each tile, and multi-column balances its columns from the heights it
          knows at layout time — but an ImageTile is `h-auto` until its blob
          decodes, so every arriving picture changed the numbers the balance was
          computed from and the browser re-fragmented. `break-inside-avoid` is a
          request, not a guarantee, and what came out the other side was exactly
          what was reported: a tile's border box split across the break, leaving
          its top edge stranded in the other column as a stray purple line, and
          an empty leftover box at the foot of a column reading as a black card
          with nothing in it. A grid cell cannot fragment and there is no
          balancing pass, so neither artifact has anywhere to come from.
          `items-start` keeps each tile at its own content height instead of
          stretching the shorter of a pair to its row. */}
      {inFlightActive.length > 0 && (
        <>
          <DayPill label="In progress" />
          <div className="grid grid-cols-2 items-start gap-2">
            {inFlightActive.map((entry) => (
              <div key={entry.kind === 'in-flight-image' || entry.kind === 'in-flight-video' ? entry.id : ''}>
                <InFlightTile entry={entry} />
              </div>
            ))}
          </div>
        </>
      )}

      {inFlightFailed.length > 0 && (
        <>
          <DayPill label="Failed" />
          <div className="grid grid-cols-2 items-start gap-2">
            {inFlightFailed.map((entry) => {
              const id = entry.kind === 'in-flight-image' || entry.kind === 'in-flight-video' ? entry.id : ''
              const isVideo = entry.kind === 'in-flight-video'
              return (
                <div key={id}>
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
          <div className="grid grid-cols-2 items-start gap-2">
            {items.map((entry) => {
              if (entry.kind === 'image') {
                return (
                  <div key={`img-${entry.idx}`}>
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
                      onAnimate={onAnimateImage ? () => onAnimateImage(entry.idx) : undefined}
                    />
                  </div>
                )
              }
              if (entry.kind === 'video') {
                return (
                  <div key={`vid-${entry.idx}`}>
                    <VideoTile
                      videoRef={entry.videoUrl}
                      modelId={entry.modelId}
                      idx={entry.idx}
                      aspectRatio={entry.aspectRatio}
                      prompt={entry.prompt}
                      selected={isVideoSelected(entry.idx)}
                      onClick={() => {
                        onUpdateState({ selected: { kind: 'video', index: entry.idx }, currentVideoIndex: entry.idx })
                        setTab('video')
                      }}
                      onDelete={() => onDeleteVideo(entry.idx)}
                      onCopyPrompt={() => onCopyPrompt(entry.prompt)}
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
  return (
    <div className="flex flex-col gap-1 text-center">
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
          {status === 'loading' ? <Spinner className="h-5 w-5 text-zinc-500" /> : <ImageIcon className="h-6 w-6 text-zinc-700" />}
        </div>
      )}
      {/* Bottom scrim — the Animate bar sits on it, so it arrives with it.
          It used to be permanent because the model pill sat down there too;
          that pill is the caption under the tile now, which leaves a quarter of
          every still darkened for nothing until the pointer lands on it. */}
      {onAnimate && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      )}
      {/* Centred, like the tag chip on a scene card — the corners belong to the
          hover actions, and a badge that names the whole tile reads better over
          the middle of it. */}
      {selected && (
        <span className="pointer-events-none absolute left-1/2 top-1.5 -translate-x-1/2 rounded-full bg-broll-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur">
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
          className="absolute inset-x-2 bottom-2 flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-broll-400/50 bg-broll-500/90 text-[13px] font-semibold text-white opacity-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-opacity hover:bg-broll-500 group-hover:opacity-100"
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
          {saved ? <Check className="h-4 w-4" /> : saving ? <Spinner className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
        </TileActionButton>
        <TileActionButton title="Copy prompt" onClick={(e) => { e.stopPropagation(); onCopyPrompt() }}>
          <Copy className="h-4 w-4" />
        </TileActionButton>
        <TileDeleteButton onDelete={onDelete} />
      </TileActionStack>
    </div>
      {/* The model that made this take, as the tile's own caption line rather
          than a chip lying on the picture. The gallery is where takes are
          compared, so the answer has to be visible — but a white-on-black pill
          was the loudest thing on a still whose whole job is to be judged, and
          on the clip tile it collided with the centred Cover badge on the same
          bottom strip. Under the card it can be permanent and quiet instead of
          fading on hover, which is the `quiet` variant's whole purpose. */}
      <ModelPill
        variant="quiet"
        modelId={modelId}
        className="inline-block max-w-full"
      />
    </div>
  )
}

function VideoTile({
  videoRef,
  modelId,
  idx,
  aspectRatio,
  prompt,
  selected,
  onClick,
  onDelete,
  onCopyPrompt,
}: {
  videoRef: string
  modelId?: string
  // Position in the card's video list — names downloaded files.
  idx: number
  aspectRatio: string
  prompt: string
  selected: boolean
  onClick: () => void
  onDelete: () => void
  onCopyPrompt: () => void
}) {
  const url = useAssetUrl(videoRef)
  // Hover autoplays muted (browsers block unmuted autoplay); the Play button
  // is a user gesture, so it plays with sound — and only one clip in the app
  // plays at a time.
  const inline = useInlineVideo()
  const { hovering, unmuted, togglePlay, toggleMute } = inline
  const ratio = aspectStyle(aspectRatio)

  return (
    <div className="flex flex-col gap-1 text-center">
    <div
      {...inline.hoverProps}
      onClick={onClick}
      className={`group relative cursor-pointer overflow-hidden rounded-lg border bg-black light:bg-zinc-200 transition-colors ${
        selected
          ? 'border-broll-500/70 ring-2 ring-broll-500/40'
          : 'border-ink/10 hover:border-ink/30'
      }`}
      style={ratio}
    >
      {url ? (
        <video {...inline.videoProps} src={url} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Spinner className="h-5 w-5 text-ink-500" />
        </div>
      )}
      {/* Play / pause — always on the tile, so a clip playing with sound can
          still be stopped once the pointer has wandered off it. The
          stopPropagation lets the user toggle playback without selecting the
          tile as the cover. */}
      {url && (
        <button
          type="button"
          title={inline.watching ? 'Pause' : 'Play with sound'}
          onClick={togglePlay}
          className="pointer-events-auto absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur transition-colors hover:bg-black/85"
        >
          {inline.watching ? <Pause className="h-3 w-3 fill-white text-white" /> : <Play className="h-3 w-3 fill-white text-white" />}
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
      {/* Cover badge, centred on the TOP edge — matching the still tile, and
          out of the way of the model caption. It shared the bottom strip with
          the model pill, and a 55% cap was not enough to keep two centred-ish
          chips off each other on a narrow tile: the pill ran under the badge.
          The top row has room because its two corners are taken by fixed-width
          chrome (play/mute left, the action stack right) with a clear lane
          between them. */}
      {selected && (
        <span className="pointer-events-none absolute left-1/2 top-1.5 -translate-x-1/2 rounded-full bg-broll-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur">
          Cover
        </span>
      )}
      {/* Hover action stack — top-right vertical column, app-wide standard
          order: download · copy · expand · delete (video has no save-to-bank).
          Stays put while the clip plays with sound: watching a
          take is when you decide to keep it, and it's clear of the play/mute
          buttons on the left. */}
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
        {url && (
          <ExpandVideoButton
            videoUrl={url}
            prompt={prompt}
            fileStem={`broll-clip-${idx + 1}`}
            aspectRatio={aspectRatio}
          />
        )}
        <TileDeleteButton onDelete={onDelete} />
      </TileActionStack>
    </div>
      {/* Same caption line as the still tile above — see the note there. */}
      <ModelPill
        variant="quiet"
        modelId={modelId}
        className="inline-block max-w-full"
      />
    </div>
  )
}

function InFlightTile({ entry }: { entry: ModalEntry }) {
  if (entry.kind !== 'in-flight-image' && entry.kind !== 'in-flight-video') return null
  const isVideo = entry.kind === 'in-flight-video'
  const isAnimating = entry.kind === 'in-flight-video' && entry.mode === 'animating'
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-broll-500/20"
      style={aspectStyle(entry.aspectRatio)}
    >
      <GeneratingMediaFill
        kind={isVideo ? 'video' : 'image'}
        modelId={entry.modelId}
        prompt={entry.prompt}
        messages={isAnimating ? ANIMATE_MESSAGES : undefined}
      />
    </div>
  )
}

// A standalone 9:16 in-flight placeholder tile — the same face as the card the
// generation was fired from (see components/GeneratingMedia). The Continuous
// frame/clip modals import this so a generating keyframe or clip
// reads as a real card in the gallery grid rather than a flat text row.
export function PendingMediaTile(props: GeneratingMediaProps & { aspectRatio?: string }) {
  return <PendingMedia {...props} />
}

// Shared modal video player — the Line-by-Line playback behaviour (hover
// autoplay muted; the top-left button plays with sound; a mute toggle appears
// while playing/unmuted). No native controls, so it reads the same as the
// Line-by-Line gallery tiles. Children are overlaid (action stack, duration
// badge). Used by the Continuous clip modal so its video playback matches
// Line-by-Line.
export function ModalVideoPlayer({
  url,
  children,
  actions,
  className = 'border-ink/10',
  onClick,
}: {
  url: string | null | undefined
  children?: React.ReactNode
  // The hover action column, kept a separate slot from `children` so a caller
  // can position it against the badges. Both stay on screen while the clip
  // plays — the actions used to step aside and it just meant pausing to reach
  // Download.
  actions?: React.ReactNode
  // Border/ring classes only — the frame's own layout classes are fixed. Used
  // by the Continuous take gallery to mark the picked cover.
  className?: string
  onClick?: () => void
}) {
  const inline = useInlineVideo()
  const { hovering, unmuted, togglePlay, toggleMute } = inline
  return (
    <div
      {...inline.hoverProps}
      onClick={onClick}
      className={`group relative overflow-hidden rounded-2xl border bg-black ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {url ? (
        <video
          {...inline.videoProps}
          src={url}
          preload="metadata"
          className="aspect-[9/16] w-full object-cover"
        />
      ) : (
        <div className="flex aspect-[9/16] w-full items-center justify-center"><Spinner className="h-4 w-4 text-white/40" /></div>
      )}
      {url && (
        <button
          type="button"
          title={inline.watching ? 'Pause' : 'Play with sound'}
          onClick={togglePlay}
          className="absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
        >
          {inline.watching ? <Pause className="h-3 w-3 fill-white" /> : <Play className="h-3 w-3 fill-white" />}
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
      {actions}
      {children}
    </div>
  )
}

// ─── A generation that didn't land ───────────────────────────────────────
//
// Two states wear this, and one field tells them apart: does the entry still
// hold a kie taskId?
//
//   RESUMABLE — kie RAN it, and billed for it, and we lost the result on the
//   way in: the download stalled, this browser couldn't decode the blob, the
//   Wi-Fi dropped between kie finishing and the file landing. Retry re-enters
//   the FINISH half only (poll → download → save), so it costs nothing, and
//   kie keeps a result for 3 days. That isn't a failure, it's an unfinished
//   generation — so it doesn't wear the red alarm, it says outright that
//   retrying is free, and DISMISS TAKES TWO CLICKS, because dismissing is the
//   one move that really does throw a paid clip away.
//
//   DEAD — the generation never reached kie. Nothing was charged, Retry fires
//   a fresh one, and Dismiss costs nothing, so it stays one click.
//
// Shared with the Continuous frame/clip modals (InFlightFailureRow below) —
// the same entry can fail in either place and must read the same.

const RESUMABLE_PROMISE = 'Retry is free. kie.ai already made this one.'

// Retry + Dismiss, with the two-click arming a resumable entry needs. Reverts
// after 3s, exactly like TileDeleteButton — the app's one destructive idiom.
function FailureActions({
  resumable,
  onRetry,
  onDismiss,
  compact = false,
}: {
  resumable: boolean
  onRetry: () => void
  onDismiss: () => void
  compact?: boolean
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  const handleDismiss = () => {
    if (resumable && !armed) {
      setArmed(true)
      return
    }
    onDismiss()
  }
  const dismissTitle = resumable
    ? (armed ? 'Discard the clip kie.ai is holding' : 'Discard · kie.ai is holding this one for 3 days')
    : 'Dismiss'

  if (compact) {
    return (
      <>
        <button
          type="button"
          title={resumable ? 'Retry · free, picks up the finished file' : 'Retry'}
          onClick={onRetry}
          className="shrink-0 rounded-full p-1 text-ink-400 transition-colors hover:bg-ink/10 hover:text-ink-200"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={dismissTitle}
          onClick={handleDismiss}
          className={`shrink-0 rounded-full transition-colors ${
            armed
              ? 'bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-200 light:text-red-800'
              : 'p-1 text-ink-400 hover:bg-ink/10 hover:text-ink-200'
          }`}
        >
          {armed ? 'Discard?' : <X className="h-3.5 w-3.5" />}
        </button>
      </>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        title={resumable ? 'Picks up the file kie.ai already made, no new generation' : undefined}
        onClick={onRetry}
        className="flex items-center gap-1 rounded-full border border-white/15 bg-broll-500 px-2.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-broll-400"
      >
        <RefreshCw className="h-3 w-3" />
        Retry
      </button>
      <button
        type="button"
        title={dismissTitle}
        onClick={handleDismiss}
        className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ${
          armed
            ? 'border-red-500/40 bg-red-500/20 text-red-200 light:text-red-800'
            : 'border-ink/10 bg-ink/[0.04] text-ink-300 hover:bg-ink/[0.08]'
        }`}
      >
        {armed ? 'Discard?' : <><X className="h-3 w-3" />Dismiss</>}
      </button>
    </div>
  )
}

// The compact row form, for the Continuous frame/clip modals (three
// hand-rolled copies of it before this).
export function InFlightFailureRow({
  error,
  resumable,
  onRetry,
  onDismiss,
}: {
  error?: string | null
  resumable: boolean
  onRetry: () => void
  onDismiss: () => void
}) {
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border px-3 py-2 ${
        resumable ? 'border-amber-500/25 bg-amber-500/10' : 'border-red-500/20 bg-red-500/10'
      }`}
    >
      <AlertCircle
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${resumable ? 'text-amber-400 light:text-amber-700' : 'text-red-400 light:text-red-600'}`}
      />
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] leading-relaxed ${resumable ? 'text-amber-200 light:text-amber-800' : 'text-red-300 light:text-red-700'}`}>
          {error}
        </p>
        {resumable && <p className="mt-0.5 text-[10px] leading-relaxed text-ink-400">{RESUMABLE_PROMISE}</p>}
      </div>
      <FailureActions compact resumable={resumable} onRetry={onRetry} onDismiss={onDismiss} />
    </div>
  )
}

// The tile form, for the per-card modal gallery.
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
  const resumable = !!entry.resumable
  return (
    <div
      className={`relative overflow-hidden rounded-lg border ${
        resumable
          ? 'border-amber-500/40 bg-gradient-to-br from-amber-500/[0.1] to-ink-950'
          : 'border-red-500/40 bg-gradient-to-br from-red-500/[0.1] to-ink-950'
      }`}
      style={aspectStyle(entry.aspectRatio)}
    >
      <div
        className={`absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider backdrop-blur ${
          resumable ? 'bg-amber-500/30 text-amber-100 light:text-amber-900' : 'bg-red-500/30 text-red-100 light:text-red-900'
        }`}
      >
        {resumable ? 'Not saved' : 'Failed'}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
        <AlertCircle className={`h-5 w-5 ${resumable ? 'text-amber-300 light:text-amber-700' : 'text-red-300 light:text-red-700'}`} />
        <p className={`line-clamp-3 text-[10px] leading-relaxed ${resumable ? 'text-amber-200 light:text-amber-800' : 'text-red-200 light:text-red-800'}`}>
          {entry.error}
        </p>
        {resumable && <p className="text-[10px] leading-relaxed text-ink-300">{RESUMABLE_PROMISE}</p>}
        <FailureActions resumable={resumable} onRetry={onRetry} onDismiss={onDismiss} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6">
        <p className="line-clamp-1 text-[10px] text-zinc-400">{entry.prompt}</p>
      </div>
    </div>
  )
}

// ─── Shared bits ─────────────────────────────────────────────────────────

// Reference Images slot card — Bank-picker-style. Same outer shell as
// the ModelPicker rows: rounded-xl border + bg-ink/[0.02] + p-3 with an
// icon avatar on the left. Click opens the script-level BankPicker.
export function ReferenceSlotCard({
  icon,
  accentClass,
  kind,
  name,
  note,
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
  // Trailing detail on the kind line — today the product's extra angles
  // ('· +2 angles'), which attach automatically behind the hero shot.
  note?: string | null
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
          <span className="truncate text-[11px] font-medium tracking-tight text-ink-400">
            {kind}
            {note && <span className="text-gold-400 light:text-gold-600"> · {note}</span>}
          </span>
        </div>
      </button>
      {hasRef && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleActive() }}
          title={active ? 'Active · click to disable' : 'Inactive · click to enable'}
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

// Product photo strip — which of the bank row's photos this card sends.
//
// A product can hold several shots of ONE object (sealed wrapper, unwrapped,
// box open). Attaching all of them puts two products in the frame: a scene of
// someone eating the bar came back with the bite happening beside an identical
// sealed bar, because both photos went in. So the storyboard picks the state
// its shot is actually in, and this row is where the member overrides it.
//
// Renders nothing for a single-photo product — there's nothing to choose.
export function ProductPhotoRow({
  photos,
  selection,
  onChange,
  dimmed,
}: {
  photos: string[]
  selection: number[]
  onChange: (next: number[]) => void
  dimmed?: boolean
}) {
  if (photos.length < 2) return null
  const toggle = (index: number) => {
    if (selection.includes(index)) {
      // Never leave a product-on card with no photo — the last one stays.
      if (selection.length === 1) return
      onChange(selection.filter((i) => i !== index))
    } else {
      onChange([...selection, index])
    }
  }
  return (
    <div className={`flex flex-col gap-1.5 ${dimmed ? 'opacity-50' : ''}`}>
      {/* Small-caps, because this row lives inside the References card now and a
          13px sentence-case label under a 13px card title reads as a second
          title. No dot: the picked photo is lit and the others are dimmed, which
          says "filled" far louder than 6px could. */}
      <SectionLabel
        label="Product photo"
        right={(
          <span className="text-[10px] tracking-tight text-ink-600">
            {selection.length === 1 ? 'One state per shot' : `${selection.length} attached`}
          </span>
        )}
      />
      <div className="flex flex-wrap gap-2">
        {photos.map((ref, i) => (
          <ProductPhotoTile
            key={`${ref}-${i}`}
            imageRef={ref}
            index={i}
            active={selection.includes(i)}
            onClick={() => toggle(i)}
          />
        ))}
      </div>
    </div>
  )
}

function ProductPhotoTile({
  imageRef,
  index,
  active,
  onClick,
}: {
  imageRef: string
  index: number
  active: boolean
  onClick: () => void
}) {
  const url = useAssetUrl(imageRef)
  return (
    <button
      type="button"
      onClick={onClick}
      title={index === 0 ? 'Hero packshot' : `Angle ${index}`}
      /* 64px — the shared reference-tile footprint (see refInputParts'
         ImageTile), so the product angles and the extra references below them
         read as one strip of thumbnails rather than two sizes of the same idea. */
      className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border transition-colors ${
        active
          ? 'border-gold-500/60 ring-1 ring-inset ring-gold-500/25'
          : 'border-ink/10 opacity-45 hover:opacity-80'
      }`}
    >
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      {active && (
        <span className="absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-gold-500/90">
          <Check className="h-2.5 w-2.5 text-black" strokeWidth={3} />
        </span>
      )}
    </button>
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
  function handleBankPick(item: AnyBankItem) {
    let url: string | undefined
    if ('productImage' in item) url = item.productImage
    else if ('characterImage' in item) url = item.sheetImage || item.characterImage
    else if ('imageUrl' in item) url = (item as BRoll).imageUrl
    if (url) onAdd({ dataUrl: url, label: 'reference' })
  }

  return (
    <div className={`flex flex-col gap-1.5 ${dimmed ? 'opacity-50' : ''}`}>
      {/* The group's name and its count now live on a SectionLabel rather than
          being pinned into the add card's own corners — inside the References
          card there's a header row to carry them, which is the whole point of
          the card. No dot: extra refs never gate a generation. */}
      <SectionLabel
        label="Extra references"
        right={(
          <span className="text-[10px] tabular-nums tracking-tight text-ink-600">
            {refs.length}/{max}
          </span>
        )}
      />

      {/* Playground's reference strip, exactly: 64px square thumbnails with the
          dashed add tile joined into the same wrapping row. It was a four-up
          `grid` of `aspect-square` cells over a full-width dashed slab, which in
          a half-modal column made every attached photo ~110px — three times the
          size of the same reference in Playground, and the biggest thing in a
          panel where the prompt is the point. */}
      <div className="flex flex-wrap gap-1.5">
        {refs.map((r, i) => (
          <RefThumb key={i} refStr={r.dataUrl} onRemove={() => onRemove(i)} />
        ))}
        {remaining > 0 && (
          <AddTile triggerRef={triggerRef} onClick={() => setMenuOpen((v) => !v)} />
        )}
      </div>
      {remaining > 0 && (
        <SlotActionMenu
          anchorRef={triggerRef}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onUpload={() => fileInputRef.current?.click()}
          onPickFromBank={() => setPickerOpen(true)}
        />
      )}

      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
      <BankPicker
        bankType="products"
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleBankPick}
        tabs={['products', 'models', { type: 'brolls', filter: (it) => !!(it as BRoll).imageUrl }]}
        expandProductImages
      />
    </div>
  )
}

// A single extra-reference thumbnail. Resolves asset:// refs through the asset
// store; data: / http refs pass through, then hands the resolved URL to the
// shared Playground tile so the two surfaces can't drift apart again.
function RefThumb({ refStr, onRemove }: { refStr: string; onRemove: () => void }) {
  const url = useAssetUrl(refStr)
  if (!url) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-ink/10 bg-ink/[0.02]">
        <Spinner className="h-4 w-4 text-ink-500" />
      </div>
    )
  }
  return <RefImageTile src={url} onRemove={onRemove} />
}

// ─── Helpers ─────────────────────────────────────────────────────────────
// (startOfDay + day labelling now live in utils/history — imported above.)

function aspectStyle(ar: string): React.CSSProperties {
  const [w, h] = ar.split(':').map(Number)
  if (!w || !h) return { aspectRatio: '9 / 16' }
  return { aspectRatio: `${w} / ${h}` }
}
