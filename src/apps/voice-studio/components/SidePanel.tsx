import { useState } from 'react'
import type { VoiceSettings } from '../types'
import { settingsFromPreset } from '../types'
import type { VoicePreset } from '../../../stores/types'
import SettingsView from './SettingsView'
import VoicePickerView from './VoicePickerView'
import PresetPickerView from './PresetPickerView'
import PickerModal from './PickerModal'
import GenerateBar from './GenerateBar'

interface SidePanelProps {
  settings: VoiceSettings
  onSettingsChange: (next: VoiceSettings) => void
  // Generate lives at the foot of this column now — see GenerateBar. The
  // script itself is edited in the other pane; only its length matters here.
  scriptText: string
  onGenerate: () => void
  batchCount: number
  onBatchCountChange: (value: number) => void
  isGenerating: boolean
  error?: string | null
}

/**
 * The settings column, and only settings.
 *
 * It carried a Settings / History `SegmentedToggle` across its top until
 * September 2026 (Massimo's call). History moved to the other pane, where it
 * shares a toggle with the Script — an output belongs beside the other output
 * surface, not stacked behind the controls that produce it — and this column
 * gained the room for Generate at its foot.
 *
 * Both pickers are centred modals now rather than views that take over this
 * column: a takeover would cover the Generate button that lives here.
 */
export default function SidePanel({
  settings,
  onSettingsChange,
  scriptText,
  onGenerate,
  batchCount,
  onBatchCountChange,
  isGenerating,
  error,
}: SidePanelProps) {
  const [voicePickerOpen, setVoicePickerOpen] = useState(false)
  const [presetPickerOpen, setPresetPickerOpen] = useState(false)

  const handleSelectVoice = (voice: { id: string; name: string; gender?: 'Female' | 'Male' }) => {
    onSettingsChange({
      ...settings,
      voiceId: voice.id,
      voiceName: voice.name,
      gender: voice.gender,
      // Picking a different voice by hand means these settings are no longer
      // the loaded preset — drop its stamp (same rule as every other control).
      presetId: undefined,
      presetLabel: undefined,
    })
    setVoicePickerOpen(false)
  }

  const handleSelectPreset = (preset: VoicePreset) => {
    onSettingsChange(settingsFromPreset(preset))
    setPresetPickerOpen(false)
  }

  return (
    <div className="flex h-full flex-col">
      {/* No header band, deliberately (September 2026, Massimo's call). Both
          panes of a two-pane app normally carry a 57px header so the hairlines
          align — this app is the exception, because once History moved across
          there was nothing left for this one to hold but the word "Voice", and
          a bar spending 57px to say what the dock tile, the pane tab and every
          control under it already say is worse than an unmatched hairline.
          The settings start at the top of the column instead. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <SettingsView
          settings={settings}
          onSettingsChange={onSettingsChange}
          onOpenVoicePicker={() => setVoicePickerOpen(true)}
          onOpenPresetPicker={() => setPresetPickerOpen(true)}
        />
      </div>

      <GenerateBar
        scriptText={scriptText}
        onGenerate={onGenerate}
        batchCount={batchCount}
        onBatchCountChange={onBatchCountChange}
        isGenerating={isGenerating}
        error={error}
      />

      <PickerModal
        open={voicePickerOpen}
        title="Select a voice"
        subtitle="Click a voice to hear a sample"
        onClose={() => setVoicePickerOpen(false)}
      >
        <VoicePickerView selectedId={settings.voiceId} onSelect={handleSelectVoice} />
      </PickerModal>

      <PickerModal
        open={presetPickerOpen}
        title="Select a preset"
        subtitle="Loads the voice, delivery, scene and tone"
        onClose={() => setPresetPickerOpen(false)}
      >
        <PresetPickerView selectedId={settings.presetId} onSelect={handleSelectPreset} />
      </PickerModal>
    </div>
  )
}
