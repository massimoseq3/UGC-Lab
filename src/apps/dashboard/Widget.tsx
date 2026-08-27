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
          forms, the B-Roll cards): 11px, medium, `tracking-widest`, ink-300.
          It read as its own thing here — semibold, tighter tracking, a step
          dimmer — which is one house style too many for a word that does the
          same job in both places. */}
      <span className="whitespace-nowrap text-[11px] font-medium uppercase tracking-widest text-ink-300">{label}</span>
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
