import { Package, UserRound, Mic, Film, Star, Palette } from 'lucide-react'
import type { Product, Model, Script, VoicePreset, BRoll, StylePreset, AnyBankItem } from '../stores/types'
import type { BankType } from '../utils/constants'
import { useAssetUrl } from '../hooks/useAssetUrl'
import { SCRIPT_BADGE, SCRIPT_BADGE_SHAPE } from '../utils/scriptBadge'

type BankItem = AnyBankItem

interface BankItemCardProps {
  bankType: BankType
  item: BankItem
  onClick: () => void
  selected?: boolean
  // The owning app's accent (hex). When set, the selected highlight uses it
  // instead of the per-bank colour — so the picker feels native to whatever
  // app opened it (green in Playground, etc.).
  accentColor?: string
  // Fires once the image loads with whether it's landscape (16:9). The picker
  // uses it to let landscape b-rolls span the full masonry width.
  onLandscape?: (landscape: boolean) => void
}

// hex → rgba so an arbitrary app accent can drive the selected border/ring/bg
// without a matching Tailwind palette.
function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export default function BankItemCard({ bankType, item, onClick, selected, accentColor, onLandscape }: BankItemCardProps) {
  // Inline selected styling driven by the app accent: a tinted border + 1px
  // ring (and a faint fill for the text-only cards).
  const accentSelected: React.CSSProperties | undefined =
    selected && accentColor
      ? { borderColor: hexAlpha(accentColor, 0.5), boxShadow: `0 0 0 1px ${hexAlpha(accentColor, 0.4)}` }
      : undefined
  // Image-backed banks (influencers / products / b-rolls) render as full image
  // cards that adapt to the image's natural aspect ratio — 16:9 / 9:16 / square
  // — matching how the Bank browser shows them. Scripts / voices have no image,
  // so they keep the compact row layout.
  if (bankType === 'models') {
    const m = item as Model
    return (
      <ImageCard
        src={m.characterImage}
        fallback={UserRound}
        fallbackAspect="aspect-[9/16]"
        name={m.name || 'Untitled Character'}
        centerName
        starred={m.starred}
        onClick={onClick}
        selected={selected}
        selectedStyle={accentSelected}
        // Character sheets can be wide (16:9 turnaround) or tall (9:16
        // stacked); the picker uses this to span a wide one across both
        // columns and leave a tall one as a normal tile.
        onLandscape={onLandscape}
      />
    )
  }

  if (bankType === 'products') {
    const p = item as Product
    return (
      <ImageCard
        src={p.productImage}
        fallback={Package}
        fallbackAspect="aspect-square"
        name={p.productName || 'Untitled Product'}
        centerName
        starred={p.starred}
        onClick={onClick}
        selected={selected}
        selectedStyle={accentSelected}
      />
    )
  }

  if (bankType === 'brolls') {
    const b = item as BRoll
    const videoCount = b.videos?.length ?? 0
    return (
      <ImageCard
        src={b.imageUrl}
        fallback={Film}
        fallbackAspect="aspect-video"
        name={b.prompt || 'Untitled B-Roll'}
        sublabel={`${b.imageUrl ? 'Still' : 'Video only'}${videoCount > 0 ? ` · ${videoCount} clip${videoCount === 1 ? '' : 's'}` : ''}`}
        starred={b.starred}
        onClick={onClick}
        selected={selected}
        selectedStyle={accentSelected}
        onLandscape={onLandscape}
      />
    )
  }

  if (bankType === 'scripts') {
    return <ScriptCard item={item as Script} onClick={onClick} selected={selected} accentColor={accentColor} />
  }

  return (
    <button
      onClick={onClick}
      style={selected && accentColor ? { borderColor: hexAlpha(accentColor, 0.4), backgroundColor: hexAlpha(accentColor, 0.08) } : undefined}
      className={`flex w-full items-center gap-3 rounded-full border p-3 text-left transition-colors ${
        selected
          ? accentColor ? '' : 'border-ink/20 bg-ink/[0.06]'
          : 'border-ink/5 bg-ink/[0.03] hover:border-ink/10 hover:bg-ink/[0.06]'
      }`}
    >
      {bankType === 'voices' && <VoiceContent item={item as VoicePreset} />}
      {bankType === 'styles' && <StyleContent item={item as StylePreset} />}
    </button>
  )
}

// 9:16 script card — mirrors the Bank browser's ScriptCard so the picker shows
// the same view: SCRIPT/SCENES pill, title, and a full preview that fades out.
function ScriptCard({ item, onClick, selected, accentColor }: { item: Script; onClick: () => void; selected?: boolean; accentColor?: string }) {
  const isPrompt = item.kind === 'reverse-engineer'
  // Same pill the Bank browser and Scripts' history rail draw — see
  // `utils/scriptBadge.ts`.
  const badge = isPrompt
    ? { label: 'SCENES', className: SCRIPT_BADGE.scenes }
    : { label: 'SCRIPT', className: SCRIPT_BADGE.script }
  return (
    <button
      onClick={onClick}
      style={
        selected && accentColor
          ? { borderColor: hexAlpha(accentColor, 0.5), boxShadow: `0 0 0 1px ${hexAlpha(accentColor, 0.4)}`, backgroundColor: hexAlpha(accentColor, 0.06) }
          : undefined
      }
      className={`group relative flex aspect-[9/16] w-full flex-col overflow-hidden rounded-2xl border p-3 text-left transition-all ${
        selected
          ? accentColor ? '' : 'border-scripts-500/50 bg-scripts-500/[0.06] ring-1 ring-scripts-500/40'
          : 'border-ink/5 bg-ink/[0.03] hover:border-ink/15 hover:-translate-y-px'
      }`}
    >
      {item.starred && <StarBadge className="right-2 top-2" />}
      <div className="flex flex-col gap-1.5">
        <span className={`${SCRIPT_BADGE_SHAPE} ${badge.className}`}>
          {badge.label}
        </span>
        <span className="line-clamp-2 text-[12px] font-semibold leading-snug tracking-tight text-ink-100">
          {item.title || 'Untitled Script'}
        </span>
      </div>
      <div className="relative mt-2 flex-1 overflow-hidden">
        <p className="whitespace-pre-wrap text-[10px] leading-relaxed text-ink-400">{item.scriptText || 'Empty script'}</p>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface-1 to-transparent" />
      </div>
    </button>
  )
}

// Small amber star marker for starred (pinned) items — picker cards only;
// the Bank browser renders its own interactive star in the hover stack.
function StarBadge({ className }: { className: string }) {
  return (
    <span className={`pointer-events-none absolute z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm ${className}`}>
      <Star className="h-3 w-3 fill-amber-300 text-amber-300" strokeWidth={2} />
    </span>
  )
}

// Full image card — shows the asset at its natural aspect ratio with a
// gradient name overlay, mirroring the Bank browser's influencer/product cards.
function ImageCard({
  src,
  fallback: Icon,
  fallbackAspect,
  name,
  sublabel,
  centerName,
  starred,
  onClick,
  selected,
  selectedStyle,
  onLandscape,
}: {
  src?: string
  fallback: React.ElementType
  fallbackAspect: string
  name: string
  sublabel?: string
  centerName?: boolean
  starred?: boolean
  onClick: () => void
  selected?: boolean
  selectedStyle?: React.CSSProperties
  onLandscape?: (landscape: boolean) => void
}) {
  const resolvedUrl = useAssetUrl(src)
  return (
    <button
      onClick={onClick}
      style={selectedStyle}
      className={`group relative block w-full overflow-hidden rounded-2xl border text-left transition-all ${
        selected ? '' : 'border-ink/5 bg-ink/[0.03] hover:border-ink/15 hover:-translate-y-px'
      }`}
    >
      {starred && <StarBadge className="left-2 top-2" />}
      {resolvedUrl ? (
        <img
          src={resolvedUrl}
          alt=""
          className="block w-full"
          decoding="async"
          onLoad={(e) => onLandscape?.(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight)}
        />
      ) : (
        <div className={`flex ${fallbackAspect} w-full items-center justify-center bg-ink/[0.04]`}>
          <Icon className="h-10 w-10 text-ink-800" strokeWidth={1} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-2.5 pt-10">
        <span className={`block truncate text-[11px] font-semibold leading-tight tracking-tight text-zinc-100 ${centerName ? 'text-center' : ''}`}>{name}</span>
        {sublabel && <span className="block truncate text-[10px] text-zinc-400">{sublabel}</span>}
      </div>
    </button>
  )
}

function VoiceContent({ item }: { item: VoicePreset }) {
  return (
    <>
      <RowThumbnail fallback={Mic} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold tracking-tight text-ink-200">
          {item.label || 'Untitled Preset'}
        </span>
        <span className="truncate text-xs text-ink-500">
          {item.voiceName}{item.gender ? ` · ${item.gender}` : ''}
        </span>
      </div>
    </>
  )
}

function StyleContent({ item }: { item: StylePreset }) {
  return (
    <>
      <RowThumbnail fallback={Palette} src={item.thumbRefs?.[0]} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold tracking-tight text-ink-200">
          {item.name || 'Untitled Style'}
        </span>
        <span className="truncate text-xs text-ink-500">{item.brief}</span>
      </div>
    </>
  )
}

function RowThumbnail({ fallback: Icon, src }: { fallback: React.ElementType; src?: string }) {
  const resolved = useAssetUrl(src)
  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink/5">
      {resolved ? (
        <img src={resolved} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <Icon className="h-4 w-4 text-ink-600" />
      )}
    </div>
  )
}
