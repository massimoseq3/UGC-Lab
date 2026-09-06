import type { ModelEntry } from './models'

// Grouping shared by every "pick a model" panel — the chat picker
// (ScriptModelRow) and the image/video picker (ModelPickerModal).
//
// Providers are ordered ALPHABETICALLY, in the rail and in the list. There is
// no house ranking to express here, and any other order would look like one.
//
// Pure functions live in this .ts file rather than beside the rail components
// in modelPalette.tsx so that file exports components only (react-refresh).

// The one exception to alphabetical: a provider listed here sinks to the
// bottom. Alibaba Tongyi is two speed tiers of one model (Wan 3.0 and 3.0
// Prime — it was a single Wan 2.7 row when this was written) and the letter A
// was putting it above every provider anyone actually reaches for. This is a
// tail, not a ranking — keep it to providers that are genuinely a footnote,
// and drop the entry if Alibaba ever becomes one of them.
const TAIL_PROVIDERS = ['Alibaba Tongyi']

export function sortProviders(providers: string[]): string[] {
  return [...providers].sort((a, b) => {
    const tail = Number(TAIL_PROVIDERS.includes(a)) - Number(TAIL_PROVIDERS.includes(b))
    return tail || a.localeCompare(b)
  })
}

// Distinct providers across the given models, alphabetical.
export function providersOf(models: ModelEntry[]): string[] {
  return sortProviders(Array.from(new Set(models.map((m) => m.provider))))
}

export interface ProviderGroup {
  provider: string
  models: ModelEntry[]
}

// Group into alphabetical provider sections, dropping empties. `sort` orders
// within a group — callers pass whatever ladder makes sense for their task
// (cheapest-first for chat, recommended-then-A–Z for video).
export function groupByProvider(
  models: ModelEntry[],
  sort?: (a: ModelEntry, b: ModelEntry) => number,
): ProviderGroup[] {
  return providersOf(models)
    .map((provider) => {
      const group = models.filter((m) => m.provider === provider)
      return { provider, models: sort ? [...group].sort(sort) : group }
    })
    .filter((g) => g.models.length > 0)
}
