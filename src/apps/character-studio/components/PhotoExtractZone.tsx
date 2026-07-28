import { useState, useCallback } from 'react'
import { Dna, Check, X, ChevronRight } from 'lucide-react'
import GenerationProgress from '../../../components/GenerationProgress'

interface PhotoExtractZoneProps {
  // How many reference photos are being analysed right now (any source).
  analyzingCount: number
  extractError: string | null
  // True while a reference's DNA is sitting in the form. Kept separate from
  // `thumbnail`, which can be empty when the browser couldn't decode the file.
  applied: boolean
  thumbnail: string | null
  onPhotoDrop: (files: File[]) => void
  onReset: () => void
  onOpenLibrary: () => void
}

// The chevron that opens the reference library, pinned to the right of the row
// in every state — the same affordance the preset row beside it carries. It
// sits inside a clickable drop zone, so it swallows the click that would
// otherwise open the file dialog behind it.
//
// No count rides alongside it: this row shares a half-width column with the
// preset picker, and a badge here truncated the label that explains the drop.
function LibraryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title="Reference photos"
      aria-label="Open reference photos"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200"
    >
      <ChevronRight className="h-4 w-4" strokeWidth={2} />
    </button>
  )
}

export default function PhotoExtractZone({
  analyzingCount,
  extractError,
  applied,
  thumbnail,
  onPhotoDrop,
  onReset,
  onOpenLibrary,
}: PhotoExtractZoneProps) {
  const [dragOver, setDragOver] = useState(false)

  // Format/size validation lives in the library (it has to report per file on a
  // bulk drop) — this row just hands the files over.
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) onPhotoDrop(files)
  }, [onPhotoDrop])

  // Analyzing state — fixed h-12 so it stays the exact size of the preset pill
  // beside it (the bar + message centre within the row rather than growing it).
  if (analyzingCount > 0) {
    return (
      <div
        onClick={onOpenLibrary}
        className="flex h-12 cursor-pointer items-center gap-3 rounded-full border border-green-500/20 bg-green-500/[0.04] px-3 transition-colors hover:border-green-500/30 hover:bg-green-500/[0.08]"
      >
        {thumbnail && (
          <img
            src={thumbnail}
            alt="Analyzing"
            className="h-8 w-8 shrink-0 rounded-full object-cover opacity-70"
          />
        )}
        <div className="min-w-0 flex-1">
          {analyzingCount > 1 ? (
            // A batch has no single prompt to narrate — the count is the news.
            <span className="flex items-center gap-1.5 text-xs text-ink-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
              </span>
              Analysing {analyzingCount} photos…
            </span>
          ) : (
            <GenerationProgress
              isActive={true}
              color="bg-green-500"
              showHelper={false}
              messageClassName="text-xs truncate text-ink-300"
              messages={['Preparing image...', 'Sending request...', 'Extracting visual DNA...', 'Finalizing analysis...']}
            />
          )}
        </div>
        <LibraryButton onClick={onOpenLibrary} />
      </div>
    )
  }

  // Success state — collapsed confirmation. The whole row opens the library,
  // exactly like the empty state above it: the chevron says where it goes, but
  // a 24px target beside a full-width row is the only part that moved.
  if (applied) {
    return (
      <div
        onClick={onOpenLibrary}
        className="flex h-12 cursor-pointer items-center gap-2.5 rounded-full border border-green-500/20 bg-green-500/[0.06] px-3 transition-colors hover:border-green-500/30 hover:bg-green-500/[0.10]"
      >
        {thumbnail && (
          <img
            src={thumbnail}
            alt="Source"
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Check className="h-3.5 w-3.5 shrink-0 text-green-400 light:text-green-600" />
          <span className="truncate text-xs font-medium text-green-300 light:text-green-700">
            Auto-filled from reference image
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onReset() }}
          title="Clear image"
          aria-label="Clear image"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <LibraryButton onClick={onOpenLibrary} />
      </div>
    )
  }

  // Empty state. A click opens the library rather than the file dialog — that's
  // where browsing, bulk-adding and reusing an old analysis all live, and the
  // panel has its own drop zone. Dropping straight on the row still works.
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={onOpenLibrary}
        className={`flex cursor-pointer items-center gap-2.5 rounded-full border border-dashed py-2 pl-3 pr-2 transition-all ${dragOver
            ? 'border-green-400/40 bg-green-400/5'
            : 'border-ink/10 bg-ink/[0.02] hover:border-ink/20 hover:bg-ink/[0.05]'
          }`}
      >
        {/* The DNA glyph is the row's identity, not just its drag state — it
            mirrors the preset row's tinted person circle beside it, in the
            green this app's extraction surfaces already use. */}
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${dragOver ? 'bg-green-400/20' : 'bg-green-500/10'}`}>
          <Dna className="h-4 w-4 text-green-400 light:text-green-600" strokeWidth={1.5} />
        </div>
        {/* 13px — the B-Roll reference-row title size, matching the preset
            button beside it. No hint line: the title says it. */}
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-300">
          {dragOver ? 'Drop to extract DNA' : 'Extract Character DNA'}
        </div>
        <LibraryButton onClick={onOpenLibrary} />
      </div>

      {extractError && (
        <p className="mt-1.5 text-[11px] text-red-400 light:text-red-600">
          {extractError}
        </p>
      )}
    </div>
  )
}
