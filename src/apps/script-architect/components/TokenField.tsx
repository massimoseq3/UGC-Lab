import { useRef, useState, type ReactNode } from 'react'
import AutoGrowTextarea from '../../../components/AutoGrowTextarea'

// The scene-prose field: a real textarea with the [CHARACTER] / [PRODUCT] slots
// washed in behind it, so the tokens stay marked WHILE you type.
//
// The block this replaced was click-to-edit — a rendered paragraph that swapped
// itself for a field on click, and the field then filled black on focus. Both
// halves read as "an editor opened over the script" rather than as writing on
// the page, which is the whole point of editing a take in place. The reason the
// swap existed was the token tint: a textarea can't colour one range of its own
// text, so the rendered paragraph was the only place the slots could be marked.
//
// The fix is the shape `BracketHighlightArea` already uses for Playground's
// prompt box — a transparent-text mirror painting ONLY the highlight, sitting
// behind a normal textarea that owns every visible, selectable, clickable
// character. Nothing to sync and no cursor drift, because the text you see and
// the text you click are the same text.
//
// Two consequences worth knowing before "fixing" them:
//   • The wash is a BACKGROUND, not a text colour. The mirror can't recolour the
//     textarea's glyphs — it can only paint behind them.
//   • The token reads as `[CHARACTER]`, not the lowercased `[character]` the old
//     render printed. Lowercasing changes glyph widths, so the two layers would
//     wrap on different characters and the wash would slide off its word.
const TOKEN_SPLIT = /(\[(?:CHARACTER|PRODUCT|INFLUENCER)\])/gi
const IS_TOKEN = /^\[(?:CHARACTER|PRODUCT|INFLUENCER)\]$/i

// The mirror isn't a form control, so it inherits none of the metrics
// `index.css` gives inputs — spell them out, or the two layers wrap on
// different characters. The 16px floor under `lg` is the iOS zoom rule from the
// same file, which applies to the textarea and would otherwise leave the wash
// set at the card's own 12.5px.
const MIRROR_METRICS = 'font-light tracking-[-0.025em] max-lg:text-[16px]'

// Reference-image slots, not typos — B-Roll binds them to the real character
// and packaging, so they read as deliberate placeholders rather than raw text.
// A wash rather than a pill: an inline-block box fractures the paragraph's
// line-breaking and orphans the possessive in "[CHARACTER]'s hands".
export function TokenHighlight({ text }: { text: string }) {
  const nodes: ReactNode[] = []
  text.split(TOKEN_SPLIT).forEach((part, i) => {
    nodes.push(
      IS_TOKEN.test(part) ? (
        <span key={i} className="rounded-[3px] bg-scripts-500/25">
          {part}
        </span>
      ) : (
        part
      ),
    )
  })
  // A trailing newline has no glyph, so the mirror would come up one line short
  // of the field. A zero-width space gives that last empty line its height.
  if (text.endsWith('\n')) nodes.push(String.fromCharCode(0x200b))
  return <>{nodes}</>
}

export default function TokenField({
  value,
  onCommit,
  ariaLabel,
  padClass,
  textClass,
  className = '',
}: {
  value: string
  // Omitted → read-only prose with the same wash, no field at all.
  onCommit?: (next: string) => void
  ariaLabel: string
  // Padding — applied to BOTH layers, so they wrap identically.
  padClass: string
  // Size / weight / colour — likewise both layers.
  textClass: string
  // Chrome for the box the two layers sit in (hover tint, card fill).
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const [sync, setSync] = useState(value)
  // Escape has to cancel WITHOUT the blur it triggers committing the draft it
  // just discarded — setDraft is async, so `commit` would still read the typed
  // value. A ref is the only thing that's already updated by then.
  const reverting = useRef(false)
  if (value !== sync) {
    setSync(value)
    setDraft(value)
  }

  if (!onCommit) {
    return (
      <div className={`whitespace-pre-wrap break-words ${className} ${padClass} ${textClass}`}>
        <TokenHighlight text={value} />
      </div>
    )
  }

  const commit = () => {
    if (reverting.current) {
      reverting.current = false
      setDraft(value)
      return
    }
    const next = draft.trim()
    // An emptied block reverts rather than committing: prose that vanishes as
    // you clear it reads as the block deleting itself, and deleting a scene is
    // the header's own button.
    if (!next) {
      setDraft(value)
      return
    }
    if (next !== draft) setDraft(next)
    if (next !== value) onCommit(next)
  }

  return (
    <div className={`relative ${className}`}>
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 whitespace-pre-wrap break-words text-transparent ${MIRROR_METRICS} ${padClass} ${textClass}`}
      >
        <TokenHighlight text={draft} />
      </div>
      <AutoGrowTextarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            reverting.current = true
            e.currentTarget.blur()
          }
        }}
        rows={1}
        spellCheck={false}
        aria-label={ariaLabel}
        className={`relative block w-full cursor-text resize-none overflow-hidden bg-transparent outline-none ${padClass} ${textClass}`}
      />
    </div>
  )
}
