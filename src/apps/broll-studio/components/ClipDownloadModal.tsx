// Pick-what-you-zip download picker, shared by both B-Roll modes.
//
// "Download all" used to sweep every take of every card into the zip, so a card
// the member regenerated three times landed three clips and the folder had to
// be weeded by hand. This lists every rendered clip instead, pre-ticked to each
// card's COVER take (the one its card face shows), and zips exactly what stays
// ticked.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, Loader2, Check, Star } from 'lucide-react'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { useAppStore } from '../../../stores/appStore'
import { downloadAssetsZip } from '../../../utils/downloadZip'
import { humanizeError } from '../../../utils/friendlyError'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useBackdropClose } from '../../../hooks/useBackdropClose'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'

function aspectStyle(ar: string): React.CSSProperties {
  const [w, h] = ar.split(':').map(Number)
  if (!w || !h) return { aspectRatio: '9 / 16' }
  return { aspectRatio: `${w} / ${h}` }
}

export interface ClipDownloadEntry {
  // Unique across the list — also the tick key.
  id: string
  // Asset ref resolved through the asset store.
  ref: string
  // File name inside the zip, without extension. Kept unique by the caller.
  name: string
  // What the tile reads, e.g. "Scene 02 · Option 1" or "Clip 3".
  label: string
  // Only when the card holds more than one take, e.g. "Take 2 of 3".
  takeLabel?: string
  // This card's cover take — ticked when the picker opens.
  isCover: boolean
  aspectRatio?: string
}

export default function ClipDownloadModal({
  entries,
  zipBasename,
  onClose,
}: {
  entries: ClipDownloadEntry[]
  zipBasename: string
  onClose: () => void
}) {
  useCloseOnEscape(true, onClose)
  useCloseOnAppSwitch(true, onClose)

  // Mounted fresh per open (the callers render it conditionally), so seeding
  // from props here is the whole reset story.
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(entries.filter((e) => e.isCover).map((e) => e.id)),
  )
  const [zipping, setZipping] = useState(false)

  const backdrop = useBackdropClose(onClose)

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
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ink-950/95 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-ink/5 px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-ink-100">Download clips</h3>
            <p className="mt-0.5 text-[11px] text-ink-500">
              Every card&rsquo;s cover clip is picked — tick the extra takes you also want.
            </p>
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {entries.map((entry) => (
              <ClipTile
                key={entry.id}
                entry={entry}
                picked={picked.has(entry.id)}
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
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-broll-500 px-4 py-1.5 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
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
  onToggle,
}: {
  entry: ClipDownloadEntry
  picked: boolean
  onToggle: () => void
}) {
  const url = useAssetUrl(entry.ref)
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        title={picked ? 'Leave out of the zip' : 'Add to the zip'}
        className={`group relative overflow-hidden rounded-xl border bg-black light:bg-zinc-200 transition-colors ${
          picked ? 'border-broll-500/70 ring-2 ring-broll-500/40' : 'border-ink/10 hover:border-ink/30'
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
          <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-white/40" />
          </div>
        )}
        <span
          className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
            picked ? 'border-broll-300 bg-broll-500 text-white' : 'border-white/40 bg-black/50'
          }`}
        >
          {picked && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        {entry.isCover && (
          <span className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
            <Star className="h-2.5 w-2.5 fill-white" /> Cover
          </span>
        )}
      </button>
      <div className="min-w-0 px-0.5 text-center">
        <p className="truncate text-[10px] font-medium text-ink-300">{entry.label}</p>
        {entry.takeLabel && <p className="truncate text-[9px] text-ink-600">{entry.takeLabel}</p>}
      </div>
    </div>
  )
}
