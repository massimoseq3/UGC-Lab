import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Mic, Pause, Play, X } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import { kieOmniAudioCreate } from '../../../utils/kie'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useOmniVoiceStore, type OmniVoice } from '../../../stores/omniVoiceStore'
import { humanizeError } from '../../../utils/friendlyError'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { OMNI_BASE_VOICES, omniVoicePreviewUrl } from '../omniVoices'
import { useBackdropClose } from '../../../hooks/useBackdropClose'

interface OmniVoiceDesignerProps {
  open: boolean
  onClose: () => void
  // Fired after a successful create so the caller can attach the new voice
  // to the current generation immediately.
  onCreated: (voice: OmniVoice) => void
}

// Modal for designing a Gemini Omni voice: pick a preset base voice, layer a
// free-text description on top, and kie mints a reusable kieAudioId. The
// result is stored browser-locally (omniVoiceStore) next to the kie API key.
export default function OmniVoiceDesigner({ open, onClose, onCreated }: OmniVoiceDesignerProps) {
  useCloseOnEscape(open, onClose)
  const addVoice = useOmniVoiceStore((s) => s.addVoice)
  const [name, setName] = useState('')
  const [baseVoiceId, setBaseVoiceId] = useState(OMNI_BASE_VOICES[0].id)
  const [description, setDescription] = useState('')
  const [exampleDialogue, setExampleDialogue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Base-voice dropdown with per-row sample playback (same pattern as
  // Voiceovers' VoicePickerView). Samples are Google-hosted WAVs.
  const [listOpen, setListOpen] = useState(false)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function stopPreview() {
    audioRef.current?.pause()
    audioRef.current = null
    setPreviewingId(null)
    setLoadingId(null)
  }

  // Stop playback when the modal closes/unmounts.
  useEffect(() => {
    if (!open) stopPreview()
    return stopPreview
  }, [open])

  useCloseOnAppSwitch(open, onClose)
  const backdrop = useBackdropClose(onClose)

  if (!open) return null

  function handlePreview(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (previewingId === id || loadingId === id) {
      stopPreview()
      return
    }
    audioRef.current?.pause()
    const audio = new Audio(omniVoicePreviewUrl(id))
    audioRef.current = audio
    setLoadingId(id)
    setPreviewingId(null)
    audio.addEventListener('playing', () => { setPreviewingId(id); setLoadingId(null) })
    audio.addEventListener('ended', () => { setPreviewingId(null); setLoadingId(null) })
    audio.addEventListener('error', () => { setPreviewingId(null); setLoadingId(null) })
    audio.play().catch(() => { setPreviewingId(null); setLoadingId(null) })
  }

  const canCreate = name.trim().length > 0 && !busy

  async function handleCreate() {
    if (!canCreate) return
    setBusy(true)
    setError(null)
    try {
      const apiKey = useSettingsStore.getState().getKieApiKey()
      const created = await kieOmniAudioCreate(apiKey, {
        audioId: baseVoiceId,
        name: name.trim().slice(0, 210),
        voiceDescription: description.trim() || undefined,
        exampleDialogue: exampleDialogue.trim().slice(0, 120) || undefined,
      })
      if (!created.kieAudioId) throw new Error('kie.ai returned no voice id.')
      const voice: OmniVoice = {
        kieAudioId: created.kieAudioId,
        name: name.trim(),
        baseVoiceId,
        voiceDescription: description.trim() || undefined,
        exampleDialogue: exampleDialogue.trim() || undefined,
        createdAt: Date.now(),
      }
      addVoice(voice)
      onCreated(voice)
      setName('')
      setDescription('')
      setExampleDialogue('')
      onClose()
    } catch (err) {
      setError(humanizeError(err, 'Voice creation failed.'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" {...backdrop}>
      <div
        className="w-full max-w-md rounded-xl border border-ink/10 bg-surface-1 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-playground-500/10 p-2 text-playground-400">
              <Mic className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-ink-100">Design an Omni voice</h2>
              <p className="text-[11px] text-ink-500">Reusable across every Gemini Omni generation</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-ink-500">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Energetic UGC narrator"
              className="w-full rounded-full border border-ink/10 bg-ink/[0.03] px-4 py-2 text-[13px] text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-ink-500">
              Base voice <span className="normal-case text-ink-700">— tap ▸ to hear a sample</span>
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setListOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-full border border-ink/10 bg-ink/[0.03] px-4 py-2 text-left text-[13px] text-ink-200 outline-none transition-colors hover:border-ink/20"
              >
                {(() => {
                  const v = OMNI_BASE_VOICES.find((x) => x.id === baseVoiceId) ?? OMNI_BASE_VOICES[0]
                  return <span className="truncate">{`${v.gender} · ${v.label}`}</span>
                })()}
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ink-500 transition-transform ${listOpen ? 'rotate-180' : ''}`} />
              </button>
              {listOpen && (
                <div className="absolute left-0 right-0 top-[42px] z-20 max-h-56 overflow-y-auto rounded-xl border border-ink/10 bg-surface-2 p-1 shadow-xl">
                  {OMNI_BASE_VOICES.map((v) => {
                    const isSelected = v.id === baseVoiceId
                    const isPlaying = previewingId === v.id
                    const isLoading = loadingId === v.id
                    return (
                      <div
                        key={v.id}
                        onClick={() => { setBaseVoiceId(v.id); setListOpen(false) }}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                          isSelected ? 'bg-playground-500/15' : 'hover:bg-ink/[0.04]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(e) => handlePreview(v.id, e)}
                          aria-label={isPlaying ? 'Stop sample' : 'Play sample'}
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                            isPlaying ? 'bg-playground-500/20 text-playground-300' : 'bg-ink/[0.05] text-ink-400 hover:bg-ink/10 hover:text-ink-200'
                          }`}
                        >
                          {isLoading
                            ? <Spinner className="h-3.5 w-3.5" />
                            : isPlaying
                            ? <Pause className="h-3.5 w-3.5" />
                            : <Play className="h-3.5 w-3.5" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <span className={`block truncate text-[12px] ${isSelected ? 'text-ink-50' : 'text-ink-300'}`}>{v.label}</span>
                          <span className="text-[10px] uppercase tracking-wider text-ink-600">{v.gender}</span>
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-playground-300" />}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-ink-500">
              Voice description <span className="normal-case text-ink-700">— optional</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Timbre, style, pace, emotion… e.g. warm, conversational, upbeat, slightly raspy"
              className="w-full resize-none rounded-2xl border border-ink/10 bg-ink/[0.03] px-4 py-2 text-[13px] text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-ink-500">
              Example line <span className="normal-case text-ink-700">— optional, max 120 chars</span>
            </label>
            <input
              value={exampleDialogue}
              onChange={(e) => setExampleDialogue(e.target.value)}
              maxLength={120}
              placeholder='e.g. "Okay, I have to tell you about this…"'
              className="w-full rounded-full border border-ink/10 bg-ink/[0.03] px-4 py-2 text-[13px] text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-300 light:text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={!canCreate}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-playground-500 py-2.5 text-[13px] font-bold tracking-tight text-white transition-all hover:bg-playground-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy && <Spinner className="h-4 w-4" />}
          Create voice
        </button>
      </div>
    </div>,
    document.body,
  )
}
