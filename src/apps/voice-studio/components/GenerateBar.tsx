import { AlertCircle, Coins, Mic } from 'lucide-react'
import GenerationProgress from '../../../components/GenerationProgress'
import BatchCountStepper from '../../../components/BatchCountStepper'
import { clampBatchCount } from '../../../utils/batchCount'
import ModelPicker from '../../../components/ModelPicker'
import { estimateCredits, formatCredits, getDefaultModel, TTS_MODEL_PRO, TTS_MODEL_SLOT } from '../../../utils/models'
import { useSettingsStore } from '../../../stores/settingsStore'

export const MAX_CHARACTERS = 5000

// Three reads is a choice; more is an audition. TTS is the cheapest thing in
// the app, so the ceiling here is about what's useful, not what it costs.
export const VOICE_BATCH_MAX = 3

interface GenerateBarProps {
  // The words that will be read. Only the length is used here — for the
  // credit estimate and the over-limit block — but the bar owns both, so the
  // button can never quote a price for a run it would refuse.
  scriptText: string
  onGenerate: () => void
  // How many reads of the same script one press fires. Capped at 3 (see
  // VOICE_BATCH_MAX): same voice, same params, same words — the delivery still
  // lands differently each time, and picking between three is the job.
  batchCount: number
  onBatchCountChange: (value: number) => void
  isGenerating: boolean
  error?: string | null
}

/**
 * The bottom of the settings column: what one press costs, how many it makes,
 * and the button that makes them — plus the progress bar and the error, which
 * report on that press and belong beside it.
 *
 * It lived at the foot of the script column until September 2026 (Massimo's
 * call). Voiceovers was the one app whose Generate wasn't at the bottom of its
 * input column, because its input column sits on the LEFT; moving it here puts
 * this app in the same shape as every other one, and the room it needed is
 * exactly what History leaving the left panel freed up.
 */
export default function GenerateBar({
  scriptText,
  onGenerate,
  batchCount,
  onBatchCountChange,
  isGenerating,
  error,
}: GenerateBarProps) {
  const charCount = scriptText.length
  const overLimit = charCount > MAX_CHARACTERS
  const canGenerate = scriptText.trim().length > 0
  // The model the picker above is on — read THROUGH the selector, never by
  // calling a getter pulled out of the store (see the React Compiler note in
  // CLAUDE.md), so the price follows a swap. Falls back the same way
  // resolveTtsModel does, so the button quotes what the run will actually cost.
  const pickedModel = useSettingsStore((s) => s.getAppModel(TTS_MODEL_SLOT))
  const modelId = pickedModel ?? getDefaultModel('voice-studio', 'tts')?.id ?? TTS_MODEL_PRO
  const count = clampBatchCount(batchCount, VOICE_BATCH_MAX)
  // Gemini TTS bills by tokens; we estimate from the script's char count (see
  // geminiTtsCredits in models.ts). TTS is billed per call, so a run of N is N
  // times one read.
  const creditsFor = (n: number) => {
    const one = estimateCredits(modelId, { charCount })
    return one === null ? null : one * n
  }
  const creditsLabel = charCount > 0 ? formatCredits(creditsFor(count)) : null

  return (
    <div className="shrink-0 border-t border-ink/5 px-5 pb-3 pt-3">
      {/* Settings row: which TTS model reads the script, and how many reads
          one press makes. Both are properties of THIS press rather than saved
          delivery settings, so they sit together on the approach to the button
          and leave it alone at the foot of the column — the same shape Scripts
          uses above its own Generate, and the reason the stepper takes `xl`:
          58px is the picker-row height, so the pair is one line by
          construction rather than by a copied number.

          The model row is unlabelled and uncarded on purpose — a picker row
          already shows the model's name over its hint, and a border around one
          control says nothing (see the root CLAUDE.md). The pick persists per
          browser under `voice-studio:tts`, the same key `resolveTtsModel()`
          reads at generate time, and it is what `modelId` prices against — so
          this row and the credits pill on the button can never name different
          models. */}
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <ModelPicker row appId="voice-studio" task="tts" />
        </div>
        {/* No label on the stepper, deliberately. Stacked with the word
            "Voiceovers" it measured 151px, which left the model row 240px for
            a name that wants 112 — so the one control whose entire job is
            saying WHICH model rendered as "Gemini 2…". The button 8px below
            says the noun ("Generate 3 Voiceovers"), and the `noun` prop still
            spells it out in the tooltip, so nothing is lost but the width. */}
        <BatchCountStepper
          size="xl"
          accent="voice"
          noun="voiceover"
          max={VOICE_BATCH_MAX}
          value={count}
          onChange={onBatchCountChange}
          creditsFor={charCount > 0 ? creditsFor : undefined}
        />
      </div>

      {error && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400 light:text-red-600" />
          <p className="text-xs leading-relaxed text-red-300 light:text-red-700">{error}</p>
        </div>
      )}

      {/* Only takes space while generating, so the button sits snug under the
          settings row when idle. */}
      {isGenerating && (
        <div className="pt-2">
          <GenerationProgress
            isActive
            color="bg-voice-500"
            messages={['Preparing audio...', 'Sending request...', 'Generating speech...', 'Encoding audio...']}
            showHelper={false}
          />
        </div>
      )}

      <button
        onClick={onGenerate}
        // Stays live while a voiceover renders — a second click queues another
        // one alongside it. The progress bar above is the feedback.
        disabled={!canGenerate || overLimit}
        className="mt-2 flex w-full items-center justify-center gap-2.5 glass-fill glass-fill-soft rounded-full border border-white/15 bg-voice-500 px-4 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] btn-soft-shadow transition-all hover:brightness-110 disabled:hover:brightness-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Mic className="h-4 w-4" strokeWidth={2.5} />
        {/* The noun stays at every width here. This column is 440px on a
            desktop and the whole screen on a phone, and the button now has the
            row to itself — the old editor-column footer shared a 375px line
            with the stepper and the player, which is what clipped it. */}
        <span className="truncate">
          Generate{count > 1 ? ` ${count}` : ''}
          {count === 1 ? ' Voiceover' : ' Voiceovers'}
        </span>
        {creditsLabel && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
            <Coins className="h-3 w-3" strokeWidth={2} />
            {creditsLabel}
          </span>
        )}
      </button>
    </div>
  )
}
