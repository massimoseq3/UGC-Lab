import { FileText, RefreshCw, X, ChevronRight, Sparkle } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import type { Script } from '../../../stores/types'
import { MAX_CHARACTERS } from './GenerateBar'

interface EditorAreaProps {
  scriptText: string
  onScriptChange: (value: string) => void
  onSelectScript: () => void
  selectedScript: Script | null
  onClearScript: () => void
  canGenerate: boolean
  onEnhance: () => void
  isEnhancing: boolean
  highlightField?: string | null
}

/**
 * The script pane, and nothing else.
 *
 * It used to end in the generate footer — the batch stepper, the button and
 * the player. Generate moved to the foot of the settings column in September
 * 2026 (see `GenerateBar`), and the player became this column's own footer one
 * level up, so it spans History as well as the script.
 */
export default function EditorArea({
  scriptText,
  onScriptChange,
  onSelectScript,
  selectedScript,
  onClearScript,
  canGenerate,
  onEnhance,
  isEnhancing,
  highlightField,
}: EditorAreaProps) {
  const charCount = scriptText.length
  const overLimit = charCount > MAX_CHARACTERS

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-5 md:px-8 md:pb-6 md:pt-6">
        {/* Pull from Script bank — dashed "click to select" when empty; a
            filled pill with a hover refresh icon / X-clear once a bank script
            is loaded. Editing the textarea below reverts it to the empty state. */}
        {selectedScript ? (
          <div
            role="button"
            tabIndex={0}
            onClick={onSelectScript}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectScript() } }}
            className="group flex w-full cursor-pointer items-center gap-3 rounded-full border border-voice-500/25 bg-voice-500/[0.06] px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-inset ring-voice-500/10 transition-colors hover:bg-voice-500/10"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-voice-500/15 text-voice-300">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-ink-100">{selectedScript.title}</div>
              <div className="truncate text-[11px] text-ink-500">Script</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="hidden items-center rounded-md px-2 py-0.5 text-ink-500 group-hover:flex">
                <RefreshCw className="h-2.5 w-2.5" />
              </span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClearScript() }}
                title="Remove script"
                aria-label="Remove script"
                className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-red-400 light:hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSelectScript}
            className="group flex w-full items-center gap-3 rounded-full border border-dashed border-ink/10 bg-ink/[0.015] px-3.5 py-2.5 text-left transition-colors hover:border-ink/20 hover:bg-ink/[0.03]"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-voice-500/10 text-voice-300/80 transition-colors group-hover:bg-voice-500/15 group-hover:text-voice-300">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-ink-200">Script</div>
              <div className="truncate text-[11px] text-ink-400">Click to select from bank</div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
          </button>
        )}

        {/* OR divider */}
        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-ink/[0.07]" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-600">or paste script manually</span>
          <div className="h-px flex-1 bg-ink/[0.07]" />
        </div>

        {/* Action row — the character count on the left, then Enhance once
            there's a script. The "New" reset used to lead the right-hand side
            and now leads the History rail beside this column, where starting
            another read sits at the top of the list of the ones you've made
            (the Ad Analyzer's shape); it keeps its two-click arm there.
            Enhance rewrites the script with
            square-bracket expression tags (e.g. [warmly], [excited]) so the
            read is emotive: it only inserts direction, never changes the
            spoken words.

            The count lives HERE, over the box it counts, rather than in the
            footer beside Generate. In the footer it was a third thing
            competing for a 375px row with a batch stepper and a button, and
            what gave way was the button's own label ("Generat…"). It also
            belongs to the script: it moves as you type, and this is the panel
            you're typing in. */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className={`shrink-0 text-[11px] tabular-nums ${overLimit ? 'text-red-400 light:text-red-600' : 'text-ink-500'}`}>
            <span className={overLimit ? 'text-red-300 light:text-red-700' : 'text-ink-300'}>{charCount.toLocaleString()}</span>
            <span> / {MAX_CHARACTERS.toLocaleString()}</span>
            <span className="hidden md:inline"> characters</span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
          {canGenerate && (
            <button
              type="button"
              onClick={onEnhance}
              // A running gen snapshotted its script at fire time, so editing
              // the box (via Enhance or by hand) can't affect it.
              disabled={isEnhancing}
              title="Add expression tags (e.g. [warmly], [excited]) for a more emotive read"
              className="flex items-center gap-1.5 rounded-full border border-voice-500/30 bg-voice-500/10 px-3 py-1.5 text-xs font-semibold text-voice-300 transition-colors hover:bg-voice-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isEnhancing ? <Spinner className="h-3.5 w-3.5" /> : <Sparkle className="h-3.5 w-3.5" />}
              {isEnhancing ? 'Enhancing…' : 'Enhance'}
            </button>
          )}
          </div>
        </div>

        {/* Textarea — borderless, full-bleed, minimal aesthetic */}
        <textarea
          value={scriptText}
          onChange={(e) => onScriptChange(e.target.value)}
          placeholder="Type or paste your ad script here to turn it into a voiceover..."
          className={`flex-1 resize-none bg-transparent text-base leading-relaxed text-ink-100 placeholder-ink-600 outline-none ${
            highlightField === 'script' ? 'animate-field-flash' : ''
          }`}
        />
      </div>
    </div>
  )
}
