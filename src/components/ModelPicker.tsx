import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Star } from 'lucide-react'
import {
  listModels,
  getDefaultModel,
  estimateCredits,
  formatCredits,
  officialSavingsPercent,
  type Task,
  type Mode,
  type ModelEntry,
  type CostEstimateParams,
} from '../utils/models'
import { useSettingsStore } from '../stores/settingsStore'
import { APP_REGISTRY } from '../utils/constants'
import ProviderLogo from './ProviderLogo'
import SavingsPill from './SavingsPill'
import { MenuSurface } from './Menu'

// Append 8-digit alpha to a 6-digit hex accent for the selected-row tint.
function hexAlpha(hex: string, alpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alpha}` : hex
}

interface ModelPickerProps {
  appId: string
  task: Task
  mode?: Mode
  value?: string
  onChange?: (modelId: string) => void
  // When set, models whose `modes` don't include this are greyed out AND
  // unselectable — same semantics as ModelPickerModal, which this dropdown is the
  // sibling of. Greyed used to stay clickable as a soft hint, but a row you can
  // press and then watch fail reads as a bug, not a warning.
  requireMode?: Mode
  // Like requireMode, but satisfied by ANY of these modes — for a surface where
  // several modes get the job done (a still can be animated as a start frame OR
  // handed over as a reference image, so both count).
  requireAnyModes?: Mode[]
  // One-line explanation shown as a footer under the dropdown list when the
  // requirement dims at least one model.
  requireModeNote?: string
  // Slim single-line trigger (h-9, no provider sub-line) so the picker can
  // sit inline with ConstraintChips in a footer row.
  compact?: boolean
  // Roomier trigger (more padding, larger type) for footer rows where the
  // picker is the primary control. Ignored when `compact` is set.
  large?: boolean
  // The 58px PICKER-ROW height — the same geometry as ScriptModelRow and the
  // bank/style rows in Scripts and B-Roll (h-[58px], px-4, gap-3). For a
  // trigger that owns its own row in a settings stack rather than sharing one
  // with chips (which `large` does, at their 48px). Ignored when `compact`.
  row?: boolean
  // Cost params for the per-row credit estimate (e.g. current resolution),
  // mirroring ModelPickerModal. Defaults to a single image at base resolution.
  costParams?: CostEstimateParams
  // Restrict the list to these registry ids (e.g. B-Roll Continuous'
  // multi-cut-capable allowlist). Omit for the full task/mode catalog.
  allowedModelIds?: string[]
  // Override the settingsStore key this picker reads/writes. Without it the
  // key is derived from appId+task — which would collide with another picker
  // in the same app using the same task (B-Roll's per-card video picker).
  persistKey?: string
}

export default function ModelPicker({ appId, task, mode, value, onChange, requireMode, requireAnyModes, requireModeNote, compact, large, row, costParams, allowedModelIds, persistKey }: ModelPickerProps) {
  const setAppModel = useSettingsStore((s) => s.setAppModel)
  const persistedKey = persistKey ?? `${appId}:${task}${mode ? `:${mode}` : ''}`
  // Read the pick THROUGH the selector, never by calling a getter pulled out of
  // the store. `s.getAppModel` is a stable reference and `persistedKey` is a
  // constant for a given picker, so `getAppModel(persistedKey)` in the body is
  // a call the React Compiler caches on two deps that never change — it ran
  // once on mount and the trigger then showed that first model forever, however
  // many times you picked another one (the generation itself used the new pick,
  // since the services read getState() fresh, so the picker was simply lying).
  const persisted = useSettingsStore((s) => s.getAppModel(persistedKey))

  const [open, setOpen] = useState(false)
  const [openUpward, setOpenUpward] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // The selected-row check uses the owning app's accent (pink for Influencers,
  // orange for Scripts, …) so the picker feels native to whatever app it sits in.
  const accent = APP_REGISTRY.find((a) => a.id === appId)?.accent ?? '#38bdf8'

  const allModels = listModels({ task, mode })
  const scopedModels = allowedModelIds ? allModels.filter((m) => allowedModelIds.includes(m.id)) : allModels
  // Video has the longest lineup, so list it A–Z (by display name) rather than
  // registry order — otherwise newer entries just pile up at the bottom.
  const models = task === 'video'
    ? [...scopedModels].sort((a, b) => a.displayName.localeCompare(b.displayName))
    : scopedModels
  // Image and TTS have only a handful of models — show them as one flat list
  // (no pinned "recommended" group and no divider) so the dropdown reads
  // cleanly. With two TTS entries a pinned group would print one of them twice
  // over a hairline. The recommended star still shows inline on the models that
  // earn it.
  const flatList = task === 'image' || task === 'tts'
  // TTS is metered on the script you actually send (see `geminiTtsCredits`), so
  // a row can only quote the cost of a nominal 1000 characters — a number that
  // is neither what this run costs nor different between the two entries, since
  // they share one rate card. The Generate button prices the real script.
  const hideCredits = task === 'tts'
  const recommended = flatList ? [] : models.filter((m) => m.tags.includes('recommended'))
  const fallback = getDefaultModel(appId, task, mode)
  const resolved = value ?? persisted ?? fallback?.id
  const selected = models.find((m) => m.id === resolved)

  // Mirror the rows on the collapsed trigger with the same "% off" chip (the
  // per-params credit cost lives on the Generate button, not here).
  const selectedSavings = selected ? officialSavingsPercent(selected.id) : null

  // Whether a model is out of scope for this surface — greyed AND unselectable,
  // same rule as ModelPickerModal's isMuted.
  const isMuted = (m: ModelEntry) =>
    (!!requireMode && !m.modes?.includes(requireMode)) ||
    (!!requireAnyModes && requireAnyModes.length > 0 && !requireAnyModes.some((mode) => m.modes?.includes(mode)))

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  function pick(modelId: string) {
    setAppModel(persistedKey, modelId)
    onChange?.(modelId)
    setOpen(false)
  }

  if (models.length === 0) {
    return (
      <div className="text-[11px] text-ink-600">
        No models available for {task}{mode ? ` / ${mode}` : ''}.
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect()
            const spaceBelow = window.innerHeight - rect.bottom
            const spaceAbove = rect.top
            // Dropdown is up to ~360px tall. Flip up if there's not enough room below.
            setOpenUpward(spaceBelow < 360 && spaceAbove > spaceBelow)
          }
          setOpen((v) => !v)
        }}
        className={
          compact
            ? 'flex h-9 w-full items-center gap-2 rounded-full border border-ink/10 bg-ink/[0.02] px-2 text-left transition-colors hover:bg-ink/[0.05]'
            : row
            ? 'flex h-[58px] w-full items-center gap-3 rounded-full border border-ink/10 bg-ink/[0.02] px-4 text-left transition-colors hover:bg-ink/[0.05]'
            : large
            ? 'flex h-12 w-full items-center gap-3 rounded-full border border-ink/10 bg-ink/[0.02] px-4 text-left transition-colors hover:bg-ink/[0.05]'
            : 'flex h-12 w-full items-center gap-2.5 rounded-full border border-ink/10 bg-ink/[0.02] px-3 text-left transition-colors hover:bg-ink/[0.05]'
        }
      >
        {selected ? (
          compact ? (
            <>
              <ProviderLogo provider={selected.provider} size="sm" />
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate text-[12px] font-medium text-ink-100">{selected.displayName}</span>
                {selected.tags.includes('recommended') && (
                  <Star className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400 light:fill-yellow-600 light:text-yellow-600" strokeWidth={1.5} />
                )}
                {selectedSavings != null && <SavingsPill pct={selectedSavings} />}
              </div>
            </>
          ) : (
            <>
              <ProviderLogo provider={selected.provider} />
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {/* One trigger text size across every surface — `large` only
                    widens the padding/gap, it never bumps the type. */}
                <span className="truncate text-[13px] font-medium text-ink-100">{selected.displayName}</span>
                {selected.tags.includes('recommended') && (
                  <Star className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400 light:fill-yellow-600 light:text-yellow-600" strokeWidth={1.5} />
                )}
                {selectedSavings != null && <SavingsPill pct={selectedSavings} />}
              </div>
            </>
          )
        ) : (
          <span className="flex-1 truncate text-sm text-ink-400">Select model</span>
        )}
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <MenuSurface
          className={`absolute left-0 right-0 z-50 ${openUpward ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
        >
          <div className="max-h-[min(360px,60vh)] overflow-y-auto">
            {/* Recommended (starred) models pinned to the top for quick access,
                then a hairline, then the full list below (the starred ones
                appear in both places). */}
            {recommended.map((m) => {
              const muted = isMuted(m)
              return (
                <ModelRow
                  key={`rec-${m.id}`}
                  model={m}
                  active={m.id === resolved}
                  muted={muted}
                  accent={accent}
                  costParams={{ imageCount: 1, ...costParams }}
                  noCredits={hideCredits}
                  onClick={() => pick(m.id)}
                />
              )
            })}
            {recommended.length > 0 && <div className="h-px bg-ink/10" />}
            {models.map((m) => {
              const muted = isMuted(m)
              return (
                <ModelRow
                  key={m.id}
                  model={m}
                  active={m.id === resolved}
                  muted={muted}
                  accent={accent}
                  costParams={{ imageCount: 1, ...costParams }}
                  noCredits={hideCredits}
                  onClick={() => pick(m.id)}
                />
              )
            })}
          </div>
          {requireModeNote && models.some(isMuted) && (
            <p className="border-t border-ink/10 px-4 py-2.5 text-[11px] leading-relaxed text-ink-500">
              {requireModeNote}
            </p>
          )}
        </MenuSurface>
      )}
    </div>
  )
}

// The green "% off vs the official API" chip — shared by the collapsed trigger
// and each dropdown row so they read identically.
interface ModelRowProps {
  model: ModelEntry
  active: boolean
  muted?: boolean
  accent: string
  costParams: CostEstimateParams
  // Drop the credit estimate from the row's meta line. For a task whose price
  // can't be known at pick time — see `hideCredits` at the call site.
  noCredits?: boolean
  onClick: () => void
}

// Credit estimate across a model's resolution tiers: the flat price when the
// model has one tier (or price doesn't vary), otherwise "from {cheapest}
// credits" so the row leads with the lowest cost the user can pay.
function creditRange(modelId: string, tiers: string[] | undefined, costParams: CostEstimateParams): string | null {
  if (!tiers?.length) return formatCredits(estimateCredits(modelId, costParams))
  const lo = estimateCredits(modelId, { ...costParams, resolution: tiers[0] })
  const hi = estimateCredits(modelId, { ...costParams, resolution: tiers[tiers.length - 1] })
  if (lo == null) return null
  if (hi == null || hi === lo) return formatCredits(lo)
  return `from ${formatCredits(lo)}`
}

// Row aesthetic mirrors ModelPickerModal: provider logo, name + star + colored
// tag words, a quiet metadata sub-line (resolution range · [duration] ·
// credits), and an accent-tinted selected state with an accent check. The
// modal and this dropdown are one visual family; only the container differs.
function ModelRow({ model, active, muted, accent, costParams, noCredits, onClick }: ModelRowProps) {
  const isRecommended = model.tags.includes('recommended')
  // Discount vs the provider's official API — only for models with a verified
  // official rate in the registry (see ModelEntry.official).
  const savings = officialSavingsPercent(model.id)

  // Resolution tiers drive the credit span only — we no longer print the range
  // itself. Video tiers still need human labels ('std'→'720p') for the estimate.
  const cv = model.videoConstraints
  const ci = model.imageConstraints
  const res = cv?.resolutions ?? ci?.resolutions
  const duration = cv
    ? cv.durations.length > 1
      ? `${cv.durations[0]}–${cv.durations[cv.durations.length - 1]}s`
      : cv.durations.length === 1
      ? `${cv.durations[0]}s`
      : 'per clip'
    : null
  // Lead with the cheapest tier ("from N credits") rather than a low–high span.
  const credits = noCredits ? null : creditRange(model.id, res, costParams)
  const meta = [duration, credits].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={muted}
      aria-disabled={muted}
      style={active && !muted ? { backgroundColor: hexAlpha(accent, '1a') } : undefined}
      /* The house menu row (see components/Menu.tsx): full-bleed at the same
         16px inset, no pill of its own. A two-line row with a provider logo is
         too much content for `MenuItem`'s single label slot, so it borrows the
         geometry rather than the component. */
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        muted ? 'cursor-not-allowed opacity-30 grayscale' : active ? '' : 'hover:bg-ink/[0.06]'
      }`}
    >
      <ProviderLogo provider={model.provider} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-[13px] font-semibold leading-snug text-ink-100 ${muted ? 'line-through decoration-ink-400' : ''}`}>{model.displayName}</span>
          {isRecommended && (
            <Star className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400 light:fill-yellow-600 light:text-yellow-600" strokeWidth={1.5} />
          )}
        </div>
        {/* The "% off" chip rides the META line, beside the credits it is a
            discount ON (Massimo's call, September 2026). On the name line it
            was a green block interrupting the one thing the row is scanned for
            — and it sat two lines above the number it refers to. */}
        {(meta || savings != null) && (
          <div className="mt-px flex min-w-0 items-center gap-1.5">
            {meta && <p className="truncate text-[11px] leading-tight text-ink-500">{meta}</p>}
            {savings != null && <SavingsPill pct={savings} />}
          </div>
        )}
      </div>

      {active && <Check className="h-4 w-4 shrink-0" style={{ color: accent }} />}
    </button>
  )
}
