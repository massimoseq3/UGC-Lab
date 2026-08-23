import { useState } from 'react'
import { ChevronRight, UserRound } from 'lucide-react'
import type { CharacterProfile } from '../types'
import { createEmptyProfile } from '../types'
import PresetPickerModal from './PresetPickerModal'

interface LoadPresetDropdownProps {
  onLoadProfile: (profile: CharacterProfile) => void
}

// Trigger row for the preset browser. (File name kept from the dropdown era so
// call sites stay stable; the picker itself is `PresetPickerModal`.)
export default function LoadPresetDropdown({ onLoadProfile }: LoadPresetDropdownProps) {
  const [open, setOpen] = useState(false)

  // Full apply — replace the whole form with the picked recipe.
  const apply = (incoming: Record<string, string>) => {
    const next = createEmptyProfile()
    for (const [key, value] of Object.entries(incoming)) {
      if (key in next && typeof value === 'string') next[key] = value
    }
    onLoadProfile(next)
  }

  return (
    <>
      {/* "Character" is doing the work the word "Full" used to: the scoped
          pickers further down the column ("Physical Presets" / "Scene & Pose
          Presets") load one tab's fields from the same saved recipes, so this
          one has to read as the whole-character load. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Load every field from a saved preset — physical, scene and pose"
        className="flex w-full items-center gap-2.5 rounded-full border border-dashed border-ink/10 bg-ink/[0.02] px-3 py-2 text-left transition-colors hover:bg-ink/[0.05]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-influencers-500/10 text-influencers-400">
          <UserRound className="h-4 w-4" strokeWidth={1.5} />
        </span>
        {/* 13px — the B-Roll reference-row title size, so a picker row reads
            the same weight in every app. No hint line: the title says it. */}
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-300">Load Character Preset</div>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" strokeWidth={2} />
      </button>

      <PresetPickerModal open={open} onClose={() => setOpen(false)} onPick={apply} />
    </>
  )
}
