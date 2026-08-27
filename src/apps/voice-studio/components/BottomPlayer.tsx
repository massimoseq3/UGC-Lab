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
    // The player rides the generate row, in the space the Generate button
    // leaves on its right — it used to be a full-width band UNDER that row,
    // which spent a whole strip of the editor column on a control the row was
    // already wide enough to hold. `flex-1` claims exactly the leftover, and
    // `items-stretch` on the row gives it the button's own height, so the pair
    // reads as one bar rather than two.
    //
    // Below `md` the row wraps and this takes its own line (`basis-full`),
    // ABOVE the stepper + Generate (`order-first`) — the thing you just made is
    // what you reach for first on a phone, and it shouldn't sit under the
    // button that would replace it. What it drops there is everything that
    // can't earn 335px: the ±10s
    // skips (the scrubber does that job) and the details button (History's own
    // card opens the same view). The elapsed / total pair and the scrubber are
    // what's left, because a player you can't seek isn't one.
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-ink/10 bg-ink/[0.02] px-3 py-2 max-md:order-first max-md:basis-full">
      {/* Play — filled with the voice's own seed colour, the same trick the
          History cards use: the button says WHO is speaking, which is what the
          avatar + name block beside it used to say and no longer has room to. */}
      <button
        onClick={togglePlay}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-transform hover:scale-105"
        style={{ background: seedColor(item.voiceId) }}
        title={isPlaying ? `Pause ${item.voiceName}` : `Play ${item.voiceName}`}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
      </button>

      {/* The ±10s pair is the first thing to go when the bar is narrow, and
          it goes by VIEWPORT width because that is an exact proxy here: the
          side panel is a fixed 400px, so the editor pane — and therefore this
          bar — is the viewport minus a constant. Below `2xl` the two buttons
          and their gaps are ~80px out of the ~160px the scrubber has to live
          on, and a scrubber you can click is worth more on a 6-second read
          than a jump longer than the clip. */}
      <button
        onClick={() => skip(-10)}
        className="relative hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-100 2xl:flex"
        title="Back 10 seconds"
      >
        <RotateCcw className="h-4 w-4" />
        <span className="absolute text-[7px] font-bold">10</span>
      </button>
      <button
        onClick={() => skip(10)}
        className="relative hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-100 2xl:flex"
        title="Forward 10 seconds"
      >
        <RotateCw className="h-4 w-4" />
        <span className="absolute text-[7px] font-bold">10</span>
      </button>

      <span className="min-w-[32px] shrink-0 text-right text-[11px] tabular-nums text-ink-500">
        {formatTime(currentTime)}
      </span>

      {/* Scrubber track — single source of truth for seeking. `mx-1` is the
          thumb's overhang: it's `-translate-x-1/2`, so at 0:00 half of it sits
          outside the track, and on a touch screen it's permanently visible —
          without the margin it lands on top of the elapsed-time label. */}
      <div
        ref={trackRef}
        onClick={seekFromEvent}
        className="group relative mx-1 h-1.5 min-w-[56px] flex-1 cursor-pointer rounded-full bg-ink/[0.08]"
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

      <span className="min-w-[32px] shrink-0 text-[11px] tabular-nums text-ink-500">
        {formatTime(duration)}
      </span>

      <button
        onClick={() => onShowDetails(item)}
        className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200 md:flex"
        title="Show details"
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={handleDownload}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200"
        title="Download"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onClose}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200"
        title="Close player"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
    </div>
  )
}
