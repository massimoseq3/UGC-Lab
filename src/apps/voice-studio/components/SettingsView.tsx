import { Bookmark, ChevronRight, Mic, RotateCcw, X, SlidersHorizontal } from 'lucide-react'
import type { VoiceSettings } from '../types'
import { DEFAULT_VOICE_SETTINGS, getVoiceById, VOICE_STYLES, VOICE_PACES, VOICE_ACCENTS } from '../types'
import { seedColor } from './seedColor'
import Slider from './Slider'
import Dropdown from '../../../components/Dropdown'
import SectionCard, { StatusDot } from '../../../components/SectionCard'

// One size for every setting subheading (Style / Pace / Accent /
// Expressiveness / Tone / Scene). Influencers' small-caps field register: the
// settings now sit inside titled section cards, and a 13px sentence-case label
// under a 13px card title reads as two competing headings. Slider carries the
// same class on its own label — keep the two in step.
const SETTING_LABEL = 'text-[11px] font-medium uppercase tracking-widest text-ink-300'

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

  // DEFAULT_VOICE_SETTINGS carries explicit `undefined` preset fields, so a
  // reset also drops a loaded preset's stamp — the settings are no longer that
  // preset.
  const handleReset = () => {
    onSettingsChange({ ...settings, ...DEFAULT_VOICE_SETTINGS })
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 px-5 pb-6 pt-2">
        {/* Who is speaking. The card holds one control on purpose — the header
            is what carries the preset pill, and a preset writes every setting
            in this panel, so it needs a home above the first of them rather
            than a row of its own competing with the voice. No dots: the voice
            always holds a value, and a lone permanent green dot is decoration
            that teaches you to stop reading them. */}
        <SectionCard
          icon={Mic}
          title="Voice"
          left={
            /* Preset — Influencers' `PresetPillButton` shape, on the header of
               the card whose contents it fills, rather than the full-width row
               it used to be under the voice. Same reasoning as that panel's:
               a preset isn't a setting of its own, it's a shortcut that writes
               the settings below, so it belongs on the group's header beside
               the name of what it loads. It also stops the card reading as two
               equally-weighted picker rows when only one of them picks the
               voice. On the LEFT gutter: it's the shortcut you take before
               picking a voice by hand, so it sits ahead of the title rather
               than after it — and it mirrors Delivery's Reset, which is a
               header action of the other kind and keeps the right. */
            <PresetPill
              label={settings.presetLabel}
              onOpen={onOpenPresetPicker}
              onClear={() => onSettingsChange({ ...settings, presetId: undefined, presetLabel: undefined })}
            />
          }
        >
          {/* Voice — clickable, slides into picker. Its name is the row itself,
              so the small-caps label above it is gone with the card title. */}
          <button
            onClick={onOpenVoicePicker}
            className="flex w-full items-center gap-3 rounded-full border border-voice-500/25 bg-voice-500/[0.06] px-3.5 py-2.5 text-left transition-colors hover:bg-voice-500/10"
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
        </SectionCard>

        {/* How it's said. Reset rides on this card's header rather than at the
            foot of the whole column, where it sat a long scroll away from the
            controls it restores and read as a panel-level action. */}
        <SectionCard
          icon={SlidersHorizontal}
          title="Delivery"
          contentClassName="flex flex-col gap-3"
          right={
            /* Toned like the shared ClearAllButton ("New") so the two read as
               the same class of affordance; not that component, since this
               restores defaults rather than clearing inputs and stays a single
               click. */
            <button
              type="button"
              onClick={handleReset}
              title="Restore the delivery settings to their defaults"
              className="flex items-center gap-1 rounded-full bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-300"
            >
              <RotateCcw className="h-2.5 w-2.5" strokeWidth={2.5} />
              Reset
            </button>
          }
        >
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
          <div className="pt-1">
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
        </SectionCard>

        {/* Optional direction — overall tone + scene. Deliberately NOT carded:
            they're the two extras at the end, and leaving them bare under the
            cards is what says so. They're also the only settings in this panel
            that are ever actually empty, so they're the only ones carrying a
            status dot. */}
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
      </div>
    </div>
  )
}

// Saved-preset pill, on the Voice card's header. Influencers' `PresetPillButton`
// shape — dashed accent ring, glyph, chevron — so the two panels' preset
// affordances read as the same control. Once a preset is loaded it fills in and
// names it, with an X to detach; clearing drops the stamp only, because the
// values it loaded are the settings the member is about to generate with.
//
// The label is capped and truncates: this sits in one gutter of the card
// header's 3-column grid, and a long bank name would otherwise squeeze the
// word it's sitting next to.
function PresetPill({
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
        title="Load a saved voice preset from the bank"
        className="flex min-w-0 items-center gap-1 rounded-full border border-dashed border-voice-500/30 bg-voice-500/10 px-2.5 py-1 text-[12px] font-medium text-voice-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:bg-voice-500/15"
      >
        <Bookmark className="h-3 w-3 shrink-0" />
        Presets
        <ChevronRight className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      </button>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-1 rounded-full border border-voice-500/30 bg-voice-500/15 py-1 pl-2.5 pr-1 text-[12px] font-medium text-voice-300">
      <button
        type="button"
        onClick={onOpen}
        title={`Preset: ${label} — click to load a different one`}
        className="flex min-w-0 items-center gap-1 transition-colors hover:text-voice-200"
      >
        <Bookmark className="h-3 w-3 shrink-0" />
        <span className="max-w-[110px] truncate">{label}</span>
      </button>
      <button
        type="button"
        onClick={onClear}
        title="Detach preset — the settings it loaded stay as they are"
        aria-label="Detach preset"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-voice-300/70 transition-colors hover:bg-ink/10 hover:text-red-400 light:hover:text-red-600"
      >
        <X className="h-3 w-3" />
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
      <span className="flex items-center gap-1.5">
        {/* Never `required` — nothing is waiting on either of these, so an
            empty one is neutral. Red is reserved for an input that's actually
            holding a Generate button shut. */}
        <StatusDot filled={value.trim() !== ''} />
        <span className={SETTING_LABEL}>{label}</span>
        <span className="ml-0.5 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">optional</span>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className={SETTING_LABEL}>{label}</span>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}
