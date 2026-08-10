import { useState, useEffect } from 'react'
import { X, Loader2, Mic, SlidersHorizontal } from 'lucide-react'
import type { VoicePreset } from '../../stores/types'
import { VOICES, DEFAULT_VOICE_SETTINGS, VOICE_STYLES, VOICE_PACES, VOICE_ACCENTS } from '../voice-studio/types'
import SectionCard, { SectionLabel } from '../../components/SectionCard'

interface VoiceFormProps {
  item?: VoicePreset | null
  onSave: (data: Omit<VoicePreset, 'id' | 'createdAt'>) => Promise<void> | void
  onCancel: () => void
}

export default function VoiceForm({ item, onSave, onCancel }: VoiceFormProps) {
  const [label, setLabel] = useState(item?.label ?? '')
  const [voiceId, setVoiceId] = useState(item?.voiceId ?? VOICES[0].id)
  const [style, setStyle] = useState(item?.style ?? DEFAULT_VOICE_SETTINGS.style)
  const [pace, setPace] = useState(item?.pace ?? DEFAULT_VOICE_SETTINGS.pace)
  const [accent, setAccent] = useState(item?.accent ?? DEFAULT_VOICE_SETTINGS.accent)
  // Optional direction. Part of the preset so loading it in Voiceovers restores
  // the whole read — voice, delivery params, AND the scene/tone it was written for.
  const [scene, setScene] = useState(item?.scene ?? '')
  const [sampleContext, setSampleContext] = useState(item?.sampleContext ?? '')
  const [linkedModelId] = useState(item?.linkedModelId ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (item) {
      setLabel(item.label)
      setVoiceId(item.voiceId)
      setStyle(item.style)
      setPace(item.pace)
      setAccent(item.accent)
      setScene(item.scene ?? '')
      setSampleContext(item.sampleContext ?? '')
    }
  }, [item])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    const voice = VOICES.find((v) => v.id === voiceId)
    if (!label.trim() || !voice) return
    setSaving(true)
    try {
      await onSave({
        label,
        voiceId,
        voiceName: voice.name,
        gender: voice.gender,
        style,
        pace,
        accent,
        temperature: item?.temperature ?? DEFAULT_VOICE_SETTINGS.temperature,
        scene: scene.trim() || undefined,
        sampleContext: sampleContext.trim() || undefined,
        linkedModelId,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight text-ink-200">
          {item ? 'Edit Voice Preset' : 'New Voice Preset'}
        </h3>
        <button type="button" onClick={onCancel} className="text-ink-500 hover:text-ink-300 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Two cards then two bare extras — the exact shape of the Voiceovers side
          panel this form edits the presets for, so a preset reads the same way
          wherever you meet it. Only Label carries a dot: it's what gates Save,
          while the voice and the three delivery controls always hold a value,
          and a permanent row of green dots teaches you to stop reading dots. */}
      <SectionCard icon={Mic} title="Voice" contentClassName="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <SectionLabel label="Label" filled={!!label.trim()} required />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`e.g. "Punchy hook voice"`}
            className="rounded-full border border-ink/10 bg-transparent px-3.5 py-2 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <SectionLabel label="Voice" />
          <select
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            className="rounded-full border border-ink/10 bg-surface-1 px-3.5 py-2 text-sm text-ink-200 outline-none focus:border-ink/20"
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.category} · {v.description}
              </option>
            ))}
          </select>
        </label>
      </SectionCard>

      <SectionCard icon={SlidersHorizontal} title="Delivery">
        <div className="grid grid-cols-3 gap-2">
          <SelectField label="Style" value={style} options={VOICE_STYLES} onChange={setStyle} />
          <SelectField label="Pace" value={pace} options={VOICE_PACES} onChange={setPace} />
          <SelectField label="Accent" value={accent} options={VOICE_ACCENTS} onChange={setAccent} />
        </div>
      </SectionCard>

      <TextAreaField
        label="Scene"
        value={scene}
        onChange={setScene}
        placeholder="e.g. A bright, upbeat product demo in a sunny kitchen."
      />
      <TextAreaField
        label="Tone / Context"
        value={sampleContext}
        onChange={setSampleContext}
        placeholder="e.g. An excited creator sharing a product they love with a friend."
      />

      <button
        type="submit"
        disabled={saving}
        className="mt-1 flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {saving ? 'Saving…' : (item ? 'Save Changes' : 'Add Voice Preset')}
      </button>
    </form>
  )
}

function TextAreaField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      {/* Bare, under the cards — the two extras, same as the Voiceovers panel.
          A neutral dot, because these are the only optional inputs here. */}
      <SectionLabel
        label={label}
        filled={!!value.trim()}
        right={<span className="text-[10px] tracking-tight text-ink-600">optional</span>}
      />
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder={placeholder}
        className="resize-none rounded-2xl border border-ink/10 bg-transparent px-3 py-2 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <SectionLabel label={label} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-full border border-ink/10 bg-surface-1 px-2.5 py-2 text-sm text-ink-200 outline-none focus:border-ink/20"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}
