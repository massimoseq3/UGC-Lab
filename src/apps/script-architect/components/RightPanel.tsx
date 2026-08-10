import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { ScriptHistoryItem } from '../../../stores/types'
import type { RemixAngle, ScriptMode, WriteFormat } from '../types'
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
  isGenerating: boolean
  error: string | null
  // Commits an inline edit of take `index` back to the persisted output state.
  onEditVariation: (index: number, text: string) => void

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
  isGenerating,
  error,
  onEditVariation,
  history,
  activeHistoryId,
  onSelectHistory,
  onDeleteHistory,
}: RightPanelProps) {
  const [tab, setTab] = useState<Tab>('output')

  // "Clear the canvas" state. Holds a signature of the output that was cleared,
  // so the next generation (or a history restore) fills the panel again on its
  // own. Nothing is deleted — every take is already in the History tab; this
  // exists so the last run isn't sitting on camera while a new one is filmed.
  const [clearedSig, setClearedSig] = useState<string | null>(null)
  const outputSig = `${variations.length}|${(variations[0] ?? '').slice(0, 64)}`
  const cleared = !isGenerating && variations.length > 0 && clearedSig === outputSig

  const handleSelectHistory = (item: ScriptHistoryItem) => {
    onSelectHistory(item)
    setTab('output')
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
            { value: 'history', label: 'History', badge: history.length > 0 ? history.length : undefined },
          ]}
        />
        {tab === 'output' && !cleared && !isGenerating && variations.length > 0 && (
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
            isGenerating={isGenerating}
            error={error}
            onEditVariation={onEditVariation}
          />
        ) : (
          <HistoryView
            items={history}
            activeId={activeHistoryId}
            onSelect={handleSelectHistory}
            onDelete={onDeleteHistory}
          />
        )}
      </div>
    </div>
  )
}
