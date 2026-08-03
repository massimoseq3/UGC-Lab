export interface ScoreItem {
  label: string
  score: number
}

export interface Scorecard {
  scores: ScoreItem[]
  analystNote: string
}

export interface TranscriptLine {
  timestamp: string
  text: string
}

export interface Scene {
  index: number
  startTime: string
  endTime: string
  durationSeconds: number
  label: string
  prompt: string
}

// The ad's look, stated ONCE for the whole recreation. Every scene prompt is
// self-contained (it has to be — one scene is one clip, fired on its own), but
// the look is the thing that must not drift between them, so it also rides
// outside them as a master block: the same contract as B-Roll's storyboard-wide
// <STYLE>, and the same shape as a `styles` bank row, so it can be saved and
// re-used to render a member's own ad in the analysed ad's look.
export interface MasterVisualStyle {
  // A live `CONTINUOUS_STYLES` id when the ad matches one of the app's own
  // families, otherwise 'other' — never a retired id, since this is what the
  // UI badges and what a future B-Roll handoff would pick with.
  styleId: string
  // The family's name, or a free descriptor when styleId is 'other'.
  label: string
  // True for live-action footage of real people and things; false for anything
  // rendered, drawn, or AI-animated. This is the "UGC realism or animation?"
  // question the member is actually asking, answered on its own.
  liveAction: boolean
  // The style paragraph — same five axes and the same subject-free contract as
  // `STYLE_BRIEF_SPEC`, so it drops into the styles bank unchanged.
  brief: string
}

// How the ad SOUNDS, stated once. Reproduces the original read across every
// clip. Same wording contract as the VOICE PROFILE block Scripts emits at the
// end of a scene blueprint (utils/voiceProfile.ts), so the two are
// interchangeable. Absent when the ad has no speech at all.
export interface MasterVoiceProfile {
  // 3-6 word descriptor of the voice — the row's title.
  label: string
  // 3-6 scannable attributes ("Female, late 20s", "General American",
  // "Fast, clipped", "Slight vocal fry") — the paragraph's headline facts.
  traits: string[]
  // Who is speaking and from where: on-camera creator, off-camera voiceover,
  // a second interviewer voice. Reproduction gets this wrong constantly.
  delivery: string
  // The dense reproducible paragraph — sound only, never appearance.
  profile: string
}

export interface ReverseEngineeredPrompt {
  totalDurationSeconds: number
  isSingleClip: boolean
  // Both master blocks are optional: legacy persisted results predate them,
  // and an ad with no speech has no voice to profile.
  masterVisualStyle?: MasterVisualStyle
  masterVoiceProfile?: MasterVoiceProfile
  scenes: Scene[]
}

// Strategy-level dissection of why the ad works (vs. the shot-level scenes).
// It carried a fourth field, `stylePrompt` — a product-agnostic writing brief
// saveable to the Script Bank as `kind: 'style'`. Cut July 2026: it read as a
// generic list of DTC platitudes whichever ad went in, because stripping every
// concrete detail is what made it reusable. Rows already saved to the bank
// still render; nothing produces new ones. See git history to restore.
export interface CreativeBreakdown {
  hook: string
  angle: string
  // Beat-by-beat skeleton, one beat per line ("MM:SS–MM:SS BEAT — role").
  structure: string
}

// The analysis is ONE chat call returning this whole object. A two-pass split
// (perception → synthesis, with its own Shot / PerceptionResult / SynthesisResult
// shapes) shipped in July 2026 and was reverted the same month — every analysis
// came back rejected. See the note at the top of services/analyzeAd.ts.
export interface AnalysisResult {
  // 3–6 word descriptor of the ad — used as the History row title and
  // as the auto-name stem for Script Bank saves. Title Case, no trailing
  // punctuation. May be missing on legacy persisted results; callers
  // should fall back to fileName.
  adTitle: string
  scorecard: Scorecard
  // Missing on legacy persisted results — render only when present.
  creativeBreakdown?: CreativeBreakdown
  transcript: TranscriptLine[]
  reverseEngineeredPrompt: ReverseEngineeredPrompt
}
