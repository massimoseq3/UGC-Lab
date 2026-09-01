import { useCallback, useEffect, useRef, useState } from 'react'
import {
  claimAudioSlot,
  releaseAudioSlot,
  resolveAudioUrl,
  waveformPeaks,
} from '../utils/audioPlayback'

// One card's own player: the transport behind a generated clip's play button,
// its waveform and its elapsed clock. The element is created on the FIRST press
// — a history pane holding dozens of tracks has no business opening dozens of
// media elements — and from then on the card holds it, so a paused card keeps
// its waveform where the member left it.
//
// The app-wide one-clip-at-a-time rule comes free: `claimAudioSlot` pauses
// whoever held the slot, and that card's own `pause` listener reports it. This
// is the audio counterpart of `useInlineVideo` for clips.
//
// Voiceovers' History keeps its own list-level copy of this logic (one player
// shared by the whole list) — it predates the hook.
export interface AudioPlayback {
  // Whether this source has an element loaded (waveform open, possibly paused).
  isLoaded: boolean
  isPlaying: boolean
  // Seconds played, and the clip's own length (the `fallbackDuration` until the
  // element reports a real one).
  position: number
  duration: number
  // Decoded peaks for the whole clip, or null while they're still coming.
  peaks: number[] | null
  toggle: () => void
  seekTo: (seconds: number) => void
}

export function useAudioPlayback(ref: string | null, fallbackDuration = 0): AudioPlayback {
  const [isLoaded, setIsLoaded] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(fallbackDuration)
  const [peaks, setPeaks] = useState<number[] | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const rafRef = useRef(0)
  const loadTokenRef = useRef(0)

  // Stable identity for the app-wide playback slot (see utils/audioPlayback).
  const pauseSelf = useRef(() => { audioRef.current?.pause() }).current

  // Keep the elapsed counter smooth between `timeupdate` events, which only
  // fire ~4×/sec.
  const tick = useCallback(function tick() {
    const audio = audioRef.current
    if (!audio) return
    setPosition(audio.currentTime)
    if (!audio.paused && !audio.ended) rafRef.current = requestAnimationFrame(tick)
  }, [])

  const teardown = useCallback(() => {
    loadTokenRef.current++
    cancelAnimationFrame(rafRef.current)
    releaseAudioSlot(pauseSelf)
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
  }, [pauseSelf])

  // Unmounting the card (a dock switch, a filter, a delete) must not leave a
  // clip playing behind it.
  useEffect(() => teardown, [teardown])

  // A card whose source changes is a different clip — drop the old element.
  useEffect(() => {
    teardown()
    setIsLoaded(false)
    setIsPlaying(false)
    setPosition(0)
    setPeaks(null)
  }, [ref, teardown])

  const load = async (source: string) => {
    const token = ++loadTokenRef.current
    setIsLoaded(true)
    setPosition(0)
    void waveformPeaks(source).then((p) => {
      // A newer load claimed this card while the clip decoded.
      if (loadTokenRef.current === token) setPeaks(p)
    })

    let url: string
    try {
      url = await resolveAudioUrl(source)
    } catch {
      if (loadTokenRef.current === token) setIsLoaded(false)
      return
    }
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

  const toggle = () => {
    if (!ref) return
    const audio = audioRef.current
    if (audio) {
      if (audio.paused) void audio.play().catch(() => { /* ignored */ })
      else audio.pause()
      return
    }
    void load(ref)
  }

  // Click anywhere on the waveform to jump there — the strip shows the whole
  // clip, so a position on it is a position in the audio.
  const seekTo = (seconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds))
    setPosition(audio.currentTime)
  }

  return {
    isLoaded,
    isPlaying,
    position,
    duration: duration || fallbackDuration,
    peaks,
    toggle,
    seekTo,
  }
}
