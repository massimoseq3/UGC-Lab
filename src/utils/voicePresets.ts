// Voice profiles for the Voice box — the paragraph that rides on the end of
// every video prompt, describing WHO is speaking rather than what is on screen.
//
// Each one is a COMPLETE profile, not a template: gender and age, the accent by
// name, tone and pitch, pacing, then two or three concrete delivery quirks and
// how the read should land. A one-line "British accent" leaves the model to
// invent the rest, and what it invents is the flat, announced voice these exist
// to avoid — the same reason the Characters presets fill all 28 fields rather
// than naming one word each.
//
// They're a starting point, not a constraint: a preset REPLACES what's in the
// box and the box is a plain field afterwards, so an accent that's nearly right
// is meant to be edited.
export interface VoicePreset {
  id: string
  // What the row is scanned by — the accent, then who is speaking it.
  accent: string
  speaker: string
  // Filtered on, so it's a field rather than a substring of `speaker`.
  gender: 'Female' | 'Male'
  group: VoiceGroup
  // Three words off the profile, shown on the collapsed row. They're what makes
  // a row choosable without opening it: a truncated first sentence of a
  // paragraph that opens "Female in her mid 20s speaking with a…" says nothing
  // the row's own name hasn't already said.
  traits: [string, string, string]
  text: string
}

export type VoiceGroup = 'American' | 'British & Irish' | 'Australian'

// The picker's section order. American leads: it's the market most of these ads
// are cut for.
export const VOICE_GROUPS: VoiceGroup[] = ['American', 'British & Irish', 'Australian']

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'us-general-f',
    accent: 'General American',
    speaker: 'Female, mid 20s',
    group: 'American',
    gender: 'Female',
    traits: ['Bright', 'Upbeat', 'Quick'],
    text: 'Female in her mid 20s speaking with a neutral General American accent. Bright, friendly, and upbeat tone with a mid-to-high pitch and a smooth, easy flow. Pacing is quick but never rushed, featuring clean consonants, light vocal fry on the last few words of a sentence, and a small lift on the words that matter, so the delivery sounds like she is telling a friend about something she actually likes.',
  },
  {
    id: 'us-general-m',
    accent: 'General American',
    speaker: 'Male, early 30s',
    group: 'American',
    gender: 'Male',
    traits: ['Calm', 'Understated', 'Steady'],
    text: 'Male in his early 30s speaking with a neutral General American accent. Calm, confident, and understated tone with a mid-low pitch and a steady, even flow. Pacing is unhurried with a short beat before each conclusion, featuring crisp consonants, minimal inflection, and a level finish to every thought that makes the delivery sound like a straight recommendation rather than an ad read.',
  },
  {
    id: 'us-aave-f',
    accent: 'African American',
    speaker: 'Female, late 20s',
    group: 'American',
    gender: 'Female',
    traits: ['Warm', 'Expressive', 'Rhythmic'],
    text: 'Female in her late 20s speaking with a contemporary African American English accent. Warm, expressive, and full-toned with a mid pitch and a relaxed, rhythmic flow. Pacing moves in waves, quick through the setup and slowing to land the point, featuring rounded vowels, playful emphasis on the key word of each sentence, and a knowing half-smile in the voice that makes the delivery sound completely unscripted.',
  },
  {
    id: 'us-aave-m',
    accent: 'African American',
    speaker: 'Male, early 30s',
    group: 'American',
    gender: 'Male',
    traits: ['Smooth', 'Laid-back', 'Assured'],
    text: 'Male in his early 30s speaking with a contemporary African American English accent. Smooth, laid-back, and self-assured with a mid-low pitch and a loose, rhythmic flow. Pacing is unhurried with a deliberate pause before the payoff, featuring relaxed consonant endings, a light melodic rise on emphasis, and an easy conversational finish that sounds like he is talking to you, not reading to you.',
  },
  {
    id: 'us-south-f',
    accent: 'Southern US',
    speaker: 'Female, early 30s',
    group: 'American',
    gender: 'Female',
    traits: ['Warm', 'Unhurried', 'Drawled'],
    text: 'Female in her early 30s speaking with a Southern American accent from Texas. Warm, welcoming, and unhurried with a mid pitch and a soft, rounded flow. Pacing is slow and generous with drawn-out vowels, featuring dropped Gs on -ing endings, a gentle rise on questions, and a comfortable finish to each thought that makes the delivery sound like a conversation across a kitchen counter.',
  },
  {
    id: 'us-cali-f',
    accent: 'Californian',
    speaker: 'Female, early 20s',
    group: 'American',
    gender: 'Female',
    traits: ['Casual', 'Breathy', 'Uptalk'],
    text: 'Female in her early 20s speaking with a Californian American accent. Bright, casual, and slightly breathy with a high-mid pitch and a loose, unpolished flow. Pacing is quick with words running into each other, featuring uptalk at the end of most sentences, vocal fry on the final words, and very informal phrasing that makes the delivery sound like a voice note sent to a friend.',
  },
  {
    id: 'us-nyc-m',
    accent: 'New York',
    speaker: 'Male, late 30s',
    group: 'American',
    gender: 'Male',
    traits: ['Fast', 'Blunt', 'Driving'],
    text: 'Male in his late 30s speaking with a New York City accent. Fast, blunt, and full of conviction with a mid pitch and a driving, forward flow. Pacing is rapid with almost no pause between thoughts, featuring hard consonants, flattened vowels, and rising emphasis stacked across a sentence that makes the delivery sound like he is arguing a point he genuinely believes.',
  },
  {
    // Massimo's own reference profile, kept verbatim — it is the register every
    // other entry here was written against.
    id: 'uk-london-f',
    accent: 'London',
    speaker: 'Female, late 20s',
    group: 'British & Irish',
    gender: 'Female',
    traits: ['Bright', 'Conversational', 'Snappy'],
    text: 'Female in her late 20s speaking with a native London, modern Estuary English accent. Bright, warm, and conversational tone with mid-to-high pitch and a light, effortless flow. Pacing is snappy yet relaxed, featuring subtle London vowel softening, clean vocal cadence, and a subtle rising intonation at the ends of thoughts that makes the delivery sound completely unscripted and like a chat with a close friend.',
  },
  {
    id: 'uk-london-m',
    accent: 'London',
    speaker: 'Male, early 30s',
    group: 'British & Irish',
    gender: 'Male',
    traits: ['Dry', 'Easy-going', 'Measured'],
    text: 'Male in his early 30s speaking with a native London, modern Estuary English accent. Dry, easy-going tone with a mid-low pitch and a relaxed, unhurried flow. Pacing is measured with a short pause before the point lands, featuring glottal stops on hard consonants, softened vowels, and a flat, matter-of-fact finish to each thought that makes the delivery sound like advice from a mate rather than a pitch.',
  },
  {
    id: 'uk-north-f',
    accent: 'Northern English',
    speaker: 'Female, early 30s',
    group: 'British & Irish',
    gender: 'Female',
    traits: ['Blunt', 'Good-humoured', 'Brisk'],
    text: 'Female in her early 30s speaking with a native Northern English accent from Manchester. Warm, blunt, and good-humoured with a mid pitch and a firm, grounded flow. Pacing is brisk and forward-leaning, featuring flat northern vowels, clipped word endings, and a gentle downward inflection that lands each point as plain fact rather than as a sell.',
  },
  {
    id: 'ie-dublin-f',
    accent: 'Irish',
    speaker: 'Female, late 20s',
    group: 'British & Irish',
    gender: 'Female',
    traits: ['Animated', 'Lilting', 'Fast'],
    text: 'Female in her late 20s speaking with a native Dublin, Irish accent. Bright, animated, and quick-witted with a mid-to-high pitch and a musical, lilting flow. Pacing is fast and spills slightly from one sentence into the next, featuring soft Irish consonants, a rising lilt through the middle of a thought, and a warm laugh sitting under the words that makes the delivery sound completely off the cuff.',
  },
  {
    id: 'uk-glasgow-m',
    accent: 'Scottish',
    speaker: 'Male, early 30s',
    group: 'British & Irish',
    gender: 'Male',
    traits: ['Direct', 'Dry', 'Punchy'],
    text: 'Male in his early 30s speaking with a native Glaswegian, Scottish accent. Warm, direct, and dryly funny with a mid-low pitch and a punchy, rhythmic flow. Pacing is quick with a hard stop at the end of each point, featuring rolled Rs, clipped vowels, and a rising-then-falling cadence that makes the delivery sound like he is genuinely telling you something rather than reading it out.',
  },
  {
    id: 'au-f',
    accent: 'Australian',
    speaker: 'Female, late 20s',
    group: 'Australian',
    gender: 'Female',
    traits: ['Sunny', 'Relaxed', 'Open'],
    text: 'Female in her late 20s speaking with a native Australian accent. Sunny, relaxed, and easy-going with a mid-to-high pitch and a bright, open flow. Pacing is unhurried and conversational, featuring broad Australian vowels, a rising inflection at the end of statements, and a light laugh under the words that makes the delivery sound completely off the cuff.',
  },
  {
    id: 'au-m',
    accent: 'Australian',
    speaker: 'Male, early 30s',
    group: 'Australian',
    gender: 'Male',
    traits: ['Dry', 'Understated', 'Loose'],
    text: 'Male in his early 30s speaking with a native Australian accent. Dry, understated, and friendly with a mid-low pitch and a loose, casual flow. Pacing is relaxed with a flat, throwaway delivery on the lines that matter most, featuring broad vowels, clipped sentence endings, and almost no salesmanship in the tone, so it sounds like a mate telling you what actually worked.',
  },
]
