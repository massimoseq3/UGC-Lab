// UGC ad style/format presets surfaced by PresetPicker. Each preset drops a
// *universal* style prompt into the prompt box — it describes only the shot,
// framing, camera, angle, movement and vibe of the format, never a specific
// subject, product, room, decor or props. The user supplies their own
// reference images for the actual scene, so the prompt must not fight them.
// Any content the user should customise is left as a [bracketed placeholder]
// they fill in or delete (e.g. what they're reacting to, the topic, the task).
// The same set is offered in both Video and Image mode (style is format-
// agnostic). Thumbnails are bundled from ./assets/presets so they ship
// statically.

import mirrorSelfieThumb from './assets/presets/mirror-selfie.jpg'
import carRantThumb from './assets/presets/car-rant.jpg'
import streetInterviewThumb from './assets/presets/street-interview.jpg'
import dayInLifeThumb from './assets/presets/day-in-a-life.jpg'
import yapVideoThumb from './assets/presets/yap-video.jpg'
import greenScreenThumb from './assets/presets/green-screen.jpg'
import podcastClipThumb from './assets/presets/podcast-clip.jpg'
import unboxingThumb from './assets/presets/unboxing.jpg'
import ugcBRollThumb from './assets/presets/ugc-b-roll.jpg'
import productShotThumb from './assets/presets/product-shot.jpg'
import povVlogThumb from './assets/presets/pov-vlog.jpg'
import claymationThumb from './assets/presets/claymation.jpg'
import pixar3dThumb from './assets/presets/pixar-3d.jpg'
import animeThumb from './assets/presets/anime.jpg'
import productHeroThumb from './assets/presets/product-hero.jpg'

// Default aesthetic — iPhone-UGC. Appended to every realistic preset prompt
// except Podcast clip (cinematic trailer below) and the animation styles
// (which carry their own look).
export const UGC_STYLE_TRAILER =
  'Modern iPhone camera quality, unedited photorealism, matching A-roll lighting, zero bokeh, zero depth of field, sharp focus across entire frame.'

// Podcast-only trailer — high-end interview-podcast aesthetic. Different on
// purpose: the format reads as cinematic, not raw UGC.
export const PODCAST_STYLE_TRAILER =
  'High-end cinematic interview-podcast aesthetic, professional studio lighting with moody key light and deep shadows, shallow depth of field, large condenser microphone, photorealistic, no stylization.'

export interface Preset {
  id: string
  title: string
  prompt: string
  defaultAspect?: '9:16' | '16:9' | '1:1'
  defaultDuration?: number
  thumbnailUrl?: string
  previewVideoUrl?: string
}

// Shared style definitions. Each describes only the shot / framing / camera /
// movement / vibe in subject- and scene-free terms, so it reads correctly for
// both a still frame and a clip and never imposes a setting on the user's
// reference. VIDEO_PRESETS and IMAGE_PRESETS are derived from this list below.
interface StyleDef {
  id: string
  title: string
  prompt: string
  thumbnailUrl: string
  duration: number
}

// Order mirrors the reference board, left-to-right, top row first.
const STYLE_PRESETS: StyleDef[] = [
  {
    id: 'mirror-selfie',
    title: 'Mirror Selfie',
    prompt: `Vertical mirror-selfie shot: the camera is a phone held up to a mirror, visible in one raised hand, capturing the subject's waist-up reflection as they [what the subject is doing — e.g. talking to camera, showing a product]. Casual handheld framing with a slight natural sway, shot at eye level, self-filmed everyday energy. ${UGC_STYLE_TRAILER}`,
    thumbnailUrl: mirrorSelfieThumb,
    duration: 6,
  },
  {
    id: 'car-rant',
    title: 'Car Rant',
    prompt: `Vertical selfie shot filmed at arm's length inside a car, phone held or propped at face level. Tight chest-up framing, eye-level angle, direct-to-camera confessional delivery as the subject talks about [the topic of the rant], with expressive, candid, unscripted energy. ${UGC_STYLE_TRAILER}`,
    thumbnailUrl: carRantThumb,
    duration: 8,
  },
  {
    id: 'street-interview',
    title: 'Street Interview',
    prompt: `Vertical handheld street-interview shot: subject framed waist-up and slightly off-center, mid-answer with a small clip-on lavalier microphone, reacting to [the interview question or topic] with candid energy. Run-and-gun documentary feel with loose, slightly shaky handheld movement, shot outdoors at eye level. ${UGC_STYLE_TRAILER}`,
    thumbnailUrl: streetInterviewThumb,
    duration: 8,
  },
  {
    id: 'day-in-a-life',
    title: 'Day In A Life',
    prompt: `Vertical "make it with me" lifestyle shot, camera locked off on a tripod at counter height with hands working in frame [the task being demonstrated — e.g. making a drink, applying a product]. Static, stable framing at a slight high angle, observational vlog energy. ${UGC_STYLE_TRAILER}`,
    thumbnailUrl: dayInLifeThumb,
    duration: 8,
  },
  {
    id: 'yap-video',
    title: 'Yap Video',
    prompt: `Vertical front-camera talking-head shot, subject framed chest-up and centered, looking directly into the lens with casual storytelling energy as they talk about [what the subject is talking about]. Static or lightly handheld selfie framing at eye level, intimate short-form social delivery. ${UGC_STYLE_TRAILER}`,
    thumbnailUrl: yapVideoThumb,
    duration: 8,
  },
  {
    id: 'green-screen',
    title: 'Green-Screen',
    prompt: `Vertical green-screen reaction shot: the subject sits small in a lower corner, gesturing toward [what they're reacting to — e.g. an article, screenshot, or graphic] that fills the rest of the frame behind them. Flat, even lighting on the presenter, talking-head commentary energy, static framing. ${UGC_STYLE_TRAILER}`,
    thumbnailUrl: greenScreenThumb,
    duration: 8,
  },
  {
    id: 'podcast-clip',
    title: 'Podcast Clip',
    prompt: `Vertical podcast-style shot with a cinematic interview look: subject framed chest-up and slightly off-axis, mid-conversation about [the topic of conversation]. Professional studio lighting with a moody key light, shallow depth of field, locked-off framing, premium documentary-interview aesthetic. ${PODCAST_STYLE_TRAILER}`,
    thumbnailUrl: podcastClipThumb,
    duration: 8,
  },
  {
    id: 'unboxing',
    title: 'Unboxing',
    prompt: `Vertical unboxing shot at a low, seated eye-level, subject framed waist-up handling and opening [the item or packaging being unboxed] with genuine first-reaction energy. Handheld or propped static framing centered on the reveal moment. ${UGC_STYLE_TRAILER}`,
    thumbnailUrl: unboxingThumb,
    duration: 8,
  },
  {
    id: 'ugc-b-roll',
    title: 'UGC B-Roll',
    prompt: `Vertical candid b-roll shot with no direct address to camera: subject captured in profile or three-quarter angle performing [the routine or action], natural unposed movement. Observational handheld framing at eye level, cutaway / insert energy. ${UGC_STYLE_TRAILER}`,
    thumbnailUrl: ugcBRollThumb,
    duration: 5,
  },
  {
    id: 'product-shot',
    title: 'Product Shot',
    prompt: `Vertical handheld product b-roll: a tight close-up on [the product] with slow, subtle camera movement and no people in frame. Clean, centered still-life framing at a slight angle. ${UGC_STYLE_TRAILER}`,
    thumbnailUrl: productShotThumb,
    duration: 5,
  },
  {
    id: 'pov-vlog',
    title: 'POV Vlog',
    prompt: `Vertical POV-vlog shot, front-camera held at arm's length, subject framed chest-up talking directly into the lens about [what the subject is talking about] with intimate confessional energy. Slight handheld movement, eye-level selfie angle. ${UGC_STYLE_TRAILER}`,
    thumbnailUrl: povVlogThumb,
    duration: 8,
  },
  {
    id: 'claymation',
    title: 'Claymation',
    prompt: `Stop-motion claymation style: [describe your scene or character] sculpted from modeling clay with visible fingerprints and handmade texture, slightly imperfect surfaces, and tactile miniature-set lighting. Charming, expressive, handcrafted stop-motion animation aesthetic.`,
    thumbnailUrl: claymationThumb,
    duration: 8,
  },
  {
    id: 'pixar-3d',
    title: '3D Pixar Animation',
    prompt: `Polished 3D animated feature-film style: [describe your scene or character] rendered with glossy stylized features, large expressive eyes, smooth subsurface-scattering skin, soft cinematic studio lighting, shallow depth of field, and a warm color grade. High-end CG animation-studio aesthetic.`,
    thumbnailUrl: pixar3dThumb,
    duration: 8,
  },
  {
    id: 'anime',
    title: 'AI Anime',
    prompt: `2D anime style: [describe your scene or character] drawn with clean cel-shaded line art, large expressive eyes, soft gradient shading, a painterly background, and a bright airy color palette. Modern high-quality anime production aesthetic.`,
    thumbnailUrl: animeThumb,
    duration: 8,
  },
]

// Video mode — every style, vertical, with a sensible default duration.
export const VIDEO_PRESETS: Preset[] = STYLE_PRESETS.map((s) => ({
  id: s.id,
  title: s.title,
  prompt: s.prompt,
  thumbnailUrl: s.thumbnailUrl,
  defaultAspect: '9:16',
  defaultDuration: s.duration,
}))

// Image mode — the product hero recipe (needs a reference attached) followed by
// the same style set as the video list (no duration, stills inherit aspect).
export const IMAGE_PRESETS: Preset[] = [
  {
    id: 'product-hero-white',
    title: 'Product Hero Shot',
    thumbnailUrl: productHeroThumb,
    prompt: `Using the attached reference image as the exact product, generate a professional studio product photograph of THIS product, preserving its exact shape, proportions, colors, materials, textures, branding, logos, label text, and every visual detail with 100% accuracy. Do not alter, restyle, redesign, or reinterpret the product in any way.

Place the product centered on a seamless pure white (#FFFFFF) background. Use soft, even, diffused studio lighting from above and slightly in front, with a gentle natural soft shadow directly beneath the product to ground it. No harsh shadows, no colored light, no reflections of other objects.

Composition: product perfectly centered, slight three-quarter angle if the product has a clear "front," straight-on if it's symmetrical. Generous negative space around the product. Subject fills roughly 60–70% of the frame.

Style: clean, premium e-commerce hero shot. Photorealistic, ultra-sharp focus across the entire product, true-to-life color, high dynamic range, crisp edges. Shot on a 100mm macro lens, f/8, ISO 100. 8k resolution. 1:1 square aspect ratio.`,
    defaultAspect: '1:1',
  },
  ...STYLE_PRESETS.map((s) => ({
    id: s.id,
    title: s.title,
    prompt: s.prompt,
    thumbnailUrl: s.thumbnailUrl,
    defaultAspect: '9:16' as const,
  })),
]
