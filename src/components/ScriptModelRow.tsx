import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Check, Search, Sparkles } from 'lucide-react'
import {
  listScriptModels,
  getModel,
  chatCostTier,
  estimateCredits,
  officialSavingsPercent,
  type ModelEntry,
} from '../utils/models'
import {
  useSettingsStore,
  resolveScriptModel,
  scriptModelSlot,
  type ScriptModelApp,
} from '../stores/settingsStore'
import SlideOver from './SlideOver'
import ProviderLogo from './ProviderLogo'
import SavingsPill from './SavingsPill'
import { ProviderRail, ProviderHeading } from './modelPalette'
import { providersOf, groupByProvider } from '../utils/providerGroups'

// Who writes the words. Mounted in the input column of the two apps that
// produce prose a person reads — Scripts (the takes) and B-Roll (the shot
// prompts). Every other chat surface in the app stays pinned to the registry
// default: those calls feed another model, not a reader.
//
// The row itself is never empty — there is always a resolved model, because an
// untouched picker resolves to the app-wide default. So unlike Script Style or
// Visual Style there's no dashed "pick one" state and no X to clear: the
// question is which writer, not whether.
//
// The panel is a provider rail + a searchable, provider-grouped list, with two
// signals per row: INTELLIGENCE as five stars (editorial — see ChatRating) and
// COST as five "$" glyphs derived from the model's real kie.ai rate. The rail
// is the grouping made clickable; the groups are still all there when it's on
// "All", so the rail filters a long list rather than being the only way in.

const ACCENTS: Record<ScriptModelApp, { text: string; bg: string; star: string; railOn: string }> = {
  'script-architect': {
    text: 'text-scripts-text',
    bg: 'bg-scripts-500/10',
    star: 'text-scripts-text',
    railOn: 'bg-scripts-500/15 text-scripts-text',
  },
  'broll-studio': {
    text: 'text-broll-300',
    bg: 'bg-broll-500/10',
    star: 'text-broll-300',
    railOn: 'bg-broll-500/15 text-broll-300',
  },
}

// The trigger row is NEUTRAL chrome in both apps. It used to wear the host
// app's accent — a navy fill in Scripts, purple in B-Roll — which read as a
// selected state next to the plain rows it's stacked with, when in fact this
// row is never unselected: there is always a resolved model. The accent still
// belongs inside the panel it opens (the rail, the tick, the stars), where it
// marks the one row out of many that IS picked.
const TRIGGER_CHROME = 'border-ink/10 bg-ink/[0.02] hover:border-ink/20 hover:bg-ink/[0.04]'

// What the picked model is actually for, per app. Scripts writes takes;
// B-Roll writes the shot prompts behind every card.
const COPY: Record<ScriptModelApp, { label: string; hint: string; title: string }> = {
  'script-architect': {
    label: 'Script Model',
    hint: 'The Scriptwriter',
    title: 'Script Model',
  },
  'broll-studio': {
    label: 'Prompt Model',
    hint: 'The Prompt Writer',
    title: 'Prompt Model',
  },
}

interface ScriptModelRowProps {
  appId: ScriptModelApp
  // Vertical margin only, same contract as DayPill: Scripts stacks its pickers
  // with margins (mb-3, the default here), B-Roll's settings band spaces its
  // rows with a flex gap and wants none (pass "").
  className?: string
}

export default function ScriptModelRow({ appId, className = 'mb-3' }: ScriptModelRowProps) {
  const [open, setOpen] = useState(false)
  // Subscribe to this app's own slot — that's what re-renders the row the
  // moment a pick lands in the panel. resolveScriptModel still owns the
  // fallback, so the two can't disagree about what an empty slot means.
  const picked = useSettingsStore((s) => s.perAppModel[scriptModelSlot(appId)])
  const resolvedId = picked && getModel(picked) ? picked : resolveScriptModel(appId)
  const model = getModel(resolvedId)
  const accent = ACCENTS[appId]
  const copy = COPY[appId]

  return (
    <>
      <div className={className}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setOpen(true)
            }
          }}
          // Geometry copied exactly from the picker rows this sits in a column
          // with — Scripts' Style/Product rows, B-Roll's References cards:
          // h-[58px], px-4, gap-3, 36px icon disc. Anything else and the icons
          // don't line up down the column, which is the thing the eye reads.
          className={`group flex h-[58px] w-full cursor-pointer items-center gap-3 rounded-full border px-4 text-left transition-colors ${TRIGGER_CHROME}`}
        >
          {/* The same 36px accent disc every sibling picker row wears — Product,
              Character, Script Style, Visual Style. `compact` used to drop it
              for the bare 24px provider mark, which left this row's icon
              visibly smaller than the rows above it. */}
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${accent.bg}`}>
            {model ? <ProviderLogo provider={model.provider} size="sm" /> : <Sparkles className={`h-[18px] w-[18px] ${accent.text}`} strokeWidth={1.75} />}
          </div>
          <div className="min-w-0 flex-1">
            {/* Neutral text too — on a neutral row an accent-coloured name is
                the same false "selected" cue the accent fill was. */}
            <div className="truncate text-[13px] font-medium tracking-tight text-ink-200">
              {model?.displayName ?? copy.label}
            </div>
            {/* The hint runs in both variants: a model name alone says which
                model, never what it's for, and at 58px the second line is room
                the row already has. Both meters ride at the END of that line,
                in the panel's own order — cost, then intelligence. They belong
                on the row at all because it's the only place the picked model
                is visible without opening anything, and showing half the rating
                there left the question the panel exists to answer ("is this the
                good one or the cheap one?") behind a click. They do NOT belong
                on the FIRST line beside the name: this row is half-width in
                Scripts, and ~85px of meters against a `min-w-0` name column
                truncated the model's name away to nothing — a picker row whose
                one job is naming what's picked. The hint gives way instead. */}
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[11px] leading-snug text-ink-500">{copy.hint}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {model?.chatRating && <StarMeter value={model.chatRating.intelligence} tone={accent.star} />}
                <CostGlyphs tier={chatCostTier(resolvedId)} />
              </span>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" strokeWidth={2} />
        </div>
      </div>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title={copy.title}
        subtitle="Stars are how strong a writer, dollars are what it costs"
        size="medium"
      >
        <ModelPalette appId={appId} resolvedId={resolvedId} accent={accent} onClose={() => setOpen(false)} />
      </SlideOver>
    </>
  )
}

function ModelPalette({
  appId,
  resolvedId,
  accent,
  onClose,
}: {
  appId: ScriptModelApp
  resolvedId: string
  accent: (typeof ACCENTS)[ScriptModelApp]
  onClose: () => void
}) {
  const setAppModel = useSettingsStore((s) => s.setAppModel)
  const [search, setSearch] = useState('')
  // null = every provider. The rail is a filter, not a required first step.
  const [provider, setProvider] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  const all = listScriptModels()
  const providers = providersOf(all)

  const q = search.trim().toLowerCase()
  const filtered = all
    .filter((m) => !provider || m.provider === provider)
    .filter((m) => !q || m.displayName.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q))

  // Cheapest first inside each provider — within one maker the models are a
  // ladder, and reading it from the bottom is how you decide how far up to go.
  const groups = groupByProvider(filtered, (a, b) => (chatCostTier(a.id) ?? 9) - (chatCostTier(b.id) ?? 9))

  function pick(id: string) {
    setAppModel(scriptModelSlot(appId), id)
    onClose()
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="px-4 pb-2 pt-3">
        <div className="flex h-10 items-center gap-2.5 rounded-full bg-ink/[0.05] px-4 transition-colors focus-within:bg-ink/[0.08]">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-600" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models…"
            className="w-full bg-transparent text-sm text-ink-200 placeholder-ink-600 outline-none"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <ProviderRail providers={providers} value={provider} onChange={setProvider} activeClass={accent.railOn} />

        {/* Grouped list */}
        <div className="min-w-0 flex-1 overflow-y-auto px-2 py-2">
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
                  <ModelCard
                    key={m.id}
                    model={m}
                    active={m.id === resolvedId}
                    accent={accent}
                    onPick={() => pick(m.id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function ModelCard({
  model,
  active,
  accent,
  onPick,
}: {
  model: ModelEntry
  active: boolean
  accent: (typeof ACCENTS)[ScriptModelApp]
  onPick: () => void
}) {
  const rating = model.chatRating
  if (!rating) return null
  const savings = officialSavingsPercent(model.id)

  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex w-full items-start gap-2.5 rounded-2xl px-2.5 py-2 text-left transition-colors ${
        active ? accent.bg : 'hover:bg-ink/[0.04]'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold leading-snug text-ink-100">{model.displayName}</span>
          <StarMeter value={rating.intelligence} tone={accent.star} />
          <CostGlyphs tier={chatCostTier(model.id)} />
          {active && <Check className={`h-3.5 w-3.5 shrink-0 ${accent.text}`} strokeWidth={2.5} />}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-500">{rating.blurb}</p>
        <div className="mt-1 flex items-center gap-2">
          {/* A rate, not a per-run price: a chat call's size isn't known until
              it answers, and the Generate buttons carry the run estimate.
              Quoted per MILLION tokens because that's the unit kie publishes
              and the only one where these come out as numbers you can compare
              — formatCredits collapses every per-1k rate to "< 1 credit". */}
          <span className="text-[10px] text-ink-600">{ratePerMillion(model.id)}</span>
          {savings != null && <SavingsPill pct={savings} />}
        </div>
      </div>
    </button>
  )
}

function ratePerMillion(modelId: string): string {
  const credits = estimateCredits(modelId, { tokenCount: 1_000_000 })
  if (credits === null) return 'Rate unpublished'
  return `${Math.round(credits)} credits / 1M tokens`
}

// Cost as five "$" — filled to the model's tier, the rest dim. Green through
// red so the expensive end is visible before you read the number, matching how
// every other price cue in this app leads with colour. Tier 3 is a light green
// rather than amber: the middle of this ladder is still a cheap model on
// anyone's bill, and an amber warning tint on the default writer read as a
// caution about picking it. The warning colours start where the price does.
// That light green is `green-300`, not `lime-400` — lime is a yellow-green and
// on a dark panel it reads acidic, which is the opposite of the "this is the
// good pick" note it has to strike on the default writer's own row.
const TIER_TONE: Record<number, string> = {
  1: 'text-emerald-400 light:text-emerald-600',
  2: 'text-emerald-400 light:text-emerald-600',
  3: 'text-green-300 light:text-green-600',
  4: 'text-orange-400 light:text-orange-600',
  5: 'text-red-400 light:text-red-600',
}

function CostGlyphs({ tier }: { tier: number | null }) {
  if (tier === null) return null
  return (
    <span
      className={`shrink-0 font-mono text-[11px] font-bold leading-none tracking-tight ${TIER_TONE[tier]}`}
      title={`Cost: ${tier} of 5`}
      aria-label={`Cost: ${tier} of 5`}
    >
      {'$'.repeat(tier)}
      <span className="text-ink-700">{'$'.repeat(5 - tier)}</span>
    </span>
  )
}

// Intelligence as five stars, filled to `value`.
function StarMeter({ value, tone }: { value: number; tone: string }) {
  return (
    <span className="flex shrink-0 gap-[1px]" title={`Intelligence: ${value} of 5`} aria-label={`Intelligence: ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <StarGlyph key={i} filled={i <= value} tone={tone} />
      ))}
    </span>
  )
}

// A filled/hollow star at 9px. lucide's Star at this size loses its points to
// antialiasing, so this is a plain path we control the fill on.
function StarGlyph({ filled, tone }: { filled: boolean; tone: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-[9px] w-[9px] ${filled ? tone : 'text-ink-700'}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9z" />
    </svg>
  )
}
