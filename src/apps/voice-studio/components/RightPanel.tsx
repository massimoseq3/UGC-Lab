import { useState } from 'react'
import type { VoiceSettings } from '../types'
import { settingsFromPreset } from '../types'
import type { VoiceHistoryItem, VoicePreset } from '../../../stores/types'
import SettingsView from './SettingsView'
import VoicePickerView from './VoicePickerView'
import PresetPickerView from './PresetPickerView'
import HistoryView, { type PendingVoice } from './HistoryView'
import HistoryDetailsView from './HistoryDetailsView'
import SegmentedToggle from '../../../components/SegmentedToggle'

type Tab = 'settings' | 'history'

interface RightPanelProps {
  settings: VoiceSettings
  onSettingsChange: (next: VoiceSettings) => void
  history: VoiceHistoryItem[]
  // Voiceovers still rendering — shown as pending rows at the top of History so
  // a queued batch is visible while it works.
  pending: PendingVoice[]
  activeHistoryId: string | null
  detailsItem: VoiceHistoryItem | null
  onSelectHistory: (item: VoiceHistoryItem) => void
  onDeleteHistory: (id: string) => void
  onShowDetails: (item: VoiceHistoryItem) => void
  onCloseDetails: () => void
  onRestoreText: (text: string) => void
  onRestoreSettings: (settings: Partial<VoiceSettings>) => void
}

export default function RightPanel({
  settings,
  onSettingsChange,
  history,
  pending,
  activeHistoryId,
  detailsItem,
  onSelectHistory,
  onDeleteHistory,
  onShowDetails,
  onCloseDetails,
  onRestoreText,
  onRestoreSettings,
}: RightPanelProps) {
  const [tab, setTab] = useState<Tab>('settings')
  const [voicePickerOpen, setVoicePickerOpen] = useState(false)
  const [presetPickerOpen, setPresetPickerOpen] = useState(false)

  const openPicker = () => setVoicePickerOpen(true)
  const closePicker = () => setVoicePickerOpen(false)

  // When details opens (e.g. from BottomPlayer), make sure we're on the History
  // tab. Done during render (prop-change sync), not in an effect.
  const [prevDetails, setPrevDetails] = useState(detailsItem)
  if (detailsItem !== prevDetails) {
    setPrevDetails(detailsItem)
    if (detailsItem) setTab('history')
  }

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
    closePicker()
  }

  const handleSelectPreset = (preset: VoicePreset) => {
    onSettingsChange(settingsFromPreset(preset))
    setPresetPickerOpen(false)
  }

  const handleShowDetails = (item: VoiceHistoryItem) => {
    onShowDetails(item)
  }

  const handleCloseDetails = () => {
    onCloseDetails()
  }

  // Tabs are hidden when a slide-over view (picker, details) owns the chrome.
  const showTabs = !voicePickerOpen && !presetPickerOpen && !detailsItem

  return (
    <div className="flex h-full flex-col">
      {showTabs && (
        <div className="flex h-[57px] items-center border-b border-ink/5 px-5">
          <SegmentedToggle<Tab>
            className="h-10 !p-1"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'settings', label: 'Settings' },
              { value: 'history', label: 'History', badge: history.length + pending.length > 0 ? history.length + pending.length : undefined },
            ]}
          />
        </div>
      )}

      {/* Body — base layer switches between Settings and History instantly.
          Slide-in overlays (picker, details) ride on top via AnimatePresence. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tab === 'settings' ? (
          <SettingsView
            settings={settings}
            onSettingsChange={onSettingsChange}
            onOpenVoicePicker={openPicker}
            onOpenPresetPicker={() => setPresetPickerOpen(true)}
          />
        ) : (
          <HistoryView
            items={history}
            pending={pending}
            activeId={activeHistoryId}
            onSelect={onSelectHistory}
            onDelete={onDeleteHistory}
            onShowDetails={handleShowDetails}
          />
        )}

        {voicePickerOpen && (
          <div className="absolute inset-0 bg-surface-1">
            <VoicePickerView
              selectedId={settings.voiceId}
              onSelect={handleSelectVoice}
              onClose={closePicker}
            />
          </div>
        )}
        {presetPickerOpen && (
          <div className="absolute inset-0 bg-surface-1">
            <PresetPickerView
              selectedId={settings.presetId}
              onSelect={handleSelectPreset}
              onClose={() => setPresetPickerOpen(false)}
            />
          </div>
        )}
        {detailsItem && (
          <div className="absolute inset-0 bg-surface-1">
            <HistoryDetailsView
              item={detailsItem}
              onClose={handleCloseDetails}
              onRestoreText={onRestoreText}
              onRestoreSettings={onRestoreSettings}
            />
          </div>
        )}
      </div>
    </div>
  )
}
