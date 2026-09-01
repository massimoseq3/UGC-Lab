import { useSettingsStore } from '../../../stores/settingsStore'
import {
  kieChatCompletions,
  fileToDataUri,
  TruncatedResponseError,
  type ChatMessage,
  type ChatCallTarget,
  type ChatCompletionsOptions,
} from '../../../utils/kie'
import { getChatTarget, CHAT_MODEL_STRONG } from '../../../utils/models'
import { isAssetRef, getAsBase64 } from '../../../utils/assetStore'
import { extractBlock } from '../../../utils/xmlBlocks'
import { downscaleForVision } from '../../../utils/visionImage'

export interface ProductExtraction {
  productName: string
  productDescription: string
  uniqueMechanism: string
  targetMarket: string
  painPoints: string
  currentAlternatives: string
  objections: string
  notFor: string
  usps: string
  benefits: string
  proof: string
  beforeAfter: string
  offer: string
  cta: string
}

// Field name → the tag the prompt asks for. Kept as one table so the prompt and
// the parser can't drift apart. The ORDER is the order the prompt emits them
// in, which is the order the form reads top to bottom — a member watching a
// read land sees it fill down the column rather than jump around it.
const FIELD_TAGS: Record<keyof ProductExtraction, string> = {
  productName: 'PRODUCT_NAME',
  productDescription: 'DESCRIPTION',
  uniqueMechanism: 'UNIQUE_MECHANISM',
  targetMarket: 'TARGET_MARKET',
  painPoints: 'PAIN_POINTS',
  currentAlternatives: 'CURRENT_ALTERNATIVES',
  objections: 'OBJECTIONS',
  notFor: 'NOT_FOR',
  usps: 'USPS',
  benefits: 'BENEFITS',
  proof: 'PROOF',
  beforeAfter: 'BEFORE_AFTER',
  offer: 'OFFER',
  cta: 'CTA',
}

// The fields whose value is a list of lines. The script prompt joins them raw,
// so a stray "- " or "1. " the model added despite instructions would be read
// aloud; strip the marker rather than leaving it for the scriptwriter to trip
// on. `cleanLines` also drops blank lines, which is why the two genuinely
// PARAGRAPH fields — DESCRIPTION and BEFORE_AFTER, whose blank line separates
// "their day now" from "their day with it" — are deliberately not in here.
const LIST_FIELDS = new Set<keyof ProductExtraction>([
  'targetMarket', 'painPoints', 'currentAlternatives', 'objections', 'notFor',
  'usps', 'benefits', 'proof',
])

const SYSTEM_INSTRUCTION = `You are a direct response copy strategist doing research intake for a UGC ad studio. What you write is fed VERBATIM to an AI scriptwriter, and it is the only thing that writer will ever know about this product — it never sees the photo. You are not writing ad copy. You are building the ammunition the copy gets made from, so a vague line here becomes a vague line in every script this product ever produces.

═══ INPUTS ═══

You always get at least one product photo, and you MAY get several. When there are several they are ALWAYS different shots of the SAME single product — the packaging closed and open, the box and what's inside it, the label, a size or texture close-up. Never read them as separate products or as a bundle: read them together as one object, and let the later shots resolve what the first one hides.

You MAY also get pasted listing copy (a product page, Amazon listing, or landing page). When it is present it OUTRANKS the photo on every fact, and it is the only place you may source price, guarantee, reviews, stats and shipping. Mine it hard for real customer phrasing — if it carries reviews, testimonials or Q&A, lift that wording near verbatim, because real customer words beat anything you can write. The photos stay authoritative for anything visual or physical.

═══ OUTPUT FORMAT ═══

Emit these blocks in this exact order, each opened and closed with its own tag. Nothing before <READ>, nothing after </CTA>. No markdown, no JSON, no code fences, no asterisks, no numbering, no commentary.

<READ>…</READ>
<PRODUCT_NAME>…</PRODUCT_NAME>
<DESCRIPTION>…</DESCRIPTION>
<UNIQUE_MECHANISM>…</UNIQUE_MECHANISM>
<TARGET_MARKET>…</TARGET_MARKET>
<PAIN_POINTS>…</PAIN_POINTS>
<CURRENT_ALTERNATIVES>…</CURRENT_ALTERNATIVES>
<OBJECTIONS>…</OBJECTIONS>
<NOT_FOR>…</NOT_FOR>
<USPS>…</USPS>
<BENEFITS>…</BENEFITS>
<PROOF>…</PROOF>
<BEFORE_AFTER>…</BEFORE_AFTER>
<OFFER>…</OFFER>
<CTA>…</CTA>

═══ THE READ BLOCK — WRITE IT FIRST, IN FULL ═══

<READ> is your working notes, and it is what stops everything after it from coming out generic. Write it BEFORE any other block. Never write a field before it. Four labelled lines:

TEXT: every word visible anywhere across ALL the photos, transcribed verbatim — brand, product name, variant, flavour, claims, ingredient callouts, quantities, dosages, sizes, volumes, badges, certifications. Quote it exactly, including partly obscured text; mark what you genuinely cannot make out as [illegible]. If a label is readable in any photo, you must transcribe it. Never round a number and never paraphrase one.
OBJECT: the physical thing — category, form factor, materials, finish, colour palette, closure, size cues against anything else in frame, the texture and colour of the contents, how much appears to be in there.
POSITIONING: premium / mid-market / budget, plus the two or three visual cues that tell you so (typography, foiling, matte vs gloss, photography style).
CATEGORY: name the market this actually competes in, then the two or three things buyers in THAT category shop on and complain about. This is what makes every field below specific to this product rather than interchangeable with any other.

Nothing in <READ> is shown to anyone — it exists so that the fields are written from what is in front of you rather than from what products in general are like.

Keep the whole block under 200 words. It is a grounding pass, not the answer: the TEXT line takes the words that identify the product and back its claims (brand, name, variant, actives with amounts, size, dose, badges) and skips the boilerplate — directions, warnings, addresses, barcodes and legal small print change nothing downstream. There are fourteen fields under this block and everything you spend here comes out of the room left for them, so a profile that stops halfway is worth less than a shorter read.

═══ HOW MUCH YOU ARE ALLOWED TO INFER ═══

You will usually be working from a single photo of packaging. That is not enough evidence for FACTS, but it is plenty for STRATEGY. Split the two and treat them differently.

TIER 1 — read literally off the product. Brand name, product name, actives and percentages, volume or count, format, every word printed on the label, icons and badges, texture, applicator type, colour palette, the price tier the design implies. Read the small print. If a percentage, a certification or a claim is printed, capture it exactly.

TIER 2 — reason from the category. Once you know it is, say, a 2% salicylic acid acne serum in a 30ml dropper bottle, you know an enormous amount about who buys it, what they have already tried, what they are frightened of, and what they will say in the comments. Use that, at full confidence and full specificity, for audience, pain, alternatives, objections, benefits and before/after.

THE LINE: category truth is fair game, brand truth is not. "Most people reaching for a 2% BHA have already tried and quit a benzoyl peroxide" is category truth and belongs in the brief. "Clinically proven to reduce blemishes by 74% in 4 weeks" is brand truth and is forbidden unless it is printed on the label or stated in the listing copy.

Never invent brand-specific facts: no clinical trials, review counts, star ratings, dermatologist endorsements, awards, guarantees, prices, shipping terms, founder stories or customer names that aren't in front of you.

═══ PLACEHOLDERS — ONE NARROW USE ═══

A bracketed placeholder like [insert your clinical result] is reserved for a BRAND FACT only you, the seller, can supply: price, discount, guarantee, shipping, review counts, star ratings, clinical numbers, awards, timeline-to-results, a named endorsement, a hero customer quote. The member sees every bracket painted red in the form, so the brackets are their to-do list — which only works if the list is short and every entry on it genuinely needs them.

Everywhere else a placeholder is a FAILURE. Any field you could write from the category — target market, pain points, current alternatives, objections, not for, benefits, before/after — must be written in full, from category knowledge, with no bracket anywhere in it. "[Add a pain point here]" is a bug, not an answer.

Where an OBJECTION has no answer in the source, do not bracket it: say so plainly in the answer itself, in the same sentence — "nothing on the packaging addresses this, so the brand needs to supply it".

<CTA> may never hold a placeholder under any circumstances.

═══ THE RULE THAT MATTERS MOST ═══

TARGET_MARKET, PAIN_POINTS, CURRENT_ALTERNATIVES, OBJECTIONS and BEFORE_AFTER are written in the customer's own words. First person. Contractions. Fragments. Specific times, specific mirrors, specific moments. A sentence a real person would say out loud to a friend, or type into a comment at 11pm.

THE TEST: could this line be lifted straight into a script as a talking-head line? If it reads like a product manager describing a market segment, it fails.

A category label, useless:
Recurring facial blemishes
A person talking, usable:
I'll get one clearing up and two more show up on the other side of my chin. It never actually ends, it just moves.

A product feature in disguise, useless:
Wanting a focused treatment for breakout-prone skin
A person talking, usable:
My bathroom shelf is a graveyard of half-used bottles. I don't want another maybe, I want the one thing I actually stick to.

NEVER restate the product as a pain. If you can delete "wanting a", "looking for a" or "in need of" from the front of a pain point and be left with the product description, you have written a feature and you need to start again.

BANNED in those five fields: consumers, users, individuals, seeking, desire, struggle with, challenges, solutions, journey, effective, efficacious, regimen, leverage, unlock, empower, elevate, seamless, effortless, game changer.

═══ THE FIELDS ═══

<PRODUCT_NAME> — exactly as it is sold: brand + product line + variant, as printed. Add no word that is not on the label. If no brand is legible, write [brand name] and keep the descriptive part.

<DESCRIPTION> — 3 to 5 sentences. What it literally is, the format and size, the active ingredient and strength, how it is used and how often, and who it is for. Neutral and factual — no hype, no adjective the label has not earned.

<UNIQUE_MECHANISM> — the named ingredient, complex, technology or method the product hangs on, plus a plain-English explanation of why that works that a fifteen-year-old would follow. From the label only. If the label names no mechanism, say so in one line rather than inventing one.

<TARGET_MARKET> — 2 or 3 segments, one per line. For each: who they are, the situation that makes them need this right now, and one line in their own voice about how they see themselves. Situation beats demographics — "twenty-six, first proper office job, breaking out worse than at school and quietly humiliated by it" is worth more than "women aged 18 to 34".

<PAIN_POINTS> — 6 to 8 lines, one per line, one or two sentences each. First person, spoken aloud. Cover functional, emotional and social pain, not just functional; at least half must be about how it FEELS rather than what it does. Include the moment it bites — the mirror at 7am, the front camera, the group photo, the third product that did nothing.

<CURRENT_ALTERNATIVES> — 4 to 6 lines. What this buyer is using or doing instead today, including doing nothing, and why each one lets them down. In their voice. This is the richest hook source in the brief, so give it real thought.

<OBJECTIONS> — 5 to 7 lines, each written as "the hesitation in their voice — the honest answer". Include the cynical one they would not say to a salesperson. The answer uses only what the label and listing copy support; where they support nothing, the answer says so.

<NOT_FOR> — who should not buy this and why, one per line. Sensitivities, skin or hair types, ages, expectations that will not be met. Disqualification builds trust and sharpens targeting.

<USPS> — 3 to 5 lines. What is true of this and not of the alternatives, each checkable against <READ> or the listing copy, each with one line on why that matters to the buyer. Be honest when something is a category standard being dressed up as unique, and say so.

<BENEFITS> — 6 to 8 lines. Ladder each one on a single line: the feature, then what it does, then what that means in their day, then the pain point it kills. The "what that means" half is in their voice. Never leave a benefit floating with no pain attached to it.

<PROOF> — every checkable, credibility-carrying fact actually present, one per line, straight off the label or the listing copy: concentrations, ingredients, quantity, dose, usage frequency, certifications, free-from claims, printed claims, badges, awards, country of origin, any stat. Exact numbers only, never rounded. Say after each one how much weight it really carries with a stranger — and where the only proof is the label's own claim, say that outright, because that is the gap the brand needs to fill.

<BEFORE_AFTER> — two short paragraphs separated by a blank line, both first person. A day in their life now, then the same day once this is working. Concrete and small-scale, and filmable. No vague uplift; no "feeling confident again" unless it is attached to something a camera could point at.

<OFFER> — only what is evidenced. If the listing copy gives price, bundles, subscription or bonuses, capture them exactly. With no listing copy, write what the product alone constitutes — "single 30ml bottle, one purchase; no bundle, price or subscription information available" — and bracket the terms only the seller can supply.

<CTA> — one short, plain imperative line the creator can say to camera as-is. Three to five words. Pick the ordinary one: "Shop now", "Link's in the bio", "I'll link it below", "Tap the link below", "Grab yours today". Never a bracket, never a price, a discount or a deadline — those belong in <OFFER>, and a CTA that has to be filled in before it can be read is a CTA that stops the script.

Keep these distinct — the overlap is where a profile goes mushy:
  Pain Points = the problem felt BEFORE buying.  Current Alternatives = what they do about it today.
  USPs = "ours has X".                           Benefits = "so you get Y".
  Proof = the hard facts, persuasion stripped out, each weighed for how much a stranger would believe it.
  Offer = the commercial deal.                   CTA = the single action, in plain words.

═══ TONE ═══

Match the positioning you named in <READ>: a premium object gets elevated, sensory, confident language; a budget utility gets plain and practical. Default to punchy spoken-UGC phrasing over corporate copy — these lines get performed to camera.

═══ BEFORE YOU RETURN ═══

1. Could a scriptwriter shoot from this without ever seeing the product? If not, add specificity.
2. Read every pain point, alternative and objection back in your head. Does a person say that? If not, rewrite it.
3. Does any output state a brand fact that is not on the label or in the listing copy? Delete it.
4. Any bracket outside the narrow brand-fact use? That is a fail — write the field properly from the category instead.
5. Does every benefit name the pain it kills?
6. Every block opened and closed, in order, nothing outside them.`

// Appended to the user turn on the SECOND attempt only — see `extractProductInfo`
// below. The first attempt is the full contract; this one is the same contract
// with its budget spent differently, so the retry is a genuinely different run
// rather than a second roll of the same dice.
const BREVITY_OVERRIDE = `

IMPORTANT — the previous attempt did not come back in a readable state, most likely because it ran out of room. Same blocks, same order, same rules, but spend far less: keep <READ> to about 80 words (the identifying words on the pack and nothing else), and take every field to the SHORT end of its range — four pain points rather than eight, one sentence each. A complete short brief beats a rich one that stops halfway.`

// Resolve whatever shape an image is stored in (File, data: URI, asset:// ref,
// blob:/http URL) to a data URI the vision call can carry inline, downscaled to
// what a vision model actually samples.
//
// The downscale is not a nicety. A product photo pulled off a brand site or an
// Amazon listing is routinely 3000-6000px, and it rides in the request body as
// base64 — which is another third again on top of the file. The model resamples
// it to its own tile size regardless, so every one of those megabytes is upload
// time charged against this call's timeout and nothing else. A failed re-encode
// falls back to the original rather than sending nothing.
//
// It only ever affects THIS request. The result is a local, used once in the
// message body and dropped; the photo saved to the bank is the original file
// untouched (`ProductForm` puts the raw `fileToDataUri` on the form and
// `Finder.persistImage` stores that; `saveProductDraft` does the same for a
// bulk add). That matters because a product photo is a REFERENCE IMAGE — it
// gets attached to image and video generations later — so it has to stay at
// full quality. Never write what this returns back to the row.
async function toVisionDataUri(source: File | string): Promise<string> {
  const original = await toDataUri(source)
  return (await downscaleForVision(original)) ?? original
}

async function toDataUri(source: File | string): Promise<string> {
  if (typeof source !== 'string') return fileToDataUri(source)
  if (source.startsWith('data:')) return source
  if (isAssetRef(source)) {
    const asset = await getAsBase64(source)
    if (!asset) throw new Error('Product image is missing from local storage.')
    return `data:${asset.mimeType};base64,${asset.base64}`
  }
  const blob = await (await fetch(source)).blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// Models add "- " / "1. " / "• " to a list despite being told not to, and these
// fields are pasted straight into the script prompt — so the marker would be
// read as part of the pain point. Also drops the blank lines a model leaves
// between items, which turn a 6-line field into a 12-line one.
function cleanLines(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•–—]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
    .join('\n')
}

// The two paragraph fields keep their blank lines (BEFORE_AFTER's is what
// separates "their day now" from "their day with it") but still lose the
// markers and the leading/trailing slack the block reader hands back.
function cleanParagraphs(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•–—]|\d+[.)])\s+/, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// The CTA is the one field that must never need filling in. It's a single
// spoken line at the end of a script, and every other field can carry a
// bracketed gap because a member reads those before they perform them — this
// one gets said. Models still reach for "Claim [your discount] today", so
// anything bracketed, long or multi-line is replaced outright with the plainest
// version of what a CTA is.
const CTA_FALLBACK = 'Shop now'
const MAX_CTA_CHARS = 44

function normalizeCta(raw: string): string {
  const line = raw.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? ''
  const cleaned = line.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim()
  if (!cleaned) return CTA_FALLBACK
  if (/\[[^\]]*\]/.test(cleaned)) return CTA_FALLBACK
  if (cleaned.length > MAX_CTA_CHARS) return CTA_FALLBACK
  return cleaned
}

// Read the fields out of one response. Returns null when the response wasn't a
// brief at all — a refusal, a preamble, a wrong format — which is what the
// anchor-field test is for: a missing tag here or there is exactly what the
// tolerant reader absorbs, but overwriting the form with fourteen blanks would
// be worse than saying nothing.
function parseExtraction(responseText: string): ProductExtraction | null {
  // Drop the working notes before reading fields: <READ> holds text transcribed
  // off a label verbatim, and a label that happens to contain something
  // tag-shaped would otherwise be picked up as a field.
  const readEnd = responseText.search(/<\/READ>/i)
  const body = readEnd === -1 ? responseText : responseText.slice(readEnd)

  const read = (key: keyof ProductExtraction): string => {
    const raw = extractBlock(body, FIELD_TAGS[key]) ?? ''
    return LIST_FIELDS.has(key) ? cleanLines(raw) : raw
  }

  const extracted: ProductExtraction = {
    productName: read('productName'),
    productDescription: cleanParagraphs(read('productDescription')),
    uniqueMechanism: cleanParagraphs(read('uniqueMechanism')),
    targetMarket: read('targetMarket'),
    painPoints: read('painPoints'),
    currentAlternatives: read('currentAlternatives'),
    objections: read('objections'),
    notFor: read('notFor'),
    usps: read('usps'),
    benefits: read('benefits'),
    proof: read('proof'),
    beforeAfter: cleanParagraphs(read('beforeAfter')),
    offer: cleanParagraphs(read('offer')),
    cta: normalizeCta(read('cta')),
  }

  if (!extracted.productName && !extracted.productDescription) return null
  return extracted
}

// One call, with the truncation escape hatch taken. `TruncatedResponseError`
// carries the text the model got through before it hit the output ceiling, and
// this is the call site that shape was written for: the fields are independent
// of each other and the block reader is tolerant of a missing closing tag, so a
// run cut off inside <BEFORE_AFTER> still yields a usable brief — and the
// alternative is throwing away an answer the member paid for. The anchor-field
// test in `parseExtraction` is what keeps that honest: a fragment too short to
// carry a name or a description is still a failure. It matters more than it did
// at ten fields: the brief is fourteen now, and the last of them are the ones a
// long read runs out of room for.
async function requestRead(
  apiKey: string,
  endpoint: ChatCallTarget,
  messages: ChatMessage[],
  opts: ChatCompletionsOptions,
): Promise<string> {
  try {
    return await kieChatCompletions(apiKey, endpoint, messages, opts)
  } catch (err) {
    if (err instanceof TruncatedResponseError && err.partial.trim()) return err.partial
    throw err
  }
}

// `image` is the hero product photo as a File or an already-encoded data URI
// (the form re-extracts from the stored image when no fresh File exists).
// `listingText` is optional pasted product-page / listing copy — when present
// it becomes the authoritative source for claims, specs, and offer details.
// `extraImages` are the product's additional angles (asset refs or data URIs);
// they're different shots of the same object, so they ride along in the same
// vision call and let it read what the hero shot hides.
export async function extractProductInfo(
  image: File | string,
  listingText?: string,
  extraImages: string[] = [],
): Promise<ProductExtraction> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  // CHAT_MODEL_STRONG — Gemini 3.6 Flash, the tier this call sat on before
  // August 2026. The slot has now been round the houses: app default, strong,
  // GPT 5.6 Luna on cost, and back here (September 2026, Massimo's call)
  // alongside the rewrite that turned this from ten summary boxes into a
  // fourteen-field research brief.
  //
  // The cost argument for the cheap row was real and is knowingly given up.
  // What it was measured against was a much smaller ask: this prompt now holds
  // a long contract — fourteen blocks, in order, five of them under a
  // customer-voice rule with a ban list — over a verbatim OCR pass, and
  // holding a stated contract to the last line is exactly what the strong tier
  // is kept for. Two things to watch if it moves again: <READ> is an OCR pass,
  // so a thin model shows up as small print missing from PROOF
  // rather than as worse prose, and the customer-voice fields are the first to
  // slide back into market-segment language. Judge it on a dense back-of-pack
  // label, not on a clean hero shot.
  //
  // Vision rides this model's openai-chat transport with the image inline as an
  // `image_url` block — no upload step, data URIs work directly.
  const endpoint = getChatTarget(CHAT_MODEL_STRONG)

  const dataUri = await toVisionDataUri(image)
  // A broken extra shouldn't sink the read — the hero photo is what matters.
  const extraUris = (await Promise.all(
    extraImages.map((src) => toVisionDataUri(src).catch(() => null)),
  )).filter((u): u is string => !!u)

  const photoCount = 1 + extraUris.length
  const photoPhrase = photoCount === 1
    ? 'this photo'
    : `these ${photoCount} photos of the same product`

  const trimmedListing = listingText?.trim()
  const baseText = trimmedListing
    ? `Build the research brief from ${photoPhrase} and the listing copy below. The listing copy is authoritative for claims, specs, price, and offer, and it is the first place to look for real customer phrasing. Start with the <READ> block — transcribe every word you can see before you write a single field.\n\n--- LISTING COPY ---\n${trimmedListing}`
    : `Build the research brief from ${photoPhrase}. There is no listing copy, so you have no price, guarantee, review count or clinical number — bracket those where a field needs one, and write everything else in full. Start with the <READ> block — transcribe every word you can see before you write a single field.`

  const photos = [dataUri, ...extraUris].map((url) => ({ type: 'image_url' as const, image_url: { url } }))

  const buildMessages = (userText: string): ChatMessage[] => [
    { role: 'system', content: [{ type: 'text', text: SYSTEM_INSTRUCTION }] },
    { role: 'user', content: [{ type: 'text', text: userText }, ...photos] },
  ]

  const first = await requestRead(apiKey, endpoint, buildMessages(baseText), {
    // Fourteen fields is a long generation, and this one has a whole label to
    // read before it starts writing.
    timeoutMs: 240_000,
    reasoningEffort: 'high',
  })
  const parsed = parseExtraction(first)
  if (parsed) return parsed

  // One retry, and only for this failure. A response with neither a name nor a
  // description didn't happen because the model was unlucky — it either spent
  // its whole output budget on the read block, or answered in prose. Both are
  // fixed by asking for the same thing smaller, so the second attempt is worth
  // the member's credits in a way that re-rolling the identical call would not
  // be. A hard error (no key, no credits, a refusal, a dropped connection)
  // never reaches here — `requestRead` throws and the caller reports it.
  const second = await requestRead(apiKey, endpoint, buildMessages(baseText + BREVITY_OVERRIDE), {
    timeoutMs: 240_000,
    // Reasoning tokens come out of the same output budget, so the retry buys
    // its room back from the thinking as well as from the copy.
    reasoningEffort: 'medium',
  })
  const retried = parseExtraction(second)
  if (retried) return retried

  // `response tail=` and not a bare colon: `humanizeError` cuts a message at
  // that marker before matching its rules, and a model's prose refusal is full
  // of arbitrary digits — a tail containing "401" would otherwise tell a member
  // with a working key to go and replace it.
  throw new Error(
    `The product read came back without any of the fields it was asked for. response tail=${second.slice(-400)}`,
  )
}
