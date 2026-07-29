import { useEffect, useLayoutEffect, useRef, type ChangeEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, X } from 'lucide-react'
import { useCloseOnAppSwitch } from '../hooks/useCloseOnAppSwitch'
import useCloseOnEscape from '../hooks/useCloseOnEscape'
import { useBackdropClose } from '../hooks/useBackdropClose'

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
  // Scripts' navy is too dark to label its own tint — `scripts-text` is the
  // readable steel-blue token that exists for exactly this.
  scripts: 'bg-scripts-500/15 text-scripts-text hover:bg-scripts-500/25',
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

// The textarea's own form metrics (index.css gives every input font-weight 300
// + tight tracking). The highlight layer isn't a form control, so it has to be
// told, or the two layers wrap on different characters.
const MIRROR_METRICS = 'font-light tracking-[-0.025em]'

// Where the caret sits, in px from the top of the text — measured in a throwaway
// mirror div that copies the textarea's own metrics. Used to bring a restored
// caret into view, since the field itself no longer scrolls.
function caretOffsetTop(ta: HTMLTextAreaElement, caret: number): number {
  const cs = getComputedStyle(ta)
  const mirror = document.createElement('div')
  const s = mirror.style
  s.position = 'absolute'
  s.top = '0'
  s.left = '-9999px'
  s.visibility = 'hidden'
  s.whiteSpace = 'pre-wrap'
  s.overflowWrap = 'break-word'
  s.boxSizing = cs.boxSizing
  s.width = cs.width
  s.padding = cs.padding
  s.borderWidth = cs.borderWidth
  s.borderStyle = 'solid'
  s.fontFamily = cs.fontFamily
  s.fontSize = cs.fontSize
  s.fontWeight = cs.fontWeight
  s.fontStyle = cs.fontStyle
  s.letterSpacing = cs.letterSpacing
  s.lineHeight = cs.lineHeight
  mirror.textContent = ta.value.slice(0, caret)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const top = marker.offsetTop
  mirror.remove()
  return top
}

// Grow the field to its content (never shorter than the port, so a click below
// the last line still lands in the text). Zeroing the height to re-measure
// drops the scroll position, so it's put back.
function fitToContent(ta: HTMLTextAreaElement | null, sc: HTMLDivElement | null) {
  if (!ta || !sc) return
  const keep = sc.scrollTop
  ta.style.height = '0px'
  ta.style.height = `${Math.max(ta.scrollHeight, sc.clientHeight)}px`
  sc.scrollTop = keep
}

// Keep the caret in view. The field no longer scrolls itself, so the browser
// won't do this for us — every way the caret can move has to ask.
function revealCaret(ta: HTMLTextAreaElement | null, sc: HTMLDivElement | null) {
  if (!ta || !sc || document.activeElement !== ta) return
  if (sc.scrollHeight <= sc.clientHeight) return
  const top = caretOffsetTop(ta, ta.selectionEnd ?? 0)
  const line = parseFloat(getComputedStyle(ta).lineHeight) || 20
  if (top < sc.scrollTop) sc.scrollTop = top
  else if (top + line > sc.scrollTop + sc.clientHeight) sc.scrollTop = top + line - sc.clientHeight
}

// Keys that move the caret without changing the text.
const CARET_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End', 'a', 'A',
])

interface BracketHighlightAreaProps {
  value: string
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  // Sizing/chrome for the scroll port.
  className?: string
  // Padding + font metrics — applied to BOTH layers, so they wrap identically.
  padClass: string
  textClass: string
  // Colours etc. for the visible textarea only.
  textareaClass?: string
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  onBlur?: () => void
  autoFocus?: boolean
}

// A textarea with [bracketed placeholders] painted red behind it.
//
// The textarea is grown to its full content height and never scrolls itself —
// the wrapper scrolls, carrying the highlight layer and the text together. The
// obvious shape (a scrolling textarea whose overlay is synced from its scroll
// event) always lands a frame or more behind, because the browser scrolls the
// field on the compositor and hands JS the event afterwards: the red boxes
// visibly chase the words. Scrolling one shared ancestor has nothing to sync.
export function BracketHighlightArea({
  value,
  onChange,
  placeholder,
  className = '',
  padClass,
  textClass,
  textareaClass = '',
  textareaRef,
  onBlur,
  autoFocus = false,
}: BracketHighlightAreaProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const ownRef = useRef<HTMLTextAreaElement>(null)
  const taRef = textareaRef ?? ownRef

  useLayoutEffect(() => {
    fitToContent(taRef.current, scrollerRef.current)
    revealCaret(taRef.current, scrollerRef.current)
  }, [taRef, value])

  // Re-fit when the port resizes — the wrap changes with the width, and the
  // floor changes with the height.
  useEffect(() => {
    const sc = scrollerRef.current
    if (!sc || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fitToContent(taRef.current, scrollerRef.current))
    ro.observe(sc)
    return () => ro.disconnect()
  }, [taRef])

  return (
    <div ref={scrollerRef} className={`relative overflow-y-auto [scrollbar-gutter:stable] ${className}`}>
      <div className="relative">
        {/* Transparent backdrop that only paints the bracket highlights. It
            sits BEHIND the real textarea, so all selectable/clickable text
            belongs to the textarea (no cursor/selection drift). */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 whitespace-pre-wrap break-words text-transparent ${MIRROR_METRICS} ${padClass} ${textClass}`}
        >
          {renderBracketHighlight(value)}
        </div>
        <textarea
          ref={taRef}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          onKeyUp={(e) => {
            if (CARET_KEYS.has(e.key)) revealCaret(taRef.current, scrollerRef.current)
          }}
          autoFocus={autoFocus}
          placeholder={placeholder}
          rows={1}
          className={`relative block w-full resize-none overflow-hidden border-0 bg-transparent outline-none ${padClass} ${textClass} ${textareaClass}`}
        />
      </div>
    </div>
  )
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
  const backdrop = useBackdropClose(onClose)

  useCloseOnAppSwitch(open, onClose)

  useCloseOnEscape(open, onClose)

  if (!open) return null

  const textClass = `text-sm leading-relaxed ${mono ? 'font-mono' : ''}`

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
      {...backdrop}
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
            <BracketHighlightArea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              autoFocus
              className={`h-[60vh] rounded-3xl border border-ink/10 bg-ink/[0.03] transition-colors ${ACCENT_FOCUS[accent]}`}
              padClass="px-4 pb-6 pt-3"
              textClass={textClass}
              textareaClass="text-ink-200 placeholder-ink-600"
            />
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
