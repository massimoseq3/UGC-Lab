import { useState, useRef, useEffect, type ElementType, type ReactNode } from 'react'
import { ScanFace, PersonStanding, Camera, Copy, Check, ChevronRight } from 'lucide-react'
import type { TabId, CharacterProfile } from '../types'
import { TABS, PHOTOREALISM_STYLE, getTabFields } from '../types'

// Per-tab glyphs — specific to each tab's job (appearance / pose / lens),
// not a generic decoration. Keyed by the stable tab id.
const TAB_ICONS: Record<TabId, ElementType> = {
  physical: ScanFace,
  scene: PersonStanding,
  camera: Camera,
}
import type { ImageResolution } from '../../../utils/models'
import ChipField from './ChipField'
import GenerateBar from './GenerateBar'
import SegmentedToggle from '../../../components/SegmentedToggle'
import ClearAllButton from '../../../components/ClearAllButton'
import LoadPresetDropdown, { PresetPickerSlideOver } from './LoadPresetDropdown'
import PhotoExtractZone from './PhotoExtractZone'
import { buildPhysicalPrompt, buildScenePrompt } from '../services/generateCharacter'
import { copyToClipboard } from '../../../utils/clipboard'

// Field keys owned by each tab, derived from the tab config so the scoped
// preset pickers stay in sync with the form. Physical = identity/physical/
// wardrobe; Scene = scene/pose/camera.
const PHYSICAL_KEYS = getTabFields(TABS[0]).map((f) => f.key)
const SCENE_KEYS = getTabFields(TABS[1]).map((f) => f.key)

// A centered pill marking each tab's block. The `center` node (the scoped
// preset button) stands in for the old static label pill — it carries the tab's
// glyph + name and doubles as the preset action. `left` / `right` slots host
// optional actions (Clear / Copy), pinned to the row's edges.
function TabDivider({ center, left, right }: { center: ReactNode; left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="relative flex items-center justify-center">
      {left && <div className="absolute left-0">{left}</div>}
      {center}
      {right && <div className="absolute right-0">{right}</div>}
    </div>
  )
}

// Copies a scoped slice of the assembled prompt (physical, or scene & pose) to
// the clipboard. One sits on the right of each tab divider.
function CopyPromptButton({ text, label, title }: { text: string; label: string; title: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    if (await copyToClipboard(text)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!text.trim()}
      title={title}
      className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.02] px-2.5 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:border-ink/20 hover:bg-ink/[0.05] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400 light:text-emerald-600" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : label}
    </button>
  )
}

// Preset pill — opens the shared preset picker but scoped to one tab's fields.
// Matches the Portrait/Sheet toggle's glassy influencers tint (translucent fill
// + soft accent ring + faint sheen) so the two read as one accent family, with
// the tab's own glyph leading and a chevron hinting the slide-over.
function PresetPillButton({ label, title, icon: Icon, onClick }: { label: string; title: string; icon: ElementType; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 rounded-full border border-dashed border-influencers-500/30 bg-influencers-500/10 px-3 py-1 text-[12px] font-medium text-influencers-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:bg-influencers-500/15"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  )
}


interface ControlsPanelProps {
  profile: CharacterProfile
  onProfileChange: (profile: CharacterProfile) => void
  activeTab: TabId
  onActiveTabChange: (tab: TabId) => void
  isExtracting: boolean
  extractError: string | null
  extractedThumb: string | null
  onPhotoDrop: (file: File) => void
  onResetExtract: () => void
  // "New" — resets the form + extracted reference photo to a blank slate.
  onClear: () => void
  // Generate bar (lives at the foot of this column).
  error: string | null
  onGenerate: () => void
  canGenerate: boolean
  resolution: ImageResolution
  onResolutionChange: (value: ImageResolution) => void
  sheetMode: boolean
  onSheetModeChange: (value: boolean) => void
  sheetAspect: string
  onSheetAspectChange: (value: string) => void
  inFlightCount: number
}

export default function ControlsPanel({
  profile,
  onProfileChange,
  activeTab,
  onActiveTabChange,
  isExtracting,
  extractError,
  extractedThumb,
  onPhotoDrop,
  onResetExtract,
  onClear,
  error,
  onGenerate,
  canGenerate,
  resolution,
  onResolutionChange,
  sheetMode,
  onSheetModeChange,
  sheetAspect,
  onSheetAspectChange,
  inFlightCount,
}: ControlsPanelProps) {
  const setField = (key: string, value: string) => {
    onProfileChange({ ...profile, [key]: value })
  }

  // Scoped preset pickers — each opens the shared preset slide-over but merges
  // only its own tab's keys onto the current form, leaving the other tab's
  // fields untouched.
  const [physicalPresetOpen, setPhysicalPresetOpen] = useState(false)
  const [scenePresetOpen, setScenePresetOpen] = useState(false)

  const applyScopedPreset = (incoming: Record<string, string>, keys: string[]) => {
    const next = { ...profile }
    for (const key of keys) {
      next[key] = typeof incoming[key] === 'string' ? incoming[key] : ''
    }
    // Camera Device is always-on — never let a preset that omits it blank the
    // photorealism style string (mirrors createEmptyProfile).
    if (keys.includes('cameraDevice') && !next.cameraDevice) next.cameraDevice = PHOTOREALISM_STYLE
    onProfileChange(next)
  }

  // All groups render on one scrollable page; the top toggle jumps to a tab's
  // section (like the Ad Analyzer Scorecard/Transcript/Scenes strip) instead of
  // swapping the panel. Refs anchor each tab's block; a scroll-spy keeps the
  // toggle in sync with whichever block sits near the top of the viewport.
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({})
  // Latest onActiveTabChange in a ref so the observer (set up once) never holds
  // a stale closure.
  const onActiveTabChangeRef = useRef(onActiveTabChange)
  useEffect(() => { onActiveTabChangeRef.current = onActiveTabChange }, [onActiveTabChange])

  const scrollToTab = (id: TabId) => {
    onActiveTabChange(id)
    tabRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const els = Object.values(tabRefs.current).filter(Boolean) as HTMLElement[]
    if (els.length === 0) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const key = visible[0]?.target.getAttribute('data-tab') as TabId | null
        if (key) onActiveTabChangeRef.current(key)
      },
      { root, rootMargin: '-10% 0px -80% 0px', threshold: 0 },
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])

  // Scoped prompt slices for the per-divider Copy buttons. Physical = identity/
  // physical/wardrobe (valid in both portrait + sheet modes); Scene & Pose =
  // scene/pose/camera.
  const physicalPrompt = buildPhysicalPrompt(profile)
  const scenePrompt = buildScenePrompt(profile)

  return (
    <div className="flex min-w-0 flex-col md:h-full">
      {/* Rounded segmented toggle — filled so all tabs share the column with no
          horizontal scroll. The h-[57px] band + bottom hairline is the app-wide
          panel-header spec (Scripts, B-Roll, Bank, Playground, Ad Analyzer and
          Voiceovers all use it), so the left and right columns' divider lines
          land on the same pixel. */}
      <div className="flex h-[57px] shrink-0 items-center border-b border-ink/5 px-2">
        <SegmentedToggle<TabId>
          className="h-10 !p-1"
          value={activeTab}
          onChange={scrollToTab}
          options={TABS.map((tab) => ({
            value: tab.id,
            label: tab.shortLabel ?? tab.label,
            icon: TAB_ICONS[tab.id],
          }))}
        />
      </div>

      {/* Scrollable parameter fields (only scrolls internally on desktop). Every
          tab's groups render on one page — each group sits in its own card, and
          the top toggle scroll-jumps between tab blocks (Ad Analyzer pattern).
          The bottom edge feathers out under the Generate bar, mirroring the
          sticky preset row's fade at the top — without it the fields cut off
          mid-row against the bar and read as a render glitch. */}
      <div
        ref={scrollRef}
        className="min-w-0 flex-1 px-4 pb-4 md:overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent_100%)]"
      >
        <div className="flex flex-col gap-4">
          {/* Preset loader + reference-photo autofill — pinned just under the
              Physical / Scene & Pose toggle (sticky over the scroll), with an
              opaque backdrop + a feathered gradient so fields dissolve under it
              instead of clipping against a hard edge. The -mx-4/px-4 stretches
              the backdrop across the scroll container's own padding. */}
          <div className="sticky top-0 z-10 -mx-4 bg-surface-0 px-4 pt-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <LoadPresetDropdown onLoadProfile={onProfileChange} />
              </div>
              <div className="min-w-0 flex-1">
                <PhotoExtractZone
                  isExtracting={isExtracting}
                  extractError={extractError}
                  thumbnail={extractedThumb}
                  onPhotoDrop={onPhotoDrop}
                  onReset={onResetExtract}
                />
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-full h-5 bg-gradient-to-b from-surface-0 to-transparent" />
          </div>
          {TABS.map((tab, tabIndex) => (
            <div
              key={tab.id}
              ref={(el) => { tabRefs.current[tab.id] = el }}
              data-tab={tab.id}
              className="flex scroll-mt-20 flex-col gap-4"
            >
              {/* Tab divider — a centered preset button on a full-width line
                  (mirrors the History date pills), marking each tab's block. The
                  centered button doubles as the scoped preset picker; Clear sits
                  on the left and the scoped Copy on the right of every divider.
                  The left pill reads "New", not "Clear": it resets the input
                  fields only — every generated character stays in the gallery
                  and in history. */}
              <TabDivider
                left={<ClearAllButton onClear={onClear} label="New" className="!py-1 !text-[11px]" />}
                center={
                  tabIndex === 0 ? (
                    <PresetPillButton
                      label="Physical Presets"
                      title="Load only the physical fields from a preset"
                      icon={TAB_ICONS.physical}
                      onClick={() => setPhysicalPresetOpen(true)}
                    />
                  ) : (
                    <PresetPillButton
                      label="Scene & Pose Presets"
                      title="Load only the scene & pose fields from a preset"
                      icon={TAB_ICONS.scene}
                      onClick={() => setScenePresetOpen(true)}
                    />
                  )
                }
                right={
                  tabIndex === 0 ? (
                    <CopyPromptButton text={physicalPrompt} label="Copy Physical" title="Copy the physical fields as a prompt" />
                  ) : (
                    <CopyPromptButton text={scenePrompt} label="Copy Scene & Pose" title="Copy the scene & pose fields as a prompt" />
                  )
                }
              />
              {tab.groups.map((group) => {
                const GroupIcon = group.icon
                return (
                  <div key={group.id} className="rounded-2xl border border-ink/5 bg-ink/[0.02] p-4 card-soft-shadow">
                    {/* Section subheading — a centered icon + title-case label,
                        then a hairline rule. */}
                    <div className="mb-3 flex items-center justify-center gap-1.5">
                      {GroupIcon && <GroupIcon className="h-3.5 w-3.5 text-ink-100" />}
                      <h4 className="text-sm font-semibold tracking-tight text-ink-100">{group.label}</h4>
                    </div>
                    <div className="mb-4 border-t border-ink/10" />
                    {/* Two-column grid: short one-word fields (gender, age, eye
                        color…) pack two per row; `wide` fields (free-text /
                        sentence-length presets) span the full row via col-span-2.
                        Field order in types.ts keeps the wide ones grouped so no
                        half field is left stranded next to an empty cell. */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                      {group.fields.map((field) => (
                        <div key={field.key} className={field.wide ? 'col-span-2' : 'min-w-0'}>
                          <ChipField
                            label={field.label}
                            value={profile[field.key] ?? ''}
                            onChange={(v) => setField(field.key, v)}
                            placeholder={field.placeholder}
                            defaultLocked={field.key === 'cameraDevice'}
                            suggestions={field.suggestions ?? field.chips}
                            wideMenu={field.wideMenu}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Action footer — model picker, chips, Generate, and a tight Clear All
          sit at the foot of the controls column, directly under all the inputs
          that feed them. */}
      <GenerateBar
        error={error}
        onGenerate={onGenerate}
        canGenerate={canGenerate}
        aspectRatio={profile.aspectRatio || '9:16'}
        onAspectRatioChange={(value) => onProfileChange({ ...profile, aspectRatio: value })}
        resolution={resolution}
        onResolutionChange={onResolutionChange}
        sheetMode={sheetMode}
        onSheetModeChange={onSheetModeChange}
        sheetAspect={sheetAspect}
        onSheetAspectChange={onSheetAspectChange}
        inFlightCount={inFlightCount}
      />

      {/* Scoped preset pickers — same slide-over as the footer's full picker,
          but each merges only its tab's fields onto the current form. */}
      <PresetPickerSlideOver
        open={physicalPresetOpen}
        onClose={() => setPhysicalPresetOpen(false)}
        onPick={(incoming) => applyScopedPreset(incoming, PHYSICAL_KEYS)}
        title="Physical Presets"
        subtitle="Fill only the physical fields"
      />
      <PresetPickerSlideOver
        open={scenePresetOpen}
        onClose={() => setScenePresetOpen(false)}
        onPick={(incoming) => applyScopedPreset(incoming, SCENE_KEYS)}
        title="Scene & Pose Presets"
        subtitle="Fill only the scene & pose fields"
      />
    </div>
  )
}
