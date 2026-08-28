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

/** Centred caption: what this widget measures. */
export function WidgetLabel({ icon: Icon, label }: { icon: ElementType; label: string }) {
  return (
    // Centred at EVERY width (August 2026, Massimo's call). It was a left-edge
    // row on the desktop and centred only below `sm`, back when the wall was
    // three tile widths; now that every tile is the same four-column block the
    // whole wall centres, and a label sitting at the left edge of one of six
    // identical squares reads as the odd one out.
    //
    // It carries no trailing note any more. Money saved's credit count was the
    // only one, and a note in this row is exactly what a centred label can't
    // have — `ml-auto` pushes the label off centre by half the note's width.
    <div className="flex w-full items-center justify-center gap-1.5">
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
    </div>
  )
}

/**
 * The rolling-seven-day delta, as a pill on its own line UNDER the figure and
 * its caption (Massimo's call, August 2026). It used to sit on the figure's own
 * baseline, which worked only while the tile was wide enough for both: in a
 * four-column tile it wrapped under a 56px hero and read as that number's
 * caption, displacing the real one. Its own line ends the block instead — total,
 * what the total means, then what the last week added.
 */
export function WidgetDelta({ children }: { children: ReactNode }) {
  return (
    // Gone below `sm`, like every other second line in a bento tile: the pill's
    // own row costs the wall ~26px, and the phone wall has to fit one screen
    // alongside the dock. The running total is the figure above it either way.
    <span className="mt-2 hidden rounded-full bg-dashboard-500/15 px-2 py-0.5 text-[11px] font-semibold text-dashboard-400 light:bg-dashboard-500/12 sm:inline-block">
      {children}
    </span>
  )
}

/** The headline number. */
export function WidgetFigure({ value, size = 'hero' }: { value: string; size?: 'hero' | 'small' }) {
  return (
    <p
      // The hero shrinks below `sm`, where the tile is half a phone's width:
      // "459 hrs" at 48px is wider than the box it sits in.
      className={`italic font-normal tracking-tight text-ink-50 ${size === 'hero' ? 'text-[34px] leading-none sm:text-5xl sm:leading-normal lg:text-[56px] lg:leading-[1.05]' : 'text-[32px] leading-none'}`}
      style={DISPLAY_FONT}
    >
      {value}
    </p>
  )
}
