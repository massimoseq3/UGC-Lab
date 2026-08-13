import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Check } from 'lucide-react'
import {
  listModels,
  getDefaultModel,
  videoResolutionLabel,
  estimateCredits,
  formatCredits,
  officialSavingsPercent,
  TAG_STYLES,
  type Task,
  type Mode,
  type Tag,
  type ModelEntry,
  type CostEstimateParams,
} from '../utils/models'
import { useSettingsStore } from '../stores/settingsStore'
import { useIsDesktop } from '../hooks/useBreakpoint'
import { useCloseOnAppSwitch } from '../hooks/useCloseOnAppSwitch'
import ProviderLogo from './ProviderLogo'
import SavingsPill from './SavingsPill'
import { ProviderRail, ProviderHeading, StarBadge } from './modelPalette'
import { providersOf, groupByProvider } from '../utils/providerGroups'
import useCloseOnEscape from '../hooks/useCloseOnEscape'

// Slide-in side-panel model picker (mirrors BankPicker's mechanics). Used by
// B-Roll in place of the inline ModelPicker dropdown. Selection is persisted
// through the SAME settingsStore key as ModelPicker (`appId:task[:mode]`), so
// the two pickers stay interchangeable — swapping one for the other keeps the
// user's saved choice.

// Host-app accent for the selected-row tint and check/star icons. Explicit
// class strings (not template interpolation) so Tailwind sees them; the
// 100–400 tints auto-flip in light mode, so no `light:` variants needed.
const ACCENTS: Record<string, { selectedBg: string; icon: string; pillActive: string }> = {
  'broll-studio': {
    selectedBg: 'bg-broll-500/10',
    icon: 'text-broll-400',
    pillActive: 'border-broll-500/40 bg-broll-500/15 text-broll-200',
  },
  playground: {
    selectedBg: 'bg-playground-500/15',
    icon: 'text-playground-300',
    pillActive: 'border-playground-500/40 bg-playground-500/15 text-playground-200',
  },
}

// Capability quick-filters for the video picker — tap to narrow the list to
// models that accept that input shape (multi-select; none active = show all).
// Only pills that at least one visible model supports are rendered.
const VIDEO_CAPABILITY_FILTERS: { mode: Mode; label: string }[] = [
  { mode: 'frames-to-video', label: 'Start + end frame' },
  { mode: 'image-to-video', label: 'Start frame' },
  { mode: 'reference-to-video', label: 'Reference images' },
  { mode: 'text-to-video', label: 'Text to video' },
]

// Non-recommended tags render as small colored words (no pill chrome) — same
// hues as TAG_STYLES, text only. Recommended is carried by the star icon.
const TAG_TEXT: Record<Tag, string> = {
  recommended: 'text-emerald-300 light:text-emerald-700',
  new: 'text-fuchsia-300 light:text-fuchsia-700',
  fast: 'text-sky-300 light:text-sky-700',
  cheap: 'text-ink-400',
}
interface ModelSidePanelProps {
  appId: string
  task: Task
  mode?: Mode
  isOpen: boolean
  onClose: () => void
  // Hint mode: models whose `modes` don't include this are dimmed but still
  // selectable (same semantics as ModelPicker's requireMode).
  requireMode?: Mode
  // Like requireMode, but satisfied by ANY of these modes — a model is dimmed
  // only when it supports none of them. Used by the Animate tabs, where a still
  // can drive either an image-to-video OR a reference-to-video model.
  requireAnyModes?: Mode[]
  // One-line note shown in the footer when requireMode dims at least one model.
  requireModeNote?: string
  // Cost params for the per-row credit estimate (e.g. duration/resolution/audio).
  costParams?: CostEstimateParams
  // Restrict which models are LISTED at all (e.g. B-Roll hides motion-control
  // models). Omit to show every model for the task.
  allowedModelIds?: string[]
  // Of the listed models, which are actually selectable. Any listed model NOT
  // in this set is shown greyed + disabled (same look as requireMode dimming).
  // Use for curated sets that aren't derivable from a single mode — e.g.
  // a "built for the ref+audio multi-cut" subset. Omit to enable all.
  enabledModelIds?: string[]
  // Optional controlled mode: when both are provided the panel reflects `value`
  // and reports picks through `onChange` instead of reading/writing settingsStore
  // (lets a controlled consumer like Playground reuse the same panel).
  value?: string
  onChange?: (modelId: string) => void
}

export default function ModelSidePanel({
  appId,
  task,
  mode,
  isOpen,
  onClose,
  requireMode,
  requireAnyModes,
  requireModeNote,
  costParams = {},
  allowedModelIds,
  enabledModelIds,
  value,
  onChange,
}: ModelSidePanelProps) {
  const setAppModel = useSettingsStore((s) => s.setAppModel)
  const persistedKey = `${appId}:${task}${mode ? `:${mode}` : ''}`
  // Through the selector, not via a getter held in a const — see the note in
  // ModelPicker: both deps of such a call are stable, so the compiler caches
  // the result for the life of the mount and the checked row never moves.
  const persisted = useSettingsStore((s) => s.getAppModel(persistedKey))

  const [search, setSearch] = useState('')
  // Active capability filters (video only). None = show all.
  const [capFilters, setCapFilters] = useState<Set<Mode>>(new Set())
  // Provider rail. null = every provider.
  const [providerFilter, setProviderFilter] = useState<string | null>(null)
  // The rail's star: show only the recommended models.
  const [starredOnly, setStarredOnly] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const isDesktop = useIsDesktop()
  const accent = ACCENTS[appId] ?? ACCENTS['broll-studio']

  const scopedModels = listModels({ task, mode }).filter((m) => !allowedModelIds || allowedModelIds.includes(m.id))
  // Video has the longest lineup, so list it A–Z (by display name) rather than
  // registry order — otherwise newer entries just pile up at the bottom.
  const models = task === 'video'
    ? [...scopedModels].sort((a, b) => a.displayName.localeCompare(b.displayName))
    : scopedModels
  const fallback = getDefaultModel(appId, task, mode)
  const resolved = value ?? persisted ?? fallback?.id

  // Whether a model is selectable — greyed + disabled otherwise. A model is
  // muted when it falls outside the enabled set, OR when requireMode is set and
  // the model can't do that mode.
  const isMuted = (m: ModelEntry): boolean =>
    (!!enabledModelIds && !enabledModelIds.includes(m.id)) ||
    (!!requireMode && !m.modes?.includes(requireMode)) ||
    (!!requireAnyModes && requireAnyModes.length > 0 && !requireAnyModes.some((mode) => m.modes?.includes(mode)))

  // Capability pills — only render ones some listed model actually supports.
  const availableFilters = task === 'video'
    ? VIDEO_CAPABILITY_FILTERS.filter((f) => models.some((m) => m.modes?.includes(f.mode)))
    : []

  // Filter by display name / provider, then by any active capability pill, then
  // by the provider rail, then group under provider headings — the same shape
  // the chat picker uses, so picking a renderer and picking a writer read as
  // one act. Recommended models keep their star; the old Featured/All split is
  // gone, because two ways of grouping one list is one too many.
  const searched = search.trim()
    ? models.filter(
        (m) =>
          m.displayName.toLowerCase().includes(search.toLowerCase()) ||
          m.provider.toLowerCase().includes(search.toLowerCase()),
      )
    : models
  const capFiltered = capFilters.size > 0
    ? searched.filter((m) => Array.from(capFilters).some((mode) => m.modes?.includes(mode)))
    : searched
  const railFiltered = providerFilter ? capFiltered.filter((m) => m.provider === providerFilter) : capFiltered
  const filtered = starredOnly ? railFiltered.filter((m) => m.tags.includes('recommended')) : railFiltered
  const providers = providersOf(models)
  // Selectable before muted inside a provider, then recommended, then A–Z: a
  // greyed-out model is an explanation, not a candidate, so it sinks.
  const groups = groupByProvider(filtered, (a, b) =>
    Number(isMuted(a)) - Number(isMuted(b)) ||
    Number(b.tags.includes('recommended')) - Number(a.tags.includes('recommended')) ||
    a.displayName.localeCompare(b.displayName),
  )

  // Reset search + capability filters + provider rail + focus on open.
  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setCapFilters(new Set())
      setProviderFilter(null)
      setStarredOnly(false)
      setTimeout(() => searchRef.current?.focus(), 100)
    }
  }, [isOpen])

  const toggleFilter = (m: Mode) =>
    setCapFilters((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })

  useCloseOnAppSwitch(isOpen, onClose)

  useCloseOnEscape(isOpen, onClose)

  function pick(modelId: string) {
    if (onChange) onChange(modelId)
    else setAppModel(persistedKey, modelId)
    onClose()
  }

  const showRequireNote =
    !!requireModeNote &&
    ((!!requireMode && models.some((m) => !m.modes?.includes(requireMode))) ||
      (!!requireAnyModes && requireAnyModes.length > 0 && models.some((m) => !requireAnyModes.some((mode) => m.modes?.includes(mode)))) ||
      (!!enabledModelIds && models.some((m) => !enabledModelIds.includes(m.id))))

  // Render through a portal so the panel parents at document root, not inside
  // the B-Roll CardDetailModal (which has its own transform/backdrop context).
  const portalTarget = typeof document !== 'undefined' ? document.body : null
  if (!portalTarget) return null

  const panel = (
    <>
      {/* Backdrop — z-[70] sits above the sidebar (z-40) and the B-Roll
          CardDetailModal (z-[60]) it's opened from. */}
      <div
        className={`fixed inset-0 z-[70] bg-black/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed z-[80] flex flex-col border-ink/5 bg-surface-1/95 backdrop-blur-2xl transition-transform duration-300 ease-out ${
          isDesktop
            ? `right-0 top-0 bottom-0 w-[380px] border-l ${isOpen ? 'translate-x-0' : 'translate-x-full'}`
            : `inset-x-0 bottom-0 top-14 border-t rounded-t-2xl ${isOpen ? 'translate-y-0' : 'translate-y-full'}`
        }`}
      >
        {/* Drag handle — mobile only */}
        {!isDesktop && (
          <div className="flex justify-center pt-2 pb-1">
            <div className="h-1 w-10 rounded-full bg-ink/20" />
          </div>
        )}

        {/* Header — no full-bleed border; the search block below does the
            visual separating with whitespace alone. */}
        <div className="flex items-start justify-between px-5 pb-2 pt-5">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold tracking-tight text-ink-100">{task === 'image' ? 'Image Model' : task === 'video' ? 'Video Model' : 'Model'}</h3>
            <p className="mt-0.5 text-[11px] text-ink-600">{filtered.length} of {models.length} models</p>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 rounded-full p-2 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pb-2">
          <div className="flex h-10 items-center gap-2.5 rounded-full bg-ink/[0.05] px-4 transition-colors focus-within:bg-ink/[0.08]">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-600" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models"
              className="w-full bg-transparent text-sm text-ink-200 placeholder-ink-600 outline-none"
            />
          </div>
        </div>

        {/* Capability filter pills — tap to narrow by input shape. */}
        {availableFilters.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            {availableFilters.map((f) => {
              const active = capFilters.has(f.mode)
              return (
                <button
                  key={f.mode}
                  type="button"
                  onClick={() => toggleFilter(f.mode)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? accent.pillActive
                      : 'border-ink/10 bg-ink/[0.03] text-ink-400 hover:bg-ink/[0.06] hover:text-ink-200'
                  }`}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Provider rail + grouped list — shared with the chat picker. */}
        <div className="flex min-h-0 flex-1">
          <ProviderRail
            providers={providers}
            value={providerFilter}
            onChange={setProviderFilter}
            starred={starredOnly}
            onStarredChange={setStarredOnly}
            activeClass={accent.pillActive}
          />
          <div className="min-w-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
            {groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
                <span className="text-sm text-ink-600">No matches found</span>
                <span className="text-xs text-ink-700">Try a different search</span>
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.provider} className="mb-1">
                  <ProviderHeading provider={g.provider} />
                  {g.models.map((m) => (
                    <ModelRow
                      key={m.id}
                      model={m}
                      active={m.id === resolved}
                      muted={isMuted(m)}
                      credits={formatCredits(estimateCredits(m.id, costParams))}
                      accent={accent}
                      onClick={() => pick(m.id)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer — requireMode caveat, mirrors ModelPicker's dropdown footer.
            Inset hairline, not full-bleed. */}
        {showRequireNote && (
          <p className="mx-4 border-t border-ink/10 px-1 py-3 text-[11px] leading-relaxed text-ink-500">
            {requireModeNote}
          </p>
        )}
      </div>
    </>
  )

  return createPortal(panel, portalTarget)
}

interface ModelRowProps {
  model: ModelEntry
  active: boolean
  muted: boolean
  credits: string | null
  accent: (typeof ACCENTS)[string]
  onClick: () => void
}

function ModelRow({ model, active, muted, credits, accent, onClick }: ModelRowProps) {
  const isRecommended = model.tags.includes('recommended')
  // Only 'cheap' survives as a word beside the name. 'New' and 'Fast' were
  // removed (July 2026): New ages badly and nobody edits it back off, and Fast
  // was a third colour competing with the star and the "% off" chip on the same
  // line. Cheap earns its place because it is the one tag about spend, which is
  // the axis the whole row is scanned on. `TAG_STYLES` keeps every label for
  // other surfaces — this is a display choice, not a registry change.
  const textTags = model.tags.filter((t) => t === 'cheap')
  // Discount vs the provider's official API — only for models with a verified
  // official rate in the registry (see ModelEntry.official).
  const savings = officialSavingsPercent(model.id)
  const c = model.videoConstraints
  // Metadata: resolution range (ascending, e.g. "480p–1080p"), duration range,
  // credit estimate. Each is its own subtle pill rather than a dot-joined
  // string — three numbers in one line of prose read as a sentence, and the
  // list is scanned down a column ("which one is 1080p?"), not read across.
  // Per-call models with no duration toggle (durations === []) read "per clip".
  const resolution = c?.resolutions.length
    ? c.resolutions.length > 1
      ? `${videoResolutionLabel(c.resolutions[0])}–${videoResolutionLabel(c.resolutions[c.resolutions.length - 1])}`
      : videoResolutionLabel(c.resolutions[0])
    : null
  const duration = c
    ? c.durations.length > 1
      ? `${c.durations[0]}–${c.durations[c.durations.length - 1]}s`
      : c.durations.length === 1
      ? `${c.durations[0]}s`
      : 'per clip'
    : null
  const metaPills = [resolution, duration, credits].filter(Boolean) as string[]

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={muted}
      aria-disabled={muted}
      className={`flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors ${
        muted
          ? 'cursor-not-allowed opacity-30 grayscale'
          : active
          ? accent.selectedBg
          : 'hover:bg-ink/[0.04]'
      }`}
    >
      <ProviderLogo provider={model.provider} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-[13px] font-semibold leading-snug text-ink-100 ${muted ? 'line-through decoration-ink-400' : ''}`}>{model.displayName}</span>
          {isRecommended && <StarBadge />}
          {textTags.map((t) => (
            <span key={t} className={`shrink-0 text-[11px] font-medium ${TAG_TEXT[t]}`}>
              {TAG_STYLES[t].label}
            </span>
          ))}
          {savings != null && <SavingsPill pct={savings} />}
        </div>
        {metaPills.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {metaPills.map((m) => (
              <span
                key={m}
                className="rounded-full bg-ink/[0.06] px-2 py-[3px] text-[10px] font-medium leading-none text-ink-400"
              >
                {m}
              </span>
            ))}
          </div>
        )}
      </div>
      {active && <Check className={`h-4 w-4 shrink-0 ${accent.icon}`} />}
    </button>
  )
}
