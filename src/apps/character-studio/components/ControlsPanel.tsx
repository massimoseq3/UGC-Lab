import { useState, useRef, useEffect, type ElementType, type ReactNode } from 'react'
import { ScanFace, PersonStanding, Camera, Copy, Check } from 'lucide-react'
import type { TabId, CharacterProfile, FieldGroup } from '../types'
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
import { SectionPresetPill } from '../../../components/SectionCard'
import LoadPresetDropdown from './LoadPresetDropdown'
import PresetPickerModal from './PresetPickerModal'
import PhotoExtractZone from './PhotoExtractZone'
import { buildImagePrompt, buildPhysicalPrompt, buildScenePrompt } from '../services/generateCharacter'
import { copyToClipboard } from '../../../utils/clipboard'
import { suspendChromeAutoHide } from '../../../hooks/useChromeAutoHide'

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
    // grid-cols-[1fr_auto_1fr], not absolute edge slots: the equal gutters keep
    // the centre pill genuinely centred, and a phone-width column squeezes the
    // side pills instead of sliding them underneath the title (which is exactly
    // what "Copy Physical" did on top of "Physical Presets" at 390px).
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
      <div className="flex min-w-0 justify-start">{left}</div>
      <div className="flex min-w-0 justify-center">{center}</div>
      <div className="flex min-w-0 justify-end">{right}</div>
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
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-ink/10 bg-ink/[0.02] px-2.5 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:border-ink/20 hover:bg-ink/[0.05] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400 light:text-emerald-600" /> : <Copy className="h-3 w-3" />}
      {/* Just "Copy" where the divider is narrow. The full label wrapped onto
          two lines on a phone, which made a 22px pill two rows tall. The
          divider it sits on already says which tab's fields these are. */}
      {copied ? 'Copied' : <><span className="lg:hidden">Copy</span><span className="hidden lg:inline">{label}</span></>}
    </button>
  )
}

// The same copy, panel-scope and glyph-only: a 36px circle at the weight of
// the canvas-clear button in every output panel's header, since it shares that
// bar's job of holding one utility beside a toggle.
function CopyPromptCircle({ text }: { text: string }) {
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
      title="Copy the full prompt · every field on both tabs"
      aria-label="Copy the full prompt"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-ink/[0.03] text-ink-300 transition-colors hover:bg-ink/[0.08] hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink/[0.03]"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-400 light:text-emerald-600" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}

interface ControlsPanelProps {
  profile: CharacterProfile
  onProfileChange: (profile: CharacterProfile) => void
  activeTab: TabId
  onActiveTabChange: (tab: TabId) => void
  analyzingCount: number
  extractError: string | null
  referenceApplied: boolean
  extractedThumb: string | null
  onPhotoDrop: (files: File[]) => void
  onResetExtract: () => void
  onOpenLibrary: () => void
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
  batchCount: number
  onBatchCountChange: (value: number) => void
  inFlightCount: number
}

export default function ControlsPanel({
  profile,
  onProfileChange,
  activeTab,
  onActiveTabChange,
  analyzingCount,
  extractError,
  referenceApplied,
  extractedThumb,
  onPhotoDrop,
  onResetExtract,
  onOpenLibrary,
  onClear,
  error,
  onGenerate,
  canGenerate,
  resolution,
  onResolutionChange,
  sheetMode,
  onSheetModeChange,
  batchCount,
  onBatchCountChange,
  inFlightCount,
}: ControlsPanelProps) {
  const setField = (key: string, value: string) => {
    onProfileChange({ ...profile, [key]: value })
  }

  // Scoped preset pickers — each opens the shared preset modal but merges
  // only its own tab's keys onto the current form, leaving the other tab's
  // fields untouched.
  const [physicalPresetOpen, setPhysicalPresetOpen] = useState(false)
  const [scenePresetOpen, setScenePresetOpen] = useState(false)
  // …and one level finer: every section title in the column is itself a scoped
  // picker, merging only that group's keys. Held as the group being picked FOR
  // rather than one flag per group, so a section added to `TABS` gets its own
  // picker with no wiring here.
  const [groupPreset, setGroupPreset] = useState<FieldGroup | null>(null)
  // The whole-form prompt as one editable JSON box — copy the character out, or
  // paste one in. It sits in the band with the other two ways of filling this
  // form (a saved preset, an analysed photo) rather than on a tab divider,
  // because it is the only one of the three that carries every field at once.

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
    suspendChromeAutoHide()
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
  // Both tabs at once — the same JSON the model is actually sent, and the same
  // seed the Prompt JSON modal opens on.
  const fullPrompt = buildImagePrompt(profile)

  return (
    // On a phone everything below the tab toggle is one scroller and the
    // Generate bar is the last thing in it, not a band pinned over the fields —
    // see the note above the GenerateBar below.
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Rounded segmented toggle — filled so all tabs share the column with no
          horizontal scroll. The h-[57px] band + bottom hairline is the app-wide
          panel-header spec (Scripts, B-Roll, Bank, Playground, Ad Analyzer and
          Voiceovers all use it), so the left and right columns' divider lines
          land on the same pixel — and `px-5` is the other half of that spec, so
          on a phone this pill shares its left edge with the pane tabs above it.
          It was `px-2`, from back when this toggle carried five tabs. */}
      <div className="flex h-[57px] shrink-0 items-center gap-2 border-b border-ink/5 px-5">
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
        {/* The WHOLE prompt, in one click. The two tab dividers below each
            carry a copy of their own slice, and a scoped copy can't be asked
            for the thing the model actually reads — that lived only inside the
            Prompt JSON modal, behind a glyph, in a box built for pasting one
            back IN. Panel-level scope, so it sits on the panel's own bar
            rather than on a divider that belongs to one tab. Glyph-only at the
            weight of the canvas-clear circle every output panel uses: a label
            here would eat the toggle beside it, and the two dividers already
            spell the word out twice. */}
        <CopyPromptCircle text={fullPrompt} />
      </div>

      {/* The phone's scroll port. It starts BELOW the toggle above, which is
          why that toggle is a sibling of this box and not its first child: the
          panel root used to be the scroller, so the tab bar scrolled away with
          the fields and the member lost the way back to the other tab halfway
          down a form. Above `md` this is a plain wrapper and the column below
          scrolls on its own. */}
      {/* Preset loader + reference-photo autofill — a FIXED band under the tab
          toggle, a sibling of BOTH scrollers: the desktop fields column below
          and the phone-width wrapper around it. It used to be a `sticky top-0`
          child of the scroller, which pins it only once the scroll has started:
          at scroll-top it sat in normal flow and every rubber-band / trackpad
          overscroll floated it, so the two rows read as loose rather than as
          part of the panel's chrome. It then sat INSIDE the phone wrapper,
          which is the scroller under `md` — so on a phone it scrolled away with
          the fields and the two things every run starts from (load a preset,
          drop a reference photo) were gone by the second card. A row that must
          never move doesn't belong in the thing that moves, at either width. */}
      <div className="shrink-0 px-5 pb-2 pt-2">
        {/* Side by side at every width. They were stacked under `sm` because
            two picker rows sharing a phone-width column truncated to
            "Load Cha…" / "Extract C…", which names neither — but the fix for a
            label that doesn't fit is a shorter label, not a second row of
            chrome on the screen with the least of it. Each row carries a short
            name and swaps to the full one at `lg`, which is the first width
            where this column is wide enough to read it. */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <LoadPresetDropdown onLoadProfile={onProfileChange} />
          </div>
          <div className="min-w-0 flex-1">
            <PhotoExtractZone
              analyzingCount={analyzingCount}
              extractError={extractError}
              applied={referenceApplied}
              thumbnail={extractedThumb}
              onPhotoDrop={onPhotoDrop}
              onReset={onResetExtract}
              onOpenLibrary={onOpenLibrary}
            />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto">
        {/* Scrollable parameter fields. Every
            tab's groups render on one page — each group sits in its own card, and
            the top toggle scroll-jumps between tab blocks (Ad Analyzer pattern).
            Both edges feather out — under the Generate bar and under the pinned
            band above — so fields dissolve at the boundary instead of cutting off
            mid-row, which reads as a render glitch. */}
        {/* On a phone this stops being a scroller of its own and simply grows —
            the column above scrolls. The feathered edges go with it: they mark
            where content passes under pinned chrome, and on a phone there is
            none to pass under. */}
        <div
          ref={scrollRef}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 pb-4 [mask-image:linear-gradient(to_bottom,transparent_0,black_0.5rem,black_calc(100%-1.5rem),transparent_100%)] max-md:flex-none max-md:overflow-visible max-md:[mask-image:none]"
        >
          <div className="flex flex-col gap-4 pt-2">
            {TABS.map((tab, tabIndex) => (
              <div
                key={tab.id}
                ref={(el) => { tabRefs.current[tab.id] = el }}
                data-tab={tab.id}
                className="flex scroll-mt-20 flex-col gap-4"
              >
                {/* Tab divider — a centered preset button on a full-width line
                    (mirrors the History date pills), marking each tab's block. The
                    centered button doubles as the scoped preset picker; Clear all
                    sits on the left and the scoped Copy on the right of every
                    divider. The scoped Copy carries one TAB's fields; the whole
                    prompt is the circle on the panel header above. */}
                <TabDivider
                  /* "Clear all", not "New" (September 2026, Massimo's call).
                     It is the same ClearAllButton every other input panel
                     wears and it still clears INPUTS ONLY — every generated
                     character stays in the gallery and in history — which is
                     what the shared component's "New" wording was protecting.
                     The two-click arm, the "Confirm" state and the tooltip
                     that spells out what survives all stay, and they are what
                     carries that promise now the label doesn't. */
                  left={<ClearAllButton onClear={onClear} label="Clear all" className="!py-1 !text-[11px]" />}
                  center={
                    tabIndex === 0 ? (
                      <SectionPresetPill
                        label="Physical Presets"
                        title="Load only the physical fields from a preset"
                        icon={TAB_ICONS.physical}
                        onClick={() => setPhysicalPresetOpen(true)}
                      />
                    ) : (
                      <SectionPresetPill
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
                          then a hairline rule. The heading IS the section's own
                          preset button: same dashed pill as the tab dividers
                          above it, in ink rather than the influencers accent,
                          filling only this group's fields. */}
                      <h4 className="mb-3 flex justify-center">
                        <SectionPresetPill
                          tone="neutral"
                          label={group.label}
                          title={`Load only the ${group.label.toLowerCase()} fields from a preset`}
                          icon={GroupIcon}
                          onClick={() => setGroupPreset(group)}
                        />
                      </h4>
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
            that feed them.

            Pinned from `md` up only (August 2026, Massimo's call). On a phone a
            fixed band stood over the 28 fields it belongs to and cost most of a
            short column; you fill the form top to bottom, and Generate is where
            you arrive. */}
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
          batchCount={batchCount}
          onBatchCountChange={onBatchCountChange}
          inFlightCount={inFlightCount}
        />

        {/* Scoped preset pickers — same modal as the footer's full picker,
            but each merges only its tab's fields onto the current form. */}
        {/* Every picker is mounted only while it's open — the grid, its page
            count and the rail's highlight then belong to that opening, which
            is the component's own contract (see its doc). */}
        {physicalPresetOpen && (
          <PresetPickerModal
            open
            onClose={() => setPhysicalPresetOpen(false)}
            onPick={(incoming) => applyScopedPreset(incoming, PHYSICAL_KEYS)}
            title="Physical Presets"
            subtitle="Fill only the physical fields"
          />
        )}
        {scenePresetOpen && (
          <PresetPickerModal
            open
            onClose={() => setScenePresetOpen(false)}
            onPick={(incoming) => applyScopedPreset(incoming, SCENE_KEYS)}
            title="Scene & Pose Presets"
            subtitle="Fill only the scene & pose fields"
          />
        )}
        {/* One picker for every section title, scoped to whichever heading was
            clicked — eight always-mounted copies would each hold their own
            grid. */}
        {groupPreset && (
          <PresetPickerModal
            open
            onClose={() => setGroupPreset(null)}
            onPick={(incoming) => applyScopedPreset(incoming, groupPreset.fields.map((f) => f.key))}
            title={`${groupPreset.label} Presets`}
            subtitle={`Fill only the ${groupPreset.label.toLowerCase()} fields`}
          />
        )}

      </div>
    </div>
  )
}
