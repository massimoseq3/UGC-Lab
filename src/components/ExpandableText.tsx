import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, X } from 'lucide-react'
import { useCloseOnAppSwitch } from '../hooks/useCloseOnAppSwitch'
import useCloseOnEscape from '../hooks/useCloseOnEscape'

// Per-app accent for the modal's focus ring + Done button. Literal class
// strings (Tailwind can't build class names from props at runtime).
export type ExpandAccent = 'playground' | 'scripts' | 'broll' | 'ink'

const ACCENT_FOCUS: Record<ExpandAccent, string> = {
  playground: 'focus-within:border-playground-500/30',
  scripts: 'focus-within:border-scripts-500/30',
  broll: 'focus-within:border-broll-500/30',
  ink: 'focus-within:border-ink/20',
}
const ACCENT_DONE: Record<ExpandAccent, string> = {
  playground: 'bg-playground-500/15 text-playground-400 hover:bg-playground-500/25',
  scripts: 'bg-scripts-500/15 text-scripts-400 hover:bg-scripts-500/25',
  broll: 'bg-broll-500/15 text-broll-400 hover:bg-broll-500/25',
  ink: 'bg-ink/10 text-ink-100 hover:bg-ink/15',
}

// Paint a red background behind [bracketed placeholders] so users can see what
// to fill in (e.g. after applying a UGC prompt preset). This renders in a
// transparent-text backdrop layer that sits BEHIND a normal, visible textarea —
// so the textarea owns all the real (selectable, click-accurate) text and only
// the bracket highlight comes from here. The span text stays transparent
// (inherited from the backdrop); only its background shows through.
const BRACKET_RE = /\[[^\]]*\]/g
export function renderBracketHighlight(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  text.replace(BRACKET_RE, (match: string, offset: number) => {
    if (offset > last) nodes.push(text.slice(last, offset))
    nodes.push(
      <span key={key++} className="rounded-[3px] bg-red-500/25">
        {match}
      </span>,
    )
    last = offset + match.length
    return match
  })
  nodes.push(text.slice(last))
  // Preserve the height of a trailing newline so an overlay matches the textarea
  // (a zero-width space gives the empty final line height).
  if (text.endsWith('\n')) nodes.push(String.fromCharCode(0x200b))
  return nodes
}

// Small Maximize button to drop into a textarea's corner. Kept subtle — no
// backing fill, sized to match the inline Enhance / Undo / Redo controls.
// Mousedown is swallowed so focusing/blurring the field doesn't race the click.
export function ExpandButton({
  onClick,
  className = '',
  title = 'Expand editor',
}: {
  onClick: () => void
  className?: string
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 ${className}`}
    >
      <Maximize2 className="h-3 w-3" />
    </button>
  )
}

interface ExpandTextModalProps {
  open: boolean
  onClose: () => void
  value: string
  onChange: (value: string) => void
  title: string
  placeholder?: string
  accent?: ExpandAccent
  // When true, [brackets] are painted red via a highlight backdrop (Playground
  // prompt). Otherwise a plain textarea.
  highlightBrackets?: boolean
  // Render the body in a monospace font (scene-blueprint boxes).
  mono?: boolean
}

// Centered modal with a large textarea bound to the same value/onChange as the
// field that opened it — lets users see and edit the whole thing comfortably.
export default function ExpandTextModal({
  open,
  onClose,
  value,
  onChange,
  title,
  placeholder,
  accent = 'playground',
  highlightBrackets = false,
  mono = false,
}: ExpandTextModalProps) {
  const highlightRef = useRef<HTMLDivElement>(null)

  useCloseOnAppSwitch(open, onClose)

  useCloseOnEscape(open, onClose)

  if (!open) return null

  const textClass = `text-sm leading-relaxed ${mono ? 'font-mono' : ''}`

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ink-950/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-5 py-3.5">
          <span className="truncate text-sm font-semibold tracking-tight text-ink-100">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/10 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 p-4">
          {highlightBrackets ? (
            <div
              className={`relative flex h-[60vh] overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.03] transition-colors ${ACCENT_FOCUS[accent]}`}
            >
              {/* Transparent backdrop that only paints the bracket highlights.
                  It sits BEHIND the real textarea, so all selectable/clickable
                  text belongs to the textarea (no cursor/selection drift).
                  font-light + tracking match the textarea's global form metrics,
                  and the extra right padding matches the textarea's reserved
                  scrollbar gutter, so both layers wrap identically. */}
              <div
                ref={highlightRef}
                aria-hidden
                className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words pb-6 pl-4 pr-[calc(1rem+11px)] pt-3 font-light tracking-[-0.025em] text-transparent ${textClass}`}
              >
                {renderBracketHighlight(value)}
              </div>
              <textarea
                autoFocus
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onScroll={(e) => {
                  if (highlightRef.current) highlightRef.current.scrollTop = e.currentTarget.scrollTop
                }}
                placeholder={placeholder}
                className={`relative h-full w-full resize-none border-0 bg-transparent px-4 pb-6 pt-3 text-ink-200 placeholder-ink-600 outline-none [scrollbar-gutter:stable] ${textClass}`}
              />
            </div>
          ) : (
            <textarea
              autoFocus
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className={`h-[60vh] w-full resize-none rounded-3xl border border-ink/10 bg-ink/[0.03] px-4 pb-6 pt-3 text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 ${textClass}`}
            />
          )}
        </div>

        <div className="flex justify-end border-t border-ink/10 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className={`rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${ACCENT_DONE[accent]}`}
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
