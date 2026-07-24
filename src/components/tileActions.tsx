import { useEffect, useRef, useState } from 'react'
import { Loader2, Star, Trash2 } from 'lucide-react'

// The hover action controls that sit on top of a generated media tile —
// Characters' gallery, Playground's history grid, B-Roll's variation /
// continuous / one-shot cards, the Bank's image cards, and the detail-modal
// galleries. These were four near-identical inline copies that had already
// drifted apart (h-7 vs h-8 buttons, bg-black/35 vs /55 scrims, blurred vs
// not), so they live here now.
//
// Canonical stack order, top→bottom — see the hover-action-stack rule:
//   [Star] → Download → Save → Copy → [context extras] → Delete
// Star leads only where it exists (bank cards) so a starred item's persistent
// badge sits flush in the tile corner. Delete is always last.
//
// Sizing note: 32px (h-8) circles with 16px glyphs. That is the size the two
// largest galleries already used, and it clears the 24px minimum touch target
// that h-7 did not.

const STACK_POSITION = 'absolute right-1.5 top-1.5 z-10 flex flex-col items-end gap-1'

// Each button fades itself rather than the column fading as a whole, because
// the star has to stay visible once set while its neighbours stay hidden.
const FADE = 'opacity-0 transition-opacity group-hover:opacity-100'

/**
 * The positioned column that holds the buttons below.
 *
 * Pass `forceVisible` while a delete is being confirmed (or a save is in
 * flight) so the whole column stays put instead of vanishing out from under
 * the pointer.
 *
 * Expects a `group` ancestor — the tile root — for the hover reveal.
 */
export function TileActionStack({
  children,
  forceVisible = false,
  className = '',
}: {
  children: React.ReactNode
  forceVisible?: boolean
  className?: string
}) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`${STACK_POSITION} ${forceVisible ? '[&>*]:opacity-100' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

// Solid scrim, no backdrop-blur: the stack fades its opacity in on hover, and
// animating opacity over a backdrop-filter makes Chrome recompute the blur
// every frame — visibly choppy. A more opaque scrim reads cleanly instead.
// These colors stay literal in both themes; they sit over user media, which is
// the documented exception to the semantic-token rule.
const TONE = {
  default: 'border-white/20 bg-black/55 text-white hover:bg-black/70',
  saved: 'border-emerald-400/50 bg-emerald-500/45 text-emerald-100',
  danger: 'border-white/20 bg-black/55 text-white hover:bg-red-500/45 hover:text-red-100 hover:border-red-400/40',
} as const

export type TileActionTone = keyof typeof TONE

/** One circular action in a TileActionStack. */
export function TileActionButton({
  children,
  onClick,
  title,
  tone = 'default',
  disabled = false,
}: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  title: string
  tone?: TileActionTone
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(e) }}
      className={`${FADE} flex h-8 w-8 items-center justify-center rounded-full border transition-colors disabled:cursor-wait ${TONE[tone]}`}
    >
      {children}
    </button>
  )
}

/**
 * Star toggle — bank cards only. Unlike its neighbours it stays visible once
 * starred, so the pin reads at a glance without hovering. Starred items surface
 * first in every bank picker.
 */
export function TileStarButton({
  starred,
  onToggle,
}: {
  starred: boolean
  onToggle: () => void
}) {
  const label = starred ? 'Unstar' : 'Star — starred items show first when picking from banks'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={starred}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      className={`flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/55 transition-all hover:bg-black/70 ${
        starred ? 'text-amber-300 opacity-100' : `text-white ${FADE}`
      }`}
    >
      <Star className={`h-4 w-4 ${starred ? 'fill-current' : ''}`} />
    </button>
  )
}

const CONFIRM_WINDOW_MS = 3000

const ICON = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4' } as const

/**
 * Two-click delete: the trash icon arms on the first click and grows into a
 * red "Confirm" pill, reverting after 3s if the second click never comes. An
 * inline step rather than a modal, so deleting a tile stays in one spot.
 *
 * `onArmedChange` lets the parent hold the whole stack visible while armed —
 * otherwise moving the pointer off the tile hides the button mid-confirm.
 */
export function TileDeleteButton({
  onDelete,
  title = 'Delete',
  busy = false,
  onArmedChange,
  variant = 'media',
  size = 'md',
  alwaysVisible = false,
}: {
  onDelete: () => void
  title?: string
  busy?: boolean
  onArmedChange?: (armed: boolean) => void
  // 'media' sits on a generated image/video (literal white-on-black scrim);
  // 'chrome' sits on a themed panel surface (history rows, script cards, voice
  // rows) and uses semantic tokens instead. The two-click behaviour is
  // identical — only the skin differs, so the interaction never changes.
  variant?: 'media' | 'chrome'
  // 'sm' is for the compact history rows; 'md' for media tiles.
  size?: 'sm' | 'md'
  // History rows keep the delete visible on the selected row rather than
  // waiting for hover.
  alwaysVisible?: boolean
}) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | null>(null)
  // Held in a ref so the click handler doesn't close over a stale callback and
  // doesn't need it as a dependency — callers pass an inline arrow, which would
  // otherwise churn on every render. Synced in an effect, not during render.
  const notify = useRef(onArmedChange)
  useEffect(() => { notify.current = onArmedChange }, [onArmedChange])

  // Never leave a timer running past unmount — the tile can be removed by the
  // very delete this fires.
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const setArmedAndNotify = (next: boolean) => {
    setArmed(next)
    notify.current?.(next)
  }

  const disarm = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
    setArmedAndNotify(false)
  }

  return (
    <button
      type="button"
      title={armed ? 'Click again to delete' : busy ? 'Deleting…' : title}
      aria-label={armed ? 'Confirm delete' : title}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation()
        if (busy) return
        if (armed) { disarm(); onDelete(); return }
        setArmedAndNotify(true)
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => { setArmedAndNotify(false); timer.current = null }, CONFIRM_WINDOW_MS)
      }}
      // Idle is a fixed circle matching its neighbours; only the armed state
      // grows into a pill to fit its label.
      className={`${armed || busy || alwaysVisible ? 'opacity-100' : FADE} flex shrink-0 items-center justify-center rounded-full disabled:cursor-wait ${
        size === 'sm' ? 'h-7' : 'h-8'
      } ${
        armed
          ? variant === 'media'
            ? 'gap-1 border border-red-400/60 bg-red-500/55 px-2 text-red-50'
            : 'gap-1 bg-red-500/30 px-2 text-red-100 ring-1 ring-red-400/60 light:text-red-900'
          : variant === 'media'
            ? `border ${size === 'sm' ? 'w-7' : 'w-8'} ${TONE.danger}`
            : `${size === 'sm' ? 'w-7' : 'w-8'} text-ink-500 hover:bg-red-500/10 hover:text-red-400 light:hover:text-red-600`
      }`}
    >
      {busy
        ? <Loader2 className={`${ICON[size]} animate-spin`} />
        : <Trash2 className={ICON[size]} />}
      {armed && !busy && <span className="text-[9px] font-medium uppercase tracking-wider">Confirm</span>}
    </button>
  )
}
