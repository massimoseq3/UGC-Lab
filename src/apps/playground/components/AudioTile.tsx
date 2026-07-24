import { Download, Copy, Music as MusicIcon } from 'lucide-react'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import type { MusicHistoryItem } from '../../../stores/types'
import { getModel } from '../../../utils/models'
import { TileDeleteButton } from '../../../components/tileActions'

interface AudioTileProps {
  item: MusicHistoryItem
  onDownload: () => void
  onDelete: () => void
  // Copy this track's prompt to the clipboard.
  onCopyPrompt: () => void
}

// Audio history tile. Cover thumbnail (or gradient placeholder) + native
// audio player + copy/download/delete. Sits inside the day-bucketed history grid.
export default function AudioTile({ item, onDownload, onDelete, onCopyPrompt }: AudioTileProps) {
  const audioUrl = useAssetUrl(item.audioRef)
  const coverUrl = useAssetUrl(item.coverImageRef)
  const modelLabel = getModel(item.modelId)?.displayName ?? item.modelId

  return (
    <div className="overflow-hidden rounded-lg border border-ink/10 bg-ink/[0.02]">
      {/* Album-cover area stays dark in both themes — it stands in for media. */}
      <div className="relative aspect-square overflow-hidden bg-gradient-to-br from-fuchsia-900/30 via-zinc-900 to-black">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <MusicIcon className="h-8 w-8 text-fuchsia-300/40" strokeWidth={1.5} />
          </div>
        )}
        {item.instrumental && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-zinc-200 backdrop-blur-sm">
            Instrumental
          </span>
        )}
      </div>

      <div className="p-2.5">
        <p className="line-clamp-1 text-[11px] font-medium text-ink-200">
          {item.title || modelLabel}
        </p>
        <p className="line-clamp-1 text-[10px] text-ink-500">{item.prompt}</p>

        {audioUrl && (
          <audio src={audioUrl} controls className="mt-2 h-8 w-full" preload="metadata" />
        )}

        {/* Horizontal variant of the standard action order: download · copy ·
            delete (no save — music doesn't go to a bank). */}
        <div className="mt-1.5 flex items-center justify-end gap-1">
          <button
            type="button"
            title="Download"
            onClick={onDownload}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.05] hover:text-ink-200"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Copy prompt"
            onClick={onCopyPrompt}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.05] hover:text-ink-200"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <TileDeleteButton variant="chrome" size="sm" alwaysVisible onDelete={onDelete} />
        </div>
      </div>
    </div>
  )
}
