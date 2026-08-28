import type { CSSProperties, ElementType, ReactNode } from 'react'

// The macOS widget material, in one place. Everything on the Dashboard desktop
// — stat widgets, the Academy link, the connect-key banner, the desktop icons —
// is cut from it, which is what makes the surface read as one system rather
// than a page of cards.
//
// Three layers do the work: a translucent fill over the wallpaper, a
// backdrop-blur so the blooms behind bleed through, and a 1px inner top
// highlight that gives the glass an edge to catch light on. Light mode swaps
// the fill to white and drops the highlight for a soft drop shadow — a dark
// translucent tile on a bright wallpaper reads as a hole, not a pane.

export const WIDGET_SHELL =
  'rounded-[26px] border border-ink/10 bg-ink/[0.045] backdrop-blur-2xl backdrop-saturate-150 ' +
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_24px_50px_-30px_rgba(0,0,0,0.95)] ' +
  'light:border-black/[0.05] light:bg-white/70 light:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_14px_34px_-18px_rgba(0,0,0,0.22)]'

/** Hover treatment for widgets that are also controls (links, launchers). */
export const WIDGET_INTERACTIVE =
  'transition-[transform,background-color,border-color,box-shadow] duration-200 ' +
  'hover:-translate-y-0.5 hover:bg-ink/[0.075] hover:border-ink/15 light:hover:bg-white/90'

/* ---- Shortcut tile ----
   The two cards that end the widget wall — Announcements and Academy — are the
   same card twice (icon disc, title, sub-line), one a button and one a link, so
   their shape lives here rather than being written out twice and drifting.

   It has TWO layouts, and which one applies is about the tile's proportions,
   not the screen's size:
     · a centred column below `sm` and again from `lg`, where the card is
       roughly as tall as it is wide — a phone's half-bento square, and the
       desktop's own column in the wall's second row.
     · an icon-left row in between, where the pair share one full-width bento
       row and each card is wide and short.
   They were stacked in one narrow slot on the desktop until August 2026, on the
   reasoning that a column each left them too narrow to title and pushed Activity
   below the width its 26-week grid needs. Dropping the heatmap's legend paid for
   both (Massimo's call). */
export const SHORTCUT_TILE =
  'widget-rise group relative flex items-center gap-2.5 p-3.5 ' +
  'max-sm:aspect-square max-sm:flex-col max-sm:justify-center max-sm:gap-3 max-sm:text-center ' +
  'lg:flex-col lg:justify-center lg:gap-3 lg:text-center'

/** The tile's accent glyph disc — bigger in both centred layouts. */
export const SHORTCUT_TILE_DISC =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-dashboard-500/15 ' +
  'max-sm:h-11 max-sm:w-11 max-sm:rounded-[15px] lg:h-11 lg:w-11 lg:rounded-[15px]'

/** The glyph inside that disc. */
export const SHORTCUT_TILE_GLYPH = 'h-[18px] w-[18px] max-sm:h-6 max-sm:w-6 lg:h-6 lg:w-6'

/** The text column beside (or under) the disc. */
export const SHORTCUT_TILE_TEXT = 'min-w-0 flex-1 max-sm:flex-none lg:flex-none'

/* Truncation is for the ROW layout only. There the card is half a row tall and
   a wrapped second title line pushes the sub-line clean out of the box; in
   either centred layout the card has the height for two lines and none of the
   width to lose to an ellipsis, so `lg:` puts the wrapping back. */
const SHORTCUT_TILE_WRAP = 'sm:truncate lg:overflow-visible lg:text-clip lg:whitespace-normal'
export const SHORTCUT_TILE_TITLE =
  `block text-[15px] italic font-normal leading-tight tracking-tight text-ink-50 ${SHORTCUT_TILE_WRAP}`
export const SHORTCUT_TILE_SUB = `mt-0.5 block text-[11px] leading-snug ${SHORTCUT_TILE_WRAP}`

/** Display face for every figure on the desktop — the app's Instrument Serif. */
export const DISPLAY_FONT = { fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }

/** Stagger step between widgets, in ms. */
const RISE_STEP = 55

export function riseStyle(index: number): CSSProperties {
  return { animationDelay: `${index * RISE_STEP}ms` }
}

interface WidgetProps {
  /** Position in the load stagger. */
  index?: number
  className?: string
  pad?: string
  children: ReactNode
}

export default function Widget({ index = 0, className = '', pad = 'p-4', children }: WidgetProps) {
  return (
    <section className={`widget-rise relative flex flex-col ${WIDGET_SHELL} ${pad} ${className}`} style={riseStyle(index)}>
      {children}
    </section>
  )
}

/** Top-left caption: what this widget measures. Optional value on the right. */
export function WidgetLabel({ icon: Icon, label, note }: { icon: ElementType; label: string; note?: string }) {
  return (
    // Centred on a PHONE only. From `sm` this is the row it has always been —
    // icon + label at the left edge, note pushed to the right by `ml-auto` —
    // because the centring is a bento treatment for a half-width tile, not a
    // change to the desktop wall. (It doesn't cost the note anything either:
    // the note only renders from `sm`, so on the phone there is nothing beside
    // the label to knock it off centre.)
    <div className="flex w-full items-center gap-1.5 max-sm:justify-center">
      {/* Monochrome, and sized to the word beside it. It was 15px in the
          dashboard green, which made the glyph the loudest thing in an eyebrow
          whose whole job is to be quiet — and a 15px icon against 11px caps
          sits taller than the letters it labels, so every label read as
          slightly off its own baseline. 13px in the label's own ink hangs the
          two on one optical line. */}
      <Icon className="h-[13px] w-[13px] shrink-0 text-ink-300" strokeWidth={1.75} />
      {/* The same eyebrow every field label in the app wears (`SectionLabel`
          in components/SectionCard — Characters' GENDER / AGE RANGE, the Bank
          forms, the B-Roll cards): 11px, medium, ink-300. It read as its own
          thing here — semibold, a step dimmer — which is one house style too
          many for a word that does the same job in both places.
          The ONE thing it does differently is tracking: `0.07em` against
          `SectionLabel`'s `widest` (Massimo's call, August 2026). A field label
          sits over a form and has a whole column to be spaced across; these
          sit at the top of a half-width bento tile beside a 13px glyph, where
          `0.1em` pushed TIME SAVED / ACTIVITY out to the tile's edges and read
          as stretched rather than as quiet. */}
      <span className="whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.07em] text-ink-300">{label}</span>
      {/* The note is the first thing to go in a bento tile: at half a phone's
          width it left "MONEY SAVED" wrapping to two lines to make room for a
          credit count truncated to "1,261 …", which is neither fact. */}
      {note && <span className="ml-auto hidden truncate text-[11px] tabular-nums text-ink-600 sm:block">{note}</span>}
    </div>
  )
}

/** The headline number, with an optional rolling-week delta beside it. */
export function WidgetFigure({ value, delta, size = 'hero' }: { value: string; delta?: string; size?: 'hero' | 'small' }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 max-sm:justify-center">
      <p
        // The hero shrinks below `sm`, where the tile is half a phone's width:
        // "459 hrs" at 48px is wider than the box it sits in.
        className={`italic font-normal tracking-tight text-ink-50 ${size === 'hero' ? 'text-[34px] leading-none sm:text-5xl sm:leading-normal lg:text-[56px] lg:leading-[1.05]' : 'text-[32px] leading-none'}`}
        style={DISPLAY_FONT}
      >
        {value}
      </p>
      {delta && (
        <span className="rounded-full bg-dashboard-500/15 px-2 py-0.5 text-[11px] font-semibold text-dashboard-400 light:bg-dashboard-500/12">
          {delta}
        </span>
      )}
    </div>
  )
}
