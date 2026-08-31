import { useState, useRef, useEffect } from 'react'
import { Lock, Unlock, Maximize2, Star } from 'lucide-react'

interface ChipFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  // Typeahead list: focusing the input opens a searchable dropdown of these
  // values; typing filters it. Free text always works — the list is a menu,
  // not a constraint.
  suggestions: string[]
  placeholder?: string
  // When true, the field starts locked: input is read-only and the dropdown
  // stays closed. User can click Unlock to edit.
  defaultLocked?: boolean
  // Widen the dropdown beyond the (half-width) input and let options wrap
  // instead of truncating — for fields with long, sentence-length presets that
  // still want to sit half-width in the grid (e.g. Skin & Realism).
  wideMenu?: boolean
}

// A value this long no longer fits the single-line pill — surface the expand
// button so the full prompt can be edited in the pop-up without scrolling.
const LONG_VALUE = 30

// A suggestion longer than this is one of the hand-authored "detailed" presets
// (full descriptive sentences — realism cues, lighting setups, expressions)
// rather than a one-word quick pick. These get a star and float to the top of
// the dropdown so they're reachable without scrolling.
const DETAILED_LEN = 30
const isDetailed = (s: string) => s.trim().length > DETAILED_LEN
// Stable reorder: detailed (starred) options first, everything else after.
const detailedFirst = (arr: string[]) => [
  ...arr.filter(isDetailed),
  ...arr.filter((s) => !isDetailed(s)),
]

// Tallest the dropdown/editor pop-up can grow (max-h-52 list ≈ 208px + padding
// + the mt offset). Used to decide flip direction: if there's less than this
// much room below the field, open upward instead. Padded a touch so the panel
// flips before it kisses the boundary.
const PANEL_MAX_HEIGHT = 240

export default function ChipField({ label, value, onChange, suggestions, placeholder, defaultLocked = false, wideMenu = false }: ChipFieldProps) {
  const isFilled = value.trim() !== ''
  const [locked, setLocked] = useState(defaultLocked)
  // The dropdown opens on click (focus) and closes on blur — no hover-open, so
  // the cursor can move freely across the parameters column without popping
  // menus. The panel keeps the input focused (mousedown-preventDefault below),
  // so interacting with it never blurs the field shut.
  const [open, setOpen] = useState(false)
  // The full-text editor pop-up — opened from the expand button on long values.
  const [editing, setEditing] = useState(false)
  // Flip both pop-ups above the field when there isn't room to open downward.
  // On desktop the parameters column scrolls internally, so a downward panel
  // near the bottom inflates that container's scrollHeight and opens a phantom
  // gap; on mobile it grows the page. Direction is decided in measureDirection()
  // against the real clipping edges, not the viewport.
  const [openUp, setOpenUp] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  // A bottom fade hints "there's more below" when the list overflows and isn't
  // scrolled to the end — the macOS overlay scrollbar stays hidden at rest, so
  // without this cue the user can't tell the menu scrolls.
  const listRef = useRef<HTMLDivElement>(null)
  const [showMoreFade, setShowMoreFade] = useState(false)
  const updateFade = () => {
    const el = listRef.current
    if (!el) { setShowMoreFade(false); return }
    setShowMoreFade(el.scrollTop + el.clientHeight < el.scrollHeight - 1)
  }

  const q = value.trim().toLowerCase()
  // Two sections: the options that match the current text float to the top,
  // a hairline separator, then every other option. With no text yet, the
  // starred "detailed" presets (plus a "None" option, when the field has one)
  // take the top slot, so the richest picks are always reachable without
  // scrolling. Within every section the detailed presets sort first. The
  // dropdown opens on every focus — even when the field already holds a value —
  // so clicking into a filled field still shows the full menu.
  let topSection: string[]
  let restSection: string[]
  if (q) {
    topSection = detailedFirst(suggestions.filter((s) => s.toLowerCase().includes(q)))
    restSection = detailedFirst(suggestions.filter((s) => !s.toLowerCase().includes(q)))
  } else {
    const none = suggestions.filter((s) => s.toLowerCase() === 'none')
    const rest = suggestions.filter((s) => s.toLowerCase() !== 'none')
    topSection = [...none, ...rest.filter(isDetailed)]
    restSection = rest.filter((s) => !isDetailed(s))
  }
  const showDropdown = open && !editing && !locked && suggestions.length > 0

  // Closing the menu leaves the last measurement behind, and the next open
  // would paint one frame of it before the observer reports. Clear it during
  // render — a reset-on-state-change belongs here, not in an effect.
  const [fadeShownFor, setFadeShownFor] = useState(showDropdown)
  if (showDropdown !== fadeShownFor) {
    setFadeShownFor(showDropdown)
    if (!showDropdown) setShowMoreFade(false)
  }
  const showExpand = !locked && value.trim().length > LONG_VALUE

  // The edges that actually clip a pop-up: the most restrictive of every
  // scrollable/clipping ancestor and the viewport. Opening a panel past these
  // is what grows the scroll container (desktop) or the page (mobile), so they
  // — not the raw viewport — are what the flip decision must measure against.
  function clipEdges(el: HTMLElement): { top: number; bottom: number } {
    let top = 0
    let bottom = window.innerHeight
    for (let node = el.parentElement; node; node = node.parentElement) {
      const oy = getComputedStyle(node).overflowY
      if (oy === 'auto' || oy === 'scroll' || oy === 'hidden') {
        const r = node.getBoundingClientRect()
        top = Math.max(top, r.top)
        bottom = Math.min(bottom, r.bottom)
      }
    }
    return { top, bottom }
  }

  // Flip up only when there isn't room below for the panel AND there's more room
  // above — so a field at the foot of the column opens upward instead of
  // inflating the scroll area, but one with space below still opens downward.
  function measureDirection() {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const { top, bottom } = clipEdges(el)
    const spaceBelow = bottom - rect.bottom
    const spaceAbove = rect.top - top
    setOpenUp(spaceBelow < PANEL_MAX_HEIGHT && spaceAbove > spaceBelow)
  }

  function openEditor() {
    measureDirection()
    setOpen(false)
    setEditing(true)
  }

  // Shared vertical placement for the dropdown + editor pop-ups.
  const panelPos = openUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'

  // Recompute the "more below" fade by OBSERVING the list rather than by listing
  // the state that might have changed its height. The fade is a fact about the
  // rendered box (does the content overrun the 13rem cap?), and the row counts
  // only approximate that — a wrapped long preset, a late font, or the menu
  // flipping above the field all change the height with no state to key off. A
  // ResizeObserver catches every one of them, including the first measurement
  // when the menu opens, and it watches the rows too: the list box itself is
  // capped, so it stops resizing exactly when there IS overflow to report.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const ro = new ResizeObserver(updateFade)
    ro.observe(el)
    for (const row of Array.from(el.children)) ro.observe(row)
    return () => ro.disconnect()
    // updateFade only reads a ref and calls a stable setter, so the observer
    // can safely hold the identity it captured on the render that opened.
  }, [showDropdown, topSection.length, restSection.length])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isFilled ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <span className="text-[11px] font-medium uppercase tracking-widest text-ink-300">{label}</span>
        {defaultLocked && (
          <button
            type="button"
            onClick={() => setLocked((v) => !v)}
            className="ml-auto flex items-center gap-1 rounded-full border border-ink/[0.06] bg-ink/[0.02] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-ink-500 transition-colors hover:border-ink/10 hover:bg-ink/[0.04] hover:text-ink-300"
            title={locked ? 'Click to enable editing' : 'Click to lock the value back'}
          >
            {locked ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
            {locked ? 'Locked' : 'Unlocked'}
          </button>
        )}
      </div>
      <div ref={wrapRef} className="relative">
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => { if (!locked) { measureDirection(); setOpen(true) } }}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
          readOnly={locked}
          placeholder={placeholder ?? `Search or type ${label.toLowerCase()}...`}
          className={`w-full rounded-full border border-ink/15 bg-transparent px-4 py-2 ${showExpand ? 'pr-10' : ''} text-sm max-md:text-[13px] text-ink-100 placeholder-ink-500 outline-none transition-colors focus:border-influencers-500/40 ${locked ? 'cursor-not-allowed opacity-70' : ''}`}
        />
        {showExpand && (
          // Mousedown-preventDefault keeps the input from blurring (which would
          // race the dropdown shut) before the click opens the editor.
          <button
            type="button"
            title="Edit full text"
            aria-label="Edit full text"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openEditor}
            className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/10 hover:text-ink-100"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        )}

        {showDropdown && (
          <div
            // Keep the input focused while interacting with the panel — clicking
            // a row or dragging the scrollbar must not blur the input (which would
            // race the menu shut mid-scroll). The pick handlers close it explicitly.
            onMouseDown={(e) => e.preventDefault()}
            // wideMenu drops right-0 and spans two grid columns (2× the field +
            // the gap-x-3) so a half-width field's long presets stay readable.
            className={`absolute z-30 ${wideMenu ? 'left-0 w-[calc(200%+0.75rem)]' : 'left-0 right-0'} ${panelPos} overflow-hidden rounded-2xl border border-ink/10 bg-surface-2 shadow-2xl`}
          >
            <div ref={listRef} onScroll={updateFade} className="max-h-52 overflow-y-auto overscroll-contain menu-scroll p-1">
              {topSection.map((s) => (
                <SuggestionRow key={s} text={s} selected={s === value} starred={isDetailed(s)} wrap={wideMenu} onPick={() => { onChange(s); setOpen(false) }} />
              ))}
              {topSection.length > 0 && restSection.length > 0 && (
                <div className="mx-2 my-1 h-px bg-ink/[0.08]" />
              )}
              {restSection.map((s) => (
                <SuggestionRow key={s} text={s} selected={s === value} starred={isDetailed(s)} wrap={wideMenu} onPick={() => { onChange(s); setOpen(false) }} />
              ))}
            </div>
            {/* "More below" cue — fades out the last row when the list overflows
                and isn't scrolled to the end. Pointer-events-none so the row
                underneath stays clickable. */}
            {showMoreFade && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-9 rounded-b-2xl bg-gradient-to-t from-[var(--color-surface-2)] to-transparent"
              />
            )}
          </div>
        )}

        {editing && (
          <>
            {/* Transparent catcher so clicking anywhere outside closes the editor. */}
            <div className="fixed inset-0 z-30" onClick={() => setEditing(false)} />
            <div className={`absolute left-0 right-0 z-40 ${panelPos} rounded-2xl border border-ink/10 bg-surface-2 p-2 shadow-2xl`}>
              <textarea
                autoFocus
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
                rows={5}
                placeholder={placeholder ?? `Edit ${label.toLowerCase()}...`}
                className="w-full resize-none rounded-xl bg-transparent px-3 py-2 text-sm leading-relaxed text-ink-100 placeholder-ink-500 outline-none max-md:text-[13px]"
              />
              <div className="flex items-center justify-between gap-2 px-1 pb-0.5 pt-1">
                <span className="text-[10px] font-medium uppercase tracking-widest text-ink-500">{label}</span>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-full bg-influencers-500/15 px-3 py-1 text-[11px] font-medium text-influencers-400 transition-colors hover:bg-influencers-500/25"
                >
                  Done
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SuggestionRow({ text, selected, starred, wrap = false, onPick }: { text: string; selected: boolean; starred: boolean; wrap?: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex w-full gap-1.5 px-3 py-1.5 text-left text-[12px] transition-colors ${
        wrap ? 'items-start rounded-xl' : 'items-center rounded-full'
      } ${selected ? 'bg-ink/[0.08] text-ink-100' : 'text-ink-300 hover:bg-ink/[0.06]'}`}
    >
      {starred && <Star className={`h-3 w-3 shrink-0 fill-influencers-400 text-influencers-400 ${wrap ? 'mt-0.5' : ''}`} />}
      <span className={wrap ? 'whitespace-normal leading-snug' : 'truncate'}>{text}</span>
    </button>
  )
}
