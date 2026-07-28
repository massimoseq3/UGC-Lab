// Visual styles — the shared look system behind B-Roll's two modes and the
// Characters portrait/sheet generator. A style is one dense paragraph of pure
// aesthetic direction (medium, forms, palette, light, camera/finish) that gets
// appended to an image or video prompt without carrying any subject matter of
// its own, so the same style can ride prompts for any product or character.
//
// Two sources, one shape: the built-in presets below, and briefs reverse-
// engineered from user reference frames by `analyzeStyleReferences` (saved to
// the `styles` bank). A custom brief always outranks a preset id.
//
// Lives in utils/ rather than inside an app because two apps now consume it —
// per CLAUDE.md, apps are self-contained and share through global modules.

import { useSettingsStore } from '../stores/settingsStore'
import { kieChatCompletions, type ChatMessage } from './kie'
import { getChatEndpointPath } from './models'

// ── Visual styles ──────────────────────────────────────────────
// The preset seeds the LLM's STYLE block; the LLM adapts it to the product and
// script. The chain mechanic works for any aesthetic — 3D is just the default.

export interface ContinuousStyle {
  id: string
  label: string
  // Short blurb for the picker card and the left-panel row. UI only — never
  // sent to a model.
  hint: string
  // The style direction itself: one dense paragraph covering the same five
  // axes as STYLE_ANALYSIS_SYSTEM (medium & render / forms / palette / light /
  // camera & finish). This is what `styleBriefFor` returns, so it's appended
  // verbatim to every Line-by-Line prompt and seeds Continuous'
  // <STYLE> block. It must stay product-agnostic — it rides prompts for every
  // script, so it describes how things look, never what is in frame.
  brief: string
  // True only for the live-action UGC style: it KEEPS the app's deterministic
  // iPhone-realism stack switched on. Every stylized style bypasses it.
  realism?: boolean
}

// Display order — this array IS the order of the picker's Presets grid. Live
// action leads because it's what most ads are; the stylized looks follow.
export const CONTINUOUS_STYLES: ContinuousStyle[] = [
  {
    id: 'ugc',
    label: 'UGC Realism',
    hint: 'Real, unpolished creator footage shot handheld on a modern phone.',
    brief:
      'Real, unpolished creator footage shot handheld on a modern phone — video, not photography: mild sensor noise in the shadows, slight rolling-shutter wobble on movement, and the flat wide-lens rendering of a phone’s main camera. People and their surroundings are ordinary and unretouched, with real skin texture, stray hair, and clothes that wrinkle and sit wrong. Colour is straight out of camera: no grade, no teal-and-orange, mixed white balance from whatever actually lights the room — daylight through a window, a warm bulb, a cool overhead. Light is soft, available, and directional from a real source, with open shadows and the occasional blown highlight. Framing is casual and slightly off-centre, focus is sharp edge to edge with effectively no bokeh, and there is no vignette, halation, or commercial gloss. The look of a phone camera, never the sight of one — never name or show a phone, camera, tripod, or ring light anywhere in frame, and never stage a mirror selfie. People look like they just decided to film this.',
    realism: true,
  },
  {
    id: 'zack-3d',
    label: '3D Animated',
    hint: 'Glossy stylized 3D render in the viral explainer register.',
    brief:
      'Glossy stylized 3D animation in the viral-explainer register, rendered at premium animated-short quality rather than photoreal: soft rounded forms built from clean bevelled geometry with no hard edges, gently exaggerated proportions, large readable features, and smooth subsurface-scattering skin over impeccably smooth surfaces that still carry fine tactile texture — brushed metal, matte plastic, woven fabric. The palette is vivid and high-chroma, with one dominant saturated accent carried through the whole sequence against warm, clean, uncluttered environments. Lighting is soft and volumetric: a broad key, gentle fill, and a crisp rim light separating every subject from its background, plus subtle bloom around bright sources and shallow atmospheric haze in the deep field. The virtual camera holds sharp focus with only mild depth falloff and clean, vibrant clarity across the entire frame. No film grain. Never photoreal, never live-action.',
  },
  {
    id: 'clay',
    label: 'Claymation',
    hint: 'Handcrafted stop-motion claymation on a physical miniature set.',
    brief:
      'Handcrafted stop-motion claymation shot one frame at a time on a physical miniature set: every surface is modelling clay with visible fingerprints, thumb dents, and tool marks, and shapes are charmingly imperfect — slightly asymmetric, a little lumpy, sculpted rather than modelled. Proportions are squat and chunky with oversized heads and simple mitten hands; edges are soft and hand-smoothed, and armature seams occasionally show through. The palette is warm and earthy — putty, terracotta, ochre, moss, cream — in matte, low-saturation blocks of solid colour, broken by the occasional bright clay accent. Light comes from small practical fixtures rigged just off the diorama: a warm, soft-but-directional key with visible falloff onto the set walls and gentle shadows at tabletop scale. The camera sits close with macro-ish depth of field and true miniature parallax, a faint stop-motion judder in movement, and no digital gloss anywhere.',
  },
  {
    id: 'paper',
    label: 'Papercraft',
    hint: 'Layered paper-cutout diorama staged like a pop-up book.',
    brief:
      'Layered paper-cutout diorama, everything built from real cut and folded card and photographed as a physical set: crisp scissor and craft-knife edges, visible paper fibre and tooth, faint fold creases, and distinct stacked planes that each cast a small soft drop shadow onto the layer behind. Forms are flat and graphic — simplified silhouettes with no rounding or volume beyond what the layering implies, details punched or scored rather than drawn. The palette is flat matte colour in confident blocks, slightly desaturated like coloured stock, with pale cut edges showing where the paper opens. Light is soft and frontal-diagonal, raking just enough to separate the layers and reveal texture, with no specular highlights anywhere. The camera holds a straight-on or gently angled view with even sharpness across the frame and shallow overall depth, staged like a handmade pop-up book page.',
  },
  {
    id: 'anime',
    label: 'Anime',
    hint: 'Clean 2D anime cel animation with painterly backgrounds.',
    brief:
      'Clean 2D anime cel animation in a modern TV-series register, drawn and composited rather than rendered: confident tapering linework of even weight, flat cel shading in two hard-edged tones per surface, and almost no gradients outside the sky. Figures carry lightly stylized proportions, large expressive eyes with specular catchlights, simplified hands, and hair drawn as sculpted clumps rather than strands. The palette is clean and saturated, with a clear separation between warm character tones and cooler background washes. Backgrounds are painterly and softer than the characters — brushed texture, atmospheric depth, visible paint edges — so the cel-shaded figures read as a distinct layer on top. Light is graphic: one defined key direction, hard-edged shadow shapes, and generous soft bloom, lens flare, and light-shaft overlays added in the composite. Camera work is limited-animation — held frames, sliding pans, speed lines — with no photographic grain.',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    hint: 'Photoreal commercial-grade live action, polished on purpose.',
    brief:
      'Photoreal cinematic live action shot on large-format digital with prime lenses and finished like a high-end commercial: true-to-life texture and skin, deliberate art direction in every frame, nothing accidental in shot. Compositions are considered — clean symmetry or confident rule-of-thirds, negative space used on purpose. Depth of field is shallow but controlled: the subject critically sharp, backgrounds falling into smooth creamy bokeh without losing legibility. The grade is filmic and low-contrast in the shadows — lifted, slightly desaturated blacks, rich midtones, gently rolled-off highlights, and a coherent warm-key against cool-fill separation. Light is motivated and sculpted: a soft large key, deep controlled shadow, practical sources visible in frame, and subtle haze catching the backlight. Camera movement is slow and intentional — locked off, a measured dolly, or a gentle push-in, never handheld chaos. Finish carries fine organic grain, mild halation on highlights, and a soft vignette. Polished on purpose — the one style where gloss is the goal.',
  },
]

// Fallback is pinned by id, not by position: the array's order is a display
// choice, and reordering it must never silently change what an unknown or
// legacy style id resolves to (it also decides `realism`).
const FALLBACK_STYLE = CONTINUOUS_STYLES.find((s) => s.id === 'zack-3d')!

export function getContinuousStyle(id: string): ContinuousStyle {
  return CONTINUOUS_STYLES.find((s) => s.id === id) ?? FALLBACK_STYLE
}

// Whether this storyboard keeps the app-wide iPhone-realism suffix. A style
// analysed from reference images is stylized by assumption — the user picks
// UGC Realism explicitly when they want the live-action stack.
export function styleUsesRealism(styleId: string, hasCustomBrief: boolean): boolean {
  if (hasCustomBrief) return false
  return getContinuousStyle(styleId).realism === true
}

// ── Style from reference images ────────────────────────────────
// The user drops in frames of an ad whose look they want. A vision pass distils
// the AESTHETIC ONLY — never the subjects, products, or scenes in them — into a
// STYLE paragraph that then drives every keyframe and clip.

const STYLE_ANALYSIS_SYSTEM = `You are an art director reverse-engineering a visual style from reference frames.

Your ONLY job is to describe HOW these images look, never WHAT is in them. Your output is appended to unrelated image and video prompts for a completely different script, so any subject matter you carry over is a bug: no characters, no products, no locations, no story, no specific objects from these references.

Describe, in ONE dense paragraph of 90-150 words:
- MEDIUM & RENDER: the technique (3D render, 2D cel animation, claymation, papercraft, live-action photography, mixed media), how stylized vs photoreal it is, surface quality (glossy, matte, grainy, painterly), and the apparent render engine or film-stock character.
- FORMS: how shapes and figures are treated — proportions (realistic vs exaggerated), edge quality (hard linework, soft rounded, cut-paper crisp), geometric detail level, texture density.
- PALETTE: the actual dominant colours and their relationships (name the colours; never just "vibrant"), saturation, contrast, and any consistent grade or tint.
- LIGHT: the lighting register — sources, softness, direction tendencies, rim and volumetric effects, shadow depth, bloom or haze.
- CAMERA & FINISH: typical framing and lens character, depth-of-field behaviour, grain or noise, and any post treatment (vignette, chromatic aberration, halation).

Write it as direct style direction an image model can act on, present tense, one flowing paragraph. Name concrete visual qualities, never vague praise ("beautiful", "high quality", "professional"). If the references disagree, describe the dominant look and ignore the outlier.

Output ONLY the paragraph. No preamble, no headings, no bullets, no markdown.`

// `images` are data URIs (the uploader converts on attach). Returns the style
// paragraph, which replaces the preset hint for this storyboard.
export async function analyzeStyleReferences(images: string[]): Promise<string> {
  if (images.length === 0) throw new Error('Attach at least one reference image first.')
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatEndpointPath()

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: STYLE_ANALYSIS_SYSTEM }] },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Describe the visual STYLE shared by ${images.length === 1 ? 'this reference frame' : `these ${images.length} reference frames`}. Style only — carry over no subjects, products, locations, or story from the images.`,
        },
        ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ],
    },
  ]

  const responseText = await kieChatCompletions(apiKey, endpoint, messages, {
    timeoutMs: 180_000,
    reasoningEffort: 'high',
  })
  const cleaned = responseText.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()
  if (!cleaned) throw new Error('The style analysis came back empty. Try again.')
  return cleaned
}


// The style paragraph a mode fires with: the reverse-engineered reference brief
// when the user supplied one, otherwise the selected preset's brief. Shared by
// both modes (structural type so each mode's own input satisfies it).
// Always `brief`, never `hint` — Line-by-Line appends this verbatim with no LLM
// expansion step, so a preset shipping the picker's one-line blurb gave it a
// fraction of the direction a custom style gets.
export function styleBriefFor(input: { styleId: string; styleBrief?: string }): string {
  return input.styleBrief?.trim() || getContinuousStyle(input.styleId).brief
}


// ── Stills ─────────────────────────────────────────────────────
// Every brief is written for motion: it ends on camera language (movement,
// judder, cadence, grain) that a single still portrait can't express, and a
// custom brief analysed from video frames carries the same. Rather than author
// a second set of paragraphs — and leave bank styles with no still variant —
// a still generation appends one instruction that scopes the brief down. The
// medium, forms, palette, light and finish still apply; only the motion talk
// is switched off.
const STILL_STYLE_NOTE =
  'Apply the style above to a single still photograph, not a video frame: honour its medium, forms, palette, lighting and surface finish exactly, and ignore any direction about camera movement, animation cadence, or shot-to-shot cutting.'

// The style paragraph a STILL generation fires with. Returns null when the
// style resolves to the app's own photorealism default, so the caller can fall
// back to whatever style string it already had (Characters keeps its editable
// Camera Device field for exactly that case).
export function styleBriefForStill(input: { styleId: string; styleBrief?: string }): string | null {
  const custom = input.styleBrief?.trim()
  if (custom) return `${custom}\n\n${STILL_STYLE_NOTE}`
  const style = getContinuousStyle(input.styleId)
  // UGC Realism IS the photoreal default — its brief would only restate, at
  // length, what the caller's own realism string already says.
  if (style.realism) return null
  return `${style.brief}\n\n${STILL_STYLE_NOTE}`
}
