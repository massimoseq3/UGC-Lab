import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { Search, Volume2, Bookmark, Check, Trash2, Play, Pause, AlignLeft, Download, X } from 'lucide-react'
import RailNewButton from '../../../components/RailNewButton'
import { useBankStore } from '../../../stores/bankStore'
import type { VoiceHistoryItem } from '../../../stores/types'
import { formatRelative, sectionLabel, groupByDay } from '../../../utils/history'
import { seedColor, PLAY_DISC_RIM } from './seedColor'
import { GeneratingChip, GeneratingPulseRing } from '../../../components/GeneratingChip'
import DayPill from '../../../components/DayPill'
import AudioScrubber from '../../../components/AudioScrubber'
import {
  claimAudioSlot,
  formatClock,
  releaseAudioSlot,
  resolveAudioUrl,
} from '../../../utils/audioPlayback'

// A voiceover that's been fired but hasn't landed yet. Rendered as a card at the
// top of History so a queued batch reads as a queue — several can run at once.
export interface PendingVoice {
  id: string
  voiceId: string
  voiceName: string
  scriptPreview: string
}

interface HistoryRailProps {
  items: VoiceHistoryItem[]
  pending: PendingVoice[]
  activeId: string | null
  onSelect: (item: VoiceHistoryItem) => void
  onDelete: (id: string) => void
  onShowDetails: (item: VoiceHistoryItem) => void
  // Empties the script box back to a blank slate. It is this rail's "New" for
  // the same reason the Ad Analyzer's is: starting another one is the action
  // that belongs at the top of the list of the ones you have made. Single
  // click — it carried `ClearAllButton`'s two-click arm for a day and lost it
  // in September 2026 (Massimo's call).
  onNew: () => void
  onCollapse: () => void
}

// The reads you have made, as the rail beside the script rather than a tab
// sharing its pane — so the words being read are on screen while you listen
// back to them.
export default function HistoryRail({ items, pending, activeId, onSelect, onDelete, onShowDetails, onNew, onCollapse }: HistoryRailProps) {
  const [query, setQuery] = useState('')
  const [saveFormId, setSaveFormId] = useState<string | null>(null)
  const [saveLabel, setSaveLabel] = useState('')
  const [savedId, setSavedId] = useState<string | null>(null)
  const addVoice = useBankStore((s) => s.addVoice)

  // Playback — one card at a time. `loadedId` is the card holding the audio
  // element (it keeps its waveform open while paused); `isPlaying` is whether
  // that element is actually making noise.
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef(0)
  const loadTokenRef = useRef(0)

  // Stable identity for the app-wide playback slot (see audio.ts).
  const pauseSelf = useRef(() => { audioRef.current?.pause() }).current

  // Keep the elapsed counter smooth between `timeupdate` events, which only
  // fire ~4×/sec.
  const tick = useCallback(function tick() {
    const audio = audioRef.current
    if (!audio) return
    setPosition(audio.currentTime)
    if (!audio.paused && !audio.ended) rafRef.current = requestAnimationFrame(tick)
  }, [])

  // Switching to the Settings tab unmounts this view — don't leave audio running
  // behind it.
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    releaseAudioSlot(pauseSelf)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
  }, [pauseSelf])

  const loadAndPlay = async (item: VoiceHistoryItem) => {
    const token = ++loadTokenRef.current
    cancelAnimationFrame(rafRef.current)
    audioRef.current?.pause()
    audioRef.current = null
    setLoadedId(item.id)
    setIsPlaying(false)
    setPosition(0)
    setDuration(item.duration || 0)

    let url: string
    try {
      url = await resolveAudioUrl(item.audioUrl)
    } catch {
      if (loadTokenRef.current === token) setLoadedId(null)
      return
    }
    // A newer click already claimed the player.
    if (loadTokenRef.current !== token) return

    const audio = new Audio(url)
    audio.preload = 'metadata'
    audioRef.current = audio

    audio.addEventListener('loadedmetadata', () => {
      if (audioRef.current !== audio) return
      if (isFinite(audio.duration)) setDuration(audio.duration)
    })
    audio.addEventListener('play', () => {
      if (audioRef.current !== audio) return
      claimAudioSlot(pauseSelf)
      setIsPlaying(true)
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(tick)
    })
    audio.addEventListener('pause', () => {
      if (audioRef.current !== audio) return
      setIsPlaying(false)
      cancelAnimationFrame(rafRef.current)
      setPosition(audio.currentTime)
    })
    audio.addEventListener('ended', () => {
      if (audioRef.current !== audio) return
      setIsPlaying(false)
      cancelAnimationFrame(rafRef.current)
      audio.currentTime = 0
      setPosition(0)
    })

    try {
      await audio.play()
    } catch {
      /* autoplay refusal — the button is still armed */
    }
  }

  // Click anywhere on the waveform to jump there — the strip shows the whole
  // clip, so a position on it is a position in the audio.
  const seekTo = (seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds))
    setPosition(audio.currentTime)
  }

  const togglePlay = (item: VoiceHistoryItem) => {
    const audio = audioRef.current
    if (audio && loadedId === item.id) {
      if (audio.paused) {
        void audio.play().catch(() => { /* ignored */ })
      } else {
        audio.pause()
      }
      return
    }
    void loadAndPlay(item)
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

  const isEmpty = items.length === 0 && pending.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* New leads the rail, above the search — the Ad Analyzer's shape, and
          its band takes the app-wide h-[57px]. The rail's open/shut control is
          the pull tab on the seam (`HistoryRailHandle`), reachable in BOTH
          states; the Close here renders only below 980px, where the rail covers
          the script and takes that tab with it. */}
      <div className="flex h-[57px] shrink-0 items-center gap-2 border-b border-ink/5 px-3">
        <RailNewButton
          label="New Voiceover"
          accentClass="bg-voice-500"
          title="Clear the script box. Every read you've made stays here"
          onClick={onNew}
          className="flex-1"
        />
        <button
          type="button"
          onClick={onCollapse}
          title="Close history"
          aria-label="Close history"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-100 min-[980px]:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative flex shrink-0 items-center border-b border-ink/5 px-3 py-2.5">
        <Search className="pointer-events-none absolute left-6 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search history..."
          className="w-full rounded-full border border-ink/10 bg-transparent py-2 pl-9 pr-3 text-[12.5px] text-ink-100 placeholder-ink-500 outline-none transition-colors focus:border-voice-500/40"
        />
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isEmpty && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <Volume2 className="h-8 w-8 text-ink-800" strokeWidth={1.5} />
            <p className="text-xs text-ink-300">No voiceovers yet</p>
            <p className="text-[11px] text-ink-500">Your generated voiceovers will land here.</p>
          </div>
        )}
        {/* Queue — in-flight voiceovers, above the finished ones. Not filtered by
            the search box: a pending row has no content to match on yet, and
            hiding the thing you just fired is the opposite of a queue. */}
        {pending.length > 0 && (
          <div className="flex flex-col gap-2 p-2">
            <DayPill label={pending.length === 1 ? 'In progress' : `In progress · ${pending.length}`} className="mb-0" />
            {pending.map((p) => (
              <div key={p.id} className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-3">
                <div className="flex items-center gap-2.5">
                  <span className="relative h-10 w-10 shrink-0">
                    <span
                      className="block h-full w-full rounded-full opacity-60"
                      style={{ background: seedColor(p.voiceId) }}
                    />
                    <GeneratingPulseRing family="voice" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-200">{p.voiceName}</p>
                    <GeneratingChip family="voice" label="Generating…" />
                  </div>
                </div>
                <p className="mt-2.5 line-clamp-2 text-[12px] leading-snug text-ink-400">{p.scriptPreview}</p>
              </div>
            ))}
          </div>
        )}

        {groups.length === 0 ? (
          pending.length === 0 && !isEmpty && (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <span className="text-sm text-ink-500">No matches.</span>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2 p-2">
            {groups.map(([dayTs, dayItems]) => (
              <div key={dayTs} className="flex flex-col gap-2">
                <DayPill label={sectionLabel(dayTs)} className="mb-0 mt-1" />

                {dayItems.map((item) => {
                  const isActive = activeId === item.id
                  const isSaved = savedId === item.id
                  const inSaveForm = saveFormId === item.id
                  const isLoaded = loadedId === item.id
                  const isPlayingThis = isLoaded && isPlaying
                  const clipDuration = (isLoaded && duration) || item.duration || 0
                  // The waveform belongs to a clip that's actually running —
                  // it opens on the first play and closes when the clip ends.
                  const showWave = isLoaded && (isPlaying || position > 0)

                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelect(item)}
                      className={`group cursor-pointer rounded-2xl border p-3 transition-colors ${
                        isActive
                          ? 'border-voice-500/25 bg-voice-500/10'
                          : 'border-ink/10 bg-ink/[0.02] hover:border-ink/15 hover:bg-ink/[0.04]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {/* Play button doubles as the voice's avatar — one big
                            target, and the colour still says which voice it is. */}
                        <button
                          onClick={(e) => { e.stopPropagation(); togglePlay(item) }}
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ring-2 transition-all hover:brightness-110 ${PLAY_DISC_RIM} ${
                            isPlayingThis ? 'ring-voice-400/60' : 'ring-transparent'
                          }`}
                          style={{ background: seedColor(item.voiceId) }}
                          title={isPlayingThis ? 'Pause' : 'Play'}
                        >
                          {isPlayingThis
                            ? <Pause className="h-3.5 w-3.5 fill-current" />
                            : <Play className="h-3.5 w-3.5 translate-x-px fill-current" />}
                        </button>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-ink-100">{item.voiceName}</p>
                          <p className="text-[11px] text-ink-500">
                            {formatRelative(item.createdAt)}
                            {clipDuration > 0 && ` · ${formatClock(clipDuration)}`}
                          </p>
                        </div>

                        {/* Hover-only action cluster: Show details / Download */}
                        <div
                          className={`flex items-center gap-0.5 transition-opacity ${
                            isActive || isLoaded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 touch:opacity-100'
                          }`}
                        >
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

                      <p className="mt-2.5 line-clamp-2 text-[12px] leading-snug text-ink-200">
                        {item.scriptPreview}
                      </p>

                      {/* The progress line, in the shape the player under this
                          column already draws (`AudioScrubber`) rather than the
                          waveform it used to. A waveform earns its space on a
                          music track, where you scan it for the drop; on a
                          six-second read it was decoration over the one thing a
                          player has to say — where you are — and the same clip
                          rendered two different ways on the card and in the
                          footer read as two different controls.
                          Opens on play; the grid-rows trick animates it in and
                          out without a fixed height to keep in step with. */}
                      <div
                        className={`grid transition-all duration-300 ease-out ${
                          showWave ? 'mt-2.5 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'
                        }`}
                      >
                        <div className="overflow-hidden">
                          <div className="flex items-center gap-2 px-0.5 py-1">
                            <span className="shrink-0 text-[10px] tabular-nums text-ink-500">
                              {formatClock(position)}
                            </span>
                            <AudioScrubber
                              progress={clipDuration > 0 ? position / clipDuration : 0}
                              onSeek={isLoaded ? (f) => seekTo(f * clipDuration) : undefined}
                              className="min-w-0 flex-1"
                            />
                            <span className="shrink-0 text-[10px] tabular-nums text-ink-500">
                              {formatClock(clipDuration)}
                            </span>
                          </div>
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
