// The voice-consistency spec — one dense paragraph describing HOW a speaker
// sounds, detailed enough that the same person comes back every time it's
// handed to a voice actor, a TTS engine, or a video model.
//
// Lives in utils/ rather than inside an app because two apps now emit it and
// they must agree: Scripts WRITES one at the end of a scene blueprint (so every
// clip in an ad is read by the same voice), and the Ad Analyzer READS one off
// an existing ad (so a member remixing a winner can reproduce its voice). One
// wording, so a profile from either surface drops into the other unchanged.
//
// B-Roll keeps its own phrasing inside the <VOICE_PROFILE> block of
// generateBroll.ts — it's written against that prompt's own character contract.
export const VOICE_PROFILE_SPEC = `VOICE — describe, in rich and reproducible detail, HOW the speaker sounds, so the exact same voice can be reused across every video. Cover: the perceived age and gender of the voice, accent / region, pitch (low / mid / high), pace (slow, measured, fast), texture (warm, raspy, breathy, smooth, nasal, gravelly), energy (calm, hyped, deadpan, bubbly), and 1-2 signature quirks (uptalk, slight vocal fry, a laugh living in the voice, clipped consonants). Write it as one dense paragraph you could hand to a voice actor or a TTS engine and get the same person every single time. Describe ONLY the sound — never physical appearance.`
