import { useState } from 'react'
import type { Model, ScriptHistoryItem } from '../../../stores/types'
import type { RemixAngle, ScriptMode, WriteFormat, WriteLength } from '../types'
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
  linkedProductId: string | null
  // Influencer + clip length for the cinematic 'prompt' format's Playground
  // handoff (ignored by the other formats).
  influencer: Model | null
  cinematicDuration: WriteLength
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
  linkedProductId,
  influencer,
  cinematicDuration,
  isGenerating,
  error,
  onEditVariation,
  history,
  activeHistoryId,
  onSelectHistory,
  onDeleteHistory,
}: RightPanelProps) {
  const [tab, setTab] = useState<Tab>('output')

  const handleSelectHistory = (item: ScriptHistoryItem) => {
    onSelectHistory(item)
    setTab('output')
  }

  return (
    <div className="flex h-full flex-col">
      {/* Mirrors the left column's mode-toggle divider (same pt-4/pb-3 + pill
          height + border-ink/5) so the separator runs cleanly across both. */}
      <div className="flex h-[57px] items-center border-b border-ink/5 px-5">
        <SegmentedToggle<Tab>
          className="h-10 !p-1"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'output', label: 'Output' },
            { value: 'history', label: 'History', badge: history.length > 0 ? history.length : undefined },
          ]}
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tab === 'output' ? (
          <OutputPanel
            variations={variations}
            outputAngles={outputAngles}
            mode={outputMode}
            liveMode={mode}
            writeFormat={writeFormat}
            writeStyleLabel={writeStyleLabel}
            hookCategoryLabel={hookCategoryLabel}
            linkedProductId={linkedProductId}
            influencer={influencer}
            cinematicDuration={cinematicDuration}
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
