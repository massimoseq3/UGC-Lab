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
- Conversational starters and fillers in MODERATION (a couple per script, never every line): "okay so", "honestly", "no because", "literally".
- One idea per breath. Short sentences. Fragments are fine. Vary the rhythm hard: a 3-word line next to a longer rambling one. Never an even, metronome cadence — that evenness is the AI tell.
- 6th-grade vocabulary. If a word would feel weird said out loud, cut it.
- Don't oversell. Real people undersell and let the result talk: "and it just... worked" lands harder than "it works amazingly well".
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

// ── What the ad actually argues ──
//
// Direct response's oldest rule, and the one thing the shared DNA had no line
// about. Every other block here governs how a script SOUNDS (the voice rules,
// the banned shapes) or how it OPENS (the hook rules, the library); nothing
// said what a line is allowed to be ABOUT. So with a bank product attached the
// model wrote the product sheet out loud — reported August 2026 as scripts
// that "keep talking about the key specs and facts instead of the benefits and
// what it's going to do for the user".
//
// Two things in the stack were actively pulling that way, and both are fixed
// alongside this rather than left for it to fight. `productContextLines`' Key
// Specs line was the ONLY product field carrying an instruction, and that
// instruction was "cite these concrete specifics" — the strongest steer in the
// prompt, sitting in its highest-salience block, pointed at the spec list. And
// CORPUS_EVIDENCE's specificity clause ("concrete nouns, named objects, exact
// actions") resolves to specs by default once a product sheet is in the
// prompt, because on that sheet the concrete nouns ARE the specs.
//
// It is deliberately NOT a ban on specs, and it must not become one: half the
// styles carry a proof beat (`objection` wants arithmetic, `comparison` wants
// a concrete difference, `expert` wants a mechanism) and CORPUS_EVIDENCE's
// specificity finding is measured. What changes is a spec's JOB — it makes a
// benefit believable, it is never what a line is about.
const BENEFIT_OVER_FEATURE = `WHAT EVERY LINE IS ABOUT — SELL WHAT IT DOES FOR THEM, NOT WHAT IT IS. This decides what a line SAYS; it never changes the script's shape:
- Nobody watching cares what the product HAS. They care what changes for them. A fact only reaches the script attached to the thing it does for the viewer, in the same breath: not "it's got a 5000mAh battery", but "I charge it Sunday night and don't think about it again till the weekend".
- SPECS AND FEATURES ARE PROOF, NEVER THE POINT. A number, a material, an ingredient, a certification or a feature earns its place only by making a benefit believable — so the outcome leads and the spec backs it up, never the other way round. A line that names a feature and stops has failed: finish it or cut it.
- ASK "SO WHAT?" AFTER EVERY LINE, and keep asking until the answer is something the viewer gets. The mechanism is not the benefit, and the first result of the mechanism usually isn't either: "ceramic plates" → "it doesn't fry your ends" → "you can straighten it every morning and it still looks like this a year later".
- WRITE THE BENEFIT AS A MOMENT, NOT A CLAIM. "Saves you time", "boosts your confidence" and "makes life easier" are what a brand says. A real person names the moment it happens in — the morning that stops being a fight, the thing they no longer check before they leave the house, the part of the day they used to dread. A specific moment beats an abstract improvement every time.
- THE VIEWER IS THE MAIN CHARACTER, NOT THE PRODUCT. Read your draft back before you answer: if it is a tour of what the thing is and what it comes with, rewrite it as what their day looks like now.`

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
- Banned hook openers (they scream "ad"): "So I've been...", "Have you ever...", "Let me tell you about...", "Introducing...", "If you struggle with...".
- Open a loop in or near the hook that only pays off later, so they keep watching to the end.`

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
// nothing here made that structural: HOOK_RULES ("write it to win in 3-4
// words") and every angle's "Lead with X" told the model to design its own
// opening, which is the one thing a remix inherits. So the hook rules are
// remix-specific here and the angles pick CONTENT rather than structure (see
// the block above REMIX_ANGLE_INSTRUCTION).
//
// This block used to carry the mechanism as well — map the source into beats
// first, then write beat for beat against that map (same beats, same order,
// same count, same rhythm, same CTA placement). That came out in August 2026
// to see what the model does when it's told WHAT a remix is and left to work
// out how, rather than being handed a checklist. The self-audit and
// BANNED_AI_PATTERNS came out of REMIX_SYSTEM in the same pass. Read the takes
// before putting any of it back — `git show` has the removed text verbatim.
const REMIX_SOURCE_FIDELITY = `HOW A REMIX WORKS — THIS IS AN ADAPTATION, NOT A NEW SCRIPT:
The source script you are given is a proven winner. Its STRUCTURE is the thing being reused, so you don't get to redesign it. You are swapping a new product into a machine that already works.

WHAT DOES CHANGE — every product-specific fact. The pain point, the benefit, the proof, the numbers, the price, the category, the product name, the objection, the offer and the CTA wording all come from the NEW product's details. Nothing about the source's product, brand or category survives; never mention or imply it.

A remix that reads like a fresh script written off the product brief is a FAILURE, even if it's a good script. Someone should be able to lay your script next to the source and see the same skeleton.`

// A remix's hook is inherited — the source's opening is precisely why the ad is
// being remixed. This replaces HOOK_RULES in this pipeline (which teaches the
// model to design a hook from scratch) and keeps only the half that's still
// true: the openers that scream "ad", and the open loop.
const REMIX_HOOK_RULES = `THE HOOK IS INHERITED, NOT INVENTED: the source's first line already won — that's the whole reason this ad is being remixed. Keep its device, its shape and roughly its word count, and refill it with this product's specifics. Do NOT "improve" it into a different kind of hook, and do NOT put a warm-up in front of it. If the source opens a loop that pays off later, your version opens the same loop and pays it off in the same place. The only openers that are off-limits no matter what the source did: "So I've been...", "Have you ever...", "Let me tell you about...", "Introducing...", "If you struggle with...".`

const REMIX_SYSTEM = `You are an elite UGC ad script writer with the specialized skill of "Structural Adaptation". Brands pay you because your rewrites hold attention and convert WITHOUT ever sounding like marketing — they sound like a real person talking to their phone camera.

Your task is taking a winning ad script and rewriting it for a completely new product while rigorously maintaining the original script's beats, pacing, hook device, psychological triggers, and call-to-action placement.

${REMIX_SOURCE_FIDELITY}

${REMIX_HOOK_RULES}

${BENEFIT_OVER_FEATURE}

${HUMAN_VOICE_RULES}

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

${BENEFIT_OVER_FEATURE}

${HUMAN_VOICE_RULES}

${BANNED_AI_PATTERNS}

${CORPUS_EVIDENCE}

VOICE PROFILE — at the very END of your output, AFTER the last scene, emit one labeled block:
=== VOICE PROFILE (same voice in every scene) ===
${VOICE_PROFILE_SPEC}
Anchor it to how [CHARACTER] is acting across the scenes so the read feels native to this ad.

OUTPUT FORMAT — CRITICAL:
- Start directly with the scenes. After the last scene, add a blank line, then the "=== VOICE PROFILE ... ===" block described above (it comes LAST, not first).
- Reproduce each "--- Scene N: <label> (MM:SS-MM:SS) ---" header EXACTLY as given. If the source carries no scene headers at all — it is one unbroken shot — write a single "--- Scene 1: <short shot name> ---" header of your own above it. The output is ALWAYS a headed blueprint, whatever shape the input arrived in.
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

${BENEFIT_OVER_FEATURE}

${HOOK_RULES}

${HOOK_LIBRARY}

${HOOK_OPENING_INSTRUCTION}

${HUMAN_VOICE_RULES}
- Mention the product name at most twice, the way a person would ("so I got the X", "this thing").

${BANNED_AI_PATTERNS}

${CORPUS_EVIDENCE}

FORMAT RULES — CRITICAL:
1. ONLY return the spoken words, plus the labelled lines the picked style explicitly asks for (see rule 6) — nothing else.
2. No stage directions, timestamps, headers, bracketed text, emojis, or camera/visual cues.
3. No quotation marks around the text.
4. No introductions or conclusions (e.g. "Here is the script:").
5. Plain text only. EACH SENTENCE ON ITS OWN LINE.
6. LABELLED LINES — ONLY WHERE THE STYLE NAMES THEM. Some formats put a second voice in the ad, or words on the screen, and those have to reach the creator or the ad cannot be shot. Where the style block below names labels, a line may open with a short ALL-CAPS label and a colon (HOST:, GUEST:, INTERVIEWER:, PERSON 2:, ON SCREEN:, ON SCREEN COMMENT:) and nothing else may. Use ONLY the labels that style names, spell each one the same way every time, and put the label on its own line's worth of speech. A style that names no labels gets none at all — an unlabelled script is one person talking, which is what most of them are.`

const WRITE_SCENES_SYSTEM = `You are an elite UGC creative director. You invent a complete scene-by-scene blueprint for a brand-new organic TikTok ad — the visuals AND the spoken dialogue — ready to be generated with AI video models (one scene = one video generation).

First write the dialogue as a real spoken script following the voice rules below, then cut the ad into scenes and embed each dialogue line in the scene where it's spoken. Each scene is directed as ONE flowing paragraph — readable prose, not a labelled shot bible.

${BENEFIT_OVER_FEATURE}

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
- IF A SCENE STAGING BLOCK IS GIVEN, IT OUTRANKS THE DEFAULTS: the ad is imitating a specific kind of content (a podcast clip, a street interview, a green-screen reaction), and that only works if EVERY scene holds the staging — the location, the props, the camera position, who is in the room, the way the person speaks. One scene that drops back to a generic selfie-to-camera shot breaks the illusion for the whole ad.
- A staging block may put OTHER PEOPLE in the ad — an interviewer holding a microphone, a host across a table, other strangers answering the same question. [CHARACTER] is still the ONE person the ad belongs to and the only one who ever carries that token: never write [CHARACTER] for anybody else, because it is a reference-image slot and every scene carrying it comes back as the same face. Describe the others only as far as the staging block asks and no further — an arm and a microphone, a shoulder and the back of a head, or, where the staging block says the ad is several different people, a plainly different person named by two or three generic markers (a rough age band, a build, what they are wearing or carrying), never a name and never a face in detail.
- When one of those people SPEAKS, attribute the line by ROLE on its own — The host asks: "...", An off-camera voice asks: "...", A second passer-by says: "..." — and give that speaker a one-clause voice note in the same scene (perceived age, energy, accent), because their line is generated with that scene and the VOICE PROFILE at the end describes [CHARACTER] alone.
- A staging block may also put words on screen (a comment card, a review, a headline, a price). Write the exact wording, keep it to a short legible line or two, hold it inside the middle band of the frame — the top and bottom eighth are covered by the platform's own UI — and repeat that wording VERBATIM in every scene the same graphic appears in, or it changes between cuts.

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
- WHAT GOES IN A BLANK IS AN OUTCOME, NOT A FEATURE. A hook that names what the product has ("it's got X", "it's made of Y") gives the viewer nothing to want — name what changes for them, and reach for the spec only where it is the proof that makes that land.
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
  // ── The seven FORMATS ──
  //
  // A format is longer than a structure on purpose. A structure is one
  // persuasion mechanic and the model already knows it; a format is a whole
  // piece of content being imitated, and the imitation fails on the details it
  // was never told — who is in the room, who speaks first, what is on screen,
  // where the turn happens. Three of them put a SECOND VOICE or ON-SCREEN COPY
  // in the ad, so they name the line labels the script format rule allows.
  podcast: `FORMAT — PODCAST CLIP: two people at the mics, and the viewer has landed in the middle of an episode that was already running.

IT OPENS ON THE HOST'S QUESTION, NOT ON THE GUEST. A real question, asked the way a host actually asks one, and it is one of three things: an objection they have heard a hundred times ("okay but everyone says these are just marketing"), a how-does-that-actually-work question about the mechanism ("what is physically happening when you do that"), or a listener's problem put to the guest ("someone messaged me saying they cannot do X. what do you tell them"). One or two sentences, landing mid-thought as though the setup was cut off the front.

THEN THE GUEST ANSWERS AS THE EXPERT IN THE ROOM. They take the question seriously: concede whatever is fair in it first, then explain the mechanism in plain English, in the order it happens, so the viewer learns something they could repeat to a friend tonight. This is analysis, not enthusiasm — one number or one named specific carries more weight than any adjective, and any technical word is translated in the same breath it lands.

The product arrives as the guest's own answer to their own explanation ("which is the entire reason I use this one"), once, in passing — never presented, never held up, never described.

The host may come back ONCE, briefly, to push back or to react ("wait, so it is not the thing everyone thinks it is"), and the guest lands the point on the other side of it.

No pitch and no call-to-action: a podcast clip ends when the answer ends. The most it does is "it is in the show notes" energy, in your own words.

SPEAKER LABELS: the host's lines start HOST: and the guest's start GUEST:, each on its own line. Nothing else carries a label. The guest is this ad's voice and owns most of the words.`,
  interview: `FORMAT — STREET INTERVIEW: a vox pop. Someone with a microphone stopped SEVERAL DIFFERENT STRANGERS in the same afternoon and asked them the same thing, and the ad is those answers cut together — a different person every time, never one person filmed from three angles.

TWO BEATS PER PERSON, AND THE TURN BETWEEN THEM IS THE WHOLE FORMAT.
FIRST they are mildly skeptical, in the ordinary unbothered way real people are: they have heard the claim before, they assume it is overpriced, they think the one they already use is fine, they half-laugh at the question. Doubtful, never hostile — a shrug and a "I mean, does that actually work?", not a rant.
THEN they try it, right there on the street, and react to what just happened. The reaction is specific and physical — what they felt, tasted, smelled, or watched change in that second — not a verdict and never a line of copy ("oh. okay, that is actually…", "wait, do that again"). The gap between what they expected and what happened IS the ad.

Give every person their own reason to doubt and their own thing to notice, so three strangers do not deliver three versions of one sentence. The strongest turn goes last.

HOW MANY PEOPLE IS DECIDED BY THE LENGTH, not by a rule: a very short ad is ONE person's doubt and their reaction; a longer one runs three or four, and the doubt beats can be cut together before the first person tries anything.

The interviewer's question is short, asked once at the top, and heard again only when someone needs prompting. Nobody sells: they are telling a stranger holding a microphone what just happened to them. It ends on somebody's reaction, never on a pitch — at most one short line the interviewer could plausibly say off camera.

SPEAKER LABELS: the interviewer's lines start INTERVIEWER: and each respondent's start PERSON 1: / PERSON 2: / PERSON 3:, each on its own line. Nothing else carries a label.`,
  'green-screen': `FORMAT — GREEN SCREEN REACTION: you are standing in front of something on screen, reacting to it.

WRITE THE THING FIRST, WORD FOR WORD, on its own line prefixed ON SCREEN: — and make it a real artifact rather than a slogan: a one-star review with its star count and a username, a comment, a forum reply, a receipt or a price, a headline with a publication name, a screenshot of a search result. Specific enough that a viewer believes somebody actually wrote it, and never a straw man written to be knocked down.

Read it out loud before you react to it — otherwise the reaction has nothing to be a reaction to — and agree with the fair part of it first. That concession is what buys the rest of the argument.

Then take it apart with ONE concrete thing: what it gets wrong, and the arithmetic, the mechanism, or the receipt that proves it. Keep pointing back at it — quote fragments of the wording again as you go ("'lasts a week'. see, that is the bit") — and if the argument moves onto a second piece of evidence, put THAT on screen too, written out on its own ON SCREEN: line the same way.

The product enters as your answer to what is on screen, never as a change of subject. Quick call-to-action at the end.

ON-SCREEN LABELS: every piece of on-screen copy gets its own ON SCREEN: line at the point in the script where it appears. Nothing else carries a label.`,
  reply: `FORMAT — COMMENT REPLY: one specific person left one specific comment, and this is the reply to it.

WRITE THE COMMENT FIRST, WORD FOR WORD. It is the first thing in the output, on its own line, prefixed ON SCREEN COMMENT: — a handle and one short sentence, typed the way people really type in a comments section: lower case, no full stop, a little blunt. It has to be something somebody would genuinely write — a doubt ("this is just the cheap one with a markup right"), a question ("does it still work if you do X"), a complaint ("tried this, did nothing"), or a challenge ("no way that is worth the money") — never a flattering set-up line and never a straw man.

THEN REPLY TO IT, AND KEEP REFERENCING IT. Open by saying the comment back — their actual words, not a paraphrase — the way creators do, and answer THAT question rather than the version of it you would rather answer. Concede the fair part before you take the rest apart; the concession is the only reason a reply is believed. Come back to their exact wording at least once more in the middle ("'did nothing'. yeah, for about a week. here is why"), and answer the question a second time in one short sentence at the end so it lands.

Talk to that ONE person, by their handle if it helps, not to an audience — this is a favour, not a pitch. Include one detail only somebody who genuinely uses the thing would know; that detail is what turns a reply into proof. Then a quick call-to-action.

ON-SCREEN LABELS: the ON SCREEN COMMENT: line is the only label in the script.`,
  expert: `FORMAT — EXPERT EXPLAINER: you do this job for a living, and you are giving away the thing you tell the people who pay you.

Open on the role and the stake in one breath, and make the role a specific job in a real setting ("I fit these for a living", "I have been cutting hair for eleven years", "I look at these scans all day") — never a vague "expert" and never a credential nobody can picture. Then the thing you watch people get wrong, stated plainly, because a named mistake is what makes a stranger listen to advice.

The body is ONE mechanism explained properly: what is actually happening, in the order it happens, in plain English, with any technical word translated in the same breath it lands. Explain it well enough that the viewer could repeat it to somebody else tonight — that is the value being handed over, and it has to be worth something even if they never buy.

The product is a recommendation you would give a client, not a promotion: one line on what you actually look for, and one honest caveat about who it is not for or when it is not necessary. That caveat is the credibility — an expert who says the thing is for everyone is a salesperson.

Calm and unhurried the whole way through: authority never rushes, never oversells and never raises its voice. Soft call-to-action, the kind a professional would really say ("if you are going to get one, get one that does X").`,
  tutorial: `FORMAT — HOW-TO / TUTORIAL: teach one thing the viewer can genuinely do today, and the product is the tool inside one of the steps.

Open on the promise and the timeframe — what they will be able to do by the end, and roughly how long it takes ("here is how I get that in under a minute").

Then the steps, counted out loud, three at most. Every step is a physical action a person could do with their hands right now: name the action, then name the one thing people get wrong at that step. A step that is advice rather than an action is not a step — cut it and give its time to the ones that are.

The product enters at the step where it is actually used, doing the job that step needs, and earns exactly one line on why this one rather than another. It is never step one, which reads as an ad, and never the only step that matters.

Finish on the visible result: what they should be seeing or feeling if they did it right, and what it means if they are not. The lesson has to be worth watching even if they never buy — that is what earns the buy. Fold the call-to-action into the last step so the video never stops teaching in order to sell.`,
  grwm: `FORMAT — GRWM / ROUTINE: the ad happens inside a routine that was already running, and the routine never stops for it.

Open mid-task, mid-sentence, hands busy — and give the routine a real destination and a real clock ("I have got twenty minutes before I have to leave", "night shift again"). A routine with somewhere to be is a routine; a routine with nowhere to be is a demo with a bathroom in the background.

Talk the way people talk while doing something else: half-sentences, an aside, losing the thread and picking it back up, saying something to the room. The talking happens around the task — never a piece delivered to camera while the hands happen to be moving.

The product shows up at the exact point in the routine it would really be used, taken from wherever it actually lives (a shelf, a bag, a drawer), and earns exactly ONE line about why it stayed in the routine. Not what it does — why it survived ("this is the only one I have ever re-bought").

Never stop the routine to sell it, never turn to camera to present it, and never restate the benefit later. The call-to-action is an aside on the way out of the door, one sentence at most, said while still doing something else.`,
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
  podcast: 'the question, and that somebody else asked it. The first line is the HOST\'s question — an objection, a how-does-that-work question, or a listener\'s problem — landing mid-conversation with no introduction, so the viewer knows in one second they have walked into an episode already running. The guest\'s first words then answer THAT question and not a more convenient one.',
  interview: 'that a stranger on the street is being asked something, and that they doubt it. The first line is a real person\'s offhand, skeptical answer to a question we only half hear — a shrug, a laugh, "does that actually work?" — spoken to whoever is holding the microphone, never to the lens, and never as a claim about the product.',
  'green-screen': 'what is on the screen, read out loud. Quote the actual wording of the review, comment, price or headline in the first line — a first line that only reacts ("this is insane") with nothing named is a failed hook here, because the viewer cannot read fast enough to supply what you left out.',
  reply: 'the comment itself, in that person\'s own words. The first spoken line reads the comment back — the real wording, quoted, never summarised — so the viewer knows they are watching a reply and knows exactly what is being answered before the answer starts.',
  expert: 'the job and the mistake, in one breath. The specific thing you do for a living, and the thing you watch people get wrong doing it — so the authority is established AND pointed at a real error before any advice arrives.',
  tutorial: 'the promise and the timeframe — what the viewer will be able to do by the end, and roughly how long it takes. Never the product: a first line that names it has promised an ad instead of a lesson. If the first line names a number of steps, count exactly that many out loud in the body.',
  grwm: 'that the routine is already underway and has somewhere to be. Mid-task, hands busy, talking over what you are doing, with the clock or the destination named early — never stopping to introduce the video.',
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
//
// THREE OF THEM STAGE MORE THAN ONE PERSON (August 2026), which is what most of
// these formats actually are and what the first version of them missed — every
// block staged one person talking, so a "street interview" came back as one
// creator filmed against three different walls and a "podcast clip" as a
// monologue with a mic in shot. [CHARACTER] is still the ONE token and the one
// identity: it is a reference-image slot, so a scene that carries it comes back
// as that face, and putting it on four strangers turns a vox pop into one person
// in four coats. The others are staged as far as the shot needs them and no
// further — the podcast host as a shoulder and the back of a head who speaks,
// the interviewer as an arm and a mic who never appears, the other respondents
// as plainly different people carrying two or three generic markers each. See
// the OTHER PEOPLE rule in WRITE_SCENES_SYSTEM, which is the half that lets a
// second voice be attributed and given a one-clause voice note of its own.
const WRITE_STYLE_SCENE_DIRECTION: Partial<Record<WriteStyle, string>> = {
  podcast: `SCENE STAGING — PODCAST CLIP: stage every scene inside ONE podcast recording session, cut the way a real multi-cam episode is cut. Two people sit across a table with large boom-arm microphones in frame, headphones on or slung round the neck, warm practical lighting, a dressed background (acoustic panels, a shelf, a plant, a lamp).

[CHARACTER] IS THE GUEST — the expert — and is the only person in the ad with an identity. THE HOST IS THE SECOND PERSON AND THEY DO SPEAK: stage them from behind, over the shoulder, or cut off at the edge of the frame, so what is in shot is a shoulder, the back of a head, a hand resting on a mic — never their face, never a name, never an age, gender, or wardrobe beyond a plain silhouette.

Cut it the way an episode is really cut: the host's question runs over an over-the-shoulder framing past the host onto [CHARACTER], and the answer sits on a clean chest-up studio angle of [CHARACTER], with a second angle roughly 45 degrees off to the side for the cut inside a long answer. [CHARACTER] talks to the host, never into the lens.

Attribute the two voices separately — The host asks: "..." for the host's line, [CHARACTER] says: "..." for the guest's — and give the host a one-clause voice note in the scene where they speak, since the VOICE PROFILE at the end describes [CHARACTER] alone.

[PRODUCT] sits on the table between the microphones from the first scene, unremarked, and gets picked up mid-answer, turned once and put back down. It is never held up to the lens and never presented. One scene may be a tight insert of hands and [PRODUCT] on the table while the answer continues over it.`,
  interview: `SCENE STAGING — STREET INTERVIEW: stage every scene outdoors in the SAME public place on the same afternoon — one stretch of pavement, one market, one park path, one shopfront — in daylight, with real passers-by and traffic behind. A handheld microphone enters frame from the edge of the shot, held by an interviewer who stays off camera and is only ever an arm and a microphone; give them no identity detail at all. The camera is handheld at eye level with a little natural drift, framing whoever is speaking from the chest up with the street legible behind them.

EACH SCENE IS A DIFFERENT PERSON, AND THAT IS THE POINT OF THE FORMAT: several strangers stopped in the same hour, never one person filmed from several angles. [CHARACTER] is ONE of them — the one whose reaction lands the ad — and ONLY their scenes carry the token. Every other respondent is a plainly different person described by two or three generic markers and nothing more (a rough age band, a build, what they are wearing or carrying), never a name and never a face described in detail.

NEVER WRITE [CHARACTER] FOR ANYONE ELSE. That token is a reference-image slot, so every scene carrying it comes back as the same face — put it on all of them and the vox pop becomes one person in four coats. A scene whose speaker is not [CHARACTER] attaches no character reference at all.

Hold the location, the light and the lens identical across all of them so the cuts read as one afternoon; the only thing that changes is who is standing there.

THE TURN HAPPENS ON CAMERA. A doubt scene is a person mid-shrug, eyebrows up, still holding whatever they were carrying, weight on one foot, half-turned as if they were about to walk on. A reaction scene is that same person a beat after trying [PRODUCT] — the eyes going, the second look down at what is in their hand, the involuntary laugh, the "again?" reach. [PRODUCT] is handed in from off frame by the interviewer at the moment it is tried, and stays in that person's hands afterwards.`,
  'green-screen': `SCENE STAGING — GREEN SCREEN REACTION: stage every scene as a green-screen reaction. [CHARACTER] stands or sits in the foreground to ONE side of the vertical frame, the same side in every scene; the rest of the frame is filled by the thing being reacted to, rendered as a flat on-screen graphic behind them.

RENDER THE ARTIFACT, NOT A CAPTION. Whatever is on screen is a screenshot of a real thing and must look like one: a review card with its star row, a username and a date; a comment with a handle and a like count; a forum post; a price tag or a receipt line; a headline with its publication. Write the exact wording, keep it SHORT (a line or two, large and legible), and keep it inside the middle band of the frame, clear of the top and bottom eighth where the platform's own UI sits.

[CHARACTER] plays to the panel: they turn to look at it, gesture back at it, read a fragment off it, react to it with their face. The graphic CHANGES between scenes as the argument moves — a new piece of evidence each time it is quoted, written out in full in that scene — while the framing, the wardrobe and the lighting stay identical, so the cuts read as one continuous take.

[PRODUCT] comes up into the free hand when it enters, held at chest height on the empty side of the frame so it and the graphic are legible at once.`,
  reply: `SCENE STAGING — COMMENT REPLY: stage every scene as a reply filmed wherever this person happens to be — a parked car, a kitchen counter, the end of a bed, a desk — framed tight and casual from chest height about an arm's length away, lit by a window or a lamp in the room. Hold the same setup, wardrobe and light across every scene so it reads as one sitting; only the framing, the posture and what their hands are doing change.

THE COMMENT IS ON SCREEN AND IT IS PART OF THE PICTURE. Every scene that references it renders it as a comment card pinned in the upper middle band of the frame — a small avatar circle, a handle, and the comment text — and the wording is written out EXACTLY THE SAME in every scene it appears in, so the card does not change between cuts. One short legible line or two, clear of the top and bottom eighth of the frame where the platform's own UI sits.

[CHARACTER] plays to it: glancing up at it, pointing back at it, reading a fragment off it, reacting to it with their face. They never talk as though it is not there. The card may come off for a scene that is pure answer, and it comes back for the closing line that answers the question a second time.

[PRODUCT] is reached for from just outside the frame at the moment it is named, and held at chest height in the same frame as the comment card, so the question and the answer are visible at once.`,
  expert: `SCENE STAGING — EXPERT EXPLAINER: stage every scene in the professional's own workplace — a treatment room, a workshop, a kitchen pass, a salon chair, a workbench — with the tools of that trade visible around them and the wardrobe of the job on. Lighting is whatever that room really has, never a lit set.

Hold a steady, unhurried frame from chest height, and cut to tight inserts of the hands demonstrating the thing being explained. [CHARACTER] is DOING the job while talking — working on a real object, a real surface, or a stand-in for a client — never a scene of somebody standing still describing something. Where the explanation has a mechanism, one scene shows that mechanism happening in close-up on the real thing rather than being described over a talking shot.

[PRODUCT] sits among the professional tools from the first scene, treated as one of them, and gets picked up in the scene where it is recommended — used the way the job uses it, never turned to face the lens.`,
  tutorial: `SCENE STAGING — HOW-TO / TUTORIAL: one scene per step, and every step is shown being DONE. Shoot the steps overhead or over the shoulder, on the hands and the surface, and cut back to a chest-up frame of [CHARACTER] between them.

Each step scene catches the physical action in motion — the pour, the wipe, the click, the fold — with [PRODUCT] in the hands at the step where it is actually used. Where a step names a mistake, that scene shows the mistake being avoided (the hand stopping short, the second pass, the correction), not a diagram of it.

Leave the real clutter of the room in frame; nothing is styled or cleared, and the surface carries whatever was already on it. Hold the same room, wardrobe and light across every step so the steps read as one sitting. The final scene is a tight shot of the finished result, held long enough to be judged.`,
  grwm: `SCENE STAGING — GRWM / ROUTINE: every scene sits inside the routine and the routine never stops. A bathroom mirror, a bedroom, a kitchen at the hour this would really happen, with the props of that hour around it — a towel, a kettle, a half-packed bag, the coat already over the chair.

[CHARACTER] is always mid-task, hands busy, talking while doing — never standing still to deliver a line and never turning to present anything. Hold one fixed camera position they move in and out of, cut with close inserts of the task itself, and let time move FORWARD across the scenes: hair goes from wet to dry, the bag fills, the light in the window shifts. Two scenes that could have been filmed in either order are the same scene twice.

[PRODUCT] enters at exactly the point in the routine it would be used, taken from wherever it lives — a shelf, a bag, a drawer — used for what it is for, and left where it lands.`,
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
//
// The second paragraph was added when three formats stopped opening on the ad's
// own voice (August 2026): a podcast clip opens on the HOST's question, a
// comment reply on the COMMENT, a green-screen reaction on what is ON SCREEN.
// The take's anchor used to be attached to "the first spoken line", so on those
// three it had nowhere to land and the angle quietly evaporated — the batch came
// back as three takes arguing the same thing behind three different questions.
// The anchor is handed to whoever speaks first instead.
const FORMAT_OVERRIDES_TAKE = `WHEN THE FORMAT AND THE TAKE DISAGREE, THE FORMAT WINS: keep the take's angle and its anchor (which pain point, which benefit, who it's written for) and deliver it through the format's own way of opening. The take and the hook formula supply the SUBSTANCE of the first line and the format's hook contract decides what it has to establish, but that line is spoken the way the format speaks — mid-answer, mid-reply, mid-routine — never as a piece delivered to camera.

WHEN THE FORMAT OPENS ON SOMEBODY ELSE, THE ANGLE GOES WITH THEM: some formats do not open on this ad's own voice at all. The take's anchor then decides what that other opening is ABOUT — the host asks their question about the take's pain point, the comment doubts the take's benefit, the thing on screen attacks exactly what this take is defending, the first stranger's doubt is doubt about the take's anchor. The angle is never dropped and never softened, only handed to whoever speaks first.`

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
const WRITE_ANGLE_DISCIPLINE = `ANGLE DISCIPLINE: commit to exactly ONE pain point and the ONE benefit that pays it off — chosen from the product details per the anchor below (or inferred from the brief if no product details are given). Every line of the script drives that single idea deeper. Do NOT tour multiple pain points, stack USPs, or list benefits — a script that mentions three benefits sells none. Other product facts may appear only in service of the one idea (a spec as proof, the offer at the CTA). The committed idea is stated as an OUTCOME FOR THE VIEWER even when the anchor you were assigned is a feature or a USP — the anchor picks which of the product's material this script is built on, and that material still reaches the viewer as what it does for them.`

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
    instruction: `THIS TAKE: open with a bold claim or hot take stated as fact. Anchor: the single strongest USP, claimed as the outcome it produces rather than the feature it is — write for a solution-aware viewer comparing options.`,
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
//
// The parentheticals are the other load-bearing half, and getting them wrong is
// how this block came to write spec sheets (August 2026). This is the FIRST
// thing in the user prompt and the only place the product is described, so a
// field carrying an instruction outweighs most of what the system prompt says
// about the same material — and for a long time Key Specs was the ONLY field
// with one, reading "cite these concrete specifics instead of vague claims".
// The model did exactly that. Benefits sat next to it as a bare label, i.e. as
// data with no job. So the steer now rides on the two fields a direct response
// script is actually built from, the spec line says what a spec is FOR, and
// Benefits moved up next to Pain Points — the two halves of the one argument
// ANGLE DISCIPLINE asks for are read together rather than either side of USPs.
// Anything added here needs the same treatment: an unlabelled field reads as
// inert, and a labelled one competes with BENEFIT_OVER_FEATURE.
//
// The bank's auto-fill writes a full research brief as of September 2026. Its
// five new fields are all here, each with its own job, ordered so the one
// argument ANGLE DISCIPLINE asks for stays together (pain → benefit →
// before/after → what they quit) before the material that backs it up; Proof
// took Key Specs' place and inherited its label, plus the weighting the field
// now carries. Hook angles are LAST on purpose, after the CTA and out of order
// with the form: they are ready-made openers, and a model that reads them
// before the product's own material anchors on them instead of writing.
function productContextLines(ctx?: EditableProductContext | null): string {
  if (!ctx) return ''
  const lines: string[] = []
  if (ctx.productName) lines.push(`- Product Name: ${ctx.productName}`)
  if (ctx.productDescription) lines.push(`- Product: ${ctx.productDescription}`)
  if (ctx.uniqueMechanism) lines.push(`- How it works (the one-sentence answer to "but how?" — say it in plain words the moment a claim needs backing, and never as the subject of a line): ${ctx.uniqueMechanism}`)
  if (ctx.targetMarket) lines.push(`- Target Market: ${ctx.targetMarket}`)
  if (ctx.painPoints) lines.push(`- Pain Points: ${ctx.painPoints}`)
  if (ctx.benefits) lines.push(`- Benefits (what the viewer actually GETS — this is what the script argues, and every other field below exists to make one of these believable): ${ctx.benefits}`)
  if (ctx.beforeAfter) lines.push(`- Before & after (the transformation this ad dramatises — the "before" half is where a hook comes from and the "after" half is the payoff it has to land on): ${ctx.beforeAfter}`)
  if (ctx.currentAlternatives) lines.push(`- What they do instead today (what this script is actually competing with — naming the thing they already quit is what makes a viewer feel understood, and it belongs early): ${ctx.currentAlternatives}`)
  if (ctx.usps) lines.push(`- USPs (what makes it different — put the DIFFERENCE IT MAKES in the script, never the feature on its own): ${ctx.usps}`)
  if (ctx.proof) lines.push(`- Proof (the hard facts, each weighed for how much a stranger would believe it — never the subject of a line: reach for one only where it makes a benefit above believable, say what it does for them in the same breath, and never speak a weak signal as if it were a strong one): ${ctx.proof}`)
  if (ctx.objections) lines.push(`- Objections (hesitation — counter; address the most relevant one, don't list them): ${ctx.objections}`)
  if (ctx.notFor) lines.push(`- Who this is NOT for (a promise that only lands for these people is the wrong promise — steer the script away from it, don't spend a line disqualifying anyone): ${ctx.notFor}`)
  if (ctx.offer) lines.push(`- Offer: ${ctx.offer}`)
  if (ctx.cta) lines.push(`- Call-to-Action: ${ctx.cta}`)
  if (ctx.hookAngles) lines.push(`- Hook angles already found (raw material for ONE opener, never a menu to read from and never lifted verbatim — take at most one, and rewrite it in this script's own voice and the assigned format's register): ${ctx.hookAngles}`)
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

// ── The remix run's one voice brief ──
//
// A remix hands back N spoken scripts and nothing else, so a member shooting
// two of them gets two different-sounding people reading the same winner. The
// blueprint pipelines already solve this (both emit a VOICE PROFILE block after
// their scenes); a plain spoken script has nowhere to put one, because the take
// IS the words that get read aloud and a paragraph of casting direction inside
// it would be spoken by TTS.
//
// So it's written by its OWN call, fired alongside the takes, and it belongs to
// the run rather than to any one variation — which is also what the member
// asked for: one paragraph at the top, copied by hand when a video wants it.
// Read off the SOURCE ad, since that's the delivery that won and every
// variation keeps its speaker, its POV and its rhythm.
const REMIX_VOICE_SYSTEM = `You are a casting director for short-form UGC ads. You read the transcript of an ad that already won, hear the person saying it, and write ONE reusable voice brief for whoever reads the rewritten versions of it.

${VOICE_PROFILE_SPEC}

Judge the voice from how the source is WRITTEN — its rhythm, its slang, its confidence, who it's talking to, how hard it pushes. Where the source doesn't settle something, commit to the read that suits this product's audience rather than hedging: a brief full of "or" casts nobody.

OUTPUT: the paragraph and nothing else. No heading, no label, no quotation marks, no markdown, no preamble.`

// Never blocks and never fails the run: the takes are what the member pressed
// Generate for, and a missing voice card is a card that isn't there rather
// than an error over three scripts they already paid for.
async function runRemixVoiceProfile(input: GenerateScriptInput, apiKey: string, endpoint: ChatTarget): Promise<string | undefined> {
  const source = input.winningTranscript?.trim()
  if (!source) return undefined

  let prompt = `THE SOURCE AD you are casting the voice for:\n\n"""\n${source}\n"""\n\n`

  const ctxLines = productContextLines(input.productContext)
  if (ctxLines) {
    prompt += `The rewrites are for this product, so the voice has to suit its audience:\n${ctxLines}\n\n`
  }
  if (input.additionalContext) {
    prompt += `The creator's instructions for the rewrites:\n${input.additionalContext}\n\n`
  }
  prompt += `Write the voice brief now, as one paragraph.`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: REMIX_VOICE_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: prompt }] },
  ]

  try {
    const text = await kieChatCompletions(apiKey, endpoint, messages, { timeoutMs: SCRIPT_TIMEOUT_MS })
    // A model that ignores "no heading" leads with its own "VOICE PROFILE"
    // line, and the card renders the body only. Matched on the labelled pair
    // and nothing looser — a brief that legitimately opens "Voice of a woman in
    // her late 20s" would lose its first line to a bare "VOICE" rule.
    return text
      .replace(/^[=*#\s]*(?:MASTER\s+)?VOICE PROFILE\b[^\n]*\n/i, '')
      .replace(/^[=\s]+|[=\s]+$/g, '')
      .trim() || undefined
  } catch {
    return undefined
  }
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
  // The voice brief rides alongside the takes rather than after them — it reads
  // the same source they do, so there's nothing to wait for, and a member
  // shouldn't sit through a second round trip for a paragraph they may not use.
  const voicePromise = runRemixVoiceProfile(input, apiKey, endpoint)
  const settled = await Promise.allSettled(requested.map((angle) => runRemix(input, angle, apiKey, endpoint)))
  // Awaited before keepFulfilled, which throws when every take failed — this
  // one resolves either way (it swallows its own failure), so settling it here
  // means it can't be left running behind a thrown run.
  const voiceProfile = await voicePromise
  const variations = keepFulfilled(settled)
  // The stamp has to name the angles that actually came back, in order — it's
  // what OutputPanel labels each take with.
  const angles = requested.filter((_, i) => settled[i].status === 'fulfilled')
  return { variations, angles, voiceProfile }
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
