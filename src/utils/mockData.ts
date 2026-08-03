// Dev-only demo-data seeder. Behind a subtle, admin-only control in Settings.
// Populates every bank + every generation-history stream (Influencers, Scripts,
// B-Roll Gallery, Playground images/videos/music, Voiceovers, Ad Analyzer) with
// realistic-looking placeholder content so the UI can be reviewed without
// burning kie.ai credits. Images are local canvas placeholders (gradients +
// labels); videos are short canvas animations captured via MediaRecorder; audio
// is a synthesized WAV tone. All are saved as normal assets, so they render and
// play exactly like real generations.
//
// Every created row's id is recorded in a localStorage manifest so the same
// control can cleanly remove the demo data afterwards.

import { useBankStore, setUsageRecordingSuppressed, foldUsageEvent, type UsageEvent } from '../stores/bankStore'
import { useAppStore } from '../stores/appStore'
import { saveAsset } from './assetStore'
import { getContinuousStyle } from './visualStyle'
import type {
  CharacterHistoryItem,
  ScriptHistoryItem,
  ImageHistoryItem,
  BrollHistoryItem,
  VideoHistoryItem,
  VoiceHistoryItem,
  MusicHistoryItem,
  AdAnatomyHistoryItem,
  UsageDay,
} from '../stores/types'

const MANIFEST_KEY = 'ugc-os:mock-data-manifest'

// The B-Roll workspace persists its live session to these localStorage draft
// slots (see usePersistedState / useProjectScopedKey). Seeding them makes the
// B-Roll tab open straight onto populated scenes; the matching brollHistory row
// lets the user restore it from the History tab too.
const BROLL_DRAFT_PREFIX = 'ai-ugc-lab:draft:broll-studio'
const BROLL_SESSION_ID = 'demo-broll-session'
// The Continuous storyboard rides History rather than the live draft: the
// workspace holds one session at a time, and the Line-by-Line one owns it.
// Clicking this row in History restores the whole keyframe chain.
const BROLL_CONTINUOUS_SESSION_ID = 'demo-broll-continuous-session'
// Seedance 1.5 Pro — Continuous' own default (frames-native, cheap per clip).
const CONTINUOUS_MODEL_ID = 'bytedance/seedance-1.5-pro'
// Grok Imagine Video 1.5 — B-Roll's default video model.
const BROLL_VIDEO_MODEL_ID = 'grok-imagine-video-1-5-preview'

interface Manifest {
  products: string[]
  models: string[]
  scripts: string[]
  voices: string[]
  brolls: string[]
  styles: string[]
  characterHistory: string[]
  scriptHistory: string[]
  imageHistory: string[]
  brollHistory: string[]
  videoHistory: string[]
  voiceHistory: string[]
  musicHistory: string[]
  adAnatomyHistory: string[]
  // Day ids the seed added to the usage ledger. Only days that had NO row
  // before seeding are written, so removal deletes exactly what we created and
  // a member's real generation days are never touched.
  usageDays: string[]
}

const EMPTY_MANIFEST: Manifest = {
  products: [], models: [], scripts: [], voices: [], brolls: [], styles: [],
  characterHistory: [], scriptHistory: [], imageHistory: [], brollHistory: [],
  videoHistory: [], voiceHistory: [], musicHistory: [], adAnatomyHistory: [],
  usageDays: [],
}

export function hasMockData(): boolean {
  try { return !!localStorage.getItem(MANIFEST_KEY) } catch { return false }
}

function readManifest(): Manifest | null {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY)
    if (!raw) return null
    return { ...EMPTY_MANIFEST, ...JSON.parse(raw) }
  } catch { return null }
}

// ── Placeholder image generation ──────────────────────────────────────────

// Draw a gradient card with a centered label (and optional sub-label) and save
// it as a PNG asset. Returns the asset:// ref. Stands in for a real generation.
async function makeImageAsset(opts: {
  w: number; h: number; from: string; to: string; label: string; sub?: string
}): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = opts.w
  canvas.height = opts.h
  const ctx = canvas.getContext('2d')!

  const grad = ctx.createLinearGradient(0, 0, opts.w, opts.h)
  grad.addColorStop(0, opts.from)
  grad.addColorStop(1, opts.to)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, opts.w, opts.h)

  // Subtle vignette so the label reads on any gradient.
  const vign = ctx.createRadialGradient(opts.w / 2, opts.h / 2, opts.w * 0.2, opts.w / 2, opts.h / 2, opts.w * 0.75)
  vign.addColorStop(0, 'rgba(0,0,0,0)')
  vign.addColorStop(1, 'rgba(0,0,0,0.35)')
  ctx.fillStyle = vign
  ctx.fillRect(0, 0, opts.w, opts.h)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const base = Math.min(opts.w, opts.h)
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.font = `600 ${Math.round(base * 0.08)}px system-ui, -apple-system, sans-serif`
  wrapText(ctx, opts.label, opts.w / 2, opts.h / 2, opts.w * 0.82, base * 0.1)
  if (opts.sub) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = `400 ${Math.round(base * 0.045)}px system-ui, sans-serif`
    ctx.fillText(opts.sub, opts.w / 2, opts.h / 2 + base * 0.12)
  }

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  )
  return saveAsset(blob, 'image/png')
}

// Minimal centered word-wrap for the label.
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  const startY = y - ((lines.length - 1) * lineHeight) / 2
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight))
}

// ── Placeholder video generation ───────────────────────────────────────────

// Draw the same gradient+label card as makeImageAsset, but animate a sliding
// highlight across it and capture ~1.6s via MediaRecorder so the result is a
// real, playable clip (not a still). Returns the asset:// ref. Throws if the
// browser can't record (older Safari) — callers guard so the rest of the seed
// still completes.
async function makeVideoAsset(opts: {
  w: number; h: number; from: string; to: string; label: string; sub?: string
}): Promise<string> {
  if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder unavailable')

  const canvas = document.createElement('canvas')
  canvas.width = opts.w
  canvas.height = opts.h
  const ctx = canvas.getContext('2d')!
  const base = Math.min(opts.w, opts.h)

  const draw = (t: number) => {
    const grad = ctx.createLinearGradient(0, 0, opts.w, opts.h)
    grad.addColorStop(0, opts.from)
    grad.addColorStop(1, opts.to)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, opts.w, opts.h)

    // Sliding soft highlight so the clip visibly moves.
    const cx = opts.w * (0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.8)))
    const glow = ctx.createRadialGradient(cx, opts.h * 0.45, 0, cx, opts.h * 0.45, base * 0.45)
    glow.addColorStop(0, 'rgba(255,255,255,0.28)')
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, opts.w, opts.h)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.font = `600 ${Math.round(base * 0.08)}px system-ui, -apple-system, sans-serif`
    wrapText(ctx, opts.label, opts.w / 2, opts.h / 2, opts.w * 0.82, base * 0.1)
    if (opts.sub) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.font = `400 ${Math.round(base * 0.045)}px system-ui, sans-serif`
      ctx.fillText(opts.sub, opts.w / 2, opts.h / 2 + base * 0.12)
    }
  }

  draw(0)
  const stream = canvas.captureStream(30)
  const mimeType =
    ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    ) ?? 'video/webm'
  const recorder = new MediaRecorder(stream, { mimeType })
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

  const start = performance.now()
  let raf = 0
  const loop = () => { draw((performance.now() - start) / 1000); raf = requestAnimationFrame(loop) }

  const blob: Blob = await new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      cancelAnimationFrame(raf)
      stream.getTracks().forEach((tr) => tr.stop())
      resolve(new Blob(chunks, { type: mimeType }))
    }
    recorder.start()
    loop()
    setTimeout(() => recorder.stop(), 1600)
  })

  return saveAsset(blob, mimeType)
}

// ── Placeholder audio generation ────────────────────────────────────────────

// Synthesize a short mono WAV tone (gentle attack/release envelope) so voiceover
// and music tiles have something that actually plays. Returns the asset:// ref.
async function makeAudioAsset(opts: { seconds: number; freq: number }): Promise<string> {
  const sampleRate = 44100
  const length = Math.floor(sampleRate * opts.seconds)
  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  // WAV header (PCM, 16-bit, mono).
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); writeStr(8, 'WAVE')
  writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  writeStr(36, 'data'); view.setUint32(40, length * 2, true)

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const env = Math.min(1, t * 4) * Math.min(1, (opts.seconds - t) * 4)
    // Slight vibrato so it doesn't read as a flat test tone.
    const sample = Math.sin(2 * Math.PI * opts.freq * t + Math.sin(t * 5) * 0.5) * 0.22 * env
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true)
  }

  return saveAsset(new Blob([buffer], { type: 'audio/wav' }), 'audio/wav')
}

// ── Demo content ────────────────────────────────────────────────────────────

const PRODUCTS = [
  { name: 'Glow Lab Vitamin C Serum', from: '#f59e0b', to: '#ea580c', desc: 'A brightening daily serum with 15% vitamin C and hyaluronic acid.', market: 'Women 24–40 into skincare', pain: 'Dull, uneven skin tone; tired of products that do nothing.', usps: 'Visible glow in 7 days. Non-sticky. Fragrance-free.', benefits: 'Brighter, smoother, more even skin.', offer: '20% off your first bottle', cta: 'Shop the glow' },
  { name: 'FocusBand Sleep Tracker', from: '#6366f1', to: '#0ea5e9', desc: 'A featherweight ring that tracks sleep, HRV, and recovery.', market: 'Busy professionals 28–45', pain: 'Waking up exhausted with no idea why.', usps: '7-day battery. Clinical-grade accuracy. No subscription.', benefits: 'Understand and fix your sleep.', offer: 'Free sizing kit', cta: 'Track your sleep' },
  { name: 'CloudNine Memory Pillow', from: '#10b981', to: '#0d9488', desc: 'An adaptive memory-foam pillow that cradles your neck.', market: 'Side & back sleepers with neck pain', pain: 'Neck pain and tossing all night.', usps: 'Cooling gel layer. Adjustable loft. 100-night trial.', benefits: 'Wake up pain-free and rested.', offer: 'Buy one get one 50% off', cta: 'Sleep better tonight' },
]

const INFLUENCERS = [
  { name: 'Maya Chen', from: '#fb7185', to: '#e11d48', profile: { gender: 'Female', age: '27', ethnicity: 'East Asian', bodyType: 'slim', skinTone: 'fair', eyeColor: 'dark brown', hairColor: 'black', hairStyle: 'long straight', clothingStyle: 'casual streetwear', location: 'sunlit apartment', lighting: 'soft natural window light', expression: 'warm smile', shotType: 'medium close-up', cameraDevice: 'shot on iPhone, photorealistic, UGC selfie' } },
  { name: 'Liam Foster', from: '#38bdf8', to: '#2563eb', profile: { gender: 'Male', age: '32', ethnicity: 'Caucasian', bodyType: 'athletic', skinTone: 'medium', eyeColor: 'blue', hairColor: 'light brown', hairStyle: 'short textured', clothingStyle: 'smart casual', location: 'modern kitchen', lighting: 'bright daylight', expression: 'confident grin', shotType: 'medium shot', cameraDevice: 'shot on iPhone, photorealistic, UGC' } },
  { name: 'Sofia Reyes', from: '#a78bfa', to: '#7c3aed', profile: { gender: 'Female', age: '24', ethnicity: 'Latina', bodyType: 'curvy', skinTone: 'tan', eyeColor: 'hazel', hairColor: 'dark brown', hairStyle: 'wavy shoulder-length', clothingStyle: 'athleisure', location: 'home gym', lighting: 'soft ring light', expression: 'friendly', shotType: 'close-up', cameraDevice: 'shot on iPhone, photorealistic, UGC' } },
]

// Extra product angles (Product.extraImages — the "More Angles" strip). Seeded
// on the first product so the angle picker in every image-picking BankPicker has
// something beyond the hero shot.
const PRODUCT_ANGLES = [
  { label: 'Box open', sub: 'ANGLE · unboxed' },
  { label: 'Ingredients label', sub: 'ANGLE · back of bottle' },
]

const VOICES = [
  // The first two carry a scene + tone, which is what makes them useful as
  // Voiceovers presets (the Preset row loads delivery AND context in one tap).
  {
    label: 'Warm Female VO',
    voiceName: 'Sulafat',
    gender: 'Female' as const,
    scene: 'Speaking straight to camera in a quiet sunlit bedroom, phone at arm’s length.',
    sampleContext: 'Friendly and unhurried, like telling a friend about something that actually worked.',
  },
  {
    label: 'Confident Male VO',
    voiceName: 'Puck',
    gender: 'Male' as const,
    scene: 'Voiceover laid over fast-cut product footage.',
    sampleContext: 'Assured and punchy, landing every claim without shouting.',
  },
  { label: 'Friendly Female VO', voiceName: 'Leda', gender: 'Female' as const },
]

// Styles bank (B-Roll's saved visual looks). The brief IS the style — it's the
// paragraph appended to every prompt rendered in that look, so each describes
// only the LOOK, never anything from the frames it was read from.
const STYLES = [
  {
    name: 'Sun-Bleached Super 8',
    brief: 'Grainy sun-bleached 16mm-style footage with warm faded highlights, milky lifted blacks, and gentle gate weave. Colour skews amber and dusty rose, contrast is soft, and edges fall off into a mild halation. Movement carries a slight handheld drift and a hint of frame judder, as though shot on an old home-movie camera on a bright afternoon.',
    frames: [{ from: '#fbbf24', to: '#c2410c' }, { from: '#fda4af', to: '#b45309' }],
  },
  {
    name: 'Clean Studio Product',
    brief: 'Immaculate tabletop product photography: seamless pale backdrop, one broad soft key from high left with a subtle fill card opposite, and crisp controlled shadows pooling directly under the subject. Surfaces read glossy and precise with tight specular highlights, colour is neutral and true, and the frame is uncluttered with generous negative space. Everything is sharp, still, and deliberately composed.',
    frames: [{ from: '#e5e7eb', to: '#94a3b8' }, { from: '#f8fafc', to: '#cbd5e1' }],
  },
  {
    name: 'Night Neon UGC',
    brief: 'Handheld night footage lit by whatever the city provides: magenta and cyan neon spill, wet reflective surfaces, and deep shadows that hold visible sensor noise. Highlights bloom and smear slightly, white balance shifts between sources, and focus hunts for a beat before settling. Raw, unpolished, and alive with ambient light.',
    frames: [{ from: '#a855f7', to: '#0e7490' }, { from: '#ec4899', to: '#1e1b4b' }],
  },
]

const SCRIPT_TEXT_1 = `Okay so I almost returned this serum… and now I'm on my third bottle.\n\nMy skin was so dull I'd cake on foundation just to look awake. Nothing worked.\n\nThen I tried this for a week — and people literally asked if I'd been on holiday.\n\nIt's 15% vitamin C, no sticky finish, zero fragrance. I just put it on, glow, done.\n\nThey're doing 20% off right now. Don't sleep on it.`
const SCRIPT_TEXT_2 = `I thought I was just "bad at sleeping." Turns out I had no idea what was actually happening at night.\n\nThis little ring tracks my sleep, recovery, all of it — seven day battery, no subscription.\n\nFirst week it told me my late coffee was wrecking my deep sleep. Cut it. Now I actually wake up rested.\n\nIf you wake up tired for no reason, this is the move.`
// Ad Analyzer's product-agnostic Script Style Prompt, saved to the Script Bank
// as kind 'style' — the reusable recipe, not a script for one product.
const STYLE_PROMPT = `STYLE: Skeptic-to-believer UGC testimonial.\n\nOpen on an admission that undercuts the ad ("I almost returned this") so the viewer reads it as a real opinion, not a pitch. Spend the next beat on the problem in concrete, unflattering detail — what it actually looked and felt like day to day. Turn on a specific moment of proof someone else noticed, never a claim about the product itself. Only then state the mechanism in plain specs, flatly, as though it barely matters. Close on a casual, low-pressure CTA with the current offer.\n\nDelivery: talking straight to the front camera, unscripted cadence, no adjectives a real person wouldn't use. Name the product at most twice.`

const SCENE_PROMPT = `SCENE 1 — A-ROLL CHARACTER: @INFLUENCER talking to camera in a sunlit apartment, holding @PRODUCT, warm natural light, UGC selfie framing.\n\nSCENE 2 — B-ROLL DETAIL: extreme close-up of @PRODUCT, water droplets, soft studio light.\n\nSCENE 3 — A-ROLL PRODUCT: @INFLUENCER applying @PRODUCT in a mirror, satisfied expression.`

const BROLLS = [
  { from: '#f59e0b', to: '#b45309', prompt: 'Close-up of a glass serum bottle on a marble counter, morning light, water droplets, photorealistic.' },
  { from: '#6366f1', to: '#1e3a8a', prompt: 'Smart ring resting on a nightstand next to a phone showing a sleep graph, moody blue light.' },
  { from: '#10b981', to: '#065f46', prompt: 'Memory-foam pillow on a freshly made bed, soft side light, cozy bedroom.' },
  { from: '#fb7185', to: '#9f1239', prompt: 'Influencer holding product up to camera, bright kitchen, UGC selfie style.' },
]

// A full B-Roll Studio session for the Glow Lab serum — scenes with variations,
// each carrying a placeholder generation so the scene grid looks worked-on.
// @INFLUENCER / @PRODUCT tokens mirror what the real scene-generation LLM emits.
// Three variations per scene, matching VARIATIONS_PER_SCENE — a seeded session
// has to fill the same four-cell row a real one does.
const BROLL_SESSION_SCENES = [
  {
    type: 'A-ROLL CHARACTER' as const,
    scriptLine: "Okay so I almost returned this serum… and now I'm on my third bottle.",
    position: 'hook' as const,
    productVisible: false,
    variations: [
      { tag: 'DIALOGUE' as const, label: 'Talking to camera', refs: 'character' as const, from: '#fb7185', to: '#e11d48', prompt: "@INFLUENCER sits on the edge of her bed, phone held at arm's length, talking candidly into the front camera in a sunlit apartment. Natural handheld micro-jitter, UGC selfie framing, no on-screen text." },
      { tag: 'EMOTIONAL' as const, label: 'Skeptical glance', refs: 'character' as const, from: '#f472b6', to: '#be123c', prompt: '@INFLUENCER raises an eyebrow at the camera, half-smiling in disbelief, soft window light across her face, tight close-up UGC selfie.' },
      { tag: 'ACTION' as const, label: 'The return box', refs: 'both' as const, from: '#e879f9', to: '#831843', prompt: 'A half-packed return box sits open on a bedroom floor with @PRODUCT balanced on the flap, a hand lifting it back out again, flat afternoon light, handheld close shot.' },
    ],
  },
  {
    type: 'B-ROLL DETAIL' as const,
    scriptLine: "It's 15% vitamin C, no sticky finish, zero fragrance.",
    position: 'mechanism' as const,
    productVisible: true,
    variations: [
      { tag: 'PRODUCT' as const, label: 'Product detail', refs: 'product' as const, from: '#f59e0b', to: '#b45309', prompt: 'Extreme close-up of @PRODUCT glass bottle on a marble vanity, a single drop sliding down the dropper, soft morning light, photorealistic.' },
      { tag: 'ACTION' as const, label: 'Applying serum', refs: 'both' as const, from: '#fbbf24', to: '#d97706', prompt: '@INFLUENCER dispenses @PRODUCT onto her fingertips and pats it across her cheek in front of the bathroom mirror, bright daylight, UGC handheld.' },
      { tag: 'PROOF' as const, label: 'Label in focus', refs: 'product' as const, from: '#fcd34d', to: '#92400e', prompt: 'Macro rack-focus across the back label of @PRODUCT until the 15% vitamin C line snaps sharp, fingers rotating the bottle slowly, soft window light.' },
    ],
  },
  {
    type: 'A-ROLL PRODUCT' as const,
    scriptLine: "They're doing 20% off right now. Don't sleep on it.",
    position: 'CTA' as const,
    productVisible: true,
    variations: [
      { tag: 'DIALOGUE' as const, label: 'Direct CTA', refs: 'both' as const, from: '#fb7185', to: '#9f1239', prompt: '@INFLUENCER holds @PRODUCT up beside her face, grinning at the camera as she delivers the call to action, warm natural light, UGC selfie.' },
      { tag: 'PRODUCT' as const, label: 'Hero shot', refs: 'product' as const, from: '#f59e0b', to: '#c2410c', prompt: '@PRODUCT standing centered on a clean countertop with soft shadows and a subtle glow, lifestyle hero shot, photorealistic.' },
      { tag: 'ENVIRONMENT' as const, label: 'Shelf lineup', refs: 'both' as const, from: '#fb923c', to: '#7c2d12', prompt: '@PRODUCT sitting at the front of a lived-in bathroom shelf among everyday bottles, morning light through frosted glass, shot from just above shelf height.' },
    ],
  },
]

// A full B-Roll Continuous (keyframe-chain) session for the same serum. N
// script lines → N scenes + N+1 keyframes, where keyframe N+1 is both scene N's
// end state and scene N+1's start, so each clip is a frames-to-video gen. Three
// concepts per frame, matching CONCEPTS_PER_FRAME — the seeded session has to
// look like a real one, and a short row reads as a bug in the app.
const CONTINUOUS_SCENES = [
  {
    scriptLine: "Okay so I almost returned this serum… and now I'm on my third bottle.",
    motion: 'She lowers the bottle from beside her face and sets it down on the counter as she keeps talking, the camera easing a few inches closer over the move. Soft room tone under her voice.',
    sfx: 'quiet bedroom ambience',
    durationSeconds: 5,
    productVisible: true,
  },
  {
    scriptLine: "It's 15% vitamin C, no sticky finish, zero fragrance.",
    motion: 'Her hand enters frame and tips the dropper, a single bead swelling and releasing onto her fingertips while the camera holds still. A faint glassy tap as the dropper returns.',
    sfx: 'soft glass tap',
    durationSeconds: 5,
    productVisible: true,
  },
  {
    scriptLine: "They're doing 20% off right now. Don't sleep on it.",
    motion: 'She turns back toward the lens mid-sentence, breaking into a grin as the camera settles level with her eyes. Room tone only.',
    sfx: 'room tone',
    durationSeconds: 5,
    productVisible: true,
  },
]

// Keyframes: one per scene plus the closing end state. Each concept is a
// different way to stage the same story state, caught at the instant its action
// begins — the start-frame rule the real storyboard prompt enforces.
const CONTINUOUS_FRAMES = [
  {
    concepts: [
      { label: 'Bottle beside her face', shot: 'medium', from: '#fb7185', to: '#e11d48', prompt: 'A young woman sits on the edge of her bed in a sunlit bedroom, the serum bottle just lifted beside her cheek, mouth open on the first word. Warm window light rakes across her face from the left, the room soft and lived-in behind her, camera at eye level about a metre away.' },
      { label: 'Caught mid-shrug', shot: 'close-up', from: '#f472b6', to: '#9f1239', prompt: 'Close on the same woman as her shoulders start to rise into a disbelieving shrug, eyebrows lifting, the bottle held loosely at chest height. Soft daylight from a window off to her left, plain wall behind, camera at eye level and close enough to hold her face and hands.' },
      { label: 'Reaching for the return box', shot: 'medium-wide', from: '#e879f9', to: '#831843', prompt: 'She sits cross-legged on the bedroom floor beside a half-packed return box, hand just starting to lower the serum toward it, head turning toward the lens as she speaks. Flat afternoon light from a window behind her, camera at floor level a couple of metres back.' },
    ],
  },
  {
    concepts: [
      { label: 'Bottle meets counter', shot: 'medium', from: '#f59e0b', to: '#b45309', prompt: 'The serum bottle is set down on a pale marble counter, her fingers still curled around the glass as it makes contact. Morning light from a window to the right throws a soft shadow across the stone, camera just above counter height and close.' },
      { label: 'Reaching for the dropper', shot: 'close-up', from: '#fbbf24', to: '#c2410c', prompt: 'Her hand reaches into frame toward the dropper cap of the serum standing on a marble counter, fingertips a few centimetres away and closing. Bright diffused daylight, shallow clean background, camera low and level with the bottle.' },
      { label: 'Bottle lands in the lineup', shot: 'medium', from: '#fcd34d', to: '#92400e', prompt: 'The serum is set down at the end of a row of bathroom shelf bottles, her fingers still on the glass as it meets the shelf. Warm side light from a frosted window, tiled wall behind, camera level with the shelf a step back.' },
    ],
  },
  {
    concepts: [
      { label: 'Drop about to fall', shot: 'macro', from: '#fde68a', to: '#d97706', prompt: 'Macro on the glass dropper held above open fingertips, a single bead of serum swelling at the tip on the point of releasing. Soft bright daylight catches the amber liquid, background falls to a clean blur, camera inches from the dropper.' },
      { label: 'Patting it in', shot: 'close-up', from: '#fb923c', to: '#9a3412', prompt: 'Her fingertips make first contact with her cheekbone, serum still glossy on the skin, the pat only just beginning. Bathroom mirror light, soft and even, camera at eye level and close on the side of her face.' },
      { label: 'Palm tips toward the face', shot: 'medium', from: '#f97316', to: '#7c2d12', prompt: 'She raises her cupped palm toward her cheek, the serum pooled in it and beginning to tilt, chin lifting to meet the movement. Even daylight from a window ahead of her, soft bathroom background, camera at eye level a step away.' },
    ],
  },
  {
    concepts: [
      { label: 'Turning back to camera', shot: 'medium', from: '#fb7185', to: '#9f1239', prompt: 'She begins turning her head back toward the lens, a grin starting at one corner of her mouth, the serum bottle raised beside her jaw. Warm window light, the sunlit bedroom soft behind her, camera at eye level about a metre out.' },
      { label: 'Hero on the counter', shot: 'medium', from: '#f59e0b', to: '#c2410c', prompt: 'The serum bottle stands alone and centred on a clean pale counter as her hand withdraws from frame, soft shadow anchoring it to the surface. Warm daylight from the left, uncluttered background, camera level with the bottle.' },
      { label: 'Settled back on the bed', shot: 'medium-wide', from: '#fda4af', to: '#7f1d1d', prompt: 'She settles back onto the end of the bed with the serum resting in her lap, still half-smiling at the lens. Warm window light across the duvet, the bedroom soft and open behind her, camera at seated eye level a couple of metres out.' },
    ],
  },
]

// Playground video generations. Portrait UGC clips + one landscape hero shot,
// each a short captured canvas animation. sourceApp 'playground' so they land in
// the Playground video tab (B-Roll-sourced videos are filtered out there).
const VIDEO_GENS = [
  { w: 540, h: 960, from: '#fb7185', to: '#9f1239', modelId: 'bytedance/seedance-2', mode: 'reference-to-video' as const, aspectRatio: '9:16', label: 'UGC Selfie', sub: 'talking to camera', prompt: 'A young woman in a sunlit apartment holds the serum up to the front camera and talks candidly, natural handheld micro-jitter, UGC selfie framing.' },
  { w: 540, h: 960, from: '#f59e0b', to: '#b45309', modelId: 'grok-imagine-video-1-5-preview', mode: 'image-to-video' as const, aspectRatio: '9:16', label: 'Product Detail', sub: 'dropper close-up', prompt: 'Extreme close-up of a glass serum bottle on a marble vanity, a single drop sliding down the dropper, soft morning light, slow push-in.' },
  { w: 960, h: 540, from: '#6366f1', to: '#1e3a8a', modelId: 'bytedance/seedance-2', mode: 'text-to-video' as const, aspectRatio: '16:9', label: 'Sleep Tracker Hero', sub: 'nightstand pan', prompt: 'Smart ring resting on a nightstand beside a phone showing a sleep graph, moody blue light, slow camera pan, cinematic.' },
]

// Playground music generations.
const MUSIC_GENS = [
  { from: '#7c3aed', to: '#4c1d95', freq: 220, title: 'Sunrise Glow', instrumental: true, durationSeconds: 32, prompt: 'Warm uplifting lo-fi beat with soft piano and mellow drums, optimistic and clean, perfect for a skincare ad.' },
  { from: '#0ea5e9', to: '#1e3a8a', freq: 330, title: 'Night Routine', instrumental: false, durationSeconds: 28, prompt: 'Chill downtempo electronic track with a dreamy vocal hook about winding down, relaxed nighttime vibe.' },
]

// Ad Analyzer history — two completed analyses (one video, one image) with a
// full scorecard / transcript / reverse-engineered scene blueprint so the
// Ad Analyzer history + detail views are populated. `result` mirrors
// ad-anatomy's AnalysisResult shape (stored opaquely on the bank row).
const AD_ANALYSES = [
  {
    id: 'demo-ad-0',
    from: '#22d3ee', to: '#0e7490',
    adTitle: 'Vitamin C Serum Testimonial',
    fileName: 'glow-serum-ugc.mp4',
    mediaKind: 'video' as const,
    result: {
      adTitle: 'Vitamin C Serum Testimonial',
      scorecard: {
        scores: [
          { label: 'Hook Strength', score: 9 },
          { label: 'Clarity', score: 8 },
          { label: 'Emotional Pull', score: 7 },
          { label: 'CTA Strength', score: 8 },
          { label: 'Production Quality', score: 6 },
        ],
        analystNote: 'Strong pattern-interrupt hook ("almost returned this") earns the watch. The skeptic-to-believer arc is textbook UGC. CTA is clear but could land harder with on-screen urgency. Production is intentionally raw, which suits the format.',
      },
      transcript: [
        { timestamp: '00:00', text: "Okay so I almost returned this serum… and now I'm on my third bottle." },
        { timestamp: '00:04', text: 'My skin was so dull I’d cake on foundation just to look awake.' },
        { timestamp: '00:09', text: 'Then I tried this for a week and people asked if I’d been on holiday.' },
        { timestamp: '00:15', text: 'It’s 15% vitamin C, no sticky finish, zero fragrance.' },
        { timestamp: '00:21', text: 'They’re doing 20% off right now. Don’t sleep on it.' },
      ],
      reverseEngineeredPrompt: {
        totalDurationSeconds: 25,
        isSingleClip: false,
        masterVisualStyle: {
          styleId: 'ugc',
          label: 'UGC Realism',
          liveAction: true,
          brief: 'Handheld phone footage with the flat wide-lens rendering of a front camera: mild sensor noise in the shadows, a slight wobble on every movement, and no grade at all. Skin keeps its real texture, stray hairs and a shine on the forehead; the cream sweater wrinkles where an arm bends. Colour runs warm and slightly uneven — daylight through one window against a cooler bulb further back — with open shadows and a blown highlight on the wall behind. Framing sits casually off-centre, sharp edge to edge with almost no falloff, no vignette and no gloss anywhere.',
        },
        masterVoiceProfile: {
          label: 'Bright American Female, Mid-20s',
          traits: ['Female, mid-20s', 'General American', 'Fast, conversational', 'Slight vocal fry'],
          delivery: 'On camera throughout, talking straight into the lens with her mouth in sync; the same voice continues over the product close-up as a voiceover.',
          profile: 'A mid-pitched female voice in her mid-twenties, General American with no regional colour, running fast and conversational with the pace of someone telling a friend something before they forget it. The texture is warm and slightly breathy at the top of a sentence, dropping into a light vocal fry on the last two or three words of every line. Energy is up but never announced — she sounds amused rather than excited. Sentences trail upward at the end like a question even when they are not, and she half-laughs through the word before her punchline.',
        },
        scenes: [
          { index: 1, startTime: '00:00', endTime: '00:09', durationSeconds: 9, label: 'Hook — Skeptic', prompt: 'Young woman talking candidly to the front camera in a sunlit apartment, raw UGC selfie, handheld.' },
          { index: 2, startTime: '00:09', endTime: '00:15', durationSeconds: 6, label: 'Mechanism', prompt: 'Close-up of the serum bottle, dropper detail, soft morning light.' },
          { index: 3, startTime: '00:15', endTime: '00:25', durationSeconds: 10, label: 'CTA', prompt: 'Woman holds the product beside her face, smiling, delivering the call to action.' },
        ],
      },
    },
  },
  {
    id: 'demo-ad-1',
    from: '#f472b6', to: '#be185d',
    adTitle: 'Sleep Ring Static Ad',
    fileName: 'sleep-ring-static.jpg',
    mediaKind: 'image' as const,
    result: {
      adTitle: 'Sleep Ring Static Ad',
      scorecard: {
        scores: [
          { label: 'Hook Strength', score: 6 },
          { label: 'Clarity', score: 9 },
          { label: 'Emotional Pull', score: 5 },
          { label: 'CTA Strength', score: 7 },
          { label: 'Production Quality', score: 9 },
        ],
        analystNote: 'Clean, premium static that communicates the value prop instantly. Loses points on emotional pull — it’s feature-forward rather than story-forward. The headline does the heavy lifting; a benefit-led variant could test well.',
      },
      transcript: [
        { timestamp: '00:00', text: 'Headline: "Know why you wake up tired."' },
        { timestamp: '00:00', text: 'Subhead: 7-day battery. No subscription.' },
      ],
      reverseEngineeredPrompt: {
        totalDurationSeconds: 0,
        isSingleClip: true,
        // No voice profile on purpose — a static ad has nothing to hear, which
        // is exactly how a real analysis of one comes back.
        masterVisualStyle: {
          styleId: 'other',
          label: 'Premium product still',
          liveAction: true,
          brief: 'Studio product photography finished like a brand campaign: one hero object, critically sharp, on a seamless dark surface with a soft reflection under it. Forms read as machined and exact — polished titanium against matte charcoal, every edge clean, no clutter in frame. The palette is near-monochrome navy and graphite with a single cool cyan accent glowing from a screen just off the subject. Light is a large soft source from high camera-left plus a hard rim along the far edge, shadows deep and controlled with no fill spill. Shallow depth of field, gentle falloff into black, faint bloom on the accent, no grain.',
        },
        scenes: [
          { index: 1, startTime: '00:00', endTime: '00:00', durationSeconds: 0, label: 'Static Hero', prompt: 'Smart ring on a dark nightstand beside a glowing sleep-graph phone, premium product photography, moody blue light.' },
        ],
      },
    },
  },
]

// ── Seed ─────────────────────────────────────────────────────────────────

function idSnapshot() {
  const s = useBankStore.getState()
  return {
    products: s.products.map((x) => x.id),
    models: s.models.map((x) => x.id),
    scripts: s.scripts.map((x) => x.id),
    voices: s.voices.map((x) => x.id),
    brolls: s.brolls.map((x) => x.id),
    styles: s.styles.map((x) => x.id),
    characterHistory: s.characterHistory.map((x) => x.id),
    scriptHistory: s.scriptHistory.map((x) => x.id),
    imageHistory: s.imageHistory.map((x) => x.id),
    brollHistory: s.brollHistory.map((x) => x.id),
    videoHistory: s.videoHistory.map((x) => x.id),
    voiceHistory: s.voiceHistory.map((x) => x.id),
    musicHistory: s.musicHistory.map((x) => x.id),
    adAnatomyHistory: s.adAnatomyHistory.map((x) => x.id),
  }
}

function diffNewIds(before: ReturnType<typeof idSnapshot>): Manifest {
  const after = idSnapshot()
  const out = { ...EMPTY_MANIFEST }
  // usageDays isn't a bank of rows we add by id — the seeder fills it in
  // separately (only on days that had no row) and sets it on the manifest.
  for (const key of Object.keys(after) as (keyof typeof after)[]) {
    const had = new Set(before[key])
    out[key] = after[key].filter((id) => !had.has(id))
  }
  return out
}

export async function seedMockData(): Promise<void> {
  if (hasMockData()) return
  const store = useBankStore.getState()
  const before = idSnapshot()

  // Suppress the per-row "saved" toasts during the bulk insert — we surface a
  // single summary toast at the end instead.
  const realAddToast = useAppStore.getState().addToast
  useAppStore.setState({ addToast: () => {} })

  // Demo rows go through the same add*History actions as real generations —
  // keep them out of the Dashboard's usage ledger (removeMockData couldn't
  // undo the inflated savings/streaks).
  setUsageRecordingSuppressed(true)

  try {
    const now = Date.now()
    // Stagger createdAt so day-bucketing + sort order look natural.
    const ago = (i: number) => now - i * 11 * 60 * 1000

    // Products
    const productImages: string[] = []
    for (let i = 0; i < PRODUCTS.length; i++) {
      const p = PRODUCTS[i]
      const img = await makeImageAsset({ w: 1024, h: 1024, from: p.from, to: p.to, label: p.name, sub: 'PRODUCT' })
      productImages.push(img)
      // Extra angles on the first product only — one product with a populated
      // "More Angles" strip is enough to exercise every image-picking BankPicker.
      const extraImages = i === 0
        ? await Promise.all(
            PRODUCT_ANGLES.map((a) =>
              makeImageAsset({ w: 1024, h: 1024, from: p.from, to: p.to, label: a.label, sub: a.sub }),
            ),
          )
        : undefined
      await store.addProduct({
        ...(extraImages ? { extraImages } : {}),
        productImage: img,
        productName: p.name,
        productDescription: p.desc,
        targetMarket: p.market,
        painPoints: p.pain,
        usps: p.usps,
        benefits: p.benefits,
        offer: p.offer,
        cta: p.cta,
        confirmed: true,
      })
    }

    // Influencers (models) — last one carries a character sheet.
    for (let i = 0; i < INFLUENCERS.length; i++) {
      const m = INFLUENCERS[i]
      const portrait = await makeImageAsset({ w: 768, h: 1365, from: m.from, to: m.to, label: m.name, sub: 'CHARACTER' })
      const isSheet = i === INFLUENCERS.length - 1
      const sheet = isSheet
        ? await makeImageAsset({ w: 1365, h: 768, from: m.from, to: m.to, label: `${m.name} — Sheet`, sub: 'turnaround · expressions · full body' })
        : undefined
      await store.addModel({
        name: m.name,
        characterImage: portrait,
        jsonProfile: m.profile as Record<string, unknown>,
        notes: '',
        source: 'character-studio',
        ...(sheet ? { sheetImage: sheet } : {}),
      })
    }

    // Scripts bank
    await store.addScript({ title: 'Glow Serum — Almost Returned It', scriptText: SCRIPT_TEXT_1, linkedProductId: '', source: 'script-architect', kind: 'remix' })
    await store.addScript({ title: 'Sleep Tracker — Bad At Sleeping', scriptText: SCRIPT_TEXT_2, linkedProductId: '', source: 'script-architect', kind: 'remix' })
    await store.addScript({ title: 'Serum Ad — Scene Blueprint', scriptText: SCENE_PROMPT, linkedProductId: '', source: 'script-architect', kind: 'reverse-engineer' })
    // A saved Script Style Prompt — what Ad Analyzer writes into the Script Bank
    // (kind 'style'): product-agnostic, so it can be pointed at anything.
    await store.addScript({ title: 'Skeptic-to-Believer UGC', scriptText: STYLE_PROMPT, linkedProductId: '', source: 'script-architect', kind: 'style' })

    // Voices bank — presets carry their scene/tone, so loading one fills the
    // whole right panel in a tap.
    for (const v of VOICES) {
      await store.addVoice({
        label: v.label,
        voiceId: v.voiceName,
        voiceName: v.voiceName,
        gender: v.gender,
        style: 'Vocal Smile',
        pace: 'Natural',
        accent: 'Neutral',
        temperature: 1,
        linkedModelId: '',
        ...('scene' in v ? { scene: v.scene, sampleContext: v.sampleContext } : {}),
      })
    }

    // Styles bank — B-Roll's saved looks, each with its reference frames.
    for (const s of STYLES) {
      const thumbRefs: string[] = []
      for (let i = 0; i < s.frames.length; i++) {
        const f = s.frames[i]
        thumbRefs.push(await makeImageAsset({ w: 768, h: 1365, from: f.from, to: f.to, label: s.name, sub: `reference ${i + 1}` }))
      }
      await store.addStyle({ name: s.name, brief: s.brief, thumbRefs })
    }

    // B-Roll bank stills (sourceApp 'broll-studio' → show in B-Roll's Gallery)
    for (let i = 0; i < BROLLS.length; i++) {
      const b = BROLLS[i]
      const img = await makeImageAsset({ w: 768, h: 1365, from: b.from, to: b.to, label: `B-Roll ${i + 1}`, sub: 'broll-studio' })
      await store.addBRoll({ imageUrl: img, prompt: b.prompt, sourceApp: 'broll-studio' })
    }

    // Influencers tab — generation history (portraits + a sheet)
    for (let i = 0; i < INFLUENCERS.length; i++) {
      const m = INFLUENCERS[i]
      const img = await makeImageAsset({ w: 768, h: 1365, from: m.from, to: m.to, label: m.name, sub: 'portrait' })
      const item: CharacterHistoryItem = {
        id: `demo-char-${i}`,
        imageRef: img,
        profile: m.profile,
        modelId: 'gpt-image-2-text-to-image',
        aspectRatio: '9:16',
        resolution: '1K',
        kind: 'portrait',
        createdAt: ago(i + 1),
      }
      await store.addCharacterHistory(item)
    }
    const sheetSubject = INFLUENCERS[2]
    const sheetImg = await makeImageAsset({ w: 1365, h: 768, from: sheetSubject.from, to: sheetSubject.to, label: `${sheetSubject.name} — Sheet`, sub: 'reference sheet' })
    await store.addCharacterHistory({
      id: 'demo-char-sheet',
      imageRef: sheetImg,
      profile: sheetSubject.profile,
      modelId: 'gpt-image-2-image-to-image',
      aspectRatio: '16:9',
      resolution: '4K',
      kind: 'sheet',
      createdAt: ago(0),
    })

    // Scripts tab — generation history
    const scriptHistory: ScriptHistoryItem[] = [
      {
        id: 'demo-script-hist-0',
        mode: 'write',
        variations: [SCRIPT_TEXT_1, SCRIPT_TEXT_1.replace('third bottle', 'second bottle'), SCRIPT_TEXT_1.replace('20% off', 'a bundle deal')],
        inputSummary: 'Glow Lab Vitamin C Serum — Problem/Agitate/Solution',
        productName: 'Glow Lab Vitamin C Serum',
        brief: 'Skincare serum, target women 24-40, emphasize the visible glow',
        writeStyle: 'Problem–Agitate–Solution',
        writeFormat: 'script',
        writeLength: 30,
        createdAt: ago(2),
      },
      {
        id: 'demo-script-hist-1',
        mode: 'remix',
        variations: [SCRIPT_TEXT_2, SCRIPT_TEXT_2.replace('seven day battery', 'a week of battery'), SCRIPT_TEXT_2.replace('late coffee', 'evening screen time')],
        inputSummary: 'FocusBand Sleep Tracker — testimonial remix',
        productName: 'FocusBand Sleep Tracker',
        winningTranscript: SCRIPT_TEXT_2,
        createdAt: ago(4),
      },
      {
        id: 'demo-script-hist-2',
        mode: 'reverse-engineer',
        variations: [SCENE_PROMPT],
        inputSummary: 'Serum ad — scene blueprint',
        reversePrompt: SCENE_PROMPT,
        createdAt: ago(6),
      },
    ]
    for (const item of scriptHistory) await store.addScriptHistory(item)

    // Playground — image generation history
    for (let i = 0; i < 3; i++) {
      const b = BROLLS[i]
      const img = await makeImageAsset({ w: 768, h: 1365, from: b.from, to: b.to, label: `Playground ${i + 1}`, sub: 'image' })
      const item: ImageHistoryItem = {
        id: `demo-img-${i}`,
        modelId: 'nano-banana-2',
        prompt: b.prompt,
        aspectRatio: '9:16',
        resolution: '1K',
        imageUrl: img,
        createdAt: ago(i),
      }
      await store.addImageHistory(item)
    }

    // Playground — video generation history. Each clip is a short captured
    // canvas animation, so the Playground video tab + preview modal have real
    // playable content. Guarded per-item: a browser that can't record (older
    // Safari) just skips videos rather than aborting the whole seed.
    for (let i = 0; i < VIDEO_GENS.length; i++) {
      const v = VIDEO_GENS[i]
      try {
        const videoUrl = await makeVideoAsset({ w: v.w, h: v.h, from: v.from, to: v.to, label: v.label, sub: v.sub })
        const thumb = await makeImageAsset({ w: v.w, h: v.h, from: v.from, to: v.to, label: v.label, sub: v.sub })
        const item: VideoHistoryItem = {
          id: `demo-video-${i}`,
          modelId: v.modelId,
          prompt: v.prompt,
          mode: v.mode,
          aspectRatio: v.aspectRatio,
          durationSeconds: 5,
          resolution: '1080p',
          audio: true,
          videoUrl,
          thumbnailUrl: thumb,
          sourceApp: 'playground',
          createdAt: ago(i),
        }
        await store.addVideoHistory(item)
      } catch (e) {
        console.warn('[mockData] video seed skipped', e)
      }
    }

    // Voiceovers — generation history. Synthesized WAV tone per row so the
    // player actually plays. Pairs the demo voices with the demo script copy.
    const voiceScripts = [SCRIPT_TEXT_1, SCRIPT_TEXT_2, SCRIPT_TEXT_1]
    for (let i = 0; i < VOICES.length; i++) {
      const v = VOICES[i]
      const seconds = 6 + i * 2
      const audioUrl = await makeAudioAsset({ seconds, freq: 196 + i * 55 })
      const scriptText = voiceScripts[i] ?? SCRIPT_TEXT_1
      const item: VoiceHistoryItem = {
        id: `demo-voice-hist-${i}`,
        voiceId: v.voiceName,
        voiceName: v.voiceName,
        gender: v.gender,
        style: 'Vocal Smile',
        pace: 'Natural',
        accent: 'Neutral',
        temperature: 1,
        scriptText,
        scriptPreview: scriptText.replace(/\n+/g, ' ').slice(0, 120),
        audioUrl,
        duration: seconds,
        createdAt: ago(i + 1),
      }
      await store.addVoiceHistory(item)
    }

    // Playground — music generation history. WAV tone + square cover art.
    for (let i = 0; i < MUSIC_GENS.length; i++) {
      const m = MUSIC_GENS[i]
      const audioRef = await makeAudioAsset({ seconds: 10, freq: m.freq })
      const cover = await makeImageAsset({ w: 1024, h: 1024, from: m.from, to: m.to, label: m.title, sub: 'TRACK' })
      const item: MusicHistoryItem = {
        id: `demo-music-${i}`,
        modelId: 'suno-v5',
        prompt: m.prompt,
        instrumental: m.instrumental,
        audioRef,
        coverImageRef: cover,
        title: m.title,
        durationSeconds: m.durationSeconds,
        createdAt: ago(i),
      }
      await store.addMusicHistory(item)
    }

    // Ad Analyzer — completed analyses with scorecard + transcript + blueprint.
    for (let i = 0; i < AD_ANALYSES.length; i++) {
      const a = AD_ANALYSES[i]
      const thumb = await makeImageAsset({
        w: a.mediaKind === 'image' ? 1024 : 768,
        h: a.mediaKind === 'image' ? 1024 : 1365,
        from: a.from, to: a.to, label: a.adTitle, sub: a.mediaKind.toUpperCase(),
      })
      const item: AdAnatomyHistoryItem = {
        id: a.id,
        createdAt: ago(i + 2),
        status: 'complete',
        adTitle: a.adTitle,
        fileName: a.fileName,
        mediaKind: a.mediaKind,
        thumbnailRef: thumb,
        result: a.result,
      }
      await store.addAdAnatomyHistory(item)
    }

    // B-Roll Studio — a full worked session: scenes with variations, each
    // carrying a placeholder generation. Saved to brollHistory (History tab)
    // and mirrored into the live workspace draft so the B-Roll tab opens onto
    // populated scenes.
    const fresh = useBankStore.getState()
    const sessionProductId = fresh.products.find((p) => p.productName === PRODUCTS[0].name)?.id
    const sessionModelId = fresh.models.find((m) => m.name === INFLUENCERS[0].name)?.id
    const toToggles = (refs: string) => ({
      refsCharacter: refs === 'character' || refs === 'both',
      refsProduct: refs === 'product' || refs === 'both',
    })

    const scenes: Array<Record<string, unknown>> = []
    const cardStates: Record<string, unknown> = {}
    let brollTick = 0
    for (let si = 0; si < BROLL_SESSION_SCENES.length; si++) {
      const sc = BROLL_SESSION_SCENES[si]
      const sceneNumber = si + 1
      const variations: Array<Record<string, unknown>> = []
      for (let vi = 0; vi < sc.variations.length; vi++) {
        const v = sc.variations[vi]
        variations.push({ id: `demo-broll-s${sceneNumber}-v${vi}`, tag: v.tag, label: v.label, refs: v.refs, prompt: v.prompt })
        const img = await makeImageAsset({ w: 768, h: 1365, from: v.from, to: v.to, label: `Scene ${sceneNumber}`, sub: v.label })
        // The first variation of the first two scenes is animated as well, so
        // the grid shows video covers and "Download clips" has something to zip.
        // The rest stay stills — which is also what leaves the new "Generate all
        // videos" batch with real work to do.
        const withClip = vi === 0 && si < 2
        let videos: Array<Record<string, unknown>> = []
        if (withClip) {
          try {
            const clip = await makeVideoAsset({ w: 540, h: 960, from: v.from, to: v.to, label: `Scene ${sceneNumber}`, sub: v.label })
            videos = [{
              url: clip,
              modelId: BROLL_VIDEO_MODEL_ID,
              prompt: v.prompt,
              aspectRatio: '9:16',
              durationSeconds: 5,
              resolution: '480p',
              audio: true,
              mode: 'image-to-video',
              createdAt: ago(brollTick),
            }]
            await store.addVideoHistory({
              id: `demo-broll-clip-${sceneNumber}`,
              modelId: BROLL_VIDEO_MODEL_ID,
              prompt: v.prompt,
              mode: 'image-to-video',
              aspectRatio: '9:16',
              durationSeconds: 5,
              resolution: '480p',
              audio: true,
              videoUrl: clip,
              thumbnailUrl: img,
              sourceApp: 'broll-studio',
              createdAt: ago(brollTick),
            } satisfies VideoHistoryItem)
          } catch (e) {
            console.warn('[mockData] b-roll clip seed skipped', e)
          }
        }
        cardStates[`${sceneNumber}-${vi}`] = {
          editablePrompt: v.prompt,
          promptHistory: [v.prompt],
          promptHistoryIndex: 0,
          images: [{ imageUrl: img, prompt: v.prompt, modelId: 'nano-banana-2', createdAt: ago(brollTick++) }],
          currentImageIndex: 0,
          videos,
          currentVideoIndex: 0,
          // Cover = the clip when there is one (that's what the card face plays
          // and what Download clips pre-ticks), otherwise the still.
          selected: videos.length > 0 ? { kind: 'video', index: 0 } : { kind: 'image', index: 0 },
          ...toToggles(v.refs),
        }
      }
      scenes.push({ number: sceneNumber, type: sc.type, scriptLine: sc.scriptLine, position: sc.position, productVisible: sc.productVisible, variations })
    }
    const brollResult = { scenes }

    await store.upsertBrollHistory({
      id: BROLL_SESSION_ID,
      createdAt: ago(0),
      inputSummary: 'Glow Lab Vitamin C Serum — almost returned it, now on my third bottle',
      productId: sessionProductId,
      modelId: sessionModelId,
      scriptText: SCRIPT_TEXT_1,
      result: brollResult,
      cardStates,
    } satisfies BrollHistoryItem)

    // B-Roll Continuous — a worked keyframe-chain session: every concept
    // rendered, a keyframe picked per frame, and the first two clips animated.
    // It lives in History rather than the live draft (the workspace holds one
    // session, and the Line-by-Line one above owns it) — clicking the row
    // restores the whole chain, mode toggle included.
    const contStyle = getContinuousStyle('ugc')
    const contScenes = CONTINUOUS_SCENES.map((s, i) => ({
      index: i + 1,
      scriptLine: s.scriptLine,
      motionPrompt: s.motion,
      sfx: s.sfx,
      durationSeconds: s.durationSeconds,
      productVisible: s.productVisible,
    }))
    const contFrames: Array<Record<string, unknown>> = []
    const contFrameStates: Record<string, unknown> = {}
    const contSelections: Record<string, unknown> = {}
    let contTick = 0
    for (let fi = 0; fi < CONTINUOUS_FRAMES.length; fi++) {
      const frameIndex = fi + 1
      const isFinal = fi === CONTINUOUS_FRAMES.length - 1
      const concepts: Array<Record<string, unknown>> = []
      for (let ci = 0; ci < CONTINUOUS_FRAMES[fi].concepts.length; ci++) {
        const c = CONTINUOUS_FRAMES[fi].concepts[ci]
        const conceptId = `demo-cont-f${frameIndex}-c${ci}`
        concepts.push({
          id: conceptId,
          label: c.label,
          shot: c.shot,
          prompt: c.prompt,
          refs: 'both',
          // Motion belongs to the START frame's concept — the final frame has
          // none, since nothing animates out of it.
          ...(isFinal ? {} : { motionPrompt: CONTINUOUS_SCENES[fi].motion }),
        })
        const img = await makeImageAsset({ w: 768, h: 1365, from: c.from, to: c.to, label: `Frame ${frameIndex}`, sub: c.label })
        contFrameStates[`${frameIndex}:${conceptId}`] = {
          editablePrompt: c.prompt,
          promptHistory: [c.prompt],
          promptHistoryIndex: 0,
          images: [{ imageUrl: img, prompt: c.prompt, modelId: 'nano-banana-2', createdAt: ago(contTick++) }],
          currentImageIndex: 0,
          inFlightImages: [],
          chainLink: true,
          refsCharacter: true,
          refsProduct: true,
          aspectRatio: '9:16',
          resolution: '1K',
          animateMotion: isFinal ? '' : CONTINUOUS_SCENES[fi].motion,
          videos: [],
          currentVideoIndex: 0,
          inFlightVideos: [],
          videoDurationSeconds: 5,
          videoResolution: '480p',
          videoAudio: true,
        }
        // The first concept of each frame is the picked keyframe.
        if (ci === 0) contSelections[String(frameIndex)] = { conceptId, imageIndex: 0 }
      }
      contFrames.push({ index: frameIndex, concepts })
    }

    const contClipStates: Record<string, unknown> = {}
    for (let si = 0; si < CONTINUOUS_SCENES.length; si++) {
      const s = CONTINUOUS_SCENES[si]
      const motion = `${s.motion}`
      // Clips 1 and 2 are rendered; clip 3 is left for the user to generate, so
      // "Generate all clips" has something to do on a freshly seeded workspace.
      let videos: Array<Record<string, unknown>> = []
      if (si < 2) {
        try {
          const c = CONTINUOUS_FRAMES[si].concepts[0]
          const clip = await makeVideoAsset({ w: 540, h: 960, from: c.from, to: c.to, label: `Clip ${si + 1}`, sub: s.scriptLine.slice(0, 40) })
          videos = [{
            url: clip,
            modelId: CONTINUOUS_MODEL_ID,
            prompt: motion,
            aspectRatio: '9:16',
            durationSeconds: s.durationSeconds,
            resolution: '480p',
            audio: true,
            mode: 'frames-to-video',
            createdAt: ago(si),
          }]
          await store.addVideoHistory({
            id: `demo-cont-clip-${si + 1}`,
            modelId: CONTINUOUS_MODEL_ID,
            prompt: motion,
            mode: 'frames-to-video',
            aspectRatio: '9:16',
            durationSeconds: s.durationSeconds,
            resolution: '480p',
            audio: true,
            videoUrl: clip,
            sourceApp: 'broll-studio',
            createdAt: ago(si),
          } satisfies VideoHistoryItem)
        } catch (e) {
          console.warn('[mockData] continuous clip seed skipped', e)
        }
      }
      contClipStates[`c${si + 1}`] = {
        editablePrompt: motion,
        promptHistory: [motion],
        promptHistoryIndex: 0,
        motionEdited: false,
        videos,
        currentVideoIndex: 0,
        inFlightVideos: [],
        durationSeconds: s.durationSeconds,
        resolution: '480p',
        audio: true,
      }
    }

    await store.upsertBrollHistory({
      id: BROLL_CONTINUOUS_SESSION_ID,
      createdAt: ago(3),
      inputSummary: 'Glow Lab Vitamin C Serum — continuous keyframe chain',
      productId: sessionProductId,
      modelId: sessionModelId,
      scriptText: CONTINUOUS_SCENES.map((s) => s.scriptLine).join('\n'),
      styleId: 'ugc',
      styleName: contStyle.label,
      mode: 'continuous',
      // A continuous row carries no Line-by-Line result; the shape still
      // requires both fields, so they go in empty (same as the live snapshot).
      result: { scenes: [] },
      cardStates: {},
      continuousResult: {
        style: contStyle.brief,
        styleId: 'ugc',
        realism: true,
        modelId: CONTINUOUS_MODEL_ID,
        scenes: contScenes,
        frames: contFrames,
      },
      continuousFrameStates: contFrameStates,
      continuousClipStates: contClipStates,
      continuousSelections: contSelections,
      continuousStyleId: 'ugc',
      continuousModelId: CONTINUOUS_MODEL_ID,
    } satisfies BrollHistoryItem)

    // Seed the live workspace draft — but never clobber a real in-progress
    // session the user already has open.
    try {
      const existing = localStorage.getItem(`${BROLL_DRAFT_PREFIX}:result`)
      if (!existing || existing === 'null') {
        localStorage.setItem(`${BROLL_DRAFT_PREFIX}:result`, JSON.stringify(brollResult))
        localStorage.setItem(`${BROLL_DRAFT_PREFIX}:cardStates`, JSON.stringify(cardStates))
        localStorage.setItem(`${BROLL_DRAFT_PREFIX}:sessionId`, JSON.stringify(BROLL_SESSION_ID))
        if (sessionProductId) localStorage.setItem(`${BROLL_DRAFT_PREFIX}:productId`, JSON.stringify(sessionProductId))
        if (sessionModelId) localStorage.setItem(`${BROLL_DRAFT_PREFIX}:modelId`, JSON.stringify(sessionModelId))
        localStorage.setItem(`${BROLL_DRAFT_PREFIX}:scriptText`, JSON.stringify(SCRIPT_TEXT_1))
      }
    } catch { /* ignore quota */ }
  } finally {
    useAppStore.setState({ addToast: realAddToast })
    setUsageRecordingSuppressed(false)
  }

  const manifest = diffNewIds(before)
  manifest.usageDays = seedUsageLedger()
  try { localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest)) } catch { /* ignore */ }
}

// ── Usage ledger ───────────────────────────────────────────────────────────

// The Dashboard reads nothing but `usageDays`, so without it the landing page
// of a demo install is all zeroes — no streak, no savings, an empty heatmap.
// This fills the last ~9 weeks with a plausible working rhythm.
//
// Two rules keep it safe: rows are folded through the SAME foldUsageEvent the
// live app uses (so credits and official-USD are priced by the real registry,
// never invented), and `addUsageDays` skips any day that already has a row — a
// member with genuine activity keeps every one of their own days untouched, and
// removal deletes only the ids seeded here.
function seedUsageLedger(): string[] {
  // A week's shape: quiet at the weekend, heaviest midweek. Index = weekday
  // (0 = Sunday). Multiplied by a per-week ramp so recent weeks look busier.
  const BY_WEEKDAY = [0, 3, 5, 4, 6, 3, 1]
  const DAY_MS = 24 * 60 * 60 * 1000
  // What one "session" of work looks like, in the proportions the apps actually
  // get used: mostly stills, a couple of clips, the odd voiceover or analysis.
  const MIX: UsageEvent[] = [
    { kind: 'image', modelId: 'nano-banana-2', params: { imageCount: 1, resolution: '1K' } },
    { kind: 'image', modelId: 'nano-banana-2', params: { imageCount: 1, resolution: '1K' } },
    { kind: 'image', modelId: 'nano-banana-2', params: { imageCount: 1, resolution: '1K' } },
    { kind: 'video', modelId: BROLL_VIDEO_MODEL_ID, params: { durationSeconds: 5, resolution: '480p' } },
    { kind: 'video', modelId: CONTINUOUS_MODEL_ID, params: { durationSeconds: 5, resolution: '720p' } },
    { kind: 'character', modelId: 'gpt-image-2-text-to-image', params: { imageCount: 1, resolution: '1K' } },
    { kind: 'voice' },
    { kind: 'script' },
    { kind: 'analysis' },
  ]

  const now = new Date()
  let days: UsageDay[] = []
  // 63 days back through today. The current day gets activity too, so the
  // streak chip in the menu bar reads as live.
  for (let back = 62; back >= 0; back--) {
    const at = new Date(now.getTime() - back * DAY_MS)
    const weeksAgo = Math.floor(back / 7)
    const ramp = weeksAgo >= 7 ? 0.4 : weeksAgo >= 4 ? 0.7 : 1
    const count = Math.round(BY_WEEKDAY[at.getDay()] * ramp)
    for (let i = 0; i < count; i++) {
      // Spread each day's work across the working hours so createdAt looks real.
      const stamp = new Date(at)
      stamp.setHours(9 + (i % 9), (i * 17) % 60, 0, 0)
      days = foldUsageEvent(days, { ...MIX[i % MIX.length], at: stamp.getTime() }).days
    }
  }
  return useBankStore.getState().addUsageDays(days)
}

// ── Remove ─────────────────────────────────────────────────────────────────

export async function removeMockData(): Promise<void> {
  const manifest = readManifest()
  if (!manifest) return
  const store = useBankStore.getState()

  const realAddToast = useAppStore.getState().addToast
  useAppStore.setState({ addToast: () => {} })

  try {
    for (const id of manifest.products) await store.deleteProduct(id)
    for (const id of manifest.models) await store.deleteModel(id)
    for (const id of manifest.scripts) await store.deleteScript(id)
    for (const id of manifest.voices) await store.deleteVoice(id)
    for (const id of manifest.brolls) await store.deleteBRoll(id)
    for (const id of manifest.styles) await store.deleteStyle(id)
    for (const id of manifest.characterHistory) await store.deleteCharacterHistory(id)
    for (const id of manifest.scriptHistory) await store.deleteScriptHistory(id)
    for (const id of manifest.imageHistory) await store.deleteImageHistory(id)
    for (const id of manifest.brollHistory) await store.deleteBrollHistory(id)
    for (const id of manifest.videoHistory) await store.deleteVideoHistory(id)
    for (const id of manifest.voiceHistory) await store.deleteVoiceHistory(id)
    for (const id of manifest.musicHistory) await store.deleteMusicHistory(id)
    for (const id of manifest.adAnatomyHistory) await store.deleteAdAnatomyHistory(id)
    // Only the day rows this seed created (days that had none of the member's
    // own activity) — see seedUsageLedger.
    store.deleteUsageDays(manifest.usageDays)
  } finally {
    useAppStore.setState({ addToast: realAddToast })
  }

  // Clear the seeded B-Roll workspace draft — but only if it's still our demo
  // session (the user may have started a real one over the top since).
  try {
    if (localStorage.getItem(`${BROLL_DRAFT_PREFIX}:sessionId`) === JSON.stringify(BROLL_SESSION_ID)) {
      for (const suffix of ['result', 'cardStates', 'sessionId', 'productId', 'modelId', 'scriptText']) {
        localStorage.removeItem(`${BROLL_DRAFT_PREFIX}:${suffix}`)
      }
    }
  } catch { /* ignore */ }

  try { localStorage.removeItem(MANIFEST_KEY) } catch { /* ignore */ }
}
