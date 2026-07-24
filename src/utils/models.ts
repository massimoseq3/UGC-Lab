// Model registry for UGC OS.
//
// Single source of truth for every kie.ai model the app exposes. Add new entries
// here as we onboard models. Slugs must match kie.ai's `model` field exactly —
// confirm against the model's API doc page on https://docs.kie.ai/ before adding.
//
// Pricing is hard-coded from kie.ai's marketing pages (kie.ai/{model-slug}) and
// kie.ai/pricing — verify and update when prices drift. Last verified: 2026-05-09
// against kie.ai/pricing scrape. Veo bills per-video (NOT per-second) —
// the unit name 'per-call' is used to encode that the duration multiplier
// shouldn't be applied to the credit count.

export type Task = 'chat' | 'vision' | 'image' | 'video' | 'tts' | 'music'

export type ImageMode = 'text-to-image' | 'image-to-image' | 'image-edit'

export type VideoMode = 'text-to-video' | 'image-to-video' | 'frames-to-video' | 'reference-to-video' | 'motion-control'

export type MusicMode = 'text-to-music'

// Union for cases where either category is acceptable (registry filters,
// per-app picker keys, etc.). Concrete callers should narrow.
export type Mode = ImageMode | VideoMode | MusicMode

export type Tag = 'recommended' | 'new' | 'fast' | 'cheap'

export interface Voice {
  id: string
  label: string
}

export interface Pricing {
  unit: 'per-call' | 'per-image' | 'per-second' | 'per-1k-tokens' | 'per-1k-chars'
  // kie.ai credits per unit. Refine per-model from https://kie.ai/pricing.
  credits: number
  // Optional richer pricing curve for models whose cost depends on multiple
  // dimensions (e.g. Kling: resolution + audio; Veo: 4K is ~2× others).
  // When provided, supersedes the flat `credits` rate.
  priceFor?: (opts: PriceParams) => number
}

// What the same generation costs on the provider's OWN API, in USD, for the
// Dashboard's "money saved" math and the picker's "% off" chip. Only add a
// value verified against the provider's public pricing page (source URL in
// `source`) — a model without `official` simply shows no savings, it never
// invents them. `usdFor` mirrors `Pricing.priceFor`'s params; return null for
// tiers/params with no comparable official rate.
export interface OfficialPricing {
  usdFor: (opts: PriceParams) => number | null
  source: string
}

export interface PriceParams {
  durationSeconds?: number
  imageCount?: number
  // Number of reference/input images supplied to an image-to-image model.
  // Some models (Seedream 5.0 Pro edit) surcharge per input image beyond the
  // first. Defaults to 1 (first input free) when not provided.
  inputImageCount?: number
  tokenCount?: number
  charCount?: number
  resolution?: string
  audio?: boolean
  // True when the request includes a source video clip (Gemini Omni's
  // video_list) — kie bills those generations at a flat per-call tier
  // regardless of duration.
  videoInput?: boolean
}

export interface VideoConstraints {
  durations: number[]
  resolutions: string[]
  // Preferred resolution when the constraint-snap effect runs. Falls back to
  // `resolutions[0]` when omitted. Set per-model when the cheapest tier isn't
  // the best out-of-the-box choice (e.g. Seedance defaults to 720p instead of
  // its `480p`-first tier ordering).
  default?: string
  aspectRatios: string[]
  supportsAudio?: boolean
}

// Image-only: declarative caps for the image apps' resolution toggle.
// Resolutions are kie.ai's tier strings ('1K' | '2K' | '4K'). `default` is
// what new sessions land on if no user preference is stored — defaults to
// the first entry in `resolutions` if omitted.
// `aspectRatios` enumerates the aspect strings the model accepts (e.g.
// '1:1', '16:9'); omit when the model accepts the full common set.
export interface ImageConstraints {
  resolutions: string[]
  default?: string
  aspectRatios?: string[]
}

export interface ModelEntry {
  id: string
  displayName: string
  provider: string
  task: Task
  modes?: Mode[]
  tags: Tag[]
  supportsReferenceImages?: boolean
  // Video-only: model accepts reference audio clips (Seedance 2 family's
  // `reference_audio_urls` — voice/lip-sync/sound guidance, ≤15s total).
  supportsReferenceAudio?: boolean
  // Video-only: model accepts reference video clips (Seedance 2 family's
  // `reference_video_urls`, ≤15s total).
  supportsReferenceVideos?: boolean
  // Gemini Omni only: model accepts persistent character ids, designed voice
  // ids, and a trimmed source video clip, under a shared 7-slot input quota.
  omniInputs?: boolean
  // Kling Motion Control only: model takes a reference character image plus a
  // driving video and animates the character with the video's motion. Its
  // input shape (input_urls + video_urls + character_orientation) doesn't map
  // onto the standard frame/reference modes, so Playground renders a dedicated
  // input section when this is set. See buildVideoInput's motion-control branch.
  motionControl?: boolean
  voices?: Voice[]
  fetchVoicesAtRuntime?: boolean
  pricing?: Pricing
  // Verified official-API pricing for savings display. See OfficialPricing.
  official?: OfficialPricing
  // Verified creator-platform pricing (Higgsfield, Freepik, Krea…) for the
  // same generation — those platforms mark models up well past API rates, and
  // they're the realistic alternative for most members. Feeds the Dashboard's
  // money-saved metric (the ledger compares kie against the HIGHER of
  // official/market); the picker's "% off" chip stays official-only.
  market?: OfficialPricing
  defaultFor?: string[]
  // Chat-only: OpenAI-compatible endpoint path on api.kie.ai.
  // e.g. '/gemini-3-flash/v1/chat/completions'
  chatEndpoint?: string
  // Video-only: which kie endpoint family to hit.
  // 'createTask' (default) -> POST /api/v1/jobs/createTask
  // 'veo'                  -> POST /api/v1/veo/generate
  videoEndpoint?: 'createTask' | 'veo'
  // Video-only: declarative caps the UI uses to render constraint controls.
  videoConstraints?: VideoConstraints
  // Image-only: declarative caps for the resolution toggle.
  imageConstraints?: ImageConstraints
}

// Convention for default app ids: matches `AppConfig.id` in `src/utils/constants.ts`.
//   'ad-anatomy', 'script-architect', 'character-studio',
//   'broll-studio', 'voice-studio', 'video-studio'

// The TTS registry id. Voiceovers has no model picker, so this is the single
// source consumers (bankStore usage ledger, generateVoice) share.
export const TTS_MODEL_ID = 'google/gemini-3-1-flash-tts'

// Gemini 3.1 Flash TTS bills by tokens, not characters:
//   input text:  140 credits / 1M tokens
//   audio output: 2,800 credits / 1M tokens
// We only know the script's character count at estimate time, so approximate:
//   • input tokens ≈ chars / 4 (rough tokenizer ratio)
//   • spoken audio ≈ chars / 12.5 chars-per-second (~150 wpm), and Gemini
//     tokenizes audio at ~32 tokens/sec → audioTokens ≈ seconds × 32.
// Audio output dominates. This is a display estimate like the rest of the
// registry; the real charge is metered server-side.
const GEMINI_TTS_RATES = {
  inputCreditsPerMTok: 140,
  audioCreditsPerMTok: 2800,
  charsPerSecond: 12.5,
  audioTokensPerSecond: 32,
}
function geminiTtsCredits(charCount: number): number {
  const inputTokens = charCount / 4
  const audioSeconds = charCount / GEMINI_TTS_RATES.charsPerSecond
  const audioTokens = audioSeconds * GEMINI_TTS_RATES.audioTokensPerSecond
  return (
    (inputTokens * GEMINI_TTS_RATES.inputCreditsPerMTok +
      audioTokens * GEMINI_TTS_RATES.audioCreditsPerMTok) /
    1_000_000
  )
}

export const MODEL_REGISTRY: ModelEntry[] = [
  // ── Chat / Vision ─────────────────────────────────────────────

  // Chat: Gemini 3 Flash is hard-coded for every text/vision call across the app.
  // No model picker is exposed for chat — it adds friction without enough upside.
  {
    id: 'gemini-3-flash',
    displayName: 'Gemini 3 Flash',
    provider: 'Google',
    task: 'chat',
    tags: ['recommended', 'fast', 'cheap'],
    // Source: https://kie.ai/gemini-3-flash. Input $0.15/M tokens (30 cr/M =
    // 0.030 cr/1k), output $0.90/M tokens (180 cr/M = 0.180 cr/1k). We use a
    // blended 0.10 since most chat calls in this app skew toward output.
    pricing: { unit: 'per-1k-tokens', credits: 0.1 },
    defaultFor: ['ad-anatomy', 'script-architect', 'character-studio', 'broll-studio'],
    chatEndpoint: '/gemini-3-flash/v1/chat/completions',
  },

  // ── Image generation ──────────────────────────────────────────

  // Image models — pricing from kie.ai/{slug} marketing pages. Resolution
  // tiers map to the `resolution` cost param: '1K' (default), '2K', '4K'.
  // Nano Banana 2 leads the list so it's the app-wide default for both
  // text-to-image and image-to-image (it's first among `candidates` in
  // getDefaultModel and first in the picker). Identity-consistent and lets
  // the prompt own the composition rather than inheriting the reference's framing.
  {
    id: 'nano-banana-2',
    displayName: 'Nano Banana 2',
    provider: 'Google',
    task: 'image',
    modes: ['text-to-image', 'image-to-image', 'image-edit'],
    tags: ['recommended', 'new'],
    supportsReferenceImages: true,
    defaultFor: ['broll-studio'],
    pricing: {
      unit: 'per-image',
      credits: 8,
      priceFor: ({ imageCount = 1, resolution = '1K' }) => {
        const perImage = resolution === '4K' ? 18 : resolution === '2K' ? 12 : 8
        return perImage * imageCount
      },
    },
    // Gemini API image pricing per generated image (verified 2026-07-09).
    official: {
      usdFor: ({ imageCount = 1, resolution = '1K' }) =>
        (resolution === '4K' ? 0.151 : resolution === '2K' ? 0.101 : 0.067) * imageCount,
      source: 'https://ai.google.dev/gemini-api/docs/pricing',
    },
    imageConstraints: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['9:16', '16:9', '1:1', '3:4'] },
  },
  {
    id: 'gpt-image-2-text-to-image',
    displayName: 'GPT Image 2',
    provider: 'OpenAI',
    task: 'image',
    modes: ['text-to-image'],
    tags: ['recommended'],
    // Influencers default to GPT Image 2 for portrait/sheet generation
    // (text-to-image); other apps fall back to Nano Banana 2 (first in the list).
    defaultFor: ['character-studio'],
    // kie.ai defaults to GPT Image 2's higher-quality tier on the
    // /text-to-image endpoint — verified by real billing (2K = 10 credits).
    // Source: https://kie.ai/gpt-image-2.
    pricing: {
      unit: 'per-image',
      credits: 6,
      priceFor: ({ imageCount = 1, resolution = '1K' }) => {
        const perImage = resolution === '4K' ? 16 : resolution === '2K' ? 10 : 6
        return perImage * imageCount
      },
    },
    // See the Edit sibling below for the estimate caveat.
    official: {
      usdFor: ({ imageCount = 1, resolution = '1K' }) =>
        resolution === '1K' ? 0.053 * imageCount : null,
      source: 'https://developers.openai.com/api/docs/pricing',
    },
    imageConstraints: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['9:16', '16:9', '1:1', '3:4'] },
  },
  {
    id: 'gpt-image-2-image-to-image',
    displayName: 'GPT Image 2 (Edit)',
    provider: 'OpenAI',
    task: 'image',
    modes: ['image-to-image', 'image-edit'],
    tags: ['recommended'],
    supportsReferenceImages: true,
    pricing: {
      unit: 'per-image',
      credits: 6,
      priceFor: ({ imageCount = 1, resolution = '1K' }) => {
        const perImage = resolution === '4K' ? 16 : resolution === '2K' ? 10 : 6
        return perImage * imageCount
      },
    },
    // OpenAI bills GPT Image per token; ≈$0.053 is the medium-quality 1024²
    // estimate from their published token rates. Higher tiers have no clean
    // flat equivalent → null (counts as zero savings, never invented).
    official: {
      usdFor: ({ imageCount = 1, resolution = '1K' }) =>
        resolution === '1K' ? 0.053 * imageCount : null,
      source: 'https://developers.openai.com/api/docs/pricing',
    },
    imageConstraints: { resolutions: ['1K', '2K', '4K'], aspectRatios: ['9:16', '16:9', '1:1', '3:4'] },
  },
  // Seedream 5.0 Pro — the higher-quality tier. Split across two kie slugs like
  // GPT Image 2: the text-to-image slug is the picker face; the image-to-image
  // slug is the hidden sibling the ref-swap logic resolves to (family
  // `seedream/5-pro` → `seedream/5-pro-image-to-image`). `basic`/`high` quality
  // maps to 1K/2K. Source: docs.kie.ai seedream/5-pro-{text,image}-to-image.
  {
    id: 'seedream/5-pro-text-to-image',
    displayName: 'Seedream 5.0 Pro',
    provider: 'ByteDance',
    task: 'image',
    modes: ['text-to-image'],
    tags: ['new'],
    // 1K (basic) 7 cr · 2K (high) 14 cr per image. Source (user-supplied).
    pricing: {
      unit: 'per-image',
      credits: 7,
      priceFor: ({ imageCount = 1, resolution = '1K' }) =>
        (resolution === '2K' ? 14 : 7) * imageCount,
    },
    // BytePlus ModelArk list price per image: ≤2.36MP $0.045, above $0.09.
    official: {
      usdFor: ({ imageCount = 1, resolution = '1K' }) =>
        (resolution === '2K' ? 0.09 : 0.045) * imageCount,
      source: 'https://docs.byteplus.com/en/docs/ModelArk/1544106',
    },
    imageConstraints: { resolutions: ['1K', '2K'], aspectRatios: ['9:16', '16:9', '1:1', '3:4'] },
  },
  {
    id: 'seedream/5-pro-image-to-image',
    displayName: 'Seedream 5.0 Pro (Edit)',
    provider: 'ByteDance',
    task: 'image',
    modes: ['image-to-image', 'image-edit'],
    tags: ['new'],
    supportsReferenceImages: true,
    // Same 7/14 base per output image, plus 0.5 cr per input image beyond the
    // first (the first input image is free). Source (user-supplied).
    pricing: {
      unit: 'per-image',
      credits: 7,
      priceFor: ({ imageCount = 1, resolution = '1K', inputImageCount = 1 }) => {
        const perImage = resolution === '2K' ? 14 : 7
        const inputSurcharge = 0.5 * Math.max(0, inputImageCount - 1)
        return perImage * imageCount + inputSurcharge
      },
    },
    // Same BytePlus list price as the text-to-image slug; extra input images
    // are $0.003 each on the official API (first free, matching kie's shape).
    official: {
      usdFor: ({ imageCount = 1, resolution = '1K', inputImageCount = 1 }) =>
        (resolution === '2K' ? 0.09 : 0.045) * imageCount + 0.003 * Math.max(0, inputImageCount - 1),
      source: 'https://docs.byteplus.com/en/docs/ModelArk/1544106',
    },
    imageConstraints: { resolutions: ['1K', '2K'], aspectRatios: ['9:16', '16:9', '1:1', '3:4'] },
  },

  // ── Video generation ──────────────────────────────────────────

  {
    id: 'bytedance/seedance-2',
    displayName: 'Seedance 2.0',
    provider: 'ByteDance',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video', 'reference-to-video'],
    tags: ['recommended', 'new'],
    supportsReferenceImages: true,
    supportsReferenceAudio: true,
    supportsReferenceVideos: true,
    // Per-second × resolution. Source: https://kie.ai/seedance-2-0 (the
    // marketing page lists a "with video input" tier we don't expose — none
    // of our flows pass a video URL, only image inputs, so the higher
    // text-or-image rate applies across the board).
    // No `official`/`market` entry for the Seedance 2.0 family ON PURPOSE:
    // kie is ~30% cheaper than Fal (kie's own comparison baseline) but
    // pricier than ByteDance's enterprise-gated BytePlus direct rate, and
    // roughly at parity with Higgsfield ($1.55/8s std 720p vs kie's $1.64 —
    // higgsfield.ai/blog/seedance-2-0-pricing-2026) — so we claim zero
    // savings rather than pick a flattering baseline. (2026-07-09)
    pricing: {
      unit: 'per-second',
      credits: 41,
      priceFor: ({ durationSeconds = 5, resolution = '720p' }) => {
        const perSec = resolution === '1080p' ? 102 : resolution === '720p' ? 41 : 19
        return perSec * durationSeconds
      },
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [4, 5, 6, 8, 10, 12, 15],
      resolutions: ['480p', '720p', '1080p'],
      default: '720p',
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      supportsAudio: true,
    },
  },
  {
    id: 'bytedance/seedance-2-fast',
    displayName: 'Seedance 2.0 Fast',
    provider: 'ByteDance',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video', 'reference-to-video'],
    tags: ['fast', 'cheap'],
    supportsReferenceImages: true,
    supportsReferenceAudio: true,
    supportsReferenceVideos: true,
    pricing: {
      unit: 'per-second',
      credits: 33,
      priceFor: ({ durationSeconds = 5, resolution = '720p' }) => {
        const perSec = resolution === '720p' ? 33 : 15.5  // 480p
        return perSec * durationSeconds
      },
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [4, 5, 6, 8, 10, 12, 15],
      resolutions: ['480p', '720p'],
      default: '720p',
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      supportsAudio: true,
    },
  },
  {
    id: 'bytedance/seedance-2-mini',
    displayName: 'Seedance 2.0 Mini',
    provider: 'ByteDance',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video', 'reference-to-video'],
    tags: ['new', 'cheap'],
    supportsReferenceImages: true,
    supportsReferenceAudio: true,
    supportsReferenceVideos: true,
    // Per-second × resolution. 480p/720p only (no 1080p). As with the rest of
    // the 2.0 family we expose the higher "no video input" rate across the
    // board — our flows pass image/audio refs, never a video URL that would
    // unlock the cheaper tier. Source (user-supplied): 480p 9.5 · 720p 20.5.
    pricing: {
      unit: 'per-second',
      credits: 20.5,
      priceFor: ({ durationSeconds = 5, resolution = '720p' }) => {
        const perSec = resolution === '720p' ? 20.5 : 9.5  // 480p
        return perSec * durationSeconds
      },
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [4, 5, 6, 8, 10, 12, 15],
      resolutions: ['480p', '720p'],
      default: '720p',
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      supportsAudio: true,
    },
  },
  // Seedance 1.5 Pro — prior-gen Seedance. Unlike 2.0 it takes its start/end
  // frames as a single `input_urls` array (0-2 images) rather than
  // first_frame_url/last_frame_url, and has no separate reference image/audio/
  // video inputs — so no supportsReferenceImages and no reference-to-video mode.
  // Per-second pricing keyed on resolution × audio. Source (user-supplied):
  // 480p 1.75/3.5 · 720p 3.5/7 · 1080p 7.5/15 (no-audio / with-audio).
  // Docs: bytedance/seedance-1.5-pro on docs.kie.ai.
  {
    id: 'bytedance/seedance-1.5-pro',
    displayName: 'Seedance 1.5 Pro',
    provider: 'ByteDance',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video'],
    tags: ['recommended', 'cheap'],
    pricing: {
      unit: 'per-second',
      credits: 3.5,
      priceFor: ({ durationSeconds = 8, resolution = '720p', audio = false }) => {
        const perSec =
          resolution === '1080p' ? (audio ? 15 : 7.5) :
          resolution === '480p' ? (audio ? 3.5 : 1.75) :
          /* 720p */ (audio ? 7 : 3.5)
        return perSec * durationSeconds
      },
    },
    // BytePlus ModelArk per-second list price (audio doubles the rate; 1080p
    // no-audio derived from that same 2× ratio). 480p has no published
    // official tier → null.
    official: {
      usdFor: ({ durationSeconds = 8, resolution = '720p', audio = false }) => {
        const perSec =
          resolution === '1080p' ? (audio ? 0.116 : 0.058) :
          resolution === '480p' ? null :
          /* 720p */ (audio ? 0.052 : 0.026)
        return perSec === null ? null : perSec * durationSeconds
      },
      source: 'https://docs.byteplus.com/en/docs/ModelArk/1544106',
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [4, 6, 8, 10, 12],
      resolutions: ['480p', '720p', '1080p'],
      default: '720p',
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      supportsAudio: true,
    },
  },
  {
    id: 'kling-3.0/video',
    displayName: 'Kling 3.0',
    provider: 'Kling AI',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video'],
    tags: ['recommended', 'new'],
    pricing: {
      unit: 'per-second',
      credits: 14,
      // mode + sound change pricing live (verified against kie.ai/kling-3-0)
      priceFor: ({ durationSeconds = 5, resolution = 'std', audio = false }) => {
        const perSec =
          resolution === '4K' ? 67 :
          resolution === 'pro' ? (audio ? 27 : 18) :
          /* std */              (audio ? 20 : 14)
        return perSec * durationSeconds
      },
    },
    // Kling's own developer API per-second rates (pro no-audio derived from
    // the std audio/no-audio ratio).
    official: {
      usdFor: ({ durationSeconds = 5, resolution = 'std', audio = false }) => {
        const perSec =
          resolution === '4K' ? 0.42 :
          resolution === 'pro' ? (audio ? 0.168 : 0.112) :
          /* std */              (audio ? 0.126 : 0.084)
        return perSec * durationSeconds
      },
      source: 'https://klingai.com/dev/pricing',
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [3, 5, 7, 10, 15],
      resolutions: ['std', 'pro', '4K'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      supportsAudio: true,
    },
  },
  // Kling 3.0 Turbo (image-to-video) — fast image-conditioned animator. Takes a
  // required image_urls[] (a single start frame in our flows) + duration +
  // resolution. No text-to-video and no aspect_ratio param: aspect inherits
  // from the input image, so aspectRatios is [] and the picker hides it.
  // Per-second pricing keyed on resolution (720p/1080p). Source: kie.ai/pricing.
  // Docs: kling/v3-turbo-image-to-video on docs.kie.ai.
  {
    id: 'kling/v3-turbo-image-to-video',
    displayName: 'Kling 3.0 Turbo',
    provider: 'Kling AI',
    task: 'video',
    modes: ['image-to-video'],
    tags: ['new', 'fast'],
    supportsReferenceImages: true,
    pricing: {
      unit: 'per-second',
      credits: 18,
      priceFor: ({ durationSeconds = 5, resolution = '720p' }) => {
        const perSec = resolution === '1080p' ? 22.5 : 18
        return perSec * durationSeconds
      },
    },
    official: {
      usdFor: ({ durationSeconds = 5, resolution = '720p' }) =>
        (resolution === '1080p' ? 0.14 : 0.112) * durationSeconds,
      source: 'https://klingai.com/dev/pricing',
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [3, 5, 7, 10, 15],
      resolutions: ['720p', '1080p'],
      default: '720p',
      aspectRatios: [],
    },
  },
  // Kling 2.6 (image-to-video) — cheaper prior-gen image animator. Required
  // image_urls[] (a single start frame in our flows) + duration ('5'/'10') +
  // sound. No text-to-video, no resolution param (HD only), and no aspect_ratio
  // (aspect inherits from the input image) — so resolutions is the single
  // '720p' tier and aspectRatios is []. Per-second pricing keyed on audio:
  // 11/s no-audio, 22/s with audio (5s 55/110 · 10s 110/220 cr, user-supplied).
  // Docs: kling-2.6/image-to-video on docs.kie.ai.
  {
    id: 'kling-2.6/image-to-video',
    displayName: 'Kling 2.6',
    provider: 'Kling AI',
    task: 'video',
    modes: ['image-to-video'],
    tags: ['new', 'cheap'],
    supportsReferenceImages: true,
    pricing: {
      unit: 'per-second',
      credits: 11,
      priceFor: ({ durationSeconds = 5, audio = false }) =>
        (audio ? 22 : 11) * durationSeconds,
    },
    // kie prices this ~20% below the official rate (kie's own claim), so
    // official ≈ kie credits / 0.80. No standalone per-second Kling list price
    // is published for 2.6, so we derive from that ratio (like the TTS entry).
    official: {
      usdFor: ({ durationSeconds = 5, audio = false }) =>
        creditsToUsd((audio ? 22 : 11) * durationSeconds) / 0.8,
      source: 'https://kie.ai/pricing',
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [5, 10],
      resolutions: ['720p'],
      default: '720p',
      aspectRatios: [],
      supportsAudio: true,
    },
  },
  // Kling Motion Control — character animation by motion transfer. Takes a
  // reference image (the character) + a driving video (the motion) and outputs
  // the character performing that motion. Standard createTask/recordInfo
  // transport; the unique part is the input shape (input_urls + video_urls +
  // character_orientation), handled in buildVideoInput's motion-control branch.
  // No duration/aspect params — clip length is decided by the driving video +
  // character_orientation ('image' → ≤10s, 'video' → ≤30s), so durations: []
  // and aspectRatios: [] (aspect inherits from the reference image).
  // Per-second pricing keyed on resolution (720p/1080p). Source: kie.ai/pricing.
  // Docs: kling-3.0/motion-control · kling-2.6/motion-control on docs.kie.ai.
  {
    id: 'kling-3.0/motion-control',
    displayName: 'Kling 3.0 Motion Control',
    provider: 'Kling AI',
    task: 'video',
    modes: ['motion-control'],
    tags: ['new'],
    motionControl: true,
    pricing: {
      unit: 'per-second',
      credits: 20,
      priceFor: ({ durationSeconds = 5, resolution = '720p' }) => {
        const perSec = resolution === '1080p' ? 27 : 20
        return perSec * durationSeconds
      },
    },
    // Kling lists a single Motion Control rate (not per model version).
    official: {
      usdFor: ({ durationSeconds = 5, resolution = '720p' }) =>
        (resolution === '1080p' ? 0.168 : 0.126) * durationSeconds,
      source: 'https://klingai.com/dev/pricing',
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [],
      resolutions: ['720p', '1080p'],
      default: '720p',
      aspectRatios: [],
    },
  },
  {
    id: 'kling-2.6/motion-control',
    displayName: 'Kling 2.6 Motion Control',
    provider: 'Kling AI',
    task: 'video',
    modes: ['motion-control'],
    tags: ['new', 'cheap'],
    motionControl: true,
    pricing: {
      unit: 'per-second',
      credits: 11,
      priceFor: ({ durationSeconds = 5, resolution = '720p' }) => {
        const perSec = resolution === '1080p' ? 18 : 11
        return perSec * durationSeconds
      },
    },
    // Same single official Motion Control rate as the 3.0 entry above.
    official: {
      usdFor: ({ durationSeconds = 5, resolution = '720p' }) =>
        (resolution === '1080p' ? 0.168 : 0.126) * durationSeconds,
      source: 'https://klingai.com/dev/pricing',
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [],
      resolutions: ['720p', '1080p'],
      default: '720p',
      aspectRatios: [],
    },
  },
  // Veo 3.1: kie bills PER VIDEO at a flat rate keyed on resolution. Duration
  // is NOT a request parameter for any Veo variant — kie's API spec exposes
  // only resolution + aspect ratio + the optional image inputs; clip length
  // is decided system-side. We therefore (a) declare empty `durations` so
  // the UI hides the toggle, (b) use unit 'per-call' so estimateCredits
  // doesn't multiply by a phantom duration, and (c) drop `duration` from
  // buildVideoInput's Veo branch.
  // Source: https://kie.ai/pricing (scraped 2026-05-09);
  //         https://docs.kie.ai/veo3-api/generate-veo-3-video.md
  {
    id: 'veo3_fast',
    displayName: 'Veo 3.1 Fast',
    provider: 'Google',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video', 'reference-to-video'],
    tags: ['fast'],
    supportsReferenceImages: true,
    pricing: {
      unit: 'per-call',
      credits: 60,
      priceFor: ({ resolution = '720p' }) => {
        if (resolution === '4k') return 180
        if (resolution === '1080p') return 65
        return 60  // 720p
      },
    },
    // Gemini API bills Veo Fast per second ($0.10/s 720p, $0.12/s 1080p);
    // kie's flat call is an ~8s clip, so compare against 8s. No published
    // official 4K rate for Fast → null.
    official: {
      usdFor: ({ resolution = '720p' }) => {
        if (resolution === '4k') return null
        return (resolution === '1080p' ? 0.12 : 0.10) * 8
      },
      source: 'https://ai.google.dev/gemini-api/docs/pricing',
    },
    // Higgsfield: 22 credits per 8s Veo Fast clip ≈ $0.86 on the Plus annual
    // plan ($39/mo → 1,000 credits). Verified 2026-07-09.
    market: {
      usdFor: ({ resolution = '720p' }) => (resolution === '4k' ? null : 0.86),
      source: 'https://www.vo3ai.com/higgsfield-ai-pricing',
    },
    videoEndpoint: 'veo',
    videoConstraints: {
      durations: [],
      resolutions: ['720p', '1080p', '4k'],
      aspectRatios: ['16:9', '9:16'],
    },
  },
  {
    id: 'veo3_lite',
    displayName: 'Veo 3.1 Lite',
    provider: 'Google',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video'],
    tags: ['cheap'],
    pricing: {
      unit: 'per-call',
      credits: 30,
      priceFor: ({ resolution = '720p' }) => {
        if (resolution === '4k') return 150
        if (resolution === '1080p') return 35
        return 30  // 720p
      },
    },
    // Lite: $0.05/s 720p, $0.08/s 1080p × the ~8s clip. No official 4K rate.
    official: {
      usdFor: ({ resolution = '720p' }) => {
        if (resolution === '4k') return null
        return (resolution === '1080p' ? 0.08 : 0.05) * 8
      },
      source: 'https://ai.google.dev/gemini-api/docs/pricing',
    },
    videoEndpoint: 'veo',
    videoConstraints: {
      durations: [],
      resolutions: ['720p', '1080p', '4k'],
      aspectRatios: ['16:9', '9:16'],
    },
  },
  {
    id: 'veo3',
    displayName: 'Veo 3.1 Quality',
    provider: 'Google',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video'],
    tags: [],
    pricing: {
      unit: 'per-call',
      credits: 250,
      priceFor: ({ resolution = '720p' }) => {
        if (resolution === '4k') return 380
        if (resolution === '1080p') return 255
        return 250  // 720p
      },
    },
    // Quality: $0.40/s (720p and 1080p), $0.60/s 4K × the ~8s clip.
    official: {
      usdFor: ({ resolution = '720p' }) =>
        (resolution === '4k' ? 0.60 : 0.40) * 8,
      source: 'https://ai.google.dev/gemini-api/docs/pricing',
    },
    // Higgsfield: 58 credits per 8s premium (1080p) clip ≈ $2.26 on the Plus
    // annual plan. Official is higher, so this rarely governs — kept for the
    // record. Verified 2026-07-09.
    market: {
      usdFor: ({ resolution = '720p' }) => (resolution === '1080p' ? 2.26 : null),
      source: 'https://www.vo3ai.com/higgsfield-ai-pricing',
    },
    videoEndpoint: 'veo',
    videoConstraints: {
      durations: [],
      resolutions: ['720p', '1080p', '4k'],
      aspectRatios: ['16:9', '9:16'],
    },
  },
  // Gemini Omni Video — Google's multimodal AV generator. Standard
  // createTask transport, but its inputs are unique: alongside up to 7
  // reference images it accepts persistent character ids (from
  // /omni/character/create), designed voice ids (from /omni/audio/create),
  // and 1 trimmed source video clip — all sharing a 7-slot quota
  // (images×1 + video×2 + characters×1 ≤ 7). Audio is always baked into the
  // output (no generate_audio toggle). Docs: https://docs.kie.ai/market/gemini-omni-video
  // Pricing (from kie docs, 2026-07-01): per-call, duration-tiered —
  // 720p/1080p: 4s=63 / 6s=84 / 8s=105 / 10s=126; 4k adds +84. With a video
  // input, duration is model-decided and billing is flat: 168 (720p/1080p) or
  // 252 (4k).
  {
    id: 'gemini-omni-video',
    displayName: 'Gemini Omni',
    provider: 'Google',
    task: 'video',
    modes: ['text-to-video', 'reference-to-video'],
    tags: ['recommended', 'new'],
    supportsReferenceImages: true,
    omniInputs: true,
    pricing: {
      unit: 'per-call',
      credits: 105,
      priceFor: ({ durationSeconds = 8, resolution = '720p', videoInput = false }) => {
        const is4k = resolution === '4k'
        if (videoInput) return is4k ? 252 : 168
        const base =
          durationSeconds >= 10 ? 126 :
          durationSeconds >= 8 ? 105 :
          durationSeconds >= 6 ? 84 : 63
        return is4k ? base + 84 : base
      },
    },
    // Gemini API bills Omni per token; ≈$0.10/s is the estimate from Google's
    // published rates. Video-input and 4K calls have no clean per-second
    // equivalent → null.
    official: {
      usdFor: ({ durationSeconds = 8, resolution = '720p', videoInput = false }) =>
        videoInput || resolution === '4k' ? null : 0.10 * durationSeconds,
      source: 'https://ai.google.dev/gemini-api/docs/pricing',
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [4, 6, 8, 10],
      resolutions: ['720p', '1080p', '4k'],
      // 1080p costs the same as 720p for Omni (see priceFor), so default to it.
      default: '1080p',
      aspectRatios: ['16:9', '9:16'],
    },
    // The video default for both video surfaces. Note Omni has no
    // 'image-to-video' mode — it takes every image as a generic reference, not
    // as frame one — so B-Roll's Animate tab greys it out and asks for Veo /
    // Seedance instead. That's the one flow where the default isn't the answer.
    defaultFor: ['broll-studio', 'playground'],
  },
  // Wan 2.7 — Alibaba Tongyi's video suite. kie exposes T2V and I2V as
  // separate slugs; we register one virtual id and resolve to the real slug
  // at generate time via `resolveVideoModelSlug`.
  // Docs: https://docs.kie.ai/market/wan/2-7-text-to-video
  //       https://docs.kie.ai/market/wan/2-7-image-to-video
  {
    id: 'wan/2-7',
    displayName: 'Wan 2.7',
    provider: 'Alibaba Tongyi',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video'],
    tags: ['new'],
    pricing: {
      unit: 'per-second',
      credits: 16,
      priceFor: ({ durationSeconds = 5, resolution = '720p' }) => {
        const perSec = resolution === '1080p' ? 24 : 16  // 720p
        return perSec * durationSeconds
      },
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [3, 5, 8, 10, 12, 15],
      resolutions: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      supportsAudio: false,
    },
  },

  // Grok Imagine Video 1.5 (preview) — xAI's video generator. Optional prompt +
  // optional image_urls[] (identity/reference), so it runs both text-to-video
  // and image-to-video. aspect_ratio + resolution (480p/720p) + duration
  // (1–15s). Audio is generated automatically (no param). Per-second pricing
  // keyed on resolution: 1.6/s 480p, 3/s 720p (user-supplied).
  // Docs: grok-imagine-video-1-5-preview on docs.kie.ai.
  {
    id: 'grok-imagine-video-1-5-preview',
    displayName: 'Grok Imagine Video 1.5',
    provider: 'xAI',
    task: 'video',
    // image_urls is a multi-image identity/reference input ("identity lock"),
    // so Grok does reference-to-video as well as plain image-to-video — both
    // resolve to the same image_urls body (see buildVideoInput).
    modes: ['text-to-video', 'image-to-video', 'reference-to-video'],
    tags: ['recommended', 'new', 'cheap'],
    supportsReferenceImages: true,
    pricing: {
      unit: 'per-second',
      credits: 3,
      priceFor: ({ durationSeconds = 8, resolution = '480p' }) =>
        (resolution === '720p' ? 3 : 1.6) * durationSeconds,
    },
    // Priced against the official xAI rate so kie lands ~90% off — official ≈
    // kie / 0.10. No standalone xAI per-second list price to cite, so derived
    // from that ratio and the kie.ai pricing page.
    official: {
      usdFor: ({ durationSeconds = 8, resolution = '480p' }) =>
        creditsToUsd((resolution === '720p' ? 3 : 1.6) * durationSeconds) / 0.1,
      source: 'https://kie.ai/pricing',
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      durations: [4, 5, 6, 8, 10, 12, 15],
      resolutions: ['480p', '720p'],
      default: '720p',
      aspectRatios: ['16:9', '9:16', '1:1', '3:2', '2:3'],
      supportsAudio: false,
    },
  },

  // ── Music generation (Suno via kie.ai) ────────────────────────
  // Suno is reached through kie.ai's custom endpoint
  //   POST /api/v1/generate     (NOT /jobs/createTask)
  //   GET  /api/v1/generate/record-info?taskId=...
  // The model variant is selected via the `model` field in the body
  // ('V5', 'V5_5', etc.) — the endpoint path is the same for all variants.
  // See docs at https://docs.kie.ai/suno-api/generate-music.md
  //
  // Pricing: kie.ai's pricing page is the authority. TODO: verify and replace
  // the placeholder once we have real per-call rates from kie.ai/pricing.
  {
    id: 'suno-v5',
    displayName: 'Suno V5',
    provider: 'Suno',
    task: 'music',
    modes: ['text-to-music'],
    tags: [],
    pricing: { unit: 'per-call', credits: 40 }, // TODO: confirm against kie.ai/pricing
  },
  {
    id: 'suno-v5_5',
    displayName: 'Suno V5.5',
    provider: 'Suno',
    task: 'music',
    modes: ['text-to-music'],
    tags: ['recommended', 'new'],
    pricing: { unit: 'per-call', credits: 50 }, // TODO: confirm against kie.ai/pricing
    defaultFor: ['playground'],
  },

  // ── Text-to-Speech ────────────────────────────────────────────
  // Voiceovers uses Gemini 3.1 Flash TTS exclusively (no picker).
  // Spec: https://docs.kie.ai/ (google/gemini-3-1-flash-tts).
  // Voice catalog lives in src/apps/voice-studio/types.ts — VOICES.

  {
    id: TTS_MODEL_ID,
    displayName: 'Gemini 3.1 Flash TTS',
    provider: 'Google',
    task: 'tts',
    tags: ['recommended', 'new'],
    // Token-metered (see geminiTtsCredits above). `unit`/`credits` are unused
    // when `priceFor` is present but required by the type — keep them sane.
    pricing: {
      unit: 'per-1k-chars',
      credits: 7,
      priceFor: ({ charCount = 1000 }) => geminiTtsCredits(charCount),
    },
    // kie is ~30% cheaper than Google's own API rate for this model, so the
    // official price ≈ kie credits / 0.70 converted to USD. Derived from kie's
    // published "~30% cheaper than official" claim on the model's pricing page.
    official: {
      usdFor: ({ charCount = 1000 }) => geminiTtsCredits(charCount) / CREDITS_PER_USD / 0.7,
      source: 'https://kie.ai/pricing',
    },
    defaultFor: ['voice-studio'],
  },
]

// ── Helpers ─────────────────────────────────────────────────────

export function getModel(id: string): ModelEntry | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id)
}

// Display label for a video resolution tier. Some providers name their tiers
// by quality ('std' / 'pro' / '4K' for Kling 3.0) rather than the pixel
// resolution they actually output. This maps those aliases to the real
// resolution so the picker reads consistently with the rest of the catalog —
// display-only; the underlying tier value sent to kie.ai is unchanged.
const VIDEO_RESOLUTION_LABELS: Record<string, string> = {
  std: '720p',
  pro: '1080p',
}

export function videoResolutionLabel(tier: string): string {
  return VIDEO_RESOLUTION_LABELS[tier] ?? tier
}

export function listModels(filter: { task?: Task; mode?: Mode } = {}): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => {
    if (filter.task && m.task !== filter.task) return false
    if (filter.mode && (!m.modes || !m.modes.includes(filter.mode))) return false
    return true
  })
}

export function getDefaultModel(appId: string, task: Task, mode?: Mode): ModelEntry | undefined {
  const candidates = listModels({ task, mode })
  return candidates.find((m) => m.defaultFor?.includes(appId)) ?? candidates[0]
}

// Convenience for chat-using services. Returns the registered chat endpoint
// path for the configured chat model, throwing if misconfigured.
export function getChatEndpointPath(modelId: string = 'gemini-3-flash'): string {
  const m = getModel(modelId)
  if (!m?.chatEndpoint) {
    throw new Error(`Chat model ${modelId} is missing a chatEndpoint. Check src/utils/models.ts.`)
  }
  return m.chatEndpoint
}

// ── Cost estimation ─────────────────────────────────────────────

export interface CostEstimateParams {
  durationSeconds?: number
  imageCount?: number
  inputImageCount?: number
  tokenCount?: number
  charCount?: number
  resolution?: string
  audio?: boolean
  videoInput?: boolean
}


export function estimateCredits(modelId: string, params: CostEstimateParams = {}): number | null {
  const model = getModel(modelId)
  if (!model?.pricing) return null
  if (model.pricing.priceFor) return model.pricing.priceFor(params)
  const { unit, credits } = model.pricing
  switch (unit) {
    case 'per-call':
      return credits
    case 'per-image':
      return credits * (params.imageCount ?? 1)
    case 'per-second':
      return credits * (params.durationSeconds ?? 5)
    case 'per-1k-tokens':
      return credits * ((params.tokenCount ?? 1000) / 1000)
    case 'per-1k-chars':
      return credits * ((params.charCount ?? 1000) / 1000)
  }
}

// kie.ai's credit exchange rate: $1 buys 200 credits (1 credit = $0.005) at
// the base tier. Derived from kie's own per-model pricing pages (e.g.
// Gemini 3 Flash: $0.15/M tokens = 30 credits/M). Used only for the
// Dashboard's savings math — the UI everywhere else stays credits-only.
export const CREDITS_PER_USD = 200

export function creditsToUsd(credits: number): number {
  return credits / CREDITS_PER_USD
}

// USD cost of one generation on the provider's official API, or null when the
// model has no verified `official` pricing entry.
export function estimateOfficialUsd(modelId: string, params: CostEstimateParams = {}): number | null {
  const model = getModel(modelId)
  if (!model?.official) return null
  return model.official.usdFor(params)
}

// USD cost of one generation on a creator platform (see ModelEntry.market),
// or null when no verified market rate exists.
export function estimateMarketUsd(modelId: string, params: CostEstimateParams = {}): number | null {
  const model = getModel(modelId)
  if (!model?.market) return null
  return model.market.usdFor(params)
}

// Snap a clip length onto the grid a model actually offers, rounding DOWN to
// the next option and flooring at the shortest. Short and cheap is the default
// posture — a longer take is a per-card opt-in, not something a model swap
// should buy on the user's behalf. With Gemini Omni ([4,6,8,10]) as the video
// default, the app-wide 5s lands on 4s.
// Assumes `durations` is sorted ascending — every registry entry above is.
//
// Only bites when the selected model omits the app-wide 5s default: the whole
// Seedance family offers 5s, so nothing hit this until Omni became the default.
export function snapVideoDuration(current: number, durations: number[]): number {
  if (durations.length === 0 || durations.includes(current)) return current
  const below = durations.filter((d) => d < current)
  return below.length > 0 ? below[below.length - 1] : durations[0]
}

// Snap-UP sibling: nearest option at or above, capped at the model's longest.
// One Shot uses this — a segment's spoken lines must FIT inside the clip, so
// rounding down would truncate speech mid-sentence.
export function snapVideoDurationUp(current: number, durations: number[]): number {
  if (durations.length === 0 || durations.includes(current)) return current
  const above = durations.filter((d) => d > current)
  return above.length > 0 ? above[0] : durations[durations.length - 1]
}

// Representative params for a model's savings headline: its default
// resolution and a mid-catalog duration, matching what the picker rows quote.
function representativeParams(model: ModelEntry): CostEstimateParams {
  const cv = model.videoConstraints
  if (cv) {
    const resolution = cv.default ?? cv.resolutions[0]
    const durationSeconds = cv.durations.includes(8) ? 8 : cv.durations[0]
    return { resolution, ...(durationSeconds ? { durationSeconds } : {}) }
  }
  const ci = model.imageConstraints
  if (ci) return { resolution: ci.default ?? ci.resolutions[0], imageCount: 1 }
  return {}
}

// Whole-percent discount vs the official API at representative params, for
// the "% off" chip. Null when the model has no verified official pricing or
// kie isn't actually cheaper.
export function officialSavingsPercent(modelId: string): number | null {
  const model = getModel(modelId)
  if (!model?.official || !model.pricing) return null
  const params = representativeParams(model)
  const credits = estimateCredits(modelId, params)
  const officialUsd = model.official.usdFor(params)
  if (credits == null || officialUsd == null || officialUsd <= 0) return null
  const pct = Math.round((1 - creditsToUsd(credits) / officialUsd) * 100)
  return pct > 0 ? pct : null
}

export function formatCredits(credits: number | null): string | null {
  if (credits === null) return null
  if (credits < 1) return `< 1 credit`
  const rounded = Math.round(credits * 10) / 10
  return `${rounded} credit${rounded === 1 ? '' : 's'}`
}

// ── Per-model input builders ──────────────────────────────────
// Different image models on kie.ai accept different field names
// (resolution vs quality, omitted size, different aspect-ratio enums).
// Concentrate that knowledge here so callers don't need to care.

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' | '21:9'

export type ImageResolution = '1K' | '2K' | '4K'

const IMAGE_RESOLUTION_ORDER: ImageResolution[] = ['1K', '2K', '4K']

// The still-image resolution tiers a model actually supports (defaults to the
// full ladder when the model declares no image constraints).
export function imageResolutionsFor(modelId: string): ImageResolution[] {
  const declared = getModel(modelId)?.imageConstraints?.resolutions as ImageResolution[] | undefined
  return declared && declared.length > 0 ? declared : IMAGE_RESOLUTION_ORDER
}

// Snap a desired resolution into the model's supported set. When the desired
// tier isn't offered (e.g. 4K on a 1K/2K-only model) we fall back to the
// highest tier the model does support rather than silently downgrading to the
// cheapest one at request time.
export function clampImageResolution(modelId: string, desired: ImageResolution): ImageResolution {
  const allowed = imageResolutionsFor(modelId)
  if (allowed.includes(desired)) return desired
  for (let i = IMAGE_RESOLUTION_ORDER.indexOf(desired) - 1; i >= 0; i--) {
    if (allowed.includes(IMAGE_RESOLUTION_ORDER[i])) return IMAGE_RESOLUTION_ORDER[i]
  }
  // Desired sits below everything supported — take the model's lowest tier.
  return allowed[0]
}

export interface ImageGenOptions {
  prompt: string
  aspectRatio?: AspectRatio
  // kie.ai's resolution tier. Defaults to '1K'. Caller should clamp to the
  // model's supported set (`imageConstraints.resolutions`) before calling.
  resolution?: ImageResolution
  inputUrls?: string[]
}

export function buildImageInput(modelId: string, opts: ImageGenOptions): Record<string, unknown> {
  const ar = opts.aspectRatio ?? '9:16'
  const resolution = opts.resolution ?? '1K'

  if (modelId.startsWith('gpt-image-2')) {
    return {
      prompt: opts.prompt,
      aspect_ratio: ar,
      resolution,
      ...(opts.inputUrls?.length ? { input_urls: opts.inputUrls } : {}),
    }
  }
  if (modelId === 'nano-banana-2') {
    // Nano Banana 2 uses `image_input` (not `input_urls`) for refs.
    return {
      prompt: opts.prompt,
      aspect_ratio: ar,
      resolution,
      output_format: 'jpg',
      ...(opts.inputUrls?.length ? { image_input: opts.inputUrls } : {}),
    }
  }
  if (modelId.startsWith('seedream/5-pro')) {
    // Seedream 5.0 Pro: 1K→'basic', 2K→'high'. The text-to-image slug omits
    // image_urls; the image-to-image slug requires it (added when refs present).
    return {
      prompt: opts.prompt,
      aspect_ratio: ar,
      quality: resolution === '2K' ? 'high' : 'basic',
      ...(opts.inputUrls?.length ? { image_urls: opts.inputUrls } : {}),
    }
  }
  // Fallback: send prompt + aspect_ratio and hope for the best
  return { prompt: opts.prompt, aspect_ratio: ar }
}

// ── Per-model video input builders ────────────────────────────
//
// Each video model expects a different body shape (Seedance:
// first_frame_url + last_frame_url, Kling: image_urls[] + mode + sound,
// Veo: imageUrls[] + model + generationType). This helper produces the
// right shape per model.

export interface VideoGenOptions {
  prompt: string
  mode: VideoMode
  aspectRatio?: string
  duration?: number
  resolution?: string
  audio?: boolean
  // Public URLs (already uploaded via ensureHostedUrl by the caller).
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  imageUrl?: string  // single first-frame for image-to-video mode
  // Seedance 2 family: reference audio clips (≤15s total) for voice /
  // lip-sync / sound guidance, and reference video clips (≤15s total) for
  // motion / style guidance. Orthogonal to the image mode — sent whenever
  // present.
  referenceAudioUrls?: string[]
  referenceVideoUrls?: string[]
  // Gemini Omni only: persistent ids from the omni create endpoints, plus an
  // optional trimmed source video clip (start/ends in seconds, ≤10s window).
  omniCharacterIds?: string[]
  omniAudioIds?: string[]
  videoClip?: { url: string; start: number; ends: number }
  // Kling Motion Control only: the reference character image and the driving
  // video (both already hosted), plus how the output character should be
  // oriented ('video' follows the driving clip, ≤30s; 'image' matches the
  // reference photo, ≤10s).
  motionImageUrl?: string
  motionVideoUrl?: string
  characterOrientation?: 'image' | 'video'
  // Kling 3.0 only: allow the model to cut between multiple shots inside one
  // generation. Off for line-by-line b-roll (one continuous take per clip);
  // B-Roll's One Shot mode turns it on for full multi-scene concepts.
  multiShots?: boolean
}

// Resolves a registry model id to the actual kie.ai slug to send in the
// createTask body. Some families (Wan 2.7) ship as
// multiple kie slugs that differ only by mode (T2V vs I2V); we expose one
// virtual id in the picker and pick the real slug here based on inputs.
// For every other model the registry id IS the kie slug — passes through.
export function resolveVideoModelSlug(modelId: string, opts: VideoGenOptions): string {
  const hasFrame = !!(opts.firstFrameUrl || opts.lastFrameUrl || opts.imageUrl)
  if (modelId === 'wan/2-7') return hasFrame ? 'wan/2-7-image-to-video' : 'wan/2-7-text-to-video'
  return modelId
}

export function buildVideoInput(modelId: string, opts: VideoGenOptions): Record<string, unknown> {
  const m = getModel(modelId)
  if (!m) throw new Error(`Unknown model: ${modelId}`)

  const ar = opts.aspectRatio ?? '9:16'
  const duration = opts.duration ?? 5
  const resolution = opts.resolution ?? '720p'

  // ── Kling Motion Control (kling-3.0 / kling-2.6 motion-control) ──
  // Character image + driving video + orientation. No aspect/duration params —
  // both are decided by the inputs. `prompt` is optional (kie has its own
  // default); we send it only when the user typed one.
  if (m.motionControl) {
    return {
      ...(opts.prompt?.trim() ? { prompt: opts.prompt } : {}),
      input_urls: opts.motionImageUrl ? [opts.motionImageUrl] : [],
      video_urls: opts.motionVideoUrl ? [opts.motionVideoUrl] : [],
      character_orientation: opts.characterOrientation ?? 'video',
      mode: resolution === '1080p' ? '1080p' : '720p',
    }
  }

  // ── Veo family ──
  if (modelId.startsWith('veo3')) {
    const imageUrls: string[] = []
    let generationType: 'TEXT_2_VIDEO' | 'FIRST_AND_LAST_FRAMES_2_VIDEO' | 'REFERENCE_2_VIDEO' = 'TEXT_2_VIDEO'

    if (opts.mode === 'image-to-video' && opts.imageUrl) {
      imageUrls.push(opts.imageUrl)
      generationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO'
    } else if (opts.mode === 'frames-to-video') {
      if (opts.firstFrameUrl) imageUrls.push(opts.firstFrameUrl)
      if (opts.lastFrameUrl) imageUrls.push(opts.lastFrameUrl)
      generationType = 'FIRST_AND_LAST_FRAMES_2_VIDEO'
    } else if (opts.mode === 'reference-to-video' && opts.referenceImageUrls?.length) {
      imageUrls.push(...opts.referenceImageUrls)
      generationType = 'REFERENCE_2_VIDEO'
    }

    return {
      prompt: opts.prompt,
      model: modelId,            // 'veo3' | 'veo3_fast' | 'veo3_lite'
      generationType,
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      aspect_ratio: ar,
      resolution,
    }
  }

  // ── Kling 3.0 Turbo (image-to-video) ──
  // Required image_urls[] + duration + resolution. No aspect_ratio (aspect is
  // inherited from the input image). We pass whatever start frame the caller
  // resolved (imageUrl / firstFrameUrl) plus any extra reference images.
  if (modelId === 'kling/v3-turbo-image-to-video') {
    const imageUrls: string[] = []
    if (opts.imageUrl) imageUrls.push(opts.imageUrl)
    if (opts.firstFrameUrl) imageUrls.push(opts.firstFrameUrl)
    if (opts.referenceImageUrls?.length) imageUrls.push(...opts.referenceImageUrls)
    return {
      prompt: opts.prompt,
      image_urls: imageUrls,
      duration,
      resolution: resolution === '1080p' ? '1080p' : '720p',
    }
  }

  // ── Kling 2.6 (image-to-video) ──
  // image_urls[] (start frame + any extra refs) + sound + duration ('5'/'10').
  // No resolution/aspect params (HD only; aspect follows the input image).
  if (modelId === 'kling-2.6/image-to-video') {
    const imageUrls: string[] = []
    if (opts.imageUrl) imageUrls.push(opts.imageUrl)
    if (opts.firstFrameUrl) imageUrls.push(opts.firstFrameUrl)
    if (opts.referenceImageUrls?.length) imageUrls.push(...opts.referenceImageUrls)
    return {
      prompt: opts.prompt,
      image_urls: imageUrls,
      sound: opts.audio ?? false,
      duration: String(duration),
    }
  }

  // ── Kling 3.0 ──
  if (modelId === 'kling-3.0/video') {
    const imageUrls: string[] = []
    if (opts.mode === 'image-to-video' && opts.imageUrl) imageUrls.push(opts.imageUrl)
    if (opts.mode === 'frames-to-video') {
      if (opts.firstFrameUrl) imageUrls.push(opts.firstFrameUrl)
      if (opts.lastFrameUrl) imageUrls.push(opts.lastFrameUrl)
    }
    return {
      prompt: opts.prompt,
      ...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
      mode: resolution,           // 'std' | 'pro' | '4K' — Kling reuses the 'mode' field for tier
      sound: opts.audio ?? false,
      duration: String(duration), // Kling expects string enum
      aspect_ratio: ar,
      multi_shots: opts.multiShots ?? false,
    }
  }

  // ── Gemini Omni Video ──
  // Every image input is a generic reference (no first/last-frame semantics);
  // characters / voices / the source clip ride alongside. `duration` is a
  // required string enum and is ignored by kie when a video clip is present.
  if (modelId === 'gemini-omni-video') {
    const imageUrls: string[] = []
    if (opts.imageUrl) imageUrls.push(opts.imageUrl)
    if (opts.firstFrameUrl) imageUrls.push(opts.firstFrameUrl)
    if (opts.lastFrameUrl) imageUrls.push(opts.lastFrameUrl)
    if (opts.referenceImageUrls?.length) imageUrls.push(...opts.referenceImageUrls)
    const allowedDurations = [4, 6, 8, 10]
    return {
      prompt: opts.prompt,
      ...(imageUrls.length > 0 ? { image_urls: imageUrls } : {}),
      ...(opts.omniAudioIds?.length ? { audio_ids: opts.omniAudioIds } : {}),
      ...(opts.omniCharacterIds?.length ? { character_ids: opts.omniCharacterIds } : {}),
      ...(opts.videoClip ? { video_list: [opts.videoClip] } : {}),
      duration: String(allowedDurations.includes(duration) ? duration : 8),
      aspect_ratio: ar === '9:16' ? '9:16' : '16:9',
      resolution,
    }
  }

  // ── Wan 2.7 ──
  // T2V uses `ratio` (not `aspect_ratio`); I2V infers aspect from the input
  // image and accepts both first_frame_url and last_frame_url.
  if (modelId === 'wan/2-7') {
    const startFrame = opts.firstFrameUrl ?? (opts.mode === 'image-to-video' ? opts.imageUrl : undefined)
    const hasFrame = !!(startFrame || opts.lastFrameUrl)
    if (hasFrame) {
      return {
        prompt: opts.prompt,
        ...(startFrame ? { first_frame_url: startFrame } : {}),
        ...(opts.lastFrameUrl ? { last_frame_url: opts.lastFrameUrl } : {}),
        resolution,
        duration,
      }
    }
    return {
      prompt: opts.prompt,
      resolution,
      ratio: ar,
      duration,
    }
  }

  // ── Grok Imagine Video 1.5 ──
  // Optional image_urls[] (identity/reference) + aspect_ratio + resolution +
  // numeric duration. nsfw_checker defaults true server-side; we don't send it.
  if (modelId === 'grok-imagine-video-1-5-preview') {
    const imageUrls: string[] = []
    if (opts.imageUrl) imageUrls.push(opts.imageUrl)
    if (opts.firstFrameUrl) imageUrls.push(opts.firstFrameUrl)
    if (opts.referenceImageUrls?.length) imageUrls.push(...opts.referenceImageUrls)
    return {
      prompt: opts.prompt,
      ...(imageUrls.length ? { image_urls: imageUrls } : {}),
      aspect_ratio: ar,
      resolution,
      duration,
    }
  }

  // ── Seedance 1.5 Pro ──
  // Frames ride in a single `input_urls` array (start, then optional end), not
  // the 2.0 family's first_frame_url/last_frame_url. No reference inputs.
  if (modelId === 'bytedance/seedance-1.5-pro') {
    const inputUrls: string[] = []
    if (opts.firstFrameUrl) inputUrls.push(opts.firstFrameUrl)
    else if (opts.imageUrl && opts.mode === 'image-to-video') inputUrls.push(opts.imageUrl)
    if (opts.lastFrameUrl) inputUrls.push(opts.lastFrameUrl)
    return {
      prompt: opts.prompt,
      ...(inputUrls.length ? { input_urls: inputUrls } : {}),
      aspect_ratio: ar,
      duration,
      resolution,
      generate_audio: opts.audio ?? false,
    }
  }

  // ── Seedance 2.0 family (default) ──
  return {
    prompt: opts.prompt,
    ...(opts.firstFrameUrl ? { first_frame_url: opts.firstFrameUrl } : {}),
    ...(opts.lastFrameUrl ? { last_frame_url: opts.lastFrameUrl } : {}),
    ...(opts.imageUrl && opts.mode === 'image-to-video' ? { first_frame_url: opts.imageUrl } : {}),
    ...(opts.referenceImageUrls?.length ? { reference_image_urls: opts.referenceImageUrls } : {}),
    ...(opts.referenceAudioUrls?.length ? { reference_audio_urls: opts.referenceAudioUrls } : {}),
    ...(opts.referenceVideoUrls?.length ? { reference_video_urls: opts.referenceVideoUrls } : {}),
    aspect_ratio: ar,
    duration,
    resolution,
    generate_audio: opts.audio ?? true,
  }
}

// ── Per-model music input builders ────────────────────────────
//
// Suno's /api/v1/generate body. v1 supports only customMode=false (no lyrics,
// no style/title/persona/weight knobs). `callBackUrl` is required by the
// schema even though we poll for results; we pass a no-op placeholder.

export interface MusicGenOptions {
  prompt: string
  instrumental?: boolean
}

export function buildMusicInput(modelId: string, opts: MusicGenOptions): Record<string, unknown> {
  const model = getModel(modelId)
  if (!model || model.task !== 'music') throw new Error(`Not a music model: ${modelId}`)

  // ModelEntry.id stores the registry id ('suno-v5') but Suno's API expects
  // the bare variant string ('V5', 'V5_5', etc.). Strip the 'suno-' prefix.
  const sunoVariant = modelId.replace(/^suno-/i, '').toUpperCase().replace('.', '_')

  return {
    prompt: opts.prompt,
    customMode: false,
    instrumental: !!opts.instrumental,
    model: sunoVariant,
    callBackUrl: 'https://kie.ai/',
  }
}

// ── Tag styling helper ─────────────────────────────────────────

export const TAG_STYLES: Record<Tag, { label: string; className: string }> = {
  recommended: { label: 'Recommended', className: 'bg-emerald-500/15 text-emerald-300 light:text-emerald-700 border-emerald-500/20' },
  new: { label: 'New', className: 'bg-fuchsia-500/15 text-fuchsia-300 light:text-fuchsia-700 border-fuchsia-500/20' },
  fast: { label: 'Fast', className: 'bg-sky-500/15 text-sky-300 light:text-sky-700 border-sky-500/20' },
  cheap: { label: 'Cheap', className: 'bg-ink-500/15 text-ink-300 border-ink-500/20' },
}
