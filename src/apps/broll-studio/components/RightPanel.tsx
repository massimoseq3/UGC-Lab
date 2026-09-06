import { useMemo } from 'react'
import { Film } from 'lucide-react'
import type { BrollResult, PromptVariation, CardState, ReferenceImage, BrollMode, ContinuousResult, ContinuousSelection, ContinuousFrameCardState, ContinuousClipCardState } from '../types'
import type { Product, Model, BrollHistoryItem } from '../../../stores/types'
import type { ContinuousStoryboardOp } from '../continuousEdits'
import { useBankStore } from '../../../stores/bankStore'
import { usePersistedState, useProjectScopedKey } from '../../../hooks/usePersistedState'
import { useMinWidth } from '../../../hooks/useBreakpoint'
import ScenesView from './ScenesView'
import ContinuousView from './ContinuousView'
import HistoryRail from './HistoryRail'
import HistoryRailHandle from '../../../components/HistoryRailHandle'
import HistoryRailToggle, { HistoryRailClosed } from '../../../components/HistoryRailToggle'
import { brollHistoryMode, isRetiredOneShotRow } from './brollHistoryRows'
import GridCanvas, { AwaitingBody } from '../../../components/GridCanvas'

interface RightPanelProps {
  mode: BrollMode
  // False when Continuous is switched off in Settings → Experimental. It hides
  // Continuous sessions from History (there's no mode left to open one in — the
  // rule the retired One-Shot rows already follow) and drops the "Line by Line"
  // qualifier from the Storyboard tab, which only existed to tell the two
  // storyboards apart. Nothing is deleted; the rows come back with the switch.
  continuousEnabled: boolean
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
  // trigger it too. Never touches generated data — the session stays a History
  // row — but the app's handler DOES reset the setup column alongside the
  // canvas, which is why the rail's New button arms first.
  canvasCleared: boolean
  onClearCanvas: () => void
}

// Right side of the B-Roll workspace. Owns the History rail beside the
// storyboard and the persisted per-card state. Image / video settings live
// INSIDE each card's state — the page has no global settings popover.
export default function RightPanel(props: RightPanelProps) {
  const {
    mode,
    continuousEnabled,
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
  // Behaviour, not layout: where the rail covers the storyboard, picking a
  // session has to hand the pane back; beside it, it must not. Keep the number
  // in step with the `min-[980px]:` classes below — it is Scripts' threshold,
  // and the reasoning is in `HistoryRailHandle`.
  const railIsColumn = useMinWidth(980)
  // Whether the rail is showing. It opens by default where it can sit BESIDE
  // the storyboard and stays shut where it would cover it — clicking into this
  // app should land on the clips, not on the list of the ones you made before.
  // Its own slot: the old `:rightTab` held 'scenes' | 'history', so a stored
  // value there means nothing here.
  const [historyOpen, setHistoryOpen] = usePersistedState<boolean>(`${baseKey}:historyRail`, railIsColumn)

  const allHistory = useBankStore((s) => s.brollHistory)
  const deleteBrollHistory = useBankStore((s) => s.deleteBrollHistory)
  // Sessions there's no mode left to open stay on disk but aren't listed: the
  // retired One-Shot rows always, and the Continuous ones while that mode is
  // switched off. Filtered here so the tab's count and the list below agree.
  const brollHistory = useMemo(
    () => allHistory.filter((it) => (
      !isRetiredOneShotRow(it) && (continuousEnabled || brollHistoryMode(it) !== 'continuous')
    )),
    [allHistory, continuousEnabled],
  )

  const isContinuous = mode === 'continuous'
  const sceneCount = isContinuous
    ? (continuousResult?.scenes.length ?? 0)
    : (result?.scenes.length ?? 0)

  // "Clear the canvas" — the header's + and the left panel's New both empty the
  // storyboard so the last session isn't on camera while a new one is filmed.
  // Nothing is deleted (the session is a History row); the state lives in
  // BrollStudio because New fires from the other column.
  const cleared = !isGenerating && sceneCount > 0 && canvasCleared

  // The grid canvas marks a stage with nothing on it yet. Once the storyboard
  // renders, it goes — behind a wall of cards it's just noise.
  const showCanvas = cleared || !!isGenerating || sceneCount === 0

  // Shut, the toggle rides INSIDE the storyboard's own bar rather than in a
  // column of its own (September 2026, Massimo's call): a column narrowed the
  // storyboard by ~135px and left the button standing on bare panel beside a
  // frosted bar. In the bar, that glass runs under it and the storyboard keeps
  // its width. Open, this is undefined — the rail is shut from the lip on the
  // seam instead.
  //
  // Two widths it can't go there, and both fall back to the column below: with
  // no storyboard there is no bar at all, and under `md` the Continuous strip's
  // pills wrap, so neither strip is the pinned single row this sits in. The
  // choice is made in CSS — `hidden md:block` here against `md:hidden` on the
  // column — so nothing has to read a breakpoint in JS.
  const railToggle = historyOpen ? (
    // Open, the bar carries no button — the rail is shut from the LIP, which
    // floats over this bar at the column's right edge. What it does carry is
    // the lip's own width as a spacer, so the strip's scrolling pill row ends
    // short of it instead of sliding underneath. The lip can't live IN the bar:
    // it has to hang on the pane's edge, outside the bar's padding, or it stops
    // being a tab on the seam.
    <div aria-hidden className="w-6" />
  ) : (
    <div className="hidden md:block">
      <HistoryRailToggle
        open={false}
        onToggle={() => setHistoryOpen(true)}
        showLabel
        count={brollHistory.length}
      />
    </div>
  )

  return (
    // NO header band on this pane. It held a Storyboard / History
    // `SegmentedToggle` and the canvas reset; History is a rail beside the
    // storyboard now and the reset leads that rail, which left 57px saying
    // nothing over the one thing this column is for.
    <div className="flex h-full min-h-0">
      {/* From 980px the rail is a column and the storyboard keeps its own;
          below that it stands in FRONT of it — the shape the tab had, and
          picking a session hands the pane back. */}
      <div
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
          historyOpen ? 'hidden min-[980px]:flex' : 'flex'
        }`}
      >
        {/* Open, the rail is shut from the LIP on the seam this column's
            right edge makes with it. Shut, there is no seam to hang one on, so
            the way back in is the labelled History button — in the storyboard
            bar where there is one, in a stub column where there isn't. */}
        {historyOpen && <HistoryRailHandle onCollapse={() => setHistoryOpen(false)} />}

        {/* The storyboard works on the same graph-paper canvas as the other
            apps' output panels. History keeps the plain surface — it's the
            reel, not the stage. */}
        <CanvasFrame active={showCanvas}>
        {cleared ? (
          <AwaitingBody
            icon={Film}
            title="Awaiting Storyboard"
            hint="Your next storyboard lands here. Nothing was deleted. This session is saved in History."
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
            railToggle={railToggle}
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
            railToggle={railToggle}
          />
        )}
        </CanvasFrame>
      </div>

      {historyOpen ? (
        <div className="flex min-h-0 w-full flex-col border-l border-ink/5 min-[980px]:w-[280px] min-[980px]:shrink-0">
          <HistoryRail
            items={brollHistory}
            activeId={activeHistoryId}
            onSelect={(item) => {
              onSelectHistory(item)
              // Where the rail covers the storyboard, picking a session is a
              // request to see it.
              if (!railIsColumn) setHistoryOpen(false)
            }}
            onDelete={(id) => { deleteBrollHistory(id) }}
            onNew={onClearCanvas}
            onCollapse={() => setHistoryOpen(false)}
          />
        </div>
      ) : (
        // The fallback for the two cases the bar can't take it — see the note
        // on `railToggle`. With a storyboard up it is a phone-only column; with
        // none it is the only place the toggle has, at every width.
        <div className={showCanvas ? 'flex' : 'flex md:hidden'}>
          <HistoryRailClosed onExpand={() => setHistoryOpen(true)} count={brollHistory.length} />
        </div>
      )}
    </div>
  )
}

// The storyboard column, with or without the grid behind it. Both branches keep
// the same flex shape so toggling the canvas never reflows the view.
function CanvasFrame({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (active) return <GridCanvas>{children}</GridCanvas>
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>
}
