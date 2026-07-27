import { ChevronRight, Mic, X } from 'lucide-react'
import type { VoiceSettings } from '../types'
import { DIRECTION_PRESETS, getVoiceById, VOICE_STYLES, VOICE_PACES, VOICE_ACCENTS } from '../types'
import { seedColor } from './seedColor'
import Slider from './Slider'
import Dropdown from './Dropdown'

// One size for every setting subheading (Voice / Style / Pace / Accent /
// Expressiveness / Tone / Scene). 12px sits a step under the 13px value text
// it labels, so the column reads as a stack of controls rather than headings.
// Slider carries the same class on its own label — keep the two in step.
const SETTING_LABEL = 'text-xs font-medium text-ink-200'

interface SettingsViewProps {
  settings: VoiceSettings
  onSettingsChange: (next: VoiceSettings) => void
  onOpenVoicePicker: () => void
  onOpenPresetPicker: () => void
}

export default function SettingsView({ settings, onSettingsChange, onOpenVoicePicker, onOpenPresetPicker }: SettingsViewProps) {
  const voice = getVoiceById(settings.voiceId)

  // Every hand edit drops the preset stamp — once a control moves, the settings
  // are no longer that preset, and the row must not keep claiming they are.
  const update = (patch: Partial<VoiceSettings>) =>
    onSettingsChange({ ...settings, ...patch, presetId: undefined, presetLabel: undefined })

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 px-5 pb-6 pt-2">
        {/* Preset — loads a saved voice from the bank in one click (voice,
            delivery params, scene and tone all together). Pinned over the
            scroll (the Characters controls pattern): an opaque backdrop
            stretched across the column's padding by -mx-5/px-5, plus a
            feathered gradient below it so the fields dissolve underneath
            instead of clipping against a hard edge. */}
        <div className="sticky top-0 z-10 -mx-5 bg-surface-0 px-5 pt-2">
          <PresetRow
            label={settings.presetLabel}
            onOpen={onOpenPresetPicker}
            onClear={() => onSettingsChange({ ...settings, presetId: undefined, presetLabel: undefined })}
          />
          <div className="pointer-events-none absolute inset-x-0 top-full h-5 bg-gradient-to-b from-surface-0 to-transparent" />
        </div>

        {/* Voice — clickable, slides into picker */}
        <div>
          <span className={SETTING_LABEL}>Voice</span>
          <button
            onClick={onOpenVoicePicker}
            className="mt-1.5 flex w-full items-center gap-3 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 py-2.5 text-left transition-colors hover:bg-ink/[0.06]"
          >
            <span
              className="h-8 w-8 shrink-0 rounded-full"
              style={{ background: voice ? seedColor(voice.id) : 'linear-gradient(135deg, #4f46e5, #6366f1)' }}
            />
            <div className="min-w-0 flex-1">
              {/* 13px: the same trigger text B-Roll's reference cards use, so
                  a picked voice reads at the weight a picker row does app-wide. */}
              <div className="truncate text-[13px] font-medium text-ink-100">{settings.voiceName}</div>
              {voice?.description && (
                <div className="truncate text-[11px] text-ink-400">{voice.description}</div>
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

        {/* Optional direction — overall tone + scene (always visible) */}
        <DirectionBox
          label="Tone / Context"
          value={settings.sampleContext}
          placeholder="e.g. An excited creator sharing a product they love with a friend."
          onChange={(sampleContext) => update({ sampleContext })}
        />
        <DirectionBox
          label="Scene"
          value={settings.scene}
          placeholder="e.g. A bright, upbeat product demo in a sunny kitchen."
          onChange={(scene) => update({ scene })}
        />

        {/* One-tap direction presets — fill both boxes above. Tapping the
            active chip clears them again. */}
        <DirectionChips
          scene={settings.scene}
          sampleContext={settings.sampleContext}
          onApply={(scene, sampleContext) => update({ scene, sampleContext })}
        />
      </div>
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
          <Mic className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-ink-200">Preset</div>
          <div className="truncate text-[11px] text-ink-400">Load a saved voice from the bank</div>
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
        <Mic className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink-100">{label}</div>
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
        <span className={SETTING_LABEL}>{label}</span>
        <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">optional</span>
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
      <span className={SETTING_LABEL}>{label}</span>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}
