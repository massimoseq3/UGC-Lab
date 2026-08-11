// Everything about a visual style that ISN'T a component: its preview artwork
// and the per-app accent palettes the style cards are painted in.
//
// These lived in StyleModal.tsx alongside the modal itself, which meant every
// host importing an accent also imported the whole modal, and the file exported
// four constants beside its components (which is what react-refresh warns
// about — a module mixing the two can't hot-reload cleanly). Playground lists
// the same styles inside its own presets panel without opening StyleModal at
// all, so the split had to happen anyway.

// Preview art for the built-in styles — the same scene rendered in each look, so
// any grid of them reads as one comparison set. Pre-scaled to ~640px JPEG (the
// cards are ~137px wide) and keyed by style id, exactly like the Characters
// preset portraits. Kept out of `utils/visualStyle.ts` on purpose: that file is
// imported by prompt builders and services that have no business pulling
// bundler asset URLs. A style with no entry falls back to the palette glyph.
import ugcPreview from '../assets/stylePresets/ugc.jpg'
import zack3dPreview from '../assets/stylePresets/zack-3d.jpg'
import clayPreview from '../assets/stylePresets/clay.jpg'
import brickPreview from '../assets/stylePresets/brick.jpg'
import paperPreview from '../assets/stylePresets/paper.jpg'
import animePreview from '../assets/stylePresets/anime.jpg'
import cartoonPreview from '../assets/stylePresets/cartoon.jpg'

export const STYLE_PREVIEWS: Record<string, string> = {
  ugc: ugcPreview,
  'zack-3d': zack3dPreview,
  clay: clayPreview,
  brick: brickPreview,
  paper: paperPreview,
  anime: animePreview,
  cartoon: cartoonPreview,
}

// Per-app accent classes. Tailwind can't build class names at runtime (the JIT
// only sees literal strings), so each host passes its family's classes whole
// rather than an accent name the component interpolates.
export interface StyleModalAccent {
  /** Selected card: border + fill. */
  card: string
  /** Solid accent chip/badge (the Check bubble). */
  solid: string
  /** Solid accent button, with its hover. */
  button: string
  /** Icon bubble on a selected card. */
  iconOn: string
  /** Selected card's title text. */
  titleOn: string
  /** "Custom style in use" banner: border + fill. */
  banner: string
  /** That banner's eyebrow label. */
  bannerLabel: string
  /** Dashed drop-zone in its active state. */
  dropActive: string
}

export const BROLL_STYLE_ACCENT: StyleModalAccent = {
  card: 'border-broll-500/40 bg-broll-500/10',
  solid: 'bg-broll-500',
  button: 'bg-broll-500 hover:bg-broll-400',
  iconOn: 'bg-broll-500/20 text-broll-300',
  titleOn: 'text-broll-200',
  banner: 'border-broll-500/25 bg-broll-500/10',
  bannerLabel: 'text-broll-300',
  dropActive: 'border-broll-500/50 bg-broll-500/10',
}

export const INFLUENCERS_STYLE_ACCENT: StyleModalAccent = {
  card: 'border-influencers-500/40 bg-influencers-500/10',
  solid: 'bg-influencers-500',
  button: 'bg-influencers-500 hover:bg-influencers-400',
  iconOn: 'bg-influencers-500/20 text-influencers-300',
  titleOn: 'text-influencers-200',
  banner: 'border-influencers-500/25 bg-influencers-500/10',
  bannerLabel: 'text-influencers-300',
  dropActive: 'border-influencers-500/50 bg-influencers-500/10',
}

// Playground doesn't open the full StyleModal — it lists the same styles inside
// its own presets panel — but its tiles take the same accent shape so one
// component draws every style card in the app.
export const PLAYGROUND_STYLE_ACCENT: StyleModalAccent = {
  card: 'border-playground-500/40 bg-playground-500/10',
  solid: 'bg-playground-500',
  button: 'bg-playground-500 hover:bg-playground-400',
  iconOn: 'bg-playground-500/20 text-playground-300',
  titleOn: 'text-playground-200',
  banner: 'border-playground-500/25 bg-playground-500/10',
  bannerLabel: 'text-playground-300',
  dropActive: 'border-playground-500/50 bg-playground-500/10',
}
