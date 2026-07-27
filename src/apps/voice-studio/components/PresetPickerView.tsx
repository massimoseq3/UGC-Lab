import { useMemo, useState } from 'react'
import { ArrowLeft, Search, Play, Pause, Check } from 'lucide-react'
import type { VoicePreset } from '../../../stores/types'
import { useBankStore } from '../../../stores/bankStore'
import { seedColor } from './seedColor'
import { useVoicePreview } from './useVoicePreview'

interface PresetPickerViewProps {
  selectedId?: string
  onSelect: (preset: VoicePreset) => void
  onClose: () => void
}

// Saved voices from the bank, picked the same way voices are: an in-panel view
// that takes over the side panel, not a slide-over. Same header / search /
// row shape as VoicePickerView so the two steps read as one flow.
export default function PresetPickerView({ selectedId, onSelect, onClose }: PresetPickerViewProps) {
  const presets = useBankStore((s) => s.voices)
  const [query, setQuery] = useState('')
  const { previewingId, loadingId, toggle } = useVoicePreview()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...presets].sort((a, b) => b.createdAt - a.createdAt)
    if (!q) return sorted
    return sorted.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.voiceName.toLowerCase().includes(q) ||
        p.style.toLowerCase().includes(q) ||
        p.accent.toLowerCase().includes(q),
    )
  }, [presets, query])

  const renderRow = (preset: VoicePreset) => {
    const isSelected = preset.id === selectedId
    const isPlaying = previewingId === preset.id
    const isLoading = loadingId === preset.id
    // Voice first, then the delivery params that make this preset its own thing.
    const meta = [preset.voiceName, preset.style, preset.pace, preset.accent].filter(Boolean).join(' · ')

    return (
      <div
        key={preset.id}
        onClick={() => onSelect(preset)}
        className={`group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 transition-colors ${
          isSelected ? 'bg-voice-500/15' : 'hover:bg-ink/[0.04]'
        }`}
      >
        {/* Avatar doubles as the voice preview, same as the voice list */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggle(preset.id, preset.voiceId) }}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          aria-label={isPlaying ? 'Stop preview' : 'Preview voice'}
        >
          <span className="absolute inset-0 rounded-full" style={{ background: seedColor(preset.voiceId) }} />
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

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`truncate text-sm font-medium ${isSelected ? 'text-ink-50' : 'text-ink-100'}`}>
              {preset.label}
            </span>
            {preset.gender && (
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-500">{preset.gender}</span>
            )}
          </div>
          <div className="truncate text-xs text-ink-400">{meta}</div>
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
          <div className="text-base font-semibold tracking-tight text-ink-100">Select a preset</div>
          <div className="text-xs text-ink-400">Loads the voice, delivery, scene and tone</div>
        </div>
      </div>

      {/* Search — hidden when the bank is empty, there'd be nothing to search */}
      {presets.length > 0 && (
        <div className="border-b border-ink/5 px-5 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search presets..."
              className="w-full rounded-full border border-ink/10 bg-transparent py-2 pl-10 pr-3 text-sm text-ink-100 placeholder-ink-500 outline-none transition-colors focus:border-voice-500/40"
            />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {presets.length === 0 ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <span className="text-sm text-ink-500">
              No saved voices yet. Save a voice to the Bank and it shows up here.
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <span className="text-sm text-ink-500">No presets match that search.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-2">{filtered.map(renderRow)}</div>
        )}
      </div>
    </div>
  )
}
