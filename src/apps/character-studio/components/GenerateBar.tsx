import { UserRound, LayoutGrid, Coins } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settingsStore'
import ModelPicker from '../../../components/ModelPicker'
import ConstraintChip from '../../../components/ConstraintChip'
import AspectIcon from '../../../components/AspectIcon'
import SegmentedToggle from '../../../components/SegmentedToggle'
import ModelWaitNotice from '../../../components/ModelWaitNotice'
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
  inFlightCount,
}: GenerateBarProps) {
  const persistedModel = useSettingsStore((s) => s.getAppModel('character-studio:image:text-to-image'))
  const selectedModelId = persistedModel ?? getDefaultModel('character-studio', 'image', 'text-to-image')?.id
  const creditsLabel = formatCredits(estimateCredits(selectedModelId ?? '', { imageCount: 1, resolution }))

  return (
    // Opaque bg on mobile (not /95 + blur): backdrop-filter doesn't re-blur
    // inside the already-blurred window frame, so any alpha let the form
    // underneath ghost through the sticky bar.
    <div className="sticky bottom-0 z-10 min-w-0 space-y-2 border-t border-ink/5 bg-surface-0 p-3 md:static md:rounded-t-2xl md:border md:border-b-0 md:border-ink/5 md:bg-ink/[0.03]">
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
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <ModelPicker
            appId="character-studio"
            task="image"
            mode="text-to-image"
            large
            costParams={{ imageCount: 1, resolution }}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ConstraintChip
            grow
            size="lg"
            openDirection="up"
            options={getModel(selectedModelId ?? '')?.imageConstraints?.resolutions ?? ['1K', '2K', '4K']}
            value={resolution}
            onChange={(v) => onResolutionChange(v as ImageResolution)}
            renderOption={(v) => {
              const credits = formatCredits(estimateCredits(selectedModelId ?? '', { imageCount: 1, resolution: v as ImageResolution }))
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
        </div>
      </div>
      <button
        onClick={onGenerate}
        disabled={!canGenerate}
        className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-influencers-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] btn-soft-shadow transition-all hover:bg-influencers-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {sheetMode ? <LayoutGrid className="h-4 w-4" strokeWidth={2.5} /> : <UserRound className="h-4 w-4" strokeWidth={2.5} />}
        <span>
          {sheetMode ? 'Generate Character Sheet' : 'Generate Character'}
          {inFlightCount > 0 && ` · ${inFlightCount} running`}
        </span>
        {creditsLabel && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
            <Coins className="h-3 w-3" strokeWidth={2} />
            {creditsLabel}
          </span>
        )}
      </button>

      {/* Wait notice (when shown) sits centered under the Generate button. */}
      <div className="!mt-1 flex items-center justify-center px-1">
        <ModelWaitNotice modelId={selectedModelId} />
      </div>
    </div>
  )
}
