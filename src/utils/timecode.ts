// How long a beat RUNS, worked out from the timecode range it's labelled with.
//
// A scene header says "00:25–00:40", which is where the beat sits in the ad —
// but the number a member actually needs is how many seconds of footage that
// is, because it's what a clip gets generated at (and what every video model is
// priced and capped by). Leaving them to subtract two clock times per scene is
// arithmetic the label can do itself.
//
// Shared by Scripts' scene headers and the Ad Analyzer's beat pills, which show
// the same ranges from the same blueprints — two copies of this would drift.
const RANGE = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/

// Plain seconds at every length ("90s", not "1m 30s"): a beat is short by
// definition, and seconds are the unit the rest of the pipeline speaks in.
export function rangeDurationLabel(time: string): string | null {
  const parts = RANGE.exec(time.trim())
  if (!parts) return null
  const start = Number(parts[1]) * 60 + Number(parts[2])
  const end = Number(parts[3]) * 60 + Number(parts[4])
  const seconds = end - start
  // A lone stamp has no duration, and a model that writes its range backwards
  // (or twice the same time) gets no label rather than "0s" or a negative one.
  return seconds > 0 ? `${seconds}s` : null
}
