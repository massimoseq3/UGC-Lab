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
  targetMarket: string
  painPoints: string
  usps: string
  benefits: string
  offer: string
  cta: string
  keySpecs: string
  objections: string
}

// Field name → the tag the prompt asks for. Kept as one table so the prompt and
// the parser can't drift apart.
const FIELD_TAGS: Record<keyof ProductExtraction, string> = {
  productName: 'PRODUCT_NAME',
  productDescription: 'DESCRIPTION',
  targetMarket: 'TARGET_MARKET',
  painPoints: 'PAIN_POINTS',
  usps: 'USPS',
  benefits: 'BENEFITS',
  keySpecs: 'KEY_SPECS',
  objections: 'OBJECTIONS',
  offer: 'OFFER',
  cta: 'CTA',
}

// The fields whose value is a list of lines. The script prompt joins them raw,
// so a stray "- " or "1. " the model added despite instructions would be read
// aloud; strip the marker rather than leaving it for the scriptwriter to trip on.
const LIST_FIELDS = new Set<keyof ProductExtraction>([
  'painPoints', 'usps', 'benefits', 'keySpecs', 'objections',
])

const SYSTEM_INSTRUCTION = `You are a senior UGC ad strategist building a product profile that is fed VERBATIM to an AI scriptwriter. You are not writing marketing copy — you are writing the raw material a copywriter works from. A vague line here becomes a vague line in every script this product ever produces, so specificity is the entire job.

═══ INPUTS ═══

You always get at least one product photo, and you MAY get several. When there are several they are ALWAYS different shots of the SAME single product — the packaging closed and open, the box and what's inside it, the label, a size or texture close-up. Never read them as separate products or as a bundle: read them together as one object, and let the later shots resolve what the first one hides.

You MAY also get pasted listing copy (a product page, Amazon listing, or landing page). When it is present it is AUTHORITATIVE for claims, specs, ingredients, price, offer, reviews and audience — mine it hard and carry its concrete specifics through. The photos are authoritative for anything visual or physical.

═══ OUTPUT FORMAT ═══

Emit these blocks in this exact order, each opened and closed with its own tag. Nothing before <READ>, nothing after </CTA>. No markdown, no JSON, no code fences, no commentary, no bullet characters.

<READ>…</READ>
<PRODUCT_NAME>…</PRODUCT_NAME>
<DESCRIPTION>…</DESCRIPTION>
<TARGET_MARKET>…</TARGET_MARKET>
<PAIN_POINTS>…</PAIN_POINTS>
<USPS>…</USPS>
<BENEFITS>…</BENEFITS>
<KEY_SPECS>…</KEY_SPECS>
<OBJECTIONS>…</OBJECTIONS>
<OFFER>…</OFFER>
<CTA>…</CTA>

═══ THE READ BLOCK — WRITE IT FIRST, IN FULL ═══

<READ> is your working notes, and it is what stops everything after it from coming out generic. Write it BEFORE any other block. Never write a field before it. Four labelled lines:

TEXT: every word visible anywhere across ALL the photos, transcribed verbatim — brand, product name, variant, flavour, claims, ingredient callouts, quantities, dosages, sizes, volumes, badges, certifications, directions, warnings, back-of-pack panel. Quote it exactly, including partly obscured text; mark what you genuinely cannot make out as [illegible]. If a label is readable in any photo, you must transcribe it.
OBJECT: the physical thing — category, form factor, materials, finish, colour palette, closure, size cues against anything else in frame, the texture and colour of the contents, how much appears to be in there.
POSITIONING: premium / mid-market / budget, plus the two or three visual cues that tell you so (typography, foiling, matte vs gloss, photography style).
CATEGORY: name the market this actually competes in, then the two or three things buyers in THAT category shop on and complain about. This is what makes every field below specific to this product rather than interchangeable with any other.

Nothing in <READ> is shown to anyone — it exists so that the fields are written from what is in front of you rather than from what products in general are like.

Keep the whole block under 200 words. It is a grounding pass, not the answer: the TEXT line takes the words that identify the product and back its claims (brand, name, variant, actives with amounts, size, dose, badges) and skips the boilerplate — directions, warnings, addresses, barcodes and legal small print change nothing downstream. Everything you spend here comes out of the room left for the ten fields below it, and a profile that stops halfway is worth less than a shorter read.

═══ THE ANTI-GENERIC RULE ═══

Every field must contain at least one thing that could ONLY be written about this exact product. If a sentence would be equally true of any other product in the category, it is wrong: delete it and write the specific version.

Banned outright, because they are what generic output is made of — and don't reach for a synonym either, write the concrete fact instead: "high-quality", "premium quality", "top-of-the-line", "game-changer", "elevate your routine", "in today's fast-paced world", "perfect for anyone who", "designed to help", "helps support", "the ultimate solution", "say goodbye to", "revolutionary", "cutting-edge", "seamlessly", "unlock", "effortlessly", "whether you're X or Y".

Shape only — these come from an unrelated product and demonstrate FORM. Never carry their content into your output:
  BAD  "Made with high-quality ingredients that help support healthy skin."
  GOOD "Niacinamide sits second on the ingredient list, above the oils — it's the one working on the marks a breakout leaves behind."
  BAD  "Perfect for busy people who want convenience."
  GOOD "The 28-40 woman with a shelf of half-used serums who has stopped believing any of them."
  BAD  "Great value for money."
  GOOD "The 60-serving tub works out cheaper per scoop than the 30-serving tubs beside it on the shelf."

═══ HONESTY, AND WHY IT IS NOT A LICENCE TO HEDGE ═══

Never invent: no clinical percentages, no "FDA approved", no certifications, awards, review counts, prices, guarantees, bundles or shipping terms that aren't visibly printed on the packaging or stated in the listing copy.

But hedging is NOT the safe way out of a fact you don't have, because a hedged line poisons every script written from it. Keep the sentence specific and put the gap in a bracketed placeholder the member fills in:
  BAD  "Backed by research and trusted by thousands of customers."   (vague — the failure this profile exists to prevent)
  BAD  "Clinically proven to work in 14 days."                       (invented — never)
  GOOD "[insert your clinical result, e.g. 'visible in 14 days'] — that result is the reason this beats a drugstore retinol."

Naming what the buyer would OTHERWISE do is not a claim, and is encouraged: "a drugstore retinol", "meal-prepping every Sunday", "the supermarket own-brand". Naming a competitor brand and asserting something about it IS a claim — don't.

═══ THE FIELDS ═══

<PRODUCT_NAME> — short, exactly as it's sold: brand + product, as printed. If no brand is legible, write [brand name] and keep the descriptive part.

<DESCRIPTION> — 90-150 words. What it is, what it does, how the mechanism actually works in plain language, and the moment of use: when in the day, where in the house, what it replaces. Then what it looks and feels like in the hand — texture, weight, scent, finish, the sound of the closure. Concrete nouns over adjectives. This is the block a scriptwriter reaches for first.

<TARGET_MARKET> — 50-90 words. ONE specific person: age band, life situation, what they've already tried and given up on, what they're quietly embarrassed about, where they see ads like this. "Anyone who wants X" is a failed answer.

<PAIN_POINTS> — 4-6 lines, one per line, no bullets or numbering. Each line is a MOMENT in the customer's own voice from BEFORE they bought anything: a time of day, a place, a specific trigger. "Wakes up to a new breakout the morning of an event" beats "has skin problems". No line may name the product or the solution.

<USPS> — 4-6 lines, one per line. What THIS one has that the alternative doesn't, with the concrete detail attached — the ingredient, the mechanism, the material, the number. Every line should be checkable against <READ> or the listing copy. Features and differentiators, not feelings.

<BENEFITS> — 4-6 lines, one per line. The payoff of the USPs in the customer's life, tied to a visible or feelable result in a real moment. Pair them to the pain points where you can — this is the "so you get Y" to the USP's "ours has X".

<KEY_SPECS> — 3-6 lines, one per line. Hard facts a script can cite out loud: ingredients or materials with amounts, dose, dimensions, quantity, servings, run time, how the mechanism works in one plain sentence, usage frequency, anything certifiable that is actually visible or stated. Facts only — strip every trace of persuasion. Everything here must trace back to <READ> or the listing copy.

<OBJECTIONS> — 3-5 lines, one per line, each written as "hesitation — counter". The hesitation is the real reason someone closes the tab. The counter must be supportable from the photos or listing copy; where it isn't, leave the counter as a bracketed placeholder rather than inventing one.

<OFFER> — 1-2 lines: price, bundle, discount, bonus, guarantee, shipping. Stated terms only; bracketed placeholders otherwise.

<CTA> — one short, plain imperative line the creator can say to camera as-is. Three to five words. Pick the ordinary one: "Shop now", "Link's in the bio", "I'll link it below", "Tap the link below", "Grab yours today". NEVER a bracketed placeholder here, and never a price, a discount or a deadline — those belong in <OFFER>, and a CTA that has to be filled in before it can be read is a CTA that stops the script.

Keep these distinct — the overlap is where a profile goes mushy:
  Pain Points = the problem felt BEFORE buying.   USPs = "ours has X".
  Benefits = "so you get Y".                      Key Specs = the raw facts behind the USPs, persuasion stripped out.
  Offer = the commercial deal.                    CTA = the single action, in plain words.

═══ TONE ═══

Match the positioning you named in <READ>: a premium object gets elevated, sensory, confident language; a budget utility gets plain and practical. Default to punchy spoken-UGC phrasing over corporate copy — these lines get performed to camera.`

// Appended to the user turn on the SECOND attempt only — see `extractProductInfo`
// below. The first attempt is the full contract; this one is the same contract
// with its budget spent differently, so the retry is a genuinely different run
// rather than a second roll of the same dice.
const BREVITY_OVERRIDE = `

IMPORTANT — the previous attempt did not come back in a readable state, most likely because it ran out of room. Same format, same rules, but spend far less: keep <READ> to about 80 words (the identifying words on the pack and nothing else), and write every field at the SHORT end of its stated range. A complete short profile beats a long one that stops halfway.`

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

// Read the ten fields out of one response. Returns null when the response
// wasn't a profile at all — a refusal, a preamble, a wrong format — which is
// what the anchor-field test is for: a missing tag here or there is exactly
// what the tolerant reader absorbs, but overwriting the form with ten blanks
// would be worse than saying nothing.
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
    productDescription: read('productDescription'),
    targetMarket: read('targetMarket'),
    painPoints: read('painPoints'),
    usps: read('usps'),
    benefits: read('benefits'),
    offer: read('offer'),
    cta: normalizeCta(read('cta')),
    keySpecs: read('keySpecs'),
    objections: read('objections'),
  }

  if (!extracted.productName && !extracted.productDescription) return null
  return extracted
}

// One call, with the truncation escape hatch taken. `TruncatedResponseError`
// carries the text the model got through before it hit the output ceiling, and
// this is the call site that shape was written for: the ten fields are
// independent of each other and the block reader is tolerant of a missing
// closing tag, so a run cut off inside <OBJECTIONS> still yields a usable
// profile — and the alternative is throwing away an answer the member paid for.
// The anchor-field test in `parseExtraction` is what keeps that honest: a
// fragment too short to carry a name or a description is still a failure.
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
  // CHAT_MODEL_STRONG, not the app default: this profile is read by the Scripts
  // writer on every run for the life of the product, so a thin read here is
  // paid for again in every script — the "it feeds another model, not a reader"
  // reasoning that put it on the cheap tier missed that the model it feeds is
  // the one writing prose a person performs. It's also a long tag contract with
  // a forced transcription pass, which is what this tier is kept for.
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
    ? `Build the product profile from ${photoPhrase} and the listing copy below. The listing copy is authoritative for claims, specs, price, and offer. Start with the <READ> block — transcribe every word you can see before you write a single field.\n\n--- LISTING COPY ---\n${trimmedListing}`
    : `Build the product profile from ${photoPhrase}. Start with the <READ> block — transcribe every word you can see before you write a single field.`

  const photos = [dataUri, ...extraUris].map((url) => ({ type: 'image_url' as const, image_url: { url } }))

  const buildMessages = (userText: string): ChatMessage[] => [
    { role: 'system', content: [{ type: 'text', text: SYSTEM_INSTRUCTION }] },
    { role: 'user', content: [{ type: 'text', text: userText }, ...photos] },
  ]

  const first = await requestRead(apiKey, endpoint, buildMessages(baseText), {
    timeoutMs: 180_000,
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
    timeoutMs: 180_000,
    // Reasoning tokens come out of the same output budget on this transport, so
    // the retry buys its room back from the thinking as well as from the copy.
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
