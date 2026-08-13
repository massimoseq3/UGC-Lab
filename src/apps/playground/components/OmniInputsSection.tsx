import { useRef, useState } from 'react'
import { X, Plus, Mic, Film, User } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import BankPicker from '../../../components/BankPicker'
import SlotActionMenu from '../../../components/video/SlotActionMenu'
import AnchoredPopover from '../../../components/video/AnchoredPopover'
import { RefGroup, MediaCard, MediaAddCard } from '../../../components/video/refInputParts'
import { readMediaDuration } from '../../../utils/media'
import { fileToDataUri } from '../../../utils/kie'
import { isAssetRef, getAsBase64 } from '../../../utils/assetStore'
import { useOmniVoiceStore, type OmniVoice } from '../../../stores/omniVoiceStore'
import { useAppStore } from '../../../stores/appStore'
import type { Model } from '../../../stores/types'
import type { PromptRef } from './PromptPanel'
import OmniVoiceDesigner from './OmniVoiceDesigner'
import { createOmniCharacterFromImage } from '../service'
import { humanizeError } from '../../../utils/friendlyError'

// Gemini Omni's extra inputs: persistent characters (from the Influencers
// bank), designed voices, and one trimmed source video clip. All Omni inputs
// share a 7-slot quota with the reference images:
//   images ×1  +  clip ×2  +  characters ×1  ≤ 7
// The quota readout lives here; the parent passes how many image refs are
// attached so the math covers the whole generation.

const MAX_CHARACTERS = 3
const MAX_VOICES = 3
const MAX_CLIP_WINDOW_S = 10

function omniQuotaUsed(refs: PromptRef[]): number {
  const images = refs.filter((r) => r.slot === 'ref' || r.slot === 'start' || r.slot === 'end').length
  const characters = refs.filter((r) => r.slot === 'omni-character').length
  const clip = refs.some((r) => r.slot === 'omni-clip') ? 2 : 0
  return images + characters + clip
}

interface OmniInputsSectionProps {
  refs: PromptRef[]
  onChangeRefs: (next: PromptRef[]) => void
}

export default function OmniInputsSection({ refs, onChangeRefs }: OmniInputsSectionProps) {
  const voices = useOmniVoiceStore((s) => s.voices)
  const removeVoice = useOmniVoiceStore((s) => s.removeVoice)
  const addToast = useAppStore((s) => s.addToast)

  const [characterPickerOpen, setCharacterPickerOpen] = useState(false)
  const [characterMenuOpen, setCharacterMenuOpen] = useState(false)
  const [uploadingCharacter, setUploadingCharacter] = useState(false)
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false)
  const [designerOpen, setDesignerOpen] = useState(false)
  const clipInputRef = useRef<HTMLInputElement>(null)
  const characterFileRef = useRef<HTMLInputElement>(null)
  const characterTriggerRef = useRef<HTMLButtonElement>(null)
  const voiceTriggerRef = useRef<HTMLButtonElement>(null)

  const characterRefs = refs.filter((r) => r.slot === 'omni-character')
  const voiceRefs = refs.filter((r) => r.slot === 'omni-voice')
  const clipRef = refs.find((r) => r.slot === 'omni-clip')

  const quotaUsed = omniQuotaUsed(refs)

  function addCharacters(items: Model[]) {
    void (async () => {
      const additions: PromptRef[] = []
      for (const item of items) {
        if (characterRefs.length + additions.length >= MAX_CHARACTERS) break
        if (characterRefs.some((r) => r.bankModelId === item.id)) continue
        if (quotaUsed + additions.length >= 7) {
          addToast('Omni input quota reached (7 slots) — remove an image or the clip first.', 'error')
          break
        }
        // Convert the bank image to a renderable data URI for the chip.
        let url = item.characterImage
        if (isAssetRef(url)) {
          const asset = await getAsBase64(url)
          if (!asset) continue
          url = `data:${asset.mimeType};base64,${asset.base64}`
        }
        additions.push({ url, label: item.name, source: 'character', slot: 'omni-character', bankModelId: item.id })
      }
      if (additions.length > 0) onChangeRefs([...refs, ...additions])
    })()
  }

  // Upload an arbitrary image and mint a one-off Omni character from it (no
  // bank row). The minted id rides on the ref's `omniId`, so generate uses it
  // directly without a bank lookup.
  async function handleCharacterUpload(file: File | null) {
    if (!file || uploadingCharacter) return
    if (characterRefs.length >= MAX_CHARACTERS) {
      addToast(`Up to ${MAX_CHARACTERS} characters.`, 'error')
      return
    }
    if (quotaUsed >= 7) {
      addToast('Omni input quota reached (7 slots) — remove an image or the clip first.', 'error')
      return
    }
    setUploadingCharacter(true)
    try {
      const dataUri = await fileToDataUri(file)
      const name = file.name.replace(/\.[^.]+$/, '') || 'Uploaded character'
      const characterId = await createOmniCharacterFromImage(dataUri, name)
      onChangeRefs([
        ...refs,
        { url: dataUri, label: name, source: 'upload', slot: 'omni-character', omniId: characterId },
      ])
    } catch (err) {
      addToast(humanizeError(err, 'Could not create the character'), 'error')
    } finally {
      setUploadingCharacter(false)
    }
  }

  function attachVoice(voice: OmniVoice) {
    if (voiceRefs.length >= MAX_VOICES) return
    if (voiceRefs.some((r) => r.omniId === voice.kieAudioId)) return
    onChangeRefs([...refs, { url: '', label: voice.name, source: 'upload', slot: 'omni-voice', omniId: voice.kieAudioId }])
  }

  async function handleClipFile(file: File | null) {
    if (!file) return
    if (quotaUsed + 2 > 7) {
      addToast('The source clip needs 2 free slots — remove images or characters first.', 'error')
      return
    }
    const dataUri = await fileToDataUri(file)
    let duration: number | undefined
    try {
      duration = await readMediaDuration(dataUri, 'video')
    } catch { /* let kie validate */ }
    if (duration && duration > 30) {
      addToast(`Source clips can't exceed 30s — this one is ${Math.ceil(duration)}s.`, 'error')
      return
    }
    const ends = Math.min(MAX_CLIP_WINDOW_S, duration ?? MAX_CLIP_WINDOW_S)
    onChangeRefs([
      ...refs.filter((r) => r.slot !== 'omni-clip'),
      { url: dataUri, label: file.name, source: 'upload', slot: 'omni-clip', clipStart: 0, clipEnds: Math.round(ends * 10) / 10, durationSeconds: duration },
    ])
  }

  function patchClip(patch: Partial<PromptRef>) {
    onChangeRefs(refs.map((r) => (r.slot === 'omni-clip' ? { ...r, ...patch } : r)))
  }

  function removeRef(target: PromptRef) {
    onChangeRefs(refs.filter((r) => r !== target))
  }

  // Three labelled groups — characters, voices, source clip — each stacking in
  // the parent's reference column below the image slots. Every one of them is a
  // 2-column grid of the same media card, so the whole Omni column reads as one
  // list of attachments rather than a tile grid sitting above a card list.
  return (
    <>
      <RefGroup label="Characters" count={characterRefs.length} max={MAX_CHARACTERS}>
        <div className="grid grid-cols-2 gap-2">
          {characterRefs.map((r) => (
            <MediaCard
              key={r.bankModelId ?? r.omniId}
              icon={User}
              thumb={r.url}
              label={r.label}
              onRemove={() => removeRef(r)}
            />
          ))}
          {uploadingCharacter && (
            <div className="flex items-center gap-2 rounded-xl border border-ink/10 bg-ink/[0.03] px-2.5 py-1.5 text-ink-400">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink/[0.06]">
                <Spinner className="h-3.5 w-3.5" />
              </span>
              <span className="truncate text-[12px] font-medium leading-tight">Adding…</span>
            </div>
          )}
          {characterRefs.length < MAX_CHARACTERS && (
            <MediaAddCard
              icon={User}
              label="Add character"
              triggerRef={characterTriggerRef}
              onClick={() => setCharacterMenuOpen((v) => !v)}
            />
          )}
        </div>
      </RefGroup>
      {characterRefs.length < MAX_CHARACTERS && (
        <SlotActionMenu
          anchorRef={characterTriggerRef}
          open={characterMenuOpen}
          onClose={() => setCharacterMenuOpen(false)}
          onUpload={() => characterFileRef.current?.click()}
          onPickFromBank={() => setCharacterPickerOpen(true)}
        />
      )}
      <input
        ref={characterFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { void handleCharacterUpload(e.target.files?.[0] ?? null); e.target.value = '' }}
      />

      {/* Voices and Source clip share a row — both are compact, single-column
          lists, so side by side saves the vertical space of two stacked groups. */}
      <div className="grid grid-cols-2 items-start gap-2">
        <RefGroup label="Voices" count={voiceRefs.length} max={MAX_VOICES}>
          <div className="flex flex-col gap-1.5">
            {voiceRefs.map((r) => (
              <MediaCard key={r.omniId} icon={Mic} label={r.label} onRemove={() => removeRef(r)} />
            ))}
            {voiceRefs.length < MAX_VOICES && (
              <MediaAddCard
                icon={Mic}
                label="Add voice"
                triggerRef={voiceTriggerRef}
                onClick={() => setVoiceMenuOpen((v) => !v)}
              />
            )}
          </div>
        </RefGroup>

        <RefGroup label="Source clip">
          {clipRef ? (
            <div className="flex flex-col gap-1.5">
              <MediaCard
                icon={Film}
                label={clipRef.label}
                meta={clipRef.durationSeconds != null ? `${Math.round(clipRef.durationSeconds)}s clip` : undefined}
                onRemove={() => removeRef(clipRef)}
              />
              {/* Trim window — which slice of the clip Omni actually sees. */}
              <div className="flex items-center gap-1 self-start rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-1 text-[11px] text-ink-500">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={clipRef.clipStart ?? 0}
                  onChange={(e) => {
                    const start = Math.max(0, Number(e.target.value) || 0)
                    const ends = Math.min(clipRef.clipEnds ?? start + MAX_CLIP_WINDOW_S, start + MAX_CLIP_WINDOW_S)
                    patchClip({ clipStart: start, clipEnds: Math.max(ends, start + 0.5) })
                  }}
                  className="w-7 bg-transparent text-center text-[12px] text-ink-200 outline-none"
                />
                <span>→</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={clipRef.clipEnds ?? MAX_CLIP_WINDOW_S}
                  onChange={(e) => {
                    const start = clipRef.clipStart ?? 0
                    let ends = Number(e.target.value) || 0
                    ends = Math.min(ends, start + MAX_CLIP_WINDOW_S)
                    if (clipRef.durationSeconds) ends = Math.min(ends, clipRef.durationSeconds)
                    patchClip({ clipEnds: Math.max(ends, start + 0.5) })
                  }}
                  className="w-7 bg-transparent text-center text-[12px] text-ink-200 outline-none"
                />
                <span>s</span>
              </div>
            </div>
          ) : (
            <MediaAddCard
              icon={Film}
              label="Upload clip"
              helper={`≤ ${MAX_CLIP_WINDOW_S}s`}
              onClick={() => clipInputRef.current?.click()}
            />
          )}
        </RefGroup>
      </div>
      {voiceRefs.length < MAX_VOICES && (
        <AnchoredPopover
          anchorRef={voiceTriggerRef}
          open={voiceMenuOpen}
          onClose={() => setVoiceMenuOpen(false)}
          width={240}
          estimatedHeight={voices.length > 0 ? Math.min(voices.length, 4) * 36 + 44 : 44}
          className="rounded-2xl border border-ink/10 bg-surface-2 p-1.5 shadow-xl"
        >
          {voices.length > 0 && (
            <div className="max-h-44 overflow-y-auto">
              {voices.map((v) => (
                <div key={v.kieAudioId} className="group flex items-center gap-1">
                  <button
                    onClick={() => { attachVoice(v); setVoiceMenuOpen(false) }}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] text-ink-300 transition-colors hover:bg-ink/5 hover:text-ink-100"
                  >
                    <Mic className="h-3.5 w-3.5 shrink-0 text-ink-500" />
                    <span className="truncate">{v.name}</span>
                  </button>
                  <button
                    onClick={() => removeVoice(v.kieAudioId)}
                    title="Delete voice"
                    className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-ink/10 hover:text-ink-300 group-hover:flex"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => { setDesignerOpen(true); setVoiceMenuOpen(false) }}
            className="mt-0.5 flex w-full items-center gap-2 rounded-full border-t border-ink/5 px-2.5 py-2 text-left text-[12px] font-medium text-playground-300 transition-colors hover:bg-ink/5"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Design new voice…</span>
          </button>
        </AnchoredPopover>
      )}
      <input
        ref={clipInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          void handleClipFile(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />

      <BankPicker
        bankType="models"
        isOpen={characterPickerOpen}
        onClose={() => setCharacterPickerOpen(false)}
        onSelect={() => { /* unused in multi-select mode */ }}
        multiSelect
        onSelectMany={(items) => addCharacters(items as Model[])}
      />

      <OmniVoiceDesigner
        open={designerOpen}
        onClose={() => setDesignerOpen(false)}
        onCreated={attachVoice}
      />
    </>
  )
}
