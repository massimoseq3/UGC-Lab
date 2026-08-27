import { UserRound, LayoutGrid, Coins } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settingsStore'
import ModelPicker from '../../../components/ModelPicker'
import ConstraintChip from '../../../components/ConstraintChip'
import BatchCountStepper from '../../../components/BatchCountStepper'
import { clampBatchCount } from '../../../utils/batchCount'
import AspectIcon from '../../../components/AspectIcon'
import SegmentedToggle from '../../../components/SegmentedToggle'
import { estimateCredits, formatCredits, getDefaultModel, getModel, type ImageResolution } from '../../../utils/models'

interface GenerateBarProps {
  error: string | null
  onGenerate: () => void
  canGenerate: boolean
  aspectRatio: string
  onAspectRatioChange: (value: string) => void
  resolution: ImageResolution
  onResolutionChange: (value: ImageResolution) => void
  // Portrait vs character-sheet output. Both modes read the SAME aspect and
  // resolution — flipping the toggle changes what gets generated, never the
  // output settings the user picked.
  sheetMode: boolean
  onSheetModeChange: (value: boolean) => void
  // How many characters one press fires. Portraits and sheets alike — a sheet
  // is just as much a roll of the dice as a face.
  batchCount: number
  onBatchCountChange: (value: number) => void
  inFlightCount: number
}

// Aspect options offered by the dropdown. Stored values may be legacy verbose
// strings ('Portrait (9:16)') or raw ratios — normalizeAspect() collapses both
// to a raw ratio so the chip highlights the right option.
const ASPECT_OPTIONS = ['9:16', '16:9', '1:1']
// Character sheets only orient horizontally (turnaround strip) or vertically
// (stacked panels) — no square option, the panel layout needs the long axis.
// A 1:1 pick therefore shows as 9:16 in sheet mode; the stored portrait aspect
// is left untouched, so flipping back to Portrait still reads 1:1.
const SHEET_ASPECT_OPTIONS = ['16:9', '9:16']
function sheetAspectFor(ar: string): string {
  return normalizeAspect(ar) === '16:9' ? '16:9' : '9:16'
}
function normalizeAspect(ar: string): string {
  if (ar.includes('16:9')) return '16:9'
  if (ar.includes('1:1')) return '1:1'
  return '9:16'
}

// The action footer for the Influencers form: the model picker + resolution/
// aspect chips, the Generate button, and a tight Clear All. Lives at the foot
// of the left (controls) column so every input and the action sit together.
export default function GenerateBar({
  error,
  onGenerate,
  canGenerate,
  aspectRatio,
  onAspectRatioChange,
  resolution,
  onResolutionChange,
  sheetMode,
  onSheetModeChange,
  batchCount,
  onBatchCountChange,
  inFlightCount,
}: GenerateBarProps) {
  const persistedModel = useSettingsStore((s) => s.getAppModel('character-studio:image:text-to-image'))
  const selectedModelId = persistedModel ?? getDefaultModel('character-studio', 'image', 'text-to-image')?.id
  const count = clampBatchCount(batchCount)
  // Every image model's priceFor already multiplies by imageCount, so the
  // button's figure is the real cost of the whole run rather than one tile's.
  const creditsFor = (n: number) => estimateCredits(selectedModelId ?? '', { imageCount: n, resolution })
  const creditsLabel = formatCredits(creditsFor(count))

  return (
    // Static at every width. It was `sticky bottom-0` on a phone until August
    // 2026 (Massimo's call): a pinned band stood over the 28 fields it belongs
    // to and ate most of a short column, and the flow it protected wasn't worth
    // it — you fill the form top to bottom and Generate is where you arrive.
    // The opaque fill stays: it's still a band with a hairline over it, and
    // backdrop-filter has never re-blurred usefully here.
    <div className="min-w-0 space-y-2 border-t border-ink/5 bg-surface-0 p-3 md:rounded-t-2xl md:border md:border-b-0 md:border-ink/5 md:bg-ink/[0.03]">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
          <p className="text-xs leading-relaxed text-red-300 light:text-red-700">{error}</p>
        </div>
      )}
      {/* Output mode — a single portrait vs a multi-panel reference sheet
          (face turnaround + expressions + full body on a neutral studio bg). */}
      <SegmentedToggle<'portrait' | 'sheet'>
        value={sheetMode ? 'sheet' : 'portrait'}
        onChange={(v) => onSheetModeChange(v === 'sheet')}
        accent="influencers"
        className="h-12 !p-1"
        options={[
          { value: 'portrait', label: 'Portrait', icon: UserRound },
          { value: 'sheet', label: 'Character Sheet', icon: LayoutGrid },
        ]}
      />
      {/* Model picker + resolution / aspect chips split the row into two equal
          halves: the picker fills the left half (matching the preset pill above),
          the two chips share the right half. The footer chips open upward;
          resolution shows its credit cost. */}
      {/* Wraps on a phone: the right half holds THREE controls (resolution,
          aspect, and a −/+ stepper that needs ~90px to be pressable), and half
          of a 351px column can't seat them — the stepper's minus button fell
          off the edge. Model on its own line, the three chips under it. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 max-md:basis-full">
          <ModelPicker
            appId="character-studio"
            task="image"
            mode="text-to-image"
            large
            costParams={{ imageCount: 1, resolution }}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 max-md:basis-full">
          <ConstraintChip
            grow
            size="lg"
            openDirection="up"
            options={getModel(selectedModelId ?? '')?.imageConstraints?.resolutions ?? ['1K', '2K', '4K']}
            value={resolution}
            onChange={(v) => onResolutionChange(v as ImageResolution)}
            renderOption={(v) => {
              // Priced for the run that's actually armed, so this menu and the
              // Generate button can never quote two different numbers.
              const credits = formatCredits(estimateCredits(selectedModelId ?? '', { imageCount: count, resolution: v as ImageResolution }))
              return (
                <span className="flex w-full items-center justify-between gap-6">
                  <span>{v}</span>
                  {credits && <span className="text-ink-500">{credits}</span>}
                </span>
              )
            }}
          />
          {sheetMode ? (
            // Sheets pick between a 16:9 horizontal turnaround and a 9:16
            // vertical layout — the sheet prompt swaps panel composition to suit.
            <ConstraintChip
              grow
              size="lg"
              openDirection="up"
              options={SHEET_ASPECT_OPTIONS}
              value={sheetAspectFor(aspectRatio)}
              onChange={onAspectRatioChange}
              render={(v) => (
                <span className="flex items-center gap-1.5">
                  <AspectIcon ratio={v} />
                  <span>{v}</span>
                </span>
              )}
            />
          ) : (
            <ConstraintChip
              grow
              size="lg"
              openDirection="up"
              options={ASPECT_OPTIONS}
              value={normalizeAspect(aspectRatio)}
              onChange={onAspectRatioChange}
              render={(v) => (
                <span className="flex items-center gap-1.5">
                  <AspectIcon ratio={v} />
                  <span>{v}</span>
                </span>
              )}
            />
          )}
          {/* How many. A portrait is a casting call — the first face is almost
              never the one you keep — so the count sits with the other output
              settings rather than behind the button. */}
          <BatchCountStepper
            grow
            size="lg"
            accent="influencers"
            noun={sheetMode ? 'sheet' : 'character'}
            value={count}
            onChange={onBatchCountChange}
            creditsFor={creditsFor}
          />
        </div>
      </div>
      <button
        onClick={onGenerate}
        disabled={!canGenerate}
        className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-influencers-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] btn-soft-shadow transition-all hover:bg-influencers-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {sheetMode ? <LayoutGrid className="h-4 w-4" strokeWidth={2.5} /> : <UserRound className="h-4 w-4" strokeWidth={2.5} />}
        <span>
          {sheetMode
            ? (count === 1 ? 'Generate Character Sheet' : `Generate ${count} Character Sheets`)
            : (count === 1 ? 'Generate Character' : `Generate ${count} Characters`)}
          {inFlightCount > 0 && ` · ${inFlightCount} running`}
        </span>
        {creditsLabel && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
            <Coins className="h-3 w-3" strokeWidth={2} />
            {creditsLabel}
          </span>
        )}
      </button>
    </div>
  )
}
