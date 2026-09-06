// The one palette for a "what kind of script is this" pill, and the one shape
// it is drawn in.
//
// Three surfaces show the same badge and they must not drift: Scripts' history
// rail, the Bank's Scripts tab, and the Select Script picker. They were three
// hand-written class strings — the rail's a SOLID accent with white text, the
// other two a 15%-alpha wash with tinted text and a border — so the same run
// read as two different things depending on where you met it (Massimo's call,
// September 2026: "update those pills to match how we have it in the scripts
// tab, do the same in the bank").
//
// SOLID and opaque is the half that matters. A 9px label over a 15%-alpha wash
// takes its colour from whatever is behind it, so one badge read three ways
// across a hovered card, a selected one and a plain one; white on a solid
// accent is the same badge everywhere, in both themes.
//
// The hues are the app's own and one of them is load-bearing beyond this file:
// **fuchsia Scenes is also the Ad Analyzer's Reverse-Engineered Scenes
// heading**, so a scene blueprint reads as the same thing in the app that
// reverse-engineers one, the app that rewrites it and the bank that stores it.
// Change it here and change it there (`ad-anatomy/components/ResultsView.tsx`).
export const SCRIPT_BADGE = {
  hooks: 'bg-amber-600 text-white',
  remix: 'bg-scripts-500 text-white',
  scenes: 'bg-fuchsia-600 text-white',
  cinematic: 'bg-sky-600 text-white',
  style: 'bg-sky-600 text-white',
  script: 'bg-emerald-600 text-white',
} as const

export type ScriptBadgeKind = keyof typeof SCRIPT_BADGE

// The pill itself. `tracking-[0.04em]`, not `tracking-widest`: on a 9.5px
// uppercase label the wider setting spends most of the pill's width on air
// between letters. No border — a solid fill needs no outline, and the two
// bank surfaces were drawing one over a wash that had nothing to separate.
export const SCRIPT_BADGE_SHAPE =
  'w-fit max-w-full truncate rounded-full px-2 py-[3px] text-[9.5px] font-bold uppercase leading-none tracking-[0.04em]'
