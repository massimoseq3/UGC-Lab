import { Sparkles, Star } from 'lucide-react'
import ProviderLogo from './ProviderLogo'

// The shared chrome of every "pick a model" panel: a provider rail down the
// left and a heading above each provider's models. Both the chat picker
// (ScriptModelRow) and the image/video picker (ModelPickerModal) render these, so
// picking a writer and picking a renderer feel like the same act — only the
// per-row detail differs (stars + blurb vs resolution + duration + credits).
// The grouping itself is in utils/providerGroups.ts.

// The recommended marker, shared by every panel that shows one. Amber in BOTH
// themes on purpose: a star reads as "starred" only in gold, and the per-app
// accent it used to take made the same badge mean four different colours
// depending on which app opened the panel.
export function StarBadge({ className = '' }: { className?: string }) {
  return (
    <Star
      className={`h-3 w-3 shrink-0 fill-amber-400 text-amber-400 light:fill-amber-500 light:text-amber-500 ${className}`}
      strokeWidth={1.5}
    />
  )
}

interface ProviderRailProps {
  providers: string[]
  // null = every provider. The rail filters a long list; it is never a required
  // first step, which is why the top button leads and stays selectable.
  value: string | null
  onChange: (provider: string | null) => void
  // Host-app accent classes for the active pill.
  activeClass: string
  // Opt-in top button: a star that filters to the recommended models instead of
  // the plain "All". Given both props, the rail renders the star and the two
  // filters are alternatives — picking a provider clears starred, and vice
  // versa. Omit for a list whose stars mean something else (the chat picker's
  // stars are an intelligence rating, so a "starred" lens there would lie).
  starred?: boolean
  onStarredChange?: (starred: boolean) => void
}

export function ProviderRail({ providers, value, onChange, activeClass, starred, onStarredChange }: ProviderRailProps) {
  const hasStarFilter = !!onStarredChange
  const topActive = hasStarFilter ? !!starred : value === null

  return (
    <div className="flex shrink-0 flex-col items-center gap-1 border-r border-ink/5 px-2 py-3">
      <button
        type="button"
        onClick={() => {
          if (hasStarFilter) {
            onStarredChange(!starred)
            onChange(null)
          } else {
            onChange(null)
          }
        }}
        title={hasStarFilter ? 'Recommended models' : 'All models'}
        aria-label={hasStarFilter ? 'Recommended models' : 'All models'}
        aria-pressed={topActive}
        className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
          topActive ? activeClass : 'text-ink-600 hover:bg-ink/5 hover:text-ink-300'
        }`}
      >
        {hasStarFilter ? (
          <Star
            className={`h-4 w-4 ${starred ? 'fill-amber-400 text-amber-400 light:fill-amber-500 light:text-amber-500' : ''}`}
            strokeWidth={1.75}
          />
        ) : (
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        )}
      </button>
      <span className="my-1 h-px w-5 bg-ink/10" />
      {providers.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => {
            onChange(value === p ? null : p)
            onStarredChange?.(false)
          }}
          title={p}
          aria-label={p}
          aria-pressed={value === p}
          className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
            value === p ? activeClass : 'opacity-60 hover:bg-ink/5 hover:opacity-100'
          }`}
        >
          <ProviderLogo provider={p} size="sm" />
        </button>
      ))}
    </div>
  )
}

// The heading above each provider's models. A label plus a hairline that runs
// to the edge — the same separator shape the pickers used for their old
// Featured / All models split.
export function ProviderHeading({ provider }: { provider: string }) {
  return (
    <div className="flex items-center gap-3 px-2.5 pb-1 pt-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-600">{provider}</span>
      <span className="h-px flex-1 bg-ink/[0.07]" />
    </div>
  )
}
