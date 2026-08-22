import type { GenerateScriptInput, GeneratedScript, RemixAngle, EditableProductContext, WriteStyle, WriteLength, HookCategory } from '../types'
import { REMIX_ANGLES, DEFAULT_VARIATION_COUNT, isVariationCount, DEFAULT_HOOK_COUNT, isHookCount, WRITE_STYLE_META } from '../types'
import { useSettingsStore, resolveScriptModel } from '../../../stores/settingsStore'
import { kieChatCompletions, LONG_CHAT_TIMEOUT_MS, type ChatMessage } from '../../../utils/kie'
import { getChatTarget, type ChatTarget } from '../../../utils/models'
import { exemplarBlock, familiesForWriteStyle } from './exemplarBlock'
import { VOICE_PROFILE_SPEC } from '../../../utils/voiceProfile'

// Scripts is one of the two apps where the MEMBER picks the writer (the other
// is B-Roll) — this is prose a person reads, so the intelligence/cost trade is
// theirs to make, on their own key. Resolved per call rather than at module
// scope so a pick made mid-session applies to the next Generate.
// Unpicked, it resolves to the app-wide default and costs what it always did.
function scriptModel(): ChatTarget {
  return getChatTarget(resolveScriptModel('script-architect'))
}

// A batch fires N of these calls at once, so they contend with each other and a
// take routinely runs past kieChatCompletions' 120s default — which aborts the
// request client-side while kie.ai finishes the generation anyway and bills for
// it. Shared with B-Roll's storyboard calls, which hit the same wall for the
// same reason; the why lives on LONG_CHAT_TIMEOUT_MS.
const SCRIPT_TIMEOUT_MS = LONG_CHAT_TIMEOUT_MS

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
- Specifics beat claims. Tiny concrete details make it believable — a named object, an exact action, a real timeframe or price ("the lid never sat right", "every single morning", "two weeks", "$30"). Reach for the concrete detail before the digit; see the numbers rule below.
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

// ── What the transcript corpus actually supports ──
//
// Derived from 872 transcribed high-performing Instagram videos (the same
// "1,000 Viral Hooks" swipe file HOOK_LIBRARY is built from, except the videos
// behind the hooks were fetched and transcribed). Three features separate the
// top of that set from the bottom, each surviving a permutation test on the
// extremes, a whole-corpus rank correlation, AND a within-category control:
// digit density in the hook (rho -0.14), digit density in the body (-0.13),
// and first-person density (-0.09).
//
// They are framed as TIEBREAKERS on purpose. Every video measured was already
// a hand-picked outlier, so this compares winners against other winners: a
// number-led hook is not a mistake, it is just not the lever. Writing these as
// bans would be over-reading the data.
//
// Note what is deliberately NOT here. The sentence-level claims that circulate
// with this dataset — short bursty sentences, low connective density, no
// setup sentences, heavy contractions — were all tested and NONE replicated
// (connective and setup rates actually ran higher in the winners). The voice
// rules above stay as they are because they are about sounding human, which an
// all-human corpus has no power to test either way; they were simply never
// evidence from this data, and nothing here should be dressed up as if it were.
const CORPUS_EVIDENCE = `WHAT SEPARATES THE BIGGEST WINNERS FROM THE MERELY VIRAL — three measured tendencies, not laws. Every video these were measured on already went viral, including the ones that break them, so treat each as a tiebreaker when two lines both work:

1. QUOTE FEWER FIGURES — AND SPELLING ONE OUT IS NOT CUTTING IT. Numbers are allowed anywhere, including the first line: plenty of winners open on one. But the weaker performers quote more of them all the way through, and the fix is to quote fewer FACTS, not to write the same facts differently. "Twenty four pounds" is the same figure as "24 pounds" and counts exactly the same; changing the spelling changes nothing. So count the distinct figures in what you have written — prices, durations, quantities, timeframes, percentages. Cut the ones doing no work, and never manufacture one to sound specific. Where a figure genuinely IS the story ("it took me 10 years", "I found $10 in this jacket"), lead with it and write it however it reads best out loud. Everywhere else take your specificity from concrete nouns, named objects and exact actions instead — "the cheap one from the chemist", "every morning before work", "the lid never sat right" — which is specificity without a figure at all.

2. TALK ABOUT THE THING, NOT ABOUT YOURSELF. The strongest performers run noticeably lower on "I / me / my" than the weaker ones. Wherever a line could be about the product, the viewer, or what is happening on screen instead of about you, make it about that. This is a density steer, NOT a ban: it never overrides a first-person structure — a founder story or a testimonial is first person by definition. Just keep the camera on the thing rather than on the narrator wherever the line allows it.

3. GET TO THE INSTRUCTION SOONER. Winners reach their first concrete imperative — the thing the viewer should do, look at, or notice — earlier, and use more of them across the whole script. Fewer sentences describing what is coming, more sentences telling them what is happening.`

const HOOK_RULES = `THE HOOK IS 80% OF THE JOB:
- The first line is the entire video. Write it to win in under 1.5 seconds of speech, in the first 3-4 words.
- Enter mid-thought, mid-story, or mid-reaction. Never warm up, never set up context. The most interesting beat goes FIRST; you explain later.
- Banned hook openers (they scream "ad"): "So I've been...", "Have you ever...", "Let me tell you about...", "Introducing...", "If you struggle with...".
- Open a loop in or near the hook that only pays off later, so they keep watching to the end.`

const SELF_AUDIT = `SELF-AUDIT BEFORE YOU ANSWER (do this silently; output ONLY the final result):
1. Read the hook. Does it win in 3-4 words with no warm-up? If not, rewrite it.
1b. Read the hook against the HOOK CONTRACT in the brief. Does it establish what that structure or format needs established, so a viewer knows from the first line what kind of video this is? If it names a count of anything, does the body deliver exactly that many, counted out loud? If either answer is no, rewrite the hook — or the body — until they agree.
2. Scan every line for the 6 banned sentence shapes and any em-dash. Kill them.
3. Check rhythm: if 3+ sentences in a row are the same length, break one.
4. Find one vague claim and make it specific. Find one oversell and undersell it.
5. Read the whole thing out loud in your head. Any line you wouldn't actually say to a friend gets rewritten or cut.`

// The voice-consistency spec (shared — see utils/voiceProfile.ts). The scenes
// format emits this so the SAME on-camera voice can be reproduced across every
// clip in (and beyond) an ad. Plain spoken scripts deliberately omit it — that
// text is piped straight to Voiceovers TTS, where the voice is picked from the
// Gemini catalog instead.

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
  'curiosity-gap': 'CURIOSITY GAP',
  educational: 'EDUCATIONAL',
  comparison: 'COMPARISON',
  'myth-busting': 'MYTH BUSTING',
  storytelling: 'STORYTELLING',
  authority: 'AUTHORITY',
  'day-in-the-life': 'DAY IN THE LIFE',
  'pattern-interrupt': 'PATTERN INTERRUPT',
}

const HOOK_LIBRARY = `THE 8 HOOK FAMILIES AND THEIR PROVEN FORMULAS — every "(...)" is a blank you fill with THIS product's specifics. Each formula is a COMPLETE thought: if it has a setup and a payoff clause, both parts are the formula — never use half of one.

<CURIOSITY GAP> — name a SPECIFIC familiar thing whose inside, cause or outcome the viewer cannot guess, and withhold it. The specificity is the whole mechanism: "let's see what's inside Monster Energy" works, "you won't believe what's inside this drink" does not. Never tease vaguely; always name the actual thing.
- Let's see what's actually inside (specific named thing).
- If you (common thing they do with this category), stop what you're doing and watch this.
- Before you ever (action) for the first time, you need to see this.
- I think I just found the biggest (niche) cheat code.
- Nobody talks about what (everyday habit) is actually doing to your (thing).
- There's a reason (specific familiar thing) (surprising outcome), and nobody tells you what it is.
- I opened up (specific named item) to see what you're actually paying for.
- This is the part of (familiar process) that nobody shows you.
- (Specific named thing) has one (ingredient/part/setting) in it that I need to talk about.
- You've used (specific common item) a thousand times and never seen this side of it.
- I always wondered why (specific familiar thing) (odd behaviour). Turns out there's a reason.

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
const HOOK_OPENING_INSTRUCTION = `THE OPENING LINE COMES FROM THE HOOK LIBRARY: build the script's first spoken line from one of the proven formulas above. Fill the blanks with the product's real specifics, and keep the formula's COMPLETE shape — if it has a setup and a payoff clause, the opening line keeps both. A hook that stops where the payoff should be is a failed hook. Adapt the wording so it sounds like the same person speaking the rest of the script — never a bolted-on template — and never include the <FAMILY> tags in the output; they only label the library.

WHICH FORMULA YOU PICK IS DECIDED BY THE HOOK CONTRACT IN THE BRIEF, NOT BY YOU: the brief names the script's structure or format and states what its opening line has to establish. The library supplies HOW the line is said; the contract decides WHAT it says. Work backwards from the contract — go and find the formula that can carry it and fill that one. If no formula in the library can, write the line the contract asks for in the library's register and drop the formula: an opening line that leaves the viewer expecting a different video than the one you wrote is a failed hook no matter how well it reads on its own.`

// ── Remix: the source-fidelity contract ──
//
// A remix is an ADAPTATION, and the app kept producing fresh scripts because
// nothing here made that structural. "Rigorously maintain the original's
// pacing" was asserted once and given no mechanism, while three other blocks
// actively pulled the other way: HOOK_RULES ("write it to win in 3-4 words"),
// SELF_AUDIT step 1 ("if the hook doesn't win, rewrite it") and every angle's
// "Lead with X" all told the model to design its own opening — which is the one
// thing a remix inherits. So the hook rules and the self-audit are remix-specific
// here, the angles pick CONTENT rather than structure (see the block above
// REMIX_ANGLE_INSTRUCTION), and this contract gives the model the missing
// mechanism: map the source into beats first, then write against that map.
const REMIX_SOURCE_FIDELITY = `HOW A REMIX WORKS — THIS IS AN ADAPTATION, NOT A NEW SCRIPT:
The source script you are given is a proven winner. Its STRUCTURE is the thing being reused, so you don't get to redesign it. You are swapping a new product into a machine that already works.

FIRST, silently map the source into its beats, in order: what the first line DOES (a confession, a number, a question, a callout, a mid-story drop, reading something out loud), then what each following line does (agitate, reveal, prove, handle an objection, demo, close), where the product first appears, where the script turns, and where the CTA lands and how hard it asks.

THEN write the new script beat for beat against that map:
- SAME BEATS, SAME ORDER, SAME COUNT. One source beat in, one new beat out. Don't add beats the source doesn't have, don't merge two of its beats into one, don't reorder them.
- SAME OPENING DEVICE. Whatever the source's first line does, your first line does the same thing with this product's material. You copy the SHAPE, never the words.
- SAME RHYTHM AND LINE LENGTHS. If a source line is three words, its replacement is about three words. The pacing is a big part of why this ad won.
- SAME TURN, SAME CTA PLACEMENT. The product enters at the same point in the script, and the call-to-action sits in the same position with the same energy (hard ask, throwaway aside, or no ask at all).
- SAME SPEAKER. Keep the source's point of view (I / you / we), its tense, and how casual or unhinged the person talking is.
- Where these rules and the voice rules below disagree about rhythm or line count, THE SOURCE WINS. The voice rules govern word choice, not shape.

WHAT DOES CHANGE — every product-specific fact. The pain point, the benefit, the proof, the numbers, the price, the category, the product name, the objection, the offer and the CTA wording all come from the NEW product's details. Nothing about the source's product, brand or category survives; never mention or imply it.

A remix that reads like a fresh script written off the product brief is a FAILURE, even if it's a good script. Someone should be able to lay your script next to the source and see the same skeleton.`

// A remix's hook is inherited — the source's opening is precisely why the ad is
// being remixed. This replaces HOOK_RULES in this pipeline (which teaches the
// model to design a hook from scratch) and keeps only the half that's still
// true: the openers that scream "ad", and the open loop.
const REMIX_HOOK_RULES = `THE HOOK IS INHERITED, NOT INVENTED: the source's first line already won — that's the whole reason this ad is being remixed. Keep its device, its shape and roughly its word count, and refill it with this product's specifics. Do NOT "improve" it into a different kind of hook, and do NOT put a warm-up in front of it. If the source opens a loop that pays off later, your version opens the same loop and pays it off in the same place. The only openers that are off-limits no matter what the source did: "So I've been...", "Have you ever...", "Let me tell you about...", "Introducing...", "If you struggle with...".`

const REMIX_SELF_AUDIT = `SELF-AUDIT BEFORE YOU ANSWER (do this silently; output ONLY the final script):
1. Lay your script next to the source, beat for beat. Same count, same order, same job per beat? Rewrite any beat that drifted.
2. Does your first line DO what the source's first line does? If you invented a different kind of hook, replace it.
3. Is the CTA in the same position, asking about as hard as the source's?
4. Did any of the SOURCE's product, brand, category or specifics survive? Cut them — every fact comes from the new product.
5. Scan every line for the 6 banned sentence shapes and any em-dash. Kill them.
6. Read it out loud in your head. Any line you wouldn't actually say to a friend gets rewritten.`

const REMIX_SYSTEM = `You are an elite UGC ad script writer with the specialized skill of "Structural Adaptation". Brands pay you because your rewrites hold attention and convert WITHOUT ever sounding like marketing — they sound like a real person talking to their phone camera.

Your task is taking a winning ad script and rewriting it for a completely new product while rigorously maintaining the original script's beats, pacing, hook device, psychological triggers, and call-to-action placement.

${REMIX_SOURCE_FIDELITY}

${REMIX_HOOK_RULES}

${HUMAN_VOICE_RULES}
- Mention the product name at most twice, the casual way a person would ("so I got the X", "this thing").

${BANNED_AI_PATTERNS}

${REMIX_SELF_AUDIT}

CRITICAL FORMATTING RULES:
1. ONLY return the spoken dialogue.
2. Do NOT include any stage directions, timestamps, headers, bracketed text, or visual cues.
3. Do NOT use quotation marks around the text.
4. Do NOT include any introductions or conclusions (e.g., "Here is the script:").
5. Return plain text only. EACH SENTENCE MUST BE ON ITS OWN LINE (Single spaced sentence-by-sentence format).`

// What a variation ARGUES, never how it's built. Each of these used to open
// "Lead with…", which is a structural instruction — and since a batch is N
// parallel calls each carrying a different one, the three defaults told three
// takes to design three different openings, throwing away the source's hook
// every time. A remix's opening device belongs to the source; the angle only
// decides which of the product's material fills the beats.
const REMIX_ANGLE_INSTRUCTION: Record<RemixAngle, string> = {
  'hook-led':
    'ANGLE: play the source\'s own opening device as hard as it will go — the most provocative, scroll-stopping fill for it this product allows — and keep that pattern-interrupting energy running through the beats that follow.',
  'pain-point-led':
    'ANGLE: build this variation on the customer\'s sharpest pain point, in vivid specific terms. Spend the source\'s beats making the viewer feel the problem, and let the product read as the relief at the point the source lets it in.',
  'curiosity-led':
    'ANGLE: build this variation on a curiosity gap or counter-intuitive claim about the product. Whatever the source withholds, you withhold too — the payoff lands at the source\'s own reveal beat, never earlier.',
  'story-led':
    'ANGLE: build this variation on one small personal moment ("last week I..."). Fit that story to the source\'s beats and let the product be the turning point exactly where the source turns.',
  'proof-led':
    'ANGLE: build this variation on a concrete result, number, or before/after proof point. The outcome the viewer wants carries whichever beats the source uses for its strongest claims.',
  'objection-led':
    'ANGLE: build this variation on the exact reason someone wouldn\'t buy this — price, effort, "I\'ve tried things like this" — said out loud and then dismantled inside the source\'s beats. Name the doubt before the viewer can.',
  'comparison-led':
    'ANGLE: build this variation on what the viewer is using right now and why it keeps letting them down, with this as the switch. Never name a competitor brand — say "the one everyone buys", "the drugstore stuff".',
  'mistake-led':
    'ANGLE: build this variation on a mistake the viewer is probably making without realising it. Make them recognise themselves in it, then reframe the product as what fixes the misdiagnosis.',
  'social-proof-led':
    'ANGLE: build this variation on how you came across it — a friend who wouldn\'t shut up about it, a comment section, someone you trust. Let the recommendation carry the credibility before any claim does.',
  'routine-led':
    'ANGLE: build this variation on one specific moment in the day when the problem bites — a time, a place, a habit. Ground it there and pay it off there.',
}

// The angle block's frame. Without it, a bare "ANGLE: build this on the
// customer's pain point" still reads as licence to restructure — this is what
// scopes it to content and re-states that the shape belongs to the source.
const REMIX_ANGLE_FRAME = `THE ANGLE BELOW DECIDES WHAT THIS VARIATION ARGUES, NEVER HOW IT'S BUILT. Several variations are being written off this same source at once, each filling the source's beats with a different angle from the product's details. The structure, the opening device, the pacing and the CTA placement are the source's in every one of them — the angle is what changes.`

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

${CORPUS_EVIDENCE}

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

${CORPUS_EVIDENCE}

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

// The batch size is user-picked, so the contract that names it ("return EXACTLY
// N lines") has to be built per call rather than sit at module scope.
const hooksSystem = (count: number) => `You are a top 1% short-form hook writer. Your instincts were built by studying 1,000 hooks that actually went viral on TikTok and Reels — you know the first line IS the video: it either stops the thumb in under 1.5 seconds or nothing else you wrote matters. Brands pay you for opening lines that stop the scroll WITHOUT sounding like an ad.

${HOOK_LIBRARY}

HOW TO USE THE FORMULAS:
- Fill every blank with THIS product's specifics — real pain points, named objects, exact actions, timeframes and prices pulled from the product context. Specifics beat claims: "every single morning", "the cheap one from the chemist", "two weeks", "$30". A blank that asks for a number does not have to be filled with one if a concrete detail says it better — see the numbers rule below.
- Adapt the formula to the product; never template-fill robotically, and NEVER leave a "(...)" blank or placeholder in the output.
- Each hook must stand alone as the first spoken line of its own video. No warm-up, no context-setting — the most interesting beat goes first.
- USE THE FORMULA'S COMPLETE STRUCTURE. If a formula has a setup and a payoff clause ("(Big brand) didn't want to sponsor this video, let me show you what they're missing out on"), the hook keeps BOTH — a line that stops where the payoff should be ("(Big brand) didn't want to sponsor this video.") is a failed hook. The win happens in the first 3-4 words, but you never shorten a formula to get there.
- Sound like a person talking to their phone camera: contractions always (I'm, don't, it's), 6th-grade vocabulary, no emojis, no hashtags.
- Mention the brand name in at most 2 of the ${count} hooks — "this thing" or the product category is how real people talk.
- Banned hook openers (they scream "ad"): "So I've been...", "Have you ever...", "Let me tell you about...", "Introducing...", "If you struggle with...".

${BANNED_AI_PATTERNS}

${CORPUS_EVIDENCE}

SELF-AUDIT BEFORE YOU ANSWER (silently): read each hook and ask "would this stop MY thumb in 1.5 seconds?" — rewrite the weak ones. Then check every hook against its formula: does it carry the COMPLETE thought, setup and payoff both? Rewrite any line that ends mid-thought. Kill any banned sentence shape, any em-dash, any leftover blank. Make one vague hook specific.

OUTPUT FORMAT — CRITICAL:
- Return EXACTLY ${count} lines. One hook per line. Nothing else.
- Every line starts with its family tag in angle brackets, then the hook, e.g.: <MYTH BUSTING> Let me de-influence you from $80 serums.
- Valid tags: <CURIOSITY GAP> <EDUCATIONAL> <COMPARISON> <MYTH BUSTING> <STORYTELLING> <AUTHORITY> <DAY IN THE LIFE> <PATTERN INTERRUPT>
- No numbering, no blank lines, no quotation marks, no commentary, no markdown.`

// Attaching a bank product is optional in both modes: a member who has
// described the product in the brief or the instructions shouldn't have to bank
// it first just to generate. Every spoken-copy system prompt tells the model to
// "mention the product name at most twice (given in the product context)", so
// when there IS no product context that instruction has nothing to point at —
// and the observed failure is a [Product Name] placeholder read aloud by TTS,
// or a brand invented out of thin air and put in a member's ad.
const NO_PRODUCT_DETAILS = `NO PRODUCT DETAILS ARE ATTACHED: the brief above is all you have, so take the product, the audience and the specifics from it. Where the brief leaves something unsaid, keep it general instead of inventing it — never make up a brand name, a price, or a statistic. If the brief never names the product, call it what it is ("this thing", or its plain category) and never write a bracketed placeholder like [Product Name]; those get read out loud word for word by the voice model.`

async function runHooks(input: GenerateScriptInput, apiKey: string, endpoint: ChatTarget): Promise<string> {
  // Sanitised like the take count — it round-trips through a persisted draft
  // and a history row.
  const count = isHookCount(input.hookCount) ? input.hookCount : DEFAULT_HOOK_COUNT
  // The spread rules scale with the pack. "At least 4 families, never more than
  // 3 from one" was written for ten hooks; on a pack of five it demands almost
  // one family per line, and on twenty it lets the pack blur.
  const minFamilies = Math.min(8, Math.max(3, Math.ceil(count / 3)))
  const maxPerFamily = Math.max(2, Math.round(count * 0.3))
  let prompt = `The creator's brief for these hooks:\n\n${input.brief.trim()}\n\n`

  const ctxLines = productContextLines(input.productContext)
  if (ctxLines) {
    prompt += `The product being advertised:\n${ctxLines}\n\n`
  } else {
    // Same rule as the script pipelines, and it bites harder here: the hooks
    // system prompt caps brand mentions at 2 of N and every formula is a
    // fill-in-the-blank, so with no product context the blanks come back as
    // literal "(...)" or an invented brand.
    prompt += `${NO_PRODUCT_DETAILS}\n\n`
  }

  if (input.additionalContext) {
    prompt += `Additional context and instructions:\n${input.additionalContext}\n\n`
  }

  const category = input.hookCategory ?? 'auto'
  prompt += category === 'auto'
    ? `CATEGORY MIX: you pick the families. Choose the ones that genuinely fit this product and audience — cover at least ${minFamilies} different families across the ${count} hooks, never more than ${maxPerFamily} hooks from any one family, and order the ${count} strongest-first.\n\n`
    : `CATEGORY LOCK: every one of the ${count} hooks must be <${HOOK_TAG[category]}>. Use a different formula from that family for each hook so the ${count} don't blur together, and order them strongest-first.\n\n`

  // NO CALIBRATION BLOCK HERE, deliberately — measured, not assumed. Hooks got
  // the same exemplar injection Write New gets, and an A/B on one brief (50
  // hooks per arm, same model) showed it did nothing: mean similarity to the
  // library's own formulas went UP, 0.72 -> 0.76, with near-verbatim fills
  // rising from 74% to 82%. The reason is structural. This system prompt IS a
  // fill-in-the-blanks contract — every formula is a template and the rules
  // above tell the model to fill every blank — so a "here's how real speech
  // sounds" block can't compete with it and shouldn't be expected to. Write New
  // is the opposite shape (the library seeds only the opening line, the rest of
  // the script is free) and there the same block measurably worked: opener
  // similarity fell 0.59 -> 0.44. Adding it back here costs ~850 tokens a call
  // and buys nothing; if hook originality is ever the goal, loosen the
  // fill-the-blanks contract first, then re-test.
  prompt += `Write the ${count} hooks now.`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: hooksSystem(count) }] },
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ]

  // Hooks are spoken opening lines end to end.
  const text = await kieChatCompletions(apiKey, endpoint, messages, { timeoutMs: SCRIPT_TIMEOUT_MS })
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

// ── The hook contract, per style ──
//
// A style instruction describes the whole script, and the model read it as
// something the BODY does: pick "3 Reasons" and the takes came back with three
// counted reasons under an opening line that never mentioned a list, so the
// viewer met a listicle they were never told to expect. The hook library is the
// other half of the cause — it is 8 families of generic openers, and nothing
// tied the family it hands over to the structure the member picked.
//
// So each style states what its FIRST LINE has to establish, and that is what
// picks the formula (see HOOK_OPENING_INSTRUCTION). One line each, describing
// the job rather than dictating wording: a fixed opener per style would make
// every take of that style start the same way, which is the one thing this app
// spends three parallel takes avoiding.
//
// The counting clause on `listicle` and `tutorial` is deliberate and belongs to
// the hook, not the body — a hook that promises three and a body that delivers
// four is the same broken promise as a hook that promises nothing.
const WRITE_STYLE_HOOK_CONTRACT: Record<WriteStyle, string> = {
  pas: 'the pain itself, in the viewer\'s own words, with no product and no promise of relief yet. They have to recognise their own problem in the first line, not be told a solution exists.',
  story: 'that this already happened to you. First person, past tense, dropped into one specific moment — never a claim about the product and never a preamble about being about to tell a story.',
  listicle: 'that this is a counted list, and the count. The viewer must know before reason one lands that they are getting "3 reasons" / "3 things" (or whatever count you name), and that the number is worth staying for. Say the count in the first line, then deliver EXACTLY that many, counted out loud in order, strongest last. A first line that opens on one reason as though it were the whole video is a failed hook here.',
  callout: 'the thing they should stop doing. The first line is the instruction or the accusation itself, aimed at the habit and never at the viewer, so they know immediately they are being argued with.',
  curiosity: 'a specific named thing and the gap. Name the actual thing, withhold the answer, and make the withheld part something the rest of the script genuinely pays off.',
  'before-after': 'that a change is the subject. Either stand inside the "before" so plainly it stings, or name the change and its timeframe up front — the viewer has to know a transformation is coming.',
  demo: 'that this is happening right now, in your hands. Present tense, first reaction, to a thing you are physically holding or opening — never a retrospective verdict.',
  comparison: 'that two things are being put side by side. Both sides land in the first line, so the viewer knows a comparison is running before either one is judged.',
  objection: 'the objection, said out loud in the viewer\'s own words before they can think it. The first line is their doubt, not your answer.',
  founder: 'that you made the thing. Say it in the first line, plainly and a little reluctantly — that is the whole reason this ad is believed, and it stops being a founder story if it arrives late.',
  podcast: 'that the viewer has walked in on the middle of an answer. Start mid-sentence on a question that was never heard, so the line reads as a clip rather than an opening.',
  interview: 'that this is an answer given to someone holding a mic. Open already reacting to the question, unrehearsed, to a person and not to the lens.',
  'green-screen': 'what is on the screen behind you. Read it out loud first — the review, the comment, the price, the headline — so the reaction has something to be a reaction to.',
  reply: 'that one specific person asked one specific question. Say the question back in the first line; the viewer must know they are watching a reply.',
  expert: 'the job and the stake, in one breath. What you do for a living, and the thing you see people get wrong, so the authority is established before any advice arrives.',
  tutorial: 'the promise and the timeframe — what the viewer will be able to do by the end, and roughly how long it takes. If the first line names a number of steps, count exactly that many out loud in the body.',
  grwm: 'that the routine is already underway. Mid-task, hands busy, talking over what you are doing — never stopping to introduce the video.',
}

// The style's line, then what its hook owes the viewer. Kept as one block so a
// style is read as one instruction rather than a rule about the body and a
// separate rule about the first line, which is exactly how they came apart.
function styleBlock(style: WriteStyle): string {
  return `${WRITE_STYLE_INSTRUCTION[style]}\n\nHOOK CONTRACT — WHAT THIS ${WRITE_STYLE_META[style].group === 'format' ? 'FORMAT' : 'STRUCTURE'}'S FIRST SPOKEN LINE MUST ESTABLISH: ${WRITE_STYLE_HOOK_CONTRACT[style]}\n\nThe first line is a promise about the rest of the video, and the script has to keep it. A viewer who is told what kind of video this is and then gets a different one bounces harder than one who was never told anything.`
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
const FORMAT_OVERRIDES_TAKE = `WHEN THE FORMAT AND THE TAKE DISAGREE, THE FORMAT WINS: keep the take's angle and its anchor (which pain point, which benefit, who it's written for) and deliver it through the format's own way of opening. The take and the hook formula supply the SUBSTANCE of the first line and the format's hook contract decides what it has to establish, but that line is spoken the way the format speaks — mid-answer, mid-reply, mid-routine — never as a piece delivered to camera.`

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
  // ~2.1–2.7 words a second, the same rate as every tier above it.
  90: { words: '190–240 words', scenes: 'usually 9-13 scenes' },
}

function formatEndTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

async function runWrite(input: GenerateScriptInput, take: number, takeCount: number, apiKey: string, endpoint: ChatTarget): Promise<string> {
  const style = input.writeStyle ?? 'pas'
  const format = input.writeFormat ?? 'script'
  const length = input.writeLength ?? 15
  const budget = WRITE_LENGTH_BUDGET[length]

  let prompt = `The creator's brief for this ad:\n\n${input.brief.trim()}\n\n`

  const ctxLines = productContextLines(input.productContext)
  if (ctxLines) {
    prompt += `The product being advertised:\n${ctxLines}\n\n`
  } else {
    // A product is optional here — the brief carries it instead. Say so, or the
    // system prompt's "name the product at most twice (given in the product
    // context)" is an instruction with no referent, and the model fills the gap
    // with a [Product Name] placeholder or an invented brand.
    prompt += `${NO_PRODUCT_DETAILS}\n\n`
  }

  prompt += `${styleBlock(style)}\n\n`

  // Formats also stage the shots — but only the blueprint has shots to stage.
  const staging = format === 'scenes' ? WRITE_STYLE_SCENE_DIRECTION[style] : undefined
  if (staging) prompt += `${staging}\n\n`

  // Real transcripts, weighted toward whole scripts: the library already covers
  // the opening line, and the body is what this app had no evidence about.
  // Sits here rather than beside "write the script now" on purpose — it sets
  // the register alongside the structure, and putting verbatim transcripts last
  // invites the model to imitate their content instead of their cadence.
  const calibration = exemplarBlock(familiesForWriteStyle(style), { hooks: 6, scripts: 3 })
  if (calibration) prompt += `${calibration}\n\n`

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
  const text = await kieChatCompletions(apiKey, endpoint, messages, { timeoutMs: SCRIPT_TIMEOUT_MS })
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

async function runRemix(input: GenerateScriptInput, angle: RemixAngle, apiKey: string, endpoint: ChatTarget): Promise<string> {
  // The panel requires a source in Remix, so this is filled in practice; the
  // unsourced branches below are the honest fallback for a payload or a history
  // row that arrives without one, and only there is this a from-scratch write.
  const source = input.winningTranscript?.trim()
  let prompt = ''

  // Fenced and named as the thing being rewritten, not as "inspiration" — that
  // word was doing real damage, since a model handed a reference and a product
  // brief and told to write "for the product" writes a new ad every time.
  if (source) {
    prompt += `THE SOURCE SCRIPT — this is the winning ad you are rewriting. Its beats, its opening device, its pacing and its CTA placement are what you keep:\n\n"""\n${source}\n"""\n\n`
  }

  const ctxLines = productContextLines(input.productContext)
  if (ctxLines) {
    prompt += source
      ? `THE NEW PRODUCT this script is being rewritten for. Every fact in your script comes from here, and nothing about the source's product survives:\n${ctxLines}\n\n`
      : `Write a UGC ad script for the following product. Base it on the provided product details below:\n${ctxLines}\n\n`
  } else if (input.productId) {
    prompt += source
      ? `Rewrite the source script for a new product, using the product details provided in the context.\n\n`
      : `Write a UGC ad script for this product. Use the product details provided in the context.\n\n`
  } else if (!source) {
    prompt += `Write a UGC ad script.\n\n`
  }

  if (input.additionalContext) {
    prompt += `Additional context and instructions:\n${input.additionalContext}\n\n`
  }

  // No bank product attached — legal in both modes, since a member describing
  // the product in the instructions shouldn't have to bank it first. The
  // subject then comes from those instructions, and this has to say so: without
  // it the closing line asks the model to rewrite the ad "for the new product"
  // when nothing on the prompt names one, and a model handed that gap fills it
  // with an invented brand.
  if (source && !ctxLines && !input.productId) {
    prompt += input.additionalContext.trim()
      ? `NO PRODUCT DETAILS ARE ATTACHED, so the instructions above are the whole brief for what this is being rewritten FOR. Take the product, the audience and the specifics from them. Where they leave something unsaid, keep it general rather than inventing it — never make up a brand name, a price or a statistic, and refer to the product as the instructions do or by its plain category.\n\n`
      : `NO PRODUCT DETAILS AND NO INSTRUCTIONS ARE ATTACHED, so this is a rewrite of the source ad for ITS OWN subject: keep what the ad is selling and write it fresh against the map — same beats, same opening device, new words. Never invent a brand name, a price or a statistic that isn't in the source.\n\n`
  }

  if (source) prompt += `${REMIX_ANGLE_FRAME}\n\n`
  prompt += `${REMIX_ANGLE_INSTRUCTION[angle]}\n\n${CREATOR_ANGLE_PRECEDENCE}\n\n`
  // CREATOR_ANGLE_PRECEDENCE is shared with Write New, where takes that all
  // argue the creator's angle are told to differ in their opening device. In a
  // remix the opening device is the source's in every variation, so that one
  // sentence needs scoping or it hands back the licence this whole pass removes.
  if (source) {
    prompt += `IN A REMIX, THE OPENING DEVICE IS NEVER WHAT MAKES VARIATIONS DIFFER — it is the source's in all of them. They differ in the angle they argue and the specifics they reach for.\n\n`
  }

  // No target length means the 'default' pick: the remix inherits the source
  // ad's pacing, which is the whole point of remixing a winner. A picked length
  // re-cuts it, and the word budget is what actually makes that land — which
  // means it's the one thing allowed to break the same-beat-count rule, so it
  // has to say so outright the way the blueprint rewrite's does.
  const length = input.remixLength
  if (length) {
    const budget = WRITE_LENGTH_BUDGET[length]
    prompt += `${lengthDiscipline(length)}\n\nLENGTH — THIS OVERRIDES THE SAME-BEAT-COUNT RULE, AND ONLY THAT RULE: this remix must read aloud in about ${length} seconds — write ${budget.words}, regardless of how long the source script is. Drop whole beats out of the MIDDLE of the source's map to fit, keeping the opening beat and the CTA beat and the order of everything you keep. The opening device, the rhythm of the lines you keep, and the CTA placement all stay the source's. Count the words before you answer.\n\n`
  } else if (source) {
    prompt += `LENGTH: keep the source's own length and beat count. It is not too long — you are not summarising it, you are rewriting it line for line.\n\n`
  }

  const hasProduct = Boolean(ctxLines || input.productId)
  prompt += !source
    ? `Generate the full script now.`
    : hasProduct
      ? `Rewrite the source script for the new product now, beat for beat: same structure, same opening device, same pacing, same CTA placement — new product, new specifics, new angle. Output the finished spoken script only.`
      : `Rewrite the source script now, beat for beat: same structure, same opening device, same pacing, same CTA placement — new words and a new angle. Output the finished spoken script only.`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: REMIX_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ]

  // Plain remix output is pure spoken words, so any token anywhere is spoken.
  const text = await kieChatCompletions(apiKey, endpoint, messages, { timeoutMs: SCRIPT_TIMEOUT_MS })
  return nameSpokenTokens(text, spokenProductName(input))
}

async function runReverseEngineer(input: GenerateScriptInput, apiKey: string, endpoint: ChatTarget): Promise<string> {
  // No target length means the 'default' pick: the rewrite inherits the source
  // blueprint's own scene count and timings, which is what a rewrite usually
  // wants. A picked length RE-CUTS it, so the two clauses below that promise to
  // preserve the timing have to stand down for it.
  const length = input.remixLength
  const keepTiming = !length

  let prompt = `Original reverse-engineered ad blueprint:\n\n${input.reversePrompt.trim()}\n\n`

  const ctxLines = productContextLines(input.productContext)
  if (ctxLines) {
    const preserved = keepTiming ? 'camera, framing, scene count, durations,' : 'camera and framing style'
    prompt += `Rewrite this blueprint for the following NEW product. Replace only the product/brand references and the [CHARACTER]'s dialogue/voiceover. Keep ${preserved} and the [CHARACTER] token unchanged.\n\n${ctxLines}\n\n`
  } else if (input.productId) {
    prompt += `Rewrite this blueprint for a new product using the product details provided.\n\n`
  } else {
    // Reachable now that a product is optional. The four transformations still
    // apply — what changes is where the new dialogue's facts come from.
    const preserved = keepTiming ? 'camera, framing, scene count, durations,' : 'camera and framing style'
    prompt += `Rewrite this blueprint with NO product details attached. Keep ${preserved} and the [CHARACTER] token unchanged, and still replace every visual description of the original product with [PRODUCT]. Take the rewritten dialogue's subject from the instructions below if there are any; otherwise keep what the ad is selling and just rewrite the lines fresh. Never invent a brand name, a price, or a statistic that isn't given.\n\n`
  }

  if (input.additionalContext) {
    prompt += `Additional context and instructions:\n${input.additionalContext}\n\n`
  }

  if (length) {
    const budget = WRITE_LENGTH_BUDGET[length]
    prompt += `${lengthDiscipline(length)}\n\nLENGTH: the rewritten blueprint must run about ${length} seconds end to end — ${budget.scenes}, and the spoken lines across ALL scenes together must read aloud as ${budget.words}. Re-time every scene to fit and DROP or MERGE whole scenes out of the middle when the source is longer than that; keep the opening scene and the scene carrying the CTA. Renumber the "--- Scene N ---" headers so they stay consecutive from 1, and update any per-scene timings you keep. Count the spoken words across the whole blueprint before you answer.\n\n`
  }

  prompt += `Generate the rewritten scene blueprint now, ${keepTiming ? 'preserving the "--- Scene N ---" headers exactly' : 'using consecutive "--- Scene N ---" headers in the same format'}.`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: REVERSE_ENGINEER_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ]

  const text = await kieChatCompletions(apiKey, endpoint, messages, { timeoutMs: SCRIPT_TIMEOUT_MS })
  return nameSpokenTokensInDialogue(text, spokenProductName(input))
}

// The batch size for this generate. Sanitised here rather than trusted, since
// the value round-trips through a persisted draft and a history row.
function requestedCount(input: GenerateScriptInput): number {
  return isVariationCount(input.variationCount) ? input.variationCount : DEFAULT_VARIATION_COUNT
}

export async function generateScript(input: GenerateScriptInput): Promise<GeneratedScript> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = scriptModel()

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
    const settled = await Promise.allSettled(
      Array.from({ length: takeCount }, (_, take) => runWrite(input, take, takeCount, apiKey, endpoint)),
    )
    return { variations: keepFulfilled(settled) }
  }

  const requested = REMIX_ANGLES.slice(0, Math.min(requestedCount(input), REMIX_ANGLES.length))
  const settled = await Promise.allSettled(requested.map((angle) => runRemix(input, angle, apiKey, endpoint)))
  const variations = keepFulfilled(settled)
  // The stamp has to name the angles that actually came back, in order — it's
  // what OutputPanel labels each take with.
  const angles = requested.filter((_, i) => settled[i].status === 'fulfilled')
  return { variations, angles }
}

// A batch is N independent chat calls, and Promise.all rejects on the FIRST one
// to fail — so a single slow take threw away every take that had already
// landed, and the member saw an error next to a kie.ai log full of successful
// generations they'd paid for. Keep what came back; only surface the failure
// when nothing did.
function keepFulfilled(settled: PromiseSettledResult<string>[]): string[] {
  const kept = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  if (kept.length > 0) return kept
  const first = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
  throw first?.reason ?? new Error('Script generation returned nothing.')
}

// (`writeOneScript` — ONE spoken script, the strongest take rather than a batch
// — lived here for B-Roll's auto-script. Both are gone as of July 2026: writing
// a script is Scripts' job, and a one-take copy of it running in another app
// was a second thing to keep in step. See git history if it's ever wanted back;
// it was four lines around runWrite(input, 0, 1, …).)

// ── Brief enhancement ──
// Rewrites the creator's rough "Describe Your Video" brief into a sharper
// creative brief for the script writer. Mirrors Playground's prompt-enhance,
// but tuned for a brief (direction) rather than a finished prompt.
const ENHANCE_BRIEF_SYSTEM = `You are a senior UGC ad strategist. You rewrite a creator's rough video brief into a clear, specific creative brief that an AI script writer can turn into a great short-form ad. You KEEP the creator's intent, angle and any product details — you never invent a different concept. You make it concrete (audience, angle, tone, key talking points, call-to-action) without padding it out.`

export async function enhanceBrief(draft: string): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = scriptModel()

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
  const responseText = await kieChatCompletions(apiKey, endpoint, messages, { timeoutMs: SCRIPT_TIMEOUT_MS })
  return responseText
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*["']|["']\s*$/g, '')
    .trim()
}
