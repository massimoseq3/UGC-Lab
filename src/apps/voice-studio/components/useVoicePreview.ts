import { useEffect, useRef, useState } from 'react'
import { voicePreviewUrl } from '../services/previewVoice'

// Shared "tap the avatar to hear the voice" behaviour for the two in-panel
// pickers (voices and presets). Plays Google's pre-rendered sample straight
// from the public gstatic CDN — instant, free, no kie.ai call or key.
export function useVoicePreview() {
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  // `rowId` is what the caller keys its rows by (a voice id, or a preset id);
  // `voiceId` is the Gemini voice_name the sample lives under.
  const toggle = (rowId: string, voiceId: string) => {
    // Toggle off if this row is already playing or being fetched.
    if (previewingId === rowId || loadingId === rowId) {
      audioRef.current?.pause()
      audioRef.current = null
      setPreviewingId(null)
      setLoadingId(null)
      return
    }

    audioRef.current?.pause()
    setLoadingId(rowId)
    setPreviewingId(null)

    // The loading ring shows only for the brief first fetch; 'playing' and
    // 'error' clear it.
    const audio = new Audio(voicePreviewUrl(voiceId))
    audioRef.current = audio
    audio.addEventListener('playing', () => {
      setPreviewingId(rowId)
      setLoadingId(null)
    })
    audio.addEventListener('ended', () => {
      setPreviewingId(null)
      setLoadingId(null)
    })
    audio.addEventListener('error', () => {
      setPreviewingId(null)
      setLoadingId(null)
    })
    audio.play().catch(() => {
      setLoadingId(null)
      setPreviewingId(null)
    })
  }

  return { previewingId, loadingId, toggle }
}
