import { useMemo } from 'react'
import { Film, Plus } from 'lucide-react'
import type { BrollResult, PromptVariation, CardState, ReferenceImage, BrollMode, ContinuousResult, ContinuousSelection, ContinuousFrameCardState, ContinuousClipCardState } from '../types'
import type { Product, Model, BrollHistoryItem } from '../../../stores/types'
import type { ContinuousStoryboardOp } from '../continuousEdits'
import { useBankStore } from '../../../stores/bankStore'
import { usePersistedState, useProjectScopedKey } from '../../../hooks/usePersistedState'
import ScenesView from './ScenesView'
import ContinuousView from './ContinuousView'
import BrollHistoryView, { isRetiredOneShotRow } from './BrollHistoryView'
import SegmentedToggle from '../../../components/SegmentedToggle'
import GridCanvas, { AwaitingBody } from '../../../components/GridCanvas'

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
  onEditSceneLine?: (sceneNumber: number, line: string) => void
  onUpdateVoiceProfile?: (text: string) => void
  characterRef?: ReferenceImage
  productRef?: ReferenceImage
  productPhotos?: string[]
  onChangeStyle?: () => void
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
  // Canvas-clear state, owned by BrollStudio so the left panel's "New" can
  // trigger it too. Never touches data — the session stays a History row.
  canvasCleared: boolean
  onClearCanvas: () => void
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
    onEditSceneLine,
    onUpdateVoiceProfile,
    characterRef,
    productRef,
    productPhotos,
    onChangeStyle,
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
    canvasCleared,
    onClearCanvas,
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

  // "Clear the canvas" — the header's + and the left panel's New both empty the
  // storyboard so the last session isn't on camera while a new one is filmed.
  // Nothing is deleted (the session is a History row); the state lives in
  // BrollStudio because New fires from the other column.
  const cleared = !isGenerating && sceneCount > 0 && canvasCleared

  // The grid canvas marks a stage with nothing on it yet. Once the storyboard
  // renders, it goes — behind a wall of cards it's just noise.
  const showCanvas = cleared || !!isGenerating || sceneCount === 0

  return (
    <div className="flex h-full flex-col">
      {/* Toggle strip — no global Settings popover anymore: each card owns its
          own settings inside its detail modal. */}
      <div className="flex h-[57px] items-center justify-between gap-3 border-b border-ink/5 px-5">
        <SegmentedToggle<Tab>
          className="h-10 !p-1 min-w-0"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'scenes', label: isContinuous ? 'Continuous Storyboard' : mode === 'dialogue' ? 'Dialogue Storyboard' : 'B-Roll Storyboard', badge: sceneCount > 0 ? sceneCount : undefined },
            { value: 'history', label: 'History', badge: historyCount > 0 ? historyCount : undefined },
          ]}
        />
        {tab === 'scenes' && !cleared && !isGenerating && sceneCount > 0 && (
          <button
            type="button"
            title="Clear the canvas"
            onClick={onClearCanvas}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-ink/[0.03] text-ink-300 transition-colors hover:bg-ink/[0.08] hover:text-ink-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* The storyboard works on the same graph-paper canvas as the other
            apps' output panels. History keeps the plain surface — it's the
            reel, not the stage. */}
        {tab === 'history' ? (
          <BrollHistoryView
            items={brollHistory}
            activeId={activeHistoryId}
            onSelect={(item) => {
              onSelectHistory(item)
              setTab('scenes')
            }}
            onDelete={(id) => { deleteBrollHistory(id) }}
          />
        ) : (
        <CanvasFrame active={showCanvas}>
        {cleared ? (
          <AwaitingBody
            icon={Film}
            title="Awaiting storyboard"
            hint="Your next storyboard lands here. Nothing was deleted — this session is saved in History."
          />
        ) : isContinuous ? (
          <ContinuousView
            result={continuousResult}
            isGenerating={isGenerating}
            error={error}
            characterRef={characterRef}
            productRef={productRef}
            productPhotos={productPhotos}
            onChangeStyle={onChangeStyle}
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
        ) : (
          <ScenesView
            result={result}
            isGenerating={isGenerating}
            error={error}
            onAddVariation={onAddVariation}
            onDeleteVariation={onDeleteVariation}
            onEditSceneLine={onEditSceneLine}
            onUpdateVoiceProfile={onUpdateVoiceProfile}
            characterRef={characterRef}
            productRef={productRef}
            productPhotos={productPhotos}
            onChangeStyle={onChangeStyle}
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
        )}
        </CanvasFrame>
        )}
      </div>
    </div>
  )
}

// The storyboard column, with or without the grid behind it. Both branches keep
// the same flex shape so toggling the canvas never reflows the view.
function CanvasFrame({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (active) return <GridCanvas>{children}</GridCanvas>
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>
}
