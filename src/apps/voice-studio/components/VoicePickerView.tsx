import { useState, useMemo } from 'react'
import { Search, Play, Pause, Check } from 'lucide-react'
import type { Gender, VoiceOption } from '../types'
import { VOICES } from '../types'

import { seedColor } from './seedColor'
import { useVoicePreview } from './useVoicePreview'

interface VoicePickerViewProps {
  selectedId: string
  onSelect: (voice: VoiceOption) => void
}

// Filter chips, and the headings the list is grouped under: All, then the two
// genders. It was Google's four published PITCH bands (higher / middle /
// lower-middle / lower) until September 2026 (Massimo's call). Pitch is real
// data and it stays on the row's type, but it isn't the question anyone opens
// this list with — a UGC ad is cast as a woman or a man reading to camera, and
// four bands split each of those across four headings, so finding "a warm
// female read" meant scanning all four. The avatar metals follow the same
// split (see `seedColor`), so the disc and the heading agree.
type GenderFilter = 'All' | Gender
const GENDER_FILTERS: GenderFilter[] = ['All', 'Female', 'Male']
const GENDER_ORDER: Gender[] = ['Female', 'Male']

// The BODY of the voice picker — search, pitch chips and the grouped list.
// `PickerModal` supplies the shell and the title; `PresetPickerView` fills the
// same shell with the same row shape.
export default function VoicePickerView({ selectedId, onSelect }: VoicePickerViewProps) {
  const [query, setQuery] = useState('')
  const [genderFilter, setGenderFilter] = useState<GenderFilter>('All')
  const { previewingId, loadingId, toggle } = useVoicePreview()

  // Filter by query + gender, then group by gender with a header per group, so
  // the list reads as the two casts it is.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = VOICES.filter((v) => {
      if (genderFilter !== 'All' && v.gender !== genderFilter) return false
      if (!q) return true
      return (
        v.name.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q)
      )
    })
    return GENDER_ORDER
      .map((g) => [g, filtered.filter((v) => v.gender === g)] as const)
      .filter(([, list]) => list.length > 0)
  }, [query, genderFilter])

  const totalCount = groups.reduce((n, [, list]) => n + list.length, 0)

  const handlePreview = (voice: VoiceOption, e: React.MouseEvent) => {
    e.stopPropagation()
    toggle(voice.id, voice.id)
  }

  const renderRow = (voice: VoiceOption) => {
    const isSelected = voice.id === selectedId
    const isPlaying = previewingId === voice.id
    const isLoading = loadingId === voice.id

    return (
      <div
        key={voice.id}
        onClick={() => onSelect(voice)}
        className={`group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 transition-colors ${
          isSelected ? 'bg-voice-500/15' : 'hover:bg-ink/[0.04]'
        }`}
      >
        {/* Avatar with loading ring */}
        <button
          type="button"
          onClick={(e) => handlePreview(voice, e)}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          aria-label={isPlaying ? 'Stop preview' : 'Preview voice'}
        >
          <span className="absolute inset-0 rounded-full" style={{ background: seedColor(voice.id) }} />
          {isLoading && (
            <span className="absolute -inset-[3px] rounded-full border-2 border-ink/10 border-t-ink animate-spin" />
          )}
          {isPlaying && <span className="absolute -inset-[3px] rounded-full border-2 border-voice-400" />}
          <span
            className={`relative flex h-full w-full items-center justify-center rounded-full bg-black/40 text-white transition-opacity ${
              isPlaying || isLoading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 translate-x-px fill-current" />}
          </span>
        </button>

        {/* Text */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`truncate text-sm font-medium ${isSelected ? 'text-ink-50' : 'text-ink-100'}`}>
              {voice.name}
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-500">
              {voice.category}
            </span>
          </div>
          <div className="truncate text-xs text-ink-400">{voice.description}</div>
        </div>

        {isSelected && <Check className="h-4 w-4 shrink-0 text-voice-300" />}
      </div>
    )
  }

  return (
    <>
      {/* Search */}
      <div className="border-b border-ink/5 px-5 py-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search voices..."
            className="w-full rounded-full border border-ink/10 bg-transparent py-2 pl-10 pr-3 text-sm text-ink-100 placeholder-ink-500 outline-none transition-colors focus:border-voice-500/40"
          />
        </div>

        {/* Gender filter chips — All, then the two casts */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {GENDER_FILTERS.map((p) => {
            const active = genderFilter === p
            return (
              <button
                key={p}
                onClick={() => setGenderFilter(p)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-voice-500/25 text-voice-200'
                    : 'bg-ink/[0.05] text-ink-300 hover:bg-ink/[0.08] hover:text-ink-100'
                }`}
              >
                {p}
              </button>
            )
          })}
        </div>
      </div>

      {/* Voice list — grouped by gender with a header per group. It sizes
          the modal up to the panel's max-height and scrolls past it; the empty
          state pads rather than filling, since `h-full` inside a content-sized
          panel collapses. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {totalCount === 0 ? (
          <div className="px-6 py-16 text-center">
            <span className="text-sm text-ink-500">No voices match these filters.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-2">
            {groups.map(([p, list]) => (
              <div key={p} className="flex flex-col gap-0.5">
                <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  {p} <span className="text-ink-600">· {list.length}</span>
                </div>
                {list.map(renderRow)}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
