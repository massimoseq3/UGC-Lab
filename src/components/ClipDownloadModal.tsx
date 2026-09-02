// Pick-what-you-zip download picker, shared by B-Roll and Playground.
//
// B-Roll's "Download all" used to sweep every take of every card into the zip,
// so a card the member regenerated three times landed three clips and the
// folder had to be weeded by hand. This lists every rendered clip instead and
// zips exactly what stays ticked.
//
// What's ticked on open is the CALLER's call, because the two apps mean
// different things by a list of clips. B-Roll's is a storyboard — one cover take
// per card, and the rest are alternates you opt into — so it pre-ticks the
// covers. Playground's is everything you have ever generated in that tab, going
// back weeks; pre-ticking all of it would mean unticking dozens of clips to get
// the two you came for, so it opens with nothing picked.

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, Check, Star, Film } from 'lucide-react'
import Spinner from './Spinner'
import { useAssetUrl } from '../hooks/useAssetUrl'
import useNearViewport from '../hooks/useNearViewport'
import { useAppStore } from '../stores/appStore'
import { downloadAssetsZip } from '../utils/downloadZip'
import { humanizeError } from '../utils/friendlyError'
import useCloseOnEscape from '../hooks/useCloseOnEscape'
import { useBackdropClose } from '../hooks/useBackdropClose'
import { useCloseOnAppSwitch } from '../hooks/useCloseOnAppSwitch'

function aspectStyle(ar: string): React.CSSProperties {
  const [w, h] = ar.split(':').map(Number)
  if (!w || !h) return { aspectRatio: '9 / 16' }
  return { aspectRatio: `${w} / ${h}` }
}

// Accent classes are written out in full: Tailwind scans source text, so a
// `bg-${accent}-500` template would never be generated.
type Accent = 'broll' | 'playground'
const ACCENT: Record<Accent, { frame: string; check: string; cta: string }> = {
  broll: {
    frame: 'border-broll-500/70 ring-2 ring-broll-500/40',
    check: 'border-broll-300 bg-broll-500 text-white',
    cta: 'bg-broll-500',
  },
  playground: {
    frame: 'border-playground-500/70 ring-2 ring-playground-500/40',
    check: 'border-playground-300 bg-playground-500 text-white',
    cta: 'bg-playground-500',
  },
}

export interface ClipDownloadEntry {
  // Unique across the list — also the tick key.
  id: string
  // Asset ref resolved through the asset store.
  ref: string
  // File name inside the zip, without extension. Kept unique by the caller.
  name: string
  // What the tile reads, e.g. "Scene 02 · Option 1", or the prompt that made it.
  label: string
  // Dim second line — "Take 2 of 3" in B-Roll, "2h ago · Grok Imagine" here.
  meta?: string
  // Ticked when the picker opens. See the note at the top of the file.
  preselected?: boolean
  // Small pill on the tile, e.g. "Cover".
  badge?: string
  aspectRatio?: string
}

export default function ClipDownloadModal({
  entries,
  zipBasename,
  subtitle,
  accent = 'broll',
  onClose,
}: {
  entries: ClipDownloadEntry[]
  zipBasename: string
  subtitle: string
  accent?: Accent
  onClose: () => void
}) {
  useCloseOnEscape(true, onClose)
  useCloseOnAppSwitch(true, onClose)

  // Mounted fresh per open (the callers render it conditionally), so seeding
  // from props here is the whole reset story.
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(entries.filter((e) => e.preselected).map((e) => e.id)),
  )
  const [zipping, setZipping] = useState(false)

  const backdrop = useBackdropClose(onClose)
  const tint = ACCENT[accent]
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const allPicked = picked.size === entries.length

  const download = async () => {
    if (zipping || picked.size === 0) return
    setZipping(true)
    try {
      const n = await downloadAssetsZip(
        entries.filter((e) => picked.has(e.id)).map((e) => ({ ref: e.ref, name: e.name })),
        zipBasename,
      )
      useAppStore.getState().addToast(`Downloading ${n} clip${n === 1 ? '' : 's'} as a zip`, 'success')
      onClose()
    } catch (err) {
      useAppStore.getState().addToast(humanizeError(err, 'Could not download the clips.'), 'error')
    } finally {
      setZipping(false)
    }
  }

  return createPortal((
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm sm:px-6"
      {...backdrop}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ink-950/95 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-ink/5 px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-ink-100">Download clips</h3>
            <p className="mt-0.5 text-[11px] text-ink-500">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink/10 text-ink-400 transition-colors hover:bg-ink/10 hover:text-ink-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {entries.map((entry) => (
              <ClipTile
                key={entry.id}
                entry={entry}
                picked={picked.has(entry.id)}
                tint={tint}
                scrollRoot={scrollRef}
                onToggle={() => toggle(entry.id)}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink/5 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="text-[11px] tabular-nums text-ink-500">
              {picked.size} of {entries.length} selected
            </span>
            <button
              type="button"
              onClick={() => setPicked(allPicked ? new Set() : new Set(entries.map((e) => e.id)))}
              className="text-[11px] font-medium text-ink-400 underline-offset-2 transition-colors hover:text-ink-200 hover:underline"
            >
              {allPicked ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void download()}
            disabled={zipping || picked.size === 0}
            className={`flex items-center gap-1.5 glass-fill glass-fill-soft hover:brightness-110 disabled:hover:brightness-100 rounded-full border border-white/15 px-4 py-1.5 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] transition-all disabled:cursor-not-allowed disabled:opacity-40 ${tint.cta}`}
          >
            {zipping ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
            {zipping ? 'Zipping…' : `Download ${picked.size} clip${picked.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}

function ClipTile({
  entry,
  picked,
  tint,
  scrollRoot,
  onToggle,
}: {
  entry: ClipDownloadEntry
  picked: boolean
  tint: { frame: string; check: string }
  scrollRoot: React.RefObject<HTMLElement | null>
  onToggle: () => void
}) {
  // Only tiles near the scroll window hold a clip — this list runs to every
  // video the member has ever made, and mounting all of them at once left the
  // grid black while the tab stalled. See hooks/useNearViewport.
  const { ref: tileRef, near } = useNearViewport<HTMLButtonElement>(scrollRoot)
  const url = useAssetUrl(near ? entry.ref : null)
  return (
    <div className="flex flex-col gap-1.5">
      <button
        ref={tileRef}
        type="button"
        onClick={onToggle}
        title={picked ? 'Leave out of the zip' : 'Add to the zip'}
        className={`group relative overflow-hidden rounded-xl border bg-black light:bg-zinc-200 transition-colors ${
          picked ? tint.frame : 'border-ink/10 hover:border-ink/30'
        }`}
        style={aspectStyle(entry.aspectRatio ?? '9:16')}
      >
        {url ? (
          <video
            src={url}
            muted
            loop
            playsInline
            preload="metadata"
            className={`h-full w-full object-cover transition-opacity ${picked ? '' : 'opacity-45'}`}
            onMouseEnter={(e) => { (e.currentTarget as HTMLVideoElement).play().catch(() => {}) }}
            onMouseLeave={(e) => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0 }}
          />
        ) : (
          // A tile that hasn't reached the window yet gets a still glyph, not a
          // spinner: forty spinning icons off screen is forty animations the
          // browser keeps ticking, and nothing is actually loading down there.
          <div className="flex h-full w-full items-center justify-center">
            {near
              ? <Spinner className="h-4 w-4 text-white/40" />
              : <Film className="h-4 w-4 text-white/20" />}
          </div>
        )}
        <span
          className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
            picked ? tint.check : 'border-white/40 bg-black/50'
          }`}
        >
          {picked && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        {entry.badge && (
          <span className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
            <Star className="h-2.5 w-2.5 fill-white" /> {entry.badge}
          </span>
        )}
      </button>
      <div className="min-w-0 px-0.5 text-center">
        {/* Two lines, not one: B-Roll's labels are short ("Scene 02 · Option 1")
            but Playground has no title field, so the label IS the prompt and a
            single truncated line of one identifies nothing. */}
        <p className="line-clamp-2 text-[10px] font-medium leading-snug text-ink-300">{entry.label}</p>
        {entry.meta && <p className="truncate text-[9px] text-ink-600">{entry.meta}</p>}
      </div>
    </div>
  )
}
