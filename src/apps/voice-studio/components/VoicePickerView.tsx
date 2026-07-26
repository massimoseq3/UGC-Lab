import { useState, useMemo } from 'react'
import { ArrowLeft, Search, Play, Pause, Check } from 'lucide-react'
import type { VoiceOption, VoicePitch } from '../types'
import { VOICES, PITCH_ORDER, PITCH_LABELS } from '../types'

import { seedColor } from './seedColor'
import { useVoicePreview } from './useVoicePreview'

interface VoicePickerViewProps {
  selectedId: string
  onSelect: (voice: VoiceOption) => void
  onClose: () => void
}

// Filter chips: All + each pitch band, highest → lowest (PITCH_ORDER).
type PitchFilter = 'All' | VoicePitch
const PITCH_FILTERS: PitchFilter[] = ['All', ...PITCH_ORDER]

export default function VoicePickerView({ selectedId, onSelect, onClose }: VoicePickerViewProps) {
  const [query, setQuery] = useState('')
  const [pitchFilter, setPitchFilter] = useState<PitchFilter>('All')
  const { previewingId, loadingId, toggle } = useVoicePreview()

  // Filter by query + pitch, then group by pitch band (highest → lowest) with a
  // header per group, so members can scan voices by register.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = VOICES.filter((v) => {
      if (pitchFilter !== 'All' && v.pitch !== pitchFilter) return false
      if (!q) return true
      return (
        v.name.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q)
      )
    })
    return PITCH_ORDER
      .map((p) => [p, filtered.filter((v) => v.pitch === p)] as const)
      .filter(([, list]) => list.length > 0)
  }, [query, pitchFilter])

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
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-ink/5 px-5 py-4">
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-300 transition-colors hover:bg-ink/5 hover:text-ink-100"
          aria-label="Back to settings"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold tracking-tight text-ink-100">Select a voice</div>
          <div className="text-xs text-ink-400">Click a voice to hear a sample</div>
        </div>
      </div>

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

        {/* Pitch filter chips — All, then highest → lowest */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {PITCH_FILTERS.map((p) => {
            const active = pitchFilter === p
            return (
              <button
                key={p}
                onClick={() => setPitchFilter(p)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-voice-500/25 text-voice-200'
                    : 'bg-ink/[0.05] text-ink-300 hover:bg-ink/[0.08] hover:text-ink-100'
                }`}
              >
                {p === 'All' ? 'All' : PITCH_LABELS[p]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Voice list — grouped by pitch band with a header per group */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {totalCount === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <span className="text-sm text-ink-500">No voices match these filters.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-2">
            {groups.map(([p, list]) => (
              <div key={p} className="flex flex-col gap-0.5">
                <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  {PITCH_LABELS[p]} <span className="text-ink-600">· {list.length}</span>
                </div>
                {list.map(renderRow)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
