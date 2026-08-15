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

// How a chat model's request and response are shaped on api.kie.ai. The model
// slug lives in the URL for 'openai-chat' and in the request body for the other
// two, which is why `chatSlug` exists — Opus 5 and Sonnet 5 share one endpoint.
//   'openai-chat'      POST /<slug>/v1/chat/completions   (Gemini family)
//   'claude-messages'  POST /claude/v1/messages           (Claude family)
//   'openai-responses' POST /codex|grok/v1/responses      (GPT 5.6, Grok)
export type ChatTransport = 'openai-chat' | 'claude-messages' | 'openai-responses'

// What the script-model picker shows beside a chat model. `intelligence` is
// editorial — a relative ordering of the models we actually offer, based on how
// the providers position them against each other, not a benchmark score. Cost
// is NOT declared here: it's derived from the entry's real `pricing` by
// `chatCostTier`, so the two can never drift apart.
export interface ChatRating {
  // 5 = the strongest writer on offer here.
  intelligence: 1 | 2 | 3 | 4 | 5
  // One sentence on what this model is good for, under the name in the picker.
  blurb: string
}

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
  // How many reference images the model takes in ONE request. Only set from a
  // verified provider cap (see the entry's comment) — an undeclared model falls
  // back to UNDECLARED_REFERENCE_IMAGE_CAP, which is deliberately conservative
  // because an over-long ref array is a 400, not a graceful drop.
  maxReferenceImages?: number
  // Video-only: model accepts reference audio clips (Seedance 2 family's
  // `reference_audio_urls` — voice/lip-sync/sound guidance, ≤15s total).
  supportsReferenceAudio?: boolean
  // Video-only: model accepts reference video clips (Seedance 2 family's
  // `reference_video_urls`, ≤15s total).
  supportsReferenceVideos?: boolean
  // Video-only: how many reference video clips the model takes in ONE request.
  // Undeclared models fall back to UNDECLARED_REFERENCE_VIDEO_CAP. Only set
  // from a documented provider cap — Kling 3.0 Omni takes exactly one.
  maxReferenceVideos?: number
  // Video-only: combined length cap, in seconds, for the reference audio strip
  // and (separately) the reference video strip. Undeclared models fall back to
  // UNDECLARED_REFERENCE_CLIP_SECONDS. Only set from a documented provider cap.
  maxReferenceClipSeconds?: number
  // Video-only: what the model does when a start/end FRAME and REFERENCE images
  // are attached to the same generation. There is no universal answer — the
  // three values below are three genuinely different provider designs, and a
  // surface that guesses either drops an input silently or sends a 400:
  //
  //   'merged'    — one flat image array with no frame/reference distinction
  //                 (Gemini Omni's and Grok's `image_urls`). Send everything;
  //                 there is nothing to choose between.
  //   'reference' — attaching a reference RE-ROUTES the request, and the frame
  //                 rides along as a reference image (MiniMax H3 and Kling 3.0
  //                 Omni pick their slug this way; see minimaxH3Route /
  //                 klingOmniRoute). Both inputs reach the model, but the frame
  //                 stops being frame one — so the member has to be told.
  //   'exclusive' — the provider forbids the combination outright. The whole
  //                 Seedance family documents first/last-frame and multimodal
  //                 reference-to-video as "three mutually exclusive scenarios
  //                 [that] cannot be used simultaneously", so ONE of the two
  //                 groups has to be dropped and named.
  //
  // Undeclared + no reference-image support at all reads as 'frames-only' (see
  // mixedImageInputPolicy) — there is no reference input to combine.
  mixedImageInputs?: 'merged' | 'reference' | 'exclusive'
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
  // Chat-only: endpoint path on api.kie.ai.
  // e.g. '/gemini-3-flash/v1/chat/completions'
  chatEndpoint?: string
  // Chat-only: request/response shape at that endpoint. Defaults to
  // 'openai-chat' when omitted.
  chatTransport?: ChatTransport
  // Chat-only: the slug sent in the request BODY's `model` field. Required for
  // transports whose endpoint doesn't name the model; omitted for 'openai-chat',
  // where the slug is already in the URL.
  chatSlug?: string
  // Chat-only: star ratings + blurb for the script-model picker.
  chatRating?: ChatRating
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

// The two chat roles. Services name a role rather than a slug, so swapping a
// chat model is a one-line edit here — same rule as every other model in the
// registry.
//
//   DEFAULT — the app-wide workhorse. Prompt-shaping, storyboards, shot logs:
//             structured output against heavily-tuned prompts, read by another
//             model rather than by a person.
//   STRONG  — ~2.6x the credits. The tier for output a person reads and acts
//             on, where a misread style family or a hedged scene prompt costs
//             a re-shoot rather than a retry. The Ad Analyzer names this
//             constant; Scripts and B-Roll reach the same model through their
//             own registry default (see the `defaultFor` on the Gemini 3.6
//             Flash entry below). Product auto-fill sat here and moved back —
//             it feeds another model, not a reader.
//
// Neither constant is what Scripts or B-Roll call any more: those two read the
// member's own pick (see resolveScriptModel in stores/settingsStore.ts), which
// falls back to that pair's own registry default when nothing is chosen. Every
// OTHER chat surface still resolves through these two.
export const CHAT_MODEL_DEFAULT = 'gemini-3-flash'
export const CHAT_MODEL_STRONG = 'gemini-3-6-flash'

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

// The official-API comparison for a chat model. kie's pricing table lists a
// provider list price per MILLION tokens for input and output separately; we
// blend the pair 50/50 and express it per token, matching how `pricing.credits`
// is derived for the same entry so the "% off" chip compares like with like.
function chatOfficial(inUsdPerMillion: number, outUsdPerMillion: number, source: string): OfficialPricing {
  const usdPerToken = (inUsdPerMillion + outUsdPerMillion) / 2 / 1_000_000
  return { usdFor: ({ tokenCount = 1000 }) => usdPerToken * tokenCount, source }
}

const KIE_PRICING = 'https://kie.ai/pricing'

export const MODEL_REGISTRY: ModelEntry[] = [
  // ── Chat / Vision ─────────────────────────────────────────────

  // Chat has a DEFAULT that most surfaces run on, plus a picker in the two apps
  // that write words a person reads — Scripts and B-Roll. Vision extraction,
  // style reads and prompt enhance stay pinned to the default: those calls feed
  // another model, not a reader, and paying Opus rates to shape a prompt is
  // money lit on fire. The Ad Analyzer is the one exception in the other
  // direction — it is pinned to STRONG, because it writes for a reader too and
  // is acted on rather than passed along.
  //
  // Order matters: Gemini 3 Flash is FIRST so it stays getDefaultModel's
  // candidates[0] fallback for any chat consumer without an explicit defaultFor.
  // The two PICKER apps default to Gemini 3.6 Flash instead (August 2026) — the
  // strong tier, for the same reason the Ad Analyzer is pinned to it: what those
  // two write is read by a person and shot against, and it holds a long prompt
  // contract better than the cheaper entries. It costs a member who never opens
  // the picker more per run, which is the trade being made deliberately here;
  // GPT 5.6 Luna is one row away for anyone who wants the cheap run back.
  //
  // Every prompt in this app was written and tuned against Gemini 3 Flash, and
  // the storyboard parsers expect its tag discipline. A stronger model writes
  // better prose; it does not automatically parse better. Keep the tolerant
  // parsers (services/xmlBlocks.ts) tolerant — that matters more now that the
  // two apps with the strictest output contracts run on a different model.
  //
  // PRICING — all eight verified against kie.ai/pricing on 2026-07-31, which
  // lists chat models as separate input and output rows in credits per MILLION
  // tokens. `pricing.credits` here is per THOUSAND and blends the two 50/50 —
  // the same convention the original Gemini entries used, now carried to full
  // precision (0.105, not 0.10) so `officialSavingsPercent` lands exactly on
  // kie's published discount instead of a point either side. The blend is why
  // these are display estimates, not invoices: a storyboard call is input-heavy
  // and a batch of takes is output-heavy, and the real charge is metered
  // server-side either way.
  //
  //   model            in cr/M   out cr/M   blended cr/1k
  //   GPT 5.6 Luna        11.2       67.2      0.0392
  //   Gemini 3 Flash        30        180      0.105
  //   Gemini 3.6 Flash      90        450      0.27
  //   Grok 4.5             160        480      0.32
  //   GPT 5.6 Terra        112        672      0.392
  //   Claude Sonnet 5      170        855      0.5125
  //   GPT 5.6 Sol          280       1680      0.98
  //   Claude Opus 5        400       2000      1.20
  //
  // `official` is kie's own "Official / Fal Price" column, blended the same way
  // — which is what makes the picker's "% off" chip real (Gemini −70%, Claude
  // −57.5/−60%, GPT −72%, Grok −60%).
  //
  // Cached-input and cache-write tiers exist on the OpenAI and Anthropic
  // entries and are deliberately ignored: nothing in this app reuses a prompt
  // prefix across calls, so we'd be quoting a discount no member ever gets.
  {
    id: 'gemini-3-flash',
    displayName: 'Gemini 3 Flash',
    provider: 'Google',
    task: 'chat',
    tags: ['recommended', 'fast', 'cheap'],
    pricing: { unit: 'per-1k-tokens', credits: 0.105 },
    official: chatOfficial(0.5, 3, KIE_PRICING),
    // The default on every surface that ISN'T one of the two pickers or the Ad
    // Analyzer: those calls feed another model rather than a reader, and the
    // prompts were all written and tuned against this one.
    defaultFor: ['character-studio'],
    chatEndpoint: '/gemini-3-flash/v1/chat/completions',
    chatRating: {
      intelligence: 2,
      blurb:
        'The default. Cheapest and fastest of the eight.',
    },
  },

  {
    id: 'gemini-3-6-flash',
    displayName: 'Gemini 3.6 Flash',
    provider: 'Google',
    task: 'chat',
    tags: ['new'],
    pricing: { unit: 'per-1k-tokens', credits: 0.27 },
    official: chatOfficial(1.5, 7.5, KIE_PRICING),
    // CHAT_MODEL_STRONG, the Ad Analyzer's pinned model, and the unpicked
    // default in the two picker apps: it holds a long prompt contract better
    // than the cheaper entries, which is what all three of those calls are —
    // the Ad Analyzer's single JSON object, Scripts' tagged takes, B-Roll's
    // storyboard blocks. Every one of them is read by a person and shot
    // against, so the ~2.6× on the member's own key buys the thing they'd
    // otherwise re-run to get.
    defaultFor: ['ad-anatomy', 'script-architect', 'broll-studio'],
    // OpenAI-compatible variant slug on kie.ai (native 3.6 uses Google's own
    // generateContent shape; our transport speaks OpenAI chat/completions).
    chatEndpoint: '/gemini-3-6-flash-openai/v1/chat/completions',
    chatRating: {
      intelligence: 4,
      blurb:
        'The default here. A step up in writing, for a few times the credits.',
    },
  },

  // Slugs for all six below verified against the `model` enum in each API doc
  // on docs.kie.ai; prices against kie.ai/pricing. Do not guess either.
  {
    id: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    provider: 'Anthropic',
    task: 'chat',
    tags: ['recommended'],
    pricing: { unit: 'per-1k-tokens', credits: 0.5125 },
    official: chatOfficial(2, 10, KIE_PRICING),
    chatEndpoint: '/claude/v1/messages',
    chatTransport: 'claude-messages',
    chatSlug: 'claude-sonnet-5',
    chatRating: {
      intelligence: 4,
      blurb:
        'Sounds the most like a real person. Best for dialogue.',
    },
  },

  {
    id: 'claude-opus-5',
    displayName: 'Claude Opus 5',
    provider: 'Anthropic',
    task: 'chat',
    tags: ['new'],
    pricing: { unit: 'per-1k-tokens', credits: 1.2 },
    official: chatOfficial(5, 25, KIE_PRICING),
    chatEndpoint: '/claude/v1/messages',
    chatTransport: 'claude-messages',
    chatSlug: 'claude-opus-5',
    chatRating: {
      intelligence: 5,
      blurb:
        'The best writer here. Slow, and the priciest run.',
    },
  },

  {
    id: 'gpt-5-6-sol',
    displayName: 'GPT 5.6 Sol',
    provider: 'OpenAI',
    task: 'chat',
    tags: ['new'],
    pricing: { unit: 'per-1k-tokens', credits: 0.98 },
    official: chatOfficial(5, 30, KIE_PRICING),
    chatEndpoint: '/codex/v1/responses',
    chatTransport: 'openai-responses',
    chatSlug: 'gpt-5-6-sol',
    chatRating: {
      intelligence: 5,
      blurb:
        'Follows long instructions to the letter. Best for scene blueprints.',
    },
  },

  {
    id: 'gpt-5-6-terra',
    displayName: 'GPT 5.6 Terra',
    provider: 'OpenAI',
    task: 'chat',
    tags: ['new'],
    pricing: { unit: 'per-1k-tokens', credits: 0.392 },
    official: chatOfficial(2, 12, KIE_PRICING),
    chatEndpoint: '/codex/v1/responses',
    chatTransport: 'openai-responses',
    chatSlug: 'gpt-5-6-terra',
    chatRating: {
      intelligence: 4,
      blurb:
        'Strong all-rounder for a middling price.',
    },
  },

  {
    id: 'gpt-5-6-luna',
    displayName: 'GPT 5.6 Luna',
    provider: 'OpenAI',
    task: 'chat',
    tags: ['fast', 'cheap'],
    pricing: { unit: 'per-1k-tokens', credits: 0.0392 },
    official: chatOfficial(0.2, 1.2, KIE_PRICING),
    // Held the unpicked default in Scripts and B-Roll for a stint (August 2026)
    // and handed it back to Gemini 3.6 Flash. Still the cheapest run in the
    // list by a wide margin — it undercuts even Gemini 3 Flash — so it's the
    // row to reach for when a member wants volume over polish.
    chatEndpoint: '/codex/v1/responses',
    chatTransport: 'openai-responses',
    chatSlug: 'gpt-5-6-luna',
    chatRating: {
      intelligence: 4,
      blurb:
        'The cheapest run here, and it still writes well.',
    },
  },

  {
    id: 'grok-4-5',
    displayName: 'Grok 4.5',
    provider: 'xAI',
    task: 'chat',
    tags: ['new'],
    pricing: { unit: 'per-1k-tokens', credits: 0.32 },
    official: chatOfficial(2, 6, KIE_PRICING),
    chatEndpoint: '/grok/v1/responses',
    chatTransport: 'openai-responses',
    chatSlug: 'grok-4-5',
    chatRating: {
      intelligence: 4,
      blurb:
        'Punchy and willing to be funny. Good for hooks.',
    },
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
    // Influencers' default — its own, not the app-wide one. It held this slot
    // until August 2026, spent a few weeks on the shared Nano Banana 2 default,
    // and is back: faces are what this app makes, and it draws the better one.
    // The family stays consistent across a lineage, since a reference-driven
    // Characters run resolves through resolveImageToImageModel to the
    // `gpt-image-2-image-to-image` sibling below rather than off to another
    // provider. Every OTHER surface still defaults to Nano Banana 2.
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

  // Seedance 2.5 — ByteDance's next-gen video model. Two things separate it
  // from the 2.0 family:
  //
  //   1. Length. It generates up to 30s in one call, where the rest of the
  //      catalog tops out at 15. Hence the extended duration ladder below.
  //   2. Input shape. It is registered with NO first_frame_url /
  //      last_frame_url — every image arrives via `reference_image_urls` as a
  //      generic reference, not as frame one. Same situation as Gemini Omni: no
  //      'image-to-video' and no 'frames-to-video' mode, so B-Roll's Animate tab
  //      and Continuous grey it out rather than silently animating from a still
  //      it can't honour. A frame that reaches the body builder anyway rides
  //      along as a reference image (see buildVideoInput) rather than dropped —
  //      which is why `mixedImageInputs` is 'reference' and not the 'exclusive'
  //      the rest of the family carries.
  //
  //      NEEDS A LIVE CHECK (2026-08-15): docs.kie.ai/market/bytedance/
  //      seedance-2-5 now documents first_frame_url AND last_frame_url on this
  //      model ("last_frame_url cannot be passed alone; first_frame_url must be
  //      provided together with it"), which contradicts the above — either the
  //      slug gained them since it was registered in beta, or the original read
  //      was wrong. Declaring the two frame modes would un-grey it in Continuous
  //      and change how B-Roll animates a still on it, so it is deliberately NOT
  //      being changed off a docs read alone: fire one frames-to-video call at
  //      it first. Everything below is correct for the model as registered.
  //
  // Pricing (kie, beta — user-supplied 2026-08-07). kie publishes two tiers per
  // resolution and the cheaper one is NOT cheaper in practice:
  //   no video input:   480p 28/s · 720p 63/s, billed on OUTPUT seconds
  //   with video input: 480p 17/s · 720p 38/s, billed on (INPUT + OUTPUT)
  // A 5s reference clip on a 5s render is 17×10 = 170 credits at 480p, versus
  // 28×5 = 140 with no clip — so the "discount" tier costs more the moment the
  // reference is longer than ~⅔ of the output. We quote the no-video rate
  // across the board: it's exact for the common case, and we can't know a
  // reference clip's length at estimate time. Same floor caveat as MiniMax H3.
  // kie also notes prices are beta and the +10% top-up bonus makes the
  // effective rate ~10% lower — neither is modelled, since both move the real
  // figure DOWN and an estimate that over-quotes is the safe direction.
  //
  // No `official` / `market` entry, for the same reason as the whole Seedance
  // family: kie undercuts Fal but not BytePlus direct, so we claim no savings
  // rather than pick a flattering baseline.
  // Docs: bytedance/seedance-2-5 on docs.kie.ai.
  {
    id: 'bytedance/seedance-2-5',
    displayName: 'Seedance 2.5',
    provider: 'ByteDance',
    task: 'video',
    modes: ['text-to-video', 'reference-to-video'],
    tags: ['recommended', 'new'],
    supportsReferenceImages: true,
    mixedImageInputs: 'reference',
    supportsReferenceAudio: true,
    supportsReferenceVideos: true,
    // Reference audio/video are capped at 30s TOTAL each here, double the 2.0
    // family's 15s. No published cap on reference_image_urls, so
    // maxReferenceImages stays undeclared and falls back to the conservative
    // default — an over-long ref array is a 400, not a graceful drop.
    maxReferenceClipSeconds: 30,
    pricing: {
      unit: 'per-second',
      credits: 63,
      priceFor: ({ durationSeconds = 5, resolution = '720p' }) => {
        const perSec = resolution === '480p' ? 28 : 63
        return perSec * durationSeconds
      },
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      // The API takes any integer up to 30. This ladder is the app's usual
      // rungs plus the long tail that's the whole point of the model.
      durations: [4, 5, 6, 8, 10, 12, 15, 20, 25, 30],
      resolutions: ['480p', '720p'],
      default: '720p',
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      supportsAudio: true,
    },
  },
  {
    id: 'bytedance/seedance-2',
    displayName: 'Seedance 2.0',
    provider: 'ByteDance',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video', 'reference-to-video'],
    tags: ['recommended', 'new'],
    supportsReferenceImages: true,
    mixedImageInputs: 'exclusive',
    supportsReferenceAudio: true,
    supportsReferenceVideos: true,
    maxReferenceImages: 9,
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
    mixedImageInputs: 'exclusive',
    supportsReferenceAudio: true,
    supportsReferenceVideos: true,
    maxReferenceImages: 9,
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
    mixedImageInputs: 'exclusive',
    supportsReferenceAudio: true,
    supportsReferenceVideos: true,
    maxReferenceImages: 9,
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
    // Not starred: it's the Continuous default because it's frames-native and
    // cheap, which is a cost decision, not a "pick this first" recommendation.
    tags: ['cheap'],
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
  // Kling 3.0 Omni (Kling O3) — Kling's multimodal flagship: native audio,
  // consistent characters across shots, and up to 15s in one call. It ships on
  // kie as FOUR slugs that differ only by which inputs they accept, so we
  // expose one virtual id and pick the real slug at generate time
  // (klingOmniRoute, read by both resolveVideoModelSlug and buildVideoInput):
  //   kling-3.0-omni/text-to-video       prompt + aspect_ratio + duration
  //   kling-3.0-omni/image-to-video      image_urls[] (start, optional end)
  //   kling-3.0-omni/reference-to-video  image_urls[] (≤4 refs) and/or
  //                                      video_urls[] (exactly 1)
  //   kling-3.0-omni/transformation      NOT registered — it restyles a source
  //                                      clip end to end (video input required)
  //                                      and has no docs here yet; a source
  //                                      clip reaches reference-to-video today.
  //
  // Two aspect_ratio rules come from the API and are enforced in the body
  // builder rather than the picker, since they depend on what's attached:
  // 'auto' is REQUIRED when both a start and an end frame are given (and
  // unavailable for a single frame), and REQUIRED for a video-only reference
  // (unavailable once images join the video).
  //
  // Pricing (kie, verified 2026-08-15 on kie.ai/kling-3-0-omni). Per-second,
  // keyed on resolution × audio, with a third tier once a source video rides
  // along: 720p 14 / 18 / 20 · 1080p 18 / 23 / 27 · 4k 67 flat.
  // No `official` / `market` entry: Kling's dev pricing page publishes no rate
  // for the Omni tiers (and none at all for the video-input one), and the
  // neighbouring Kling 3.0 figures matching kie's is an inference, not a
  // verified rate — so we claim no savings rather than invent one.
  // Docs: kling-3.0-omni/{text,image,reference}-to-video on docs.kie.ai.
  {
    id: 'kling-3.0-omni',
    displayName: 'Kling 3.0 Omni',
    provider: 'Kling AI',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video', 'reference-to-video'],
    tags: ['recommended', 'new'],
    supportsReferenceImages: true,
    mixedImageInputs: 'reference',
    // The reference route documents a hard cap of 4 reference images and
    // exactly one source video — an over-long array is a 400, not a drop.
    maxReferenceImages: 4,
    supportsReferenceVideos: true,
    maxReferenceVideos: 1,
    pricing: {
      unit: 'per-second',
      credits: 14,
      priceFor: ({ durationSeconds = 5, resolution = '720p', audio = false, videoInput = false }) => {
        const perSec =
          resolution === '4k' ? 67 :
          resolution === '1080p' ? (videoInput ? 27 : audio ? 23 : 18) :
          /* 720p */              (videoInput ? 20 : audio ? 18 : 14)
        return perSec * durationSeconds
      },
    },
    videoEndpoint: 'createTask',
    videoConstraints: {
      // Single-shot mode takes any integer 3–15; this is the app's usual ladder.
      durations: [3, 4, 5, 6, 8, 10, 12, 15],
      resolutions: ['720p', '1080p', '4k'],
      default: '720p',
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
  // Kling Motion Control — character animation by motion transfer. Takes a
  // reference image (the character) + a driving video (the motion) and outputs
  // the character performing that motion. Standard createTask/recordInfo
  // transport; the unique part is the input shape (input_urls + video_urls +
  // character_orientation), handled in buildVideoInput's motion-control branch.
  // No duration/aspect params — clip length is decided by the driving video +
  // character_orientation ('image' → ≤10s, 'video' → ≤30s), so durations: []
  // and aspectRatios: [] (aspect inherits from the reference image).
  // Per-second pricing keyed on resolution (720p/1080p). Source: kie.ai/pricing.
  // Docs: kling-3.0/motion-control on docs.kie.ai. A Kling 2.6 Motion Control
  // entry sat beside this one (cheaper, same inputs) and was removed July 2026.
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
  // Veo 3.1 (Fast / Lite / Quality) is REMOVED from the app (July 2026). The
  // three registry entries are gone, so nothing can select or fire one; see git
  // history to restore them. What deliberately stays is the transport around
  // them — `videoEndpoint: 'veo'`, kieVeoCreate/kieVeoPoll, buildVideoInput's
  // veo3 branch and the `endpoint: 'veo'` field on B-Roll's persisted cards —
  // because history rows written while Veo was live still carry it, and the
  // refresh-resume path reads that field to know which poller to use. Deleting
  // the transport would strand those clips mid-flight.
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
    mixedImageInputs: 'merged',
    // Images cost one slot each out of the shared 7-slot input quota, so 7 is
    // the ceiling when no characters or source clip are attached. Playground,
    // which can attach those, subtracts their slots on top of this.
    maxReferenceImages: 7,
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
      // 720p is the floor tier and what a member expects to land on. 1080p held
      // this slot because it costs the same credits (see priceFor), but "free"
      // isn't the same as "wanted" — a heavier file and a slower render on every
      // pick nobody asked for. 1080p is one click away.
      default: '720p',
      aspectRatios: ['16:9', '9:16'],
    },
    // Ref-capable, but no 'image-to-video' mode — it takes every image as a
    // generic reference, not as frame one — so B-Roll's Animate tab greys it
    // out and asks for Veo / Seedance instead. It's still the recommended Omni
    // pick, but the *default* video model is Grok Imagine 1.5 (below), which
    // does image-to-video and so works everywhere including Animate.
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
  // keyed on resolution: 2.4/s 480p, 4.5/s 720p — kie raised both by 1.5×
  // effective 2026-08-03 02:00 UTC (upstream cost increase, announced by kie).
  //
  // The API schema accepts resolution: '1080p' and we deliberately don't offer
  // it. kie publishes exactly two SKUs for this model (480p and 720p) and no
  // rate for 1080p, so a 1080p gen would be billed at a figure we can't quote —
  // every credits pill, batch-confirm total and the Dashboard money-saved
  // metric would under-report it. The neighbouring grok-imagine (1.0) entry on
  // kie's price list is the tell: it carries a native 1080p tier (8/s) AND
  // separate upscale SKUs (720p→1080p 20/upscale, 480p→1080p 30/upscale), so an
  // unpriced 1080p here is as likely to be an upscale as a native render.
  // Re-add only when kie lists a per-second 1080p price for THIS model id.
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
    mixedImageInputs: 'merged',
    pricing: {
      unit: 'per-second',
      credits: 4.5,
      priceFor: ({ durationSeconds = 8, resolution = '480p' }) =>
        (resolution === '720p' ? 4.5 : 2.4) * durationSeconds,
    },
    // kie's own "Official / Fal Price" column, read per resolution rather than
    // derived from a single ratio: $0.08/s at 480p and $0.14/s at 720p (both
    // verified on kie.ai/pricing 2026-08-03). A flat kie/0.15 quoted 85% off on
    // both tiers; the real discounts differ (−85% at 480p, −84% at 720p)
    // because kie raised 720p by more than xAI's own gap between the tiers.
    official: {
      usdFor: ({ durationSeconds = 8, resolution = '480p' }) =>
        (resolution === '720p' ? 0.14 : 0.08) * durationSeconds,
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
    // Default video model for Playground and B-Roll (Line-by-Line): cheap, fast,
    // does text/image/reference-to-video. Continuous keeps its own Seedance 1.5
    // Pro default.
    defaultFor: ['broll-studio', 'playground'],
  },

  // MiniMax H3 (a.k.a. Hailuo 03) — MiniMax's 2K flagship. It ships on kie as
  // THREE slugs that differ only by which inputs they accept, so we expose one
  // virtual id and pick the real slug at generate time (minimaxH3Route, read by
  // both resolveVideoModelSlug and buildVideoInput):
  //   minimax-h3/text-to-video       prompt + aspect_ratio + duration
  //   minimax-h3/image-to-video      first_frame_url / last_frame_url (≥1 of
  //                                  the two) — and NO aspect_ratio field at
  //                                  all; the route errors when one is sent
  //   minimax-h3/reference-to-video  reference_image_urls (≤9) /
  //                                  reference_video_urls (≤3) /
  //                                  reference_audio_urls (≤3) + aspect_ratio
  // Output is 2K on every route — none of the three takes a resolution param.
  // Audio is generated natively with no toggle, hence supportsAudio: false
  // (same shape as Grok above: the flag means "offers an audio control").
  // Docs: minimax-h3/{text,image,reference}-to-video on docs.kie.ai.
  {
    id: 'minimax-h3',
    displayName: 'MiniMax H3',
    provider: 'MiniMax',
    task: 'video',
    modes: ['text-to-video', 'image-to-video', 'frames-to-video', 'reference-to-video'],
    tags: ['new'],
    supportsReferenceImages: true,
    mixedImageInputs: 'reference',
    supportsReferenceAudio: true,
    supportsReferenceVideos: true,
    maxReferenceImages: 9,
    // 36.5 credits/s of generated video, plus 11 credits per input image past
    // the first five (input audio is free). Source (user-supplied kie pricing:
    // $0.1825/s, $0.055/image at 200 credits/$). Two costs we deliberately do
    // NOT model: kie also bills the DURATION of any reference video at the same
    // per-second rate, and no video call site passes an image count. Both can
    // only push the real figure up, so the estimate reads as a floor.
    pricing: {
      unit: 'per-second',
      credits: 36.5,
      priceFor: ({ durationSeconds = 6, inputImageCount = 1 }) =>
        36.5 * durationSeconds + 11 * Math.max(0, inputImageCount - 5),
    },
    // No `official` entry on purpose: MiniMax publishes no comparable
    // per-second list price we can cite, and an unverified baseline would be
    // inventing a discount. No savings claimed rather than a flattering one.
    videoEndpoint: 'createTask',
    videoConstraints: {
      // The API takes any integer 4–15s; this is the app's usual ladder.
      durations: [4, 5, 6, 8, 10, 12, 15],
      resolutions: ['2K'],
      default: '2K',
      aspectRatios: ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'],
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
  // Suno V5 was removed in August 2026 — V5.5 is a strictly better model for
  // 10 more credits a call, and offering the older one meant a picker whose
  // only real choice was "the worse one, slightly cheaper". Migration
  // `2026-08-remove-suno-v5` clears persisted picks (including Playground's
  // draft `state` blob, which snapshots modelId outside perAppModel and is
  // validated by nothing). The transport is untouched: `buildMusicInput` still
  // derives the API variant from the id, so restoring the entry is one block.
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

// How many reference images a model with no declared cap is assumed to take.
// Six is what B-Roll can already put on a single request today — character,
// product, and the four hand-attached extras — so nothing new is being asked of
// an undocumented provider limit. It leaves room for a character, the product
// and all four of its extra angles. Raise a model past this by declaring
// `maxReferenceImages` on its registry entry, with the source in a comment.
export const UNDECLARED_REFERENCE_IMAGE_CAP = 6

export function referenceImageCapacity(modelId?: string): number {
  const model = modelId ? getModel(modelId) : undefined
  return model?.maxReferenceImages ?? UNDECLARED_REFERENCE_IMAGE_CAP
}

// Combined seconds allowed across a reference audio (or video) strip when the
// model declares no cap of its own. 15s is the Seedance 2.0 family's documented
// limit and was hardcoded in Playground until Seedance 2.5 doubled it.
export const UNDECLARED_REFERENCE_CLIP_SECONDS = 15

export function referenceClipCapacitySeconds(modelId?: string): number {
  const model = modelId ? getModel(modelId) : undefined
  return model?.maxReferenceClipSeconds ?? UNDECLARED_REFERENCE_CLIP_SECONDS
}

// How many reference video clips a model with no declared cap takes. Three is
// the Seedance 2 family's documented limit and was hardcoded in Playground's
// strip until Kling 3.0 Omni, which takes exactly one.
export const UNDECLARED_REFERENCE_VIDEO_CAP = 3

export function referenceVideoCapacity(modelId?: string): number {
  const model = modelId ? getModel(modelId) : undefined
  return model?.maxReferenceVideos ?? UNDECLARED_REFERENCE_VIDEO_CAP
}

// What happens when a start/end FRAME and REFERENCE images are attached to the
// same video generation — see ModelEntry.mixedImageInputs for the three shapes.
// 'frames-only' is derived rather than declared: a model with no reference-image
// input has nothing to combine, so there is no policy to write on its entry.
export type MixedImageInputPolicy = 'merged' | 'reference' | 'exclusive' | 'frames-only'

export function mixedImageInputPolicy(modelId?: string): MixedImageInputPolicy {
  const model = modelId ? getModel(modelId) : undefined
  if (!model) return 'frames-only'
  if (model.mixedImageInputs) return model.mixedImageInputs
  // Undeclared falls to 'exclusive' rather than 'merged', because the two costs
  // are not symmetrical: guessing 'exclusive' wrongly drops an input and says
  // so, while guessing 'merged' wrongly sends a combination the provider
  // rejects — a 400 on a run the member has already committed to. Declare
  // 'merged' from a doc that says the fields coexist, never from a hunch.
  // (Kling 3.0 Turbo lands here and it reads right: it declares reference
  // images but only image-to-video, so a reference IS its start frame and the
  // two genuinely can't both be sent.)
  const takesRefs = model.supportsReferenceImages || (model.modes ?? []).includes('reference-to-video')
  return takesRefs ? 'exclusive' : 'frames-only'
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

// Everything a chat call needs to reach a model: where to POST, what shape to
// speak, and (for the shared endpoints) which slug to name in the body.
// `kieChatCompletions` takes one of these instead of a bare path so a service
// never has to know which of the three transports its model uses.
export interface ChatTarget {
  endpoint: string
  transport: ChatTransport
  // Body-level `model` field. Undefined for 'openai-chat', where the URL names it.
  slug?: string
}

// Convenience for chat-using services. Resolves the configured chat model to a
// call target, throwing if misconfigured.
export function getChatTarget(modelId: string = CHAT_MODEL_DEFAULT): ChatTarget {
  const m = getModel(modelId)
  if (!m?.chatEndpoint) {
    throw new Error(`Chat model ${modelId} is missing a chatEndpoint. Check src/utils/models.ts.`)
  }
  const transport = m.chatTransport ?? 'openai-chat'
  if (transport !== 'openai-chat' && !m.chatSlug) {
    throw new Error(`Chat model ${modelId} uses the ${transport} transport and needs a chatSlug. Check src/utils/models.ts.`)
  }
  return { endpoint: m.chatEndpoint, transport, slug: m.chatSlug }
}

// The chat models offered in the Scripts / B-Roll picker. A model without a
// `chatRating` is deliberately not offered — the picker's whole content is the
// rating and the blurb. Sorted cheapest-first within the caller's grouping.
export function listScriptModels(): ModelEntry[] {
  return listModels({ task: 'chat' }).filter((m) => m.chatRating)
}

// Cost as 1–5 "$" glyphs, DERIVED from the entry's real per-1k rate so a price
// change moves the glyphs on its own. Thresholds are in blended credits per
// 1k tokens and are chosen to separate the models we actually list rather than
// to be a general-purpose scale:
//   1  ≤0.05   Luna
//   2  ≤0.15   Gemini 3 Flash
//   3  ≤0.45   Gemini 3.6, Grok 4.5, Terra
//   4  ≤1.00   Sonnet 5, Sol
//   5  >1.00   Opus 5
// Null when the model has no pricing — the picker then shows no glyphs rather
// than guessing a tier.
export function chatCostTier(modelId: string): 1 | 2 | 3 | 4 | 5 | null {
  const perThousand = estimateCredits(modelId, { tokenCount: 1000 })
  if (perThousand === null) return null
  if (perThousand <= 0.05) return 1
  if (perThousand <= 0.15) return 2
  if (perThousand <= 0.45) return 3
  if (perThousand <= 1) return 4
  return 5
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
// For clips whose spoken lines must FIT inside the duration — rounding down
// would truncate speech mid-sentence.
export function snapVideoDurationUp(current: number, durations: number[]): number {
  if (durations.length === 0 || durations.includes(current)) return current
  const above = durations.filter((d) => d > current)
  return above.length > 0 ? above[0] : durations[durations.length - 1]
}

// Nearest option in either direction, ties going UP. For an ESTIMATE landing on
// a coarse ladder: rounding a 6.3s estimate up to the 8s rung buys 1.7s of dead
// air to protect against 0.3s of overrun, and a duration ladder is coarse enough
// (…6, 8, 10, 12…) that always rounding up runs a whole rung long most of the
// time. Half a rung either way is the honest treatment of a number that is
// itself approximate.
export function snapVideoDurationNearest(current: number, durations: number[]): number {
  if (durations.length === 0 || durations.includes(current)) return current
  // `<=` on an ascending ladder is what sends an exact tie to the longer rung.
  return durations.reduce((best, d) =>
    Math.abs(d - current) <= Math.abs(best - current) ? d : best,
  )
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
  // Kling 3.0 / 3.0 Omni only: allow the model to cut between multiple shots
  // inside one generation. Off for B-Roll (one continuous take per clip).
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
  if (modelId === 'minimax-h3') return `minimax-h3/${minimaxH3Route(opts)}-to-video`
  if (modelId === 'kling-3.0-omni') return `kling-3.0-omni/${klingOmniRoute(opts)}-to-video`
  return modelId
}

// ── Kling 3.0 Omni route selection ────────────────────────────
//
// Omni's three registered slugs take mutually exclusive inputs: the image route
// takes frames in `image_urls`, the reference route takes reference images and
// a source video in `image_urls` / `video_urls`, and only the reference route
// understands a video at all. Decided once here so the slug in the URL and the
// body always agree.

type KlingOmniRoute = 'text' | 'image' | 'reference'

// Start/end frames as a flat list, in shot order.
function klingOmniFrames(opts: VideoGenOptions): string[] {
  const frames: string[] = []
  const first = opts.firstFrameUrl ?? (opts.mode === 'image-to-video' ? opts.imageUrl : undefined)
  if (first) frames.push(first)
  if (opts.lastFrameUrl) frames.push(opts.lastFrameUrl)
  return frames
}

function klingOmniRoute(opts: VideoGenOptions): KlingOmniRoute {
  // Same policy as MiniMax H3: a reference wins the route and any frame rides
  // along as a reference image, because the alternative is billing a clip that
  // silently ignored what the member attached.
  if (opts.referenceImageUrls?.length || opts.referenceVideoUrls?.length) return 'reference'
  return klingOmniFrames(opts).length > 0 ? 'image' : 'text'
}

// ── MiniMax H3 route selection ────────────────────────────────
//
// H3's three kie slugs are mutually exclusive on the API side: the image route
// takes frames and no references, the reference route takes references and no
// frames, and only text/reference accept an aspect_ratio. The choice is made
// once here so the slug in the URL and the body always agree.

type MinimaxH3Route = 'text' | 'image' | 'reference'

// Start/end frames as a flat list, in shot order.
function minimaxH3Frames(opts: VideoGenOptions): string[] {
  const frames: string[] = []
  const first = opts.firstFrameUrl ?? (opts.mode === 'image-to-video' ? opts.imageUrl : undefined)
  if (first) frames.push(first)
  if (opts.lastFrameUrl) frames.push(opts.lastFrameUrl)
  return frames
}

function minimaxH3Route(opts: VideoGenOptions): MinimaxH3Route {
  // Reference audio/video exist ONLY on the reference route. Playground treats
  // them as orthogonal to the image mode, so they can arrive alongside a start
  // frame — and silently dropping one would bill a clip that ignores what the
  // member attached. So any reference wins the route, and the frames ride along
  // as reference images (see the body builder).
  const hasRefs = !!(
    opts.referenceImageUrls?.length ||
    opts.referenceVideoUrls?.length ||
    opts.referenceAudioUrls?.length
  )
  if (hasRefs) return 'reference'
  return minimaxH3Frames(opts).length > 0 ? 'image' : 'text'
}

export function buildVideoInput(modelId: string, opts: VideoGenOptions): Record<string, unknown> {
  const m = getModel(modelId)
  if (!m) throw new Error(`Unknown model: ${modelId}`)

  const ar = opts.aspectRatio ?? '9:16'
  const duration = opts.duration ?? 5
  const resolution = opts.resolution ?? '720p'

  // ── Kling Motion Control (kling-3.0/motion-control) ──
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

  // ── Kling 3.0 Omni ──
  // One virtual id, three routes (see klingOmniRoute). Each body carries only
  // the fields its own route accepts. `customize_multi_shots` is always false —
  // that flag switches the model onto a `multi_prompt` shot array we never
  // send, and the API refuses it outright when both frames are provided.
  // `prefer_multi_shots` (smart storyboarding) is the model deciding its own
  // cuts, which is off unless the caller asks: a B-Roll clip is one take.
  // Duration is a plain integer 3–15, clamped here because a card persisted
  // under another model can carry an off-grid length (Seedance's 30s).
  if (modelId === 'kling-3.0-omni') {
    const omniDuration = Math.min(15, Math.max(3, Math.round(duration)))
    const route = klingOmniRoute(opts)
    const common = {
      prompt: opts.prompt,
      customize_multi_shots: false,
      duration: omniDuration,
      audio: opts.audio ?? false,
      resolution: resolution === '1080p' ? '1080p' : resolution === '4k' || resolution === '4K' ? '4k' : '720p',
    }

    if (route === 'image') {
      const frames = klingOmniFrames(opts)
      return {
        ...common,
        prefer_multi_shots: opts.multiShots ?? false,
        image_urls: frames,
        // 'auto' is required with both frames and unavailable with one.
        aspect_ratio: frames.length > 1 ? 'auto' : ar,
      }
    }

    if (route === 'reference') {
      // A frame that arrived beside a reference is sent AS a reference image
      // rather than dropped; the route has no frame fields of its own.
      const imageUrls = [...klingOmniFrames(opts), ...(opts.referenceImageUrls ?? [])].slice(0, 4)
      const videoUrls = (opts.referenceVideoUrls ?? []).slice(0, 1)
      return {
        ...common,
        ...(imageUrls.length ? { image_urls: imageUrls } : {}),
        ...(videoUrls.length ? { video_urls: videoUrls } : {}),
        // Mirror image of the frame rule: 'auto' is required for a video-only
        // reference and unavailable once images join it.
        aspect_ratio: videoUrls.length && !imageUrls.length ? 'auto' : ar,
      }
    }

    return {
      ...common,
      prefer_multi_shots: opts.multiShots ?? false,
      aspect_ratio: ar,
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

  // ── MiniMax H3 (Hailuo 03) ──
  // One virtual id, three routes (see minimaxH3Route). Each body carries only
  // the fields its own route accepts: the image route rejects aspect_ratio
  // outright, and the reference route has no frame fields — so a frame that
  // arrives alongside a reference is sent as a reference image, not dropped.
  // Duration is a plain integer 4–15; clamped here because a card persisted
  // under another model can carry an off-grid length (Kling's 3s).
  if (modelId === 'minimax-h3') {
    const h3Duration = Math.min(15, Math.max(4, Math.round(duration)))
    const route = minimaxH3Route(opts)
    if (route === 'image') {
      const [first, last] = [
        opts.firstFrameUrl ?? (opts.mode === 'image-to-video' ? opts.imageUrl : undefined),
        opts.lastFrameUrl,
      ]
      return {
        prompt: opts.prompt,
        ...(first ? { first_frame_url: first } : {}),
        ...(last ? { last_frame_url: last } : {}),
        duration: h3Duration,
      }
    }
    if (route === 'reference') {
      const referenceImages = [...minimaxH3Frames(opts), ...(opts.referenceImageUrls ?? [])]
      return {
        prompt: opts.prompt,
        ...(referenceImages.length ? { reference_image_urls: referenceImages.slice(0, 9) } : {}),
        ...(opts.referenceVideoUrls?.length ? { reference_video_urls: opts.referenceVideoUrls.slice(0, 3) } : {}),
        ...(opts.referenceAudioUrls?.length ? { reference_audio_urls: opts.referenceAudioUrls.slice(0, 3) } : {}),
        aspect_ratio: ar,
        duration: h3Duration,
      }
    }
    return { prompt: opts.prompt, aspect_ratio: ar, duration: h3Duration }
  }

  // ── Seedance 2.5 ──
  // No first_frame_url / last_frame_url on this model at all — every image is a
  // generic reference. Sending one anyway is a 422, so a frame that arrives
  // here (a card persisted under a frame-native model, a Playground draft
  // carried across a model flip) is folded into reference_image_urls in shot
  // order rather than dropped: an ignored input is cheaper to explain than a
  // failed generation. Duration is a plain integer 1–30, clamped for the same
  // cross-model reason.
  if (modelId === 'bytedance/seedance-2-5') {
    const referenceImages: string[] = []
    if (opts.firstFrameUrl) referenceImages.push(opts.firstFrameUrl)
    else if (opts.imageUrl && opts.mode === 'image-to-video') referenceImages.push(opts.imageUrl)
    if (opts.lastFrameUrl) referenceImages.push(opts.lastFrameUrl)
    if (opts.referenceImageUrls?.length) referenceImages.push(...opts.referenceImageUrls)
    return {
      prompt: opts.prompt,
      ...(referenceImages.length ? { reference_image_urls: referenceImages } : {}),
      ...(opts.referenceAudioUrls?.length ? { reference_audio_urls: opts.referenceAudioUrls } : {}),
      ...(opts.referenceVideoUrls?.length ? { reference_video_urls: opts.referenceVideoUrls } : {}),
      aspect_ratio: ar,
      duration: Math.min(30, Math.max(1, Math.round(duration))),
      resolution: resolution === '480p' ? '480p' : '720p',
      generate_audio: opts.audio ?? true,
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

  // ModelEntry.id stores the registry id ('suno-v5_5') but Suno's API expects
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
