import type { AnalysisResult, MasterVisualStyle, MasterVoiceProfile } from '../types'
import { useSettingsStore } from '../../../stores/settingsStore'
import {
  createTask,
  pollTask,
  kieChatCompletions,
  fileToDataUri,
  CHAT_POLL_ATTEMPTS,
  type ChatMessage,
} from '../../../utils/kie'
import { getChatTarget, CHAT_MODEL_STRONG } from '../../../utils/models'
import {
  CONTINUOUS_STYLES,
  STYLE_BRIEF_SPEC,
  getContinuousStyle,
  isContinuousStyleId,
  styleFamilyMenu,
} from '../../../utils/visualStyle'
import { VOICE_PROFILE_SPEC } from '../../../utils/voiceProfile'

// The one surface on the STRONG tier (August 2026). Everything the analyser
// returns is read by a person and acted on — a misread style family or a
// hedged scene prompt costs a re-shoot, not a retry, which is exactly the
// "wrong answer costs real rework" case CHAT_MODEL_STRONG is kept for.
const CHAT_MODEL_ID = CHAT_MODEL_STRONG
// Both transports read this. kieChatCompletions defaults to 'low', so the
// streaming fallback would quietly analyse at a different effort from the task
// path if it didn't pass one — and the fallback's whole point is that a member
// can't tell which of the two ran.
const REASONING_EFFORT = 'medium' as const
// Streaming fallback timeout — kept generous since chat completions don't
// have intermediate progress signals like the task-based flow.
const STREAM_TIMEOUT_MS = 300_000

// ONE PASS, ON PURPOSE (reverted July 2026). The analysis briefly ran as two
// high-reasoning passes — perception (video → transcript + per-cut shot log +
// dossiers) then a text-only synthesis — with ~20 client-side cut keyframes
// attached to pass 1. Every analysis came back rejected as invalid, and
// budgeting the inline payload plus a video-only retry (#373) didn't fix it.
// This is the shape that demonstrably worked: one call, the video inline as the
// only media part. See git history for the two-pass version before reaching for
// it again — bring back one variable at a time.
//
// What HAS moved since is inside that one call: the model (DEFAULT → STRONG)
// and reasoning effort (low → medium), August 2026. Both are the cheap knobs
// the revert left available; neither changes the transport, the message shape
// or the JSON contract, so a regression here is a prompt-quality question and
// not the payload-budget one that killed the split.

// The style families the analyser classifies an ad into — read off the app's own
// picker list so the two can never drift, plus 'other' for a look none of them
// covers (a polished cinematic spot, mixed media, a screen recording).
const STYLE_ID_ENUM = [...CONTINUOUS_STYLES.map((s) => s.id), 'other'].join(' | ')

const SYSTEM_INSTRUCTION = `You are an elite UGC ad analyst. You dissect social media video ads and produce four things: a brutally honest scorecard, a strategy-level creative breakdown (hook / angle / structure), an accurate timestamped transcript, and a reverse-engineered prompt that could be sent to a text-to-video model (e.g. Seedance, Veo) to recreate the ad ONE-FOR-ONE, faithfully.

You must respond with ONLY valid JSON matching this exact structure (no markdown, no code fences):

SCORECARD RULE: Be brutally honest. Do not inflate scores. Most ads are average (5/10). If a hook is boring, give it a 2 or 3. If the visuals are static, penalize it. A 9/10 or 10/10 should be reserved for big direct-to-consumer brands level.

CREATIVE BREAKDOWN RULE: This is a marketing-strategy dissection of WHY the ad works — not shot description. Write for a DTC media buyer who wants to steal the mechanics:

1. hook (2-4 sentences): Quote the exact opening line / on-screen text / opening visual doing the work in the first 1-3 seconds. Name the hook mechanism (pattern interrupt, curiosity gap, negative callout, bold claim, result-first reveal, direct callout of the viewer, etc.) and the psychological trigger it pulls. Say plainly why it stops the scroll — or why it fails to.

2. angle (2-4 sentences): The core persuasion angle / positioning (pain-point relief, transformation, discovery/"I found this", us-vs-them, social proof, authority, fear of loss, convenience, identity, etc.), who it targets, and the audience awareness level it assumes (unaware / problem-aware / solution-aware / product-aware).

3. structure: A beat-by-beat skeleton of the ENTIRE ad, one beat per line, each formatted exactly as: "MM:SS–MM:SS <BEAT NAME> — <what it does psychologically>". Name beats in direct-response terms (Hook, Problem, Agitation, Discovery, Mechanism, Demo, Proof, Objection Handle, Offer, Urgency, CTA...). Cover 00:00 to the end.

MASTER VISUAL STYLE RULE — CRITICAL: Before the scenes, decide the ONE look the whole ad is shot or rendered in, and state it once. Two parts:

1. Classify it. Pick the "styleId" that matches what you actually see, from this menu:
${styleFamilyMenu()}
- "other" — none of the above (a polished cinematic commercial, mixed media, a screen recording, a slideshow of stills). Use it rather than forcing a bad match.
Set "liveAction" true ONLY for real footage of real people and real objects filmed by a camera; false for anything rendered, drawn, animated, or AI-generated. This is the single most important call in the whole style block — a recreation that guesses it wrong comes back in the wrong medium. Set "label" to the family's name, or your own 2-4 word descriptor when styleId is "other".

2. Write the "brief" — the look itself, which rides over every scene so it can never drift between clips. ${STYLE_BRIEF_SPEC}
The brief describes HOW the ad looks, never WHAT is in it: no characters, no products, no locations, no story, no specific objects. It gets appended to prompts for a completely different script, so any subject matter carried into it is a bug. If the ad's look shifts partway (a live-action open cutting to an animated end card), describe the dominant look and note the shift in one clause.

MASTER VOICE PROFILE RULE — CRITICAL: If anyone speaks in the ad, profile the voice ONCE so every recreated clip is read by the same person. Omit "masterVoiceProfile" entirely when the ad has no speech (music-only, or a still image).
- "label": a 3-6 word descriptor of the voice ("Bright American Female, Mid-20s").
- "traits": 3-6 short scannable attributes — e.g. "Female, late 20s", "General American", "Fast, clipped", "Slight vocal fry".
- "delivery": who is speaking and from where — on-camera talking to the lens with the mouth in sync, an off-camera voiceover running over b-roll, a second interviewer voice from behind the camera, or a mix (say which parts are which). Recreations get this wrong constantly, so be explicit.
- "profile": ${VOICE_PROFILE_SPEC}
Describe ONLY what you can actually hear. If two people speak, profile the one who carries the ad and note the second in "delivery".

FAITHFUL RECREATION RULE — CRITICAL: Your job is to produce prompts that, when pasted into Seedance, will recreate the original ad as accurately as possible. Therefore in every scene prompt you MUST:

1. Describe the ORIGINAL character in full visual detail. Include: apparent age range (e.g. "late 20s"), gender presentation, ethnicity cues, body type / build, hair (length, colour, styling — e.g. "shoulder-length wavy auburn hair, parted in the middle"), face shape and any distinctive features, wardrobe (every visible garment with colour and fit — e.g. "oversized cream cable-knit sweater, neutral tone"), accessories (jewellery, glasses, headwear, nail polish), and current micro-expression / gaze direction / hand position. Do NOT use placeholders. Do NOT write [CHARACTER]. Describe what you actually see.

2. Describe the ORIGINAL product in full visual detail. Include: brand name / wordmark exactly as it appears on the label if visible, container shape (dropper bottle / pump / jar / sachet / sleeve / blister pack / box / etc.), container colour and material (clear glass / matte black plastic / metallic / kraft / etc.), label colour and design cues, approximate size relative to the hand, and how the character is interacting with it (held, opened, applied, sprayed, sipped, etc.). If the product appears in more than one form across scenes (boxed → unboxed → in use), note the form for each scene. Do NOT use placeholders. Do NOT write [PRODUCT]. Describe what you actually see.

3. Embed the ORIGINAL spoken line(s) for that scene inside the prompt body, VERBATIM, in the order they are heard. Wrap them in double quotes and attribute the speaker, e.g. She says: "I had dark spots from years of sun damage and nothing worked." Keep dialogue separate from action / camera direction so the next stage can find and rewrite it cleanly. WHO SAYS WHAT IS NEVER LEFT OPEN: say for every line whether it is the on-camera character speaking to the lens with their mouth in sync, an off-camera voiceover playing over the footage, or a second person (an interviewer behind the camera), and pin each line to the shot it plays over. If a sentence starts in one shot and finishes in the next, say so. If nobody speaks in a scene, write that explicitly — "No dialogue in this scene; the voiceover from the previous scene has ended" or "no speech, music only" — never leave a scene silent by omission.

4. Transcribe ON-SCREEN TEXT exactly. Every caption, burned-in subtitle, sticker, headline card, price tag, arrow, emoji and end-card word: the exact wording in double quotes, where it sits in frame, roughly how big, its colour and background (white text with black outline / black pill / yellow highlight), the font character (bold sans, handwritten, platform-default caption), and when it appears and leaves. If word-by-word captions run under the whole ad, say so once per scene rather than listing every word. Never paraphrase on-screen text and never invent it.

5. Direct the AUDIO. State whether music plays (genre, tempo, energy, and whether it ducks under the speech), the ambience of the room or street, any sound effect that lands on a cut (whoosh, ding, pop, a can opening), and whether the ad ends on a sting or silence. If there is no music, say "no music" — a recreation left to guess will add a soundtrack.

NO VAGUENESS RULE — THIS IS WHAT THE WHOLE OUTPUT IS GRADED ON: every scene prompt must be specific enough that someone who has never seen this ad could recreate the shot from your words alone and land in the same place. Nothing is left open or up to chance.
- BANNED, in every scene prompt: "a woman", "some product", "a nice kitchen", "casual clothing", "various shots", "a few seconds later", "etc.", "professional lighting", "modern aesthetic", "high quality", "aesthetically pleasing". Every person, garment, object, surface, colour, gesture and camera move gets a concrete description a stranger could act on.
- NO HEDGING INSIDE A PROMPT. Never write "appears to be", "possibly", "unclear", "some kind of", "hard to tell". A prompt is a directive, not an observation log. Where a visual detail is genuinely hard to make out, commit to the single most probable concrete reading and state it plainly.
- THAT ALLOWANCE IS FOR VISUAL DETAIL ONLY. Never invent a brand name, a wordmark, an on-screen caption, a price, a claim, or a spoken word — those are transcribed exactly as they appear or left out entirely.
- CONTINUITY: when the same person, product or location returns in a later scene, describe them again IN FULL and keep the wording identical to the earlier scene, changing only what actually changed on screen (new wardrobe, new room, hair up instead of down). Each scene is fired as its own clip, so it cannot refer back to another scene — "the same woman as before" is a broken prompt.

CHUNKING RULE — CRITICAL: Read the total ad duration. If it is 15 seconds or less, produce a SINGLE scene that covers the whole ad. Otherwise break the ad into multiple scenes at natural shot/scene boundaries. Each scene MUST be 15 seconds or less. Aim for 8–12 seconds per scene. Number scenes starting at 1.

FULL COVERAGE RULE — CRITICAL: The scenes together MUST cover the ENTIRE ad with no gaps and no overlaps. The first scene starts at 00:00. Every subsequent scene's startTime MUST equal the previous scene's endTime. The final scene's endTime MUST equal the total ad duration. Never skip a stretch of the ad, no matter how minor or repetitive it looks — b-roll flashes, quick product inserts, text-card frames, and end cards all belong inside a scene.

EVERY SHOT RULE — CRITICAL: UGC ads often cut every 1–3 seconds, so one 8–12s scene usually contains SEVERAL distinct shots. You MUST describe every single camera cut inside the scene, in chronological order — do not summarize a multi-cut scene down to its dominant shot. Structure a multi-shot scene's prompt as a timeline, e.g.: "[0:00–0:03] Close-up: she holds the dropper bottle to camera... [0:03–0:05] Quick cut to macro of serum texture... [0:05–0:08] Back to medium shot, she applies it to her cheek...". A shot is any visible camera change: cut, angle change, location change, zoom jump, or inserted b-roll/graphic. Count the cuts before writing; every one of them must appear in the timeline.

SCENE PROMPT QUALITY: Each scene's prompt field must be a fully self-contained Seedance-ready directive — it is fired on its own, with no access to the other scenes or to the master blocks. Every shot in it accounts for ALL of the following, in prose, with nothing skipped:
- SHOT SIZE and CAMERA POSITION as geometry: lens height (eye level, chest height, low from the floor, overhead), distance from the subject (an arm's length, across the room), and angle (square on, three-quarter, from below). Never name the filming device — a phone, tripod or ring light said out loud gets drawn into frame — unless the device is genuinely on screen (a visible mirror selfie, a screen recording).
- CAMERA MOVEMENT: static, slow push in, handheld drift, whip pan, orbit, snap zoom — and how fast.
- SETTING: the room or location, what's on the walls and surfaces, the props in frame, the colour palette of the space.
- ACTION: exactly what the subject does across the shot, beat by beat — the gesture, what the hands are doing, gaze direction, the micro-expression and how it changes.
- LIGHTING: the source and its direction (window light from camera-left, warm overhead kitchen bulb, cool bathroom downlight), how hard or soft it is, and where the shadows fall.
- DIALOGUE heard over that shot, and the on-screen text visible during it.
For a single-shot scene 5–9 sentences is the right length; for a multi-shot scene, length grows with the number of cuts — 2–4 sentences per shot in the timeline, never dropping or compressing a shot to stay short. Length is never the constraint; vagueness is the only failure.

LABEL: Each scene's label is a short noun phrase (3–6 words) describing the shot — e.g. "Mirror reaction hook", "Product unboxing close-up", "Bathroom routine reveal".

SELF-CHECK BEFORE YOU ANSWER (do this silently; output only the JSON): re-read every scene prompt. (a) Does any banned generic or hedge survive? Replace it with a specific. (b) Could a stranger film this shot from these words alone, or would they have to guess something? Whatever they'd have to guess, write down. (c) Is every spoken line in the ad present in some scene, attributed, and in the right place? (d) Do the scene timings run 00:00 → the end with no gaps?

TRANSCRIPT: Transcribe every spoken word verbatim, including filler words. One entry per spoken line, timestamped at the moment the line starts. If there is no speech (music-only or a still image), return an empty transcript array.

AD TITLE: Produce a short (3–6 word) Title Case descriptor of the ad as a whole, naming the product/brand and the angle. Examples: "Dunkin Zero-Sugar Berry Energy", "Glow Skin Serum Routine Reveal", "Tarte Two-Minute Glam Tutorial". No quotes, no trailing punctuation.

HONESTY: describe only what is actually visible or audible. Never invent details, brands, or dialogue.

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
    "structure": "<one beat per line: MM:SS–MM:SS BEAT NAME — psychological job, newline-separated>"
  },
  "transcript": [
    { "timestamp": "<MM:SS>", "text": "<line>" }
  ],
  "reverseEngineeredPrompt": {
    "totalDurationSeconds": <integer>,
    "isSingleClip": <boolean — true if totalDurationSeconds <= 15>,
    "masterVisualStyle": {
      "styleId": "<one of: ${STYLE_ID_ENUM}>",
      "label": "<the family's name, or your own 2-4 word descriptor when styleId is 'other'>",
      "liveAction": <boolean — true only for real footage of real people and objects>,
      "brief": "<90-150 word style paragraph — how the ad looks, never what is in it>"
    },
    "masterVoiceProfile": {
      "label": "<3-6 word descriptor of the voice>",
      "traits": ["<3-6 short attributes>"],
      "delivery": "<who speaks and from where — on-camera, voiceover, interviewer, or a mix>",
      "profile": "<one dense paragraph — sound only, reproducible>"
    },
    "scenes": [
      {
        "index": <1-based integer>,
        "startTime": "<MM:SS>",
        "endTime": "<MM:SS>",
        "durationSeconds": <integer, <= 15>,
        "label": "<short shot name>",
        "prompt": "<self-contained Seedance prompt — fully describes the original character, the original product, and embeds the original spoken line(s)>"
      }
    ]
  }
}`

const USER_PROMPT = `Analyze this UGC ad video/image thoroughly. Produce: (1) a brutally honest scorecard, (2) a creative breakdown — the hook, angle, and beat-by-beat structure, (3) an accurate timestamped transcript, (4) a reverse-engineered prompt — the ad's master visual style, its master voice profile, and the whole ad chunked into scenes of ≤15 seconds each.

The recreation is the point: these prompts go straight into an AI video model, and whatever you leave vague, the model invents. Classify the look (live-action UGC or a rendered/animated style) and write the style paragraph that holds every clip together. Profile the voice once — how it sounds and who is speaking from where — so every clip is read by the same person. The scenes must cover the ENTIRE ad from 00:00 to the end with no gaps, and every individual camera cut inside a scene must be described in chronological order as a timeline — do not merge or skip any shot. Each scene prompt MUST describe the original character in full identifying detail, describe the original product in full identifying detail, quote the original spoken lines verbatim with the speaker named, transcribe any on-screen text exactly, and direct the shot's camera position, movement, lighting, setting, action and audio. No hedges, no generics, no placeholder tokens. Return the analysis as JSON.`

// Inline data URI in the chat message. We previously tried kie's hosted-URL
// upload but the createTask + recordInfo path didn't return results for the
// chat model (PR #91 → reverted). Base64 inline is slower on the wire but
// it's the path that actually works end-to-end today.
//
// The video is the ONLY media part. Attaching extra stills alongside it is what
// the two-pass build did, and every request came back rejected — see the note
// at the top of this file.
async function buildMessages(videoFile: File): Promise<ChatMessage[]> {
  const dataUri = await fileToDataUri(videoFile)
  return [
    { role: 'system', content: [{ type: 'text', text: SYSTEM_INSTRUCTION }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: USER_PROMPT },
        { type: 'image_url', image_url: { url: dataUri } },
      ],
    },
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

// The two master blocks come straight off the model and are optional, so they
// are normalised rather than trusted. An empty brief or profile drops the block
// entirely — it renders nothing, and a blank brief must never reach the styles
// bank as a saved row. An unrecognised styleId falls back to 'other' rather
// than being handed to getContinuousStyle, whose fallback would silently label
// an unknown look "3D Animated".
function normalizeVisualStyle(raw: unknown): MasterVisualStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const brief = typeof o.brief === 'string' ? o.brief.trim() : ''
  if (!brief) return undefined
  const styleId = typeof o.styleId === 'string' && isContinuousStyleId(o.styleId) ? o.styleId : 'other'
  const known = styleId !== 'other'
  const liveAction =
    typeof o.liveAction === 'boolean'
      ? o.liveAction
      : typeof o.liveAction === 'string'
        ? o.liveAction.trim().toLowerCase() === 'true'
        // Unstated: a matched family already knows whether it's live action.
        : known && getContinuousStyle(styleId).realism === true
  const label =
    (typeof o.label === 'string' && o.label.trim()) || (known ? getContinuousStyle(styleId).label : 'Custom look')
  return { styleId, label, liveAction, brief }
}

function normalizeVoiceProfile(raw: unknown): MasterVoiceProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const profile = typeof o.profile === 'string' ? o.profile.trim() : ''
  if (!profile) return undefined
  const traits = Array.isArray(o.traits)
    ? o.traits.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()).slice(0, 8)
    : []
  return {
    label: (typeof o.label === 'string' && o.label.trim()) || 'Ad voice',
    traits,
    delivery: typeof o.delivery === 'string' ? o.delivery.trim() : '',
    profile,
  }
}

function parseAnalysisJson(rawText: string): AnalysisResult {
  const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`Bad JSON from ad analysis model: ${reason} — body: ${cleaned.slice(0, 400)}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Analysis response was not an object — body: ${cleaned.slice(0, 400)}`)
  }
  // ResultsView consumes scorecard.scores, transcript, and
  // reverseEngineeredPrompt.scenes with .map(), so a response that parses as
  // valid JSON but omits one of them would crash the render (a white screen)
  // after the row is already persisted as complete. Validate the shape here so
  // an incomplete response surfaces the friendly error pane and can be retried.
  const p = parsed as Partial<AnalysisResult>
  const missing: string[] = []
  if (!p.reverseEngineeredPrompt || !Array.isArray(p.reverseEngineeredPrompt.scenes)) missing.push('reverseEngineeredPrompt.scenes')
  if (!p.scorecard || !Array.isArray(p.scorecard.scores)) missing.push('scorecard.scores')
  if (!Array.isArray(p.transcript)) missing.push('transcript')
  if (missing.length > 0) {
    throw new Error(`Analysis response missing ${missing.join(', ')} — body: ${cleaned.slice(0, 400)}`)
  }
  const result = parsed as AnalysisResult
  return {
    ...result,
    reverseEngineeredPrompt: {
      ...result.reverseEngineeredPrompt,
      masterVisualStyle: normalizeVisualStyle(result.reverseEngineeredPrompt.masterVisualStyle),
      masterVoiceProfile: normalizeVoiceProfile(result.reverseEngineeredPrompt.masterVoiceProfile),
    },
  }
}

// ── Public API ─────────────────────────────────────────────────────

export type StartAnalysisOutcome =
  | { kind: 'task'; taskId: string }
  | { kind: 'fallback'; reason: string }

// Kick off an analysis via kie's createTask flow. The taskId returned here
// is what we persist on the history row so a refresh can resume the poll.
// If kie rejects createTask for the chat model (the endpoint is rare for
// chat), we resolve with `{ kind: 'fallback', reason }` and the queue falls
// through to the streaming transport.
export async function startAnalysisTask(videoFile: File): Promise<StartAnalysisOutcome> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const messages = await buildMessages(videoFile)

  try {
    const taskId = await createTask(apiKey, CHAT_MODEL_ID, {
      messages,
      stream: false,
      reasoning_effort: REASONING_EFFORT,
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

// Resume / wait on an existing kie task. Used both for new analyses (right
// after startAnalysisTask returned a taskId) and for mount-time resume after
// a refresh. Polls on CHAT_POLL_ATTEMPTS — a whole video read outlives the
// 5-minute default.
export async function pollAnalysisTask(taskId: string): Promise<AnalysisResult> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const record = await pollTask(apiKey, taskId, { maxPollAttempts: CHAT_POLL_ATTEMPTS })

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
  return parseAnalysisJson(text)
}

// Streaming fallback — a safety net when createTask is unavailable for the
// chat model. Pinned to the same model AND reasoning effort the task path uses.
// Cannot be resumed across refresh; the queue knows this and the reconciler
// flips such rows to error.
export async function streamAnalysisFallback(videoFile: File): Promise<AnalysisResult> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatTarget(CHAT_MODEL_ID)
  const messages = await buildMessages(videoFile)
  const responseText = await kieChatCompletions(apiKey, endpoint, messages, {
    timeoutMs: STREAM_TIMEOUT_MS,
    reasoningEffort: REASONING_EFFORT,
  })
  return parseAnalysisJson(responseText)
}
