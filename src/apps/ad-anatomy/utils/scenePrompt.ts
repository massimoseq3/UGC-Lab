// A scene prompt comes back as ONE long paragraph — the analyser's contract
// (services/analyzeAd.ts) asks for a `[0:00–0:03]` marker per camera cut, the
// shot's direction in prose, and every spoken line quoted verbatim inside it.
// That is the right shape to paste into a video model and the wrong shape to
// read: eight sentences of camera geometry with the dialogue buried mid-clause.
// So the card splits the prompt back into the beats it was written as.
//
// Nothing here rewrites the prompt. Copy still hands over `scene.prompt`
// untouched, because that string is the artifact — this is a reading of it.
//
// It deliberately does NOT share Scripts' `splitSpokenLines`: that parser is
// written against Scripts' own contract (`[CHARACTER] says: "…"`, always double
// quotes, always a colon), while the analyser transcribes what it heard — single
// or double quotes, `says,` as often as `says:`, plus quoted ON-SCREEN text
// that is not dialogue at all. One parser bent to serve both would loosen the
// Scripts one, which is the parser holding the tighter contract.

export type SceneSegment =
  | { kind: 'direction'; text: string }
  // A verbatim quote lifted out of the direction. 'speech' is someone talking;
  // 'screen' is burned-in text the analyser transcribed ("Spanish text at top:
  // '…'"). Both are quoted verbatim, but only one gets read aloud, so they
  // don't render alike.
  | { kind: 'quote'; variant: 'speech' | 'screen'; speaker: string | null; text: string }

export interface SceneBeat {
  // "0:00–0:03" (or a lone "0:13"), normalised to an en dash. Null for a beat
  // the model wrote without a marker — a single-shot scene is one untimed beat,
  // which renders as the plain paragraph it always did.
  time: string | null
  segments: SceneSegment[]
}

// `[0:00-0:03]`, `[00:00–00:02]`, or a lone `[0:13]`. Parens are accepted too:
// the prompt asks for brackets and the model mostly obeys, but a beat marker
// that renders as body prose is worse than one matched too eagerly.
const BEAT_MARKER = /[[(](\d{1,2}:\d{2})(?:\s*[-–—]\s*(\d{1,2}:\d{2}))?[\])]/g

const SPEECH_VERBS = 'says?|said|adds?|asks?|replies|replied|continues?|whispers?|shouts?|states?|reads?|announces?|narrates?'
// A speaker noun that stands in for the verb — "VO: '…'", "Voiceover: '…'".
const NOUN_CUES = 'voice\\s*-?\\s*overs?|voiceovers?|vo|narrator'
// The hand-off into a quote, ending right before the opening quote mark. The
// lead can't cross a sentence boundary, so it only ever picks up the clause
// that actually introduces the line. The bare-colon branch is what catches
// on-screen text ("White text at the top: '…'"); it only survives below if the
// lead names something written rather than someone speaking.
const ATTRIBUTION = new RegExp(
  `([^.;!?\\n]{0,80}?)(?:\\b(${SPEECH_VERBS}|${NOUN_CUES})\\b\\s*[:,]?|:)\\s*(?=["“'‘])`,
  'gi',
)
const NOUN_CUE_ONLY = new RegExp(`^(?:${NOUN_CUES})$`, 'i')
// A cue anywhere in the lead, for the colon branch: the clause often runs on
// past the verb before it hands over ("The voiceover continues over the shot:").
const SPEECH_LEAD = new RegExp(`\\b(?:${SPEECH_VERBS}|${NOUN_CUES})\\b`, 'i')
// Words that mean the quote is written on screen, not spoken.
const SCREEN_CUE = /\b(?:text|caption|overlay|subtitle|title\s*card|sticker|headline|banner|words|label|watermark)\b/i
// What's left dangling on the direction once its attribution is cut away.
const TRAILING_CONNECTIVE = /[\s,;:]*\b(?:and|then|as|while|before|after)\s*$/i

// The closing mark for the quote opening at `open`. Single quotes need the
// guard: the analyser's prose is full of possessives and contractions ("the
// woman's knee", "don't"), so an apostrophe followed by a letter is never the
// end of a line. Returns null for an unterminated quote — that text is left in
// the direction rather than swallowed whole.
function closingQuote(text: string, open: number): number | null {
  const double = text[open] === '"' || text[open] === '“'
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i]
    const closes = double ? c === '"' || c === '”' : c === "'" || c === '’'
    if (!closes) continue
    if (!double && /[A-Za-z]/.test(text[i + 1] ?? '')) continue
    return i
  }
  return null
}

// A word that can't be part of a speaker label — it means the clause is prose
// running into the cue ("He looks up at her and says") rather than a name.
const NOT_A_SPEAKER = /^(?:and|then|but|or|as|while|who|which|that)$/i

// Split the introducing clause into the label and the prose that isn't part of
// it. Only the last few words before the cue can be a speaker: "She", "The
// voiceover", "White text on screen" are labels, while "The voiceover, which
// stays calm throughout," is prose that happens to end in a cue. When the lead
// doesn't resolve to something short and name-like the whole thing stays in the
// direction and the line renders unlabelled — a wrong label ("at her and") is
// worse than none, and the prose already says who spoke.
function splitLead(lead: string): { speaker: string | null; leftover: string } {
  const trimmed = lead.replace(/\s+$/, '')
  const cut = Math.max(trimmed.lastIndexOf(','), trimmed.lastIndexOf(';'), trimmed.lastIndexOf('—'))
  const words = trimmed.slice(cut + 1).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 4 || words.some((w) => NOT_A_SPEAKER.test(w))) {
    return { speaker: null, leftover: trimmed }
  }
  return { speaker: words.join(' '), leftover: trimmed.slice(0, cut + 1) }
}

// Trim the seams a lifted quote leaves behind — the dangling connective it hung
// off, and the sentence's own full stop when it sat outside the closing quote.
// A fragment with nothing left to read is dropped rather than rendered as a
// line of punctuation.
function tidyDirection(text: string): string {
  const tidy = text.replace(TRAILING_CONNECTIVE, '').replace(/^[\s,;:.]+/, '').replace(/[\s,;:]+$/, '')
  return /[\p{L}\p{N}]/u.test(tidy) ? tidy : ''
}

// Lift the attributed quotes out of one beat's prose. Anything unattributed
// stays where it is: a scare quote ("a visible 'wait, what?' reaction") is part
// of the direction, and promoting it would cut the sentence in half.
function splitQuotes(body: string): SceneSegment[] {
  const segments: SceneSegment[] = []
  const pushDirection = (text: string) => {
    const tidy = tidyDirection(text)
    if (tidy) segments.push({ kind: 'direction', text: tidy })
  }

  let cursor = 0
  ATTRIBUTION.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTRIBUTION.exec(body)) !== null) {
    const open = match.index + match[0].length
    // A cue whose quote sits inside one we already lifted isn't an attribution.
    if (open <= cursor) continue
    const close = closingQuote(body, open)
    if (close === null) continue
    const quoted = body.slice(open + 1, close).trim()
    if (quoted.length < 2) continue

    // The lead can start before the previous quote ended (the cue for a second
    // line reads back across it) — keep only the part that's still unconsumed,
    // or it would be printed twice.
    const lead = match.index < cursor ? (match[1] ?? '').slice(cursor - match.index) : (match[1] ?? '')
    const cue = (match[2] ?? '').trim()
    const variant = SCREEN_CUE.test(lead) ? 'screen' : 'speech'
    // A bare colon in front of a quote is only an attribution when the lead
    // says where the words come from — written on screen, or spoken by someone.
    // Otherwise it's shot prose ("Close-up: …") and the quote belongs to the
    // sentence it sits in.
    if (!cue && variant !== 'screen' && !SPEECH_LEAD.test(lead)) continue

    const { speaker, leftover } = splitLead(lead)
    pushDirection(body.slice(cursor, Math.max(cursor, match.index)) + leftover)
    segments.push({
      kind: 'quote',
      variant,
      speaker: NOUN_CUE_ONLY.test(cue) ? [speaker, cue].filter(Boolean).join(' ') : speaker,
      text: quoted,
    })
    cursor = close + 1
  }
  pushDirection(body.slice(cursor))
  return segments
}

// Split a scene prompt into its timed beats. A prompt with no markers comes
// back as a single untimed beat, so every shape renders.
export function parseScenePrompt(prompt: string): SceneBeat[] {
  const text = prompt.trim()
  if (!text) return []

  const beats: SceneBeat[] = []
  let cursor = 0
  let time: string | null = null
  BEAT_MARKER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = BEAT_MARKER.exec(text)) !== null) {
    // Mid-word or mid-token brackets aren't beat markers.
    if (match.index > 0 && !/\s/.test(text[match.index - 1])) continue
    const body = text.slice(cursor, match.index)
    if (body.trim() || time) beats.push({ time, segments: splitQuotes(body) })
    time = match[2] ? `${match[1]}–${match[2]}` : match[1]
    cursor = match.index + match[0].length
  }
  const tail = text.slice(cursor)
  if (tail.trim() || time) beats.push({ time, segments: splitQuotes(tail) })
  return beats
}
