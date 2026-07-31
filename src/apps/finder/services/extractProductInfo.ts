import { useSettingsStore } from '../../../stores/settingsStore'
import { kieChatCompletions, fileToDataUri, type ChatMessage } from '../../../utils/kie'
import { getChatTarget, CHAT_MODEL_DEFAULT } from '../../../utils/models'
import { isAssetRef, getAsBase64 } from '../../../utils/assetStore'

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

const SYSTEM_INSTRUCTION = `You are a senior UGC ad strategist filling out a deep product profile. The user will paste your output straight into a form that feeds AI scriptwriting, so every field must be ready-to-use, specific, and dense with usable material — vague filler directly produces vague scripts.

INPUTS: You always get at least one product photo, and you MAY get several. When there are several they are ALWAYS different shots of the SAME single product — the packaging closed and the packaging open, the box and what's inside it, the label, a size or texture close-up. Never treat them as separate products or as a bundle: read them together as one object and let the later shots resolve what the first one hides (what the contents look like, what the back of the label says, how much is in there). You MAY also get pasted listing copy (a product page, Amazon listing, or landing page). When listing copy is present it is the AUTHORITATIVE source for claims, specs, ingredients, price, offer, reviews, and audience — mine it hard and quote its concrete specifics. The photos are the authority on visual/physical details.

WORK IN TWO STEPS. Step 1 (do this silently, before writing any field): across ALL the photos, transcribe every piece of visible text — brand name, product name, claims, ingredient callouts, quantities, badges — and inventory the physical object (category, form factor, materials, finish, colors, size cues, premium vs. budget positioning). Step 2: write the fields from that inventory plus the listing copy.

You must respond with ONLY valid JSON matching this exact structure (no markdown, no code fences, no commentary before or after):

{
  "productName": "<short, exactly as it's sold; use [brand name] placeholder if not visible>",
  "productDescription": "<4-6 sentences. What it is, what it does, how it's used (the ritual/moment of use), and what it looks and feels like — texture, scent, weight, finish. Concrete nouns over adjectives.>",
  "targetMarket": "<2-3 sentences painting a specific person: age range, life situation, what they've already tried, where they hang out online. Push past 'everyone' — get an actual person.>",
  "painPoints": "<4-6 lines, newline-separated. The frustration the customer feels BEFORE buying, from the customer's POV, each as a specific moment or scene (not an abstract category). 'Wakes up to a new breakout the morning of an event' beats 'has skin problems'.>",
  "usps": "<4-6 lines, newline-separated. What's unique about THIS product vs. named alternatives the buyer would otherwise consider. Features and differentiators with their concrete detail attached (the ingredient, the mechanism, the material), not feelings.>",
  "benefits": "<4-6 lines, newline-separated. The outcome/transformation the customer GETS. The payoff of the USPs, in the customer's life — visible, feelable results tied to real moments.>",
  "offer": "<1-2 lines stating the commercial deal: price, bundle, discount, bonus, guarantee, shipping.>",
  "cta": "<one short imperative line, e.g. 'Shop now', 'Claim 20% off today'.>",
  "keySpecs": "<3-6 lines, newline-separated. Hard facts scripts can cite: key ingredients or materials with amounts if known, dimensions/quantity/servings, how the mechanism works in one plain sentence, usage frequency, anything certifiable that is actually visible or stated across any of the photos. Facts only — no marketing language.>",
  "objections": "<3-5 lines, newline-separated. Each line: the hesitation, then ' — ' then the counter. E.g. 'Looks expensive for the size — one jar lasts 3 months, cheaper per use than [alternative]'. Only counters you can support from the image or listing copy; otherwise leave a [bracketed placeholder] as the counter.>"
}

Field discipline — these overlap in ways that trip people up. Keep them distinct:
- Pain Points = the problem/frustration the customer feels BEFORE buying.
- USPs = "ours has X" — features and differentiators.
- Benefits = "so you get Y" — the outcome in the customer's life.
- Key Specs = the raw facts behind the USPs, stripped of persuasion.
- Offer = the commercial deal (price/bundle/guarantee). NOT the same as the CTA.
- CTA = the single action you want them to take, as an imperative.

Tone matches positioning: a premium product gets elevated, confident, sensory language; a budget utility gets plain, practical language. Default to punchy UGC-friendly phrasing rather than corporate filler.

HONESTY RULE — this is non-negotiable. Do NOT invent specific claims you can't support from the photos or the provided listing copy:
- No clinical percentages, "FDA approved", award names, certifications, or fake reviews.
- No specific prices unless visibly printed on packaging or stated in the listing copy.
- No specific guarantees, bundles, or shipping terms unless stated.

When a strong claim or fact would help but you don't actually have it, write a bracketed placeholder the user will fill in, e.g.:
- "[insert your X-day money-back guarantee]"
- "[insert price]"
- "[confirm any clinical or dermatologist-endorsement claims before publishing]"

Output ONLY the JSON object. No preamble, no markdown fences, no trailing notes.`

// Resolve whatever shape an image is stored in (File, data: URI, asset:// ref,
// blob:/http URL) to a data URI the vision call can carry inline.
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
  const endpoint = getChatTarget(CHAT_MODEL_DEFAULT)

  const dataUri = await toDataUri(image)
  // A broken extra shouldn't sink the read — the hero photo is what matters.
  const extraUris = (await Promise.all(
    extraImages.map((src) => toDataUri(src).catch(() => null)),
  )).filter((u): u is string => !!u)

  const photoCount = 1 + extraUris.length
  const photoPhrase = photoCount === 1
    ? 'this image'
    : `these ${photoCount} photos of the same product`

  const trimmedListing = listingText?.trim()
  const userText = trimmedListing
    ? `Extract the product profile from ${photoPhrase} and the listing copy below. The listing copy is authoritative for claims, specs, price, and offer. Return as JSON.\n\n--- LISTING COPY ---\n${trimmedListing}`
    : `Extract the product profile from ${photoPhrase}. Return as JSON.`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: SYSTEM_INSTRUCTION }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: userText },
        ...[dataUri, ...extraUris].map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ],
    },
  ]

  const responseText = await kieChatCompletions(apiKey, endpoint, messages, {
    timeoutMs: 180_000,
    reasoningEffort: 'high',
  })

  const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

  try {
    const parsed = JSON.parse(cleaned) as Partial<ProductExtraction>
    return {
      productName: parsed.productName ?? '',
      productDescription: parsed.productDescription ?? '',
      targetMarket: parsed.targetMarket ?? '',
      painPoints: parsed.painPoints ?? '',
      usps: parsed.usps ?? '',
      benefits: parsed.benefits ?? '',
      offer: parsed.offer ?? '',
      cta: parsed.cta ?? '',
      keySpecs: parsed.keySpecs ?? '',
      objections: parsed.objections ?? '',
    }
  } catch (err) {
    const tail = cleaned.slice(-400)
    throw new Error(`Failed to parse product extraction JSON: ${err instanceof Error ? err.message : String(err)} — response tail: ${tail}`)
  }
}
