import { X, LayoutGrid, UserRound } from 'lucide-react'
import GeneratingBackdrop from '../../../components/GeneratingBackdrop'
import GenerationProgress from '../../../components/GenerationProgress'
import { getModel } from '../../../utils/models'

// The shared "image is generating" tile for the Influencers app — the same
// frosted blob backdrop + model label + rotating status line used on the main
// gallery's in-flight tiles AND inside the edit modal, so a generation looks
// identical wherever it's kicked off. Pass `onCancel` to show the hover cancel
// button (gallery); omit it for the modal's blocking generate.

function aspectStyle(ar: string): React.CSSProperties {
  if (ar.includes('16:9')) return { aspectRatio: '16 / 9' }
  if (ar.includes('1:1')) return { aspectRatio: '1 / 1' }
  return { aspectRatio: '9 / 16' }
}

const SHEET_MESSAGES = [
  'Sending request...',
  'Laying out the panels...',
  'Matching the face across views...',
  'Finalizing the sheet...',
]
const PORTRAIT_MESSAGES = [
  'Sending request...',
  'Composing the character...',
  'Rendering details...',
  'Finalizing the frame...',
]

export default function GeneratingTile({
  modelId,
  kind,
  aspectRatio,
  onCancel,
  onClick,
  fill = false,
}: {
  modelId: string
  kind?: 'portrait' | 'sheet'
  aspectRatio: string
  onCancel?: () => void
  // Opens the editor on the generation that is still running. The tile used to
  // be inert until the image landed, which meant waiting on a render just to
  // reach the controls you were going to use on it.
  onClick?: () => void
  // Stretch to fill the parent (list view's fixed-height media frame) instead
  // of sizing to the output's aspect ratio (grid view).
  fill?: boolean
}) {
  const modelLabel = getModel(modelId)?.displayName ?? modelId
  const isSheet = kind === 'sheet'
  return (
    <div
      onClick={onClick}
      className={`group relative overflow-hidden border-influencers-500/20 ${fill ? 'h-full w-full border-0' : 'rounded-lg border'} ${onClick ? 'cursor-pointer' : ''}`}
      style={fill ? undefined : aspectStyle(aspectRatio)}
    >
      <GeneratingBackdrop family="influencers" />
      <div className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/25 text-influencers-100 backdrop-blur-sm">
        {isSheet ? <LayoutGrid className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
      </div>
      {onCancel && (
        <button
          type="button"
          title="Cancel"
          onClick={(e) => { e.stopPropagation(); onCancel() }}
          className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white opacity-0 backdrop-blur transition-opacity hover:border-red-400/40 hover:bg-red-500/30 hover:text-red-100 group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-[11px] font-medium text-influencers-100">{modelLabel}</p>
        <GenerationProgress
          isActive
          color="bg-influencers-500"
          showHelper={false}
          messageClassName="text-[11px] font-medium text-influencers-100"
          messages={isSheet ? SHEET_MESSAGES : PORTRAIT_MESSAGES}
          className="max-w-[180px]"
        />
      </div>
    </div>
  )
}
