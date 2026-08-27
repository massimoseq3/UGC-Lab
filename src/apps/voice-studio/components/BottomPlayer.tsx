import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause, RotateCcw, RotateCw, Download, ChevronDown, AlignLeft } from 'lucide-react'
import type { VoiceHistoryItem } from '../../../stores/types'
import { getUrl } from '../../../utils/assetStore'
import { seedColor } from './seedColor'
import { claimAudioSlot, releaseAudioSlot } from './audio'

interface BottomPlayerProps {
  item: VoiceHistoryItem
  onClose: () => void
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

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

export default function BottomPlayer({ item, onClose, onShowDetails }: BottomPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(item.duration || 0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const animRef = useRef<number>(0)
  const trackRef = useRef<HTMLDivElement>(null)

  // Stable identity for the app-wide playback slot — a History card's play
  // button pauses this player rather than talking over it.
  const pauseSelf = useRef(() => { audioRef.current?.pause() }).current

  // Animate the progress bar while audio is playing. Named function expression
  // so the self-referential requestAnimationFrame(tick) binds to the function's
  // own name (in scope here) rather than the outer const being initialised.
  const tick = useCallback(function tick() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.duration) setDuration(audio.duration)
    setCurrentTime(audio.currentTime)
    if (!audio.paused && !audio.ended) {
      animRef.current = requestAnimationFrame(tick)
    }
  }, [])

  // Build a fresh audio element whenever the item changes.
  useEffect(() => {
    let cancelled = false
    setCurrentTime(0)
    setDuration(item.duration || 0)
    setIsPlaying(false)
    cancelAnimationFrame(animRef.current)

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }

    resolveAudioUrl(item.audioUrl)
      .then((url) => {
        if (cancelled) return
        const audio = new Audio(url)
        audio.preload = 'metadata'
        audioRef.current = audio

        audio.addEventListener('loadedmetadata', () => {
          if (audioRef.current === audio && isFinite(audio.duration)) {
            setDuration(audio.duration)
          }
        })
        audio.addEventListener('play', () => {
          if (audioRef.current !== audio) return
          claimAudioSlot(pauseSelf)
          setIsPlaying(true)
          cancelAnimationFrame(animRef.current)
          animRef.current = requestAnimationFrame(tick)
        })
        audio.addEventListener('pause', () => {
          if (audioRef.current !== audio) return
          setIsPlaying(false)
          cancelAnimationFrame(animRef.current)
          // Make sure UI reflects the final paused position.
          setCurrentTime(audio.currentTime)
        })
        audio.addEventListener('ended', () => {
          if (audioRef.current !== audio) return
          setIsPlaying(false)
          cancelAnimationFrame(animRef.current)
          setCurrentTime(0)
          audio.currentTime = 0
        })
        audio.addEventListener('timeupdate', () => {
          if (audioRef.current === audio) setCurrentTime(audio.currentTime)
        })
      })
      .catch(() => { /* swallow — UI just stays stopped */ })

    return () => {
      cancelled = true
      cancelAnimationFrame(animRef.current)
      releaseAudioSlot(pauseSelf)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
        audioRef.current = null
      }
    }
  }, [item.audioUrl, item.id, tick, pauseSelf])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => { /* ignored */ })
    else audio.pause()
  }

  const skip = (deltaSec: number) => {
    const audio = audioRef.current
    if (!audio) return
    const dur = audio.duration || duration
    if (!dur) return
    audio.currentTime = Math.max(0, Math.min(dur, audio.currentTime + deltaSec))
    setCurrentTime(audio.currentTime)
  }

  const seekFromEvent = (e: React.MouseEvent | React.PointerEvent) => {
    const audio = audioRef.current
    if (!audio || !trackRef.current) return
    const dur = audio.duration || duration
    if (!dur) return
    const rect = trackRef.current.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = fraction * dur
    setCurrentTime(audio.currentTime)
  }

  const handleDownload = async () => {
    const url = await resolveAudioUrl(item.audioUrl)
    const a = document.createElement('a')
    a.href = url
    a.download = `${item.voiceName}-${Date.now()}.mp3`
    a.click()
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="border-t border-ink/5 bg-surface-1">
      <div className="flex items-center gap-4 px-5 py-3">
        {/* Voice avatar + meta */}
        <div className="flex min-w-0 w-[28%] items-center gap-3">
          <span
            className="h-9 w-9 shrink-0 rounded-full"
            style={{ background: seedColor(item.voiceId) }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink-100">
              {item.scriptPreview}
            </div>
            <div className="truncate text-[11px] text-ink-500">
              <span className="text-ink-400">{item.voiceName}</span>
              {' · '}Created {formatRelative(item.createdAt)}
            </div>
          </div>
        </div>

        {/* Transport + scrubber */}
        <div className="flex flex-1 items-center gap-3">
          <button
            onClick={() => skip(-10)}
            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-100"
            title="Back 10 seconds"
          >
            <RotateCcw className="h-4 w-4" />
            <span className="absolute text-[7px] font-bold">10</span>
          </button>
          <button
            onClick={togglePlay}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-900 transition-colors hover:bg-ink"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
          </button>
          <button
            onClick={() => skip(10)}
            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-100"
            title="Forward 10 seconds"
          >
            <RotateCw className="h-4 w-4" />
            <span className="absolute text-[7px] font-bold">10</span>
          </button>

          <span className="min-w-[36px] text-right text-[11px] tabular-nums text-ink-500">
            {formatTime(currentTime)}
          </span>

          {/* Scrubber track — single source of truth for seeking */}
          <div
            ref={trackRef}
            onClick={seekFromEvent}
            className="group relative h-1.5 flex-1 cursor-pointer rounded-full bg-ink/[0.08]"
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-ink-100"
              style={{ width: `${progressPct}%` }}
            />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-100 opacity-0 shadow transition-opacity group-hover:opacity-100 touch:opacity-100"
              style={{ left: `${progressPct}%` }}
            />
          </div>

          <span className="min-w-[36px] text-[11px] tabular-nums text-ink-500">
            {formatTime(duration)}
          </span>
        </div>

        {/* Right cluster */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onShowDetails(item)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200"
            title="Show details"
          >
            <AlignLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDownload}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200"
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200"
            title="Close player"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
