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

export interface ReverseEngineeredPrompt {
  totalDurationSeconds: number
  isSingleClip: boolean
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
