import type { BrollInput, BrollResult, Scene, PromptVariation, ReferenceImage, VariationTag, VariationRefs, LinePosition, OneShotDelivery } from '../types'
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
const PROMPT_FORMAT_CORE = `Every prompt is ONE flowing paragraph — usually 40-80 words, longer when the idea needs it. Plain, concrete, readable — no labels, no field names, no line breaks, no "Style:" trailer.

Write it like you're describing a clip you already filmed: what's in frame, what the character physically does (the exact gesture, gaze, micro-expression), where the light comes from, and — only when it matters — where the camera sits, always as a position ("framed from chest height an arm's length away", "from directly above"), never as a device.`

const PROMPT_FORMAT = `${PROMPT_FORMAT_CORE} You may end with the natural sound of the moment (a dry crunch, a wrapper crinkle, room tone) — never dialogue, never music.

The footage is SILENT: no one speaks, mouths words, or addresses the viewer. A voiceover is laid over these clips in the edit.`

// The talking-card format for "With Dialogue" delivery — the character speaks
// the scene's line to camera. Used by the DIALOGUE regen/enhance paths.
const PROMPT_FORMAT_DIALOGUE = `${PROMPT_FORMAT_CORE} The character looks into the lens and SPEAKS the scene's line — embed the exact words verbatim (the character … says: "…"). Audio is on: just them talking, no background music, no extra voiceover.`

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

For each voiceover line in the script, produce 4 variations — 4 genuinely DIFFERENT ideas for visualizing that line, not one idea filmed from four angles. Before writing, silently brainstorm: what's the literal image hiding in this line? the real-life moment behind it? the feeling? the visible proof? Then write the four best ideas as prompts.

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
- The four tags must be different from each other, and each must produce a DIFFERENT CONCEPT — different subject, different idea, not the same beat reframed.
- When the line carries a metaphor or vivid image, at least one variation MUST make it literal (usually ACTION).
- Choose for the line, not by habit, and vary the mix across the ad.
- When VISIBILITY is no: PRODUCT is off the menu and no variation may show the product or its packaging.
- When VISIBILITY is yes and the line names the product: at least one variation features the product prominently.

You decide per variation:
- LABEL — a short slug naming the actual idea (e.g. "CARDBOARD BITE", "BAR HITS THE BIN", "DRAWER OF REJECTS"). Two-to-four words.
- REFS — which reference images to attach: character / product / both / none. ERR ON THE SIDE OF ATTACHING — a reference the model doesn't strictly need is harmless, but a missing one loses the character's face or the product's exact look. Attach the character reference whenever a person (or even just their hands, for POV) could appear, OR whenever holding the character's look consistent might help — when unsure, attach it. Attach the product reference whenever the product could appear or its exact packaging/shape could inform the frame — when unsure, attach it. Prefer "both" whenever both could plausibly help. Reserve "none" only for shots that clearly show neither a person nor the product (a bare environment, an abstract insert). The ONE hard exclusion: when VISIBILITY is no, REFS must NOT include product — the product cannot appear at all in that shot.

# PROMPT FORMAT (EVERY PROMPT, EVERY VARIATION)

${PROMPT_FORMAT}

# THE CAMERA IS A VIEWPOINT, NOT A PROP

Image and video models draw the nouns you give them: write "phone" and a phone appears in frame, and your shot becomes a mirror selfie. So never name the filming device — no "phone", "iPhone", "smartphone", "front camera", "tripod", "ring light" — never in a hand, on a table, or in a reflection. When the camera position matters, state it as a position: "framed from chest height an arm's length away", "from directly above the counter", "from lap height looking up".

  WRONG: "phone propped on the counter filming them"
  RIGHT: "framed from chest height across the counter"

The ONE exception: a PROOF shot may show a screen as the deliberate subject being looked at.

# NON-NEGOTIABLE RULES

1. SCRIPT SEGMENTATION — ONE LINE, ONE IDEA. A scene is one shot, and one shot can only show one thing. Split any sentence carrying two visual ideas into two <LINE>s — the giveaway is a turn ("but", "though", "however", "until", "then", "so", "that's why") or a problem paired with its solution, a before with its after, a claim with its proof. "Most taste like chewed up cardboard, but this one tastes like real cookie dough" is TWO lines: the complaint, then the fix. Never cut mid-clause, and every <LINE> must be a speakable phrase of at least five words — merge anything shorter forward ("Listen up." + "This serum changed my skin." → one <LINE>). Never a standalone scene for "Listen up", "Be honest", "So...", "Right?". The <LINE>s are the actual voiceover: use the script's exact words in the script's order, dropping only a connecting word at a split. Never paraphrase, add, or reorder.

2. PRODUCT VISIBILITY IS LOCKED TO THE VOICEOVER — if VISIBILITY is no, the product appears nowhere: not in the background, not blurred, not implied by packaging-coloured objects. If the line itself names or references the product ("this bar", "I tried it"), VISIBILITY is YES regardless of position — the viewer hears it named, so the shot may show it.

2b. THE BAD VERSION IS ALWAYS GENERIC — when VISIBILITY is no but the line still needs a category object on screen (the cardboard-tasting bar, the serum that did nothing, the old gadget), that object is an UNBRANDED STAND-IN and you must say so in the prompt: plain matte packaging, no logo, no brand name, no readable text, in colours and a shape deliberately unlike the advertised product. "A brittle chalky bar in a plain unmarked grey wrapper, no logo or text anywhere" is right; "a protein bar" is wrong — the model fills that blank with the attached product reference and the ad ends up trashing its own product. The words "the product" mean the advertised product and nothing else; never use them for a stand-in.

3. GENDER-NEUTRAL LANGUAGE — never he/him/she/her, never "subject". Always "the character" and "they/them/their". The character reference may be any gender.

4. SPECIFIC, NOT GENERIC — name the exact prop, the exact gesture, the exact micro-expression, the real light source. "Looking frustrated" fails; "jaw working slowly, eyes flat, one eyebrow raised mid-chew" works. If a prompt could describe two different shots, rewrite it.

5. UGC REALISM — everything looks like a real person filmed it at home: natural light, lived-in rooms, slightly imperfect framing, handheld drift. Anything that reads "commercial", "cinematic", "studio", or "polished" is a failure. No captions, subtitles, or on-screen text.

6. THE AFTER, NOT THE BEFORE — the character always already has the result the product promises. They are the testimonial, not the case study. (Comedy exception: a LITERAL metaphor shot like the cardboard bite may show the old pain being acted out — but never the character's actual body/skin/hair in a "before" state.)

7. CONSTANT MOTION — every prompt names a movement: a bite mid-chew, a toss mid-air, a hand dragging, the frame drifting. No frozen poses, no still-life.

8. CROSS-SCENE CONSISTENCY — one ad: same wardrobe, same home, same time of day across scenes unless the script demands a change. The product reference image is the source of truth — never invent packaging.

# SELF-CHECK BEFORE RETURNING

1. Could someone watching this shot guess the line it belongs to? If not, the idea isn't visual enough — find the image inside the line and rewrite.
2. Are the 4 variations four different IDEAS (different subject or concept), not one idea from four angles?
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
<VAR_4>
<TAG>a DIFFERENT role from VAR_1, VAR_2 and VAR_3</TAG>
<LABEL>...</LABEL>
<REFS>...</REFS>
<PROMPT>...</PROMPT>
</VAR_4>
</SCENE>`

// Delivery override appended to the system instruction ONLY in "With Dialogue"
// mode. Read last, so it wins over the "every shot is SILENT" doctrine for VAR_1
// while leaving the other three variations untouched. The Line-by-Line dialogue
// card is deliberately lighter than One-Shot's — a single independent clip, so
// no shared VOICE PROFILE block; the character just speaks the scene's line.
const DIALOGUE_DELIVERY_ADDENDUM = `

# DELIVERY OVERRIDE — WITH DIALOGUE (READ LAST, HIGHEST PRIORITY)

This ad is delivered WITH DIALOGUE. For EVERY scene, VAR_1 is NOT silent b-roll — it is a talking-to-camera DIALOGUE shot. VAR_2, VAR_3 and VAR_4 stay silent b-roll exactly as described above (three genuinely different lenses).

VAR_1 rules, every scene:
- <TAG>DIALOGUE</TAG> and <REFS>character</REFS>.
- The character is on camera, looking into the lens, and SPEAKS the scene's exact <LINE> word-for-word. Write ONE flowing paragraph that embeds the line verbatim, e.g.: "the character, [expression/gesture], looks into the lens and says: \\"<the exact line>\\"". A real person talking to their phone — natural, not a news anchor.
- Describe the delivery, expression, gesture, setting, and where the light comes from. This is the ONE variation that is NOT silent — the character speaks and audio is on. The "footage is SILENT / no one speaks" rule in the PROMPT FORMAT and SHOW-DON'T-TELL sections governs VAR_2, VAR_3 and VAR_4 only — it does NOT apply to VAR_1.
- Still obey every other rule: camera is a viewpoint not a prop (never name the filming device), gender-neutral language ("the character", "they/them"), UGC realism, after-not-before.

# VOICE PROFILE (emit ONCE, after the last scene)

After the final </SCENE>, output exactly ONE block — the ONLY content allowed outside the scene envelopes:

<VOICE_PROFILE>
VOICE — describe, in rich and reproducible detail, HOW the character sounds: perceived age and gender of the voice, accent / region, pitch, pace, texture (warm, raspy, breathy, smooth), energy, and 1-2 signature quirks (uptalk, a slight vocal fry, a laugh living in the voice). One dense paragraph you could hand to a TTS engine and get the same person every time. Describe ONLY the sound, never appearance.
</VOICE_PROFILE>

This one voice is shared by every dialogue clip in the ad, so it must be self-contained and consistent.`

// The system instruction the scene call runs on, with the dialogue override
// appended in "With Dialogue" delivery. Exported so the Import-prompts brief
// hands an outside model the EXACT same rules — one source, no drift.
export function brollSystemInstruction(delivery: OneShotDelivery): string {
  return delivery === 'dialogue' ? SYSTEM_INSTRUCTION + DIALOGUE_DELIVERY_ADDENDUM : SYSTEM_INSTRUCTION
}

// The user half of the scene call. Same reason for being exported.
export function buildBrollUserPrompt(input: BrollInput): string {
  const withDialogue = input.delivery === 'dialogue'
  const variationBrief = withDialogue
    ? `For EACH scene emit four variations: VAR_1 is a DIALOGUE shot where the character speaks the exact line to camera (<TAG>DIALOGUE</TAG>, <REFS>character</REFS>), and VAR_2–VAR_4 are three genuinely DIFFERENT silent b-roll ideas for showing what the line SAYS. Pick three distinct lenses from the menu (ACTION / EMOTIONAL / PRODUCT / POV / ENVIRONMENT / TRANSITION / PROOF) for VAR_2–VAR_4, declared in each <TAG> field.`
    : `For EACH scene emit four variations: four genuinely DIFFERENT ideas for showing what that line SAYS — make metaphors literal, show the act, the feeling, the proof. Pick four distinct lenses from the menu (ACTION / EMOTIONAL / PRODUCT / POV / ENVIRONMENT / TRANSITION / PROOF), declared in each <TAG> field. Every shot is silent — no one speaks (a voiceover is added later).`

  let prompt = `Break this script into B-Roll scenes following the system rules. ${variationBrief} Each prompt is ONE readable paragraph (usually 40-80 words, longer when the idea needs it). Decide POSITION + VISIBILITY per scene — if the line names or references the product, VISIBILITY must be yes regardless of POSITION. Pick REFS per variation, erring toward attaching references whenever they could plausibly help — only the VISIBILITY=no product exclusion is a hard rule.\n\nScript:\n${input.scriptText}`

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
  const systemInstruction = brollSystemInstruction(input.delivery)
  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: systemInstruction }] },
    { role: 'user', content: [{ type: 'text', text: prompt }] },
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
//     <VAR_N><TAG/><LABEL/><REFS/><PROMPT/></VAR_N>   (x4)
//   </SCENE>
//
// Tolerant of legacy output that emits <VAR_N>plain text</VAR_N> with no
// nested tags — falls back to position-based TAG defaults so a slightly
// off-schema response still produces usable variations.
//
// Exported because Import prompts runs hand-written output through the SAME
// parser the live call uses — an import can't drift from a generation.
export function parseScenes(responseText: string, delivery: OneShotDelivery = 'silent'): Scene[] {
  const scenes: Scene[] = []
  const sceneRegex = /<SCENE>([\s\S]*?)<\/SCENE>/g
  const lineRegex = /<LINE>([\s\S]*?)<\/LINE>/
  const positionRegex = /<POSITION>([\s\S]*?)<\/POSITION>/
  const visibilityRegex = /<VISIBILITY>([\s\S]*?)<\/VISIBILITY>/

  // All four variations carry the LLM's per-line role pick in <TAG>; these
  // defaults only apply when the tag is missing or unrecognised. In dialogue
  // delivery VAR_1 is the talking card, so its fallback is DIALOGUE.
  const FALLBACK_TAGS: VariationTag[] = delivery === 'dialogue'
    ? ['DIALOGUE', 'ACTION', 'EMOTIONAL', 'PRODUCT']
    : ['ACTION', 'EMOTIONAL', 'PRODUCT', 'POV']

  let match
  let number = 1
  while ((match = sceneRegex.exec(responseText)) !== null) {
    const block = match[1]
    const scriptLine = block.match(lineRegex)?.[1]?.trim() || ''
    const positionRaw = block.match(positionRegex)?.[1]?.trim().toLowerCase()
    const visibilityRaw = block.match(visibilityRegex)?.[1]?.trim().toLowerCase()

    const position = parsePosition(positionRaw)
    const productVisible = visibilityRaw === 'yes'
      ? true
      : visibilityRaw === 'no'
        ? false
        : undefined

    const variations: PromptVariation[] = []
    for (let i = 1; i <= 4; i++) {
      const varRegex = new RegExp(`<VAR_${i}>([\\s\\S]*?)<\\/VAR_${i}>`)
      const varBlock = block.match(varRegex)?.[1]
      if (!varBlock) continue

      const tagRaw = varBlock.match(/<TAG>([\s\S]*?)<\/TAG>/)?.[1]?.trim()
      const labelRaw = varBlock.match(/<LABEL>([\s\S]*?)<\/LABEL>/)?.[1]?.trim()
      const refsRaw = varBlock.match(/<REFS>([\s\S]*?)<\/REFS>/)?.[1]?.trim().toLowerCase()
      const promptRaw = varBlock.match(/<PROMPT>([\s\S]*?)<\/PROMPT>/)?.[1]?.trim()

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
        .replace(/<\/?PROMPT>/g, '')
        .trim()
      // Final belt-and-braces — wipe any straggler control tags. Cheap to
      // run, catches misformed LLM output without touching legitimate prose.
      const cleanPrompt = promptText
        .replace(/<\/?(LABEL|REFS|PROMPT|VAR_\d+|TAG|POSITION|VISIBILITY)>/g, '')
        .trim()
      if (!cleanPrompt) continue

      const label = labelRaw || defaultLabelFor(tag)
      const refs = clampRefsToVisibility(parseRefs(refsRaw) ?? defaultRefsFor(tag, productVisible), productVisible)

      variations.push({
        id: nextId(),
        tag,
        label,
        refs,
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

// Visibility is the hard rule; the LLM's <REFS> pick is only a preference. A
// scene whose voiceover forbids the product never attaches the product
// reference, even when the model asked for it — attaching it is how the
// advertised product ends up rendered as the thing the ad is criticising.
function clampRefsToVisibility(refs: VariationRefs, productVisible: boolean | undefined): VariationRefs {
  if (productVisible !== false) return refs
  return refs === 'both' || refs === 'character' ? 'character' : 'none'
}

// Sensible default when the LLM emits a variation without a <REFS> tag.
// Bias toward attaching — an unused reference is harmless, a missing one loses
// likeness — so this errs ON. The only hard exclusion is the product when the
// voiceover forbids it appearing (VISIBILITY=no), a deliberate creative rule.
function defaultRefsFor(tag: VariationTag, productVisible: boolean | undefined): VariationRefs {
  // A talking DIALOGUE card and a legacy STATIC anchor are sourced entirely from
  // the character reference — the product never belongs in them, whatever
  // VISIBILITY says.
  if (tag === 'STATIC' || tag === 'DIALOGUE') return 'character'
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
// or character-only gen reads cleanly. Exported for One Shot mode, which
// prepends the same directive to its reference-to-video prompts.
export function buildReferencePreamble(refs: ReferenceImage[]): string {
  const hasCharacter = refs.some((r) => r.label === 'character')
  const hasProduct = refs.some((r) => r.label === 'product')
  const matchParts: string[] = []
  if (hasCharacter) matchParts.push("the character's face, hair, skin tone, and wardrobe exactly to the character reference")
  if (hasProduct) matchParts.push("the product's shape, label text, and colours exactly to the product reference")
  const matchClause = matchParts.length ? `Match ${matchParts.join(', and ')}. ` : ''
  return `REFERENCE USAGE — The attached image(s) are appearance references only. ${matchClause}Do NOT copy the reference's framing, crop, pose, camera angle, distance, or background — the composition is defined entirely by the scene description below. Build a new shot from scratch.`
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
  DIALOGUE: 'A talking-to-camera shot: the character looks into the lens and SPEAKS the scene\'s exact script line word-for-word, natural like a real person talking to their phone. Audio is on. Embed the line verbatim (the character ... says: "…").',
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
    ? `This is a DIALOGUE shot: the character looks into the lens and SPEAKS the line above word-for-word. Embed it verbatim, e.g.: the character, [expression/gesture], looks into the lens and says: "${scriptLine}". Natural delivery — a real person talking to their phone, not a news anchor. Audio is on.`
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
    refs: parseRefs(refsRaw) ?? defaultRefsFor(finalTag, undefined),
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
- Return ONE flowing paragraph — usually 40-80 words, longer when the idea needs it. No labels, no field names, no line breaks, no "Style:" trailer. If the draft is a labelled multi-line block (SETTING: / CAMERA: / ...), that is exactly what you are here to fix: fold it into one readable paragraph, keeping the idea.
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
