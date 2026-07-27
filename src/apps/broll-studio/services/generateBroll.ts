import type { BrollInput, BrollResult, Scene, PromptVariation, ReferenceImage, VariationTag, VariationRefs, LinePosition, BrollDelivery } from '../types'
import { useSettingsStore } from '../../../stores/settingsStore'
import {
  kieChatCompletions,
  ensureHostedUrl,
  createTask,
  type ChatMessage,
} from '../../../utils/kie'
import { getDefaultModel, getChatEndpointPath, buildImageInput, getModel, type AspectRatio, type ImageResolution } from '../../../utils/models'
import { isAssetRef, getAsBase64 } from '../../../utils/assetStore'
import { finishImageAssetTask } from '../../../utils/imageTask'
import { useBankStore } from '../../../stores/bankStore'
import { withIphoneRealism } from './realism'
import { countProductAngles, parsePhotoPick, productPhotoDataUris, productPhotoInstruction } from './productAngles'
import { extractBlock, extractNumberedBlock } from './xmlBlocks'
import { styleBriefFor, styleUsesRealism } from './generateContinuous'

function getChatEndpoint(): { apiKey: string; endpoint: string } {
  return {
    apiKey: useSettingsStore.getState().getKieApiKey(),
    endpoint: getChatEndpointPath(),
  }
}

let idCounter = 0
function nextId() {
  return `var-${Date.now()}-${++idCounter}`
}

/**
 * How many variations the storyboard call asks for per line. Was 4; three good
 * ideas beat three good ideas plus a filler — the fourth was reliably the
 * weakest, and every extra card is another image (and often another video) on
 * the member's own kie credits.
 */
export const VARIATIONS_PER_SCENE = 3

/**
 * How many variations a "With Dialogue" scene gets: the SAME three as a silent
 * scene, with the talking-to-camera card taking the first slot and two silent
 * b-roll ideas after it. It briefly ADDED a fourth card, on the theory that the
 * talking head needs three ways to cut away from it — but four cards per line is
 * four images (often four videos) on the member's own credits, and the two
 * b-roll options that survive are the two they were going to use anyway.
 */
export const DIALOGUE_VARIATIONS_PER_SCENE = VARIATIONS_PER_SCENE

/** How many variations a scene gets in this delivery. */
export function variationsForDelivery(delivery: BrollDelivery): number {
  return delivery === 'dialogue' ? DIALOGUE_VARIATIONS_PER_SCENE : VARIATIONS_PER_SCENE
}

/**
 * How many <VAR_N> blocks the parser will still READ. Deliberately one more than
 * either mode asks for: a storyboard written before the cut to three — or pasted
 * in through Import prompts from an older brief, or generated back when dialogue
 * delivery emitted four — carries a VAR_4, and silently dropping a prompt the
 * member already wrote is worse than showing a fourth card.
 */
const MAX_PARSED_VARIATIONS = 4

/**
 * The shape every B-Roll prompt takes. Shared by all the prompt sites (scene
 * generation, single-variation generation, and Enhance) so the format can't
 * drift between them — a card regenerated or enhanced has to come back in the
 * same shape it went out.
 *
 * One flowing paragraph, deliberately: the old labelled six-field format
 * (SETTING / CAMERA / LIGHTING / ...) produced generic prompts nobody could
 * skim, and the structure crowded out the actual idea. The realism stack is
 * appended deterministically at request time (withIphoneRealism), so the
 * editable prompt only has to carry the shot.
 *
 * Every clip is SILENT b-roll — no one speaks. A finished voiceover is laid
 * over these shots in the edit.
 */
// Shared readable-paragraph rules — no silence clause, so both the silent b-roll
// format and the "With Dialogue" talking-card format can build on it.
const PROMPT_FORMAT_CORE = `Every prompt is ONE flowing paragraph. There is NO word limit and no target length — write as long as it takes to see the shot through, and never drop a detail to keep it short. Vagueness is the only failure; length is not. Plain, concrete, readable — no labels, no field names, no line breaks, no "Style:" trailer.

Write it like you're describing a clip you already filmed: what's in frame, what the character physically does (the exact gesture, gaze, micro-expression), where the light comes from, and — only when it matters — where the camera sits, always as a position ("framed from chest height an arm's length away", "from directly above"), never as a device.`

const PROMPT_FORMAT = `${PROMPT_FORMAT_CORE} You may end with the natural sound of the moment (a dry crunch, a wrapper crinkle, room tone) — never dialogue, never music.

The footage is SILENT: no one speaks, mouths words, or addresses the viewer. A voiceover is laid over these clips in the edit.`

// The talking-card format for "With Dialogue" delivery — the character speaks
// the scene's line to camera. Used by the DIALOGUE regen/enhance paths.
const PROMPT_FORMAT_DIALOGUE = `${PROMPT_FORMAT_CORE} The character SPEAKS the scene's line — embed the exact words verbatim inside double quotes (the character … says: "…"), copied character for character so the app can rewrite them when the line is edited. Audio is on: just them talking, no background music, no extra voiceover.

Say where they are and what they're doing while they talk. It's the same person and the same ad throughout, but not the same chair: a dialogue shot can happen anywhere their life plausibly takes them, and the interesting ones happen mid-something.`

const SYSTEM_INSTRUCTION = `# ROLE

You are a senior UGC creative director inventing silent B-roll shots for AI image and video models. You have shipped thousands of paid UGC ads. Your gift is translating a spoken line into a picture: someone watching the footage with the sound off should be able to guess what the voiceover is saying.

# SHOW, DON'T TELL — THIS IS THE WHOLE JOB

Each voiceover line will be HEARD over the footage. The footage must SHOW what the line means — never a person passively existing while the line plays. Find the strongest image inside the line and put it on screen:

- If the line contains a metaphor, comparison, or vivid image, MAKE IT LITERAL — even when it's absurd. The absurdity is what stops the scroll.
  - "I spent years eating protein bars that tasted like cardboard" → the character at their kitchen counter taking a slow, deadpan bite out of an actual piece of cardboard, chewing joylessly.
  - "my skin felt like sandpaper" → their fingertips dragging along a real sheet of sandpaper.
  - "I was drowning in laundry" → the character flopped backwards onto a mountain of unfolded clothes.
- If the line describes an act, show the act actually happening — mid-motion, hands busy, real.
- If the line makes a claim, show the evidence someone could actually film at home.
- If the line is emotional, show the emotion landing inside a real moment — never a face in a void.

When the viewer hears the sentence and sees the sentence at the same time, the ad becomes effortless to watch. That is the goal of every prompt you write.

# YOUR JOB

For each voiceover line in the script, produce 3 variations — 3 genuinely DIFFERENT ideas for visualizing that line, not one idea filmed from three angles. Before writing, silently brainstorm: what's the literal image hiding in this line? the real-life moment behind it? the feeling? the visible proof? Then write the three STRONGEST ideas as prompts — three you'd actually shoot, not two good ones and a filler.

**Every shot is SILENT b-roll.** No one talks to camera, no one lip-syncs, no line is spoken. The finished voiceover is laid over these clips in the edit.

You decide per line:
- POSITION — where the line sits in the ad's arc: hook / reframe / mechanism / payoff / CTA
- VISIBILITY — whether the product is allowed in this shot (yes / no). Hook + reframe lines almost always = no. Mechanism = your call, usually no. Payoff + CTA = usually yes.

Tag each variation with the lens it uses (declare it in the <TAG> field):
- ACTION = act out the line's strongest image, literally. Metaphors get made real here — this is where the cardboard bite lives.
- EMOTIONAL = the feeling of the line landing on the character inside a real moment (a slump against the fridge, a slow exhale over the sink).
- PRODUCT = the product itself or its visible result, up close.
- POV = first-person: the character's hands living the line, their face never in frame.
- ENVIRONMENT = the place that tells the line's story on its own (the drawer full of abandoned half-eaten bars), character absent or peripheral.
- TRANSITION = a movement that carries the story forward (sweeping the old stuff into the bin, walking out the door).
- PROOF = visible evidence the claim is real — the after-state, a side-by-side, an ordinary screen artifact (a timer, a streak). Never invent fake reviews, ratings, or statistics. The ONE lens where a phone may appear in frame, as the object being looked at.

Lens rules:
- The three tags must be different from each other, and each must produce a DIFFERENT CONCEPT — different subject, different idea, not the same beat reframed.
- When the line carries a metaphor or vivid image, at least one variation MUST make it literal (usually ACTION).
- Choose for the line, not by habit, and vary the mix across the ad.
- When VISIBILITY is no: PRODUCT is off the menu and no variation may show the product or its packaging.
- When VISIBILITY is yes and the line names the product: at least one variation features the product prominently.

You decide per variation:
- LABEL — a short slug naming the actual idea (e.g. "CARDBOARD BITE", "BAR HITS THE BIN", "DRAWER OF REJECTS"). Two-to-four words.
- REFS — which reference images to attach: character / product / both / none. ERR ON THE SIDE OF ATTACHING — a reference the model doesn't strictly need is harmless, but a missing one loses the character's face or the product's exact look. Attach the character reference whenever a person (or even just their hands, for POV) could appear, OR whenever holding the character's look consistent might help — when unsure, attach it. Attach the product reference whenever the product could appear or its exact packaging/shape could inform the frame — when unsure, attach it. Prefer "both" whenever both could plausibly help. Reserve "none" only for shots that clearly show neither a person nor the product (a bare environment, an abstract insert). Two rules are absolute: when VISIBILITY is no, REFS must NOT include product — the product cannot appear at all in that shot. When VISIBILITY is yes, REFS MUST include product on EVERY variation of that scene — the voiceover is talking about the product, so the shot has to be built from the real packaging rather than the model's invention of it.

# PROMPT FORMAT (EVERY PROMPT, EVERY VARIATION)

${PROMPT_FORMAT}

# THE CAMERA IS A VIEWPOINT, NOT A PROP

Image and video models draw the nouns you give them: write "phone" and a phone appears in frame, and your shot becomes a mirror selfie. So never name the filming device — no "phone", "iPhone", "smartphone", "front camera", "tripod", "ring light" — never in a hand, on a table, or in a reflection. When the camera position matters, state it as a position: "framed from chest height an arm's length away", "from directly above the counter", "from lap height looking up".

  WRONG: "phone propped on the counter filming them"
  RIGHT: "framed from chest height across the counter"

The ONE exception: a PROOF shot may show a screen as the deliberate subject being looked at.

# NON-NEGOTIABLE RULES

1. SCRIPT SEGMENTATION — ONE LINE, ONE IDEA. A scene is one shot, and one shot can only show one thing. Split any sentence carrying two visual ideas into two <LINE>s — the giveaway is a turn ("but", "though", "however", "until", "then", "so", "that's why") or a problem paired with its solution, a before with its after, a claim with its proof. "Most taste like chewed up cardboard, but this one tastes like real cookie dough" is TWO lines: the complaint, then the fix. Never cut mid-clause, and every <LINE> must be a speakable phrase of at least five words — merge anything shorter forward ("Listen up." + "This serum changed my skin." → one <LINE>). Never a standalone scene for "Listen up", "Be honest", "So...", "Right?". The <LINE>s are the actual voiceover: use the script's exact words in the script's order, dropping only a connecting word at a split. Never paraphrase, add, or reorder.

2. PRODUCT VISIBILITY IS LOCKED TO THE VOICEOVER — if VISIBILITY is no, the product appears nowhere: not in the background, not blurred, not implied by packaging-coloured objects. If the line itself names or references the product ("this bar", "I tried it"), VISIBILITY is YES regardless of position — the viewer hears it named, so the shot may show it, and every variation of that scene carries <REFS> that include product.

2b. THE BAD VERSION IS ALWAYS GENERIC — when VISIBILITY is no but the line still needs a category object on screen (the cardboard-tasting bar, the serum that did nothing, the old gadget), that object is an UNBRANDED STAND-IN and you must say so in the prompt: plain matte packaging, no logo, no brand name, no readable text, in colours and a shape deliberately unlike the advertised product. "A brittle chalky bar in a plain unmarked grey wrapper, no logo or text anywhere" is right; "a protein bar" is wrong — the model fills that blank with the attached product reference and the ad ends up trashing its own product. The words "the product" mean the advertised product and nothing else; never use them for a stand-in.

3. GENDER-NEUTRAL LANGUAGE — never he/him/she/her, never "subject". Always "the character" and "they/them/their". The character reference may be any gender.

4. SPECIFIC, NOT GENERIC — name the exact prop, the exact gesture, the exact micro-expression, the real light source. "Looking frustrated" fails; "jaw working slowly, eyes flat, one eyebrow raised mid-chew" works. If a prompt could describe two different shots, rewrite it.

5. UGC REALISM — everything looks like a real person filmed it at home: natural light, lived-in rooms, slightly imperfect framing, handheld drift. Anything that reads "commercial", "cinematic", "studio", or "polished" is a failure. No captions, subtitles, or on-screen text.

6. THE AFTER, NOT THE BEFORE — the character always already has the result the product promises. They are the testimonial, not the case study. (Comedy exception: a LITERAL metaphor shot like the cardboard bite may show the old pain being acted out — but never the character's actual body/skin/hair in a "before" state.)

7. CONSTANT MOTION — every prompt names a movement: a bite mid-chew, a toss mid-air, a hand dragging, the frame drifting. No frozen poses, no still-life.

8. CROSS-SCENE CONSISTENCY — one ad: same wardrobe, same home, same time of day across scenes unless the script demands a change. The product reference image is the source of truth — never invent packaging.

# SELF-CHECK BEFORE RETURNING

1. Could someone watching this shot guess the line it belongs to? If not, the idea isn't visual enough — find the image inside the line and rewrite.
2. Are the 3 variations three different IDEAS (different subject or concept), not one idea from three angles? With only three slots there is no room for a filler — if one is weaker than the others, replace it.
3. If the line has a metaphor or vivid image, does one variation make it literal?
4. Is every prompt ONE readable paragraph — no labels, no device named, silent?
5. Does product visibility match the rule exactly?

# REFERENCE EXAMPLE

Line: "I spent years eating protein bars that tasted like actual cardboard before I realized I didn't have to."

> <TAG>ACTION</TAG> <LABEL>CARDBOARD BITE</LABEL>
> The character stands at their kitchen counter holding a torn strip of corrugated cardboard like a snack bar, peels an imaginary wrapper, and takes a slow deadpan bite — chewing with dead eyes and a tiny resigned nod, a crumb of cardboard dropping to the counter. Framed from chest height across the counter, morning window light from the left. The only sound is the dry papery crunch.

> <TAG>TRANSITION</TAG> <LABEL>BARS HIT THE BIN</LABEL>
> A drawer slides open to reveal a graveyard of half-eaten, stale protein bars in dull wrappers; the character's hand sweeps the whole pile into a kitchen bin in one motion and the drawer knocks shut. Framed from just above the drawer, close enough to read the sad crumbs. Wrappers crinkle and thud into the bin.

Two different concepts: one makes the metaphor literal, one shows the years of bad bars ending. Neither is a person standing in a kitchen doing nothing.

# OUTPUT FORMAT (STRICT)

Wrap every scene in this exact XML envelope. Do not include any text outside these tags. Every <PROMPT> body is ONE paragraph in the PROMPT FORMAT above.

<SCENE>
<LINE>exact grouped script segment, a complete sentence</LINE>
<POSITION>hook|reframe|mechanism|payoff|CTA</POSITION>
<VISIBILITY>yes|no</VISIBILITY>
<VAR_1>
<TAG>ACTION|EMOTIONAL|PRODUCT|POV|ENVIRONMENT|TRANSITION|PROOF</TAG>
<LABEL>short descriptive shot label, e.g. COUNTER REACTION</LABEL>
<REFS>character|product|both|none</REFS>
<PROMPT>one flowing paragraph matching the chosen lens. Silent b-roll — no speech anywhere</PROMPT>
</VAR_1>
<VAR_2>
<TAG>a DIFFERENT role from VAR_1</TAG>
<LABEL>...</LABEL>
<REFS>...</REFS>
<PROMPT>...</PROMPT>
</VAR_2>
<VAR_3>
<TAG>a DIFFERENT role from VAR_1 and VAR_2</TAG>
<LABEL>...</LABEL>
<REFS>...</REFS>
<PROMPT>...</PROMPT>
</VAR_3>
</SCENE>`

// Delivery override appended to the system instruction ONLY in Dialogue mode.
// Read last, so it wins over the "every shot is SILENT" doctrine everywhere.
//
// ALL THREE cards speak the line. This used to be one talking card plus two
// silent b-roll ideas, locked to a single continuous take — same room, same
// wardrobe, same lens height for the whole ad, with each card chained to the
// previous one's still. Both halves were wrong for what this mode is: if you
// wanted silent footage you'd be in B-Roll mode, and three angles on one sitting
// is one idea filmed three times, which is exactly what the b-roll side of the
// app spent its whole prompt learning not to do. So a Dialogue scene is now
// three genuinely different ways to DELIVER the line — different room, different
// activity, different staging — and the picked format (see the SCENE STAGING
// block, when there is one) decides what "different" looks like: a street
// interview moves down the street, a plain UGC ad moves around the house.
const DIALOGUE_DELIVERY_ADDENDUM = `

# DELIVERY OVERRIDE — DIALOGUE MODE (READ LAST, HIGHEST PRIORITY)

Every clip in this ad is the character SPEAKING. There is no silent b-roll anywhere in this mode: the "footage is SILENT / no one speaks" rule in the PROMPT FORMAT and SHOW-DON'T-TELL sections is REPLACED by everything below. Every scene gets exactly THREE variations and all three are talking shots. Do NOT emit a VAR_4.

Every variation, every scene:
- <TAG>DIALOGUE</TAG>, always, on all three.
- The character is on camera and SPEAKS the scene's exact <LINE> word-for-word. Write ONE flowing paragraph that embeds the line verbatim inside double quotes, e.g.: the character, [expression/gesture], [where they're looking] and says: "<the exact line>". Copy the line character for character — the app rewrites those quoted words when the member edits the line, and it can only find them if they are the line. A real person talking, natural, never a news anchor.
- Audio is on: just them talking. No background music, no added voiceover.
- Describe the delivery, expression, gesture, what their hands are doing, the room, and where the light comes from.

THE THREE VARIATIONS ARE THREE DIFFERENT IDEAS, NOT THREE ANGLES ON ONE:
Same words, three genuinely different ways to say them. Change the SITUATION, not just the framing — a different room or location, a different thing they're doing while they talk, a different moment of the day, a different physical relationship to the camera. The character is the same person in the same ad, but they are not nailed to one chair.
- WRONG: three shots of the character on the same sofa at chest height, differing only in expression and how close the frame is.
- RIGHT: one at the kitchen counter mid-way through making something, hands busy, glancing up between words; one sat on the edge of the bed, quieter, closer, talking straight into the lens; one walking through the front door still holding a bag, talking over their shoulder.
Each variation must be a shot you could actually cut to and feel a change. If two of them could be described by the same sentence, replace one.

WHEN A SCENE STAGING BLOCK IS PRESENT, IT WINS: it says what kind of content this ad imitates, and every variation stages that — three different spots along the same street for a street interview, three moments of the same routine for a GRWM, three angles of the same recording session for a podcast clip. Vary WITHIN the format; never break it. When there is no staging block, the ad is a plain organic UGC video and the character moves around their own life.

- Product: follow VISIBILITY exactly as the rules above describe. When VISIBILITY is yes the character may hold, use, or be near the product while they talk, and <REFS> must include product so it's built from the real packaging. When VISIBILITY is no, no product anywhere — not in a hand, not on a counter behind them.
- Still obey every other rule: camera is a viewpoint not a prop (never name the filming device), gender-neutral language ("the character", "they/them"), UGC realism, after-not-before, constant motion.

# VOICE PROFILE (emit ONCE, after the last scene)

After the final </SCENE>, output exactly ONE block — the ONLY content allowed outside the scene envelopes:

<VOICE_PROFILE>
VOICE — describe, in rich and reproducible detail, HOW the character sounds: perceived age and gender of the voice, accent / region, pitch, pace, texture (warm, raspy, breathy, smooth), energy, and 1-2 signature quirks (uptalk, a slight vocal fry, a laugh living in the voice). One dense paragraph you could hand to a TTS engine and get the same person every time. Describe ONLY the sound, never appearance.
</VOICE_PROFILE>

This one voice is shared by every clip in the ad, so it must be self-contained and consistent.`

// The system instruction the scene call runs on, with the dialogue override
// appended in "With Dialogue" delivery. Exported so the Import-prompts brief
// hands an outside model the EXACT same rules — one source, no drift.
// `productPhotoCount` is how many photos the product bank row holds. More than
// one and the storyboard is shown all of them and asked to pick per variation
// (see productPhotoInstruction) — one photo can never render two products.
export function brollSystemInstruction(delivery: BrollDelivery, productPhotoCount = 0): string {
  const base = delivery === 'dialogue' ? SYSTEM_INSTRUCTION + DIALOGUE_DELIVERY_ADDENDUM : SYSTEM_INSTRUCTION
  return productPhotoCount > 1 ? base + productPhotoInstruction(productPhotoCount, 'variation') : base
}

// The user half of the scene call. Same reason for being exported.
export function buildBrollUserPrompt(input: BrollInput): string {
  const withDialogue = input.delivery === 'dialogue'
  const variationBrief = withDialogue
    ? `For EACH scene emit exactly three variations, and ALL THREE are the character speaking that line out loud — <TAG>DIALOGUE</TAG> on every one, with the line embedded verbatim in double quotes. They are three genuinely DIFFERENT ways to deliver it: different room or location, different thing they're doing while they talk, different physical relationship to the camera. Not one setup shot from three distances. Three slots only — no VAR_4.`
    : `For EACH scene emit exactly three variations: three genuinely DIFFERENT ideas for showing what that line SAYS — make metaphors literal, show the act, the feeling, the proof. Pick three distinct lenses from the menu (ACTION / EMOTIONAL / PRODUCT / POV / ENVIRONMENT / TRANSITION / PROOF), declared in each <TAG> field. Every shot is silent — no one speaks (a voiceover is added later). Three slots only, so every one has to earn its place — no filler fourth idea.`

  let prompt = `Break this script into ${withDialogue ? 'dialogue' : 'B-Roll'} scenes following the system rules. ${variationBrief} Each prompt is ONE readable paragraph, as long as the idea needs — no word limit, and never trim a detail to hit a length. Decide POSITION + VISIBILITY per scene — if the line names or references the product, VISIBILITY must be yes regardless of POSITION. Pick REFS per variation, erring toward attaching references whenever they could plausibly help. Two REFS rules are hard: VISIBILITY=no excludes the product from every variation, and VISIBILITY=yes includes it in every variation.\n\nScript:\n${input.scriptText}`

  // The picked Script Style's scene staging, when it's a FORMAT (podcast clip,
  // street interview, green-screen reaction…). Structures carry none on
  // purpose — an argument doesn't imply a camera position. This is the same
  // block Scripts' scene-blueprint output uses, so the format shapes the SHOTS
  // here as well as the words there; the token guard is because that block
  // writes [CHARACTER] / [PRODUCT] for a format that has reference slots, and
  // a B-Roll prompt is plain prose an image model reads literally.
  if (input.sceneStaging) {
    prompt += `\n\n${input.sceneStaging}\n\nStage every variation this way. Never write the words "[CHARACTER]" or "[PRODUCT]" in a prompt — describe the character as "the character" and the product in plain words; the app attaches the real reference images at render time.`
  }

  if (input.productContext) {
    prompt += `\n\n${input.productContext}`
  }
  if (input.modelContext) {
    prompt += `\n\n${input.modelContext}\nIMPORTANT: never describe the character's physical appearance in detail. Refer to them as "the character" — a visual reference image will be attached to capture their exact look.`
  }
  if (input.additionalContext) {
    prompt += `\n\nAdditional context:\n${input.additionalContext}`
  }
  return prompt
}

export async function generateBroll(input: BrollInput): Promise<BrollResult> {
  const { apiKey, endpoint } = getChatEndpoint()

  const withDialogue = input.delivery === 'dialogue'
  const prompt = buildBrollUserPrompt(input)
  // The product's photos ride along as vision inputs when there's more than
  // one, so the storyboard can name the state each shot needs rather than
  // having every angle attached to every card.
  const photoUris = await productPhotoDataUris(input.productPhotos)
  const systemInstruction = brollSystemInstruction(input.delivery, photoUris.length)
  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: systemInstruction }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...photoUris.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ],
    },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages)

  // Resolve the visual style once and stamp it on the result. It's appended to
  // each card's prompt (and the realism stack toggled) at fire time — the scene
  // prompts themselves stay style-neutral, exactly like Continuous.
  return {
    scenes: parseScenes(responseText, input.delivery),
    style: styleBriefFor({ styleId: input.styleId, styleBrief: input.styleBrief }),
    realism: styleUsesRealism(input.styleId, !!input.styleBrief?.trim()),
    styleId: input.styleId,
    styleBrief: input.styleBrief?.trim() || undefined,
    styleName: input.styleBrief?.trim() ? input.styleName?.trim() || undefined : undefined,
    voiceProfile: withDialogue ? extractVoiceProfile(responseText) : undefined,
  }
}

// Pull the shared <VOICE_PROFILE> block out of a dialogue-mode response. Strips
// a leading "VOICE —" label if present. Undefined when the model omitted it.
export function extractVoiceProfile(responseText: string): string | undefined {
  const raw = responseText.match(/<VOICE_PROFILE>([\s\S]*?)<\/VOICE_PROFILE>/)?.[1]?.trim()
  if (!raw) return undefined
  return raw.replace(/^VOICE\s*[—–-]\s*/i, '').trim() || undefined
}

// Parse the LLM's strict-XML output into Scene records. New schema:
//   <SCENE>
//     <LINE>...</LINE>
//     <POSITION>hook|reframe|mechanism|payoff|CTA</POSITION>
//     <VISIBILITY>yes|no</VISIBILITY>
//     <VAR_N><TAG/><LABEL/><REFS/><PROMPT/></VAR_N>   (x3)
//   </SCENE>
//
// Tolerant of legacy output that emits <VAR_N>plain text</VAR_N> with no
// nested tags — falls back to position-based TAG defaults so a slightly
// off-schema response still produces usable variations.
//
// Exported because Import prompts runs hand-written output through the SAME
// parser the live call uses — an import can't drift from a generation.
export function parseScenes(responseText: string, delivery: BrollDelivery = 'silent'): Scene[] {
  const scenes: Scene[] = []
  // Scene blocks, tolerant of a missing </SCENE>: a scene runs to its own
  // closing tag or, failing that, to the start of the next one. Dropping the
  // last scene of a storyboard because the model didn't close the envelope
  // costs the member a line of their ad.
  const sceneBlocks = responseText
    .split(/<SCENE>/i)
    .slice(1)
    .map((chunk) => chunk.split(/<\/SCENE>/i)[0])

  // Every variation carries the LLM's per-line role pick in <TAG>; these
  // defaults only apply when the tag is missing or unrecognised. In dialogue
  // delivery every card is a talking card, so every fallback is DIALOGUE. Four
  // entries, one more than we ask for, because the loop below still reads a
  // VAR_4 when one is present (see MAX_PARSED_VARIATIONS) — a storyboard
  // written back when dialogue delivery emitted one talking card plus b-roll
  // still carries its own <TAG>s, so those sessions keep their original mix.
  const FALLBACK_TAGS: VariationTag[] = delivery === 'dialogue'
    ? ['DIALOGUE', 'DIALOGUE', 'DIALOGUE', 'DIALOGUE']
    : ['ACTION', 'EMOTIONAL', 'PRODUCT', 'POV']

  let number = 1
  for (const block of sceneBlocks) {
    const scriptLine = extractBlock(block, 'LINE') ?? ''
    const positionRaw = extractBlock(block, 'POSITION')?.toLowerCase()
    const visibilityRaw = extractBlock(block, 'VISIBILITY')?.toLowerCase()

    const position = parsePosition(positionRaw)
    const productVisible = visibilityRaw === 'yes'
      ? true
      : visibilityRaw === 'no'
        ? false
        : undefined

    const variations: PromptVariation[] = []
    for (let i = 1; i <= MAX_PARSED_VARIATIONS; i++) {
      // Tolerant: a VAR block missing its closing tag still yields its prompt
      // rather than vanishing, which is what left scenes showing two cards.
      const varBlock = extractNumberedBlock(block, 'VAR', i)
      if (!varBlock) continue

      const tagRaw = extractBlock(varBlock, 'TAG') ?? undefined
      const labelRaw = extractBlock(varBlock, 'LABEL') ?? undefined
      const refsRaw = extractBlock(varBlock, 'REFS')?.toLowerCase()
      const promptRaw = extractBlock(varBlock, 'PROMPT') ?? undefined

      // Every variation honours its emitted role, falling back to the
      // positional default when the tag is missing or unrecognised.
      const tag = parseTag(tagRaw) ?? FALLBACK_TAGS[i - 1]
      // No nested PROMPT tag → treat the whole VAR_N body as the prompt
      // (legacy). When the LLM omits the closing tag we'd otherwise paste the
      // raw `<TAG>…</TAG><LABEL>…</LABEL><REFS>…</REFS><PROMPT>…` wrappers
      // into the prompt field — strip them defensively before falling back.
      const promptText = promptRaw || varBlock
        .replace(/<TAG>[\s\S]*?<\/TAG>/g, '')
        .replace(/<LABEL>[\s\S]*?<\/LABEL>/g, '')
        .replace(/<REFS>[\s\S]*?<\/REFS>/g, '')
        .replace(/<PHOTOS>[\s\S]*?<\/PHOTOS>/g, '')
        .replace(/<\/?PROMPT>/g, '')
        .trim()
      // Final belt-and-braces — wipe any straggler control tags. Cheap to
      // run, catches misformed LLM output without touching legitimate prose.
      const cleanPrompt = promptText
        .replace(/<\/?(LABEL|REFS|PHOTOS|PROMPT|VAR_\d+|TAG|POSITION|VISIBILITY)>/g, '')
        .trim()
      if (!cleanPrompt) continue

      const label = labelRaw || defaultLabelFor(tag)
      const refs = clampRefsToVisibility(parseRefs(refsRaw) ?? defaultRefsFor(tag, productVisible), productVisible)
      // Which product photo this shot needs (the sealed wrapper, the unwrapped
      // bar). Absent → the card falls back to the hero photo alone.
      const productPhotos = parsePhotoPick(extractBlock(varBlock, 'PHOTOS'))

      variations.push({
        id: nextId(),
        tag,
        label,
        refs,
        ...(productPhotos ? { productPhotos } : {}),
        prompt: cleanPrompt,
      })
    }

    // Default scene type from variations — keeps the bank-search filters
    // working. A PRODUCT-led first variation marks the scene product-led;
    // everything else is treated as character-led.
    const type: Scene['type'] = variations[0]?.tag === 'PRODUCT'
      ? 'A-ROLL PRODUCT'
      : 'A-ROLL CHARACTER'

    scenes.push({
      number: number++,
      type,
      scriptLine,
      position,
      productVisible,
      variations,
    })
  }

  return scenes
}

function parsePosition(raw: string | undefined): LinePosition | undefined {
  if (!raw) return undefined
  const r = raw.toLowerCase()
  if (r === 'hook' || r === 'reframe' || r === 'mechanism' || r === 'payoff') return r
  if (r === 'cta') return 'CTA'
  return undefined
}

// The roles the LLM may choose from — all silent b-roll. DIALOGUE and STATIC
// are deliberately absent: every clip is now voiceless (a voiceover is added in
// the edit), so no talking-head or lip-sync role is offered. Both tags survive
// in the VariationTag union so legacy persisted cards still render.
const ALL_TAGS: VariationTag[] = ['ACTION', 'EMOTIONAL', 'PRODUCT', 'POV', 'ENVIRONMENT', 'TRANSITION', 'PROOF']

// Tags the parser will accept off the wire. Superset of ALL_TAGS (which is the
// silent-b-roll menu offered to the model) plus DIALOGUE — emitted for VAR_1 in
// "With Dialogue" delivery — and legacy STATIC, so old persisted rows survive.
const PARSEABLE_TAGS: VariationTag[] = [...ALL_TAGS, 'DIALOGUE', 'STATIC']

function parseTag(raw: string | undefined): VariationTag | undefined {
  if (!raw) return undefined
  const r = raw.toUpperCase().trim()
  return PARSEABLE_TAGS.find((t) => t === r)
}

function parseRefs(raw: string | undefined): VariationRefs | undefined {
  if (!raw) return undefined
  const r = raw.toLowerCase().trim()
  if (r === 'character' || r === 'product' || r === 'both' || r === 'none') return r
  return undefined
}

// Visibility is the hard rule in BOTH directions; the LLM's <REFS> pick is only
// a preference.
//
// VISIBILITY=no: never attach the product reference, even when the model asked
// for it — attaching it is how the advertised product ends up rendered as the
// thing the ad is criticising.
//
// VISIBILITY=yes: always attach it. The line is talking about the product, so
// the shot has to be built from the real packaging — label text, shape, colours
// — rather than the model's invention of it. The model drops the ref often
// enough on lenses that "don't need" it (POV, ENVIRONMENT) that this can't be
// left to the prompt alone. Still a per-card toggle afterwards.
//
// DIALOGUE cards follow the same rule as everything else. They used to be
// forced to 'character' whatever VISIBILITY said, because back when a scene had
// ONE talking card and two b-roll cards, the product had its own shots to live
// in and attaching packaging to a talking head just pulled it into a frame that
// only needed a face. In Dialogue mode every card is a talking card, so that
// exception would mean the product never appears in the whole ad — and a line
// that names the product still has to be built from the real packaging.
function clampRefsToVisibility(refs: VariationRefs, productVisible: boolean | undefined): VariationRefs {
  if (productVisible === false) return refs === 'both' || refs === 'character' ? 'character' : 'none'
  if (productVisible === true) return refs === 'product' || refs === 'none' ? 'product' : 'both'
  return refs
}

// Sensible default when the LLM emits a variation without a <REFS> tag.
// Bias toward attaching — an unused reference is harmless, a missing one loses
// likeness — so this errs ON. The only hard exclusion is the product when the
// voiceover forbids it appearing (VISIBILITY=no), a deliberate creative rule.
function defaultRefsFor(tag: VariationTag, productVisible: boolean | undefined): VariationRefs {
  // The legacy STATIC anchor take is sourced from the character reference
  // alone. DIALOGUE cards used to be too; they now follow VISIBILITY like
  // everything else, since in Dialogue mode every card is a talking card and a
  // line about the product still has to be built from the real packaging.
  if (tag === 'STATIC') return 'character'
  // Product must not appear when VISIBILITY is no — keep the character ref on so
  // any person/hands stay consistent, drop only the product.
  if (productVisible === false) return 'character'
  // Otherwise attach both by default — when unsure, on is the safe side.
  return 'both'
}

function defaultLabelFor(tag: VariationTag): string {
  switch (tag) {
    case 'DIALOGUE': return 'Talking to camera'
    case 'STATIC': return 'Same shot every scene'
    case 'ACTION': return 'Literal action'
    case 'EMOTIONAL': return 'Emotional reaction'
    case 'PRODUCT': return 'Product detail'
    case 'POV': return 'POV insert'
    case 'ENVIRONMENT': return 'Environment beat'
    case 'TRANSITION': return 'Transition move'
    case 'PROOF': return 'Proof shot'
  }
}

// Build the identity-only scoping directive prepended to ref'd image prompts.
// Only the clauses for refs that are actually attached appear, so a product-only
// or character-only gen reads cleanly. Exported so other reference-carrying
// surfaces can prepend the same directive.
export function buildReferencePreamble(refs: ReferenceImage[]): string {
  const hasCharacter = refs.some((r) => r.label === 'character')
  const hasProduct = refs.some((r) => r.label === 'product')
  const matchParts: string[] = []
  if (hasCharacter) matchParts.push("the character's face, hair, skin tone, and wardrobe exactly to the character reference")
  if (hasProduct) matchParts.push("the product's shape, label text, and colours exactly to the product reference")
  const matchClause = matchParts.length ? `Match ${matchParts.join(', and ')}. ` : ''
  return `REFERENCE USAGE — The attached image(s) are appearance references only. ${matchClause}${productAnglesClause(refs)}Do NOT copy the reference's framing, crop, pose, camera angle, distance, or background — the composition is defined entirely by the scene description below. Build a new shot from scratch.`
}

// One object, several shots. The product's extra bank angles ride along with the
// hero shot automatically (attachProductAngles), and without this line a model
// handed three photos of the same bar renders three bars — or a multipack. It
// also names what the angles are FOR: the unwrapped, opened, back-of-pack states
// the hero shot can't show, which is exactly what a "she bites into it" scene
// needs to get right.
export function productAnglesClause(refs: ReferenceImage[]): string {
  if (countProductAngles(refs) === 0) return ''
  return 'Several product photos are attached: they are ONE single product shot from different angles and in different states (in and out of its packaging, opened, from the back) — never several products, never a multipack. EXACTLY ONE of the product appears in the frame you render, in the state the scene below calls for; the other photos exist only to get that state right. Never draw a second copy of it anywhere in shot. '
}

// The DIALOGUE chain preamble. A talking-to-camera card generates with the
// PREVIOUS scene's chosen dialogue still attached first, and unlike every other
// reference here that image IS the composition: the ad should read as one
// continuous piece to camera cut into pieces, so the character, the room, the
// wardrobe, the light and the camera position all carry over and only the
// delivery changes. Hence the inverse of buildReferencePreamble — "copy the
// staging, change the moment" rather than "identity only, build a fresh shot".
//
// It still asks for a different CUT rather than an identical frame: an image
// model handed "recreate this exactly" returns the reference, and a cut that
// lands on a frame indistinguishable from the last one reads as a stutter.
export function buildDialogueChainPreamble(refs: ReferenceImage[]): string {
  const hasProduct = refs.some((r) => r.label === 'product')
  const productClause = hasProduct
    ? ` Match the product's shape, label text, and colours exactly to the product reference image. ${productAnglesClause(refs)}`.trimEnd()
    : ''
  return `REFERENCE USAGE — The FIRST attached image is the PREVIOUS talking-to-camera shot from this same ad, filmed moments earlier in one continuous take. Recreate its world exactly: the same character with the same face, hair, make-up and wardrobe, the same room and the same background objects in the same places, the same time of day and the same light from the same direction, and the same camera position, height, distance and framing. Nothing has been restaged between the two shots — the character has not changed clothes, moved house, or relocated within the room.

What DOES change is the moment: this is the NEXT CUT of that take, so the character is now doing and saying what the scene below describes — a new expression, a new gesture, a new head and hand position, a natural shift in posture. Render that moment, not a copy of the attached frame; the two shots should look like two seconds picked out of the same recording, never the identical still twice.${productClause} Any remaining attached images are appearance references for the character and props only — never for composition.`
}

// The STATIC anchor card is the one shot that SHOULD inherit the reference: its
// job is "the character, exactly as they already are, just talking". So it gets
// the inverse of the identity-only preamble above. Falls back to the normal one
// when no character ref is attached — with nothing to inherit, "keep the
// reference's setting" would be an instruction about nothing.
function buildStaticReferencePreamble(refs: ReferenceImage[]): string {
  const hasCharacter = refs.some((r) => r.label === 'character')
  if (!hasCharacter) return buildReferencePreamble(refs)
  return `REFERENCE USAGE — Recreate the attached character reference as closely as you can: same face, hair, skin tone, wardrobe, background, setting, and lighting. Keep the reference's location and camera position. The ONLY change is that the character is now talking to the viewer as described below. Do not relocate them, do not redress them, do not restage the shot.`
}

/**
 * Which image model a generation will actually run on. Honours the user's pick
 * from the master ModelPicker (wired with mode='text-to-image'): when refs are
 * present and the picked model also does image-to-image (e.g. nano-banana-2),
 * it's used directly; when it doesn't (gpt-image-2-text-to-image is t2i-only),
 * this resolves to its i2i sibling. Final fallback is the registry default.
 *
 * Exported because cost estimates must price the model that will really fire —
 * quoting the t2i pick while an i2i sibling gets billed is how a confirm dialog
 * lies about the price.
 */
export function resolveImageModelId(hasRefs: boolean): string | undefined {
  const mode = hasRefs ? 'image-to-image' : 'text-to-image'
  const pickedId = useSettingsStore.getState().getAppModel('broll-studio:image:text-to-image')
  const picked = pickedId ? getModel(pickedId) : undefined

  if (picked && picked.modes?.includes(mode)) return picked.id
  if (picked && hasRefs) {
    // Same-family i2i sibling (gpt-image-2-text-to-image → …-image-to-image).
    const family = picked.id.replace(/-(text-to-image|image-to-image|image-edit).*$/, '')
    const sibling = getModel(`${family}-image-to-image`)
    return sibling?.id ?? getDefaultModel('broll-studio', 'image', 'image-to-image')?.id
  }
  return useSettingsStore.getState().getAppModel(`broll-studio:image:${mode}`)
    ?? getDefaultModel('broll-studio', 'image', mode)?.id
}

/**
 * Phase 1 of B-Roll image generation: resolve model, host refs, POST createTask,
 * return the kie taskId. Caller persists the taskId before awaiting completion
 * so a tab refresh can resume the poll.
 */
export async function startImageTask(
  prompt: string,
  referenceImages?: ReferenceImage[],
  aspectRatio: string = '9:16',
  resolution?: ImageResolution,
  // STATIC anchor cards want the reference's setting and framing carried over
  // rather than stripped — flips which preamble scopes the refs.
  // Continuous mode passes noRealism (the stylized-3D aesthetic is the opposite
  // of the iPhone stack) and its own chain-continuity preamble.
  opts?: { inheritReference?: boolean; noRealism?: boolean; preambleOverride?: string },
): Promise<{ taskId: string; modelId: string }> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const hasRefs = !!referenceImages?.length
  const mode = hasRefs ? 'image-to-image' : 'text-to-image'

  const modelId = resolveImageModelId(hasRefs)
  if (!modelId) throw new Error(`No image model configured for B-Roll (${mode}).`)

  // Convert each reference (asset ref or data URL) to a kie-hosted URL.
  const inputUrls: string[] = []
  if (hasRefs) {
    for (const ref of referenceImages!) {
      let dataUri = ref.dataUrl
      if (isAssetRef(ref.dataUrl)) {
        const asset = await getAsBase64(ref.dataUrl)
        if (!asset) continue
        dataUri = `data:${asset.mimeType};base64,${asset.base64}`
      }
      const hosted = await ensureHostedUrl(apiKey, dataUri)
      inputUrls.push(hosted)
    }
  }

  // Scope the references to identity/appearance only so the model builds a
  // fresh composition from the prompt instead of inheriting the reference's
  // framing, pose, and background. Phrased by which refs are actually attached.
  const scenePrompt = opts?.noRealism ? prompt.trim() : withIphoneRealism(prompt)
  const preamble = opts?.inheritReference ? buildStaticReferencePreamble : buildReferencePreamble
  const preambleText = opts?.preambleOverride ?? (inputUrls.length > 0 ? preamble(referenceImages!) : '')
  const finalPrompt = inputUrls.length > 0 && preambleText
    ? `${preambleText}\n\nSCENE:\n${scenePrompt}`
    : scenePrompt

  const body = buildImageInput(modelId, {
    prompt: finalPrompt,
    aspectRatio: aspectRatio as AspectRatio,
    resolution,
    inputUrls: inputUrls.length > 0 ? inputUrls : undefined,
  })
  const taskId = await createTask(apiKey, modelId, body)
  return { taskId, modelId }
}

/**
 * Phase 2 of B-Roll image generation: poll an existing kie taskId until success,
 * download the resulting image, and persist it as an asset. Resumable — pass
 * the taskId returned by `startImageTask` (possibly from a prior session).
 * `resolution` only feeds the usage ledger's credit estimate (callers persist
 * it on the in-flight entry); omitted → base-tier estimate.
 */
export async function finishImageTask(taskId: string, modelId: string, resolution?: string): Promise<string> {
  const assetRef = await finishImageAssetTask(taskId, modelId)
  // B-Roll stills don't push an imageHistory row (card state lives in the
  // session snapshot), so this is their usage-ledger hook.
  useBankStore.getState().recordUsage({ kind: 'image', modelId, params: { resolution, imageCount: 1 } })
  return assetRef
}

// One-line role brief per tag, shared by the regenerate + free-form variation
// prompts so a forced tag always carries its definition.
const TAG_BRIEFS: Record<VariationTag, string> = {
  // DIALOGUE is the "With Dialogue" talking card: the character looks into the
  // lens and speaks the scene's exact line. STATIC stays a legacy silent anchor.
  DIALOGUE: 'A talking-to-camera shot: the character looks into the lens and SPEAKS the scene\'s exact script line word-for-word, natural like a real person talking to their phone. Audio is on. Embed the line verbatim (the character ... says: "…"). Every dialogue shot in the ad is the same continuous take cut into pieces — same room, same spot, same wardrobe, same light, same camera distance and height — so only the moment changes: expression, gesture, posture. The subject is the person talking, never the product — don\'t stage it in their hands or in the background.',
  STATIC: 'A silent shot of the character in their own space, present and natural but NOT speaking — lips closed, no words mouthed. A voiceover is added later.',
  ACTION: "Act out the line's strongest image, literally — if the line has a metaphor or comparison, make it real on screen (\"tasted like cardboard\" → the character deadpan biting actual cardboard). Silent.",
  EMOTIONAL: 'The feeling of the line landing on the character inside a real moment — a slump against the fridge, a slow exhale over the sink. Silent, never a face in a void.',
  PRODUCT: 'The product itself or its visible result, up close.',
  POV: "First-person through the character's eyes — their hands living the line; the character's face never in frame.",
  ENVIRONMENT: "The place that tells the line's story on its own (the drawer full of abandoned half-eaten bars) — character absent or peripheral.",
  TRANSITION: 'A movement that carries the story forward — sweeping the old stuff into the bin, tossing something into a bag, walking out the door.',
  PROOF: "Visible evidence the line's claim is real — after-state, same-frame comparison, or an ordinary screen artifact like a timer or a streak. This is the one lens where a phone may be in frame, as the object being looked at rather than the camera. Never fake reviews, ratings, or statistics.",
}

/**
 * Generate a new prompt variation for a scene using Gemini 3 Flash.
 */
export async function generateNewVariation(
  sceneNumber: number,
  sceneType: string,
  scriptLine: string,
  forceTag?: VariationTag,
  productContext?: string,
  modelContext?: string,
): Promise<PromptVariation> {
  const { apiKey, endpoint } = getChatEndpoint()

  const isDialogue = forceTag === 'DIALOGUE'
  const tagInstruction = forceTag
    ? `The variation MUST be a ${forceTag} shot. ${TAG_BRIEFS[forceTag]}`
    : `Pick the shot role yourself from this menu — choose what this specific line earns:\n${ALL_TAGS.map((t) => `- ${t}: ${TAG_BRIEFS[t]}`).join('\n')}`

  // A DIALOGUE regen keeps the character speaking the line (dialogue format);
  // everything else is silent b-roll (the default doctrine).
  const deliveryClause = isDialogue
    ? `This is a DIALOGUE shot: the character SPEAKS the line above word-for-word. Embed it verbatim inside double quotes, e.g.: the character, [expression/gesture], [where they're looking] and says: "${scriptLine}". Natural delivery — a real person talking, not a news anchor. Audio is on. Give this take its own situation — a different room, a different task in their hands, a different moment — rather than another angle on a person sat still.`
    : `This is SILENT b-roll — no one speaks; a voiceover is laid over the footage later. The character never talks to camera or mouths words.`

  const prompt = `Generate a single new creative image generation prompt for this B-Roll scene:

Scene ${sceneNumber}: ${sceneType}
Script line: "${scriptLine}"
${tagInstruction ? `\n${tagInstruction}\n` : ''}
${productContext ? `\n${productContext}\n` : ''}${modelContext ? `\n${modelContext}\nIMPORTANT: never describe the character's physical appearance in detail. Refer to them as "the character" — a visual reference image will be attached.\n` : ''}
# PROMPT FORMAT

${isDialogue ? PROMPT_FORMAT_DIALOGUE : PROMPT_FORMAT}

${deliveryClause}

SHOW, DON'T TELL — the shot must visualize what the line SAYS, so a viewer could guess the line from the footage alone. If the line has a metaphor or vivid image, consider making it literal on screen, even if absurd ("tasted like cardboard" → the character deadpan biting actual cardboard). Never a person passively existing while the line plays. Bring a genuinely fresh idea, not a re-angle of an obvious shot.

Rules:
1. Be specific — the exact prop, the exact gesture, the exact micro-expression, the real light source. If the prompt could describe two different shots, rewrite it.
2. NEVER use he / him / his / she / her / "subject". Refer to the on-screen person as "the character" or "they / them / their".
3. UGC realism — looks filmed at home: natural light, lived-in rooms, handheld drift. Nothing commercial, cinematic, or studio-lit. No captions or on-screen text.
4. DO NOT mention aspect ratio, resolution, or framing dimensions in numbers — those are set separately.
5. The character looks like the after-state, never the before.
6. Name a movement — no frozen poses, no still-life.
7. THE CAMERA IS A VIEWPOINT, NOT A PROP. Never name the filming device — no "phone", "iPhone", "front camera", "tripod", "ring light"; never in a hand, on a table, or in a reflection; never a mirror selfie. When the camera position matters, state it as a position: "framed from chest height an arm's length away". Only a PROOF shot may show a screen, as the subject being looked at.

Respond with ONLY this envelope. No markdown, no commentary, nothing outside the tags:

<VARIATION>
<LABEL>short slug naming the idea, e.g. CARDBOARD BITE</LABEL>
<TAG>${forceTag ?? 'ACTION|EMOTIONAL|PRODUCT|POV|ENVIRONMENT|TRANSITION|PROOF'}</TAG>
<REFS>character|product|both|none</REFS>
<PROMPT>
one flowing paragraph
</PROMPT>
</VARIATION>`

  const messages: ChatMessage[] = [
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages)

  // Tag envelope rather than JSON: the six-field prompt is multi-line, and a
  // raw newline inside a JSON string is a parse error — which used to surface
  // as "Regenerate failed" on a response that was otherwise perfectly good.
  // Same shape (and same helpers) as the scene parser above.
  const labelRaw = responseText.match(/<LABEL>([\s\S]*?)<\/LABEL>/)?.[1]?.trim()
  const tagRaw = responseText.match(/<TAG>([\s\S]*?)<\/TAG>/)?.[1]?.trim()
  const refsRaw = responseText.match(/<REFS>([\s\S]*?)<\/REFS>/)?.[1]?.trim().toLowerCase()
  const promptRaw = responseText.match(/<PROMPT>([\s\S]*?)<\/PROMPT>/)?.[1]?.trim()
  if (!promptRaw) {
    throw new Error(`No <PROMPT> in the variation response — body: ${responseText.slice(0, 400)}`)
  }

  // Honour the forced tag even if the LLM ignores the instruction; validate
  // a free-choice tag against the known union so a made-up role can't leak
  // into persisted state.
  const finalTag: VariationTag = forceTag ?? parseTag(tagRaw) ?? 'ACTION'
  return {
    id: nextId(),
    label: labelRaw || defaultLabelFor(finalTag),
    tag: finalTag,
    refs: clampRefsToVisibility(parseRefs(refsRaw) ?? defaultRefsFor(finalTag, undefined), undefined),
    prompt: promptRaw,
  }
}

// Rewrite the user's draft prompt to obey the framework while keeping their
// intent. Used by the Enhance button in CardDetailModal. The full system
// instruction grounds the LLM; the user message names the target tag + scene
// so the rewrite stays on-brief.
export async function enhanceVariationPrompt(
  draft: string,
  scene: { number: number; scriptLine: string },
  variation: { tag: VariationTag; label: string },
  productContext?: string,
  modelContext?: string,
): Promise<string> {
  const { apiKey, endpoint } = getChatEndpoint()

  const isDialogue = variation.tag === 'DIALOGUE'
  // The silent doctrine governs every b-roll lens; a DIALOGUE card is the one
  // exception — the rewrite must KEEP the character speaking the line.
  const soundRule = isDialogue
    ? `- This is a DIALOGUE shot: the character speaks the script line to camera. KEEP the spoken line in the rewrite, verbatim (the character … says: "…") — do not strip the speech or mute them. Audio is on; no background music or extra voiceover.`
    : `- This is SILENT b-roll: no one speaks and no words are mouthed. If the draft has the character talking to camera, keep the shot, drop the speech. Sound, if mentioned, is only the natural sound of the moment — no dialogue, no music, no voiceover.`

  const userMessage = `Rewrite the draft below for the ${variation.tag} variation of this scene. Keep the user's intent; tighten the language; obey the framework.

Scene ${scene.number} — LINE: "${scene.scriptLine}"
Variation tag: ${variation.tag}${variation.label ? `\nShot label: ${variation.label}` : ''}
${productContext ? `\n${productContext}\n` : ''}${modelContext ? `\n${modelContext}\nIMPORTANT: never describe the character's physical appearance in detail. Refer to them as "the character".\n` : ''}
Rules:
- Return ONE flowing paragraph with NO word limit — as long as the shot needs. No labels, no field names, no line breaks, no "Style:" trailer. If the draft is a labelled multi-line block (SETTING: / CAMERA: / ...), that is exactly what you are here to fix: fold it into one readable paragraph, keeping the idea.
- SHOW, DON'T TELL — the shot must visualize what the script line says, so a viewer could guess the line from the footage. Sharpen the draft's idea toward that; if it's a person passively existing, give them the line's image to act out.
- Be specific — the exact prop, the exact gesture, the exact micro-expression, the real light source.
- Enhance means ADD DETAIL, not rephrase: the prompt comes back richer than it went in, never shorter than the draft.
- Never "he/him/she/her/subject" — use "the character" or "they/them/their".
- DO NOT mention aspect ratio, resolution, or framing in numbers.
- UGC realism — filmed-at-home natural light and handheld feel; nothing commercial or studio-lit; no captions or on-screen text.
- THE CAMERA IS A VIEWPOINT, NOT A PROP. Strip every mention of the filming device — no phone, iPhone, smartphone, front camera, tripod, or ring light as an object in the scene; nothing held, propped, or reflected; no mirror selfie. Rewrite any such phrasing as a position: "phone held at arm's length below chin level" becomes "framed from just below chin height, about an arm's length away". If the user's draft names a device, keep their intended shot, drop the equipment.
- Honour the variation's lens: ${TAG_BRIEFS[variation.tag]}
${soundRule}

Draft:
"""
${draft}
"""

Respond with ONLY this envelope. No markdown, no commentary, nothing outside the tags:

<PROMPT>
one flowing paragraph
</PROMPT>`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: SYSTEM_INSTRUCTION }] },
    { role: 'user', content: [{ type: 'text', text: userMessage }] },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages)
  const tagged = responseText.match(/<PROMPT>([\s\S]*?)<\/PROMPT>/)?.[1]?.trim()
  if (tagged) return tagged
  // No envelope — the model answered with the bare rewrite. Strip any code
  // fence and use it as-is rather than failing an otherwise good response.
  return responseText
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/<\/?PROMPT>/g, '')
    .trim()
}
