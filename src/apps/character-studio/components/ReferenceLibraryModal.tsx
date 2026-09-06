import { useMemo, useRef, useState } from 'react'
import { AlertCircle, RotateCw, ScanFace, Search, Upload } from 'lucide-react'
import Modal from '../../../components/Modal'
import DayPill from '../../../components/DayPill'
import { TileDeleteButton } from '../../../components/tileActions'
import { groupByDay, sectionLabel } from '../../../utils/history'
import { describeRefProfile, INTERRUPTED_REF_ERROR, type CharacterRefItem } from '../types'

interface ReferenceLibraryModalProps {
  open: boolean
  onClose: () => void
  items: CharacterRefItem[]
  analyzingIds: string[]
  // The row whose DNA currently fills the form.
  activeId: string | null
  error: string | null
  onAdd: (files: File[]) => void
  onApply: (item: CharacterRefItem) => void
  onRetry: (id: string) => void
  canRetry: (id: string) => boolean
  onRemove: (id: string) => void
}

// Search only earns its row once the list is long enough to scroll.
const SEARCH_THRESHOLD = 5

export default function ReferenceLibraryModal({
  open,
  onClose,
  items,
  analyzingIds,
  activeId,
  error,
  onAdd,
  onApply,
  onRetry,
  canRetry,
  onRemove,
}: ReferenceLibraryModalProps) {
  const [query, setQuery] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = items
      .filter((it) => {
        if (!q) return true
        const summary = it.profile ? describeRefProfile(it.profile) : ''
        return it.name.toLowerCase().includes(q) || summary.toLowerCase().includes(q)
      })
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
    return groupByDay(filtered, (it) => it.createdAt)
  }, [items, query])

  // stopPropagation matters even though this panel is portaled to the body:
  // React synthetic events travel the REACT tree, not the DOM one, and the
  // modal is a child of CharacterStudio's full-area drop zone. Without it
  // every drop here ran addFiles twice — a 5-photo drop became 10 vision calls.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) onAdd(files)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Extract Character DNA"
      subtitle="Fill the form from a reference photo"
      // Held at full height only once the list is long enough to carry a search
      // box — below that the panel is a drop zone over a handful of rows, and a
      // fixed 86vh would stand it in an empty box.
      fill={items.length > SEARCH_THRESHOLD}
    >
      <div className="border-b border-ink/5 p-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors ${
            dragOver
              ? 'border-influencers-400/40 bg-influencers-400/[0.07]'
              : 'border-ink/10 bg-ink/[0.02] hover:border-ink/20 hover:bg-ink/[0.05]'
          }`}
        >
          <span className={`flex h-9 w-9 items-center justify-center rounded-full ${dragOver ? 'bg-influencers-500/15 text-influencers-300' : 'bg-ink/5 text-ink-400'}`}>
            <Upload className="h-4 w-4" strokeWidth={1.5} />
          </span>
          <span className="text-[13px] font-medium text-ink-300">Drop photos, or click to browse</span>
        </div>

        {error && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-red-400 light:text-red-600">
            <AlertCircle className="mt-px h-3 w-3 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        {items.length > SEARCH_THRESHOLD && (
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search references..."
              className="w-full rounded-full border border-ink/10 bg-transparent py-1.5 pl-9 pr-3 text-[12px] text-ink-100 placeholder-ink-500 outline-none transition-colors focus:border-influencers-500/40"
            />
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) onAdd(files)
            e.target.value = ''
          }}
          className="hidden"
        />
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <ScanFace className="h-8 w-8 text-ink-800" strokeWidth={1.5} />
          <p className="text-xs text-ink-500">No reference photos yet</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="px-6 py-10 text-center text-xs text-ink-500">No matches.</div>
      ) : (
        <div className="flex flex-col gap-0.5 p-2">
          {groups.map(([dayTs, dayItems]) => (
            <div key={dayTs} className="flex flex-col gap-0.5">
              <DayPill label={sectionLabel(dayTs)} className="my-1.5" />
              {dayItems.map((item) => (
                <ReferenceRow
                  key={item.id}
                  item={item}
                  analyzing={analyzingIds.includes(item.id)}
                  isActive={activeId === item.id}
                  retryable={canRetry(item.id)}
                  onApply={() => { onApply(item); onClose() }}
                  onRetry={() => onRetry(item.id)}
                  onRemove={() => onRemove(item.id)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function ReferenceRow({
  item,
  analyzing,
  isActive,
  retryable,
  onApply,
  onRetry,
  onRemove,
}: {
  item: CharacterRefItem
  analyzing: boolean
  isActive: boolean
  retryable: boolean
  onApply: () => void
  onRetry: () => void
  onRemove: () => void
}) {
  // A row with no profile and nothing running failed — either with a message of
  // its own, or because a refresh cut the analysis off mid-flight.
  const failure = analyzing ? null : item.profile ? null : (item.error ?? INTERRUPTED_REF_ERROR)
  const clickable = Boolean(item.profile) && !analyzing

  return (
    <div
      onClick={clickable ? onApply : undefined}
      className={`group flex items-center gap-2.5 rounded-full px-3 py-2 transition-colors ${
        clickable ? 'cursor-pointer' : ''
      } ${isActive ? 'bg-influencers-500/15 ring-1 ring-influencers-500/20' : 'hover:bg-ink/[0.04]'}`}
    >
      <div className="relative h-11 w-11 shrink-0">
        {item.thumb ? (
          <img src={item.thumb} alt="" className="h-full w-full rounded-full border border-ink/10 object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center rounded-full bg-ink/[0.04] text-influencers-400/70">
            <ScanFace className="h-4 w-4" />
          </span>
        )}
        {analyzing && (
          <span className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-influencers-500/40">
            <span className="absolute inset-0 animate-pulse rounded-full bg-influencers-500/10" />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-[12.5px] font-medium leading-snug text-ink-100">{item.name}</p>
        <div className="mt-0.5 text-[10.5px] leading-snug text-ink-500">
          {analyzing ? (
            <span className="flex items-center gap-1 text-influencers-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-influencers-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-influencers-400" />
              </span>
              Analysing…
            </span>
          ) : failure ? (
            <span className="flex min-w-0 items-center gap-1 text-red-400 light:text-red-600">
              <AlertCircle className="h-2.5 w-2.5 shrink-0" />
              <span className="line-clamp-1">{failure}</span>
            </span>
          ) : (
            <span className="line-clamp-1">{describeRefProfile(item.profile!) || 'Ready'}</span>
          )}
        </div>
      </div>

      {failure && retryable && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRetry() }}
          title="Analyse again"
          aria-label="Analyse again"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/10 hover:text-ink-100"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
      )}

      <TileDeleteButton variant="chrome" size="sm" alwaysVisible={isActive} onDelete={onRemove} />
    </div>
  )
}
