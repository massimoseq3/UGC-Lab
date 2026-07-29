import type { GenerateScriptInput, GeneratedScript, RemixAngle, EditableProductContext, WriteStyle, WriteLength, HookCategory } from '../types'
import { HOOK_COUNT, REMIX_ANGLES, DEFAULT_VARIATION_COUNT, isVariationCount, WRITE_STYLE_META } from '../types'
import { useSettingsStore } from '../../../stores/settingsStore'
import { kieChatCompletions, type ChatMessage } from '../../../utils/kie'
import { getChatEndpointPath, CHAT_MODEL_DEFAULT } from '../../../utils/models'

// Scripts runs on the app-wide chat model. It spent a stint on the STRONG tier
// (3.6 Flash) on the theory that prose a human reads is worth ~2.6× the
// credits — the takes didn't come back visibly better, and members pay for
// every one on their own key. Back on Gemini 3 Flash.
const CHAT_MODEL_ID = CHAT_MODEL_DEFAULT

// ── Shared writing DNA ──
//
// Every mode (write / scenes / remix / reverse-engineer) sits on
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

// The voice-consistency spec. The scenes format emits this so the SAME
// on-camera voice can be reproduced across every clip in (and beyond) an ad.
// Plain spoken scripts deliberately omit it — that text is piped straight to
// Voiceovers TTS, where the voice is picked in the ElevenLabs catalog instead.
const VOICE_PROFILE_SPEC = `VOICE — describe, in rich and reproducible detail, HOW the speaker sounds, so the exact same voice can be reused across every video. Cover: the perceived age and gender of the voice, accent / region, pitch (low / mid / high), pace (slow, measured, fast), texture (warm, raspy, breathy, smooth, nasal, gravelly), energy (calm, hyped, deadpan, bubbly), and 1-2 signature quirks (uptalk, slight vocal fry, a laugh living in the voice, clipped consonants). Write it as one dense paragraph you could hand to a voice actor or a TTS engine and get the same person every single time. Describe ONLY the sound — never physical appearance.`

// Short clips drown when the model tries to cram the whole product brief in.
// This is length-tiered discipline: ≤15s = one idea, 20s = one idea with a
// supporting beat, 30s+ = room for a full arc.
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
  // 20s is the in-between the two tiers above kept missing: too long to be a
  // single hook-and-payoff, too short to survive a 30s structure squeezed down.
  if (length <= 20) {
    return `LENGTH DISCIPLINE — ${length}s IS ONE IDEA WITH ROOM TO LAND IT: still ONE angle and ONE benefit (or one pain point), but unlike a 10-15s cut you have room for ONE supporting beat between the hook and the payoff — a bit of proof, one specific detail, or the moment the problem actually bites. Do NOT use that room to add a second selling point or list features; use it to make the single idea land harder. Mention the product once, twice at most. Close on a real but brief CTA — a full spoken sentence, not a closing pitch.\n\n${CUT_LINES_NOT_LENGTH}`
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
  'objection-led':
    'ANGLE: Lead by saying out loud the exact reason someone wouldn\'t buy this — price, effort, "I\'ve tried things like this" — and then dismantle it. Name the doubt before the viewer can.',
  'comparison-led':
    'ANGLE: Lead with what the viewer is using right now and why it keeps letting them down, then position this as the switch. Never name a competitor brand — say "the one everyone buys", "the drugstore stuff".',
  'mistake-led':
    'ANGLE: Lead with a mistake the viewer is probably making without realising it. Make them recognise themselves in it, then reframe the product as what fixes the misdiagnosis.',
  'social-proof-led':
    'ANGLE: Lead with how you came across it — a friend who wouldn\'t shut up about it, a comment section, someone you trust. Let the recommendation carry the credibility before any claim does.',
  'routine-led':
    'ANGLE: Lead inside one specific moment in the day when the problem bites — a time, a place, a habit. Ground the whole script in that recurring moment and pay it off there.',
}

const REVERSE_ENGINEER_SYSTEM = `You are an elite UGC ad creative director. You take a comprehensive scene-by-scene blueprint of a winning ad — where the original character and the original product are described in full identifying detail — and you rewrite it so the SAME ad structure can be regenerated for a NEW product with a NEW character.

You will receive:
- A comprehensive reverse-engineered prompt for a winning UGC video ad, broken into one or more scenes (separated by "--- Scene N: <label> (MM:SS-MM:SS) ---" headers). Each scene fully describes the original character (age / gender / hair / wardrobe / etc.), the original product (label / container / colour / etc.), embedded original dialogue lines, plus setting / framing / camera / lighting / mood.
- The user's product context (name, description, target market, pain points, USPs, benefits, key specs, objections, offer, CTA).

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
// 'script' stays pure spoken words (→ Voiceovers); 'scenes' breaks the ad into
// labelled scene sections and carries a VOICE PROFILE so every
// separately-generated scene clip shares one on-camera voice.

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
- IF A SCENE STAGING BLOCK IS GIVEN, IT OUTRANKS THE DEFAULTS: the ad is imitating a specific kind of content (a podcast clip, a street interview, a green-screen reaction), and that only works if EVERY scene holds the staging — the location, the props, the camera position, the way the person speaks. One scene that drops back to a generic selfie-to-camera shot breaks the illusion for the whole ad.
- A staging block may put a second voice in the ad (an off-camera interviewer, someone asking from behind the lens). Attribute it on its own — An off-camera voice asks: "..." — keep it to a few words, and give that person NO identity detail and no appearance. [CHARACTER] is the only person with an identity and the VOICE PROFILE describes [CHARACTER] alone.
- A staging block may also put words on screen (a comment card, a review, a headline). Write the exact wording, keep it to a short legible line or two, and hold it inside the middle band of the frame — the top and bottom eighth are covered by the platform's own UI.

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
  objection: 'STRUCTURE — OBJECTION CRUSHER: open by saying the objection out loud, in the viewer\'s own words, before they can think it ("I know. that\'s a stupid amount of money for a [thing]"). Concede the fair part of it — never argue with the viewer. Then kill it with ONE concrete piece of arithmetic or proof: cost per use, what it replaced, how long it lasted, what you were spending before. Call-to-action only once the objection is dead.',
  founder: 'STRUCTURE — FOUNDER / BEHIND THE SCENES: first person, from the person who actually made it. Open on the frustration that caused it ("I got so sick of every [thing] doing [problem] that I just made my own"). Name ONE specific thing you changed and why it was hard or expensive to do. Be understated and a little awkward about selling — a founder who oversells reads as fake, and the restraint IS the credibility. Soft call-to-action.',
  podcast: 'FORMAT — PODCAST CLIP: this is a clip pulled from the middle of a long episode, not an ad. Start mid-answer, as if the question was asked ten seconds ago and got cut off ("...and honestly that\'s the part everyone gets wrong"). Talk to a person, not to a camera: conversational, slightly rambling, one tangent that comes back. The product comes up because it genuinely is the answer to what was being discussed — mentioned once, in passing, never presented. No pitch at the end; the closest thing to a call-to-action is "it\'ll be in the description" energy, in your own words.',
  interview: 'FORMAT — STREET INTERVIEW: someone got stopped on the street and asked one question, and this is their answer. Open with the answer already moving, reacting to the question ("honestly? this one, and it wasn\'t even close"). Unrehearsed energy: a laugh, a beat of thinking, a self-correction, a number they half-remember and correct. They are not selling to anyone — they are telling a stranger what actually worked for them. At most ONE short off-camera question at the top and one short follow-up; every other word belongs to the person answering. End on the verdict, never a pitch.',
  'green-screen': 'FORMAT — GREEN SCREEN REACTION: you are reacting on camera to something on screen behind you — a one-star review, a comment, a forum thread, a price, a headline. Open by reading the thing out loud, then react to it. Agree with the part of it that\'s fair before you take it apart; that concession is what makes the rest believable. The product enters as your answer to what\'s on screen, and you keep pointing back at it ("see this bit"). Quick call-to-action at the end.',
  reply: 'FORMAT — COMMENT REPLY: you are answering one specific question one specific person asked you. Open by saying the question back the way creators do ("someone asked me why I stopped buying [category], so"). Answer it directly and completely — this is a favour to one person, not a pitch to an audience. Include one detail only somebody who actually uses the thing would know. Close by answering the question a second time in a shorter sentence, then the call-to-action.',
  expert: 'FORMAT — EXPERT EXPLAINER: you do this for a living and you\'re giving away the thing you tell clients. Open by stating the role and the stake in one breath ("I fit these for a living and this is the mistake I see every single week"). Explain the WHY as one plain-English mechanism — no jargon, or jargon translated the instant it lands. The product is a recommendation, not a promotion: give one honest caveat about who it isn\'t for. Calm and unhurried; authority never rushes. Soft call-to-action.',
  tutorial: 'FORMAT — HOW-TO / TUTORIAL: teach one thing the viewer can do today, and the product is the tool inside step two. Open on the promise and the timeframe ("here\'s how I do [result] in under a minute"). Count the steps out loud, three at most, each one physically doable. The lesson has to be genuinely useful even if they never buy — that\'s what earns the buy. Fold the call-to-action into the last step.',
  grwm: 'FORMAT — GRWM / ROUTINE: you\'re doing the routine and the ad happens inside it. Open mid-routine, mid-task, mid-sentence, talking while your hands are busy with something else. The product shows up at the exact moment it gets used and earns one line about why it stayed in the routine. Never stop the routine to sell — the routine is the point and the sell is a byproduct. Call-to-action is an aside on the way out.',
}

// Scene staging, per FORMAT style. The instructions above shape the words;
// these shape the SHOTS, so a "Podcast Clip" blueprint actually stages a
// podcast instead of the default selfie-to-camera. Structures carry no entry on
// purpose — an argument doesn't imply a camera position, so the concept stays
// free to pick the shots. Read by the 'scenes' format here, and by B-Roll's two
// storyboard calls via sceneStagingFor — one block, so a format stages the same
// way wherever it's picked.
const WRITE_STYLE_SCENE_DIRECTION: Partial<Record<WriteStyle, string>> = {
  podcast: `SCENE STAGING — PODCAST CLIP: stage every scene as a podcast recording. [CHARACTER] sits at a table or in a studio chair with a large boom-arm microphone in frame between them and the lens, headphones on or slung round the neck, warm practical lighting, and a dressed background (acoustic panels, a shelf, a plant, a lamp). Cut between a fixed studio angle framing [CHARACTER] from the chest up and a second angle from roughly 45 degrees off to the side, so it reads as a multi-cam episode. [CHARACTER] speaks to someone just off-lens, not into the lens. A second person may sit opposite — describe them only as a listener seen from behind or half out of frame, never with any identity detail, and they never speak. [PRODUCT] sits on the table and gets picked up mid-answer, turned once, put back down; it is never held up and presented. One scene may be a tight insert of hands and [PRODUCT] on the table while the answer continues over it.`,
  interview: `SCENE STAGING — STREET INTERVIEW: stage every scene outdoors in a real public place — a pavement, a market, a park path, outside a shop — in daylight, with passers-by and traffic in the background. A handheld microphone enters frame from the edge of the shot, held by an interviewer who stays off camera; describe them only as an arm and a mic, never with identity details. The camera is handheld at eye level with a little natural drift, framing [CHARACTER] from the chest up with the street legible behind them. [CHARACTER] answers whoever is holding the mic and only glances at the lens by accident. When the interviewer speaks, write it as its own line — An off-camera voice asks: "..." — and keep it to a handful of words; the VOICE PROFILE describes [CHARACTER] only. [PRODUCT] comes out of a bag or a coat pocket at the moment it's mentioned.`,
  'green-screen': `SCENE STAGING — GREEN SCREEN REACTION: stage every scene as a green-screen reaction. [CHARACTER] stands or sits in the foreground to one side of the vertical frame; the rest of the frame is filled by the thing being reacted to, rendered as a flat on-screen graphic behind them — a review card, a comment, a forum post, a price tag, a headline. Write the on-screen wording explicitly and keep it SHORT (a line or two, large and legible) and inside the middle band of the frame, clear of the top and bottom eighth where the platform's own UI sits. [CHARACTER] gestures back at the panel, turns to look at it, reacts with their face. The graphic changes between scenes as the argument moves while the framing and the lighting stay identical, so the cuts read as one continuous take. [PRODUCT] comes up into the free hand when it enters.`,
  reply: `SCENE STAGING — COMMENT REPLY: stage every scene as a reply filmed wherever this person happens to be — a parked car, a kitchen counter, the end of a bed, a desk — framed tight and casual from chest height about an arm's length away, lit by a window or a lamp in the room. In scene 1 only, the question being answered may appear as a short comment card in the upper middle band of the frame; write its exact wording and keep it to one line. Everything after that is [CHARACTER] talking straight to the lens. Hold the same setup, wardrobe and light across every scene so it reads as one sitting. [PRODUCT] is reached for from just outside the frame when it comes up.`,
  expert: `SCENE STAGING — EXPERT EXPLAINER: stage every scene in the professional's own workplace — a treatment room, a workshop, a kitchen pass, a salon chair, a workbench — with the tools of that trade visible around them and the wardrobe of the job on. Lighting is whatever that room really has. Hold a steady, unhurried frame from chest height, and cut to tight inserts of the hands demonstrating the thing being explained. [CHARACTER] demonstrates on a real object or a real surface while talking; never a scene of someone only describing. [PRODUCT] sits among the professional tools and gets picked up as one of them.`,
  tutorial: `SCENE STAGING — HOW-TO / TUTORIAL: one scene per step, and every step is shown being done. Shoot the steps overhead or over the shoulder, on the hands and the surface, and cut back to a chest-up frame of [CHARACTER] between them. Each step scene catches the physical action in motion — the pour, the wipe, the click, the fold — with [PRODUCT] in the hands at the step where it's actually used. Leave the real clutter of the room in frame; nothing is styled or cleared. If the last step has a visible result, the final scene is a tight shot of that result.`,
  grwm: `SCENE STAGING — GRWM / ROUTINE: every scene sits inside the routine and the routine never stops. A bathroom mirror, a bedroom, a kitchen at the hour this would really happen, with the props of that hour around (a towel, a kettle, a half-packed bag). [CHARACTER] is always mid-task, hands busy, talking while doing — never standing still to deliver a line. Hold one fixed camera position they move in and out of, cut with close inserts of the task itself, and let time move forward across the scenes. [PRODUCT] enters at exactly the point in the routine it would be used, taken from wherever it lives — a shelf, a bag, a drawer.`,
}

// How a picked style stages its shots, or undefined when it stages nothing (a
// structure, or no style picked at all). B-Roll reads this so a format picked
// there shapes the storyboard's shots the same way it shapes a scene blueprint
// here — see BrollInput.sceneStaging.
export function sceneStagingFor(style: WriteStyle | null | undefined): string | undefined {
  return style ? WRITE_STYLE_SCENE_DIRECTION[style] : undefined
}

// A format style dictates HOW the ad is filmed and spoken; the take dictates
// WHICH angle it argues. They collide at the opening line — a street interview
// can't open on a stat read to camera — so this says which one bends.
const FORMAT_OVERRIDES_TAKE = `WHEN THE FORMAT AND THE TAKE DISAGREE, THE FORMAT WINS: keep the take's angle and its anchor (which pain point, which benefit, who it's written for) and deliver it through the format's own way of opening. The hook formula still supplies the SUBSTANCE of the first line, but that line is spoken the way the format speaks — mid-answer, mid-reply, mid-routine — never as a piece delivered to camera.`

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

// The creator's own words outrank the batch's angle spread. A brief that names
// the angle ("make it about the 3am feed", "push the price per use") used to be
// fought by every take's assigned anchor, which is the app arguing with the
// person using it. Read LAST in the angle block, so it beats the anchor above
// it. Shared by both batch pipelines — Write New's takes and Remix's angles
// spread the same way and have to yield the same way.
const CREATOR_ANGLE_PRECEDENCE = `WHEN THE CREATOR HAS ALREADY PICKED THE ANGLE, IT WINS: if the brief or the additional instructions name the angle to build this ad around — a specific pain point, benefit, feature, audience, story, or hook — write THAT one and drop the assigned angle above entirely. Every variation in the batch then argues the creator's angle, and this one differs from the others only in its opening device and how it gets there. You choose an angle yourself ONLY when the creator left it open, and then it must be the one assigned above.`

// Ordered STRONGEST FIRST — a generate takes the first N, so picking 3 gets the
// three best angles rather than an arbitrary three. The first three deliberately
// span the whole awareness ladder (problem-aware / solution-aware / unaware)
// with a different opening device and a different anchor on each; everything
// after widens the net without repeating one of them.
//
// `label` is that take's anchor in one phrase — it's what the OTHER takes in the
// batch are told to stay off. It lives beside the instruction it summarises so
// the two can't drift; a stale label would push a take away from a free angle.
const WRITE_TAKES: { label: string; instruction: string }[] = [
  {
    label: 'the most personal, private-feeling pain point, opened as a confession',
    instruction: `THIS TAKE: open with a specific personal confession or moment ("I did X for years before I realized..."). Anchor: the most personal, private-feeling pain point — write for a problem-aware viewer who thinks it's just them.`,
  },
  {
    label: 'the most concrete measurable benefit, opened on a number or before/after',
    instruction: `THIS TAKE: open with a surprising number, stat, or before/after result that reframes the problem. Anchor: the most concrete, measurable benefit — write proof-first for a skeptical, solution-aware viewer.`,
  },
  {
    label: 'the most unexpected benefit or use-moment, opened mid-story',
    instruction: `THIS TAKE: open mid-story, in the middle of a moment or a question, so the viewer is dropped straight into the action. Anchor: the most unexpected benefit or use-moment — write curiosity-first for an unaware viewer who wasn't shopping at all.`,
  },
  {
    label: 'the single strongest USP, opened as a bold claim',
    instruction: `THIS TAKE: open with a bold claim or hot take stated as fact. Anchor: the single strongest USP — write for a solution-aware viewer comparing options.`,
  },
  {
    label: 'the biggest objection and the benefit that answers it',
    instruction: `THIS TAKE: open by naming the exact reason someone wouldn't buy this, out loud, before defending it. Anchor: the biggest objection (price, effort, "tried something like it") and the one benefit that answers it — write for a skeptic who has already been burned.`,
  },
  {
    label: 'the most widespread everyday pain point, opened by calling the viewer out',
    instruction: `THIS TAKE: open by directly calling out the viewer ("if you [pain point], stop scrolling" energy — in your own words, not that phrase). Anchor: the most widespread everyday pain point — write for a problem-aware viewer who hasn't looked for a fix yet.`,
  },
  {
    label: 'the clearest difference from what they already use',
    instruction: `THIS TAKE: open on the thing they're using right now and why it keeps failing them — never name a competitor brand, say "the one everyone buys". Anchor: the single clearest difference (result, time, or price) — write for a viewer who thinks their current fix is fine.`,
  },
  {
    label: 'the pain point caused by a mistake the viewer is making unknowingly',
    instruction: `THIS TAKE: open on a mistake the viewer is probably making without knowing it. Anchor: the pain point that mistake causes, and the benefit that ends it — write for a problem-aware viewer who has misdiagnosed their own problem.`,
  },
  {
    label: 'the benefit worth passing on, carried by social proof',
    instruction: `THIS TAKE: open on how you found it — a friend, a comment section, someone who wouldn't shut up about it. Anchor: the benefit that made it worth passing on — write social-proof-first for an unaware viewer who trusts people over ads.`,
  },
  {
    label: 'the benefit felt inside one recurring moment of the day',
    instruction: `THIS TAKE: open inside one specific moment in the day when the problem bites — a time, a place, a routine. Anchor: the benefit felt in exactly that moment — write for a problem-aware viewer who lives that moment daily.`,
  },
]

// The angle half of a take's prompt. Takes run as parallel calls blind to each
// other, so naming what the siblings are anchored to is the only thing stopping
// a product with one obvious pain point from coming back as three near-identical
// scripts. `takeCount` is the batch size — 1 (writeOneScript) drops the clause.
function takeAngleBlock(take: number, takeCount: number): string {
  const entry = WRITE_TAKES[take] ?? WRITE_TAKES[0]
  const siblings = WRITE_TAKES.slice(0, takeCount).filter((_, i) => i !== take).map((t) => t.label)

  let block = `${entry.instruction}\n${WRITE_ANGLE_DISCIPLINE}`
  if (siblings.length) {
    block += `\nNOT YOUR ANGLE: ${takeCount} takes are being written from this brief at once, each committed to a different angle. The others are taking ${siblings.join('; ')}. Stay off theirs even if one of them looks like the stronger idea for this product — the batch is only worth generating if the ${takeCount} scripts argue ${takeCount} genuinely different things.`
  }
  return `${block}\n\n${CREATOR_ANGLE_PRECEDENCE}`
}

// Word budgets assume ~2.4 words/sec on-camera pace, so the read time
// actually matches the length the user picked.
const WRITE_LENGTH_BUDGET: Record<WriteLength, { words: string; scenes: string }> = {
  10: { words: '20–28 words', scenes: 'usually 1-2 scenes (a single continuous shot is fine)' },
  15: { words: '30–42 words', scenes: 'usually 1-3 scenes' },
  20: { words: '42–56 words', scenes: 'usually 2-4 scenes' },
  30: { words: '62–82 words', scenes: 'usually 3-5 scenes' },
  60: { words: '125–160 words', scenes: 'usually 6-9 scenes' },
}

function formatEndTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

async function runWrite(input: GenerateScriptInput, take: number, takeCount: number, apiKey: string, endpoint: string): Promise<string> {
  const style = input.writeStyle ?? 'pas'
  const format = input.writeFormat ?? 'script'
  const length = input.writeLength ?? 15
  const budget = WRITE_LENGTH_BUDGET[length]

  let prompt = `The creator's brief for this ad:\n\n${input.brief.trim()}\n\n`

  const ctxLines = productContextLines(input.productContext)
  if (ctxLines) {
    prompt += `The product being advertised:\n${ctxLines}\n\n`
  }

  prompt += `${WRITE_STYLE_INSTRUCTION[style]}\n\n`

  // Formats also stage the shots — but only the blueprint has shots to stage.
  const staging = format === 'scenes' ? WRITE_STYLE_SCENE_DIRECTION[style] : undefined
  if (staging) prompt += `${staging}\n\n`

  prompt += `${takeAngleBlock(take, takeCount)}\n\n`

  if (WRITE_STYLE_META[style].group === 'format') prompt += `${FORMAT_OVERRIDES_TAKE}\n\n`

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

  prompt += `${REMIX_ANGLE_INSTRUCTION[angle]}\n\n${CREATOR_ANGLE_PRECEDENCE}\n\n`

  // No target length means the 'default' pick: the remix inherits the source
  // ad's pacing, which is the whole point of remixing a winner. A picked length
  // re-cuts it, and the word budget is what actually makes that land.
  const length = input.remixLength
  if (length) {
    const budget = WRITE_LENGTH_BUDGET[length]
    prompt += `${lengthDiscipline(length)}\n\nLENGTH: this remix must read aloud in about ${length} seconds — write ${budget.words}, regardless of how long the source script is. Keep the source's hook style, structure and CTA placement; drop whole beats from the middle to fit. Count the words before you answer.\n\n`
  }

  prompt += `Generate the full script now.`

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

// The batch size for this generate. Sanitised here rather than trusted, since
// the value round-trips through a persisted draft and a history row.
function requestedCount(input: GenerateScriptInput): number {
  return isVariationCount(input.variationCount) ? input.variationCount : DEFAULT_VARIATION_COUNT
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
    // Clamped to the take-angle list, so a count can never index past it and
    // repeat an angle.
    const takeCount = Math.min(requestedCount(input), WRITE_TAKES.length)
    const variations = await Promise.all(
      Array.from({ length: takeCount }, (_, take) => runWrite(input, take, takeCount, apiKey, endpoint)),
    )
    return { variations }
  }

  const angles = REMIX_ANGLES.slice(0, Math.min(requestedCount(input), REMIX_ANGLES.length))
  const variations = await Promise.all(angles.map((angle) => runRemix(input, angle, apiKey, endpoint)))
  return { variations, angles }
}

// ONE spoken script from a brief + style + length — the strongest take, not a
// batch. B-Roll calls this when the member has no script yet: it writes one,
// drops it in the script box, and storyboards it in the same click. Everything
// (the human-voice rules, the hook library, the style instruction, the length
// budget) is the same pipeline Scripts' Write New runs, so a script written in
// B-Roll is the same script Scripts would have written.
export async function writeOneScript(input: GenerateScriptInput): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath(CHAT_MODEL_ID)
  // Take 0 is the strongest angle in the list (see WRITE_TAKES). Batch size 1 —
  // there are no siblings to steer away from.
  return runWrite({ ...input, mode: 'write', writeFormat: 'script' }, 0, 1, apiKey, endpoint)
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
