import { getModel } from '../utils/models'
import { useShowGenerationInfo } from '../stores/generationInfoStore'

// The model that produced a generation, as one small pill — the app's only
// "which model made this?" idiom on a finished output. In-flight surfaces
// (GeneratingMedia, GeneratingTile, the in-flight list rows) name the model in
// their own layout and are deliberately NOT routed through this: they are
// reporting on work in progress, not labelling a result.
//
// Three surfaces:
//   `media`  — sits ON a still or clip. Literal white-on-black, per the overlay
//              exception in CLAUDE.md; no backdrop-blur, because these pills
//              fade in/out with their card's hover and blur stutters under an
//              opacity transition (same reason TileActionStack drops it).
//   `chrome` — sits on a panel surface beside the meta pills, one step brighter
//              than they are: the model is the answer being looked for, the
//              resolution and aspect are the fine print.
//   `quiet`  — no pill at all: dim text, for a caption line UNDER a card where
//              the model rides beside a label of its own (B-Roll's A-Roll /
//              B-Roll line). A chip there would be a second badge on a row
//              that is already the card's quiet footnote.
//
// Renders nothing when the model is unknown or the member has turned generation
// info off.
export default function ModelPill({
  modelId,
  variant = 'chrome',
  className = '',
}: {
  modelId?: string | null
  variant?: 'media' | 'chrome' | 'quiet'
  className?: string
}) {
  const show = useShowGenerationInfo()
  if (!show || !modelId) return null

  // Fall back to the raw id: a retired model still made the picture, and an
  // id on the tile beats a blank where the label should be.
  const label = getModel(modelId)?.displayName ?? modelId
  const tone = variant === 'media'
    ? 'rounded-full bg-black/55 px-2 py-0.5 text-white'
    : variant === 'chrome'
      ? 'rounded-full bg-ink/[0.06] px-2 py-0.5 text-ink-200'
      : 'text-ink-600'

  return (
    <span
      title={label}
      className={`pointer-events-none max-w-full truncate text-[10px] font-medium tracking-tight ${tone} ${className}`}
    >
      {label}
    </span>
  )
}
