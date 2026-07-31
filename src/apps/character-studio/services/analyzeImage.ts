import { TABS, getTabFields, type VisualDNA } from '../types'
import { useSettingsStore } from '../../../stores/settingsStore'
import { kieChatCompletions, fileToDataUri, type ChatMessage } from '../../../utils/kie'
import { getChatTarget } from '../../../utils/models'

// Chip vocabulary for the truly categorical form fields, pulled from the form
// config itself so the extractor's allowed values never drift from what the
// chips offer. Free-text fields (skin texture, hair style, clothing…) are
// deliberately NOT anchored — those want forensic description, not a preset.
const FIELD_CHIPS: Record<string, string[]> = Object.fromEntries(
  TABS.flatMap(getTabFields).map((f) => [f.key, f.chips]),
)
const oneOf = (key: string): string => FIELD_CHIPS[key]?.join(' / ') ?? ''

const SYSTEM_INSTRUCTION = `You are a forensic visual analyst for UGC ad production. You study a reference photo of a person and produce a description so precise that an artist who has never seen the photo could recreate a near-identical look from your words alone. Broad category labels are useless to you — every answer names specifics you can actually see: exact shades, lengths, shapes, materials, and placements.

You must respond with ONLY valid JSON matching this exact structure (no markdown, no code fences):

{
  "model": {
    "gender": "<gender>",
    "age": "<tight age range, e.g. 24-28>",
    "ethnicity": "<specific ethnicity or mix>",
    "bodyType": "<body type>",
    "skinTone": "<skin tone>",
    "skinTexture": "<forensic skin description>",
    "eyeColor": "<precise eye shade>",
    "eyeShape": "<eye shape>",
    "hairColor": "<exact hair shade>",
    "hairStyle": "<cut, length, part, how it falls>",
    "hairTexture": "<hair texture>",
    "facialFeatures": "<face geometry description>",
    "facialHair": "<facial hair or None>",
    "distinguishingMarks": "<marks with exact placement, or None>"
  },
  "style": {
    "clothingStyle": "<each visible garment, described exactly>",
    "accessories": "<each item with material and placement, or None>",
    "makeup": "<visible makeup, specifically>"
  },
  "pose": {
    "pose": "<body position, weight, hands>",
    "action": "<what they're doing>",
    "expression": "<precise expression — mouth, eyes, gaze>"
  },
  "location": {
    "location": "<the room or place>",
    "background": "<object-by-object description>",
    "lighting": "<source, direction, quality, color temperature>",
    "weather": "<weather or Indoor (N/A)>",
    "timeOfDay": "<time of day>"
  },
  "camera": {
    "shotType": "<shot type>",
    "cameraAngle": "<camera angle>",
    "cameraDevice": "<likely camera device>"
  }
}

Field rules — follow these exactly:

MODEL
- gender: one of ${oneOf('gender')}.
- age: a tight range of about 4-5 years ("24-28"), not a decade.
- ethnicity: name the likely nationality or specific mix ("Colombian", "half Japanese, half British") — never just a broad bucket like "Asian" or "Caucasian" unless nothing more specific is plausible.
- bodyType: closest of ${oneOf('bodyType')}.
- skinTone: closest of ${oneOf('skinTone')} — add an undertone qualifier when visible ("Golden, warm undertone").
- skinTexture: forensic detail — pore visibility, freckles (where and how dense), T-zone shine, blemishes, under-eye texture, fine lines, peach fuzz. This field is what makes the render read as a real photo; never answer just "smooth" or "clear".
- eyeColor: the precise shade ("dark chocolate brown", "gray-blue with a darker limbal ring"), not just the color family.
- eyeShape: closest of ${oneOf('eyeShape')} — read the eye before you label it. Check three things: the crease (clearly visible / partly hidden under the upper lid / absent), the corner tilt (outer corner sitting above, level with, or below the inner corner), and how the eye sits in the socket (set deep, or wide apart). Name the option those observations point to. "Almond" is the safe generic answer and is the one to distrust — choose it only when the crease is clearly visible, the corners sit level, and the shape tapers to a point at both ends. If a hooded lid, a monolid, or a corner tilt is visible, that option wins over Almond.
- hairColor: exact shade including roots, highlights, or dimension ("ash blonde with darker roots and face-framing money pieces").
- hairStyle: the cut, a length landmark (chin / shoulder / collarbone / mid-back), the part (middle / left / right), and how it falls (tucked behind ears, over one shoulder, curtain bangs) — plus flyaways or baby hairs if visible.
- hairTexture: closest of ${oneOf('hairTexture')}.
- facialFeatures: face geometry in 2-4 short phrases — face shape (oval / round / square / heart / oblong), eyebrow shape and thickness, nose bridge and tip, lip fullness and shape, cheekbones, jawline, chin.
- facialHair: closest of ${oneOf('facialHair')} — if a beard, add length and grooming ("Short beard, ~1cm, neatly edged").
- distinguishingMarks: each mark with exact placement ("small beauty mark below the left corner of the mouth", "faint scar through the right eyebrow"), or "None".

STYLE
- clothingStyle: describe the actual garments, never a vibe label. For each visible piece: color, fabric or knit, fit, neckline, sleeve length, notable details. "Oversized cream cable-knit sweater, relaxed crew neck, sleeves pushed to the elbows" — not "cozy casual".
- accessories: every item with material, size, and placement ("thin gold chain necklace with a small round pendant; small gold hoop earrings; Apple Watch with white band, left wrist"), or "None".
- makeup: what is actually visible ("natural makeup — filled brows, subtle bronzer, glossy nude lip"), or "No makeup".

POSE
- pose: body position including weight distribution and what the hands are doing.
- action: what they are doing in the frame.
- expression: precise — mouth (open / closed, smile type), eyes, and gaze direction ("soft closed-mouth smile, relaxed eyes looking directly into the lens").

LOCATION
- location: the specific room or place.
- background: object by object with colors and placement, near to far ("white paneled wall, tall fiddle-leaf fig in a woven basket to the left, framed line-art print upper right, soft daylight from a window off-frame right").
- lighting: source, direction, quality (soft / hard), color temperature (warm / neutral / cool), and where highlights and shadows fall on the face.
- weather: closest of ${oneOf('weather')}.
- timeOfDay: closest of ${oneOf('timeOfDay')}.

CAMERA
- shotType: closest of ${oneOf('shotType')}.
- cameraAngle: closest of ${oneOf('cameraAngle')}.
- cameraDevice: the likely device ("iPhone front camera", "mirrorless with a 50mm lens").

Describe only what is visible. When something is hidden (eyes behind sunglasses, hair under a cap), give your single best assessment without hedging words. Every field must have a value.`

export async function analyzeImage(imageFile: File): Promise<VisualDNA> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatTarget()

  const dataUri = await fileToDataUri(imageFile)

  const prompt = `Extract the complete visual DNA from this photo with forensic precision — exact shades, lengths, shapes, materials, and placements for the person's appearance, garments, pose, setting, and camera. Return as JSON.`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: SYSTEM_INSTRUCTION }] },
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUri } },
      ],
    },
  ]

  const responseText = await kieChatCompletions(apiKey, endpoint, messages)

  const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  // The model is asked for pure JSON, but occasionally wraps it in a sentence
  // ("Here is the analysis: {...}"). Parse directly first, then fall back to the
  // outermost { … } slice so a bit of surrounding prose doesn't drop the whole
  // extraction and leave the user's reference photo doing nothing.
  try {
    return JSON.parse(cleaned) as VisualDNA
  } catch {
    const first = cleaned.indexOf('{')
    const last = cleaned.lastIndexOf('}')
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1)) as VisualDNA
      } catch { /* fall through to the descriptive throw below */ }
    }
    throw new Error(`Bad JSON from DNA extraction model — body: ${cleaned.slice(0, 400)}`)
  }
}
