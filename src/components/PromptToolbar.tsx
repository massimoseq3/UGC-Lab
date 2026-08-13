import { Sparkles, RefreshCw, Eraser, Undo2, Redo2 } from 'lucide-react'
import Spinner from './Spinner'
import { ExpandButton } from './ExpandableText'

// The footer strip under every editable prompt box — Enhance / Regenerate /
// Clear on the left, undo-redo behind a hairline, Expand on the right.
//
// It had drifted into six hand-rolled copies (Playground, Scripts × 2, B-Roll's
// card modal, and Continuous' frame + clip modals), each with its own label
// wording and spacing. One component keeps them identical and keeps the row
// short: the labels are single verbs, because "Enhance Prompt / Clear Prompt /
// Regenerate Prompt" says "Prompt" three times inside a box that is already
// nothing but a prompt.
//
// Undo/redo are icon-only and sit in their own group — they undo whatever the
// three verbs did, so they read as a pair rather than as two more actions.

type PromptToolbarAccent = 'playground' | 'scripts' | 'broll' | 'influencers'

// Static class strings — Tailwind can't see a class built at runtime.
const ACCENT_HOVER: Record<PromptToolbarAccent, string> = {
  playground: 'hover:bg-playground-500/10 hover:text-playground-300',
  scripts: 'hover:bg-scripts-500/15 hover:text-scripts-text',
  broll: 'hover:bg-broll-500/10 hover:text-broll-300',
  influencers: 'hover:bg-influencers-500/10 hover:text-influencers-300',
}

const PILL = 'flex h-6 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium text-ink-400 transition-colors disabled:cursor-not-allowed disabled:opacity-40'
const NEUTRAL_HOVER = 'hover:bg-ink/[0.06] hover:text-ink-200'
const ICON = 'flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-30'

export interface PromptToolbarProps {
  accent: PromptToolbarAccent
  // Enhance — the one action every prompt box has. `busy` swaps its glyph for a
  // spinner and is the caller's single in-flight flag (it also blocks the rest).
  onEnhance: () => void
  enhanceTitle: string
  enhanceDisabled?: boolean
  busy?: boolean
  // Regenerate — write a fresh prompt from scratch. B-Roll only.
  onRegenerate?: () => void
  regenerateTitle?: string
  // Overrides the "Regenerate" label where the source matters (Continuous' clip
  // modal reads the rendered keyframes, so it says which).
  regenerateLabel?: string
  regenerateDisabled?: boolean
  // Clear — empties the field. Playground + Scripts, where the box is the input
  // rather than a generated prompt worth keeping a history of.
  onClear?: () => void
  clearDisabled?: boolean
  onUndo: () => void
  canUndo: boolean
  onRedo: () => void
  canRedo: boolean
  onExpand: () => void
}

export default function PromptToolbar({
  accent,
  onEnhance,
  enhanceTitle,
  enhanceDisabled = false,
  busy = false,
  onRegenerate,
  regenerateTitle,
  regenerateLabel = 'Regenerate',
  regenerateDisabled = false,
  onClear,
  clearDisabled = false,
  onUndo,
  canUndo,
  onRedo,
  canRedo,
  onExpand,
}: PromptToolbarProps) {
  // No rule above the strip: it sits inside the prompt box's own border and its
  // controls are dim enough to read as chrome on their own. A hairline there
  // drew a second box inside the box.
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          title={enhanceTitle}
          onClick={onEnhance}
          disabled={busy || enhanceDisabled}
          className={`${PILL} ${ACCENT_HOVER[accent]}`}
        >
          {busy ? <Spinner className="h-3 w-3 shrink-0" /> : <Sparkles className="h-3 w-3 shrink-0" />}
          Enhance
        </button>
        {onRegenerate && (
          <button
            type="button"
            title={regenerateTitle ?? 'Regenerate'}
            onClick={onRegenerate}
            disabled={busy || regenerateDisabled}
            className={`${PILL} ${NEUTRAL_HOVER}`}
          >
            <RefreshCw className="h-3 w-3 shrink-0" />
            <span className="truncate">{regenerateLabel}</span>
          </button>
        )}
        {onClear && (
          <button
            type="button"
            title="Clear"
            onClick={onClear}
            disabled={busy || clearDisabled}
            className={`${PILL} ${NEUTRAL_HOVER}`}
          >
            <Eraser className="h-3 w-3 shrink-0" />
            Clear
          </button>
        )}
        <span className="mx-1 h-4 w-px shrink-0 bg-ink/10" />
        <button type="button" title="Undo" onClick={onUndo} disabled={!canUndo || busy} className={ICON}>
          <Undo2 className="h-3 w-3" />
        </button>
        <button type="button" title="Redo" onClick={onRedo} disabled={!canRedo || busy} className={ICON}>
          <Redo2 className="h-3 w-3" />
        </button>
      </div>
      <ExpandButton onClick={onExpand} />
    </div>
  )
}
