import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause, RotateCcw, RotateCw, Download, ChevronDown, AlignLeft } from 'lucide-react'
import type { VoiceHistoryItem } from '../../../stores/types'
import { getUrl } from '../../../utils/assetStore'
import { seedColor, PLAY_DISC_RIM } from './seedColor'
import { claimAudioSlot, releaseAudioSlot } from '../../../utils/audioPlayback'
import AudioScrubber from '../../../components/AudioScrubber'

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

  // Seek to a fraction of the clip. The track itself — press, drag, pointer
  // capture and all — is `AudioScrubber`, shared with the History cards.
  const seekToFraction = (fraction: number) => {
    const audio = audioRef.current
    if (!audio) return
    const dur = audio.duration || duration
    if (!dur) return
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

  return (
    // The player is the output column's own FOOTER (September 2026), so it
    // spans the Script tab and the History tab alike: it's the transport for
    // whatever is playing, whichever list is on screen. It rode inside the
    // generate row until Generate moved to the settings column, and it takes
    // that row's whole width now rather than the leftover beside a button.
    //
    // On a phone it drops the details button (History's own card opens the
    // same view); the elapsed / total pair and the scrubber always stay,
    // because a player you can't seek isn't one.
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-ink/10 bg-ink/[0.02] px-3 py-2">
      {/* Play — filled with the voice's own seed colour, the same trick the
          History cards use: the button says WHO is speaking, which is what the
          avatar + name block beside it used to say and no longer has room to. */}
      <button
        onClick={togglePlay}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-all hover:brightness-110 ${PLAY_DISC_RIM}`}
        style={{ background: seedColor(item.voiceId) }}
        title={isPlaying ? `Pause ${item.voiceName}` : `Play ${item.voiceName}`}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying
          ? <Pause className="h-3 w-3 fill-current" />
          : <Play className="h-3 w-3 translate-x-px fill-current" />}
      </button>

      {/* The ±10s pair is the first thing to go when the bar is narrow, and
          it goes by VIEWPORT width because that is an exact proxy here: the
          settings column is a fixed 460px, so this bar is the viewport minus a
          constant. The threshold is `lg` rather than the old `2xl` because the
          bar no longer shares its row with a Generate button — at 1024px it
          has ~544px to itself, where before it had ~160px for the scrubber
          once the button had taken its share. Below that, the two buttons and
          their gaps cost more than a clickable scrubber is worth on a
          six-second read. */}
      <button
        onClick={() => skip(-10)}
        className="relative hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-100 lg:flex"
        title="Back 10 seconds"
      >
        <RotateCcw className="h-4 w-4" />
        <span className="absolute text-[7px] font-bold">10</span>
      </button>
      <button
        onClick={() => skip(10)}
        className="relative hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-100 lg:flex"
        title="Forward 10 seconds"
      >
        <RotateCw className="h-4 w-4" />
        <span className="absolute text-[7px] font-bold">10</span>
      </button>

      <span className="min-w-[32px] shrink-0 text-right text-[11px] tabular-nums text-ink-500">
        {formatTime(currentTime)}
      </span>

      {/* Scrubber track — single source of truth for seeking, and the same
          component the History cards draw. */}
      <AudioScrubber
        progress={duration > 0 ? currentTime / duration : 0}
        onSeek={seekToFraction}
        className="min-w-[56px] flex-1"
      />

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
