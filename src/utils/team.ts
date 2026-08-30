import type { CrabVariant } from '../components/CrabSprite'

// The crab crew — shared by the Meet the Team intro (full cards) and the
// dock (hover reveals the persona name). One entry per dock app, dock order.

export interface TeamMember {
  appId: CrabVariant
  name: string
  role: string
  blurb: string
  // Role labels use the app accent; apps whose accent is too dark to read on
  // a dark surface (Playground's teal, Scripts' navy) override with a brighter
  // tint here. Anything under ~4:1 against surface-1 needs one.
  roleColor?: string
}

export const TEAM: TeamMember[] = [
  {
    appId: 'finder',
    name: 'Sandy',
    role: 'Studio Manager',
    blurb: 'Keeps every product, character, script and clip filed and ready to reuse.',
  },
  {
    appId: 'character-studio',
    name: 'Clawdia',
    role: 'Casting Director',
    blurb: 'Casts consistent characters you can book again and again.',
  },
  {
    appId: 'script-architect',
    name: 'Pinchy',
    role: 'Copywriter',
    blurb: 'Writes and remixes the words that sell, in any length or style.',
    // Scripts' navy (#24365A) measures ~1.65:1 against the dark surface — the
    // label was effectively invisible. This is the same periwinkle as the
    // `--color-scripts-text` token, which exists for exactly this reason.
    // Keep the two in step.
    roleColor: '#A9C4FF',
  },
  {
    appId: 'voice-studio',
    name: 'Echo',
    role: 'Voice Actor',
    blurb: 'Reads your script out loud in any of dozens of voices.',
  },
  {
    appId: 'broll-studio',
    name: 'Bubbles',
    role: 'Videographer',
    blurb: 'Turns scripts into scenes and shoots four takes of every one.',
  },
  {
    appId: 'playground',
    name: 'Sebastian',
    role: 'Creative Director',
    blurb: 'The do-anything senior for freeform images, video and music on demand.',
    roleColor: '#1FA08C',
  },
  {
    appId: 'edit-studio',
    name: 'Snips',
    role: 'Video Editor',
    blurb: 'Cuts your script, voiceover and B-roll into a finished captioned ad.',
  },
  {
    appId: 'discover',
    name: 'Pearl',
    role: 'Trend Spotter',
    blurb: 'Finds the ads already winning and files them in your swipe file.',
  },
  {
    appId: 'ad-anatomy',
    name: 'Scout',
    role: 'Strategist',
    blurb: 'Tears down winning ads and tells you exactly why they work.',
  },
]

export function getTeamMember(appId: string): TeamMember | undefined {
  return TEAM.find((m) => m.appId === appId)
}
