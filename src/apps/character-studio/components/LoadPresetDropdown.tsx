import { useMemo, useState } from 'react'
import { ChevronRight, ChevronDown, UserRound, Sparkles } from 'lucide-react'
import type { CharacterProfile } from '../types'
import { sortByOrder, starredFirst, SORT_OPTIONS_WITH_NAME, type SortOrder } from '../../finder/bankSort'
import { usePersistedState } from '../../../hooks/usePersistedState'
import {
  createEmptyProfile,
  PRESET_MARIE,
  PRESET_ZANE,
  PRESET_YUKI,
  PRESET_AMARA,
  PRESET_DEV,
  PRESET_SOFIA,
  PRESET_HIROSHI,
  PRESET_TENZIN,
  PRESET_ELEANOR,
} from '../types'
import type { Model } from '../../../stores/types'
import { useBankStore } from '../../../stores/bankStore'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import SlideOver from '../../../components/SlideOver'
// Bundled preview portraits for the built-in presets — Vite resolves each to a
// hashed URL. Pre-optimised thumbnails (~640px JPEG) so the card grid stays light.
import marieImg from '../assets/presets/marie.jpg'
import zaneImg from '../assets/presets/zane.jpg'
import yukiImg from '../assets/presets/yuki.jpg'
import amaraImg from '../assets/presets/amara.jpg'
import devImg from '../assets/presets/dev.jpg'
import sofiaImg from '../assets/presets/sofia.jpg'
import hiroshiImg from '../assets/presets/hiroshi.jpg'
import tenzinImg from '../assets/presets/tenzin.jpg'
import eleanorImg from '../assets/presets/eleanor.jpg'

// Built-in presets shown alongside the user's saved bank entries.
const BUILTIN_PRESETS: Array<{ id: string; name: string; profile: CharacterProfile; image: string }> = [
  { id: 'builtin-marie', name: 'Marie', profile: PRESET_MARIE, image: marieImg },
  { id: 'builtin-zane', name: 'Zane', profile: PRESET_ZANE, image: zaneImg },
  { id: 'builtin-yuki', name: 'Yuki', profile: PRESET_YUKI, image: yukiImg },
  { id: 'builtin-amara', name: 'Amara', profile: PRESET_AMARA, image: amaraImg },
  { id: 'builtin-dev', name: 'Dev', profile: PRESET_DEV, image: devImg },
  { id: 'builtin-sofia', name: 'Sofia', profile: PRESET_SOFIA, image: sofiaImg },
  { id: 'builtin-hiroshi', name: 'Hiroshi', profile: PRESET_HIROSHI, image: hiroshiImg },
  { id: 'builtin-tenzin', name: 'Tenzin', profile: PRESET_TENZIN, image: tenzinImg },
  { id: 'builtin-eleanor', name: 'Eleanor', profile: PRESET_ELEANOR, image: eleanorImg },
]

// Small influencer card — mirrors the Bank's portrait cards (9:16 image with
// a name overlay) but at a compact size so a few fit per row in the slide-over.
function PresetCard({ imageRef, imageUrl, name, onClick }: { imageRef?: string; imageUrl?: string; name: string; onClick: () => void }) {
  // Built-in presets pass a bundled imageUrl directly; bank entries pass an
  // asset:// ref resolved through IndexedDB. Prefer the direct URL when present.
  const assetUrl = useAssetUrl(imageRef)
  const url = imageUrl ?? assetUrl
  return (
    <button
      onClick={onClick}
      className="group relative block aspect-[9/16] w-full overflow-hidden rounded-xl border border-ink/5 bg-ink/[0.03] transition-all hover:border-ink/15 hover:-translate-y-px"
    >
      {url ? (
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/[0.04]">
          <Sparkles className="h-6 w-6 text-ink-700" strokeWidth={1.5} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2 pt-6">
        <span className="block truncate text-[11px] font-semibold tracking-tight text-zinc-100">{name}</span>
      </div>
    </button>
  )
}

function flattenJsonProfile(json: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof json !== 'object' || json === null) return out
  for (const section of Object.values(json as Record<string, unknown>)) {
    if (typeof section === 'object' && section !== null) {
      for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
        if (typeof value === 'string') out[key] = value
      }
    }
  }
  return out
}

// Shared right slide-over listing the built-in starters + the user's saved
// bank recipes. Calls `onPick` with the chosen recipe as a flat profile map,
// then closes. Callers decide what to do with that map: apply it wholesale
// (LoadPresetDropdown) or merge only a subset of keys (the scoped Physical /
// Scene & Pose preset buttons in ControlsPanel).
export function PresetPickerSlideOver({
  open,
  onClose,
  onPick,
  title = 'Character Presets',
  subtitle = 'Pick a recipe to fill the form',
}: {
  open: boolean
  onClose: () => void
  onPick: (profile: Record<string, string>) => void
  title?: string
  subtitle?: string
}) {
  const bankModels = useBankStore((s) => s.models)

  // Bank recipes were rendering in raw insertion order, so the newest character
  // you saved was buried at the bottom. Same control and helpers as the bank
  // pickers, and persisted so the choice sticks between opens. Starters are
  // built-in and stay in their authored order.
  const [sort, setSort] = usePersistedState<SortOrder>('character-studio:presetSort', 'newest')
  const bankPresets = useMemo(() => {
    const withProfile = bankModels.filter((m) => m.jsonProfile)
    return starredFirst(sortByOrder(withProfile, sort, (m) => m.name))
  }, [bankModels, sort])

  const pick = (incoming: CharacterProfile | Record<string, string>) => {
    onPick(incoming)
    onClose()
  }

  return (
    <SlideOver open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="p-3">
        <div className="px-1 pb-2 pt-0.5 text-[9px] font-semibold uppercase tracking-widest text-ink-500">
          Starters
        </div>
        <div className="grid grid-cols-3 gap-2">
          {BUILTIN_PRESETS.map((p) => (
            <PresetCard key={p.id} name={p.name} imageUrl={p.image} onClick={() => pick(p.profile)} />
          ))}
        </div>
        {bankPresets.length > 0 && (
          <>
            <div className="mx-1 mt-4 border-t border-ink/10" />
            {/* Bank header + sort. The label keeps the Starters eyebrow style;
                the select mirrors the bank pickers' own sort control. */}
            <div className="flex items-center justify-between gap-2 px-1 pb-2 pt-3">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-ink-500">Bank</span>
              <div className="relative shrink-0">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortOrder)}
                  className="h-7 appearance-none rounded-full border border-ink/10 bg-surface-1 pl-2.5 pr-7 text-[11px] text-ink-300 outline-none transition-colors hover:border-ink/20 focus:border-ink/20"
                >
                  {SORT_OPTIONS_WITH_NAME.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-500" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {bankPresets.map((m: Model) => (
                <PresetCard
                  key={m.id}
                  imageRef={m.characterImage}
                  name={m.name}
                  onClick={() => m.jsonProfile && pick(flattenJsonProfile(m.jsonProfile))}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </SlideOver>
  )
}

interface LoadPresetDropdownProps {
  onLoadProfile: (profile: CharacterProfile) => void
}

// Trigger card + right slide-over for loading a saved influencer recipe.
// (File name kept from the dropdown era so call sites stay stable.)
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
      {/* "Full" is doing real work here: the scoped pickers further down the
          column ("Physical Presets" / "Scene & Pose Presets") load one tab's
          fields from the same saved recipes. Without it the two entry points
          read as the same control in two places. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Load every field from a saved preset — physical, scene and pose"
        className="flex h-12 w-full items-center gap-3 rounded-full border border-dashed border-ink/10 bg-ink/[0.02] px-4 text-left transition-colors hover:bg-ink/[0.05]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-influencers-500/10 text-influencers-400">
          <UserRound className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink-100">Load Full Preset</div>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" strokeWidth={2} />
      </button>

      <PresetPickerSlideOver open={open} onClose={() => setOpen(false)} onPick={apply} />
    </>
  )
}
