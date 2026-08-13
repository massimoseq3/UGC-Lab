export interface Product {
  id: string
  productImage: string
  // Additional shots of the SAME product — the box closed and open, the sachet
  // beside the tub, the label, what's actually inside. Same `asset://` ref
  // shape as `productImage`. They give auto-fill more to read, and every
  // reference picker lists them alongside the hero so a scene that needs the
  // open box can attach the open box. Absent on rows saved before they existed.
  extraImages?: string[]
  productName: string
  productDescription: string
  targetMarket: string
  painPoints: string
  usps: string
  benefits: string
  offer: string
  cta: string
  // Deep-context fields (optional — absent on rows saved before they existed).
  // Concrete facts: ingredients, materials, specs, sizes, how it works.
  keySpecs?: string
  // Purchase hesitations, each paired with its counter.
  objections?: string
  createdAt: number
  // undefined → legacy (no dot), false → draft (orange dot),
  // true → user-confirmed via Save (green dot).
  confirmed?: boolean
  // User-pinned favourite. Starred items surface first in the bank pickers.
  starred?: boolean
}

export interface Model {
  id: string
  characterImage: string
  jsonProfile: Record<string, unknown> | null
  name: string
  notes: string
  source: 'character-studio' | 'image-dna-extractor' | 'manual-import'
  // Persistent character id minted by kie's /omni/character/create the first
  // time this influencer is attached to a Gemini Omni generation. Scoped to
  // the member's kie.ai account (same key on any browser → same id works).
  omniCharacterId?: string
  // 16:9 character-sheet asset (face turnaround + expressions + full body)
  // attached from a sheet generation in Influencers. Kept alongside the
  // portrait so downstream apps can prefer it as a consistency reference.
  sheetImage?: string
  // User-pinned favourite. Starred items surface first in the bank pickers.
  starred?: boolean
  createdAt: number
}

export interface Script {
  id: string
  title: string
  scriptText: string
  linkedProductId: string
  source: 'script-architect' | 'manual'
  // Distinguishes a generated ad script ('remix', default) from a
  // reverse-engineered reconstruction prompt ('reverse-engineer') and a
  // reusable script-style writing brief from Ad Analyzer ('style').
  // Drives the SCRIPT/SCENES/STYLE badge in the Scripts bank.
  kind?: 'remix' | 'reverse-engineer' | 'style'
  // User-pinned favourite. Starred items surface first in the bank pickers.
  starred?: boolean
  createdAt: number
}

export interface VoicePreset {
  id: string
  label: string
  voiceId: string
  voiceName: string
  gender?: 'Female' | 'Male'
  // Gemini 3.1 Flash TTS delivery params (see voice-studio/types.ts).
  style: string
  pace: string
  accent: string
  temperature: number
  scene?: string
  sampleContext?: string
  linkedModelId: string
  createdAt: number
}

// One saved visual style — the look B-Roll's vision pass distilled out of a set
// of reference frames (or a brief written by hand), kept so the same look can be
// re-applied to any later storyboard. `brief` IS the style: it's the paragraph
// that rides outside the editable prompts at generate time, so a saved style
// carries no subjects, products, or scenes from the frames it came from.
export interface StylePreset {
  id: string
  name: string
  brief: string
  // The frames the look was read from, as asset:// refs. Purely the user's
  // visual memory of what they saved — only `brief` is ever sent to a model.
  thumbRefs?: string[]
  // User-pinned favourite. Starred items surface first in the bank pickers.
  starred?: boolean
  createdAt: number
}

/**
 * A saved ad — the swipe file behind Outliers.
 *
 * The thumbnail is copied into our OWN storage as an asset, because every URL
 * on this row points at a signed CDN link that expires within days. The row
 * would otherwise turn into a wall of broken images a week after it was saved,
 * which is the one thing a swipe file must not do.
 *
 * The VIDEO is deliberately not copied, following the same rule as the B-Rolls
 * bank (stills are saveable, clips are not): a swipe file is meant to hold
 * hundreds of ads, and a few MB each would eat the member's storage cap for
 * footage they can re-fetch. `postUrl` always survives, so the original is one
 * click away; `mediaUrl` is a best-effort shortcut that may go stale.
 */
export interface SwipeItem {
  id: string
  platform: 'tiktok' | 'meta'
  /** The platform's own id, so re-saving the same ad can be detected. */
  sourceId: string
  /** Permalink to the original — the one link guaranteed not to rot. */
  postUrl: string
  /** Our own copy of the cover image. */
  thumbRef?: string
  /** Signed CDN link to the media. Expires; treat as a bonus, never a promise. */
  mediaUrl?: string

  authorHandle: string
  authorName: string
  caption: string
  /** Pulled at save time when it had already been fetched — never re-billed. */
  transcript?: string

  /** Snapshot of the numbers AS SAVED. Live stats move; a swipe is a record. */
  views?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
  followerCount?: number
  outlierMultiple?: number
  daysRunning?: number

  /** Free-text grouping — "hooks to steal", "competitor X". */
  tag?: string
  starred?: boolean
  createdAt: number
}

export interface BRollVideo {
  url: string
  aspectRatio: string
  createdAt: number
}

export interface BRoll {
  id: string
  imageUrl: string
  prompt: string
  productId?: string
  modelId?: string
  scriptId?: string
  videoUrl?: string
  videos?: BRollVideo[]
  // Which app saved this BRoll. Drives B-Roll's Gallery tab so it surfaces
  // only items the B-Roll workflow produced, not items saved from Playground.
  // Missing on legacy entries (pre-2026-05); treated as 'playground' for
  // gallery filter purposes.
  sourceApp?: 'broll-studio' | 'playground'
  // User-pinned favourite. Starred items surface first in the bank pickers.
  starred?: boolean
  createdAt: number
}

// One generation in B-Roll Videos. Pushed automatically on every successful
// generate; rendered in the right-hand History panel as a Flow-style grid.
// `videoUrl` is an asset:// ref (see assetStore) so the blob persists across
// reloads. `linkedBRollId` is set if the user has saved the entry to the
// B-Roll bank — kept so the saved-state UI survives reloads.
export interface VideoHistoryItem {
  id: string
  modelId: string
  prompt: string
  mode: 'text-to-video' | 'image-to-video' | 'frames-to-video' | 'reference-to-video' | 'motion-control'
  aspectRatio: string
  durationSeconds?: number
  resolution?: string
  audio?: boolean
  videoUrl: string
  thumbnailUrl?: string
  linkedBRollId?: string
  // If this generation was kicked off from a B-Roll Bank still (i.e. the
  // slot's start frame, end frame, or one of the reference images came
  // from the bank), keep the source id so a later "Save to Bank" can
  // append the video to that record instead of creating a new one.
  sourceBRollId?: string
  // Which app produced this video. Drives B-Roll's Gallery tab so it ignores
  // Playground video gens. Missing on legacy entries; treated as 'playground'.
  sourceApp?: 'broll-studio' | 'playground'
  createdAt: number
}

export interface VoiceHistoryItem {
  id: string
  voiceId: string
  voiceName: string
  gender?: 'Female' | 'Male'
  // Gemini 3.1 Flash TTS delivery params (see voice-studio/types.ts).
  style: string
  pace: string
  accent: string
  temperature: number
  scene?: string
  sampleContext?: string
  scriptText: string
  scriptPreview: string
  audioUrl: string
  duration: number
  createdAt: number
}

// One generation in the Playground image tab. Pushed automatically on every
// successful image generation. `linkedBRollId` is set if the user has saved
// the image to the B-Rolls bank — kept so the saved badge survives reloads
// and so cleanup leaves the asset alone when the entry is deleted.
export interface ImageHistoryItem {
  id: string
  modelId: string
  prompt: string
  aspectRatio: string
  resolution?: string
  imageUrl: string
  linkedBRollId?: string
  createdAt: number
}

// One script generation in the Scripts tab — auto-pushed on every successful
// generateScript run. Holds 1 variation (reverse-engineer mode) or 3
// variations (write / remix modes). Local-only (no cloud sync yet).
export interface ScriptHistoryItem {
  id: string
  mode: 'write' | 'remix' | 'reverse-engineer'
  variations: string[]
  inputSummary: string
  linkedProductId?: string
  productName?: string
  // Full inputs captured at generation time so selecting a history row can
  // restore the left panel (not just the output). Optional for back-compat
  // with rows saved before this was added.
  winningTranscript?: string
  reversePrompt?: string
  additionalContext?: string
  // Write New mode inputs. Plain string/number so store types don't import
  // app-level unions.
  brief?: string
  writeStyle?: string
  // 'prompt' is the retired Cinematic format — kept here because rows carrying
  // it are already on members' accounts (and cloud-synced). Nothing generates
  // it anymore; isWriteFormat coerces it to 'script' when a row is restored.
  writeFormat?: 'script' | 'hooks' | 'scenes' | 'prompt'
  writeLength?: number
  // Remix only: the target duration, or 'default' when the remix kept the
  // source ad's own length. Absent on rows saved before Remix had a length.
  remixLength?: number | 'default'
  // Hooks format only: the formula-family choice ('auto' or a category slug).
  hookCategory?: string
  // Hooks format only: how many hooks this run asked for. Absent on rows saved
  // before the count became pickable (those always produced ten).
  hookCount?: number
  // How many takes this run asked for. Absent on rows saved before the count
  // became pickable (those always produced five).
  variationCount?: number
  // Remix only: the angles used, in card order. Absent on pre-pickable rows,
  // which OutputPanel matches by variation count instead. Plain strings so the
  // store doesn't import an app-level union.
  remixAngles?: string[]
  createdAt: number
}

// One generation in the Playground music tab. Pushed automatically on every
// successful Suno generation. audioRef is an asset:// id so the audio blob
// persists across reloads (IndexedDB + R2 mirror when cloud is active).
export interface MusicHistoryItem {
  id: string
  modelId: string
  prompt: string
  instrumental: boolean
  audioRef: string
  coverImageRef?: string
  title?: string
  durationSeconds?: number
  createdAt: number
}

// One generation in the Characters tab — auto-pushed on every successful
// generateCharacter run. `imageRef` is an asset:// id (IndexedDB + R2 mirror).
// `profile` is the full form snapshot so the preview modal's "Send to
// Characters" can replace the live form with this generation's exact inputs.
// `linkedModelId` is written when the user saves the entry to the Characters
// bank — kept so the saved-state badge survives reloads and the cleanup pass
// leaves the asset blob alone when the row is deleted.
export interface CharacterHistoryItem {
  id: string
  imageRef: string
  // The form values used to generate this image. Profile snapshot is loose
  // by design — extra keys are tolerated so new form fields don't break
  // hydration of older rows.
  profile: Record<string, string>
  modelId: string
  aspectRatio: string
  resolution?: string
  // undefined → portrait (legacy rows predate sheets). 'sheet' rows attach to
  // an existing Model's sheetImage instead of creating a new bank entry.
  kind?: 'portrait' | 'sheet'
  // Groups a portrait with every edit / sheet derived from it inside the edit
  // modal. Form-generated rows leave this unset (each is its own lineage, keyed
  // by its own id); a derived gen inherits its source's lineage so reopening the
  // editor re-shows the whole strip. See InfluencerEditModal.
  lineageId?: string
  // The visual style this edit was rendered in, when one was picked in the edit
  // modal ("Claymation", a saved style's name). Label only — it never feeds a
  // prompt; it's what lets a save suggest "Mia - Claymation".
  styleName?: string
  linkedModelId?: string
  // One press of Generate can fire up to four characters. Every member of that
  // run shares `batchId` and keeps its position in `batchIndex`, so the Single
  // view can lay the run out as one composition (2-up / 3-up / 2×2) whether its
  // members are still rendering or already finished. Absent for a run of one.
  batchId?: string
  batchIndex?: number
  createdAt: number
}

// One B-Roll session — generated scenes + full per-card state (images, videos,
// prompt history, ref toggles). Clicking restores the workspace to the exact
// state it was in when the snapshot was last saved. Images/videos are
// `asset://` refs so the blobs live in IndexedDB (or R2 mirror) and the row
// stays small.
export interface BrollHistoryItem {
  id: string
  // When the session was first generated — stable across re-saves so a row
  // never jumps around when it's merely reopened or edited. `upsertBrollHistory`
  // preserves the original value on every subsequent write.
  createdAt: number
  // Last time the session was touched (edited, resumed, a new clip generated).
  // Stamped fresh on every upsert. Absent on rows persisted before this field
  // existed — sort/label code falls back to `createdAt`.
  updatedAt?: number
  // Snapshot of the visual style the session was generated with, for the
  // history-row style pill. `styleBrief` (a look distilled from reference
  // frames) wins over the preset `styleId` when set. Absent on legacy rows.
  styleId?: string
  styleBrief?: string
  // Display name of the custom style, when it came from a saved Styles-bank
  // entry. Absent for presets and for a one-off brief that was never named —
  // the pill falls back to "Custom style".
  styleName?: string
  inputSummary: string
  productId?: string
  modelId?: string
  scriptId?: string
  scriptText?: string
  context?: string
  // Both stored as opaque JSON so this file stays decoupled from
  // broll-studio's internal types.
  result: unknown
  cardStates: Record<string, unknown>
  // Which mode this session was generated in. Absent on legacy rows (=> 'line').
  // 'oneshot' is retired — no UI produces it any more, but persisted rows keep it
  // (see the oneShot* fields below), so it stays in the union.
  //
  mode?: 'line' | 'oneshot' | 'continuous'
  // Whether the Line-by-Line cards speak. Absent on legacy rows (=> 'silent',
  // all-silent b-roll). Stamped from the delivery the session actually ran
  // with, not the live toggle, so a flip after the fact can't rewrite it.
  lineDelivery?: 'dialogue' | 'silent'
  // Retired One-Shot mode's snapshot. Nothing writes these any more and the
  // History list hides rows that carry only these (isRetiredOneShotRow) — they
  // are kept, untouched, so no member loses a session or its rendered clips if
  // the mode returns. Do not prune them in a cleanup pass.
  oneShotResult?: unknown
  oneShotCardStates?: Record<string, unknown>
  oneShotDelivery?: 'dialogue' | 'silent'
  oneShotModelId?: string
  // Continuous (keyframe chain) mode snapshot. Absent on older rows.
  continuousResult?: unknown
  continuousFrameStates?: Record<string, unknown>
  continuousClipStates?: Record<string, unknown>
  continuousSelections?: Record<string, unknown>
  continuousStyleId?: string
  continuousModelId?: string
}

// One analysis in the Ad Analyzer. Pushed before the request starts so the
// History rail can show an in-flight row immediately. We don't keep the
// source ad blob long-term — `uploadedRef` is held only while status is
// 'analyzing', then deleted on success or error. `thumbnailRef` is the
// first-frame still that persists for the row's lifetime.
export interface AdAnatomyHistoryItem {
  id: string
  createdAt: number
  // 'analyzing' → request in flight (or queued); 'complete' → result set;
  // 'error' → request failed. Mount-time reconciler flips orphaned
  // 'analyzing' rows to 'error' since chat completions can't resume.
  status: 'analyzing' | 'complete' | 'error'
  // Title Case descriptor. Empty until status === 'complete'; UI falls back
  // to fileName in the meantime.
  adTitle: string
  fileName: string
  mediaKind: 'video' | 'image'
  thumbnailRef?: string
  // Source ad asset id — only present while status === 'analyzing'. Dropped
  // on success/error so the bank doesn't accumulate large video blobs.
  uploadedRef?: string
  // kie.ai job id of the analysis in flight. Set after createTask returns.
  // Persisted so a refresh-mid-analysis can resume polling instead of dropping
  // the result. Missing when the analyser falls back to the streaming
  // transport.
  taskId?: string
  // Legacy: pass-1 output from the retired two-pass analyser (reverted July
  // 2026). Nothing writes it any more; kept so a row still carrying one stays
  // valid, and it's cleared on the next success/error.
  perception?: unknown
  // Opaque JSON so types.ts stays decoupled from ad-anatomy's internal types.
  // Undefined until status === 'complete'.
  result?: unknown
  errorMessage?: string
}

// What kind of generation a usage-ledger event counts. 'image' covers both
// Playground and B-Roll stills; 'script' is one Scripts run (up to 3
// variations); 'analysis' is one completed Ad Analyzer breakdown.
export type UsageKind = 'image' | 'video' | 'voice' | 'music' | 'script' | 'character' | 'analysis'

// One day of generation activity — the Dashboard's usage ledger. Rows are
// keyed by LOCAL calendar day ('2026-07-09') and only ever accumulate:
// deleting/clearing history never subtracts from the ledger, so streaks and
// savings survive history housekeeping. `credits` is the estimated kie spend
// that day; `officialUsd` is what the same generations would have cost on the
// providers' own APIs (equal to the kie cost when a model has no verified
// official rate — unknown savings count as zero, never invented).
export interface UsageDay {
  id: string
  counts: Partial<Record<UsageKind, number>>
  credits: number
  officialUsd: number
  createdAt: number
}

// Anything the bank picker can hand back. Declared once here because the same
// union had drifted into four near-identical local copies, and a picker whose
// callback is typed on a narrower copy fails to compile the moment a bank is
// added. Consumers duck-type off it (`'imageUrl' in item`), so widening it is
// always safe.
export type AnyBankItem = Product | Model | Script | VoicePreset | BRoll | StylePreset

export interface InterAppPayload {
  targetApp: string
  targetField: string
  data: unknown
}

// Payload for the "use a generated video as a Gemini Omni source clip"
// handoff (targetField 'videoSourceClip'). `videoRef` stays an asset:// ref —
// Playground's service resolves those at generate time, and unlike an
// uploaded data URI the ref survives a refresh (it isn't pruned from the
// persisted draft).
export interface VideoSourceClipPayload {
  videoRef: string
  durationSeconds?: number
  label?: string
}

// Payload for the Outliers → Ad Analyzer handoff (targetField 'adVideo').
//
// Carries a live `File`, not an asset:// ref: the Ad Analyzer's own upload path
// already takes Files and saves the asset itself, and `appStore` is not
// persisted, so an in-memory File is safe here in a way it wouldn't be inside
// a stored draft. A refresh mid-handoff simply loses the payload, which is the
// correct outcome — the analysis hasn't started yet.
export interface DiscoverVideoPayload {
  file: File
  /** Permalink to the original post, for the history row's provenance. */
  sourceUrl: string
  caption: string
}

// Payload for the Ad Analyzer → B-Roll handoff (targetField 'adBlueprint').
// Deliberately carries STAGING, not the analysed prompts: `script` is the ad's
// own transcript and `staging` is its beat map + shot craft, which rides the
// same `BrollInput.sceneStaging` seam a Script Style format uses. B-Roll then
// writes fresh prompts against the member's OWN product and character refs,
// shot the way the analysed ad was shot. See services/adBlueprint.ts for why
// the original identity must not travel with it.
export interface AdBlueprintPayload {
  // The analysed ad's title — labels the B-Roll input row and the toast.
  title: string
  script: string
  staging: string
}
