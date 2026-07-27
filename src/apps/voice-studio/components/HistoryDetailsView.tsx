import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, Play, Pause, RotateCcw, Download } from 'lucide-react'
import type { VoiceHistoryItem } from '../../../stores/types'
import type { VoiceSettings } from '../types'
import { getVoiceById } from '../types'
import { getUrl } from '../../../utils/assetStore'
import { seedColor } from './seedColor'

interface HistoryDetailsViewProps {
  item: VoiceHistoryItem
  onClose: () => void
  onRestoreText: (text: string) => void
  onRestoreSettings: (settings: Partial<VoiceSettings>) => void
}

async function resolveAudioUrl(ref: string): Promise<string> {
  if (ref.startsWith('asset-')) {
    const url = await getUrl(ref)
    if (!url) throw new Error('Audio asset not found')
    return url
  }
  return ref
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} hours ago`
  return new Date(ts).toLocaleDateString()
}

export default function HistoryDetailsView({ item, onClose, onRestoreText, onRestoreSettings }: HistoryDetailsViewProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const voice = getVoiceById(item.voiceId)

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [item.id])

  const togglePlay = async () => {
    if (audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause()
      setIsPlaying(false)
      return
    }
    try {
      const url = await resolveAudioUrl(item.audioUrl)
      const audio = audioRef.current ?? new Audio(url)
      if (!audioRef.current) {
        audio.addEventListener('ended', () => setIsPlaying(false))
        audio.addEventListener('pause', () => setIsPlaying(false))
        audio.addEventListener('play', () => setIsPlaying(true))
        audioRef.current = audio
      }
      audio.play().catch(() => { /* swallow */ })
    } catch {
      /* swallow */
    }
  }

  const handleDownload = async () => {
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

  const handleRestoreText = () => onRestoreText(item.scriptText)
  const handleRestoreSettings = () => onRestoreSettings({
    voiceId: item.voiceId,
    voiceName: item.voiceName,
    gender: item.gender,
    style: item.style,
    pace: item.pace,
    accent: item.accent,
    temperature: item.temperature,
    scene: item.scene ?? '',
    sampleContext: item.sampleContext ?? '',
  })

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Back header */}
      <div className="flex items-center gap-2 border-b border-ink/5 px-5 py-4">
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-300 transition-colors hover:bg-ink/5 hover:text-ink-100"
          aria-label="Back to history"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-ink-200">Back to history</span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {/* Voice meta */}
        <div className="flex items-start gap-3">
          <span
            className="h-11 w-11 shrink-0 rounded-full"
            style={{ background: seedColor(item.voiceId) }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-ink-100">
              {voice ? `${voice.name} — ${voice.description}` : item.voiceName}
            </div>
            <div className="text-xs text-ink-500">{formatRelative(item.createdAt)}</div>
          </div>
        </div>

        {/* Pills */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-1 text-[11px] text-ink-300">
            Gemini 3.1 Flash TTS
          </span>
          <span className="rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-1 text-[11px] text-ink-300">
            {item.scriptText.length} chars
          </span>
        </div>

        {/* Script text */}
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink-300">
          {item.scriptText}
        </p>

        {/* Action buttons */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={togglePlay}
            className="flex items-center justify-center gap-2 rounded-xl border border-ink/10 bg-ink/[0.02] px-3 py-2.5 text-sm font-medium text-ink-200 transition-colors hover:bg-ink/[0.05]"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={handleRestoreText}
            className="flex items-center justify-center gap-2 rounded-xl border border-ink/10 bg-ink/[0.02] px-3 py-2.5 text-sm font-medium text-ink-200 transition-colors hover:bg-ink/[0.05]"
          >
            <RotateCcw className="h-4 w-4" />
            Add text to edit
          </button>
        </div>

        <button
          onClick={handleDownload}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-ink/10 bg-ink/[0.02] px-3 py-2.5 text-sm font-medium text-ink-200 transition-colors hover:bg-ink/[0.05]"
        >
          <Download className="h-4 w-4" />
          Download audio
        </button>

        {/* Settings list */}
        <div className="mt-6">
          <div className="mb-3 text-sm font-semibold text-ink-100">Settings</div>
          <div className="flex flex-col gap-2.5">
            <SettingRow label="Model" value="Gemini 3.1 Flash TTS" />
            <SettingRow label="Style" value={item.style ?? '—'} />
            <SettingRow label="Pace" value={item.pace ?? '—'} />
            <SettingRow label="Accent" value={item.accent ?? '—'} />
            <SettingRow label="Expressiveness" value={(item.temperature ?? 1).toFixed(2)} />
            {item.scene && <SettingRow label="Scene" value={item.scene} />}
            {item.sampleContext && <SettingRow label="Tone / Context" value={item.sampleContext} />}
          </div>

          <button
            onClick={handleRestoreSettings}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-ink/10 bg-ink/[0.02] px-3 py-2.5 text-sm font-medium text-ink-200 transition-colors hover:bg-ink/[0.05]"
          >
            <RotateCcw className="h-4 w-4" />
            Restore settings
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="text-ink-500">{label}</span>
      <span
        className="flex-1 self-center border-b border-dashed border-ink/10"
        aria-hidden
      />
      <span className="tabular-nums text-ink-200">{value}</span>
    </div>
  )
}
