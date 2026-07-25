import type { AnalysisResult, PerceptionResult, SynthesisResult } from '../types'
import { useSettingsStore } from '../../../stores/settingsStore'
import {
  createTask,
  pollTask,
  kieChatCompletions,
  fileToDataUri,
  type ChatMessage,
} from '../../../utils/kie'
import { getChatEndpointPath, CHAT_MODEL_DEFAULT } from '../../../utils/models'
import { formatKeyframeTimestamp, type Keyframe } from '../utils/extractKeyframes'

const CHAT_MODEL_ID = CHAT_MODEL_DEFAULT
// Streaming fallback timeout — kept generous since chat completions don't
// have intermediate progress signals like the task-based flow.
const STREAM_TIMEOUT_MS = 300_000

// The analysis runs as TWO passes so each gets the model's full attention:
//   Pass 1 — PERCEPTION: video attached; pure observation. Transcript, a log
//   of every camera cut, and full visual dossiers (character / product /
//   setting). No strategy, no judgement.
//   Pass 2 — SYNTHESIS: text-only; receives the pass-1 JSON and writes the
//   scorecard, creative breakdown, and the scene-by-scene recreation prompts.
// Splitting also makes pass 2 restartable after a refresh without the source
// file, and stops long ads from running out of output room before the scene
// prompts (the old single mega-call diluted detail across four artifacts).

// ── Pass 1: perception ─────────────────────────────────────────────

const PERCEPTION_SYSTEM = `You are a forensic video analyst logging a social media ad shot-by-shot. Your output is PURE OBSERVATION — no marketing judgement, no strategy, no scoring. A second analyst will work from your log without ever seeing the video, so anything you fail to record is lost forever. Record everything.

You must respond with ONLY valid JSON matching this exact structure (no markdown, no code fences):

{
  "totalDurationSeconds": <integer — the full ad length; 0 for a still image>,
  "characterDossier": "<full identifying description of every person who appears — see DOSSIER RULES>",
  "productDossier": "<full identifying description of the product in every form it appears — see DOSSIER RULES>",
  "settingDossier": "<every location, its lighting, colour palette, and notable props>",
  "transcript": [
    { "timestamp": "<MM:SS>", "text": "<verbatim spoken line>" }
  ],
  "shots": [
    {
      "index": <1-based integer>,
      "start": "<MM:SS>",
      "end": "<MM:SS>",
      "framing": "<close-up / medium / wide / macro / POV / mirror selfie / over-the-shoulder / screen recording / text card / etc.>",
      "camera": "<static / handheld / slow push-in / whip pan / zoom jump / etc.>",
      "action": "<what visibly happens — who does what, how the product is handled, expressions, gestures>",
      "onScreenText": "<any caption / overlay / sticker text VERBATIM, or omit if none>",
      "dialogue": "<the spoken line(s) heard during this shot with speaker attribution, or omit if none>"
    }
  ]
}

SHOT LOG RULES — CRITICAL:
- A shot is ANY visible camera change: a hard cut, an angle change, a location change, a zoom jump, or an inserted b-roll clip / graphic / text card. UGC ads often cut every 1-3 seconds — count the cuts before writing and log EVERY single one in chronological order.
- Shots must cover the ENTIRE ad with no gaps and no overlaps: the first shot starts at 00:00, each shot's start equals the previous shot's end, and the last shot's end equals the total duration. Quick product inserts, b-roll flashes, and end cards are shots too — never fold them into a neighbouring shot.
- "action" describes what you actually SEE, in concrete physical terms: hand positions, product interaction (held / opened / applied / poured / tapped), gaze direction, micro-expressions.
- "onScreenText" is verbatim — captions, hook text, price stickers, UI overlays. Note styling only when distinctive (e.g. "yellow highlight captions").

TRANSCRIPT RULES:
- Transcribe every spoken word verbatim, including filler words and repeated words. One entry per spoken line, timestamped at the moment the line starts.
- If there is no speech (music-only or still image), return an empty transcript array.

DOSSIER RULES — CRITICAL (a video model must be able to recreate these one-for-one):
- characterDossier: for EACH person who appears (label them "Main creator", "Second woman", etc. if more than one): apparent age range, gender presentation, ethnicity cues, body type / build, hair (length, colour, styling, parting), face shape and distinctive features, wardrobe (every visible garment with colour and fit), accessories (jewellery, glasses, headwear, nail polish). Describe what you actually see — never use placeholders.
- productDossier: brand name / wordmark EXACTLY as printed on the label if visible, container shape (dropper bottle / pump / jar / sachet / sleeve / blister pack / box / etc.), container colour and material, label colour and design cues, approximate size relative to the hand. If the product appears in more than one form across the ad (boxed → unboxed → in use), describe each form and note which shots show it.
- settingDossier: each distinct location with its lighting (natural window light / warm tungsten / cool overhead / ring light), colour palette, and notable props or background details.

STILL IMAGE INPUT: if the input is a single image rather than a video, treat it as ONE shot with start "00:00", end "00:00", totalDurationSeconds 0, and an empty transcript; put all visible ad copy in onScreenText and fill the dossiers normally.

HONESTY: record only what is actually visible or audible. Never invent details, brands, or dialogue.

Output ONLY the JSON object.`

const PERCEPTION_USER_PROMPT = `Log this ad completely: full verbatim timestamped transcript, every single camera cut as its own shot entry (count the cuts first — do not merge or skip any), and full identifying dossiers for the character(s), the product, and the setting(s). Return as JSON.`

// ── Pass 2: synthesis ──────────────────────────────────────────────

const SYNTHESIS_SYSTEM = `You are an elite UGC ad analyst and creative director. You receive a forensic shot log of a social media ad — a verbatim transcript, a chronological list of every camera cut, and full visual dossiers of the character(s), product, and setting(s). From it you produce three things: a brutally honest scorecard, a strategy-level creative breakdown (hook / angle / structure + a reusable script-style prompt), and a reverse-engineered prompt that could be sent to a text-to-video model (e.g. Seedance, Veo) to recreate the ad ONE-FOR-ONE, faithfully.

You must respond with ONLY valid JSON matching this exact structure (no markdown, no code fences):

SCORECARD RULE: Be brutally honest. Do not inflate scores. Most ads are average (5/10). If a hook is boring, give it a 2 or 3. If the visuals are static, penalize it. A 9/10 or 10/10 should be reserved for big direct-to-consumer brands level.

CREATIVE BREAKDOWN RULE: This is a marketing-strategy dissection of WHY the ad works — not shot description. Write for a DTC media buyer who wants to steal the mechanics:

1. hook (2-4 sentences): Quote the exact opening line / on-screen text / opening visual doing the work in the first 1-3 seconds (pull them verbatim from the shot log). Name the hook mechanism (pattern interrupt, curiosity gap, negative callout, bold claim, result-first reveal, direct callout of the viewer, etc.) and the psychological trigger it pulls. Say plainly why it stops the scroll — or why it fails to.

2. angle (2-4 sentences): The core persuasion angle / positioning (pain-point relief, transformation, discovery/"I found this", us-vs-them, social proof, authority, fear of loss, convenience, identity, etc.), who it targets, and the audience awareness level it assumes (unaware / problem-aware / solution-aware / product-aware).

3. structure: A beat-by-beat skeleton of the ENTIRE ad, one beat per line, each formatted exactly as: "MM:SS–MM:SS <BEAT NAME> — <what it does psychologically>". Name beats in direct-response terms (Hook, Problem, Agitation, Discovery, Mechanism, Demo, Proof, Objection Handle, Offer, Urgency, CTA...). Cover 00:00 to the end, using the shot log's timestamps.

4. stylePrompt — THE REUSABLE ARTIFACT, TREAT WITH MAXIMUM CARE: A fully self-contained writing brief that a scriptwriter (human or AI) can paste in, together with any NEW product's details, to write a brand-new ad script from scratch in this ad's exact style. Requirements:
   - Strip EVERY reference to the original brand, product, niche, and claims. Refer only to "the product", "the viewer", "the pain point". The prompt must work for a skincare serum and a dog toy equally.
   - Open with one sentence stating what this style is and when to use it.
   - Then short labeled sections, each label in CAPS on its own line: HOOK FORMULA (the opening line as a fill-in-the-blank template, e.g. "I did [common behaviour] for years before I realized [costly mistake]"), ANGLE (the positioning + awareness level to write for), STRUCTURE (the beat sequence with relative timing, e.g. "beats for a ~30s read: Hook 0-3s → Agitation 3-8s → ..."), PSYCHOLOGY (the ordered triggers to hit: e.g. curiosity → self-recognition → hope → proof → urgency), VOICE (tone, pacing, sentence-length rules, first/second person, energy), DTC FUNDAMENTALS (the direct-response rules this ad executes: one idea per beat, concrete specifics over claims, name the product late, undersell the result, CTA style — whichever this ad actually uses).
   - NEVER open a line with "Scene 1", "--- Scene" or any numbered scene header — this is a writing brief, not a scene blueprint.
   - No markdown syntax; plain text with the CAPS labels.

SCENE RULES — CRITICAL (the recreation prompts):

1. CHUNKING: Read totalDurationSeconds. If it is 15 seconds or less, produce a SINGLE scene that covers the whole ad. Otherwise break the ad into multiple scenes at natural shot boundaries. Each scene MUST be 15 seconds or less. Aim for 8–12 seconds per scene. Number scenes starting at 1.

2. FULL COVERAGE: The scenes together MUST cover the ENTIRE ad with no gaps and no overlaps. The first scene starts at 00:00. Every subsequent scene's startTime MUST equal the previous scene's endTime. The final scene's endTime MUST equal the total ad duration.

3. EVERY SHOT: Every shot in the log belongs to exactly one scene, and every shot in a scene MUST appear in that scene's prompt, in chronological order, as a timeline — e.g.: "[0:00–0:03] Close-up: she holds the dropper bottle to camera... [0:03–0:05] Quick cut to macro of serum texture... [0:05–0:08] Back to medium shot, she applies it to her cheek...". Never summarize a multi-cut scene down to its dominant shot. 1–3 sentences per shot; length grows with the number of cuts.

4. SELF-CONTAINED PROMPTS: Each scene's prompt must stand alone — a video model sees ONE scene at a time. So in EVERY scene prompt: describe the character in full identifying detail from characterDossier (age, hair, wardrobe, accessories — never "the same woman", never [CHARACTER]); describe the product in full identifying detail from productDossier including the exact form it takes in that scene (never "the product", never [PRODUCT]); embed the original spoken line(s) from the shot log in quotes with speaker attribution, e.g. "She says: 'I had dark spots from years of sun damage and nothing worked.'" — keep dialogue separate from action / camera direction; include on-screen text where the log records it; and state setting, framing, camera movement, lighting, and mood from the dossiers.

5. LABEL: Each scene's label is a short noun phrase (3–6 words) describing the shot — e.g. "Mirror reaction hook", "Product unboxing close-up", "Bathroom routine reveal".

AD TITLE: Produce a short (3–6 word) Title Case descriptor of the ad as a whole, naming the product/brand and the angle. Examples: "Dunkin Zero-Sugar Berry Energy", "Glow Skin Serum Routine Reveal", "Tarte Two-Minute Glam Tutorial". No quotes, no trailing punctuation.

{
  "adTitle": "<3-6 word Title Case descriptor>",
  "scorecard": {
    "scores": [
      { "label": "Hook Strength", "score": <1-10> },
      { "label": "Structure Clarity", "score": <1-10> },
      { "label": "Visual Variety", "score": <1-10> },
      { "label": "Persuasion Depth", "score": <1-10> },
      { "label": "Overall Execution", "score": <1-10> }
    ],
    "analystNote": "<2-3 sentence analyst summary>"
  },
  "creativeBreakdown": {
    "hook": "<2-4 sentences — the exact opening beat, the hook mechanism, the trigger, why it stops the scroll>",
    "angle": "<2-4 sentences — persuasion angle, target, awareness level>",
    "structure": "<one beat per line: MM:SS–MM:SS BEAT NAME — psychological job, newline-separated>",
    "stylePrompt": "<product-agnostic reusable writing brief with CAPS-labelled sections, per the CREATIVE BREAKDOWN RULE>"
  },
  "reverseEngineeredPrompt": {
    "totalDurationSeconds": <integer>,
    "isSingleClip": <boolean — true if totalDurationSeconds <= 15>,
    "scenes": [
      {
        "index": <1-based integer>,
        "startTime": "<MM:SS>",
        "endTime": "<MM:SS>",
        "durationSeconds": <integer, <= 15>,
        "label": "<short shot name>",
        "prompt": "<self-contained recreation prompt — shot-by-shot timeline, full character + product descriptions, embedded dialogue>"
      }
    ]
  }
}`

function synthesisUserPrompt(perception: PerceptionResult): string {
  return `Here is the forensic shot log of a UGC ad. Produce (1) a brutally honest scorecard, (2) the creative breakdown — hook, angle, beat-by-beat structure, plus the product-agnostic reusable style prompt, and (3) the reverse-engineered scene prompts — scenes of ≤15 seconds covering the entire ad, with every logged shot described in chronological order inside its scene's timeline and the full character/product descriptions embedded in every scene prompt. Return as JSON.

--- SHOT LOG ---
${JSON.stringify(perception, null, 2)}`
}

// Inline data URI in the chat message. We previously tried kie's hosted-URL
// upload but the createTask + recordInfo path didn't return results for the
// chat model (PR #91 → reverted). Base64 inline is slower on the wire but
// it's the path that actually works end-to-end today.
//
// `keyframes` are stills captured client-side at detected hard cuts (see
// utils/extractKeyframes.ts). Video sampling runs at ~1 fps, so without them
// fast cuts, quick product inserts, and text-card flashes fall between
// sampled frames and vanish from the shot log.
async function buildPerceptionMessages(videoFile: File, keyframes: Keyframe[] = []): Promise<ChatMessage[]> {
  const dataUri = await fileToDataUri(videoFile)

  let userText = PERCEPTION_USER_PROMPT
  if (keyframes.length > 0) {
    const stamps = keyframes.map((k) => formatKeyframeTimestamp(k.time)).join(', ')
    userText += `\n\nAfter the video, ${keyframes.length} still keyframes are attached in chronological order, captured at detected hard cuts: ${stamps}. Use them to catch shots the video sampling may have skipped, to pin exact shot boundaries, and to read on-screen text and product labels precisely. The video remains the authority for motion, pacing, and audio.`
  }

  return [
    { role: 'system', content: [{ type: 'text', text: PERCEPTION_SYSTEM }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: dataUri } },
        ...keyframes.map((k) => ({ type: 'image_url' as const, image_url: { url: k.dataUri } })),
      ],
    },
  ]
}

function buildSynthesisMessages(perception: PerceptionResult): ChatMessage[] {
  return [
    { role: 'system', content: [{ type: 'text', text: SYNTHESIS_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: synthesisUserPrompt(perception) }] },
  ]
}

// kie's chat completions response can be unwrapped into a single text blob
// through several shapes depending on whether the recordInfo route returns the
// raw OpenAI envelope, just the message string, or just `content`. Try the
// known shapes in turn and surface the raw envelope if none match.
function extractTextFromResultEnvelope(envelope: unknown): string | null {
  if (typeof envelope === 'string') return envelope
  if (!envelope || typeof envelope !== 'object') return null
  const obj = envelope as Record<string, unknown>

  // OpenAI-shape
  const choices = obj.choices
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const first = choices[0] as Record<string, unknown>
    const msg = first.message as Record<string, unknown> | undefined
    if (msg && typeof msg.content === 'string') return msg.content
    if (typeof first.text === 'string') return first.text
  }

  // Flatter shapes kie sometimes returns
  if (typeof obj.content === 'string') return obj.content
  if (typeof obj.response === 'string') return obj.response
  if (typeof obj.output === 'string') return obj.output
  if (typeof obj.text === 'string') return obj.text

  return null
}

function parseJsonBlob(rawText: string, what: string): Record<string, unknown> {
  const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`Bad JSON from ${what}: ${reason} — body: ${cleaned.slice(0, 400)}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${what} response was not an object — body: ${cleaned.slice(0, 400)}`)
  }
  return parsed as Record<string, unknown>
}

// Tasks created by the pre-two-pass build return a full AnalysisResult from
// what we now treat as the perception task. Detect that shape so a refresh
// across a deploy resolves cleanly instead of erroring.
export type PerceptionParseOutcome =
  | { kind: 'perception'; perception: PerceptionResult }
  | { kind: 'legacy'; analysis: AnalysisResult }

function parsePerceptionJson(rawText: string): PerceptionParseOutcome {
  const obj = parseJsonBlob(rawText, 'ad perception pass')

  const legacy = obj as Partial<AnalysisResult>
  if (legacy.scorecard && Array.isArray(legacy.scorecard.scores) && legacy.reverseEngineeredPrompt) {
    return { kind: 'legacy', analysis: obj as unknown as AnalysisResult }
  }

  const p = obj as Partial<PerceptionResult>
  const missing: string[] = []
  if (!Array.isArray(p.shots) || p.shots.length === 0) missing.push('shots')
  if (!Array.isArray(p.transcript)) missing.push('transcript')
  if (typeof p.characterDossier !== 'string') missing.push('characterDossier')
  if (typeof p.productDossier !== 'string') missing.push('productDossier')
  if (typeof p.totalDurationSeconds !== 'number') missing.push('totalDurationSeconds')
  if (missing.length > 0) {
    throw new Error(`Perception response missing ${missing.join(', ')}`)
  }
  return { kind: 'perception', perception: obj as unknown as PerceptionResult }
}

function parseSynthesisJson(rawText: string, perception: PerceptionResult): AnalysisResult {
  const obj = parseJsonBlob(rawText, 'ad synthesis pass')
  // ResultsView consumes scorecard.scores, transcript, and
  // reverseEngineeredPrompt.scenes with .map(), so a response that parses as
  // valid JSON but omits one would crash the render (a white screen) after
  // the row is already persisted as complete. Validate the shape here so an
  // incomplete response surfaces the friendly error pane and can be retried.
  const p = obj as Partial<SynthesisResult>
  const missing: string[] = []
  if (!p.reverseEngineeredPrompt || !Array.isArray(p.reverseEngineeredPrompt.scenes)) missing.push('reverseEngineeredPrompt.scenes')
  if (!p.scorecard || !Array.isArray(p.scorecard.scores)) missing.push('scorecard.scores')
  if (missing.length > 0) {
    throw new Error(`Analysis response missing ${missing.join(', ')}`)
  }
  const synthesis = obj as unknown as SynthesisResult
  return { ...synthesis, transcript: perception.transcript }
}

// ── Transport plumbing (shared by both passes) ─────────────────────

export type StartAnalysisOutcome =
  | { kind: 'task'; taskId: string }
  | { kind: 'fallback'; reason: string }

// Kick off a pass via kie's createTask flow. The taskId returned here is what
// we persist on the history row so a refresh can resume the poll. If kie
// rejects createTask for the chat model (the endpoint is rare for chat), we
// resolve with `{ kind: 'fallback', reason }` and the queue falls through to
// the streaming transport.
async function startChatTask(messages: ChatMessage[]): Promise<StartAnalysisOutcome> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  try {
    const taskId = await createTask(apiKey, CHAT_MODEL_ID, {
      messages,
      stream: false,
      reasoning_effort: 'high',
      include_thoughts: false,
    })
    if (!taskId || typeof taskId !== 'string') {
      return { kind: 'fallback', reason: 'createTask returned empty taskId' }
    }
    return { kind: 'task', taskId }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn('[ad-anatomy] createTask rejected, falling back to streaming:', reason)
    return { kind: 'fallback', reason }
  }
}

async function pollChatTaskText(taskId: string): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const record = await pollTask(apiKey, taskId)

  // Parse resultJson — kie sometimes returns it as a JSON string holding the
  // chat envelope, sometimes as a string holding the raw model text.
  let envelope: unknown
  try {
    envelope = JSON.parse(record.resultJson || '""')
  } catch {
    envelope = record.resultJson
  }
  const text = extractTextFromResultEnvelope(envelope)
  if (!text) {
    throw new Error(
      `Analysis task ${taskId} succeeded but no text could be extracted. Raw resultJson: ${record.resultJson?.slice(0, 400)}`,
    )
  }
  return text
}

async function streamChatText(messages: ChatMessage[]): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  // Pin the fallback to the same model the perception pass uses so both passes
  // stay on one model even if createTask rejects and we drop to streaming.
  const endpoint = getChatEndpointPath(CHAT_MODEL_ID)
  return kieChatCompletions(apiKey, endpoint, messages, {
    timeoutMs: STREAM_TIMEOUT_MS,
    reasoningEffort: 'high',
  })
}

// ── Public API ─────────────────────────────────────────────────────

export async function startPerceptionTask(videoFile: File, keyframes: Keyframe[] = []): Promise<StartAnalysisOutcome> {
  return startChatTask(await buildPerceptionMessages(videoFile, keyframes))
}

export async function pollPerceptionTask(taskId: string): Promise<PerceptionParseOutcome> {
  return parsePerceptionJson(await pollChatTaskText(taskId))
}

export async function streamPerceptionFallback(videoFile: File, keyframes: Keyframe[] = []): Promise<PerceptionParseOutcome> {
  return parsePerceptionJson(await streamChatText(await buildPerceptionMessages(videoFile, keyframes)))
}

export async function startSynthesisTask(perception: PerceptionResult): Promise<StartAnalysisOutcome> {
  return startChatTask(buildSynthesisMessages(perception))
}

export async function pollSynthesisTask(taskId: string, perception: PerceptionResult): Promise<AnalysisResult> {
  return parseSynthesisJson(await pollChatTaskText(taskId), perception)
}

export async function streamSynthesisFallback(perception: PerceptionResult): Promise<AnalysisResult> {
  return parseSynthesisJson(await streamChatText(buildSynthesisMessages(perception)), perception)
}
