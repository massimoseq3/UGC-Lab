import { useState } from 'react'
import { AudioLines, Check, ChevronDown, ChevronRight } from 'lucide-react'
import SectionCard, { SectionPresetPill } from './SectionCard'
import Modal from './Modal'
import SegmentedToggle from './SegmentedToggle'
import SectionRail, { GallerySectionHeading } from './SectionRail'
import { useSectionSpy } from './sectionSpy'
import AutoGrowTextarea from './AutoGrowTextarea'
import CountSlot from './CountSlot'
import { VOICE_GROUPS, VOICE_PRESETS, type VoicePreset } from '../utils/voicePresets'

// The voice profile box — WHO is speaking, as opposed to what is on screen.
// **One component, two hosts**: Playground's video tab, where it is appended to
// the end of the prompt at generate time (`composePrompt.ts`), and B-Roll's card
// detail modal, where it is the ad's one shared dialogue voice. It was two
// separate boxes until September 2026 (Massimo's call) — the same control, a
// dock tile apart, with different chrome, different padding and the preset
// picker on only one of them.
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
// **In Playground it is video only** (and not Motion Control, which has no audio
// at all): a voice has nothing to say about a still or a music track. In B-Roll
// it renders on a DIALOGUE card's Video / Animate tabs, for the same reason.
//
// **The header row folds it.** This is a set-once field sitting in the panel's
// tightest column, directly under the prompt box it steals height from — so once
// the profile is in, the box is 90px of something nobody is reading. Folded it
// keeps one truncated line of the profile, which is what says it's still on; a
// fold that hid the text entirely would read as the voice having been cleared.
//
// It starts OPEN. The box is the reason the card exists, and folded-by-default
// meant a member who had never opened it had never seen what goes in it. It
// costs 78px in the one column that has none spare (this sits directly under a
// prompt field whose own floor was cut to 150px to keep it and its toolbar on
// screen at all), which is exactly what the fold is for: one click puts it away,
// and where the host persists the flag the member pays that price once rather
// than every session.
//
// **The header carries no status pills.** B-Roll's copy wore an `optional` and
// an `every clip` pill either side of the title; both came off with the merge
// (Massimo's call) — everything in these columns that isn't marked otherwise is
// optional, and what "every clip" was saying is said properly by the host's own
// placeholder, in a sentence, inside the box it describes.
//
// There is deliberately **no Clear button**: this is a plain textarea, emptying
// it is select-all-delete, and a destructive control on a set-once field is one
// misclick from re-pasting a paragraph. The References card's Clear exists
// because attachments can't be deleted by typing.

// Where the box stops growing and starts scrolling: THREE lines, and then the
// field scrolls itself. `AutoGrowTextarea` caps only a paste box with no natural
// ceiling, which is what this is — it sits directly under the prompt box and
// takes its height out of it, so a profile typed out long must not push the
// thing you actually write in off the column.
//
// It was 120px (~six lines) until September 2026 (Massimo's call): a profile is
// two or three sentences and a set-once field growing to half the column as you
// type it reads as the box running away with the panel. Three lines is enough to
// see the whole of a normal one, and the fold is what puts a long one away.
//
// The number is generous by a few px on purpose. A phone floors every field at
// 13px (`index.css`), and the `plain` shell adds its own bottom inset — so the
// cap has to clear 3 × 19.5 + 2 or the third line is clipped into a scroll on
// exactly the width where it should fit. Four lines is over it in every case.
const MAX_FIELD_HEIGHT = 62

// ACCENT is what the list is sectioned by, so accent is what the rail
// navigates: three groups, each worth scrolling to. GENDER is the filter that
// cuts across all three, centred on the toolbar above them — two values, which
// is a pill row rather than a rail. Both used to be dropdowns side by side, and
// the pair was tried the other way round for a day (gender in the rail) before
// landing here (Massimo's call, September 2026).
const GENDERS = ['All', 'Female', 'Male'] as const

// The two shells this card comes in. They differ ONLY in chrome — the fold, the
// preset picker, the field and the folded summary are the same code in both.
//
// `section` is B-Roll's card detail modal: a real `SectionCard`, centred heading
// over a hairline, and the card's own rectangle as the field. `plain` is
// Playground's input column: no rule, its own tighter padding, and the field as
// a bordered box inside it.
//
// They were tried as ONE shape (September 2026) — the `section` one, in both —
// and Playground was put back the way it was on sight (Massimo's call). The two
// live in different places: B-Roll's is one card among several in a modal, where
// the hairline is what every neighbouring card draws, and Playground's is the
// last thing in a cramped input column directly under the prompt box, where the
// rule is one more horizontal line in a stack that already has too many. So the
// difference is deliberate, and a caller picks the one its column is built from.
export type VoiceCardVariant = 'section' | 'plain'

export default function VoiceCard({
  value,
  open,
  onChange,
  onToggleOpen,
  onCommit,
  placeholder = 'Describe your voice. Added to the end of every prompt',
  variant = 'section',
}: {
  value: string
  // Folded state, persisted with the draft where the host has one — the whole
  // point is setting this once and leaving it, so the fold has to survive a
  // reload too.
  open: boolean
  onChange: (next: string) => void
  onToggleOpen: () => void
  // Fired on blur, for a host whose value is shared by more than the one field
  // it is typed into — B-Roll writes this profile onto every dialogue clip of
  // the ad, which is not work to do per keystroke.
  onCommit?: (next: string) => void
  // In Playground the profile rides on the end of THIS prompt; in B-Roll it
  // applies to every talking clip of the ad. That sentence used to be an
  // `every clip` pill in B-Roll's header.
  placeholder?: string
  variant?: VoiceCardVariant
}) {
  const [presetsOpen, setPresetsOpen] = useState(false)
  const filled = value.trim().length > 0
  const isSection = variant === 'section'

  // The WHOLE header row folds the card; this stays a real button so the control
  // keeps its `aria-expanded` and its keyboard focus, and stops its own click
  // from folding twice on the way up.
  const foldButton = (
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
  )

  // The heading IS the preset opener — Influencers' section-title shape (dashed
  // ring + chevron in plain ink), which is where every other list of
  // hand-written presets in this app is reached from. `size='sm'` is
  // `SectionCard`'s own 13px title, so it doesn't stand a size above the
  // headings it shares a column with.
  const headingPill = (
    <SectionPresetPill
      tone="neutral"
      size="sm"
      icon={AudioLines}
      label="Voice"
      title="Browse voice presets"
      onClick={(e) => { e.stopPropagation(); setPresetsOpen(true) }}
    />
  )

  const body = open ? (
    <AutoGrowTextarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit?.(value)}
      maxHeight={MAX_FIELD_HEIGHT}
      rows={2}
      spellCheck={false}
      aria-label="Voice"
      placeholder={placeholder}
      // The card IS the box, in BOTH shells: a bordered, tinted field inside a
      // bordered, tinted card is two outlines around the same three lines.
      // Playground's had its own bordered rectangle inside the card until
      // September 2026 (Massimo's call) — the difference between the variants is
      // the card's chrome, never a second frame around the text. The caret's
      // feedback is the CARD brightening (`focus-within` on the wrapper), which
      // is what the removed border was doing on focus anyway. All that differs
      // now is the inset: `section` is flush, because `SectionCard` has already
      // padded it, and `plain` keeps a hair of its own inside the tighter `p-2`.
      className={`w-full resize-none border-0 bg-transparent text-[12.5px] font-light leading-[1.5] tracking-tight text-ink-200 placeholder-ink-600 outline-none ${
        isSection ? 'p-0' : 'mt-1.5 px-1 pb-0.5'
      }`}
    />
  ) : (
    filled && (
      // One dim line, so a folded card still says which voice is riding on every
      // prompt — the point is to get it out of the way, not to hide whether it's
      // there. Clicking it opens the box back up.
      <button
        type="button"
        onClick={onToggleOpen}
        title="Show the voice"
        className={`block w-full truncate text-left text-[11.5px] font-light tracking-tight text-ink-600 transition-colors hover:text-ink-400 ${
          isSection ? '' : 'mt-1 px-1'
        }`}
      >
        {value.trim()}
      </button>
    )
  )

  const picker = (
    <VoicePresetPicker
      open={presetsOpen}
      onClose={() => setPresetsOpen(false)}
      value={value}
      onPick={(text) => { onChange(text); onCommit?.(text); setPresetsOpen(false) }}
    />
  )

  if (isSection) {
    return (
      // `focus-within`, not `focus` on the field: the card IS the box you type
      // in, so the whole rectangle is what brightens when the caret is in it.
      <SectionCard
        title="Voice"
        icon={AudioLines}
        onHeaderClick={onToggleOpen}
        // Folded and empty there is no body, so no rule: a hairline over nothing
        // reads as a card whose content has been clipped off rather than put
        // away.
        divider={open || filled}
        contentClassName="flex flex-col"
        className="shrink-0 transition-colors focus-within:border-ink/15"
        left={foldButton}
        titleNode={headingPill}
      >
        {body}
        {picker}
      </SectionCard>
    )
  }

  return (
    // `shrink-0`: the prompt box above owns the leftover height and this is a
    // fixed sibling under it, not another claimant on the same space.
    //
    // No `card-soft-shadow`, unlike the References card above it. This is the
    // LAST child of the input column, and that column is `min-h-full` with the
    // prompt box taking every spare pixel through `grow` — so this card's bottom
    // edge sits exactly on the scroller's clip edge at every window size, and a
    // scroller clips its descendants' shadows. The 8px gap under it belongs to
    // the generate band below (see the gap rule in CLAUDE.md), which is outside
    // the scroll port and can't lend the shadow any room. So the shadow could
    // never render downward here: what it actually drew was a soft halo down the
    // sides that stopped dead at the bottom corners, which reads as the card
    // being sliced off — reported in light mode (September 2026), because that
    // is the only theme where the shadow is visible at all. Adding `pb` to the
    // column would fix it and break something worse: bottom padding on a scroll
    // container is scrolled content, so the gap above the band would change as
    // you scroll.
    <div className="shrink-0 rounded-2xl border border-ink/5 bg-ink/[0.02] p-2 transition-colors focus-within:border-ink/15">
      {/* The card's own header, not `SectionCard`'s: with the row collapsed
          there is no hairline to draw under it. Same three-column grid, so the
          heading stays optically centred whatever the edges weigh. */}
      <div
        onClick={onToggleOpen}
        className="group grid min-h-[24px] cursor-pointer grid-cols-[1fr_auto_1fr] items-center gap-1.5"
      >
        <div className="flex min-w-0 items-center justify-start">{foldButton}</div>
        {headingPill}
        {/* The right cell is empty and stays: it is the gutter that keeps the
            heading centred against the chevron opposite it. */}
        <div className="flex min-w-0 items-center justify-end" />
      </div>
      {body}
      {picker}
    </div>
  )
}

// The preset browser — the app's picker modal, the same chrome as the prompt
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
  const [gender, setGender] = useState<(typeof GENDERS)[number]>(GENDERS[0])
  const [expanded, setExpanded] = useState<string | null>(null)

  const shown = VOICE_PRESETS.filter((p) => gender === GENDERS[0] || p.gender === gender)
  // Every accent row stays in the rail whatever the gender filter leaves in it
  // — a row that vanished at zero would move the rest under the pointer, and
  // the count answers "why is there nothing there" outright.
  const spy = useSectionSpy(VOICE_GROUPS)
  const countIn = (group: string) => shown.filter((p) => p.group === group).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose a Voice"
      // The Characters preset picker's shape: the accent groups down the left,
      // the one list beside them, and gender as a filter across all three. It
      // was a single column of fifteen rows down a 672px panel, most of which
      // was empty air to the right of each name.
      size="gallery"
      rail={
        <SectionRail
          heading="Accent"
          sections={VOICE_GROUPS.map((g) => ({ key: g, label: g, count: countIn(g) }))}
          activeKey={spy.activeKey}
          accent="playground"
          onJump={spy.jumpTo}
        />
      }
      bodyRef={spy.portRef}
      onBodyScroll={spy.onScroll}
      // A row opens to its full profile, so the panel holds its height rather
      // than resizing under the pointer every time one is expanded.
      fill
    >
      <div className="p-4">
        {/* Centred, like the section pills under it — the toggle is three short
            words on a 900px body, and left-aligned it read as the start of a
            toolbar that has nothing else in it. `dense` because it is a filter
            over a list, not a mode switch: at full size a 48px slab of three
            short words stood taller than the section pills it narrows. */}
        <div className="flex justify-center">
          <SegmentedToggle
            value={gender}
            onChange={setGender}
            accent="playground"
            dense
            fitContent
            options={GENDERS.map((g) => ({
              value: g,
              label: g,
              badge: <CountSlot value={g === GENDERS[0] ? VOICE_PRESETS.length : VOICE_PRESETS.filter((p) => p.gender === g).length} />,
            }))}
          />
        </div>

        {VOICE_GROUPS.map((g) => (
          <div key={g}>
            <GallerySectionHeading label={g} innerRef={spy.register(g)} className="mb-3 mt-5" />
            {/* Three across at `gallery` width, dropping to two and then one as
                the panel narrows. `items-start` so the row you opened is the
                only one that grows — stretched, its neighbours would inflate to
                match a paragraph they aren't showing. */}
            <div className="grid grid-cols-1 items-start gap-1.5 md:grid-cols-2 xl:grid-cols-3">
              {shown
                .filter((p) => p.group === g)
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
              {countIn(g) === 0 && (
                <p className="text-[12px] text-ink-600">No {gender.toLowerCase()} voices in this accent.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
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
                In Use
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
            {inUse ? <><Check className="h-3.5 w-3.5" /> In Use</> : 'Use This Voice'}
          </button>
        </div>
      )}
    </div>
  )
}
