import { useState } from 'react'
import { ChevronRight, RotateCcw, Bookmark, X } from 'lucide-react'
import type { VoiceSettings } from '../types'
import { DEFAULT_VOICE_SETTINGS, DIRECTION_PRESETS, getVoiceById, settingsFromPreset, VOICE_STYLES, VOICE_PACES, VOICE_ACCENTS } from '../types'
import type { VoicePreset } from '../../../stores/types'
import BankPicker from '../../../components/BankPicker'
import { seedColor } from './seedColor'
import Slider from './Slider'
import Dropdown from './Dropdown'

interface SettingsViewProps {
  settings: VoiceSettings
  onSettingsChange: (next: VoiceSettings) => void
  onOpenVoicePicker: () => void
}

export default function SettingsView({ settings, onSettingsChange, onOpenVoicePicker }: SettingsViewProps) {
  const voice = getVoiceById(settings.voiceId)
  const [presetPickerOpen, setPresetPickerOpen] = useState(false)

  // Every hand edit drops the preset stamp — once a control moves, the settings
  // are no longer that preset, and the row must not keep claiming they are.
  const update = (patch: Partial<VoiceSettings>) =>
    onSettingsChange({ ...settings, ...patch, presetId: undefined, presetLabel: undefined })

  const handleReset = () => {
    onSettingsChange({ ...settings, ...DEFAULT_VOICE_SETTINGS })
  }

  const handleSelectPreset = (item: unknown) => {
    onSettingsChange(settingsFromPreset(item as VoicePreset))
    setPresetPickerOpen(false)
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 px-5 pb-6 pt-2">
        {/* Preset — loads a saved voice from the bank in one click (voice,
            delivery params, scene and tone all together). */}
        <PresetRow
          label={settings.presetLabel}
          onOpen={() => setPresetPickerOpen(true)}
          onClear={() => onSettingsChange({ ...settings, presetId: undefined, presetLabel: undefined })}
        />

        {/* Voice — clickable, slides into picker */}
        <div>
          <span className="text-sm font-medium text-ink-200">Voice</span>
          <button
            onClick={onOpenVoicePicker}
            className="mt-1.5 flex w-full items-center gap-3 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-2.5 text-left transition-colors hover:bg-ink/[0.06]"
          >
            <span
              className="h-8 w-8 shrink-0 rounded-full"
              style={{ background: voice ? seedColor(voice.id) : 'linear-gradient(135deg, #4f46e5, #6366f1)' }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink-100">{settings.voiceName}</div>
              {voice?.description && (
                <div className="truncate text-xs text-ink-400">{voice.description}</div>
              )}
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
          </button>
        </div>

        {/* Style — full width */}
        <Field label="Style">
          <Dropdown value={settings.style} options={VOICE_STYLES} onChange={(style) => update({ style })} />
        </Field>

        {/* Pace + Accent — side by side to save vertical space */}
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Pace">
            <Dropdown compact value={settings.pace} options={VOICE_PACES} onChange={(pace) => update({ pace })} />
          </Field>
          <Field label="Accent">
            <Dropdown compact value={settings.accent} options={VOICE_ACCENTS} onChange={(accent) => update({ accent })} />
          </Field>
        </div>

        {/* Expressiveness (temperature) — extra top space so it doesn't crowd
            the dropdowns above. */}
        <div className="pt-2">
          <Slider
            label="Expressiveness"
            tooltip="Controls how much the delivery varies. Lower values are more predictable and consistent between re-generations; higher values are more creative and expressive but less repeatable."
            value={settings.temperature}
            min={0}
            max={2}
            step={0.05}
            leftHint="Focused"
            rightHint="Creative"
            onChange={(temperature) => update({ temperature })}
            format={(v) => v.toFixed(2)}
          />
        </div>

        {/* Optional direction — scene + overall tone (always visible) */}
        <DirectionBox
          label="Scene"
          value={settings.scene}
          placeholder="e.g. A bright, upbeat product demo in a sunny kitchen."
          onChange={(scene) => update({ scene })}
        />
        <DirectionBox
          label="Tone / context"
          value={settings.sampleContext}
          placeholder="e.g. An excited creator sharing a product they love with a friend."
          onChange={(sampleContext) => update({ sampleContext })}
        />

        {/* One-tap direction presets — fill both boxes above. Tapping the
            active chip clears them again. */}
        <DirectionChips
          scene={settings.scene}
          sampleContext={settings.sampleContext}
          onApply={(scene, sampleContext) => update({ scene, sampleContext })}
        />

        {/* Reset */}
        <div className="mt-1">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-ink-400 transition-colors hover:text-ink-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset values
          </button>
        </div>
      </div>

      <BankPicker
        bankType="voices"
        isOpen={presetPickerOpen}
        onSelect={handleSelectPreset}
        onClose={() => setPresetPickerOpen(false)}
      />
    </div>
  )
}

// Saved-preset row. Dashed and muted until a preset is loaded, then tinted with
// the app accent + an X. Clearing drops the stamp only — the values it loaded
// stay put, because they're the settings the user is about to generate with.
function PresetRow({
  label,
  onOpen,
  onClear,
}: {
  label?: string
  onOpen: () => void
  onClear: () => void
}) {
  if (!label) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-center gap-3 rounded-full border border-dashed border-ink/10 bg-ink/[0.015] px-3.5 py-2.5 text-left transition-colors hover:border-ink/20 hover:bg-ink/[0.03]"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-voice-500/10 text-voice-300/80 transition-colors group-hover:bg-voice-500/15 group-hover:text-voice-300">
          <Bookmark className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink-200">Preset</div>
          <div className="truncate text-xs text-ink-400">Load a saved voice from the bank</div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
      </button>
    )
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      className="flex w-full cursor-pointer items-center gap-3 rounded-full border border-voice-500/25 bg-voice-500/[0.06] px-3.5 py-2.5 text-left transition-colors hover:bg-voice-500/10"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-voice-500/15 text-voice-300">
        <Bookmark className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink-100">{label}</div>
        <div className="truncate text-[11px] text-ink-500">Preset</div>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClear() }}
        title="Detach preset — the settings it loaded stay as they are"
        aria-label="Detach preset"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-red-400 light:hover:text-red-600"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// One optional direction box. "optional" rides beside the label as a small
// pill rather than inline text, so the label itself stays the loudest thing.
function DirectionBox({
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
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium text-ink-200">{label}</span>
        <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium text-ink-500">optional</span>
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder={placeholder}
        className="resize-none rounded-2xl border border-ink/10 bg-ink/[0.03] px-3.5 py-2.5 text-sm text-ink-100 placeholder-ink-600 outline-none transition-colors focus:border-voice-500/40"
      />
    </div>
  )
}

// Tap-to-fill direction presets. A chip reads as active only when BOTH boxes
// still match it exactly — edit either one by hand and the chip lets go, so it
// can never claim direction the settings no longer hold.
function DirectionChips({
  scene,
  sampleContext,
  onApply,
}: {
  scene: string
  sampleContext: string
  onApply: (scene: string, sampleContext: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DIRECTION_PRESETS.map((p) => {
        const active = scene === p.scene && sampleContext === p.sampleContext
        return (
          <button
            key={p.id}
            type="button"
            // Tapping the active chip clears both boxes — the same click undoes it.
            onClick={() => (active ? onApply('', '') : onApply(p.scene, p.sampleContext))}
            title={p.sampleContext}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              active
                ? 'border-voice-500/40 bg-voice-500/15 text-voice-300'
                : 'border-ink/10 bg-ink/[0.03] text-ink-400 hover:bg-ink/[0.06] hover:text-ink-200'
            }`}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-sm font-medium text-ink-200">{label}</span>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}
