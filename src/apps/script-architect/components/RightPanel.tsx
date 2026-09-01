import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { ScriptHistoryItem } from '../../../stores/types'
import type { PendingScriptRun, RemixAngle, ScriptMode, WriteFormat } from '../types'
import OutputPanel from './OutputPanel'
import HistoryView from './HistoryView'
import SegmentedToggle from '../../../components/SegmentedToggle'

type Tab = 'output' | 'history'

interface RightPanelProps {
  variations: string[]
  outputAngles?: RemixAngle[] | null
  // Live left-panel mode — drives the empty/loading copy.
  mode: ScriptMode
  // Mode that produced the shown variations — drives the cards' labels.
  outputMode: ScriptMode
  writeFormat: WriteFormat
  writeStyleLabel: string
  // Hooks format only — labels the pack's card ("Best Mix" / a family name).
  hookCategoryLabel: string
  // Hooks format only — the live pick, so the empty/loading copy names the
  // number of hooks the next Generate will actually write.
  hookCount: number
  linkedProductId: string | null
  // Every run still being written. They are History rows from the moment they
  // are fired, so they no longer own the Output pane — and there can be several,
  // since Generate keeps working while one writes.
  pendingRuns: PendingScriptRun[]
  onWatchPending: (run: PendingScriptRun) => void
  error: string | null
  // Commits an inline edit of take `index` back to the persisted output state.
  onEditVariation: (index: number, text: string) => void
  // Remix only: the run's one voice brief, shown above the takes. Empty → no card.
  voiceProfile?: string
  onEditVoiceProfile?: (text: string) => void

  history: ScriptHistoryItem[]
  activeHistoryId: string | null
  onSelectHistory: (item: ScriptHistoryItem) => void
  onDeleteHistory: (id: string) => void
}

export default function RightPanel({
  variations,
  outputAngles,
  mode,
  outputMode,
  writeFormat,
  writeStyleLabel,
  hookCategoryLabel,
  hookCount,
  linkedProductId,
  pendingRuns,
  onWatchPending,
  error,
  onEditVariation,
  voiceProfile,
  onEditVoiceProfile,
  history,
  activeHistoryId,
  onSelectHistory,
  onDeleteHistory,
}: RightPanelProps) {
  const [tab, setTab] = useState<Tab>('output')

  // The pane is a slot addressed by id, so "is it watching something write?" is
  // a lookup, not a flag. Non-null is the one state that draws the writing face.
  const watchedRun = pendingRuns.find((r) => r.id === activeHistoryId) ?? null

  // "Clear the canvas" state. Holds a signature of the output that was cleared,
  // so the next generation (or a history restore) fills the panel again on its
  // own. Nothing is deleted — every take is already in the History tab; this
  // exists so the last run isn't sitting on camera while a new one is filmed.
  const [clearedSig, setClearedSig] = useState<string | null>(null)
  const outputSig = `${activeHistoryId ?? ''}|${variations.length}|${(variations[0] ?? '').slice(0, 64)}`
  const cleared = !watchedRun && variations.length > 0 && clearedSig === outputSig

  // Picking from History is a request to SEE that run, so it always uncovers
  // the canvas — including when the run picked is the one that was cleared,
  // which the signature alone reads as "still the thing I cleared" and left
  // blank. That was reported as history rows not opening at all.
  const showInOutput = () => {
    setClearedSig(null)
    setTab('output')
  }

  const handleSelectHistory = (item: ScriptHistoryItem) => {
    onSelectHistory(item)
    showInOutput()
  }

  const handleWatchPending = (run: PendingScriptRun) => {
    onWatchPending(run)
    showInOutput()
  }

  return (
    <div className="flex h-full flex-col">
      {/* Mirrors the left column's mode-toggle divider (same pt-4/pb-3 + pill
          height + border-ink/5) so the separator runs cleanly across both. */}
      <div className="flex h-[57px] items-center justify-between gap-3 border-b border-ink/5 px-5">
        <SegmentedToggle<Tab>
          className="h-10 !p-1"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'output', label: 'Output' },
            { value: 'history', label: 'History', badge: history.length + pendingRuns.length || undefined },
          ]}
        />
        {tab === 'output' && !cleared && !watchedRun && variations.length > 0 && (
          <button
            type="button"
            title="Clear the canvas"
            onClick={() => setClearedSig(outputSig)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-ink/[0.03] text-ink-300 transition-colors hover:bg-ink/[0.08] hover:text-ink-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tab === 'output' ? (
          <OutputPanel
            variations={cleared ? [] : variations}
            outputAngles={outputAngles}
            mode={outputMode}
            liveMode={mode}
            writeFormat={writeFormat}
            writeStyleLabel={writeStyleLabel}
            hookCategoryLabel={hookCategoryLabel}
            hookCount={hookCount}
            linkedProductId={linkedProductId}
            pendingRun={watchedRun}
            error={error}
            // What a "new set of takes" is, is the parent's knowledge: a run,
            // or the history row being shown. The panel scrolls back to the top
            // on this and on nothing else.
            runId={activeHistoryId}
            onEditVariation={onEditVariation}
            voiceProfile={cleared ? '' : voiceProfile}
            onEditVoiceProfile={onEditVoiceProfile}
          />
        ) : (
          <HistoryView
            items={history}
            pending={pendingRuns}
            activeId={activeHistoryId}
            onSelect={handleSelectHistory}
            onSelectPending={handleWatchPending}
            onDelete={onDeleteHistory}
          />
        )}
      </div>
    </div>
  )
}
