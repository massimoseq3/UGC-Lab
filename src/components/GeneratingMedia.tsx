import { Image as ImageIcon, Video as VideoIcon, X } from 'lucide-react'
import GeneratingBackdrop from './GeneratingBackdrop'
import GenerationProgress from './GenerationProgress'
import { getModel } from '../utils/models'
import { IMAGE_MESSAGES, VIDEO_MESSAGES } from './generatingMessages'

// The one "this is generating" surface, app-wide. A card face mid-generation and
// the same generation seen inside a detail modal must be pixel-identical, so both
// render this: frosted blob backdrop, mode glyph top-left, model name, rotating
// status line, and the prompt fading out at the bottom.
//
// `GeneratingMediaFill` is absolutely positioned — drop it as a child of any
// `relative overflow-hidden` frame (a card face, a gallery cell). `PendingMedia`
// wraps it in its own aspect-sized tile for grids that have no frame of their own.

type Family = 'playground' | 'broll' | 'influencers'

// Literal per-family classes — Tailwind only emits class names it can find whole
// in the source, so these can't be built from the prop.
const ACCENT: Record<Family, { bar: string; text: string; border: string }> = {
  playground: { bar: 'bg-playground-500', text: 'text-playground-100', border: 'border-playground-500/20' },
  broll: { bar: 'bg-broll-500', text: 'text-broll-100', border: 'border-broll-500/20' },
  influencers: { bar: 'bg-influencers-500', text: 'text-influencers-100', border: 'border-influencers-500/20' },
}

export interface GeneratingMediaProps {
  kind: 'image' | 'video'
  family?: Family
  // Shown above the progress bar. Falls back to nothing while the task id is
  // still being minted and the model isn't known yet.
  modelId?: string | null
  // Faded out along the bottom edge, so a card mid-generation still says what
  // it's making.
  prompt?: string
  messages?: string[]
  // Give up on this entry. A generation that died before kie returned a task id
  // has nothing to resume and would otherwise sit in-flight until the staleness
  // sweep clears it.
  onDismiss?: () => void
}

export function GeneratingMediaFill({
  kind,
  family = 'broll',
  modelId,
  prompt,
  messages,
  onDismiss,
}: GeneratingMediaProps) {
  const accent = ACCENT[family]
  const Icon = kind === 'video' ? VideoIcon : ImageIcon
  const modelLabel = modelId ? getModel(modelId)?.displayName ?? modelId : null
  return (
    <>
      <GeneratingBackdrop family={family} />
      {/* Mode glyph, top-left. */}
      <div className={`absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/25 backdrop-blur-sm ${accent.text}`}>
        <Icon className="h-4 w-4" />
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss() }}
          title="Stop tracking this generation"
          className={`absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white ${accent.text}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center">
        {modelLabel && <p className={`text-[11px] font-medium ${accent.text}`}>{modelLabel}</p>}
        <GenerationProgress
          isActive
          color={accent.bar}
          showHelper={false}
          // Same size and tint as the model label above it — the status line is
          // the part people actually read, so it can't be the dimmest thing here.
          messageClassName={`text-[11px] font-medium ${accent.text}`}
          messages={messages ?? (kind === 'video' ? VIDEO_MESSAGES : IMAGE_MESSAGES)}
          className="max-w-[180px]"
        />
      </div>
      {prompt && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8">
          <p className="line-clamp-2 text-[10px] leading-relaxed text-white/70">{prompt}</p>
        </div>
      )}
    </>
  )
}

function aspectStyle(ar: string): React.CSSProperties {
  if (ar.includes('16:9')) return { aspectRatio: '16 / 9' }
  if (ar.includes('1:1')) return { aspectRatio: '1 / 1' }
  if (ar.includes('4:3')) return { aspectRatio: '4 / 3' }
  if (ar.includes('3:4')) return { aspectRatio: '3 / 4' }
  return { aspectRatio: '9 / 16' }
}

// Standalone tile for gallery grids that have no frame of their own.
export function PendingMedia({
  aspectRatio = '9:16',
  className = '',
  ...fill
}: GeneratingMediaProps & { aspectRatio?: string; className?: string }) {
  const accent = ACCENT[fill.family ?? 'broll']
  return (
    <div
      className={`relative overflow-hidden rounded-xl border ${accent.border} ${className}`}
      style={aspectStyle(aspectRatio)}
    >
      <GeneratingMediaFill {...fill} />
    </div>
  )
}
