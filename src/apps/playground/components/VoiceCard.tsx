import { useState } from 'react'
import { AudioLines, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { SectionPresetPill } from '../../../components/SectionCard'
import SlideOver from '../../../components/SlideOver'
import Dropdown from '../../../components/Dropdown'
import AutoGrowTextarea from '../../../components/AutoGrowTextarea'
import DayPill from '../../../components/DayPill'
import { VOICE_GROUPS, VOICE_PRESETS, type VoicePreset } from '../voicePresets'

// The voice profile, in its own box under the prompt, appended to the end of
// the prompt at generate time (`composePrompt.ts`).
//
// It is exactly what a member was doing by hand: the profile is the one part of
// a UGC video prompt that must NOT change between generations — the same person
// has to speak in every clip of an ad — so it was being pasted back under every
// new prompt, two lines down, and re-selected around every time the prompt was
// rewritten. Keeping it in a field of its own means the prompt box holds only
// the shot, and the voice survives Clear, Enhance, Undo and a whole new idea.
//
// Nothing is added around it. What gets sent is the prompt, a blank line, then
// this text verbatim — "as if you'd typed it on the end" is the contract, and a
// label we invented here would be a word in the prompt the member never wrote.
//
// **Video only** (and not Motion Control, which has no audio at all): a voice
// has nothing to say about a still or a music track, and a box that renders in
// every mode is a box that's wrong in two of them.
//
// **The header row folds it.** This is a set-once field sitting in the panel's
// tightest column, directly under the prompt box it steals height from — so once
// the profile is in, the box is 90px of something nobody is reading. Folded it
// keeps one truncated line of the profile, which is what says it's still on; a
// fold that hid the text entirely would read as the voice having been cleared.
//
// It starts OPEN. The box is the reason the card exists, and folded-by-default
// meant a member who had never opened it had never seen what goes in it — a
// dashed pill next to the word Optional is easy to read as one more thing to
// ignore. It costs 78px in the one column that has none spare (this sits
// directly under a prompt field whose own floor was cut to 150px to keep it and
// its toolbar on screen at all), which is exactly what the fold is for: one
// click puts it away, and the state is persisted, so the member pays that price
// once rather than every session.
//
// There is deliberately **no Clear button**: this is a plain textarea, emptying
// it is select-all-delete, and a destructive control on a set-once field is one
// misclick from re-pasting a paragraph. The References card's Clear exists
// because attachments can't be deleted by typing.

// Where the box stops growing and starts scrolling. `AutoGrowTextarea` caps only
// a paste box with no natural ceiling, which is what this is — it sits directly
// under the prompt box and takes its height out of it, so a pasted essay must
// not push the thing you actually write in off the column.
const MAX_FIELD_HEIGHT = 120

const GENDERS = ['All voices', 'Female', 'Male'] as const
const ACCENTS = ['All accents', ...VOICE_GROUPS] as const

export default function VoiceCard({
  value,
  open,
  onChange,
  onToggleOpen,
}: {
  value: string
  // Folded state, persisted with the draft — the whole point is setting this
  // once and leaving it, so the fold has to survive a reload too.
  open: boolean
  onChange: (next: string) => void
  onToggleOpen: () => void
}) {
  const [presetsOpen, setPresetsOpen] = useState(false)
  const filled = value.trim().length > 0

  return (
    // `shrink-0`: the prompt box above owns the leftover height and this is a
    // fixed sibling under it, not another claimant on the same space.
    <div className="shrink-0 rounded-2xl border border-ink/5 bg-ink/[0.02] p-2 card-soft-shadow">
      {/* The card's own header, not `SectionCard`'s: the fold chevron has to be
          a button of its own on the left, and with the row collapsed there is no
          hairline to draw under it. Same three-column grid, so the heading stays
          optically centred whatever the edges weigh.

          The WHOLE ROW folds it, not just the chevron (Massimo's call, September
          2026): a 24px target on a 48px bar that is otherwise dead space made
          the fold something you had to aim at. The chevron stays a real button
          so the control keeps its `aria-expanded` and its keyboard focus — it
          just stops the click from folding twice on the way up. The heading is
          the one live thing in here that isn't the fold, so it swallows its own
          click. */}
      <div
        onClick={onToggleOpen}
        className="group grid min-h-[24px] cursor-pointer grid-cols-[1fr_auto_1fr] items-center gap-1.5"
      >
        <div className="flex min-w-0 items-center justify-start">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleOpen() }}
            title={open ? 'Hide the voice' : 'Show the voice'}
            aria-label={open ? 'Hide the voice' : 'Show the voice'}
            aria-expanded={open}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-600 transition-colors group-hover:text-ink-300 hover:bg-ink/5 hover:text-ink-300"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
        {/* The heading IS the preset opener — Influencers' section-title shape
            (dashed ring + chevron in plain ink), which is where every other list
            of hand-written presets in this app is reached from. `size='sm'` is
            the References card's own 13px title: these two headings stack in one
            column and a 14px pill under a 13px heading read as two title sizes. */}
        <SectionPresetPill
          tone="neutral"
          size="sm"
          icon={AudioLines}
          label="Voice"
          title="Browse voice presets"
          onClick={(e) => { e.stopPropagation(); setPresetsOpen(true) }}
        />
        {/* The right cell is empty and stays: it is the gutter that keeps the
            heading centred against the chevron opposite it. The `Optional` pill
            that used to sit here came off with the References card's own
            (September 2026) — everything in this column that isn't marked
            otherwise is optional, and the word only ever said so twice. */}
        <div className="flex min-w-0 items-center justify-end" />
      </div>

      {open ? (
        <AutoGrowTextarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxHeight={MAX_FIELD_HEIGHT}
          rows={2}
          spellCheck={false}
          aria-label="Voice"
          placeholder="Describe your voice. Added to the end of every prompt"
          className="mt-2 w-full resize-none rounded-xl border border-ink/10 bg-ink/[0.03] px-3 py-2 text-[13px] font-light leading-[1.5] tracking-tight text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.05]"
        />
      ) : (
        filled && (
          // One dim line, so a folded card still says which voice is riding on
          // every prompt — the point is to get it out of the way, not to hide
          // whether it's there. Clicking it opens the box back up.
          <button
            type="button"
            onClick={onToggleOpen}
            title="Show the voice"
            className="mt-1 block w-full truncate px-1 text-left text-[11.5px] font-light tracking-tight text-ink-600 transition-colors hover:text-ink-400"
          >
            {value.trim()}
          </button>
        )
      )}

      <VoicePresetPicker
        open={presetsOpen}
        onClose={() => setPresetsOpen(false)}
        value={value}
        onPick={(text) => { onChange(text); setPresetsOpen(false) }}
      />
    </div>
  )
}

// The preset browser — a right-edge slide-over, the same chrome as the prompt
// presets one step above it.
//
// **A row is a NAME, not a paragraph.** Fourteen full profiles rendered at once
// is a wall of prose in which every entry opens "Female in her mid 20s speaking
// with a…", so the one line that distinguishes them is the hardest to find. A
// collapsed row is the accent, who's speaking it, and three trait words off the
// profile; clicking it opens that one row and shows the whole thing, with the
// button that applies it. One open at a time, so the list can't grow back into
// the wall it replaced.
function VoicePresetPicker({
  open,
  onClose,
  value,
  onPick,
}: {
  open: boolean
  onClose: () => void
  value: string
  onPick: (text: string) => void
}) {
  const [gender, setGender] = useState<string>(GENDERS[0])
  const [accent, setAccent] = useState<string>(ACCENTS[0])
  const [expanded, setExpanded] = useState<string | null>(null)

  const matches = (p: VoicePreset) =>
    (gender === GENDERS[0] || p.gender === gender) && (accent === ACCENTS[0] || p.group === accent)
  const shown = VOICE_PRESETS.filter(matches)
  const groups = VOICE_GROUPS.filter((g) => shown.some((p) => p.group === g))

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Voice"
      subtitle="Pick a voice. It replaces what's in the box, then it's yours to edit"
      size="medium"
    >
      <div className="p-4">
        {/* `tier="panel"` is required, not decorative: this slide-over is z-[80]
            and a default-tier menu paints at z-[60], i.e. behind the panel its
            own trigger is on. `fitContent` so two triggers share one row. */}
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            value={gender}
            options={GENDERS}
            onChange={setGender}
            accent="playground"
            tier="panel"
            fitContent
          />
          <Dropdown
            value={accent}
            options={ACCENTS}
            onChange={setAccent}
            accent="playground"
            tier="panel"
            fitContent
            menuMinWidth={200}
          />
        </div>

        {groups.map((group) => (
          <div key={group}>
            {/* The house group separator, the same one the Characters template
                library is grouped by. */}
            <DayPill label={group} className="mb-2 mt-4" />
            <div className="flex flex-col gap-1.5">
              {shown
                .filter((p) => p.group === group)
                .map((preset) => (
                  <PresetRow
                    key={preset.id}
                    preset={preset}
                    inUse={preset.text === value.trim()}
                    expanded={expanded === preset.id}
                    onToggle={() => setExpanded((id) => (id === preset.id ? null : preset.id))}
                    onPick={() => onPick(preset.text)}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
    </SlideOver>
  )
}

function PresetRow({
  preset,
  inUse,
  expanded,
  onToggle,
  onPick,
}: {
  preset: VoicePreset
  inUse: boolean
  expanded: boolean
  onToggle: () => void
  onPick: () => void
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-colors ${
        inUse ? 'border-playground-500/30 bg-playground-500/[0.08]' : 'border-ink/5 bg-ink/[0.02]'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-ink/[0.04]"
      >
        <div className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[13px] font-semibold tracking-tight text-ink-100">{preset.accent}</span>
            <span className="shrink-0 text-[11px] text-ink-500">{preset.speaker}</span>
            {inUse && (
              <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-tight text-playground-300">
                In use
              </span>
            )}
          </span>
          {/* Three words instead of a truncated first sentence: every profile
              opens the same way, so a clamp of the prose says nothing the name
              above it hasn't. */}
          <span className="mt-1 flex flex-wrap gap-1">
            {preset.traits.map((trait) => (
              <span key={trait} className="rounded-full bg-ink/[0.06] px-1.5 py-0.5 text-[10px] text-ink-400">
                {trait}
              </span>
            ))}
          </span>
        </div>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-ink-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-ink/5 px-3 pb-3 pt-2.5">
          <p className="text-[12px] font-light leading-relaxed tracking-tight text-ink-300">{preset.text}</p>
          <button
            type="button"
            onClick={onPick}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-playground-500/15 px-4 py-2 text-[12px] font-medium tracking-tight text-playground-300 transition-colors hover:bg-playground-500/25"
          >
            {inUse ? <><Check className="h-3.5 w-3.5" /> In use</> : 'Use this voice'}
          </button>
        </div>
      )}
    </div>
  )
}
