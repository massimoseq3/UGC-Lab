import type { GenerateScriptInput, GeneratedScript, RemixAngle, EditableProductContext, WriteStyle, WriteLength, HookCategory } from '../types'
import { HOOK_COUNT, REMIX_ANGLES } from '../types'
import { useSettingsStore } from '../../../stores/settingsStore'
import { kieChatCompletions, type ChatMessage } from '../../../utils/kie'
import { getChatEndpointPath } from '../../../utils/models'

// Scripts is the one app that does NOT use the app-wide chat model. Everything
// else runs on Gemini 3 Flash; script writing stays on 3.6 Flash even at ~2.6×
// the credits. The rest of the app's chat calls shape prompts for an image or
// video model to execute — 3 Flash is plenty for that. Here the model's prose
// IS the product: a human reads these takes and decides whether they sound like
// a person. That's exactly where the stronger writer is worth paying for.
const CHAT_MODEL_ID = 'gemini-3-6-flash'

// ── Shared writing DNA ──
//
// Every mode (write / scenes / cinematic / remix / reverse-engineer) sits on
// the same substrate: sound like a real person, never reach for the AI
// sentence shapes, win on the hook, audit before answering. The per-mode
// system prompts compose these blocks so the voice stays identical no matter
// which path the user takes.

const HUMAN_VOICE_RULES = `HOW IT MUST SOUND — NON-NEGOTIABLE:
- These words get spoken out loud by a real person filming themselves on their phone. Every single line must pass this test: "would a normal person in their 20s actually say this to a friend?" If not, rewrite it.
- ALWAYS use contractions: I'm, don't, it's, can't, that's, you're, I've, didn't.
- Use casual spoken reductions where a real person would: gonna, wanna, kinda, gotta, 'cause. Sprinkle them where they'd naturally land — never force them into every line.
- Conversational starters and fillers in MODERATION (a couple per script, never every line): "okay so", "honestly", "no because", "literally", "I'm not even kidding", "wait". Overusing these is its own fake-casual tell.
- One idea per breath. Short sentences. Fragments are fine. Vary the rhythm hard: a 3-word line next to a longer rambling one. Never an even, metronome cadence — that evenness is the AI tell.
- Build in ONE natural disfluency on purpose: a restart, a self-correction, or an aside ("it's like 30 bucks? maybe 35"). Controlled imperfection reads as real.
- 6th-grade vocabulary. If a word would feel weird said out loud, cut it.
- Don't oversell. Real people undersell and let the result talk: "and it just... worked" lands harder than "it works amazingly well".
- Specifics beat claims. Real numbers, timeframes, prices, tiny concrete details ("two weeks", "$30", "every single morning") make it believable.
- No emojis, no hashtags, no [pause] markers.`

const BANNED_AI_PATTERNS = `BANNED AI SENTENCE SHAPES — THIS IS THE #1 THING THAT GIVES AI WRITING AWAY. Word choice isn't enough; these CONSTRUCTIONS are the real tell. Never use any:
1. "It's not X, it's Y" / "It isn't about X, it's about Y" (e.g. "it's not a serum, it's a ritual"). Just say what it IS.
2. Revelation hook: "here's what nobody tells you", "the thing no one admits", "what they don't want you to know". State the thing plainly instead.
3. Elliptical setup: "The best part? ...", "The crazy thing? ...", "The catch? ...". Drop the fake question, say the point.
4. The reframe: "everyone chases X, but few earn Y", "X doesn't win, Y does". Express one thought, not a balanced opposition.
5. Philosophical reduction: "confidence isn't loud, it's quiet", "success isn't more, it's enough". No poetic paradoxes.
6. Rule of three: three parallel items for rhythm ("smooth, simple, effortless"). Real people name the ONE thing that matters and move on. Cut to one; if two genuinely matter, keep two and make them different lengths.
- NEVER use an em-dash (—). Use periods, commas, or just restructure.
- BANNED WORDS: elevate, unleash, revolutionary, game-changer, seamless, effortless, transform, indulge, crafted, premium, innovative, leverage, "say goodbye to", "say hello to", "look no further", "introducing", "the secret to", "must-have", "in today's world", "level up".`

const HOOK_RULES = `THE HOOK IS 80% OF THE JOB:
- The first line is the entire video. Write it to win in under 1.5 seconds of speech, in the first 3-4 words.
- Enter mid-thought, mid-story, or mid-reaction. Never warm up, never set up context. The most interesting beat goes FIRST; you explain later.
- Banned hook openers (they scream "ad"): "So I've been...", "Have you ever...", "Let me tell you about...", "Introducing...", "If you struggle with...".
- Open a loop in or near the hook that only pays off later, so they keep watching to the end.`

const SELF_AUDIT = `SELF-AUDIT BEFORE YOU ANSWER (do this silently; output ONLY the final result):
1. Read the hook. Does it win in 3-4 words with no warm-up? If not, rewrite it.
2. Scan every line for the 6 banned sentence shapes and any em-dash. Kill them.
3. Check rhythm: if 3+ sentences in a row are the same length, break one.
4. Find one vague claim and make it specific. Find one oversell and undersell it.
5. Read the whole thing out loud in your head. Any line you wouldn't actually say to a friend gets rewritten or cut.`

// The voice-consistency spec. Scenes and Cinematic emit this so the SAME
// on-camera voice can be reproduced across every clip in (and beyond) an ad.
// Plain spoken scripts deliberately omit it — that text is piped straight to
// Voiceovers TTS, where the voice is picked in the ElevenLabs catalog instead.
const VOICE_PROFILE_SPEC = `VOICE — describe, in rich and reproducible detail, HOW the speaker sounds, so the exact same voice can be reused across every video. Cover: the perceived age and gender of the voice, accent / region, pitch (low / mid / high), pace (slow, measured, fast), texture (warm, raspy, breathy, smooth, nasal, gravelly), energy (calm, hyped, deadpan, bubbly), and 1-2 signature quirks (uptalk, slight vocal fry, a laugh living in the voice, clipped consonants). Write it as one dense paragraph you could hand to a voice actor or a TTS engine and get the same person every single time. Describe ONLY the sound — never physical appearance.`

// Short clips drown when the model tries to cram the whole product brief in.
// This is length-tiered discipline: ≤15s = one idea, longer = room for an arc.
//
// The CUT-LINES clause exists because the failure mode of a shorter target is
// keeping the SAME number of beats and clipping every sentence into fragments —
// which reads staccato and fake. Fewer full-length lines always beats more
// truncated ones.
const CUT_LINES_NOT_LENGTH = `HOW TO HIT THE WORD BUDGET: shorten the script by using FEWER lines, never by squeezing the same number of lines into shorter, clipped sentences. Each line you keep stays a natural, full spoken sentence a real person would say. If the budget is tight, delete whole beats and lines until what remains fits — do not compress every line into a fragment to preserve the line count. A short script is a script with fewer thoughts, not the same thoughts said faster.`

function lengthDiscipline(length: WriteLength): string {
  if (length <= 15) {
    return `LENGTH DISCIPLINE — THIS IS ONLY ${length}s, SO BE RUTHLESS: a ${length}-second ad has room for exactly ONE idea, not a product tour. Pick ONE angle and ONE benefit (or one pain point) and commit the entire clip to it. Do NOT try to fit the product's full feature list, multiple USPs, the offer, AND the CTA into ${length} seconds — cramming all of it is exactly what makes short scripts feel rushed and disconnected. Almost all the words belong to the hook and its single payoff. Mention the product once. Always end on a CTA, but keep it QUICK at this length — a few words folded into or right after the payoff ("link's below", "grab one") — never a full closing pitch.\n\n${CUT_LINES_NOT_LENGTH}`
  }
  return `LENGTH DISCIPLINE: you have ${length}s — enough for a real arc (hook, tension, payoff, CTA). Still resist listing every feature; choose the 1-2 points that actually sell and let them breathe. Depth on one idea beats a shallow tour of five. Always close with a CTA; it can stay short and casual.\n\n${CUT_LINES_NOT_LENGTH}`
}

// ── The viral-hook library ──
//
// A hook is the FIRST spoken line of a UGC ad — the 1.5 seconds that decide
// whether the thumb stops. The library below is the "1,000 Viral Hooks" swipe
// file distilled into its 7 formula families with representative fill-in-the-
// blank templates, kept at their ORIGINAL full length (setup AND payoff clause
// — never truncated). It powers the dedicated Hooks format AND seeds the
// opening line of the Write New script / scenes pipelines.

// The literal tag each family uses in the hooks pipeline's tagged-line output.
// Keys are the HookCategory slugs; values must round-trip through parseHooks'
// slug normalisation (lowercase, non-letters → '-').
const HOOK_TAG: Record<HookCategory, string> = {
  educational: 'EDUCATIONAL',
  comparison: 'COMPARISON',
  'myth-busting': 'MYTH BUSTING',
  storytelling: 'STORYTELLING',
  authority: 'AUTHORITY',
  'day-in-the-life': 'DAY IN THE LIFE',
  'pattern-interrupt': 'PATTERN INTERRUPT',
}

const HOOK_LIBRARY = `THE 7 HOOK FAMILIES AND THEIR PROVEN FORMULAS — every "(...)" is a blank you fill with THIS product's specifics. Each formula is a COMPLETE thought: if it has a setup and a payoff clause, both parts are the formula — never use half of one.

<EDUCATIONAL> — teach or promise a concrete lesson. Wins when the product solves a how-do-I problem.
- Here's exactly how much (thing) you need to (result).
- It took me 10 years to learn this but I'll teach it to you in less than 1 minute.
- If I woke up with (pain point) tomorrow and wanted (dream result) by (time), here's exactly what I would do.
- Everyone tells you to (action) but nobody actually shows you how to do it. Here's a (number) second step-by-step tutorial that you can save.
- I think I just found the biggest (niche) cheat code.
- Stop (common action) if you actually want to (dream result).
- (Action) for (period of time) and you will get (dream result).
- What if I told you, you could (action) for only (low cost).
- Here are the (number) (noun) items you need to throw in the garbage right now.
- If you're a (target audience) and you want (dream result) by (avenue), then listen to this video because you have a huge advantage and I'm going to tell you how to use it.
- If you're in your (age range), these are the (number) things you need to do so you don't end up (pain point) by (age).
- In 60 seconds I'm going to teach you more about (thing) than you've ever learned in your entire life.

<COMPARISON> — put two things side by side and let the gap sell. Wins on price, ingredients, or results contrasts.
- This is a (thing), and this is also a (thing).
- This (option) and this (option) have the same amount of (metric).
- For the price of this one (item) you could have all of these (items).
- Cheap vs expensive (thing).
- Both of these (things) are exactly the same. I haven't changed a single thing. But this one is (metric) and this one is (metric).
- A lot of people ask me what's better, (option one) or (option two), for (dream result). I got (dream result) doing one of these and it's not even close.
- This is my (thing) before (action), and this is my (thing) after.
- This group did (action) and this group didn't, and here's what happened.
- This is a (item) from (place) for (price), and this is the same (item) from (other place) for (price).

<MYTH BUSTING> — attack a belief the viewer holds. Wins when the product replaces an overpriced or overhyped habit.
- Let me de-influence you from (popular thing).
- They said "(famous cliché)". That's a lie.
- You're using your (thing) wrong, and I'm going to show you how to use it the right way.
- It's time to throw away your (item), you don't need it anymore.
- You're not bad at (action), you probably were just never taught how to (action).
- Everyone on the internet is going to tell you (result) is impossible. But I'm going to show you how to do it from home.
- This is why doing (common action) is giving you (pain point).
- No, your (pain point) is not caused by (common belief).
- Don't (action) until you've done this one thing.
- You don't have (pain point), you're not (negative label), you just need to (solution), and I'm going to tell you how to do it.
- More (target audience) need to hear this: (common belief) will not (promised result).

<STORYTELLING> — drop the viewer mid-story. Wins on relatability and open loops.
- (Number) years ago I (decision or action).
- I started (venture) when I was (age) with (small amount).
- I don't have a backup plan so this kind of needs to work.
- So I messed up.
- (Number) days into (journey), my worst nightmare became my reality.
- When I (action), people said (dismissive feedback).
- In (time frame), I went from (before state) to (after state).
- This is probably the scariest thing I've ever done.
- I got (dream result) without (expected sacrifice), here's how.
- Yesterday I was at (place) when I noticed something (adjective).
- (Number) months ago I started (action) thinking it would magically solve (pain point), but here's what actually happened.
- If you told me (number) years ago I'd be (dream result), I wouldn't have believed you.

<AUTHORITY> — lead with receipts: a transformation, a client result, or hard-earned experience. Wins on believable proof.
- My (thing) used to look like this, and now it looks like this.
- It took me (number) years to go from (before state) to (after state).
- My client got (dream result) without (pain point), and here's how.
- I've been doing pretty much the same (routine) for the past (time frame) and it's legit (result).
- I (dream result) in the past (time frame). Here's proof.
- Nobody believes me when I say I went from this to this.
- After (dream result), here's the one thing I learned the hard way so you don't have to.
- (Number) years as a (occupation) and you guys still don't believe me when I say these things.
- I became a (achievement) at (age), and if I could give you (number) pieces of advice, it would be these.
- I'm only (age or metric) but I've become one of the best (title)s in the world.

<DAY IN THE LIFE> — POV access to a routine or grind. Wins when the product lives naturally inside a day.
- Day in the life of a (title).
- Come to work with me as a (title).
- Day 1 of starting over my whole entire life.
- Day (number) of trying to (goal) by (deadline), by (method).
- We all have the same 24 hours in a day, so here I am putting my 24 hours to work.
- I'm a (age) year old (title), and I'm heading to (event).
- Welcome back to the day in the life of two (label)s trying to build the next (business).
- What I actually (do/use/eat) in a day as someone who (dream result).

<PATTERN INTERRUPT> — break the feed's rhythm with something absurd, spicy, or unexpected. Wins on pure scroll-stop.
- (Big brand) didn't want to sponsor this video, let me show you what they're missing out on.
- You're losing your (person) this week to (hobby or obsession).
- What (title)s say vs what they actually mean.
- I bought this (item) for (price) and I'm going to make it worth over (bigger price) without changing the product in any way.
- If I get this in, then I have to (forfeit).
- I'm trying a different (thing) for each letter of the alphabet.
- (Trend) is the most disgusting trend on social media.
- Do you ever (weird situation)? Yeah well, that's my job.
- (Big brand) is trying to get this video removed from the internet because it exposes their product, so watch this before it's gone.`

// Injected into the Write New script + scenes systems so every generated ad
// OPENS on a proven formula instead of an invented hook. The <FAMILY> tags are
// library labels only — the scripts must never emit them.
const HOOK_OPENING_INSTRUCTION = `THE OPENING LINE COMES FROM THE HOOK LIBRARY: build the script's first spoken line from one of the proven formulas above. Pick the family that fits this product, audience, and structure; fill the blanks with the product's real specifics; and keep the formula's COMPLETE shape — if it has a setup and a payoff clause, the opening line keeps both. A hook that stops where the payoff should be is a failed hook. Adapt the wording so it sounds like the same person speaking the rest of the script — never a bolted-on template — and never include the <FAMILY> tags in the output; they only label the library.`

const REMIX_SYSTEM = `You are an elite UGC ad script writer with the specialized skill of "Structural Adaptation". Brands pay you because your rewrites hold attention and convert WITHOUT ever sounding like marketing — they sound like a real person talking to their phone camera.

Your task is taking a winning ad script and rewriting it for a completely new product while rigorously maintaining the original script's pacing, hook style, psychological triggers, and call-to-action placement.

${HOOK_RULES}

${HUMAN_VOICE_RULES}
- Mention the product name at most twice, the casual way a person would ("so I got the X", "this thing").

${BANNED_AI_PATTERNS}

${SELF_AUDIT}

CRITICAL FORMATING RULES:
1. ONLY return the spoken dialogue.
2. Do NOT include any stage directions, timestamps, headers, bracketed text, or visual cues.
3. Do NOT use quotation marks around the text.
4. Do NOT include any introductions or conclusions (e.g., "Here is the script:").
5. Return plain text only. EACH SENTENCE MUST BE ON ITS OWN LINE (Single spaced sentence-by-sentence format).`

const REMIX_ANGLE_INSTRUCTION: Record<RemixAngle, string> = {
  'hook-led':
    'ANGLE: Lead with a punchy, pattern-interrupting hook line that stops the scroll. The first sentence must be provocative or surprising — never set up context first.',
  'pain-point-led':
    'ANGLE: Lead with the customer\'s pain point in vivid, specific terms. Make the viewer feel the problem viscerally before the product appears.',
  'curiosity-led':
    'ANGLE: Lead with a curiosity gap or counter-intuitive claim that makes the viewer need to know more. Withhold the punchline until later in the script.',
  'story-led':
    'ANGLE: Lead with a short personal story or moment ("last week I..."). Pull the viewer in with a relatable narrative, then let the product emerge naturally as the turning point.',
  'proof-led':
    'ANGLE: Lead with a concrete result, number, or before/after proof point. Open on the outcome the viewer wants, then reveal how the product delivered it.',
}

const REVERSE_ENGINEER_SYSTEM = `You are an elite UGC ad creative director. You take a comprehensive scene-by-scene blueprint of a winning ad — where the original character and the original product are described in full identifying detail — and you rewrite it so the SAME ad structure can be regenerated for a NEW product with a NEW character.

You will receive:
- A comprehensive reverse-engineered prompt for a winning UGC video ad, broken into one or more scenes (separated by "--- Scene N: <label> (MM:SS-MM:SS) ---" headers). Each scene fully describes the original character (age / gender / hair / wardrobe / etc.), the original product (label / container / colour / etc.), embedded original dialogue lines, plus setting / framing / camera / lighting / mood.
- The user's product context (name, description, target market, pain points, USPs, benefits, key specs, customer language, objections, offer, CTA).

YOUR TASK — apply these four transformations to every scene:

1. CHARACTER SWAP. Find every visual description of the original character and replace it with the literal token [CHARACTER]. Strip ALL identity markers: gender presentation, ethnicity cues, age, body type, hair (length / colour / styling), wardrobe (every garment / accessory / nails / etc.). Keep emotional state, gaze direction, body language, hand position, gesture, micro-expression — those are scene direction, not identity. Example: "a woman in her late 20s with shoulder-length auburn hair, wearing an oversized cream cable-knit sweater, looking into a bathroom mirror with a soft surprised smile" → "[CHARACTER] looks into a bathroom mirror with a soft surprised smile".

2. PRODUCT SWAP — VISUAL DIRECTION ONLY. Find every visual description of the original product and replace it with the literal token [PRODUCT]. Includes: brand name, wordmark, container shape, container colour, label, packaging, "the bottle / jar / pump / sleeve / etc." Example: "she holds a clear glass dropper bottle with a soft pink label reading 'NUDE PERFECT' close to the lens" → "she holds [PRODUCT] close to the lens". This token marks the slot for the user's reference image, so it belongs in scene direction ONLY — it is never a spoken word (see rule 3).

3. DIALOGUE REWRITE. The original spoken lines (embedded in each scene as: She says: "...", or similar) describe the original product. Rewrite them so they describe the user's product instead — pull from the user's pain points / benefits / USPs / CTA. Keep the same number of dialogue lines per scene and the same emotional beat / hook style. Refer to the product the way a real person talks: say its ACTUAL name (given in the product context) at most twice across the whole ad, and everywhere else use "this thing", "it", or the product category. NEVER put [PRODUCT], [CHARACTER], or any other bracketed token inside a spoken line — the dialogue is read aloud by a voice model, which pronounces the token literally. Keep the speaker attribution format identical (e.g. She says: "...", Voiceover: "...").

4. PRESERVE STRUCTURE. Keep the exact scene count, scene order, timestamps, durations, scene labels, camera/framing cues, lighting cues, and the "--- Scene N: <label> (MM:SS-MM:SS) ---" headers. The only fields that change are: the character description (→ [CHARACTER]), the product description (→ [PRODUCT]), and the dialogue text (→ rewritten for the user's product, naming it in plain spoken words, never a token). Light-touch adaptation of a shot's prop description is allowed ONLY when the user's product is fundamentally a different physical form than the original (e.g. dropper bottle → compact case), and only for that one prop reference — don't restructure the scene.

WHEN YOU REWRITE THE DIALOGUE, apply this voice (the rewritten lines are spoken on camera, so they must sound like a real person, never like ad copy):

${HUMAN_VOICE_RULES}

${BANNED_AI_PATTERNS}

VOICE PROFILE — at the very END of your output, AFTER the last scene, emit one labeled block:
=== VOICE PROFILE (same voice in every scene) ===
${VOICE_PROFILE_SPEC}
Anchor it to how [CHARACTER] is acting across the scenes so the read feels native to this ad.

OUTPUT FORMAT — CRITICAL:
- Start directly with the scenes. After the last scene, add a blank line, then the "=== VOICE PROFILE ... ===" block described above (it comes LAST, not first).
- Reproduce each "--- Scene N: <label> (MM:SS-MM:SS) ---" header EXACTLY as given.
- Below each header, write the rewritten scene prompt as one self-contained block — visual direction first, then the rewritten dialogue line(s) embedded inline using the same speaker-attribution pattern as the input, with the spoken words in double quotes: She says: "…". Spoken words are plain English — no tokens inside the quotes.
- In every scene, include an explicit audio direction: NO background music, NO soundtrack, NO score — only the spoken dialogue and natural ambient/diegetic sound (music is added later in editing).
- Separate scenes with a blank line.
- Do NOT include any introduction, conclusion, commentary, or markdown code fences. Plain text only.
- Do NOT use the user's brand name in the VISUAL direction — that is always [PRODUCT]. The brand name lives ONLY in spoken dialogue, at most twice across the ad.
- Do NOT describe the new character's appearance anywhere. Always use [CHARACTER].`

// ── Write New (from-scratch) mode ──
//
// The voice rules are the product here: members read these scripts out loud
// (or feed them to TTS), so anything that smells like ad copy is a failure.
// 'script' stays pure spoken words (→ Voiceovers); 'scenes' borrows the
// cinematic format's labelled-section structure and carries a VOICE PROFILE so
// every separately-generated scene clip shares one on-camera voice.

const WRITE_SCRIPT_SYSTEM = `You are a top 1% UGC creator who writes organic TikTok/Reels ad scripts. Your instincts were built by studying thousands of videos that actually went viral and actually sold product — the messy, real-person clips that hold a thumb, not polished brand ads. Brands pay you because your scripts hold attention and convert WITHOUT feeling like marketing — they sound like a real person talking to their phone camera. If a line sounds like marketing, you failed.

${HOOK_RULES}

${HOOK_LIBRARY}

${HOOK_OPENING_INSTRUCTION}

${HUMAN_VOICE_RULES}
- Mention the product name at most twice, the way a person would ("so I got the X", "this thing").

${BANNED_AI_PATTERNS}

${SELF_AUDIT}

FORMAT RULES — CRITICAL:
1. ONLY return the spoken words.
2. No stage directions, timestamps, headers, bracketed text, emojis, or visual cues.
3. No quotation marks around the text.
4. No introductions or conclusions (e.g. "Here is the script:").
5. Plain text only. EACH SENTENCE ON ITS OWN LINE.`

const WRITE_SCENES_SYSTEM = `You are an elite UGC creative director. You invent a complete scene-by-scene blueprint for a brand-new organic TikTok ad — the visuals AND the spoken dialogue — ready to be generated with AI video models (one scene = one video generation).

First write the dialogue as a real spoken script following the voice rules below, then cut the ad into scenes and embed each dialogue line in the scene where it's spoken. Each scene is directed as ONE flowing paragraph — readable prose, not a labelled shot bible.

${HOOK_RULES}
- Scene 1's visual must be a pattern interrupt, never a calm establishing shot.

${HOOK_LIBRARY}

${HOOK_OPENING_INSTRUCTION} Scene 1's spoken line is that opening hook.

${HUMAN_VOICE_RULES}
- In dialogue, name the product the way a real person would: say its ACTUAL name (given in the product context) at most twice across the whole ad, and use "this thing", "it", or the product category everywhere else. NEVER put [PRODUCT], [CHARACTER], or any other bracketed token inside a spoken line — a voice model reads the token out literally.

${BANNED_AI_PATTERNS}

VOICE PROFILE — at the very END of your output, AFTER the last scene, emit one labelled block describing the on-camera voice so every scene's clip is read by the same person:
=== VOICE PROFILE (same voice in every scene) ===
${VOICE_PROFILE_SPEC}

SCENE RULES:
- Let the creative concept decide how many scenes/shots there are, not a fixed split of the duration. If the idea is a single uninterrupted take with no cuts, that is ONE scene. A cut-heavy concept uses several. Each scene/shot can run anywhere from ~2 seconds up to the full ad length. Timestamps start at 00:00, are contiguous, and end exactly at the ad's total length.
- NEVER describe the character's identity or appearance (gender, age, ethnicity, hair, body, clothing) — always the literal token [CHARACTER]. Emotional state, gaze, gesture, and body language ARE allowed: that's scene direction, not identity.
- NEVER describe the product's physical appearance, container, label, or brand in the VISUAL direction — always the literal token [PRODUCT] there. (Dialogue is the exception: spoken lines name the product in plain words, per the rule above.)
- Each scene block is ONE flowing paragraph (2-4 sentences) — no labelled sub-fields, no SETTING:/CAMERA:/LIGHTING: prefixes. Weave into natural prose: where we are and what's visible, what [CHARACTER] physically does (exact gesture, gaze, micro-expression), the light source (naturalistic, never glam), the camera as a position only when it matters ("framed from chest height an arm's length away" — never a named device: no phone, tripod, or front camera, which get drawn into frame), and the spoken line quoted inline as: [CHARACTER] says: "...". Sound is the dialogue plus natural ambient only — explicitly NO background music, NO soundtrack, NO score (music is added later in editing).
- SHOW, DON'T TELL: while a line is spoken, [CHARACTER] is DOING or SHOWING what the line is about whenever it allows — telling while showing. Scenes without dialogue visualize their beat (the act happening, a metaphor made literal, the proof on screen) — never someone idling while the voiceover plays.

OUTPUT FORMAT — CRITICAL:
- Start directly with the scenes. After the last scene, add a blank line, then the "=== VOICE PROFILE ... ===" block (it comes LAST, not first).
- Every scene starts with a header EXACTLY in this form: --- Scene N: <short label> (MM:SS-MM:SS) ---
- Below each header, the scene's single paragraph.
- Blank line between scenes. No introduction, conclusion, commentary, or markdown code fences. Plain text only.`

const HOOKS_SYSTEM = `You are a top 1% short-form hook writer. Your instincts were built by studying 1,000 hooks that actually went viral on TikTok and Reels — you know the first line IS the video: it either stops the thumb in under 1.5 seconds or nothing else you wrote matters. Brands pay you for opening lines that stop the scroll WITHOUT sounding like an ad.

${HOOK_LIBRARY}

HOW TO USE THE FORMULAS:
- Fill every blank with THIS product's specifics — real pain points, numbers, timeframes, prices pulled from the product context. Specifics beat claims: "$30", "two weeks", "every single morning".
- Adapt the formula to the product; never template-fill robotically, and NEVER leave a "(...)" blank or placeholder in the output.
- Each hook must stand alone as the first spoken line of its own video. No warm-up, no context-setting — the most interesting beat goes first.
- USE THE FORMULA'S COMPLETE STRUCTURE. If a formula has a setup and a payoff clause ("(Big brand) didn't want to sponsor this video, let me show you what they're missing out on"), the hook keeps BOTH — a line that stops where the payoff should be ("(Big brand) didn't want to sponsor this video.") is a failed hook. The win happens in the first 3-4 words, but you never shorten a formula to get there.
- Sound like a person talking to their phone camera: contractions always (I'm, don't, it's), 6th-grade vocabulary, no emojis, no hashtags.
- Mention the brand name in at most 2 of the ${HOOK_COUNT} hooks — "this thing" or the product category is how real people talk.
- Banned hook openers (they scream "ad"): "So I've been...", "Have you ever...", "Let me tell you about...", "Introducing...", "If you struggle with...".

${BANNED_AI_PATTERNS}

SELF-AUDIT BEFORE YOU ANSWER (silently): read each hook and ask "would this stop MY thumb in 1.5 seconds?" — rewrite the weak ones. Then check every hook against its formula: does it carry the COMPLETE thought, setup and payoff both? Rewrite any line that ends mid-thought. Kill any banned sentence shape, any em-dash, any leftover blank. Make one vague hook specific.

OUTPUT FORMAT — CRITICAL:
- Return EXACTLY ${HOOK_COUNT} lines. One hook per line. Nothing else.
- Every line starts with its family tag in angle brackets, then the hook, e.g.: <MYTH BUSTING> Let me de-influence you from $80 serums.
- Valid tags: <EDUCATIONAL> <COMPARISON> <MYTH BUSTING> <STORYTELLING> <AUTHORITY> <DAY IN THE LIFE> <PATTERN INTERRUPT>
- No numbering, no blank lines, no quotation marks, no commentary, no markdown.`

async function runHooks(input: GenerateScriptInput, apiKey: string, endpoint: string): Promise<string> {
  let prompt = `The creator's brief for these hooks:\n\n${input.brief.trim()}\n\n`

  const ctxLines = productContextLines(input.productContext)
  if (ctxLines) {
    prompt += `The product being advertised:\n${ctxLines}\n\n`
  }

  if (input.additionalContext) {
    prompt += `Additional context and instructions:\n${input.additionalContext}\n\n`
  }

  const category = input.hookCategory ?? 'auto'
  prompt += category === 'auto'
    ? `CATEGORY MIX: you pick the families. Choose the ones that genuinely fit this product and audience — cover at least 4 different families across the ${HOOK_COUNT} hooks, never more than 3 hooks from any one family, and order the ${HOOK_COUNT} strongest-first.\n\n`
    : `CATEGORY LOCK: every one of the ${HOOK_COUNT} hooks must be <${HOOK_TAG[category]}>. Use a different formula from that family for each hook so the ${HOOK_COUNT} don't blur together, and order them strongest-first.\n\n`

  prompt += `Write the ${HOOK_COUNT} hooks now.`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: HOOKS_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ]

  // Hooks are spoken opening lines end to end.
  const text = await kieChatCompletions(apiKey, endpoint, messages)
  return nameSpokenTokens(text, spokenProductName(input))
}

const WRITE_STYLE_INSTRUCTION: Record<WriteStyle, string> = {
  pas: 'STRUCTURE — PROBLEM-AGITATE-SOLUTION: open by naming the viewer\'s exact pain in their own words. Spend a beat making it worse (the cost, the embarrassment, the wasted time, the stuff they already tried). Only then bring the product in as the relief. Close with the call-to-action.',
  story: 'STRUCTURE — STORY / TESTIMONIAL: first person, past tense, anchored in one small specific moment ("I genuinely almost returned this"). Arc: skeptical → tried it → specific result with a timeframe. Sound like recounting it to a friend, not pitching. Soft call-to-action.',
  listicle: 'STRUCTURE — LISTICLE: a fast "3 reasons / 3 things" list. Say the numbers out loud the way creators do ("okay one...", "two...", "and three — this is the big one..."). Each beat is punchy and concrete. Save the strongest reason for last, then a quick call-to-action.',
  callout: 'STRUCTURE — NEGATIVE / CALLOUT: open by telling the viewer to stop doing something, or that they\'re doing it wrong. Contrarian and a little spicy, but never insulting the viewer. Explain WHY the usual way fails, then pivot to the product as the smarter move.',
  curiosity: 'STRUCTURE — CURIOSITY GAP: open with a question or a "why is nobody talking about this" beat that makes the viewer NEED the answer. Withhold the actual reveal until at least a third of the way through, then pay it off with something specific.',
  'before-after': 'STRUCTURE — TRANSFORMATION: paint the "before" state vividly and specifically, mark the turning point ("then I tried..."), then the "after" with concrete results and a real timeframe. The contrast IS the pitch. Call-to-action last.',
  demo: 'STRUCTURE — UNBOXING / FIRST IMPRESSIONS: real-time reaction energy. Narrate what you notice as if experiencing it right now ("okay wait, it\'s way smaller than I thought"). Honest beats, including one tiny gripe for credibility, ending in a genuine verdict and call-to-action.',
  comparison: 'STRUCTURE — US VS THEM: what people normally use versus this. Concrete differences — price, time, result. Never name competitor brands; say "the stuff from the drugstore", "the one everyone buys". End on why switching is obvious, then the call-to-action.',
}

// Three parallel takes per generate — same style, deliberately different
// openings AND different committed angles, so the batch is a real A/B test
// instead of three flavors of one hook. Each take runs as its own LLM call
// (blind to the others), so the anchor heuristics below are what keep them
// from all converging on the same pain point.
//
// This was five. The two that got cut were the ones that doubled up: a "bold
// claim" take that landed on the same solution-aware viewer as the proof take
// while sounding more like an ad, and a "call out the viewer" take that shared
// the problem-aware slot with the confession take and kept drifting toward the
// banned "if you struggle with..." opener. What's left spans the whole
// awareness ladder — problem-aware, solution-aware, unaware — with a different
// opening device and a different anchor on each.
const WRITE_ANGLE_DISCIPLINE = `ANGLE DISCIPLINE: commit to exactly ONE pain point and the ONE benefit that pays it off — chosen from the product details per the anchor below (or inferred from the brief if no product details are given). Every line of the script drives that single idea deeper. Do NOT tour multiple pain points, stack USPs, or list benefits — a script that mentions three benefits sells none. Other product facts may appear only in service of the one idea (a spec as proof, the offer at the CTA).`

// Keep this at SCRIPT_VARIATION_COUNT entries — the batch size is derived from
// its length, so adding one here adds an LLM call per generate.
const WRITE_TAKE_INSTRUCTION: string[] = [
  `THIS TAKE: open with a specific personal confession or moment ("I did X for years before I realized..."). Anchor: the most personal, private-feeling pain point — write for a problem-aware viewer who thinks it's just them.\n${WRITE_ANGLE_DISCIPLINE}`,
  `THIS TAKE: open with a surprising number, stat, or before/after result that reframes the problem. Anchor: the most concrete, measurable benefit — write proof-first for a skeptical, solution-aware viewer.\n${WRITE_ANGLE_DISCIPLINE}`,
  `THIS TAKE: open mid-story, in the middle of a moment or a question, so the viewer is dropped straight into the action. Anchor: the most unexpected benefit or use-moment — write curiosity-first for an unaware viewer who wasn't shopping at all.\n${WRITE_ANGLE_DISCIPLINE}`,
]

// Word budgets assume ~2.4 words/sec on-camera pace, so the read time
// actually matches the length the user picked.
const WRITE_LENGTH_BUDGET: Record<WriteLength, { words: string; scenes: string }> = {
  10: { words: '20–28 words', scenes: 'usually 1-2 scenes (a single continuous shot is fine)' },
  15: { words: '30–42 words', scenes: 'usually 1-3 scenes' },
  30: { words: '62–82 words', scenes: 'usually 3-5 scenes' },
  60: { words: '125–160 words', scenes: 'usually 6-9 scenes' },
}

function formatEndTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Cinematic prompt format ──
//
// Produces ONE structured, self-contained text-to-video prompt for a single
// premium AI commercial — a multi-shot montage an AI video model (Seedance,
// Veo, Kling) renders in ONE generation. The labelled-section skeleton
// is a generic "AI commercial formula"; the model fills every section fresh
// from the user's product + brief. @INFLUENCER / @PRODUCT are reference tokens
// resolved to bank assets when the prompt is handed to Playground.
const WRITE_PROMPT_SYSTEM = `You are an elite AI video commercial director. You write ONE structured, self-contained text-to-video prompt for a single premium, cinematic brand commercial — the kind of ultra-realistic, photoreal film an AI video model (Seedance, Veo, Kling) renders as ONE generation containing multiple internal shots and cuts.

Your output is ONE prompt, organised into the exact labelled sections below, in this order. Every section is required. Write each as rich, concrete, visual direction — not marketing copy. The whole thing must describe a SINGLE coherent world, character, product, and story that stays consistent from the first frame to the last.

REFERENCE TOKENS — use these literal tokens; never invent names for them and never describe their literal appearance:
- @INFLUENCER — the on-camera character. Their real identity comes from an attached reference image. In CHARACTER, instruct the model to keep @INFLUENCER EXACTLY consistent with the reference (facial structure, skin tone, distinguishing features) — but do NOT describe what they look like yourself.
- @PRODUCT — the product. Its real packaging comes from an attached reference image. In PRODUCT FORM, instruct the model to keep @PRODUCT's packaging EXACTLY consistent with the reference. You may name the product and direct how it is held / lit / revealed, but never invent packaging details.

SECTIONS — label each in CAPS exactly as written, on its own line, then the content:
STYLE — the film's visual language: realism level, lens/film quality, colour grade, depth of field, and the prestige tone (what calibre of film it should feel like). Photoreal, premium, natural skin texture and film grain. A multi-shot montage, never one static take.
ENVIRONMENT — the single world the whole ad lives in: location, time of day, atmosphere, textures, and where the final product hero shot happens within it.
CHARACTER — who @INFLUENCER is in this world (role, world-appropriate wardrobe, emotional register) plus the consistency instruction. A serious lead, not a typical influencer.
PRODUCT FORM — how @PRODUCT appears: held at correct real-world scale in one hand, packaging consistent with the reference, how light catches it. Never oversized or awkward.
CONTEXT — the story situation: what just happened, why this moment matters, how the product reveal lands as a meaningful beat.
CORE ACTION — the beat-by-beat physical action as an arrow sequence (e.g. walks → stops → looks → reaches → reveals → holds → ends on hero shot).
ENERGY — the emotional tone of the whole piece, in a few words.
CAMERA — explicit multi-shot coverage: list the distinct shots (establishing, tracking, close-up, insert, macro reveal, hero push-in). Never one angle, never one continuous take. Describe camera movement and how framing tightens toward the reveal.
LIGHTING — naturalistic, motivated lighting for this world; no glam beauty lighting; how light catches the product and the character; mood.
PHYSICS — grounded real-world motion: weight, fabric, breath, how the product is handled, how the environment behaves. Believable throughout.
AUDIO — the diegetic soundscape (ambience, footsteps, material sounds) plus a restrained cinematic score, and the silence around the reveal.
VOICE — describe HOW @INFLUENCER sounds, in reproducible detail, so the same voice carries across every commercial: perceived age and gender of the voice, accent / region, pitch (low / mid / high), pace, texture (warm, raspy, breathy, smooth, gravelly), energy (calm, commanding, intimate), and 1-2 signature quirks. One dense paragraph you could hand to a voice actor or TTS and get the same person every time. Describe ONLY the sound, never appearance. If an influencer is named in the brief, anchor the voice to that person so it stays theirs.
VOICEOVER — ONE short, powerful ending line, then the product/brand name. Follow it with 2-3 alternate closing lines labelled "Alt:". Tight and trailer-like, never salesy. No em-dashes, no "it's not X it's Y", no rule-of-three — say the one thing that lands.
TIMELINE — the ad broken into contiguous time beats covering the full requested length (e.g. "0–3s", "3–6s", …). Each beat: one or two sentences describing the shot, what @INFLUENCER does, and where @PRODUCT appears. The final beat is the polished product hero shot, with the VOICEOVER line landing over it.

HARD RULES:
- Derive STYLE, ENVIRONMENT, and the whole concept FRESH from the user's product, brief, and audience. Do NOT reuse a generic stock world.
- Photoreal and grounded. No fantasy unless the product/brief calls for it. The product reveal must feel iconic but believable.
- Keep @INFLUENCER and @PRODUCT consistent with their references; never describe their literal appearance.
- Output ONLY the labelled prompt. No preamble, no commentary, no markdown code fences, no "Here is…".`

// Five parallel concepts per generate — deliberately different cinematic
// worlds so the cards are real alternatives, not five flavours of one idea.
// Three worlds, as far apart as the format allows: mythic scale, one quiet
// human, pure design. The cut pair were modifiers more than worlds — KINETIC
// was a pacing choice that epic and sleek can both carry, and NATURAL's warmth
// largely restated intimate. Same length rule as WRITE_TAKE_INSTRUCTION.
const WRITE_PROMPT_TAKE_INSTRUCTION: string[] = [
  'THIS CONCEPT — EPIC / GRAND: build a powerful, large-scale, atmospheric world that dramatises the product\'s core benefit as something mythic and larger than life. Wide, awe-driven, cinematic scale.',
  'THIS CONCEPT — INTIMATE / HUMAN: a quiet, real, emotionally-driven moment built around one character. The product appears as a personal ritual or a turning point. Restrained and sincere.',
  'THIS CONCEPT — SLEEK / DESIGN-FORWARD: a stylised, ultra-premium brand-film world — bold colour, striking architecture, or a surreal-but-photoreal setting. Modern, iconic, high-fashion energy.',
]

// Single-clip beat budgets. The cinematic format renders as one generation, so
// it offers the durations a video model can do in a single shot (10s / 15s /
// 30s); anything longer would need a multi-clip chain the models can't do.
const WRITE_PROMPT_BEATS: Record<number, string> = {
  10: '3–4 contiguous beats spanning 0–10s',
  15: '5 contiguous beats spanning 0–15s',
  30: '7–9 contiguous beats spanning 0–30s',
}

async function runCinematicPrompt(input: GenerateScriptInput, take: number, length: number, apiKey: string, endpoint: string): Promise<string> {
  // Use the requested length when the single-clip format supports it, else fall
  // back to 15s.
  const effLen = WRITE_PROMPT_BEATS[length] ? length : 15

  let prompt = `The creator's brief for this commercial:\n\n${input.brief.trim()}\n\n`

  // The name itself rides in with the product context below; this is only the
  // cinematic-specific directive about where to spend it.
  if (spokenProductName(input)) {
    prompt += `Name the brand in the VOICEOVER sign-off.\n\n`
  }

  const ctxLines = productContextLines(input.productContext)
  if (ctxLines) {
    prompt += `The product being advertised:\n${ctxLines}\n\n`
  }

  prompt += `${WRITE_PROMPT_TAKE_INSTRUCTION[take] ?? WRITE_PROMPT_TAKE_INSTRUCTION[0]}\n\n`

  if (input.additionalContext) {
    prompt += `Additional context and instructions:\n${input.additionalContext}\n\n`
  }

  prompt += `${lengthDiscipline(effLen as WriteLength)}\n\n`

  prompt += `LENGTH: a single ${effLen}-second commercial rendered as ONE generation with multiple internal cuts. The TIMELINE must be ${WRITE_PROMPT_BEATS[effLen]}, contiguous from 0s to ${effLen}s.\n\nWrite the full structured prompt now.`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: WRITE_PROMPT_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ]

  return kieChatCompletions(apiKey, endpoint, messages)
}

async function runWrite(input: GenerateScriptInput, take: number, apiKey: string, endpoint: string): Promise<string> {
  const style = input.writeStyle ?? 'pas'
  const format = input.writeFormat ?? 'script'
  const length = input.writeLength ?? 15
  const budget = WRITE_LENGTH_BUDGET[length]

  // Cinematic master-prompt format takes a wholly different system prompt and
  // section structure — branch out before the spoken-script path.
  if (format === 'prompt') {
    return runCinematicPrompt(input, take, length, apiKey, endpoint)
  }

  let prompt = `The creator's brief for this ad:\n\n${input.brief.trim()}\n\n`

  const ctxLines = productContextLines(input.productContext)
  if (ctxLines) {
    prompt += `The product being advertised:\n${ctxLines}\n\n`
  }

  prompt += `${WRITE_STYLE_INSTRUCTION[style]}\n\n${WRITE_TAKE_INSTRUCTION[take] ?? WRITE_TAKE_INSTRUCTION[0]}\n\n`

  if (input.additionalContext) {
    prompt += `Additional context and instructions:\n${input.additionalContext}\n\n`
  }

  prompt += `${lengthDiscipline(length)}\n\n`

  if (format === 'scenes') {
    prompt += `LENGTH: the ad is exactly ${length} seconds. Use as many scenes as the concept needs (${budget.scenes}); a single continuous shot with no cuts should be ONE scene. Keep timestamps contiguous from 00:00 to ${formatEndTimestamp(length)}. Total spoken dialogue across all scenes: ${budget.words} (so it reads aloud in ${length} seconds).\n\nWrite the scene blueprint now.`
  } else {
    prompt += `LENGTH: the script must read aloud in about ${length} seconds — write ${budget.words}. Count the words before you answer; if you're over, cut whole lines (keeping the hook and the CTA) until you're inside the range — never shorten every sentence to keep the line count.\n\nWrite the script now.`
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: format === 'scenes' ? WRITE_SCENES_SYSTEM : WRITE_SCRIPT_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ]

  // Scenes mix visual direction with speech (tokens are legitimate in the
  // former); a plain script is spoken end to end.
  const text = await kieChatCompletions(apiKey, endpoint, messages)
  return format === 'scenes'
    ? nameSpokenTokensInDialogue(text, spokenProductName(input))
    : nameSpokenTokens(text, spokenProductName(input))
}

// The name line is load-bearing, not cosmetic: every spoken-copy prompt tells
// the model to "mention the product name at most twice", so withholding it left
// the model with an instruction it couldn't follow — it filled the gap with a
// [Product Name] placeholder, which TTS and video models then read aloud.
function productContextLines(ctx?: EditableProductContext | null): string {
  if (!ctx) return ''
  const lines: string[] = []
  if (ctx.productName) lines.push(`- Product Name: ${ctx.productName}`)
  if (ctx.productDescription) lines.push(`- Product: ${ctx.productDescription}`)
  if (ctx.targetMarket) lines.push(`- Target Market: ${ctx.targetMarket}`)
  if (ctx.painPoints) lines.push(`- Pain Points: ${ctx.painPoints}`)
  if (ctx.usps) lines.push(`- USPs: ${ctx.usps}`)
  if (ctx.benefits) lines.push(`- Benefits: ${ctx.benefits}`)
  if (ctx.keySpecs) lines.push(`- Key Facts & Specs (cite these concrete specifics instead of vague claims): ${ctx.keySpecs}`)
  if (ctx.customerLanguage) lines.push(`- Customer Language (verbatim phrases real buyers use — mirror this voice in hooks and dialogue): ${ctx.customerLanguage}`)
  if (ctx.objections) lines.push(`- Objections (hesitation — counter; address the most relevant one, don't list them): ${ctx.objections}`)
  if (ctx.offer) lines.push(`- Offer: ${ctx.offer}`)
  if (ctx.cta) lines.push(`- Call-to-Action: ${ctx.cta}`)
  return lines.join('\n')
}

// ── Spoken-token guard ──
//
// [PRODUCT] / [CHARACTER] are reference-image slots for the video model, so
// they're correct in visual direction — but a token inside a spoken line gets
// pronounced literally ("bracket product bracket") by TTS and video models.
// The prompts say so; this is the deterministic backstop for when the model
// ignores them, because the failure is silent and only shows up in the audio.
const SPOKEN_TOKEN_RE = /\[(?:PRODUCT|PRODUCT[_ ]NAME|BRAND|BRAND[_ ]NAME)\]/gi

// Safe against a module-level /g regex: String.replace resets lastIndex, unlike
// .test() / .exec().
function nameSpokenTokens(text: string, productName?: string): string {
  return text.replace(SPOKEN_TOKEN_RE, productName?.trim() || 'it')
}

// Blueprints interleave visual direction with speech, so the swap is scoped to
// double-quoted text — the one place both scene formats put spoken words.
// Contractions use apostrophes, which makes double quotes an unambiguous fence.
function nameSpokenTokensInDialogue(text: string, productName?: string): string {
  return text.replace(/"[^"\n]*"/g, (quoted) => nameSpokenTokens(quoted, productName))
}

// The context name wins: it's what the prompt actually showed the model, and
// the user can edit it in the form. input.productName is the raw bank name.
function spokenProductName(input: GenerateScriptInput): string | undefined {
  return input.productContext?.productName?.trim() || input.productName?.trim()
}

async function runRemix(input: GenerateScriptInput, angle: RemixAngle, apiKey: string, endpoint: string): Promise<string> {
  let prompt = ''

  if (input.winningTranscript) {
    prompt += `Here is a winning ad transcript to use as inspiration for structure, pacing, and tone:\n\n${input.winningTranscript}\n\n`
  }

  const ctxLines = productContextLines(input.productContext)
  if (ctxLines) {
    prompt += `Write a UGC ad script for the following product. Base it on the provided product details below:\n${ctxLines}\n\n`
  } else if (input.productId) {
    prompt += `Write a UGC ad script for this product. Use the product details provided in the context.\n\n`
  } else {
    prompt += `Write a UGC ad script.\n\n`
  }

  if (input.additionalContext) {
    prompt += `Additional context and instructions:\n${input.additionalContext}\n\n`
  }

  prompt += `${REMIX_ANGLE_INSTRUCTION[angle]}\n\nGenerate the full script now.`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: REMIX_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ]

  // Plain remix output is pure spoken words, so any token anywhere is spoken.
  const text = await kieChatCompletions(apiKey, endpoint, messages)
  return nameSpokenTokens(text, spokenProductName(input))
}

async function runReverseEngineer(input: GenerateScriptInput, apiKey: string, endpoint: string): Promise<string> {
  let prompt = `Original reverse-engineered ad blueprint:\n\n${input.reversePrompt.trim()}\n\n`

  const ctxLines = productContextLines(input.productContext)
  if (ctxLines) {
    prompt += `Rewrite this blueprint for the following NEW product. Replace only the product/brand references and the [CHARACTER]'s dialogue/voiceover. Keep camera, framing, scene count, durations, and the [CHARACTER] token unchanged.\n\n${ctxLines}\n\n`
  } else if (input.productId) {
    prompt += `Rewrite this blueprint for a new product using the product details provided.\n\n`
  } else {
    prompt += `Rewrite this blueprint for a new product.\n\n`
  }

  if (input.additionalContext) {
    prompt += `Additional context and instructions:\n${input.additionalContext}\n\n`
  }

  prompt += `Generate the rewritten scene blueprint now, preserving the "--- Scene N ---" headers exactly.`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: REVERSE_ENGINEER_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ]

  const text = await kieChatCompletions(apiKey, endpoint, messages)
  return nameSpokenTokensInDialogue(text, spokenProductName(input))
}

export async function generateScript(input: GenerateScriptInput): Promise<GeneratedScript> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath(CHAT_MODEL_ID)

  if (input.mode === 'reverse-engineer') {
    const text = await runReverseEngineer(input, apiKey, endpoint)
    return { variations: [text] }
  }

  if (input.mode === 'write') {
    // Hooks: one pack of tagged one-liners, not a batch of parallel takes.
    if (input.writeFormat === 'hooks') {
      const text = await runHooks(input, apiKey, endpoint)
      return { variations: [text] }
    }
    // Batch size comes from the instruction list Cinematic vs Script/Scenes
    // will actually read, so the two can never fall out of step with it.
    const takeCount = (input.writeFormat === 'prompt' ? WRITE_PROMPT_TAKE_INSTRUCTION : WRITE_TAKE_INSTRUCTION).length
    const variations = await Promise.all(
      Array.from({ length: takeCount }, (_, take) => runWrite(input, take, apiKey, endpoint)),
    )
    return { variations }
  }

  const variations = await Promise.all(REMIX_ANGLES.map((angle) => runRemix(input, angle, apiKey, endpoint)))
  return { variations }
}

// ── Brief enhancement ──
// Rewrites the creator's rough "Describe Your Video" brief into a sharper
// creative brief for the script writer. Mirrors Playground's prompt-enhance,
// but tuned for a brief (direction) rather than a finished prompt.
const ENHANCE_BRIEF_SYSTEM = `You are a senior UGC ad strategist. You rewrite a creator's rough video brief into a clear, specific creative brief that an AI script writer can turn into a great short-form ad. You KEEP the creator's intent, angle and any product details — you never invent a different concept. You make it concrete (audience, angle, tone, key talking points, call-to-action) without padding it out.`

export async function enhanceBrief(draft: string): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath(CHAT_MODEL_ID)

  const userMessage = `Rewrite the rough video brief below into a sharper brief for writing a short-form UGC ad script. Keep the creator's intent and angle; make the target audience, tone, key talking points and call-to-action concrete.

Rules:
- Keep it a BRIEF (direction for the writer), not a finished script. A few tight sentences.
- Return ONLY the rewritten brief as plain text. No preamble, no quotes, no markdown, no "Here is".

Draft:
"""
${draft}
"""`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: ENHANCE_BRIEF_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: userMessage }] },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages)
  return responseText
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*["']|["']\s*$/g, '')
    .trim()
}
