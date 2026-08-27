import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Copy, Check, Bookmark, ArrowUpRight, Mic, Film, PenLine, AlertCircle, ImagePlay, Pencil, X, Undo2, Redo2, Quote, ChevronDown, ChevronRight } from 'lucide-react'
import GenerationProgress from '../../../components/GenerationProgress'
import GridCanvas from '../../../components/GridCanvas'
import AutoGrowTextarea from '../../../components/AutoGrowTextarea'
import { TileDeleteButton } from '../../../components/tileActions'
import { rangeDurationLabel } from '../../../utils/timecode'
import TokenField from './TokenField'
import { useBankStore } from '../../../stores/bankStore'
import { useAppStore } from '../../../stores/appStore'
import { REMIX_ANGLE_LABEL, remixAnglesForCount, HOOK_CATEGORY_META, DEFAULT_HOOK_COUNT, parseHooks, hooksPlainText, hooksToText, type ParsedHook, type RemixAngle, type ScriptMode, type WriteFormat } from '../types'
import { suspendChromeAutoHide } from '../../../hooks/useChromeAutoHide'

interface OutputPanelProps {
  variations: string[]
  // Remix only: angles that produced these cards, when the run stamped them.
  outputAngles?: RemixAngle[] | null
  // Mode that produced the shown variations — drives the card titles, the
  // "spoken vs scenes" send buttons, and the angle labels.
  mode: ScriptMode
  // Live left-panel mode — drives the empty-state + loading copy only.
  liveMode?: ScriptMode
  writeFormat?: WriteFormat
  writeStyleLabel?: string
  // Hooks format only — the family choice that produced the shown pack.
  hookCategoryLabel?: string
  // Hooks format only — the live count, for the empty + loading copy.
  hookCount?: number
  linkedProductId: string | null
  isGenerating?: boolean
  error?: string | null
  // Identifies the RUN these takes came from (a generation, or the history row
  // being shown). The panel scrolls back to the first take when this changes —
  // never when the takes' text changes, which is what an in-place edit does.
  runId?: string | null
  // Commits an inline edit of take `index` back to the persisted output state.
  onEditVariation?: (index: number, text: string) => void
}

// Canonically "--- Scene N: label (mm:ss-mm:ss) ---", but we tolerate a model
// near-miss that drops the surrounding dashes ("Scene 1:", "SCENE 1 —") so a
// scenes/reverse output still splits into cards instead of silently degrading
// to a plain spoken script. Mirrors detectSceneBlueprint's input matcher.
const SCENE_HEADER = /^(?:---\s*)?scene\s*\d+\s*[—:–-]/i
const SCENE_REGEX = /(^|\n)\s*(?:---\s*)?scene\s*\d+\s*[—:–-]/i

interface SceneChunk {
  header: string
  body: string
  // Where `body` sits in the text this chunk was parsed from, as character
  // offsets. This is what makes editing a scene IN PLACE exact: a rendered
  // block knows the span it came from, so committing an edit is a splice rather
  // than a search-and-replace (two scenes can share a sentence) or a
  // reconstruction (the parse trims, strips and filters — it doesn't round-trip).
  bodyStart: number
  bodyEnd: number
  // The whole scene REGION — from the first character of its header line to the
  // start of the next scene's header (or the end of the parsed text). `body`
  // spans are for editing prose; this is what a DELETE splices out, header and
  // all. It runs to the next header rather than to `bodyEnd` so the blank lines
  // between two scenes go with the one being removed instead of stacking up.
  start: number
  end: number
}

// What `splitHeaderLine` returns: the header/body split of ONE line, before
// splitScenes places it in the document.
interface HeaderSplit {
  header: string
  body: string
}

const HEADER_PARTS = /^(?:---\s*)?scene\s*\d+\s*[—:–-]\s*(.*)$/i

// A header line can carry the scene's prose on the SAME line — an Ad Analyzer
// blueprint writes "SCENE 2 — B-ROLL DETAIL: extreme close-up of @PRODUCT…".
// Treating the whole line as the header dropped that prose, and a scene whose
// body came out empty was then filtered away entirely, so a blueprint of
// single-line scenes rendered as a card reading "0 scenes".
function splitHeaderLine(line: string): HeaderSplit {
  const trimmed = line.trim()
  // The canonical "--- Scene 1: THE HOOK (00:00-00:04) ---" is a label only.
  if (/---\s*$/.test(trimmed)) return { header: trimmed, body: '' }
  const parts = HEADER_PARTS.exec(trimmed)
  if (!parts) return { header: trimmed, body: '' }
  const rest = parts[1]
  const cut = (bodyText: string): HeaderSplit => ({
    header: trimmed.slice(0, trimmed.length - bodyText.length).replace(/[\s:]+$/, ''),
    body: bodyText,
  })
  // "SCENE 2 — B-ROLL DETAIL: <prose>" — the shot label ends at its colon. The
  // length floor keeps a bare timecode label ("THE HOOK (00:00-00:04)", whose
  // own colons match) from being read as a label plus a body.
  const labelled = /^[^:]{1,40}:\s*(.+)$/.exec(rest)
  if (labelled && labelled[1].length > 24) return cut(labelled[1])
  // "SCENE 2 — <prose>", no shot label at all.
  if (!labelled && rest.length > 60) return cut(rest)
  return { header: trimmed, body: '' }
}

// The timecode a scene header carries — `--- Scene 1: THE HOOK (00:00-00:04)
// ---` — lifted out so the card can set it as a pill instead of leaving it as
// the tail of one dim uppercase line. It's the thing a member scans a storyboard
// FOR (how long is this beat, where does it land), and at 10px inside the label
// it read as part of the label's own punctuation.
//
// Parens or brackets, a range or a lone stamp, any dash between the two halves —
// the header is written by a model, and the surrounding chrome varies even when
// the prompt contract doesn't. A header with no timecode just keeps its label.
const HEADER_TIME =
  /\s*[([]\s*(\d{1,2}:\d{2}(?:\s*[-–—]\s*\d{1,2}:\d{2})?)\s*[)\]]\s*$|\s*[-–—]?\s*\b(\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2})\s*$/

function splitHeaderTime(header: string): { label: string; time: string | null } {
  const bare = header.replace(/^---\s*|\s*---$/g, '').trim()
  const match = HEADER_TIME.exec(bare)
  const time = match?.[1] ?? match?.[2]
  if (!match || !time) return { label: bare, time: null }
  // Strip the trailing punctuation the timecode was hanging off, so a label
  // doesn't end on a dangling colon or dash once its bracket is gone.
  const label = bare.slice(0, match.index).replace(/[\s:;,—–-]+$/, '')
  // One dash for every scene: the same blueprint routinely mixes a hyphen and
  // an en dash, and a column of pills is where that shows.
  const normalised = time.replace(/\s*[-–—]\s*/, '–')
  return { label: label || bare, time: normalised }
}

function splitScenes(text: string): SceneChunk[] | null {
  if (!SCENE_REGEX.test(text)) return null
  const lines = text.split('\n')
  // Spans first, body second. The body is SLICED out of `text` at the end
  // rather than accumulated line by line, so the string and the span it claims
  // to occupy are the same characters by construction. Accumulating them
  // separately drifted: a blank line between the header and the prose (which is
  // how most models format a scene) contributed nothing to the string while
  // still moving the offsets, so every span in that scene sat one character
  // left of the text it described — and an edit then spliced over the newline
  // and dropped the body's last character.
  const spans: Array<{ header: string; headerStart: number; bodyStart: number; bodyEnd: number }> = []
  let current: { header: string; headerStart: number; bodyStart: number; bodyEnd: number } | null = null
  // Running character offset of the current line's first character. `text` is
  // split on '\n' and rejoined with '\n', so line length + 1 is exact.
  let offset = 0
  for (const line of lines) {
    const lineStart = offset
    offset += line.length + 1
    if (SCENE_HEADER.test(line.trim())) {
      if (current) spans.push(current)
      const split = splitHeaderLine(line)
      // A header that carries its own prose ("SCENE 2 — B-ROLL DETAIL: …")
      // starts the body mid-line; a label-only header starts it on the next.
      const bodyStart = split.body ? lineStart + line.indexOf(split.body) : offset
      current = { header: split.header, headerStart: lineStart, bodyStart, bodyEnd: bodyStart + split.body.length }
    } else if (current) {
      current.bodyEnd = lineStart + line.length
    }
  }
  if (current) spans.push(current)
  const chunks = spans
    .map((c) => {
      const raw = text.slice(c.bodyStart, Math.max(c.bodyStart, c.bodyEnd))
      // The trim has to move the span with it, or an edit would splice the
      // surrounding blank lines away along with the body.
      const lead = raw.length - raw.trimStart().length
      const body = raw.trim()
      return {
        header: c.header,
        body,
        bodyStart: c.bodyStart + lead,
        bodyEnd: c.bodyStart + lead + body.length,
        start: c.headerStart,
        end: text.length,
      }
    })
    .filter((c) => c.body.length > 0)
  // Each surviving scene runs to the next SURVIVING one, so a bodiless header
  // in between (which renders nothing) leaves with the scene above it rather
  // than being stranded in the text with nothing on screen to remove it.
  for (let i = 0; i < chunks.length - 1; i++) chunks[i].end = chunks[i + 1].start
  return chunks
}

// Renumber the "SCENE N" headers after one is deleted — 1, 2, 4, 5 reads as a
// bug, and the number is the one part of a header we can fix without inventing
// anything. The timecodes are deliberately left alone: they're the model's own
// timing, and re-cutting them here would be a guess printed as a fact.
//
// Only the digits are rewritten; the word keeps whatever case the take wrote it
// in, and the trailing separator is required so nothing but a real header
// matches.
const SCENE_NUMBER = /^([ \t]*(?:---\s*)?)(scene)(\s*)(\d+)(?=\s*[—:–-])/gim

function renumberScenes(text: string): string {
  let n = 0
  return text.replace(SCENE_NUMBER, (_m, lead: string, word: string, gap: string) => `${lead}${word}${gap}${++n}`)
}

// Content that precedes the first "--- Scene N ---" header — used by the scene
// formats to carry a leading "=== VOICE PROFILE ... ===" block. Stripped of its
// own divider markers so it renders as a clean voice card above the scenes.
function extractIntro(text: string): string {
  const idx = text.search(SCENE_REGEX)
  if (idx <= 0) return ''
  return text
    .slice(0, idx)
    .replace(/^[=\s]*VOICE PROFILE[^\n]*\n/i, '')
    .replace(/^[=\s]+|[=\s]+$/g, '')
    .trim()
}

// Matches the voice-profile header line wherever it appears — the model is told
// to emit it AFTER the last scene, so it gets appended to (and merged into) the
// final scene's body unless we pull it out. Case-insensitive; tolerates the
// "(same voice in every scene)" parenthetical and trailing "===" markers.
// `MASTER` is optional because the two producers word it differently: Scripts'
// own prompts emit "=== VOICE PROFILE … ===", the Ad Analyzer's blueprint emits
// "=== MASTER VOICE PROFILE … ===" (ResultsView), and that word sitting between
// the markers and the label meant a blueprint remixed here rendered its voice
// profile buried in the last scene's body instead of on its own card.
const VOICE_HEADER_REGEX = /(^|\n)[=\s]*(?:MASTER\s+)?VOICE PROFILE\b[^\n]*\n?/i
const VOICE_HEADER_GLOBAL = new RegExp(VOICE_HEADER_REGEX.source, 'gi')

// Pulls the voice-profile block out of a scenes script. It can sit BEFORE the
// first scene (a blueprint pasted out of the Ad Analyzer leads with its
// "=== MASTER VOICE PROFILE ===" block, and a model rewriting that blueprint
// tends to reproduce it where it found it) or be appended AFTER the last scene
// (what our own prompt asks for). Returns the voice-profile body (with its
// "=== ... ===" markers stripped) and the text the scenes are parsed out of.
//
// `rest` is either `text` itself or a PREFIX of it, never a splice: the scene
// spans are offsets into `text`, and any cut from the middle would slide every
// one of them. A leading block therefore isn't removed at all — it's preamble,
// which `splitScenes` already ignores.
function splitVoiceProfile(text: string): { body: string; rest: string; bodyStart?: number; bodyEnd?: number } {
  // The appended block is the one the prompt asks for, so it wins when both
  // shapes are present. Taking the first match unconditionally handed a
  // remixed Ad Analyzer blueprint a "voice profile" containing every scene in
  // the ad, and left the take itself with no scenes to render at all.
  const lastScene = lastSceneHeaderIndex(text)
  const headers = [...text.matchAll(VOICE_HEADER_GLOBAL)]
  const match = headers.find((m) => m.index + m[1].length > lastScene) ?? headers[0]
  if (!match) {
    // No labelled block at all — fall back to the intro-based shape.
    return { body: extractIntro(text), rest: text }
  }
  const headerStart = match.index + match[1].length
  // The block runs from its header to the next scene header, or to the end of
  // the text when nothing follows it. Strip the header line and any standalone
  // "===" divider lines from the body.
  const regionStart = headerStart + (match[0].length - match[1].length)
  const nextScene = text.slice(regionStart).search(SCENE_REGEX)
  const appended = nextScene < 0
  const region = appended ? text.slice(regionStart) : text.slice(regionStart, regionStart + nextScene)
  const body = region.replace(/^[=\s]+|[=\s]+$/g, '').trim()
  // Appended → the scenes are everything before it. Leading → the whole text,
  // since the block sits in front of the first header and is dropped anyway.
  const rest = appended ? text.slice(0, headerStart).replace(/\s+$/, '') : text
  if (body) {
    // Only the ends were stripped, so indexOf lands on the true offset — the
    // body can't begin with the `=`/whitespace that was taken off its front.
    const lead = region.indexOf(body)
    return { body, rest, bodyStart: regionStart + lead, bodyEnd: regionStart + lead + body.length }
  }
  return { body: extractIntro(rest), rest }
}

// Where the last "--- Scene N ---" header starts, or -1. Used to tell an
// appended voice-profile block from one that leads the document.
function lastSceneHeaderIndex(text: string): number {
  let at = -1
  let from = 0
  for (;;) {
    const next = text.slice(from).search(SCENE_REGEX)
    if (next < 0) return at
    at = from + next
    from = at + 1
  }
}

// A scene body is one prose paragraph with the spoken line quoted inline — the
// prompt contract is `[CHARACTER] says: "…"` for a written scene, and remix
// preserves the source's own attribution (`She says: "…"`, `Voiceover: "…"`).
// The quoted words are the only part the member reads aloud, records, and sends
// to Voiceovers, so they're lifted out of the direction rather than left as the
// tail clause of a paragraph about lens height.
// `start`/`end` are offsets into the BODY this segment was split out of — the
// other half of the in-place edit. Add the chunk's own `bodyStart` and you have
// the exact span of the take text that one rendered block owns.
type SceneSegment =
  | { kind: 'direction'; text: string; start: number; end: number }
  | { kind: 'line'; speaker: string | null; text: string; start: number; end: number }

// The verbs that introduce a line. `speaks` is the one a model reaches for
// most naturally after a [TOKEN] and it was missing, which is most of why one
// scene of a remix rendered as direction + line and the next as a single
// block. Verbs that introduce ON-SCREEN text rather than speech — reads,
// shows, displays — are deliberately absent: this app's scene prompts quote
// overlay copy constantly ("text overlay reading "2 weeks""), and promoting
// that to dialogue would send a caption to Voiceovers. `states` is out for the
// same reason — `the label states clearly: "10g collagen"` is packaging, and
// nothing writes `[CHARACTER] states:` often enough to pay for that.
const SPEECH_VERB_SRC =
  'says?|said|saying|speaks?|spoke|speaking|tells?|told|explains?|explained|adds?|continues?|whispers?|shouts?|asks?|replies|replied'
// A word that can never be the speaker: it means the cue is prose running into
// the verb ("…and says:", "the sign that says") rather than someone talking.
const NOT_A_SPEAKER_SRC = 'and|then|or|but|as|while|that|which|who'
const SPEAKER_SRC = `(?:\\[[A-Z_]+\\]|(?!(?:${NOT_A_SPEAKER_SRC})\\b)(?:the\\s+)?[\\w'’-]+)`
// A short adverbial run between the verb and the quote — `says DIRECTLY TO
// CAMERA: "…"`, `speaks TO THE LENS: "…"`, `says, SMILING: "…"`. Our own
// prompt contract writes the tight `[CHARACTER] says: "…"`, but a blueprint
// rewrite is told to keep the SOURCE's attribution format and the Ad Analyzer
// transcribes what it heard, so a phrase between the verb and the colon is
// what actually arrives here — and every one of those scenes fell through to
// the single-block fallback.
//
// Two bounds keep it honest, because whatever the cue matches is peeled OFF
// the direction: at most four plain words (no sentence punctuation, so it
// can't cross into the previous clause), and a tail only counts when a colon
// or comma follows it. That punctuation is the signal that the phrase was an
// attribution at all — without it, `the overlay asks the viewer to tap
// "Learn more"` is prose with a quote in it, not a spoken line.
const CUE_TAIL_SRC = `(?:\\s*,)?(?:\\s+[\\w'’-]+){0,4}`
const CUE_END_SRC = `(?:${CUE_TAIL_SRC}\\s*[:,]|\\s*[:,]?)`
// The clause that hands off to a quote, anchored to the end of the preceding
// prose so it can only ever eat the introduction itself. A speaker is a
// [TOKEN], a pronoun, or a (optionally "the"-prefixed) name — never a
// connective, which is how "…and says:" used to label the line "it over and".
//
// The punctuation between the cue and the quote is OPTIONAL. Our own prompts
// ask for `[CHARACTER] says: "…"`, but a blueprint rewrite is told to keep the
// attribution format of the source — and the Ad Analyzer transcribes what it
// heard, so `She says, "…"` arrives just as often. Requiring the colon left
// those lines sitting inside the direction as prose.
const NAMED_ATTRIBUTION = new RegExp(
  `(?<=^|[\\s,;.!?—-])(${SPEAKER_SRC}\\s+(?:${SPEECH_VERB_SRC})${CUE_END_SRC}|voice\\s*ove?r|narrator)\\s*[:,]?\\s*$`,
  'i',
)
// The model sometimes folds the cue into the sentence with no subject of its
// own ("…turns it over and says:"). Still dialogue — just nobody to label.
const BARE_ATTRIBUTION = new RegExp(`\\b(?:${SPEECH_VERB_SRC})${CUE_END_SRC}\\s*$`, 'i')
// The screenplay shape, with a speaker label and no verb at all. Only a
// [TOKEN] counts here: a bare word in front of a colon is shot prose
// ("Close-up: …") far more often than it's a speaker.
const TOKEN_ATTRIBUTION = /(?<=^|[\s,;.!?—-])(\[[A-Z_]+\])\s*:\s*$/
// Attribution that FOLLOWS its line — `"…," [CHARACTER] says, holding it up`.
// This is how a hook scene usually opens (the line is the first thing in the
// ad, so it's the first thing on the page), and it was the one dialogue shape
// that rendered as direction, which is why scene 1 of a remixed blueprint kept
// coming out as a plain block of text while every scene under it rendered as
// direction plus a spoken line.
//
// No adverbial tail on this one, on purpose: what it matches is skipped over
// rather than dropped, and the words after the verb here are the rest of the
// sentence (`"…," she says, HOLDING IT UP TO THE LENS`) — direction that
// belongs on the page.
const TRAILING_ATTRIBUTION = new RegExp(
  `^[\\s,.;:—-]*(${SPEAKER_SRC}\\s+(?:${SPEECH_VERB_SRC})|voice\\s*ove?r|narrator)\\b`,
  'i',
)
// …and what disqualifies one: a cue that runs straight into ANOTHER quote is
// introducing the line in front of it, not reporting the one behind it. The
// shape that exposed this is a scene opening on overlay copy — `text "Days
// 1-7". [CHARACTER] says directly to camera: "…"` — where reading the cue
// backwards promoted the caption to dialogue and then skipped the cue, leaving
// the real spoken line stranded in the direction.
const NEXT_QUOTE_CUE = new RegExp(`^${CUE_TAIL_SRC}\\s*[:,]?\\s*["“]`)
// Strips the cue off a matched label to leave the speaker — the same verb and
// tail the cue was allowed to carry, or `[CHARACTER] says directly to camera`
// would be printed as the speaker's name.
const SPEECH_VERB = new RegExp(`\\s*\\b(?:${SPEECH_VERB_SRC})${CUE_END_SRC}\\s*$`, 'i')
// The connective left dangling on the direction once its attribution is cut.
const TRAILING_CONNECTIVE = /[\s,;:]*\b(?:and|then|as|while)\s*$/i

function splitSpokenLines(body: string): SceneSegment[] {
  const segments: SceneSegment[] = []
  const quoted = /["“]([^"”\n]{2,})["”]/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = quoted.exec(body)) !== null) {
    const before = body.slice(cursor, match.index)
    const lead = before.replace(/\s+$/, '')
    const named = NAMED_ATTRIBUTION.exec(lead)
    const bare = named ? null : BARE_ATTRIBUTION.exec(lead)
    const token = named || bare ? null : TOKEN_ATTRIBUTION.exec(lead)
    const cue = named ?? bare ?? token
    const quoteEnd = match.index + match[0].length
    // Nothing in front of it? The attribution may still follow the line —
    // unless it turns out to be the cue for the NEXT quote, in which case this
    // one has no attribution at all and stays in the direction.
    let after = cue ? null : TRAILING_ATTRIBUTION.exec(body.slice(quoteEnd))
    if (after && NEXT_QUOTE_CUE.test(body.slice(quoteEnd + after[0].length))) after = null
    // A quote nobody is introduced as speaking isn't dialogue — it's a scare
    // quote living inside the direction ("has a visible "wait, what?"
    // reaction"). Leaving `cursor` where it is keeps it in the prose instead of
    // promoting it to a line and cutting the sentence in half around it.
    if (!cue && !after) continue
    // Peel the introduction off the direction so it doesn't trail off
    // mid-sentence ("…leans in and [CHARACTER] says:"). A trailing attribution
    // is peeled off the far side instead — `cursor` skips it below — and the
    // whole lead stays as direction.
    const label = named?.[1] ?? token?.[1] ?? after?.[1] ?? null
    const speaker = label ? label.replace(SPEECH_VERB, '').trim() || label.trim() : null
    const direction = (cue ? lead.slice(0, cue.index) : lead)
      .replace(TRAILING_CONNECTIVE, '')
      .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
    // Every step above only strips from the ENDS of a prefix of `before`, so
    // the survivor is one contiguous run and indexOf finds its true offset —
    // it can't match earlier, since a direction never begins with the
    // whitespace/punctuation that was stripped off its front.
    if (direction) {
      const at = cursor + before.indexOf(direction)
      segments.push({ kind: 'direction', text: direction, start: at, end: at + direction.length })
    }
    // The span is the quoted WORDS, inside the quote marks, so an edit can't
    // delete the quotes the parser finds the line by.
    const raw = match[1]
    const lineStart = match.index + 1 + (raw.length - raw.trimStart().length)
    segments.push({ kind: 'line', speaker, text: raw.trim(), start: lineStart, end: lineStart + raw.trim().length })
    cursor = quoteEnd + (after ? after[0].length : 0)
  }
  const rest = body.slice(cursor)
  const tail = rest.replace(/^[\s,;:]+|[\s,;:]+$/g, '')
  if (tail) {
    const at = cursor + rest.indexOf(tail)
    segments.push({ kind: 'direction', text: tail, start: at, end: at + tail.length })
  }
  return segments
}

// The spoken line — the thing that gets read aloud. Tinted, set at reading
// size, and separately copyable, because it's what leaves this app.
function SpokenLine({ speaker, text, onChange }: { speaker: string | null; text: string; onChange?: (next: string) => void }) {
  const [copied, setCopied] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const handleCopy = async () => {
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(true)
      addToast('Line copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } else {
      addToast('Copy failed', 'error')
    }
  }
  return (
    <div className="relative rounded-xl border border-scripts-500/15 bg-scripts-500/[0.05] py-2.5 pl-3.5 pr-10">
      {speaker && (
        <div className="mb-1 flex select-none items-center gap-1.5 text-[10px] font-semibold uppercase tracking-tight text-scripts-300/80">
          <Quote className="h-2.5 w-2.5" strokeWidth={2.5} />
          {speaker.replace(/^\[|\]$/g, '').toLowerCase()}
        </div>
      )}
      {/* The quote marks sit OUTSIDE the field, and the span the edit writes
          back is the words between them — so retyping the line can't delete the
          quotes the scene parser finds it by. */}
      <div className="flex items-start gap-0.5 text-[15px] font-light leading-snug tracking-tight text-ink-100">
        <span aria-hidden className="select-none">“</span>
        <EditableText
          value={text}
          onCommit={onChange}
          singleLine
          ariaLabel="Spoken line"
          className="min-w-0 flex-1 text-[15px] font-light leading-snug tracking-tight text-ink-100"
          render={<p className="min-w-0 flex-1 text-[15px] font-light leading-snug tracking-tight text-ink-100">{text}</p>}
        />
        <span aria-hidden className="select-none">”</span>
      </div>
      <button
        onClick={handleCopy}
        title="Copy line"
        aria-label="Copy line"
        className="absolute right-1.5 top-1.5 flex h-6 w-6 select-none items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-ink/5 hover:text-ink-300"
      >
        {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )
}

interface VariationCardProps {
  text: string
  cardTitle: string
  defaultSaveTitle: string
  linkedProductId: string | null
  mode: ScriptMode
  // Hooks format: renders the tagged one-liners as per-hook rows; copy/save use
  // the clean spoken lines (tags stripped).
  isHooks?: boolean
  // Commits an inline edit of this take's text back to the persisted output
  // state. Omitted → the edit affordance is hidden.
  onEdit?: (text: string) => void
  // Callback ref to the card's root — lets the OutputPanel scroll a given take
  // into view when its number is clicked in the take switcher.
  cardRef?: (el: HTMLDivElement | null) => void
}

function VariationCard({
  text,
  cardTitle,
  defaultSaveTitle,
  linkedProductId,
  mode,
  isHooks = false,
  onEdit,
  cardRef,
}: VariationCardProps) {
  const [copied, setCopied] = useState(false)
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [saveTitle, setSaveTitle] = useState(defaultSaveTitle)
  const [saved, setSaved] = useState(false)
  // Inline edit of the take's raw text. `draft` is the live textarea value;
  // committing on Done flows it up via onEdit (persisted in the parent) and the
  // refreshed `text` prop re-renders the parsed view.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  // Undo/redo stack for committed edits to this take. `textSync` lets the
  // render-time check tell our own commits (keep the stack) from an external
  // change — a new generation or a loaded history item (reset the stack).
  const [history, setHistory] = useState<string[]>([text])
  const [histIndex, setHistIndex] = useState(0)
  const [textSync, setTextSync] = useState(text)
  // Which scenes are folded shut, by their index in the parsed list. Purely a
  // view state — a folded scene is still in the take, still copied, still sent.
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set())
  if (text !== textSync) {
    setTextSync(text)
    setHistory([text])
    setHistIndex(0)
    // Only an EXTERNAL change lands here (our own commits move `textSync` in
    // step), so this is a new generation or a restored history row — different
    // scenes entirely, and folds kept from the last one would land on them by
    // index alone.
    if (collapsed.size) setCollapsed(new Set())
  }
  const canUndo = histIndex > 0
  const canRedo = histIndex < history.length - 1
  // Sticky "already in the bank" flag — `saved` is only the 3s visual flash.
  // Send-to-app auto-saves use this to avoid writing duplicate bank rows.
  const [savedOnce, setSavedOnce] = useState(false)

  const addScript = useBankStore((s) => s.addScript)
  const sendToApp = useAppStore((s) => s.sendToApp)
  const addToast = useAppStore((s) => s.addToast)

  // Pull the voice-profile block (wherever it sits) out FIRST, then split the
  // remaining text into scenes — otherwise the appended profile gets merged into
  // the last scene's body.
  const { scenes, voiceProfile, voiceSpan } = useMemo(() => {
    if (isHooks) return { scenes: null, voiceProfile: '', voiceSpan: null }
    const { body, rest, bodyStart, bodyEnd } = splitVoiceProfile(text)
    const parsed = splitScenes(rest)
    return {
      scenes: parsed,
      voiceProfile: parsed ? body : '',
      voiceSpan: bodyStart != null && bodyEnd != null ? { start: bodyStart, end: bodyEnd } : null,
    }
  }, [text, isHooks])

  // Hooks: the raw text carries <FAMILY> tags — parse them into rows, and use
  // the clean spoken lines for copy / save-to-bank.
  const hooks = useMemo<ParsedHook[] | null>(() => (isHooks ? parseHooks(text) : null), [text, isHooks])

  // The plain-script shape: one row per line that has words in it, each with its
  // offset in the take — the span an in-place edit writes back to — and whether
  // a blank line came before it.
  //
  // **A paragraph break is worth one gap however many newlines produced it.**
  // The take is the model's raw text and nothing normalises its whitespace, so
  // the same three-paragraph script arrived spaced three different ways: one
  // blank line between paragraphs rendered at 14px, two at 28px, and none at all
  // at 0px — a wall of flush sentences. Which one you got depended on the model
  // and the run, not on the writing, and that is the "some scripts come out with
  // bigger gaps" report. Rendering every blank line as its own spacer is what
  // made the take's whitespace visible; a RUN of them is one paragraph break.
  //
  // Fixed here rather than by rewriting the text: the take stays exactly what
  // the model wrote (it's what Copy, Save and Send to Voiceovers hand over), and
  // every span an edit splices back over stays where it was.
  //
  // A plain loop, not a map over a closed-over counter: reassigning a captured
  // variable from inside a render callback is what the compiler lint calls
  // "reassign after render completes", and it's right — the accumulator would
  // outlive the render that built it.
  const scriptLines = useMemo(() => {
    const out: Array<{ line: string; start: number; breakBefore: boolean }> = []
    let at = 0
    let pendingBreak = false
    for (const line of text.split('\n')) {
      const start = at
      at += line.length + 1
      if (line.trim() === '') {
        // Leading blank lines aren't a paragraph break — there's nothing above
        // them to break FROM, and they used to open the card with a spacer.
        pendingBreak = out.length > 0
        continue
      }
      out.push({ line, start, breakBefore: pendingBreak })
      pendingBreak = false
    }
    return out
  }, [text])
  const shareText = isHooks ? hooksPlainText(text) : text

  // A plain spoken script (remix variation, or a write-mode 'script' output)
  // can be read aloud → Voiceovers. A scene blueprint (reverse-engineer, or a
  // write-mode 'scenes' output) is a prompt asset → Playground. A hooks pack is
  // a list of standalone openers — copy/save only, no sends.
  const isSpokenScript = !isHooks && (mode === 'remix' || (mode === 'write' && !scenes))

  const startEdit = () => {
    setDraft(text)
    setShowSaveForm(false)
    setEditing(true)
  }

  // Push `next` as a new committed state and flow it to the parent. Setting
  // `textSync` in step keeps the render-time check from mistaking our own
  // commit for an external reset (which would wipe the undo stack).
  const applyText = (next: string) => {
    setTextSync(next)
    onEdit?.(next)
  }

  const commitEdit = () => {
    if (draft !== history[histIndex]) {
      const nextHistory = [...history.slice(0, histIndex + 1), draft]
      setHistory(nextHistory)
      setHistIndex(nextHistory.length - 1)
      applyText(draft)
      addToast('Edit saved')
    }
    setEditing(false)
  }

  const cancelEdit = () => {
    setDraft(text)
    setEditing(false)
  }

  // A hook is edited ON its own row — click the line and type, no Edit mode to
  // enter first. Rewrites that one line and pushes the rebuilt pack through the
  // same commit path (and the same undo stack) the raw editor uses, so the two
  // ways in stay interchangeable. The raw editor is still the only way to ADD
  // or DELETE a line, which is why its button survives here.
  const editHookLine = (index: number, next: string) => {
    if (!hooks) return
    commitText(hooksToText(hooks.map((h, i) => (i === index ? { ...h, text: next } : h))))
  }

  // Push a rewritten take through the same commit path (and the same undo
  // stack) the raw editor uses, so every way of editing this card is
  // interchangeable and Undo steps back through all of them.
  const commitText = (rebuilt: string) => {
    if (rebuilt === text) return
    const nextHistory = [...history.slice(0, histIndex + 1), rebuilt]
    setHistory(nextHistory)
    setHistIndex(nextHistory.length - 1)
    applyText(rebuilt)
  }

  // Splice one span of the take text — the primitive behind every in-place
  // edit outside the hooks pack. The span comes from the parse (a scene's
  // `bodyStart` plus a segment's own offset, or a script line's position), so
  // this never has to find anything: it writes back exactly the characters the
  // block on screen was rendered from. The bounds check is belt and braces
  // against a stale span surviving one render past a text change.
  const replaceRange = (start: number, end: number, next: string) => {
    if (start < 0 || end > text.length || start > end) return
    commitText(text.slice(0, start) + next + text.slice(end))
  }

  // Cut one scene out of the take — its header line, its body, and the blank
  // lines between it and the next scene. The span comes from the parse, so this
  // is the same splice every other edit here performs, and Undo steps back over
  // it like any other. The remaining headers are renumbered, since 1, 2, 4
  // reads as a bug in the take rather than as a deliberate cut.
  const deleteScene = (index: number) => {
    const chunk = scenes?.[index]
    if (!chunk || chunk.start < 0 || chunk.end > text.length) return
    const before = text.slice(0, chunk.start).replace(/\s+$/, '')
    const after = text.slice(chunk.end).replace(/^\s+/, '')
    commitText(renumberScenes(before && after ? `${before}\n\n${after}` : before || after))
    // The folds are keyed by index, so everything below the cut shifts up one.
    setCollapsed((prev) => {
      if (!prev.size) return prev
      const next = new Set<number>()
      prev.forEach((i) => {
        if (i < index) next.add(i)
        else if (i > index) next.add(i - 1)
      })
      return next
    })
  }

  const toggleCollapsed = (index: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }

  const handleUndo = () => {
    if (!canUndo) return
    const i = histIndex - 1
    setHistIndex(i)
    applyText(history[i])
  }

  const handleRedo = () => {
    if (!canRedo) return
    const i = histIndex + 1
    setHistIndex(i)
    applyText(history[i])
  }

  // Also the tooltip and the accessible name, since the word itself is hidden
  // on a phone — the button has to keep saying what it copies somewhere.
  const copyAllLabel = copied ? 'Copied' : scenes ? 'Copy Full Script' : hooks ? 'Copy All' : 'Copy'

  const handleCopyAll = async () => {
    const ok = await copyToClipboard(shareText)
    if (ok) {
      setCopied(true)
      addToast(isHooks ? 'Hooks copied to clipboard' : 'Script copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } else {
      addToast('Copy failed', 'error')
    }
  }

  const saveToBank = (title: string) => {
    addScript({
      title,
      scriptText: shareText,
      linkedProductId: linkedProductId ?? '',
      source: 'script-architect',
      // Hooks are spoken one-liners, so they file with the spoken scripts.
      kind: isSpokenScript || isHooks ? 'remix' : 'reverse-engineer',
    })
    setSavedOnce(true)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleSave = () => {
    const title = saveTitle.trim()
    if (!title) return
    saveToBank(title)
    setShowSaveForm(false)
    addToast('Script saved to bank')
  }

  const handleSendToVoiceStudio = () => {
    const autoSaved = !savedOnce
    if (autoSaved) saveToBank(defaultSaveTitle)
    sendToApp({ targetApp: 'voice-studio', targetField: 'scriptText', data: text })
    addToast(autoSaved ? 'Script saved to bank · sent to Voiceovers' : 'Script sent to Voiceovers')
  }

  const handleSendToBrollStudio = () => {
    const autoSaved = !savedOnce
    if (autoSaved) saveToBank(defaultSaveTitle)
    sendToApp({ targetApp: 'broll-studio', targetField: 'scriptText', data: text })
    addToast(autoSaved ? 'Script saved to bank · sent to B-Roll' : 'Script sent to B-Roll')
  }

  const handleSendToPlayground = () => {
    sendToApp({ targetApp: 'playground', targetField: 'videoPrompt', data: text })
    addToast('Prompt sent to Playground')
  }

  return (
    // Every chrome row in this panel — headers, chips, copy/edit buttons, the
    // take switcher — is `select-none`, so dragging across a take highlights the
    // script and nothing else. Two symptoms came from letting chrome be
    // selectable: the highlight swept up "SCENE 1 — HOOK" and the word "Copy"
    // alongside the line you wanted, and clicking a button whose own label was
    // inside that highlight left the selection stuck (Chrome reads a mousedown
    // inside a selection as a drag-start, and the click's re-render then
    // interrupts the collapse). Prose stays selectable — it's what gets copied.
    <div ref={cardRef} className="flex shrink-0 flex-col rounded-3xl border border-ink/10 bg-ink/[0.06] light:bg-[#F1F1F2] overflow-hidden card-soft-shadow">
      <div className="relative flex select-none items-center justify-center border-b border-ink/5 px-12 py-2.5">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-scripts-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-tight text-scripts-300">
            {cardTitle}
          </span>
          {scenes && !editing && (
            <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-[10px] text-ink-500">
              {scenes.length} scene{scenes.length === 1 ? '' : 's'}
            </span>
          )}
          {hooks && !editing && (
            <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-[10px] text-ink-500">
              {hooks.length} hook{hooks.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {onEdit && !editing && (
          <div className="absolute left-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            {/* The raw take, in one box. No longer how you fix a typo — every
                block on the card below is its own field — nor how you remove a
                scene, which is the scene header's own button. What's left is
                ADDING: a new scene, a line, a paragraph. Same for the hooks
                pack, which has no per-row delete of its own. */}
            <button
              onClick={startEdit}
              title="Edit the whole take as raw text — for adding scenes and lines"
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
            >
              <Pencil className="h-3 w-3" />
              Raw
            </button>
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              title="Undo"
              className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Undo2 className="h-3 w-3" />
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              title="Redo"
              className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Redo2 className="h-3 w-3" />
            </button>
          </div>
        )}
        {!editing && (
          // Glyph only on a phone (Massimo's call, August 2026). This row also
          // carries the Raw / Scene Prompts toggle and the scene count, and
          // "Copy Full Script" is the longest label on it — at 375px the three
          // ran into each other. The copy icon says what the button does
          // without being read; the wording survives as the tooltip and the
          // accessible name, and the tick is the same feedback either way.
          <button
            onClick={handleCopyAll}
            title={copyAllLabel}
            aria-label={copyAllLabel}
            className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
            <span className="max-md:hidden">{copyAllLabel}</span>
          </button>
        )}
        {editing && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-tight text-scripts-300">
            Editing
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {editing ? (
          // One textarea over the raw take text — works for every output shape
          // (scenes / plain script). Committing re-parses on render.
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            spellCheck={false}
            className="min-h-[320px] w-full resize-y rounded-2xl border border-ink/10 bg-surface-0 p-3 text-[13px] font-light leading-relaxed tracking-tight text-ink-100 outline-none transition-colors focus:border-scripts-500/30"
          />
        ) : hooks ? (
          // One row per hook — family chip + the line + its own copy button.
          <>
            {hooks.map((hook, i) => (
              <HookLineCard
                key={i}
                hook={hook}
                index={i}
                onChange={onEdit ? (line) => editHookLine(i, line) : undefined}
              />
            ))}
          </>
        ) : scenes ? (
          <>
            {voiceProfile && (
              <VoiceProfileCard
                body={voiceProfile}
                onChange={onEdit && voiceSpan ? (next) => replaceRange(voiceSpan.start, voiceSpan.end, next) : undefined}
              />
            )}
            {scenes.map((scene, i) => (
              <SceneChunkCard
                key={i}
                chunk={scene}
                onEditRange={onEdit ? replaceRange : undefined}
                onDelete={onEdit ? () => deleteScene(i) : undefined}
                collapsed={collapsed.has(i)}
                onToggleCollapsed={() => toggleCollapsed(i)}
              />
            ))}
          </>
        ) : mode === 'reverse-engineer' ? (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed tracking-tight text-ink-100">
            {text}
          </pre>
        ) : (
          // Each source line is its own paragraph: normal line-height within a
          // (wrapped) sentence, a slight gap between sentences, and a wider one
          // where the model left a blank line. No `font-sans` — that falls back
          // to system-ui; we want the inherited Geist.
          // Each one is also the field that edits it — the line IS the editor,
          // and the span it writes back is its own position in the take, so a
          // sentence repeated twice in a script can't overwrite its twin.
          //
          // The two spacings are the row gap and `mt-2`, with no spacer elements
          // between them: every field carries `-my-1` (its hover tint bleeds
          // past the text), which eats 8px of whatever gap is set — so `gap-3.5`
          // is the 6px between sentences, and a paragraph break is that plus 8.
          <div className="flex flex-col gap-3.5 text-sm font-light leading-normal tracking-tight text-ink-100">
            {scriptLines.map(({ line, start, breakBefore }, i) => (
              <EditableText
                key={i}
                value={line}
                onCommit={onEdit ? (next) => replaceRange(start, start + line.length, next) : undefined}
                singleLine
                ariaLabel={`Line ${i + 1}`}
                className={`text-sm font-light leading-normal tracking-tight text-ink-100 ${breakBefore ? 'mt-2' : ''}`}
                render={<p>{line}</p>}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex select-none flex-col gap-2 border-t border-ink/5 p-3">
        {editing ? (
          <div className="flex gap-2">
            <button
              onClick={commitEdit}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-scripts-500/15 px-4 py-2.5 text-[12px] font-medium tracking-tight text-scripts-text transition-colors hover:bg-scripts-500/25"
            >
              <Check className="h-3.5 w-3.5" /> Done
            </button>
            <button
              onClick={cancelEdit}
              className="flex items-center justify-center gap-2 rounded-full border border-ink/15 px-4 py-2.5 text-[12px] font-medium tracking-tight text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-200"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        ) : showSaveForm ? (
          <div className="flex gap-2">
            <input
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
              placeholder="Script title..."
              autoFocus
              className="flex-1 select-text rounded-full border border-ink/10 bg-transparent px-4 py-2 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-scripts-500/30"
            />
            <button
              onClick={handleSave}
              disabled={!saveTitle.trim()}
              className="rounded-full bg-scripts-500/15 px-4 py-2 text-xs font-medium text-scripts-text transition-colors hover:bg-scripts-500/25 disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={() => setShowSaveForm(false)}
              className="rounded-full px-4 py-2 text-xs text-ink-500 transition-colors hover:text-ink-300"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowSaveForm(true)}
              className={`flex flex-1 min-w-0 items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-[12px] font-medium tracking-tight transition-colors ${
                saved
                  ? 'border-green-500/20 bg-green-500/10 text-green-400 light:text-green-600'
                  : 'border-ink/15 text-ink-300 hover:bg-ink/[0.06] hover:text-ink-100'
              }`}
            >
              {saved ? (<><Check className="h-3.5 w-3.5" /> Saved</>) : (<><Bookmark className="h-3.5 w-3.5" /> Save to Bank</>)}
            </button>
            {isHooks ? (
              // A hook pack has no full-script send target — each line is a
              // different video's opener. Copy per row / save the pack.
              null
            ) : (
              <>
                {isSpokenScript && (
                  <button
                    onClick={handleSendToVoiceStudio}
                    className="flex flex-1 min-w-0 items-center justify-center gap-2 rounded-full border border-voice-500/20 bg-voice-500/10 px-4 py-2.5 text-[12px] font-medium tracking-tight text-voice-400 transition-colors hover:bg-voice-500/20"
                  >
                    <Mic className="h-4 w-4" strokeWidth={1.75} />
                    Send to Voiceovers
                    <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                )}
                <button
                  onClick={handleSendToBrollStudio}
                  className="flex flex-1 min-w-0 items-center justify-center gap-2 rounded-full border border-broll-500/20 bg-broll-500/10 px-4 py-2.5 text-[12px] font-medium tracking-tight text-broll-400 transition-colors hover:bg-broll-500/20"
                >
                  <Film className="h-4 w-4" strokeWidth={1.75} />
                  Send to B-Roll
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
                {!isSpokenScript && (
                  <button
                    onClick={handleSendToPlayground}
                    className="flex flex-1 min-w-0 items-center justify-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-[12px] font-medium tracking-tight text-emerald-400 light:text-emerald-600 transition-colors hover:bg-emerald-500/20"
                  >
                    <ImagePlay className="h-4 w-4" strokeWidth={1.75} />
                    Send to Playground
                    <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// The shared voice spec for a scene blueprint — the same on-camera voice every
// scene's clip should be read in. Rendered once, ABOVE the scenes: it's pasted
// into every scene's prompt, so it's the first thing copied, and at the bottom
// of a ten-scene column most members never scrolled far enough to find it. The
// model still emits it last (the prompt says so); `splitVoiceProfile` lifts it
// out either way, so only the render order moved.
function VoiceProfileCard({ body, onChange }: { body: string; onChange?: (next: string) => void }) {
  const [copied, setCopied] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const handleCopy = async () => {
    const ok = await copyToClipboard(body)
    if (ok) {
      setCopied(true)
      addToast('Voice profile copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } else {
      addToast('Copy failed', 'error')
    }
  }
  return (
    <div className="rounded-2xl border border-scripts-500/15 bg-scripts-500/[0.04] p-3 card-soft-shadow">
      <div className="relative mb-2 flex select-none items-center justify-center gap-2 px-8">
        <span className="flex items-center gap-1.5 text-center text-[10px] font-semibold uppercase tracking-tight text-scripts-300">
          <Mic className="h-3 w-3 text-scripts-300" strokeWidth={2} />
          Voice Profile · same in every scene
        </span>
        <button
          onClick={handleCopy}
          title={copied ? 'Copied' : 'Copy the voice profile'}
          aria-label={copied ? 'Copied' : 'Copy the voice profile'}
          className="absolute right-0 top-1/2 flex -translate-y-1/2 shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-ink-600 transition-colors hover:bg-ink/5 hover:text-ink-300"
        >
          {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
          <span className="max-md:hidden">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      {/* Always-on field, not click-to-edit: this block is plain prose with
          nothing tinted in it, so a textarea styled as the paragraph looks
          identical and costs nothing — the same rule a spoken line and a script
          paragraph follow. Multi-line, since a voice profile is a paragraph. */}
      <EditableText
        value={body}
        onCommit={onChange}
        ariaLabel="Voice profile"
        className="whitespace-pre-wrap rounded-xl bg-surface-0 p-2.5 text-[13px] font-light leading-relaxed tracking-tight text-ink-100"
        render={(
          <div className="whitespace-pre-wrap rounded-xl bg-surface-0 p-2.5 text-[13px] font-light leading-relaxed tracking-tight text-ink-100">
            {body}
          </div>
        )}
      />
    </div>
  )
}

// The in-place editor every output block uses: a textarea styled as the prose
// it replaces, with no chrome until you're in it (a hover tint says "editable"
// without printing a box around every line). There is no edit MODE to enter —
// you click the words and type, which is the whole point. The header's raw Edit
// button survives as the escape hatch, because a single box over the take text
// is still the only way to ADD a scene, a line, or a hook (removing a scene is
// the scene header's own button).
//
// The field is ALWAYS on — every block that takes one is plain text, so a
// textarea styled as the paragraph looks identical and costs nothing. A
// `clickToEdit` variant used to exist for the two blocks whose render added the
// [CHARACTER] / [PRODUCT] tint, which a bare textarea can't reproduce; those now
// use `TokenField`, which paints the tint behind a real field instead, so
// nothing has to swap on click any more.
// `render` IS the read-only rendering when no `onCommit` is given, so a card
// without an edit handler looks exactly as it did before.
function EditableText({
  value,
  onCommit,
  className,
  ariaLabel,
  singleLine = false,
  render,
}: {
  value: string
  // Omitted → read-only. A card with no edit handler renders exactly as before.
  onCommit?: (next: string) => void
  className: string
  ariaLabel: string
  // Enter commits instead of breaking the text in two, and anything pasted in
  // is flattened. For a hook or a spoken line, which are one line by definition.
  singleLine?: boolean
  render?: ReactNode
}) {
  const [draft, setDraft] = useState(value)
  const [sync, setSync] = useState(value)
  // Escape has to be able to cancel WITHOUT the blur it triggers committing the
  // draft it just discarded — setDraft is async, so `commit` would still read
  // the typed value. A ref is the only thing that's already updated by then.
  const reverting = useRef(false)
  if (value !== sync) {
    setSync(value)
    setDraft(value)
  }

  if (!onCommit) return <>{render ?? value}</>

  const commit = () => {
    if (reverting.current) {
      reverting.current = false
      setDraft(value)
      return
    }
    const next = singleLine ? draft.replace(/\s+/g, ' ').trim() : draft.trim()
    // An emptied block reverts rather than committing: prose that vanishes as
    // you clear it reads as the row deleting itself, and deleting is the raw
    // editor's job.
    if (!next) {
      setDraft(value)
      return
    }
    if (next !== draft) setDraft(next)
    if (next !== value) onCommit(next)
  }

  return (
    <AutoGrowTextarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (singleLine && e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          reverting.current = true
          e.currentTarget.blur()
        }
      }}
      rows={1}
      spellCheck={false}
      aria-label={ariaLabel}
      // No fill on focus. It used to go `bg-surface-0` — near-black — the
      // instant the caret landed, so clicking a line to fix a word read as a
      // black editor box opening over the script. A field that looks exactly
      // like the prose it replaced is the whole idea; the hover tint says
      // "editable" on the way in and gets out of the way once you're typing.
      className={`-mx-1.5 -my-1 w-[calc(100%+0.75rem)] cursor-text resize-none rounded-lg bg-transparent px-1.5 py-1 outline-none transition-colors hover:bg-ink/[0.04] ${className}`}
    />
  )
}

// One hook in the pack — its family chip, the spoken line, and a copy button.
// The copy target is the clean line only (the chip is UI metadata).
//
// The line IS the editor when `onChange` is given: it's a textarea styled as
// the paragraph it replaces, so clicking a hook puts the caret in it. There's
// no edit mode to enter, which is the whole point — the alternative was
// swapping the ten rendered rows for one raw box of <FAMILY> tags to fix a
// typo in line 3.
function HookLineCard({ hook, index, onChange }: { hook: ParsedHook; index: number; onChange?: (text: string) => void }) {
  const [copied, setCopied] = useState(false)
  // Local draft so a keystroke doesn't re-serialise and re-parse the whole
  // pack; committed on blur. `sync` tells our own commit from an external
  // change (an undo, a new generation) and re-seeds the draft for the latter.
  const addToast = useAppStore((s) => s.addToast)

  const handleCopy = async () => {
    const ok = await copyToClipboard(hook.text.replace(/\s+/g, ' ').trim())
    if (ok) {
      setCopied(true)
      addToast('Hook copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } else {
      addToast('Copy failed', 'error')
    }
  }
  return (
    <div className="rounded-2xl border border-ink/5 bg-ink/[0.02] p-3 transition-colors focus-within:border-scripts-500/30 card-soft-shadow">
      <div className="mb-1.5 flex select-none items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[10px] font-semibold tabular-nums text-ink-600">{index + 1}</span>
          {hook.category && (
            <span className="truncate rounded-full bg-scripts-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tight text-scripts-300">
              {HOOK_CATEGORY_META[hook.category].label}
            </span>
          )}
        </span>
        <button
          onClick={handleCopy}
          title={copied ? 'Copied' : 'Copy this hook'}
          aria-label={copied ? 'Copied' : 'Copy this hook'}
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-ink-600 transition-colors hover:bg-ink/5 hover:text-ink-300"
        >
          {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
          <span className="max-md:hidden">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <EditableText
        value={hook.text}
        onCommit={onChange}
        singleLine
        ariaLabel={`Hook ${index + 1}`}
        className="text-sm font-light leading-normal tracking-tight text-ink-100"
        // Read-only fallback keeps the paragraph it always was.
        render={<p className="text-sm font-light leading-normal tracking-tight text-ink-100">{hook.text}</p>}
      />
    </div>
  )
}

// The other half of the `select-none` chrome rule. Marking a header or a Copy
// button unselectable keeps it out of the highlight, but it ALSO tells Chrome to
// leave an existing selection alone when you press on it — the behaviour a
// rich-text toolbar wants, and the reason a highlight in this panel could look
// stuck: clicking the nearest thing to "somewhere else" (a scene header, a copy
// button) did nothing to it. Collapse it ourselves, which is what a click on
// ordinary page background does anyway.
function clearSelectionOnChrome(e: React.MouseEvent) {
  const target = e.target as Element | null
  if (!target || getComputedStyle(target).userSelect !== 'none') return
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) selection.removeAllRanges()
}

// `onEditRange` splices a span of the TAKE text — the chunk's own `bodyStart`
// plus the segment's offset within the body. That's what makes editing a scene
// where it sits exact: no search (two scenes can share a sentence) and no
// reconstruction (the parse trims, strips and filters, so it doesn't round-trip).
function SceneChunkCard({
  chunk,
  onEditRange,
  onDelete,
  collapsed = false,
  onToggleCollapsed,
}: {
  chunk: SceneChunk
  onEditRange?: (start: number, end: number, next: string) => void
  // Omitted → no delete button (a card with no edit handler is read-only).
  onDelete?: () => void
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const handleCopy = async () => {
    const ok = await copyToClipboard(chunk.body)
    if (ok) {
      setCopied(true)
      addToast('Scene copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } else {
      addToast('Copy failed', 'error')
    }
  }
  // Split the paragraph into direction + spoken lines. A body with nothing in
  // quotes (a silent scene, or a shape the parser doesn't recognise) falls back
  // to the plain prose block, so nothing can render as an empty card.
  const segments = useMemo(() => splitSpokenLines(chunk.body), [chunk.body])
  const hasSpoken = segments.some((s) => s.kind === 'line')
  const { label, time } = splitHeaderTime(chunk.header)
  const duration = time ? rangeDurationLabel(time) : null
  return (
    <div className="rounded-2xl border border-ink/5 bg-ink/[0.02] p-3 card-soft-shadow">
      {/* The header wraps rather than truncating — a scene label plus its
          timecode outruns a narrow pane, and the timing is the half a member
          came here to read. Symmetric padding on a row whose chrome is pinned
          to both edges: the label centres on the CARD, not on whatever is left
          over between the buttons. */}
      <div className={`relative flex select-none flex-wrap items-center justify-center gap-x-2 gap-y-1 px-16 ${collapsed ? 'mb-1.5' : 'mb-2'}`}>
        {/* Fold, not delete — a scene you're done with gets out of the way of
            the one you're working on, and the take text is untouched. */}
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            title={collapsed ? 'Show scene' : 'Hide scene'}
            aria-label={collapsed ? 'Show scene' : 'Hide scene'}
            aria-expanded={!collapsed}
            className="absolute left-0 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
        <span className="text-center text-[10px] font-semibold uppercase tracking-tight text-scripts-300">
          {label}
        </span>
        {/* The timecode as its own pill: tabular figures so a column of scenes
            lines up digit for digit, and one step brighter than the label,
            because "where does this beat land" is what's being scanned for.
            The range is followed by how long it RUNS — the range alone is two
            clock times to subtract, and the answer is what the scene gets shot
            and generated at. */}
        {time && (
          <span className="shrink-0 rounded-full bg-scripts-500/[0.14] px-2 py-0.5 text-[10px] font-semibold tabular-nums tracking-tight text-scripts-200">
            {time}
            {duration && <span className="text-scripts-200/60"> · {duration}</span>}
          </span>
        )}
        <div className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          <button
            onClick={handleCopy}
            title={copied ? 'Copied' : 'Copy this scene'}
            aria-label={copied ? 'Copied' : 'Copy this scene'}
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-ink-600 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
            <span className="max-md:hidden">{copied ? 'Copied' : 'Copy'}</span>
          </button>
          {/* The house two-click delete, in its panel skin — never a modal. It
              cuts the scene out of the take and renumbers what's left, and it
              rides the card's undo stack like every other edit here. */}
          {onDelete && (
            <TileDeleteButton
              onDelete={onDelete}
              title="Delete scene"
              variant="chrome"
              size="sm"
              alwaysVisible
            />
          )}
        </div>
      </div>
      {collapsed ? (
        // One dim line of the body, so a folded scene is still findable — the
        // point is to get it out of the way, not to hide which one it is.
        <p className="truncate px-1 text-[12px] font-light tracking-tight text-ink-600">{chunk.body}</p>
      ) : hasSpoken ? (
        <div className="flex flex-col gap-2">
          {segments.map((segment, i) =>
            segment.kind === 'line' ? (
              <SpokenLine
                key={i}
                speaker={segment.speaker}
                text={segment.text}
                onChange={onEditRange ? (next) => onEditRange(chunk.bodyStart + segment.start, chunk.bodyStart + segment.end, next) : undefined}
              />
            ) : (
              // Direction is context for the shot, not the script — set a step
              // down in size and weight so the eye lands on the line first.
              // A live field with the [CHARACTER] / [PRODUCT] slots washed in
              // behind it: the tint is what used to force this block to be
              // click-to-edit, and it survives while you type now.
              <TokenField
                key={i}
                value={segment.text}
                onCommit={onEditRange ? (next) => onEditRange(chunk.bodyStart + segment.start, chunk.bodyStart + segment.end, next) : undefined}
                ariaLabel="Scene direction"
                className="-mx-1.5 -my-1 w-[calc(100%+0.75rem)] rounded-lg transition-colors hover:bg-ink/[0.04]"
                padClass="px-1.5 py-1"
                textClass="text-[12.5px] font-light leading-relaxed tracking-tight text-ink-400"
              />
            ),
          )}
        </div>
      ) : (
        // No quoted line in this scene (a silent beat, or an Ad Analyzer
        // blueprint whose scenes are pure direction) — the whole body is one
        // block, and editing it writes back the whole body span.
        // Body matches the Write/Remix script output: inherited Geist + white.
        <TokenField
          value={chunk.body}
          onCommit={onEditRange ? (next) => onEditRange(chunk.bodyStart, chunk.bodyEnd, next) : undefined}
          ariaLabel="Scene prompt"
          className="rounded-xl bg-surface-0"
          padClass="p-2.5"
          textClass="text-[13px] font-light leading-relaxed tracking-tight text-ink-100"
        />
      )}
    </div>
  )
}

export default function OutputPanel({ variations, outputAngles, mode, liveMode, writeFormat, writeStyleLabel, hookCategoryLabel, hookCount = DEFAULT_HOOK_COUNT, linkedProductId, isGenerating, error, runId, onEditVariation }: OutputPanelProps) {
  // Resolve the linked product so saved scripts get a meaningful default title
  // ("<Product> — Hook-Led Script").
  const products = useBankStore((s) => s.products)
  const product = linkedProductId ? products.find((p) => p.id === linkedProductId) : undefined
  const productName = product?.productName

  // A hooks pack (write mode + 'hooks' format) renders as tagged one-liners.
  const isHooks = mode === 'write' && writeFormat === 'hooks'

  // Take switcher — a 1/2/3 row above the cards that scrolls the matching take
  // into view. `activeTake` tracks which card is currently nearest the top so
  // the row highlights as you scroll, not just on click. Deliberately a scroll
  // rather than tabs: every take stays in one continuous column, so you can read
  // straight through them instead of committing to one at a time.
  const scrollRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const [activeTake, setActiveTake] = useState(0)

  // New RUN → reset to the first take and the top of the list. Keyed on the
  // run's identity, never on the takes' text: every block on a card is edited
  // in place, so the text changes under us constantly, and keying on it sent a
  // member who fixed a typo in take 3 back to the top of take 1 the moment they
  // committed it. The array identity is no use either — the parent hands down a
  // fresh array on every render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // No run to jump to: takes restored from a persisted draft on mount (the
    // list is at the top already), or the row being shown was just deleted from
    // History — neither is a reason to move what the member is reading.
    if (!runId) return
    setActiveTake(0)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [runId])
  /* eslint-enable react-hooks/set-state-in-effect */

  const scrollToTake = (i: number) => {
    setActiveTake(i)
    const card = cardRefs.current[i]
    const container = scrollRef.current
    if (!card || !container) return
    const top = card.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    suspendChromeAutoHide()
    container.scrollTo({ top: Math.max(0, top - 20), behavior: 'smooth' })
  }

  const handleScroll = () => {
    const container = scrollRef.current
    if (!container) return
    // At the bottom the trailing cards can't reach the top, so anchor the
    // last take as active; otherwise pick the last card whose top has scrolled
    // past the container's upper edge.
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4
    let idx = variations.length - 1
    if (!atBottom) {
      const cTop = container.getBoundingClientRect().top
      idx = 0
      for (let i = 0; i < variations.length; i++) {
        const card = cardRefs.current[i]
        if (card && card.getBoundingClientRect().top - cTop <= 40) idx = i
      }
    }
    setActiveTake((prev) => (prev === idx ? prev : idx))
  }

  // Empty + loading copy follows the live selector (what you're about to make);
  // the cards themselves follow `mode` (what actually produced them).
  const copyMode = liveMode ?? mode

  if (isGenerating) {
    const message = copyMode === 'write'
      ? (writeFormat === 'hooks'
          ? ['Reading your brief...', 'Digging through the hook library...', `Writing ${hookCount} hooks...`, 'Cutting the weak ones...']
          : ['Reading your brief...', 'Writing the takes...', 'Making it sound human...', 'Tightening the hooks...'])
      : copyMode === 'remix'
        ? ['Building the angles...', 'Sending parallel requests...', 'Writing variations...', 'Polishing final drafts...']
        : ['Reading scene blueprint...', 'Mapping product into structure...', 'Rewriting scenes...', 'Preserving structure...']
    return (
      <GridCanvas className="h-full">
        <div className="relative flex h-full flex-col gap-2 p-5">
          <GenerationProgress isActive color="bg-scripts-500" messages={message} showHelper={false} />
          {/* Accent glow while the words are being written — the same "this is
              alive" cue the media apps get on a generating frame. */}
          <div className="flex flex-1 min-h-0 flex-col gap-3 rounded-3xl border border-scripts-500/20 bg-surface-1 p-5 shadow-[0_0_90px_-24px_var(--color-scripts-500)]">
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-[90%]" />
            <div className="skeleton h-4 w-[95%]" />
            <div className="skeleton h-4 w-[70%]" />
            <div className="mt-2 skeleton h-4 w-full" />
            <div className="skeleton h-4 w-[85%]" />
            <div className="skeleton h-4 w-[92%]" />
          </div>
        </div>
      </GridCanvas>
    )
  }

  if (variations.length === 0) {
    return (
      <GridCanvas className="h-full">
        <div className="relative flex h-full flex-col items-center justify-center gap-3 p-8">
          <PenLine className="h-8 w-8 text-ink-800" strokeWidth={1.5} />
          <p className="text-sm text-ink-700">
            {copyMode === 'write'
              ? (writeFormat === 'hooks' ? `Your ${hookCount} hooks will appear here` : 'Your takes will appear here')
              : copyMode === 'remix' ? 'Your script variations will appear here' : 'Your scene prompts will appear here'}
          </p>
          {error && (
            <div className="mt-2 flex max-w-sm items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400 light:text-red-600" />
              <p className="text-xs leading-relaxed text-red-300 light:text-red-700">{error}</p>
            </div>
          )}
        </div>
      </GridCanvas>
    )
  }

  // Prefer what the run actually used; fall back to matching by count for rows
  // saved before the angle list was stamped.
  const angles = outputAngles?.length === variations.length
    ? outputAngles
    : remixAnglesForCount(variations.length)
  const takeUnit = mode === 'remix' ? 'Variation' : 'Take'

  // No canvas once the takes are in: the grid marks an empty stage waiting for
  // work, and behind finished output it's just texture under the reading.
  return (
    <div className="flex h-full flex-col overflow-hidden" onMouseDown={clearSelectionOnChrome}>
      {variations.length > 1 && (
        <div className="flex select-none items-center justify-center border-b border-ink/5 px-5 py-2.5">
          <div className="flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.02] p-0.5">
            {variations.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => scrollToTake(i)}
                aria-label={`Jump to ${takeUnit} ${i + 1}`}
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums transition-colors ${
                  activeTake === i
                    ? 'bg-scripts-500/15 text-scripts-300'
                    : 'text-ink-500 hover:bg-ink/5 hover:text-ink-200'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
      <div ref={scrollRef} onScroll={handleScroll} className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto p-5">
        {variations.map((text, i) => {
          const isRemix = mode === 'remix'
          const isWrite = mode === 'write'
          const angleLabel = isRemix && angles ? REMIX_ANGLE_LABEL[angles[i]] : null
          const cardTitle = isHooks
            ? `Hooks · ${hookCategoryLabel ?? 'Best Mix'}`
            : isWrite
              ? `Take ${i + 1}${writeStyleLabel ? ` · ${writeStyleLabel}` : ''}`
              : angleLabel
                ? `Variation ${i + 1}: ${angleLabel}`
                : isRemix
                  ? `Variation ${i + 1}`
                  : 'Scene prompts'
          const defaultSaveTitle = isHooks
            ? (productName ? `${productName} — Hooks (${hookCategoryLabel ?? 'Best Mix'})` : `Hooks — ${hookCategoryLabel ?? 'Best Mix'}`)
            : isWrite && productName
              ? `${productName} — ${writeStyleLabel ?? 'New'} Take ${i + 1}`
              : isRemix && productName
                ? `${productName} — ${angleLabel ?? `Variation ${i + 1}`} Script`
                : deriveTitleFromContent(
                      text,
                      mode === 'reverse-engineer' ? 'Reverse-engineered prompts' : 'Untitled script',
                    )
          return (
            <VariationCard
              key={i}
              cardRef={(el) => { cardRefs.current[i] = el }}
              text={text}
              cardTitle={cardTitle}
              defaultSaveTitle={defaultSaveTitle}
              linkedProductId={linkedProductId}
              mode={mode}
              isHooks={isHooks}
              onEdit={onEditVariation ? (newText) => onEditVariation(i, newText) : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}

// Derive a human-readable title from reverse-engineered prompt content.
// Strategy: skip scene dividers and label lines, find the first prose
// sentence, take ~6 words, Title Case. Falls back to a sensible default.
function deriveTitleFromContent(text: string, fallback = 'Untitled script'): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    // Skip scene dividers ("--- Scene 1: HOOK ---") and short ALL-CAPS labels
    // ("HOOK", "VISUAL:", "VOICEOVER:").
    if (/^---/.test(line)) continue
    if (/^[A-Z][A-Z\s:]{0,30}:?$/.test(line)) continue
    // Skip lines that are only a bracketed section label, e.g. "[HOOK]".
    if (/^\[[^\]]+\]\s*$/.test(line)) continue
    // Strip leading markers like "[HOOK]", "Visual:", "Voiceover:", "1.", "- ".
    const cleaned = line
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/^[*\-•]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/^(visual|voiceover|action|dialogue|shot|scene|hook|cta)\s*[:-]\s*/i, '')
      .trim()
    if (cleaned.length < 6) continue
    const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned
    const words = firstSentence.split(/\s+/).slice(0, 7).join(' ')
    const trimmed = words.replace(/[.,;:!?-]+$/, '').trim()
    if (trimmed.length < 4) continue
    // Title case the first letter only; preserve original casing otherwise.
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  }
  return fallback
}

// Robust clipboard write with a textarea fallback for older browsers / non-
// secure contexts. Returns true if the copy succeeded.
async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
