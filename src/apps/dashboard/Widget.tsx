import type { ElementType, ReactNode } from 'react'
import { WIDGET_SHELL, riseStyle, DISPLAY_FONT } from './widgetStyles'

// The widget shell components. The material they are cut from (fills,
// hover treatment, display face, load stagger) lives in ./widgetStyles.

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
