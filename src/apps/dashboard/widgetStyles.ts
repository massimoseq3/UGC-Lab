import type { CSSProperties } from 'react'

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
//
// These live beside Widget.tsx rather than in it: a file that exports both a
// component and a plain constant loses React Fast Refresh, and every edit to a
// widget would full-reload the page instead of hot-swapping.

export const WIDGET_SHELL =
  'rounded-[26px] border border-ink/10 bg-ink/[0.045] backdrop-blur-2xl backdrop-saturate-150 ' +
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_24px_50px_-30px_rgba(0,0,0,0.95)] ' +
  'light:border-black/[0.05] light:bg-white/70 light:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_14px_34px_-18px_rgba(0,0,0,0.22)]'

/** Hover treatment for widgets that are also controls (links, launchers). */
export const WIDGET_INTERACTIVE =
  'transition-[background-color,border-color,box-shadow] duration-200 ' +
  'hover:bg-ink/[0.075] hover:border-ink/15 light:hover:bg-white/90'

/** Display face for every figure on the desktop — the app's Instrument Serif. */
export const DISPLAY_FONT = { fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }

/** Stagger step between widgets, in ms. */
const RISE_STEP = 55

export function riseStyle(index: number): CSSProperties {
  return { animationDelay: `${index * RISE_STEP}ms` }
}
