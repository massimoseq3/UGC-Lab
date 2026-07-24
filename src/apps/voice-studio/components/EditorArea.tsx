import { FileText, Loader2, Mic, AlertCircle, RefreshCw, X, ChevronRight, Coins, Sparkles } from 'lucide-react'
import type { Script } from '../../../stores/types'
import GenerationProgress from '../../../components/GenerationProgress'
import ClearAllButton from '../../../components/ClearAllButton'
import { estimateCredits, formatCredits, getModel } from '../../../utils/models'
import { TTS_MODEL_ID } from '../services/generateVoice'

const MODEL_NAME = getModel(TTS_MODEL_ID)?.displayName ?? 'Gemini 3.1 Flash TTS'

const MAX_CHARACTERS = 5000

interface EditorAreaProps {
  scriptText: string
  onScriptChange: (value: string) => void
  onSelectScript: () => void
  selectedScript: Script | null
  onClearScript: () => void
  // Resets the editor to a blank slate — the picked script and the pasted
  // text. Every generated voiceover stays in History.
  onClearInputs: () => void
  onGenerate: () => void
  isGenerating: boolean
  canGenerate: boolean
  onEnhance: () => void
  isEnhancing: boolean
  highlightField?: string | null
  error?: string | null
}

export default function EditorArea({
  scriptText,
  onScriptChange,
  onSelectScript,
  selectedScript,
  onClearScript,
  onClearInputs,
  onGenerate,
  isGenerating,
  canGenerate,
  onEnhance,
  isEnhancing,
  highlightField,
  error,
}: EditorAreaProps) {
  const charCount = scriptText.length
  const overLimit = charCount > MAX_CHARACTERS
  // Gemini 3.1 Flash TTS bills by tokens; we estimate from the script's char
  // count (see geminiTtsCredits in models.ts). Show the estimate on the Generate
  // button so cost is visible before spending.
  const creditsLabel = charCount > 0 ? formatCredits(estimateCredits(TTS_MODEL_ID, { charCount })) : null

  return (
    <div className="flex flex-col md:h-full md:overflow-hidden">
      {/* Header band — matches the right panel's Settings/History strip (and
          every other app's 57px panel header) so the two columns' rules line
          up. Holds the panel-level "New" reset. */}
      <div className="flex h-[57px] shrink-0 items-center border-b border-ink/5 px-8">
        <ClearAllButton onClear={onClearInputs} label="New" />
      </div>
      {/* Body */}
      <div className="flex flex-1 flex-col px-8 pt-6 md:overflow-hidden">
        {/* Pull from Script bank — dashed "click to select" when empty; a
            filled pill with a hover refresh icon / X-clear once a bank script
            is loaded. Editing the textarea below reverts it to the empty state. */}
        {selectedScript ? (
          <div
            role="button"
            tabIndex={0}
            onClick={onSelectScript}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectScript() } }}
            className="group flex w-full cursor-pointer items-center gap-3 rounded-full border border-voice-500/25 bg-voice-500/[0.06] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-inset ring-voice-500/10 transition-colors hover:bg-voice-500/10"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-voice-500/15 text-voice-300">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink-200">{selectedScript.title}</div>
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
            className="group flex w-full items-center gap-3 rounded-full border border-dashed border-ink/10 bg-ink/[0.015] px-4 py-3 text-left transition-colors hover:border-ink/20 hover:bg-ink/[0.03]"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-voice-500/10 text-voice-300/80 transition-colors group-hover:bg-voice-500/15 group-hover:text-voice-300">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-ink-200">Script</div>
              <div className="text-xs text-ink-400">Click to select from bank</div>
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

        {/* Enhance — appears once there's a script. Rewrites it with square-
            bracket expression tags (e.g. [warmly], [excited]) so the read is
            emotive. Only inserts direction; never changes the spoken words. */}
        {canGenerate && (
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={onEnhance}
              disabled={isEnhancing || isGenerating}
              title="Add expression tags (e.g. [warmly], [excited]) for a more emotive read"
              className="flex items-center gap-1.5 rounded-full border border-voice-500/30 bg-voice-500/10 px-3 py-1.5 text-xs font-semibold text-voice-300 transition-colors hover:bg-voice-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isEnhancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {isEnhancing ? 'Enhancing…' : 'Enhance'}
            </button>
          </div>
        )}

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

      {/* Error */}
      {error && (
        <div className="mx-5 mb-3 mt-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400 light:text-red-600" />
          <p className="text-xs leading-relaxed text-red-300 light:text-red-700">{error}</p>
        </div>
      )}

      {/* Progress bar — only takes space while generating so it sits snug
          just above the footer separator (no empty gap when idle). The
          "keep this tab open" helper is hidden here to keep it tight. */}
      {isGenerating && (
        <div className="px-5 pb-2 pt-2">
          <GenerationProgress
            isActive
            color="bg-voice-500"
            messages={['Preparing audio...', 'Sending request...', 'Generating speech...', 'Encoding audio...']}
            showHelper={false}
          />
        </div>
      )}

      {/* Footer row — pinned to the app window's bottom edge on mobile so
          Generate is always reachable. Opaque bg (not /95 + blur): backdrop-
          filter doesn't re-blur inside the already-blurred window frame, so
          any alpha lets the form underneath ghost through. */}
      <div className={`fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between border-t border-ink/5 bg-surface-0 px-5 py-3 md:static md:left-auto md:right-auto md:z-auto md:bg-transparent ${isGenerating ? 'md:mt-0' : 'md:mt-4'}`}>
        {/* Left — character count */}
        <div className={`text-sm tabular-nums ${overLimit ? 'text-red-400 light:text-red-600' : 'text-ink-400'}`}>
          <span className={overLimit ? 'text-red-300 light:text-red-700' : 'text-ink-200'}>{charCount.toLocaleString()}</span>
          <span className="text-ink-500"> / {MAX_CHARACTERS.toLocaleString()} characters</span>
        </div>

        {/* Right — model chip + generate. The model indicator lives here (not
            in the settings panel) since there's only one model. */}
        <div className="flex items-center gap-3">
          <div className="hidden items-center rounded-full border border-ink/10 px-3.5 py-1.5 text-xs font-medium text-ink-400 md:flex">
            {MODEL_NAME}
          </div>
          <button
            onClick={onGenerate}
            disabled={!canGenerate || isGenerating || overLimit}
            className="flex items-center justify-center gap-2.5 rounded-full border border-white/15 bg-voice-500 px-10 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] btn-soft-shadow transition-all hover:bg-voice-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Generating...</span>
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" strokeWidth={2.5} />
              <span>Generate Voiceover</span>
              {creditsLabel && (
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
                  <Coins className="h-3 w-3" strokeWidth={2} />
                  {creditsLabel}
                </span>
              )}
            </>
          )}
          </button>
        </div>
      </div>
    </div>
  )
}
