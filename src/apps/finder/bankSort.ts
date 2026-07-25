import type { BankType } from '../../utils/constants'
import { usePersistedState } from '../../hooks/usePersistedState'

// Sort primitives + persisted per-bank sort state. Kept out of BankList.tsx
// so that component file only exports components — keeps React Fast Refresh
// working when editing the bank UI.

export type SortOrder = 'newest' | 'oldest' | 'name-asc' | 'name-desc'

export const SORT_OPTIONS_WITH_NAME: { value: SortOrder; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name-asc', label: 'Name A → Z' },
  { value: 'name-desc', label: 'Name Z → A' },
]

export const SORT_OPTIONS_DATE_ONLY: { value: SortOrder; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

export function sortByOrder<T extends { createdAt: number }>(items: T[], order: SortOrder, nameOf?: (item: T) => string): T[] {
  const arr = [...items]
  switch (order) {
    case 'newest':
      arr.sort((a, b) => b.createdAt - a.createdAt)
      break
    case 'oldest':
      arr.sort((a, b) => a.createdAt - b.createdAt)
      break
    case 'name-asc':
      arr.sort((a, b) => (nameOf?.(a) ?? '').localeCompare(nameOf?.(b) ?? '', undefined, { sensitivity: 'base' }))
      break
    case 'name-desc':
      arr.sort((a, b) => (nameOf?.(b) ?? '').localeCompare(nameOf?.(a) ?? '', undefined, { sensitivity: 'base' }))
      break
  }
  return arr
}

// Stable partition: starred items first, original order preserved within each
// half. Applied on top of the user's chosen sort in the bank pickers so pinned
// items always surface at the top of the slide-over. Unconstrained generic (not
// `T extends { starred?: boolean }`) so bank-item unions containing types
// without the field (VoicePreset) still pass through untouched.
export function starredFirst<T>(items: T[]): T[] {
  const isStarred = (it: T) => !!(it as { starred?: boolean }).starred
  if (!items.some(isStarred)) return items
  return [...items.filter(isStarred), ...items.filter((it) => !isStarred(it))]
}

export function useBankSort(bankType: BankType): [SortOrder, (v: SortOrder) => void, { value: SortOrder; label: string }[] | null] {
  const [productsSort, setProductsSort] = usePersistedState<SortOrder>('finder:sort:products', 'newest')
  const [modelsSort, setModelsSort] = usePersistedState<SortOrder>('finder:sort:models', 'newest')
  const [scriptsSort, setScriptsSort] = usePersistedState<SortOrder>('finder:sort:scripts', 'newest')
  const [brollsSort, setBrollsSort] = usePersistedState<SortOrder>('finder:sort:brolls', 'newest')
  const [stylesSort, setStylesSort] = usePersistedState<SortOrder>('finder:sort:styles', 'newest')
  switch (bankType) {
    case 'styles': return [stylesSort, setStylesSort, SORT_OPTIONS_WITH_NAME]
    case 'products': return [productsSort, setProductsSort, SORT_OPTIONS_WITH_NAME]
    case 'models': return [modelsSort, setModelsSort, SORT_OPTIONS_WITH_NAME]
    case 'scripts': return [scriptsSort, setScriptsSort, SORT_OPTIONS_WITH_NAME]
    case 'brolls': return [brollsSort, setBrollsSort, SORT_OPTIONS_DATE_ONLY]
    default: return ['newest', () => {}, null]
  }
}
