import { useMemo, useState, useRef } from 'react'
import { Search, Volume2, Bookmark, Check, Trash2, Play, Pause, AlignLeft, Download } from 'lucide-react'
import { useBankStore } from '../../../stores/bankStore'
import type { VoiceHistoryItem } from '../../../stores/types'
import { getUrl } from '../../../utils/assetStore'
import { formatRelative, sectionLabel, groupByDay } from '../../../utils/history'
import { seedColor } from './seedColor'
import { GeneratingChip, GeneratingPulseRing } from '../../../components/GeneratingChip'

// A voiceover that's been fired but hasn't landed yet. Rendered as a row at the
// top of History so a queued batch reads as a queue — several can run at once.
export interface PendingVoice {
  id: string
  voiceId: string
  voiceName: string
  scriptPreview: string
}

interface HistoryViewProps {
  items: VoiceHistoryItem[]
  pending: PendingVoice[]
  activeId: string | null
  onSelect: (item: VoiceHistoryItem) => void
  onDelete: (id: string) => void
  onShowDetails: (item: VoiceHistoryItem) => void
}

async function resolveAudioUrl(ref: string): Promise<string> {
  if (ref.startsWith('asset-')) {
    const url = await getUrl(ref)
    if (!url) throw new Error('Audio asset not found')
    return url
  }
  return ref
}

export default function HistoryView({ items, pending, activeId, onSelect, onDelete, onShowDetails }: HistoryViewProps) {
  const [query, setQuery] = useState('')
  const [saveFormId, setSaveFormId] = useState<string | null>(null)
  const [saveLabel, setSaveLabel] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const addVoice = useBankStore((s) => s.addVoice)

  const togglePreview = async (item: VoiceHistoryItem) => {
    if (audioRef.current && previewingId === item.id) {
      audioRef.current.pause()
      audioRef.current = null
      setPreviewingId(null)
      return
    }
    audioRef.current?.pause()
    try {
      const url = await resolveAudioUrl(item.audioUrl)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.addEventListener('ended', () => {
        if (audioRef.current === audio) {
          audioRef.current = null
          setPreviewingId(null)
        }
      })
      await audio.play()
      setPreviewingId(item.id)
    } catch {
      /* swallow */
    }
  }

  const handleDownload = async (item: VoiceHistoryItem) => {
    try {
      const url = await resolveAudioUrl(item.audioUrl)
      const a = document.createElement('a')
      a.href = url
      a.download = `${item.voiceName}-${Date.now()}.mp3`
      a.click()
    } catch {
      /* swallow */
    }
  }

  // Sort newest first, filter by query, then group by calendar day.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = items
      .filter((it) => {
        if (!q) return true
        return (
          it.scriptText.toLowerCase().includes(q) ||
          it.voiceName.toLowerCase().includes(q)
        )
      })
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)

    return groupByDay(filtered, (it) => it.createdAt)
  }, [items, query])

  const handleSavePreset = (item: VoiceHistoryItem) => {
    if (!saveLabel.trim()) return
    addVoice({
      label: saveLabel.trim(),
      voiceId: item.voiceId,
      voiceName: item.voiceName,
      gender: item.gender,
      style: item.style,
      pace: item.pace,
      accent: item.accent,
      temperature: item.temperature,
      scene: item.scene,
      sampleContext: item.sampleContext,
      linkedModelId: '',
    })
    setSaveFormId(null)
    setSaveLabel('')
    setSavedId(item.id)
    setTimeout(() => setSavedId(null), 3000)
  }

  if (items.length === 0 && pending.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <Volume2 className="h-10 w-10 text-ink-800" strokeWidth={1.5} />
        <p className="text-sm text-ink-300">No voiceovers yet</p>
        <p className="text-center text-xs text-ink-500">Your generated voiceovers will land here.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Search */}
      <div className="border-b border-ink/5 px-5 py-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search history..."
            className="w-full rounded-full border border-ink/10 bg-transparent py-2 pl-10 pr-3 text-sm text-ink-100 placeholder-ink-500 outline-none transition-colors focus:border-voice-500/40"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {/* Queue — in-flight voiceovers, above the finished ones. Not filtered by
            the search box: a pending row has no content to match on yet, and
            hiding the thing you just fired is the opposite of a queue. */}
        {pending.length > 0 && (
          <div className="flex flex-col gap-0.5 px-2 pt-2">
            <div className="my-2 flex items-center justify-center">
              <span className="rounded-full bg-ink/[0.06] px-3 py-1 text-[11px] font-medium text-ink-300">
                {pending.length === 1 ? 'In progress' : `In progress · ${pending.length}`}
              </span>
            </div>
            {pending.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-full px-4 py-3">
                <span className="relative h-9 w-9 shrink-0">
                  <span
                    className="block h-full w-full rounded-full opacity-60"
                    style={{ background: seedColor(p.voiceId) }}
                  />
                  <GeneratingPulseRing family="voice" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm leading-snug text-ink-300">{p.scriptPreview}</p>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-500">
                    <span className="text-ink-300">{p.voiceName}</span>
                    <span>·</span>
                    <GeneratingChip family="voice" label="Generating…" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {groups.length === 0 ? (
          pending.length === 0 && (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <span className="text-sm text-ink-500">No matches.</span>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {groups.map(([dayTs, dayItems]) => (
              <div key={dayTs} className="flex flex-col gap-0.5">
                {/* Day section header — pill, centered */}
                <div className="my-2 flex items-center justify-center">
                  <span className="rounded-full bg-ink/[0.06] px-3 py-1 text-[11px] font-medium text-ink-300">
                    {sectionLabel(dayTs)}
                  </span>
                </div>

                {dayItems.map((item) => {
                  const isActive = activeId === item.id
                  const isSaved = savedId === item.id
                  const inSaveForm = saveFormId === item.id
                  const isPreviewing = previewingId === item.id

                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelect(item)}
                      className={`group cursor-pointer px-4 py-3 transition-colors ${
                        isActive
                          ? 'rounded-3xl bg-voice-500/15 ring-1 ring-voice-500/20'
                          : 'rounded-full hover:bg-ink/[0.04]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="h-9 w-9 shrink-0 rounded-full"
                          style={{ background: seedColor(item.voiceId) }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm leading-snug text-ink-100">
                            {item.scriptPreview}
                          </p>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-500">
                            <span className="text-ink-300">{item.voiceName}</span>
                            <span>·</span>
                            <span>{formatRelative(item.createdAt)}</span>
                          </div>
                        </div>

                        {/* Hover-only action cluster: Play / Show details / Download */}
                        <div
                          className={`flex items-center gap-0.5 transition-opacity ${
                            isActive || isPreviewing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); togglePreview(item) }}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-300 transition-colors hover:bg-ink/5 hover:text-ink-100"
                            title={isPreviewing ? 'Pause' : 'Play'}
                          >
                            {isPreviewing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onShowDetails(item) }}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-300 transition-colors hover:bg-ink/5 hover:text-ink-100"
                            title="Show details"
                          >
                            <AlignLeft className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownload(item) }}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-300 transition-colors hover:bg-ink/5 hover:text-ink-100"
                            title="Download"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Save preset / Delete row — only when active */}
                      {isActive && (
                        <div onClick={(e) => e.stopPropagation()} className="mt-3 flex items-center gap-1.5 border-t border-ink/5 pt-2.5">
                          {inSaveForm ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                value={saveLabel}
                                onChange={(e) => setSaveLabel(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(item) }}
                                placeholder="Preset name..."
                                autoFocus
                                className="w-32 rounded-full border border-ink/10 bg-transparent px-2.5 py-1 text-[11px] text-ink-200 placeholder-ink-600 outline-none focus:border-voice-500/30"
                              />
                              <button
                                onClick={() => handleSavePreset(item)}
                                disabled={!saveLabel.trim()}
                                className="rounded-full bg-voice-500/15 px-2.5 py-1 text-[11px] font-medium text-voice-300 transition-colors hover:bg-voice-500/25 disabled:opacity-40"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => { setSaveFormId(null); setSaveLabel('') }}
                                className="text-[11px] text-ink-500 hover:text-ink-300"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setSaveFormId(item.id)}
                              className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                                isSaved ? 'text-green-400 light:text-green-600' : 'text-ink-300 hover:bg-ink/5 hover:text-ink-100'
                              }`}
                            >
                              {isSaved ? (
                                <><Check className="h-3 w-3" /> Saved</>
                              ) : (
                                <><Bookmark className="h-3 w-3" /> Save preset</>
                              )}
                            </button>
                          )}

                          <div className="flex-1" />

                          <button
                            onClick={() => onDelete(item.id)}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-red-500/10 hover:text-red-400 light:hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
