import { useMemo } from 'react'
import type { BrollResult, PromptVariation, CardState, ReferenceImage, BrollMode, ContinuousResult, ContinuousSelection, ContinuousFrameCardState, ContinuousClipCardState } from '../types'
import type { Product, Model, BrollHistoryItem } from '../../../stores/types'
import type { ContinuousStoryboardOp } from '../continuousEdits'
import { useBankStore } from '../../../stores/bankStore'
import { usePersistedState, useProjectScopedKey } from '../../../hooks/usePersistedState'
import ScenesView from './ScenesView'
import ContinuousView from './ContinuousView'
import BrollHistoryView, { isRetiredOneShotRow } from './BrollHistoryView'
import SegmentedToggle from '../../../components/SegmentedToggle'

interface RightPanelProps {
  mode: BrollMode
  result: BrollResult | null
  // Continuous mode (keyframe chain) state — owned by BrollStudio.
  continuousResult: ContinuousResult | null
  continuousModelId: string
  continuousFrameStates: Record<string, ContinuousFrameCardState>
  setContinuousFrameStates: React.Dispatch<React.SetStateAction<Record<string, ContinuousFrameCardState>>>
  continuousClipStates: Record<string, ContinuousClipCardState>
  setContinuousClipStates: React.Dispatch<React.SetStateAction<Record<string, ContinuousClipCardState>>>
  continuousSelections: Record<string, ContinuousSelection>
  setContinuousSelections: React.Dispatch<React.SetStateAction<Record<string, ContinuousSelection>>>
  onAddContinuousConcept: (frameIndex: number) => void
  onEditContinuousStoryboard: (op: ContinuousStoryboardOp) => void
  isGenerating?: boolean
  error?: string | null
  onAddVariation: (sceneNumber: number, variation: PromptVariation) => void
  onDeleteVariation: (sceneNumber: number, variationId: string) => void
  onUpdateVoiceProfile?: (text: string) => void
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
  selectedProduct?: Product | null
  selectedModel?: Model | null
  selectedProductId?: string
  selectedModelId?: string
  selectedScriptId?: string
  productContext?: string
  modelContext?: string
  onOpenCharacterPicker?: () => void
  onOpenProductPicker?: () => void
  cardStates: Record<string, CardState>
  setCardStates: React.Dispatch<React.SetStateAction<Record<string, CardState>>>
  activeHistoryId: string | null
  onSelectHistory: (item: BrollHistoryItem) => void
}

type Tab = 'scenes' | 'history'

// Right side of the B-Roll workspace. Owns the tab strip (Scenes / History)
// and the persisted per-card state. Image / video settings now live INSIDE
// each card's state — the page no longer has a global settings popover.
export default function RightPanel(props: RightPanelProps) {
  const {
    mode,
    result,
    continuousResult,
    continuousModelId,
    continuousFrameStates,
    setContinuousFrameStates,
    continuousClipStates,
    setContinuousClipStates,
    continuousSelections,
    setContinuousSelections,
    onAddContinuousConcept,
    onEditContinuousStoryboard,
    isGenerating,
    error,
    onAddVariation,
    onDeleteVariation,
    onUpdateVoiceProfile,
    characterRef,
    productRef,
    selectedProduct,
    selectedModel,
    selectedProductId,
    selectedModelId,
    selectedScriptId,
    productContext,
    modelContext,
    onOpenCharacterPicker,
    onOpenProductPicker,
    cardStates,
    setCardStates,
    activeHistoryId,
    onSelectHistory,
  } = props

  const baseKey = useProjectScopedKey('broll-studio')
  const [tab, setTab] = usePersistedState<Tab>(`${baseKey}:rightTab`, 'scenes')

  const allHistory = useBankStore((s) => s.brollHistory)
  const deleteBrollHistory = useBankStore((s) => s.deleteBrollHistory)
  // Sessions from the retired One-Shot mode stay on disk but aren't listed —
  // there's no mode left to open them in. Filtered here so the tab's count and
  // the list below always agree.
  const brollHistory = useMemo(() => allHistory.filter((it) => !isRetiredOneShotRow(it)), [allHistory])

  const isContinuous = mode === 'continuous'
  const sceneCount = isContinuous
    ? (continuousResult?.scenes.length ?? 0)
    : (result?.scenes.length ?? 0)
  const historyCount = brollHistory.length

  return (
    <div className="flex h-full flex-col">
      {/* Toggle strip — no global Settings popover anymore: each card owns its
          own settings inside its detail modal. */}
      <div className="flex h-[57px] items-center border-b border-ink/5 px-5">
        <SegmentedToggle<Tab>
          className="h-10 !p-1 min-w-0"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'scenes', label: isContinuous ? 'Continuous Storyboard' : 'Line by Line Storyboard', badge: sceneCount > 0 ? sceneCount : undefined },
            { value: 'history', label: 'History', badge: historyCount > 0 ? historyCount : undefined },
          ]}
        />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === 'scenes' && isContinuous ? (
          <ContinuousView
            result={continuousResult}
            isGenerating={isGenerating}
            error={error}
            characterRef={characterRef}
            productRef={productRef}
            selectedModel={selectedModel}
            selectedProduct={selectedProduct}
            productContext={productContext}
            modelContext={modelContext}
            continuousModelId={continuousModelId}
            frameStates={continuousFrameStates}
            setFrameStates={setContinuousFrameStates}
            clipStates={continuousClipStates}
            setClipStates={setContinuousClipStates}
            selections={continuousSelections}
            setSelections={setContinuousSelections}
            onAddConcept={onAddContinuousConcept}
            onEditStoryboard={onEditContinuousStoryboard}
          />
        ) : tab === 'scenes' ? (
          <ScenesView
            result={result}
            isGenerating={isGenerating}
            error={error}
            onAddVariation={onAddVariation}
            onDeleteVariation={onDeleteVariation}
            onUpdateVoiceProfile={onUpdateVoiceProfile}
            characterRef={characterRef}
            productRef={productRef}
            selectedProduct={selectedProduct}
            selectedModel={selectedModel}
            selectedProductId={selectedProductId}
            selectedModelId={selectedModelId}
            selectedScriptId={selectedScriptId}
            productContext={productContext}
            modelContext={modelContext}
            onOpenCharacterPicker={onOpenCharacterPicker}
            onOpenProductPicker={onOpenProductPicker}
            cardStates={cardStates}
            setCardStates={setCardStates}
          />
        ) : (
          <BrollHistoryView
            items={brollHistory}
            activeId={activeHistoryId}
            onSelect={(item) => {
              onSelectHistory(item)
              setTab('scenes')
            }}
            onDelete={(id) => { deleteBrollHistory(id) }}
          />
        )}
      </div>
    </div>
  )
}
