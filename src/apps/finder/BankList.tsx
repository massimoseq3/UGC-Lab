import { useState, useMemo, useRef, useEffect, type ElementType } from 'react'
import { Package, UserRound, FileText, Mic, Film, Plus, Video, Download, ChevronDown, Sparkles, Check, LayoutGrid, Copy, Bookmark, Star, Palette, Eye, Heart, MessageCircle, Share2 } from 'lucide-react'
import Spinner from '../../components/Spinner'
import type { Product, Model, Script, VoicePreset, BRoll, StylePreset, SwipeItem } from '../../stores/types'
import type { BankType } from '../../utils/constants'
import type { ModelFilter } from './Finder'
import { useBankStore } from '../../stores/bankStore'
import { useAppStore } from '../../stores/appStore'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { getAsBase64, isAssetRef } from '../../utils/assetStore'
import { downloadImage } from '../../utils/downloadImage'
import { copyToClipboard } from '../../utils/clipboard'
import GeneratingBackdrop from '../../components/GeneratingBackdrop'
import { TileActionStack, TileActionButton, TileStarButton, TileDeleteButton } from '../../components/tileActions'
import { sortByOrder, type SortOrder } from './bankSort'
// The swipe file is Outliers' data shown in the Bank, and its cards have to
// read the same in both places — one formatter, not a second copy that drifts.
import { formatCount } from '../discover/services/scoring'
import SwipeDetail from './SwipeDetail'
import { groupByDay, sectionLabel } from '../../utils/history'

// Custom sort dropdown — replaces the native <select> so the menu is themed
// (not the stock OS popup) and the trigger font matches the bank toggle.
export function SortControl({ value, onChange, options }: { value: SortOrder; onChange: (v: SortOrder) => void; options: { value: SortOrder; label: string }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-full border border-ink/10 bg-ink/[0.04] pl-5 pr-4 text-[13px] font-medium tracking-tight text-ink-300 transition-colors hover:bg-ink/[0.08]"
      >
        <span className="truncate">{current?.label ?? 'Sort'}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ink-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 min-w-[184px] rounded-2xl border border-ink/10 bg-surface-2 p-1.5 shadow-xl shadow-black/30">
          {options.map((o) => {
            const active = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`flex w-full items-center justify-between gap-3 rounded-full px-3.5 py-2 text-[13px] font-medium tracking-tight transition-colors ${
                  active ? 'bg-ink/[0.06] text-ink-100' : 'text-ink-400 hover:bg-ink/[0.04] hover:text-ink-200'
                }`}
              >
                <span className="truncate">{o.label}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-ink-200" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface BankListProps {
  bankType: BankType
  onEdit: (id: string) => void
  onAdd: () => void
  sort: SortOrder
  // Influencers bank sub-filter (All / Portraits / Influencer Sheets).
  modelFilter?: ModelFilter
  inFlightProductIds?: Set<string>
  onBulkProductFiles?: (files: File[]) => void
}

// undefined → legacy product (predates the draft system, no dot).
// false → draft awaiting user review (orange dot).
// true → confirmed via Save in the form (green dot).
function productState(p: Product): 'legacy' | 'draft' | 'confirmed' {
  if (p.confirmed === undefined) return 'legacy'
  return p.confirmed ? 'confirmed' : 'draft'
}

function ProductCard({ item, onEdit, onDelete, inFlight }: { item: Product; onEdit: () => void; onDelete: () => void; inFlight?: boolean }) {
  const [confirm, setConfirm] = useState(false)
  const resolvedImage = useAssetUrl(item.productImage)
  const toggleStar = useBankStore((s) => s.toggleStar)
  const state = productState(item)
  const photoCount = 1 + (item.extraImages?.length ?? 0)

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!resolvedImage) return
    downloadImage(resolvedImage, `product-${item.productName || item.id.slice(0, 8)}`)
  }

  return (
    <div
      onClick={onEdit}
      className="group relative aspect-square cursor-pointer overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.03] transition-all hover:border-ink/15 hover:-translate-y-px card-soft-shadow"
    >
      {resolvedImage ? (
        // lazy + async decode: bank tiles are full-resolution GENERATIONS —
        // a 4K still drawn into a 200px square — and a populated bank scrolls
        // for hundreds of rows. Decoding them all up front is the difference
        // between opening the Bank and stalling on it.
        <img src={resolvedImage} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/[0.04]">
          <Package className="h-12 w-12 text-ink-800" strokeWidth={1} />
        </div>
      )}
      {/* Top-left status indicator: Extracting badge (while in-flight) OR draft/confirmed dot */}
      {inFlight ? (
        <span className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-emerald-300 backdrop-blur-sm">
          <Spinner className="h-2.5 w-2.5" />
          Extracting
        </span>
      ) : state !== 'legacy' ? (
        <span
          title={state === 'draft' ? 'Unconfirmed draft — open and save to confirm' : 'Confirmed'}
          className={`absolute left-2 top-2 z-10 h-2 w-2 rounded-full ring-2 ${
            state === 'draft'
              ? 'bg-orange-400 ring-orange-400/20 shadow-[0_0_8px_rgba(251,146,60,0.5)]'
              : 'bg-emerald-400 ring-emerald-400/20 shadow-[0_0_8px_rgba(74,222,128,0.5)]'
          }`}
        />
      ) : null}
      {/* Bottom info overlay — product name wraps to two centered lines. */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-3 pb-2.5 pt-10 text-center">
        <span className="block line-clamp-2 text-[13px] font-semibold leading-tight tracking-tight text-zinc-100">{item.productName}</span>
        {/* Extra angles are only visible inside the form and the ref pickers —
            this line is what tells you a product carries more than one shot. */}
        {photoCount > 1 && (
          <span className="mt-0.5 block text-[10px] font-medium tracking-tight text-zinc-400">{photoCount} photos</span>
        )}
      </div>
      {/* Hover action stack — star · download · delete. */}
      <TileActionStack forceVisible={confirm}>
        <TileStarButton starred={!!item.starred} onToggle={() => toggleStar('products', item.id)} />
        {resolvedImage && (
          <TileActionButton title="Download image" onClick={handleDownload}>
            <Download className="h-4 w-4" />
          </TileActionButton>
        )}
        <TileDeleteButton onDelete={onDelete} onArmedChange={setConfirm} />
      </TileActionStack>
    </div>
  )
}

function ModelCard({ item, onEdit, onDelete }: { item: Model; onEdit: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [copied, setCopied] = useState(false)
  const toggleStar = useBankStore((s) => s.toggleStar)
  const resolvedImage = useAssetUrl(item.characterImage)
  // A saved character sheet stamps `sheetImage`; surface it with a badge.
  const isSheet = !!item.sheetImage
  // A preset is a saved recipe with no generated image. Instead of a blank
  // placeholder it gets a still of the studio "generating" tile as its cover.
  const isPreset = !item.characterImage
  // Detected from the image's natural dimensions on load. Landscape (16:9)
  // entries — typically character sheets — span three portrait columns.
  const [landscape, setLandscape] = useState(false)

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!resolvedImage) return
    downloadImage(resolvedImage, `model-${item.name || item.id.slice(0, 8)}`)
  }

  // Copy the influencer's DNA profile to the clipboard as formatted JSON — the
  // same fields the detail view renders, prefixed with the name so a pasted
  // prompt is self-describing.
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const payload = { name: item.name, ...(item.jsonProfile ?? {}) }
    const ok = await copyToClipboard(JSON.stringify(payload, null, 2))
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div
      onClick={onEdit}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.03] transition-all hover:border-ink/15 hover:-translate-y-px card-soft-shadow ${landscape ? 'col-span-3' : ''}`}
    >
      <div className={`relative w-full ${landscape ? 'aspect-video' : 'aspect-[9/16]'}`}>
        {resolvedImage ? (
          <img
            src={resolvedImage}
            alt=""
            onLoad={(e) => setLandscape(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight)}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : isPreset ? (
          // A preset has no generated image — reuse the studio's "generating"
          // backdrop (drifting influencers blobs) as its cover with a centered
          // person glyph, so it reads as a recipe rather than a blank card.
          <>
            <GeneratingBackdrop family="influencers" />
            <div className="absolute inset-0 flex items-center justify-center">
              <UserRound className="h-12 w-12 text-influencers-100" strokeWidth={1} />
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/[0.04]">
            <UserRound className="h-12 w-12 text-ink-800" strokeWidth={1} />
          </div>
        )}
      </div>
      {/* Sheet badge — top-left, mirrors the studio gallery */}
      {isSheet && (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-zinc-100 backdrop-blur-sm">
          <LayoutGrid className="h-2.5 w-2.5" strokeWidth={2} />
          Sheet
        </span>
      )}
      {/* Preset badge — top-left, marks a saved recipe (no generated image) */}
      {isPreset && (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-influencers-500/25 px-2 py-0.5 text-[10px] font-medium text-influencers-100 backdrop-blur-sm">
          <Bookmark className="h-2.5 w-2.5" strokeWidth={2} />
          Preset
        </span>
      )}
      {/* Bottom info overlay — same gradient pattern as ProductCard */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-3 pt-10">
        <span className="block truncate text-center text-sm font-semibold tracking-tight text-zinc-100">{item.name}</span>
      </div>
      {/* Hover action stack — star · download · copy · delete. */}
      <TileActionStack forceVisible={confirm}>
        <TileStarButton starred={!!item.starred} onToggle={() => toggleStar('models', item.id)} />
        {resolvedImage && (
          <TileActionButton title="Download image" onClick={handleDownload}>
            <Download className="h-4 w-4" />
          </TileActionButton>
        )}
        {item.jsonProfile && (
          <TileActionButton title={copied ? 'Copied!' : 'Copy character prompt (JSON)'} onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
          </TileActionButton>
        )}
        <TileDeleteButton onDelete={onDelete} onArmedChange={setConfirm} />
      </TileActionStack>
    </div>
  )
}

function ScriptCard({ item, onEdit, onDelete }: { item: Script; onEdit: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const toggleStar = useBankStore((s) => s.toggleStar)
  const getProductById = useBankStore((s) => s.getProductById)
  const linked = item.linkedProductId ? getProductById(item.linkedProductId) : null
  // Legacy items predate `kind` — treat them as scripts.
  const badge = item.kind === 'reverse-engineer'
    ? { label: 'SCENES', className: 'bg-fuchsia-500/15 text-fuchsia-300 light:text-fuchsia-700 border-fuchsia-500/20' }
    : item.kind === 'style'
      ? { label: 'STYLE', className: 'bg-sky-500/15 text-sky-300 light:text-sky-700 border-sky-500/20' }
      : { label: 'SCRIPT', className: 'bg-scripts-500/15 text-scripts-300 border-scripts-500/20' }
  return (
    <div
      onClick={onEdit}
      className="group relative flex aspect-[9/16] cursor-pointer flex-col overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.03] p-4 transition-all hover:border-ink/15 hover:-translate-y-px card-soft-shadow"
    >
      {/* Header: badge + title */}
      <div className="flex flex-col gap-2">
        <span className={`w-fit shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-widest ${badge.className}`}>
          {badge.label}
        </span>
        <span className="line-clamp-2 text-sm font-semibold leading-snug tracking-tight text-ink-100">{item.title}</span>
      </div>
      {/* Full script preview — fills the card, fades out at the bottom */}
      <div className="relative mt-3 flex-1 overflow-hidden">
        <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-ink-400">{item.scriptText || 'Empty script'}</p>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface-1 to-transparent" />
      </div>
      {/* Footer: linked product + date */}
      <div className="mt-2 flex items-center gap-2">
        {linked && <span className="truncate text-[10px] text-ink-600">{linked.productName}</span>}
        <span className="shrink-0 text-[10px] text-ink-700">{new Date(item.createdAt).toLocaleDateString()}</span>
      </div>
      {/* Hover action stack — star · delete. Text-card styling (ink chrome, not
          the image cards' white-on-black pills); star stays visible once set. */}
      <TileActionStack forceVisible={confirm}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleStar('scripts', item.id) }}
          title={item.starred ? 'Unstar' : 'Star — starred items show first when picking from banks'}
          aria-pressed={item.starred}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-ink/5 ${
            item.starred ? 'text-amber-400' : 'text-ink-700 hover:text-amber-400'
          }`}
        >
          <Star className={`h-4 w-4 ${item.starred ? 'fill-current' : ''}`} />
        </button>
        <TileDeleteButton variant="chrome" onDelete={onDelete} onArmedChange={setConfirm} />
      </TileActionStack>
    </div>
  )
}

function BRollCard({ item, onEdit, onDelete }: { item: BRoll; onEdit: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const toggleStar = useBankStore((s) => s.toggleStar)
  // Landscape (16:9) stills span three portrait columns, mirroring the
  // Influencers tab's character sheets. Detected from natural media dimensions.
  const [landscape, setLandscape] = useState(false)
  const promptPreview = item.prompt.length > 80 ? item.prompt.slice(0, 80) + '…' : item.prompt
  const videoCount = item.videos?.length ?? (item.videoUrl ? 1 : 0)
  // Video-only brolls (text-to-video saves) have no still — fall back to the
  // first video and let the browser show its first frame as the thumbnail.
  const hasImage = !!item.imageUrl
  const firstVideoUrl = item.videos?.[0]?.url ?? item.videoUrl
  const resolvedImage = useAssetUrl(hasImage ? item.imageUrl : undefined)
  const resolvedVideo = useAssetUrl(!hasImage ? firstVideoUrl : undefined)
  const isVideoOnly = !hasImage && !!resolvedVideo

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    const target = resolvedImage ?? resolvedVideo
    if (!target) return
    downloadImage(target, `broll-${item.id.slice(0, 8)}`, resolvedImage ? 'png' : 'mp4')
  }

  // Copies the FULL prompt, not the truncated card preview.
  const [copied, setCopied] = useState(false)
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!item.prompt) return
    await copyToClipboard(item.prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Send the still to Playground in video mode as the start frame.
  const handleAnimate = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!item.imageUrl) return
    let dataUri = item.imageUrl
    if (isAssetRef(item.imageUrl)) {
      const asset = await getAsBase64(item.imageUrl)
      if (!asset) return
      dataUri = `data:${asset.mimeType};base64,${asset.base64}`
    }
    useAppStore.getState().sendToApp({
      targetApp: 'playground',
      targetField: 'videoStartFrame',
      data: { imageUrl: dataUri, prompt: item.prompt },
    })
  }

  return (
    <div onClick={onEdit} className={`group relative cursor-pointer overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.03] transition-all hover:border-ink/15 hover:bg-ink/[0.05] hover:-translate-y-px card-soft-shadow ${landscape ? 'col-span-2 sm:col-span-3' : ''}`}>
      {/* Thumbnail — portrait by default; landscape stills go wide (aspect-video)
          and span three columns, matching the Influencers sheet behaviour. */}
      <div className={`relative w-full overflow-hidden ${landscape ? 'aspect-video' : 'aspect-[9/16]'}`}>
        {resolvedImage ? (
          <img
            src={resolvedImage}
            alt=""
            onLoad={(e) => setLandscape(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight)}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : isVideoOnly ? (
          <video
            src={resolvedVideo}
            preload="metadata"
            muted
            playsInline
            onLoadedMetadata={(e) => setLandscape(e.currentTarget.videoWidth > e.currentTarget.videoHeight)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-ink/[0.04]">
            <Film className="h-10 w-10 text-ink-800" strokeWidth={1} />
          </div>
        )}
        {/* Video badge */}
        {videoCount > 0 && (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-emerald-400 backdrop-blur-sm">
            <Video className="h-2.5 w-2.5" />
            {videoCount} {videoCount === 1 ? 'video' : 'videos'}
          </span>
        )}
        {/* Hover action stack — star · download · copy · delete. */}
        <TileActionStack forceVisible={confirm}>
          <TileStarButton starred={!!item.starred} onToggle={() => toggleStar('brolls', item.id)} />
          <TileActionButton title="Download image" onClick={handleDownload}>
            <Download className="h-4 w-4" />
          </TileActionButton>
          {promptPreview && (
            <TileActionButton title={copied ? 'Prompt copied' : 'Copy prompt'} onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
            </TileActionButton>
          )}
          <TileDeleteButton onDelete={onDelete} onArmedChange={setConfirm} />
        </TileActionStack>
        {/* Animate in Playground — rounded pill (matching the Send-to buttons),
            floats over the card bottom on hover, image cards only. */}
        {hasImage && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center p-2.5 opacity-0 transition-all group-hover:opacity-100 touch:opacity-100">
            <button
              onClick={handleAnimate}
              title="Open Playground in video mode with this image as the start frame"
              className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-playground-500/40 bg-playground-500/90 px-3.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-playground-500"
            >
              <Film className="h-3.5 w-3.5" />
              Animate in Playground
            </button>
          </div>
        )}
      </div>
      {/* Info — gradient overlay, same pattern as the Influencer cards */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-3 pt-10 text-center">
        <p className="text-[10px] font-medium leading-snug text-zinc-100 line-clamp-2">{promptPreview}</p>
      </div>
    </div>
  )
}

// One tile of a style card's reference mosaic.
function StyleThumb({ refId }: { refId: string }) {
  const url = useAssetUrl(refId)
  return url
    ? <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
    : <div className="h-full w-full bg-ink/[0.05]" />
}

function StyleCard({ item, onEdit, onDelete }: { item: StylePreset; onEdit: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [copied, setCopied] = useState(false)
  const toggleStar = useBankStore((s) => s.toggleStar)
  // Up to four reference frames tile the cover; a hand-written style has none
  // and shows its brief as the card face instead.
  const thumbs = (item.thumbRefs ?? []).slice(0, 4)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await copyToClipboard(item.brief)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      onClick={onEdit}
      className="group relative flex aspect-[9/16] cursor-pointer flex-col overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.03] transition-all hover:border-ink/15 hover:-translate-y-px card-soft-shadow"
    >
      {thumbs.length > 0 ? (
        <div className={`absolute inset-0 grid gap-px ${thumbs.length === 1 ? '' : thumbs.length === 2 ? 'grid-rows-2' : 'grid-cols-2 grid-rows-2'}`}>
          {thumbs.map((ref) => (
            <StyleThumb key={ref} refId={ref} />
          ))}
        </div>
      ) : (
        // No reference frames (a hand-written style) — the brief itself is the
        // card face, fading out above the name overlay like the Script cards.
        <div className="absolute inset-0 flex flex-col p-4 pb-16">
          <Palette className="h-6 w-6 shrink-0 text-ink-700" strokeWidth={1.25} />
          <div className="relative mt-3 flex-1 overflow-hidden">
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-ink-400">{item.brief}</p>
          </div>
        </div>
      )}
      {/* Bottom overlay — name, plus a taste of the brief only when the face is
          taken up by thumbnails (otherwise the face already shows it). Same
          gradient chrome as the image-backed cards. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-3 pt-12">
        <span className="block truncate text-[13px] font-semibold tracking-tight text-zinc-100">{item.name}</span>
        {thumbs.length > 0 && (
          <span className="mt-0.5 block line-clamp-2 text-[10px] leading-snug text-zinc-400">{item.brief}</span>
        )}
      </div>
      {/* Hover action stack — star · copy · delete. */}
      <TileActionStack forceVisible={confirm}>
        <TileStarButton starred={!!item.starred} onToggle={() => toggleStar('styles', item.id)} />
        <TileActionButton title={copied ? 'Brief copied' : 'Copy style brief'} onClick={handleCopy}>
          {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
        </TileActionButton>
        <TileDeleteButton onDelete={onDelete} onArmedChange={setConfirm} />
      </TileActionStack>
    </div>
  )
}

/**
 * One saved ad in the swipe file.
 *
 * Opens the same detail view Outliers does, never an edit form: a swipe is a
 * record of somebody else's ad, not a document of yours, so there is nothing
 * here to edit — but there is plenty to DO with it, and the point of filing an
 * ad is tearing it down later. `SwipeDetail` adapts the row back into a
 * DiscoverResult and hands it to the one `ResultDetailModal`, so Analyze Ad,
 * Remix Transcript and the original permalink are all where they were when you
 * saved it. It used to open the permalink straight away, which made the swipe
 * file a bookmarks folder.
 *
 * The thumbnail is our own stored asset (see SwipeItem) — every URL on the row
 * is a signed CDN link that expires, so the picture is the one part guaranteed
 * still to be there in a month.
 *
 * Shaped exactly like the Outliers card it was saved from: the picture in its
 * own 4:5 frame, then a static block of author / caption / numbers underneath.
 * It used to read its caption off a gradient laid over the frame, which put
 * text across the ad's own hook — the one thing you saved it for — and left the
 * snapshotted stats with nowhere to live.
 */
function SwipeCard({ item, onDelete }: { item: SwipeItem; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const toggleStar = useBankStore((s) => s.toggleStar)
  const url = useAssetUrl(item.thumbRef ?? '')

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    // The transcript is the reusable half; fall back to the caption when the
    // ad had no captions to pull.
    await copyToClipboard(item.transcript || item.caption)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Only rendered when the platform gave us numbers — Meta publishes none, so
  // a Meta swipe shows its runtime badge and nothing else.
  const hasStats = item.views != null

  return (
    <>
    <div
      onClick={() => setOpen(true)}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.02] transition-all hover:border-ink/15 hover:-translate-y-px card-soft-shadow"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-black">
        {url
          ? <img src={url} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-contain" />
          : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Bookmark className="h-6 w-6 text-white/20" strokeWidth={1.5} />
            </div>
          )}

        <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
          {item.outlierMultiple != null && (
            <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-black shadow-sm">
              {item.outlierMultiple >= 10 ? Math.round(item.outlierMultiple) : item.outlierMultiple.toFixed(1)}x
            </span>
          )}
          {item.daysRunning != null && (
            <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
              {item.daysRunning}d running
            </span>
          )}
        </div>

        <TileActionStack forceVisible={confirm}>
          <TileStarButton starred={!!item.starred} onToggle={() => toggleStar('swipes', item.id)} />
          <TileActionButton
            title={copied ? 'Copied' : item.transcript ? 'Copy transcript' : 'Copy caption'}
            onClick={handleCopy}
          >
            {copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
          </TileActionButton>
          <TileDeleteButton onDelete={onDelete} onArmedChange={setConfirm} />
        </TileActionStack>
      </div>

      <div className="flex flex-col gap-2 p-2.5">
        <span className="truncate text-[13px] font-semibold tracking-tight text-ink-200">
          {item.platform === 'tiktok' ? `@${item.authorHandle}` : item.authorName}
        </span>
        {/* Rendered even when the count is missing, so the caption below starts
            at the same height on every card in the row. */}
        <span className="-mt-1.5 flex h-[14px] items-center gap-1 text-[10px] text-ink-600">
          {item.followerCount != null && (
            <>
              {item.platform === 'meta' && <Heart className="h-2.5 w-2.5 shrink-0" />}
              {formatCount(item.followerCount)} {item.platform === 'tiktok' ? 'followers' : 'likes'}
            </>
          )}
        </span>

        {/* Exactly two lines tall, whatever the caption — same reasoning as the
            Outliers grid: the numbers under it are read ACROSS the row. */}
        <p className="line-clamp-2 h-[3.25em] overflow-hidden text-[11px] leading-relaxed text-ink-500">
          {item.caption || 'No caption'}
        </p>

        {hasStats && (
          <div className="flex items-center justify-between gap-1 border-t border-ink/5 pt-2 text-[10px] text-ink-500">
            <SwipeStat icon={Eye} value={item.views} title="Views" strong />
            <SwipeStat icon={Heart} value={item.likes} title="Likes" />
            <SwipeStat icon={MessageCircle} value={item.comments} title="Comments" />
            <SwipeStat icon={Share2} value={item.shares} title="Shares" />
            <SwipeStat icon={Bookmark} value={item.saves} title="Saves" />
          </div>
        )}
      </div>
    </div>
    {open && <SwipeDetail item={item} onClose={() => setOpen(false)} />}
    </>
  )
}

/** One glyph-led figure in a swipe card's snapshotted engagement row. */
function SwipeStat({
  icon: Icon,
  value,
  title,
  strong = false,
}: {
  icon: ElementType
  value: number | undefined
  title: string
  strong?: boolean
}) {
  return (
    <span className={`flex items-center gap-0.5 ${strong ? 'text-ink-200' : ''}`} title={title}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="tabular-nums">{formatCount(value)}</span>
    </span>
  )
}

function SwipesList({ items, onDelete, sort }: { items: SwipeItem[]; onDelete: (id: string) => void; sort: SortOrder }) {
  const sorted = useMemo(() => sortByOrder(items, sort, (s) => s.authorName), [items, sort])
  return (
    // Five across, matching the Outliers grid: the card now carries a five-figure
    // engagement row, which stops being readable at six columns.
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {sorted.map((s) => (
        <SwipeCard key={s.id} item={s} onDelete={() => onDelete(s.id)} />
      ))}
    </div>
  )
}

function VoiceCard({ item, onEdit, onDelete }: { item: VoicePreset; onEdit: () => void; onDelete: () => void }) {
  return (
    <div onClick={onEdit} className="group flex cursor-pointer items-center gap-3 rounded-full border border-ink/5 bg-ink/[0.03] p-3 transition-colors hover:border-ink/10 hover:bg-ink/[0.05] card-soft-shadow">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink/5">
        <Mic className="h-5 w-5 text-ink-600" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold tracking-tight text-ink-200">{item.label}</span>
        <span className="text-xs text-ink-500">{item.voiceName}{item.gender ? ` · ${item.gender}` : ''}</span>
        <span className="truncate text-[10px] text-ink-600">
          {item.style} · {item.pace} · {item.accent}
        </span>
      </div>
      <div
        className="shrink-0 self-center"
        onClick={(e) => e.stopPropagation()}
      >
        <TileDeleteButton variant="chrome" onDelete={onDelete} />
      </div>
    </div>
  )
}

export default function BankList({ bankType, onEdit, onAdd, sort, modelFilter = 'all', inFlightProductIds, onBulkProductFiles }: BankListProps) {
  const products = useBankStore((s) => s.products)
  const models = useBankStore((s) => s.models)
  const scripts = useBankStore((s) => s.scripts)
  const voices = useBankStore((s) => s.voices)
  const brolls = useBankStore((s) => s.brolls)
  const styles = useBankStore((s) => s.styles)
  const swipes = useBankStore((s) => s.swipes)
  const deleteProduct = useBankStore((s) => s.deleteProduct)
  const deleteModel = useBankStore((s) => s.deleteModel)
  const deleteScript = useBankStore((s) => s.deleteScript)
  const deleteVoice = useBankStore((s) => s.deleteVoice)
  const deleteBRoll = useBankStore((s) => s.deleteBRoll)
  const deleteStyle = useBankStore((s) => s.deleteStyle)
  const deleteSwipe = useBankStore((s) => s.deleteSwipe)

  if (bankType === 'products') {
    return (
      <ProductsBankZone onBulkFiles={onBulkProductFiles}>
        {products.length === 0 ? (
          <EmptyState icon={Package} label="products" singular="product" onAdd={onAdd} />
        ) : (
          <ProductsList items={products} onEdit={onEdit} onDelete={deleteProduct} sort={sort} inFlightIds={inFlightProductIds} />
        )}
      </ProductsBankZone>
    )
  }

  if (bankType === 'models') {
    if (models.length === 0) return <EmptyState icon={UserRound} label="characters" singular="character" onAdd={onAdd} />
    // Sub-filter: portraits have no sheetImage, sheets do.
    const filtered =
      modelFilter === 'portraits' ? models.filter((m) => !m.sheetImage)
      : modelFilter === 'sheets' ? models.filter((m) => !!m.sheetImage)
      : models
    if (filtered.length === 0) {
      const label = modelFilter === 'sheets' ? 'character sheets' : 'portraits'
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ink/[0.04]">
            <UserRound className="h-7 w-7 text-ink-700" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium text-ink-500">No {label} yet</p>
        </div>
      )
    }
    return <ModelsList items={filtered} onEdit={onEdit} onDelete={deleteModel} sort={sort} />
  }

  if (bankType === 'scripts') {
    if (scripts.length === 0) return <EmptyState icon={FileText} label="scripts" singular="script" onAdd={onAdd} />
    return <ScriptsList items={scripts} onEdit={onEdit} onDelete={deleteScript} sort={sort} />
  }

  if (bankType === 'voices') {
    if (voices.length === 0) return <EmptyState icon={Mic} label="voice presets" singular="voice preset" onAdd={onAdd} />
    return (
      <div className="flex flex-col gap-2">
        {voices.map((v) => (
          <VoiceCard key={v.id} item={v} onEdit={() => onEdit(v.id)} onDelete={() => deleteVoice(v.id)} />
        ))}
      </div>
    )
  }

  if (bankType === 'styles') {
    if (styles.length === 0) return <EmptyState icon={Palette} label="visual styles" singular="visual style" onAdd={onAdd} />
    return <StylesList items={styles} onEdit={onEdit} onDelete={deleteStyle} sort={sort} />
  }

  if (bankType === 'swipes') {
    // No `onAdd`: a swipe file is filled from Outliers, never typed in here.
    if (swipes.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <Bookmark className="h-8 w-8 text-ink-700" strokeWidth={1.5} />
          <p className="text-sm text-ink-500">No saved ads yet</p>
          <p className="max-w-[300px] text-xs leading-relaxed text-ink-600">
            Save an ad from Outliers and it lands here — thumbnail, numbers and
            transcript kept, so it's still readable long after the links expire.
          </p>
        </div>
      )
    }
    return <SwipesList items={swipes} onDelete={deleteSwipe} sort={sort} />
  }

  // brolls
  if (brolls.length === 0) return <EmptyState icon={Film} label="b-rolls" singular="b-roll" onAdd={onAdd} />
  return <BRollsList items={brolls} onEdit={onEdit} onDelete={deleteBRoll} sort={sort} />
}

// Wraps the entire products view (empty-state OR grid) with a multi-file dropzone
// that funnels into the parent's bulk-add handler. Mirrors the dragDepth pattern
// used in ProductForm.tsx so nested children don't flicker the overlay.
function ProductsBankZone({ children, onBulkFiles }: { children: React.ReactNode; onBulkFiles?: (files: File[]) => void }) {
  const dragDepthRef = useRef(0)
  const [overlay, setOverlay] = useState(false)
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  if (!onBulkFiles) return <>{children}</>

  return (
    <div
      className="relative min-h-full"
      onDragEnter={(e) => { if (!hasFiles(e)) return; dragDepthRef.current += 1; setOverlay(true) }}
      onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault() }}
      onDragLeave={() => { dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (dragDepthRef.current === 0) setOverlay(false) }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        dragDepthRef.current = 0
        setOverlay(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) onBulkFiles(files)
      }}
    >
      {overlay && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-emerald-400/60 bg-emerald-500/10 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-medium text-emerald-200">
            <Sparkles className="h-4 w-4" />
            Drop image(s) to bulk-add products
          </div>
        </div>
      )}
      {children}
    </div>
  )
}

function ProductsList({ items, onEdit, onDelete, sort, inFlightIds }: { items: Product[]; onEdit: (id: string) => void; onDelete: (id: string) => void; sort: SortOrder; inFlightIds?: Set<string> }) {
  const sorted = useMemo(() => sortByOrder(items, sort, (p) => p.productName), [items, sort])
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
      {sorted.map((p) => (
        <ProductCard
          key={p.id}
          item={p}
          onEdit={() => onEdit(p.id)}
          onDelete={() => onDelete(p.id)}
          inFlight={inFlightIds?.has(p.id)}
        />
      ))}
    </div>
  )
}

function ModelsList({ items, onEdit, onDelete, sort }: { items: Model[]; onEdit: (id: string) => void; onDelete: (id: string) => void; sort: SortOrder }) {
  const sorted = useMemo(() => sortByOrder(items, sort, (m) => m.name), [items, sort])
  // Grid (not masonry) so landscape sheets can span three portrait columns via
  // col-span. `grid-flow-row-dense` packs the gaps a wide card would leave.
  // THREE across on a phone, where every other bank tab is two: a character
  // card is a portrait thumbnail and a name, so it reads fine at a third of a
  // 375px screen — and this is the tab you scroll looking for a face, where
  // half again as many faces per screen is the whole job. A landscape sheet
  // takes all three columns wherever it lands, phone included.
  return (
    <div className="grid grid-flow-row-dense grid-cols-3 items-start gap-3 lg:grid-cols-4 xl:grid-cols-6">
      {sorted.map((m) => (
        <ModelCard key={m.id} item={m} onEdit={() => onEdit(m.id)} onDelete={() => onDelete(m.id)} />
      ))}
    </div>
  )
}

function ScriptsList({ items, onEdit, onDelete, sort }: { items: Script[]; onEdit: (id: string) => void; onDelete: (id: string) => void; sort: SortOrder }) {
  const sorted = useMemo(() => sortByOrder(items, sort, (s) => s.title), [items, sort])
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
      {sorted.map((s) => (
        <ScriptCard key={s.id} item={s} onEdit={() => onEdit(s.id)} onDelete={() => onDelete(s.id)} />
      ))}
    </div>
  )
}

function StylesList({ items, onEdit, onDelete, sort }: { items: StylePreset[]; onEdit: (id: string) => void; onDelete: (id: string) => void; sort: SortOrder }) {
  const sorted = useMemo(() => sortByOrder(items, sort, (s) => s.name), [items, sort])
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {sorted.map((s) => (
        <StyleCard key={s.id} item={s} onEdit={() => onEdit(s.id)} onDelete={() => onDelete(s.id)} />
      ))}
    </div>
  )
}

// Centered date-pill divider — same chrome as the history views, reused here so
// the B-Roll bank reads as day-grouped generations rather than dated cards.
function DayPill({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center justify-center">
      <span className="rounded-full bg-ink/[0.06] px-3 py-1 text-[11px] font-medium text-ink-300">{label}</span>
    </div>
  )
}

function BRollsList({ items, onEdit, onDelete, sort }: { items: BRoll[]; onEdit: (id: string) => void; onDelete: (id: string) => void; sort: SortOrder }) {
  // Group into day buckets under a date pill (like the history views), so cards
  // no longer carry their own date. `groupByDay` is newest-day-first; flip it
  // when the user sorts oldest-first. A grid (not masonry) lets landscape stills
  // span three portrait columns, matching the Influencers tab.
  const sorted = useMemo(() => sortByOrder(items, sort), [items, sort])
  const dayGroups = useMemo(() => {
    const groups = groupByDay(sorted, (b) => b.createdAt)
    return sort === 'oldest' ? groups.reverse() : groups
  }, [sorted, sort])
  return (
    <div className="flex flex-col">
      {dayGroups.map(([dayTs, dayItems]) => (
        <div key={dayTs}>
          <DayPill label={sectionLabel(dayTs)} />
          <div className="grid grid-flow-row-dense grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {dayItems.map((b) => (
              <BRollCard key={b.id} item={b} onEdit={() => onEdit(b.id)} onDelete={() => onDelete(b.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ icon: Icon, label, singular, onAdd }: { icon: React.ElementType; label: string; singular: string; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ink/[0.04]">
        <Icon className="h-7 w-7 text-ink-700" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-ink-500">No {label} yet</p>
        <p className="text-xs text-ink-700">Add your first {singular} to get started</p>
      </div>
      <button
        onClick={onAdd}
        className="flex items-center gap-1.5 rounded-full bg-ink/[0.07] px-4 py-2 text-sm font-medium text-ink-300 transition-colors hover:bg-ink/10"
      >
        <Plus className="h-4 w-4" />
        Add Your First {singular.replace(/\b\w/g, (c) => c.toUpperCase())}
      </button>
    </div>
  )
}
