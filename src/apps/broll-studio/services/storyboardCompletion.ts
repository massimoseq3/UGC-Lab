// Is a storyboard response the WHOLE storyboard — and if it isn't, how to ask
// for the rest.
//
// The storyboard is by a wide margin the longest single output in this app. A
// dozen-line script asks for three paragraph-length prompts AND three motion
// lines per line, under a prompt that explicitly forbids trimming a detail to
// keep the answer short. So it is the one call that routinely runs into a
// model's output ceiling — and when it does, the answer stops mid-scene and
// nothing downstream notices: the tag readers in `xmlBlocks` are deliberately
// tolerant of a missing closing tag, so half a storyboard renders as a SHORT
// storyboard, with no error, no warning, and the member firing paid image and
// video generations against scenes their script never got. Reported as B-Roll
// "cutting out half way through".
//
// TWO tests, because there are two different ways to come back short and
// neither one catches the other:
//
//  1. The model hit its ceiling. The transport knows this — the streaming one
//     throws `TruncatedResponseError`, and the jobs one now reads the same stop
//     reason (`chatTaskHitTokenLimit`). Authoritative when it fires.
//
//  2. The model simply stopped early. No transport can see this — the run
//     reports a clean stop — and it is not hypothetical: Gemini 3.7 Flash was
//     promoted and reverted inside a day over exactly this symptom (see the
//     model table in the root CLAUDE.md). So it is measured against the SCRIPT
//     instead, which works because of a rule the prompt already enforces:
//     every <LINE> is the script's own words, in the script's order, with only
//     a connecting word dropped at a split. A storyboard whose lines account
//     for half the script's words covered half the script.
//
// The answer to both is the same and it is not an error message: ASK FOR THE
// REST. A continuation is a normal chat turn — the partial goes back as the
// assistant's own words and the model carries on from where it stopped — and
// it keeps everything a fresh run would lose, most importantly the dialogue
// anchor take that every VAR_1 has to stay inside.

import type { ChatMessage } from '../../../utils/kie'

export type StoryboardMode = 'line' | 'continuous'

/**
 * How much of the script's words the emitted <LINE>s have to account for
 * before the storyboard counts as covering it. Not 1: the prompt lets the
 * model drop a connecting word when it splits a sentence, and a scene or two
 * of ordinary paraphrase must not cost a member an extra paid call. A run that
 * stopped half way sits around 0.5, nowhere near this.
 */
const SCRIPT_COVERAGE_FLOOR = 0.85

/** How many times we'll ask for the rest before settling for what we have. */
export const MAX_STORYBOARD_CONTINUATIONS = 3

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * The script as the storyboard is expected to quote it back. A pasted script
 * routinely carries things that are NOT the voiceover — a [cut to the kitchen]
 * stage direction, a (beat), a "HOOK:" or "SCENE 2:" label down the left — and
 * the prompt tells the model to write the spoken words only. Counting that
 * scaffolding as script it failed to cover is how a perfectly complete
 * storyboard would be accused of stopping short, and charged for a
 * continuation call to prove otherwise.
 */
function spokenScript(scriptText: string): string {
  return scriptText
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .split('\n')
    // A leading label — "HOOK:", "SCENE 2:", "VO —". Bounded to a few words so
    // it can never eat a line that simply contains a colon mid-sentence.
    .map((line) => line.replace(/^\s*[A-Za-z][A-Za-z0-9 ]{0,20}\s*[:—–-]\s+/, ''))
    .join('\n')
}

/**
 * Every <LINE> body in the response. Tolerant of a missing </LINE> — the last
 * line of a truncated answer is exactly the one that has no closing tag, and
 * it is the one that tells us how far the model got.
 */
function emittedLines(responseText: string): string[] {
  const out: string[] = []
  const re = /<LINE>([\s\S]*?)(?:<\/LINE>|<|$)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(responseText))) {
    const body = m[1].trim()
    if (body) out.push(body)
  }
  return out
}

/**
 * The share of the script the emitted lines account for, 0–1. Word counts
 * rather than a positional match on purpose: the model is allowed to drop a
 * connecting word and to split one sentence into two lines, so anything that
 * tries to align the two texts exactly reports a false shortfall on a
 * storyboard that is perfectly fine. What we need to tell apart is "all of it"
 * from "the first half", and a ratio does that with nothing to go wrong.
 */
export function scriptCoverage(scriptText: string, responseText: string): number {
  const script = words(spokenScript(scriptText)).length
  if (script === 0) return 1
  const covered = emittedLines(responseText).reduce((n, line) => n + words(line).length, 0)
  return Math.min(1, covered / script)
}

/** Did this response stop before the end of the script? */
export function isStoryboardShort(scriptText: string, responseText: string): boolean {
  return scriptCoverage(scriptText, responseText) < SCRIPT_COVERAGE_FLOOR
}

/**
 * How many scenes a response holds. Only used to tell whether a continuation
 * actually added anything — a model that answers "there is nothing left to
 * write" must end the loop rather than being asked again three more times.
 */
export function sceneCount(responseText: string, mode: StoryboardMode): number {
  const re = mode === 'line' ? /<SCENE>/gi : /<SCENE_?\d+>/gi
  return responseText.match(re)?.length ?? 0
}

/**
 * The response cut back to its last COMPLETE scene. The half-written one at the
 * end is what the continuation is about to write properly, and feeding a
 * fragment back as the assistant's own turn invites the model to finish that
 * sentence rather than that scene. Returns '' when not one scene closed, which
 * the caller reads as "nothing worth continuing from".
 */
export function trimToLastCompleteScene(responseText: string, mode: StoryboardMode): string {
  const re = mode === 'line' ? /<\/SCENE>/gi : /<\/SCENE_?\d+>/gi
  let end = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(responseText))) end = m.index + m[0].length
  return end === -1 ? '' : responseText.slice(0, end)
}

/**
 * The partial and the continuation, joined into one storyboard.
 *
 * Line-by-line scenes are an unnumbered `<SCENE>` list, so a model that ignores
 * "do not repeat a scene you have already written" would put duplicate cards on
 * the canvas — visible, deletable, and exactly the kind of thing that gets
 * reported. A scene whose <LINE> is already in the partial is therefore
 * dropped, keeping the version that was written with the fuller context. Any
 * <VOICE_PROFILE> the continuation emitted survives that drop, since in
 * dialogue delivery it trails the very last scene.
 *
 * Continuous needs none of this: its scenes are numbered and
 * `extractNumberedBlock` takes the first <SCENE_N> it finds, so a repeat is
 * already ignored by the reader.
 */
export function stitchStoryboard(head: string, tail: string, mode: StoryboardMode): string {
  const body = tail.trim()
  if (mode === 'continuous') return `${head}\n${body}`

  const seen = new Set(emittedLines(head).map(normalizeLine))
  const chunks = body.split(/<SCENE>/i).slice(1)
  const kept: string[] = []
  let voiceProfile = ''
  for (const chunk of chunks) {
    const line = normalizeLine(emittedLines(`<SCENE>${chunk}`)[0] ?? '')
    if (line && seen.has(line)) {
      voiceProfile ||= chunk.match(/<VOICE_PROFILE>[\s\S]*?<\/VOICE_PROFILE>/i)?.[0] ?? ''
      continue
    }
    if (line) seen.add(line)
    kept.push(`<SCENE>${chunk}`)
  }
  // Nothing recognisable came back as a scene — keep the raw answer rather than
  // silently throwing away whatever the model did write.
  if (chunks.length === 0) return `${head}\n${body}`
  return [head, ...kept, voiceProfile].filter(Boolean).join('\n')
}

function normalizeLine(line: string): string {
  return words(line).join(' ')
}

/**
 * The continuation turn: the model's own partial handed back to it, then a
 * plain instruction to carry on. Deliberately quotes the last line it wrote
 * rather than trying to hand it the remaining script — the whole script is
 * already in the original user turn, so naming where it stopped is all it
 * needs, and computing "the rest" ourselves would mean guessing at a split we
 * did not make.
 */
export function continuationMessages(
  base: ChatMessage[],
  partial: string,
  mode: StoryboardMode,
): ChatMessage[] {
  const lines = emittedLines(partial)
  const lastLine = lines[lines.length - 1] ?? ''
  const envelope = mode === 'line' ? '<SCENE>' : '<SCENE_N>'
  const tail =
    mode === 'line'
      ? 'When you reach the end of the script, finish with the <VOICE_PROFILE> block if this delivery calls for one.'
      : 'When you reach the end of the script, finish with the <FINAL_FRAME> block and </STORYBOARD>.'
  return [
    ...base,
    { role: 'assistant', content: partial },
    {
      role: 'user',
      content: `That answer stopped before the end of the script${
        lastLine ? `, after the line "${lastLine}"` : ''
      }. Continue the storyboard from the very next line of the script and write it through to the end.

Emit ONLY the remaining ${envelope} blocks, in the same strict format, following every rule you were given. Do not repeat a scene you have already written, do not re-emit anything above, and write no commentary — your answer starts with the next ${envelope} tag. ${tail}`,
    },
  ]
}
