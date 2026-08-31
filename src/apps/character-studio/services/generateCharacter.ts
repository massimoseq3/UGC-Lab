import type { CharacterProfile } from '../types'
import { ALL_FIELD_KEYS } from '../types'
import { useSettingsStore } from '../../../stores/settingsStore'
import { createTask, ensureHostedUrl, kieChatCompletions, type ChatMessage } from '../../../utils/kie'
import { finishImageAssetTask } from '../../../utils/imageTask'
import { getDefaultModel, getModel, buildImageInput, getChatTarget, type AspectRatio, type ImageResolution } from '../../../utils/models'
import { isAssetRef, getAsBase64 } from '../../../utils/assetStore'

export interface GenerationResult {
  imageUrl: string
  jsonPrompt: Record<string, Record<string, string>>
}

/**
 * Groups a flat profile into tab-based JSON sections for display.
 */
export function buildJsonPrompt(profile: CharacterProfile): Record<string, Record<string, string>> {
  const physical: Record<string, string> = {}
  const style: Record<string, string> = {}
  const scene: Record<string, string> = {}
  const pose: Record<string, string> = {}
  const camera: Record<string, string> = {}

  const mapping: Record<string, Record<string, string>> = {
    gender: physical, age: physical, ethnicity: physical, bodyType: physical,
    skinTone: physical, skinTexture: physical, eyeColor: physical, eyeShape: physical,
    hairColor: physical, hairStyle: physical, hairTexture: physical,
    facialFeatures: physical, facialHair: physical, distinguishingMarks: physical,
    clothingStyle: style, accessories: style, makeup: style,
    location: scene, background: scene, lighting: scene, weather: scene, timeOfDay: scene,
    pose: pose, action: pose, expression: pose,
    shotType: camera, cameraAngle: camera, cameraDevice: camera,
  }

  for (const [key, value] of Object.entries(profile)) {
    if (value && mapping[key]) {
      mapping[key][key] = value
    }
  }

  const result: Record<string, Record<string, string>> = {}
  if (Object.keys(physical).length) result['Physical'] = physical
  if (Object.keys(style).length) result['Style'] = style
  if (Object.keys(scene).length) result['Scene'] = scene
  if (Object.keys(pose).length) result['Pose & Action'] = pose
  if (Object.keys(camera).length) result['Camera'] = camera
  return result
}

const SKIP_VALUES = new Set(['None', 'No makeup', 'Indoor (N/A)'])
const has = (v: string | undefined): v is string => !!v && !SKIP_VALUES.has(v)

// Ordered field keys per prompt section. Prompts are emitted as pretty-printed
// JSON — the section names and camelCase keys carry the semantics the old
// prose labels did, and the same JSON is what every Copy-prompt action yields.
const PHYSICAL_KEYS = [
  'gender', 'age', 'ethnicity', 'bodyType', 'skinTone', 'skinTexture',
  'eyeColor', 'eyeShape', 'hairColor', 'hairStyle', 'hairTexture',
  'facialFeatures', 'facialHair', 'distinguishingMarks',
] as const
const WARDROBE_KEYS = ['clothingStyle', 'accessories', 'makeup'] as const
const SCENE_KEYS = ['location', 'background', 'lighting', 'weather', 'timeOfDay'] as const
const POSE_KEYS = ['pose', 'action', 'expression'] as const
const CAMERA_KEYS = ['shotType', 'cameraAngle'] as const

// Pick the given profile keys in order, skipping unset fields and "None"-style
// values. Returns undefined when nothing survives so the whole section drops
// out of the JSON instead of rendering as an empty object.
function pickSection(profile: CharacterProfile, keys: readonly string[]): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const key of keys) {
    const v = profile[key]
    if (has(v)) out[key] = v
  }
  return Object.keys(out).length ? out : undefined
}

// Identity sections — who the person *is*, independent of any scene. Shared by
// the portrait prompt and the character-sheet prompt (a sheet describes the
// same person but ignores scene/pose/camera fields).
function buildIdentityJson(profile: CharacterProfile) {
  return {
    physical: pickSection(profile, PHYSICAL_KEYS),
    wardrobe: pickSection(profile, WARDROBE_KEYS),
  }
}

// Scene / pose / camera sections — the "Scene & Pose" tab. cameraDevice carries
// the photorealism style string verbatim; it lands as a top-level "style" key
// so it reads as the final directive.
function buildSceneJson(profile: CharacterProfile) {
  return {
    scene: pickSection(profile, SCENE_KEYS),
    pose: pickSection(profile, POSE_KEYS),
    camera: pickSection(profile, CAMERA_KEYS),
    style: has(profile.cameraDevice) ? profile.cameraDevice : undefined,
  }
}

// Serialise prompt sections to pretty-printed JSON, dropping empty ones.
// Returns '' when nothing survives so callers' `!prompt` empty checks hold.
function toJsonPrompt(sections: Record<string, unknown>): string {
  const clean = Object.fromEntries(Object.entries(sections).filter(([, v]) => v !== undefined))
  return Object.keys(clean).length ? JSON.stringify(clean, null, 2) : ''
}

// The full generation prompt: one JSON object. Values are preserved verbatim —
// never paraphrased — so chip presets and free-text entries land in the model
// unchanged, and copying the prompt yields the same JSON the model saw.
export function buildImagePrompt(profile: CharacterProfile): string {
  return toJsonPrompt({ ...buildIdentityJson(profile), ...buildSceneJson(profile) })
}

// Physical-only prompt — identity / physical / wardrobe (the Physical tab).
// Backs the scoped "Copy physical" action on the first tab divider.
export function buildPhysicalPrompt(profile: CharacterProfile): string {
  return toJsonPrompt(buildIdentityJson(profile))
}

// Scene & pose prompt — scene / pose / camera (the Scene & Pose tab). Backs the
// scoped "Copy scene & pose" action on the second tab divider.
export function buildScenePrompt(profile: CharacterProfile): string {
  return toJsonPrompt(buildSceneJson(profile))
}

// ── Reading a prompt back in ──

// The field keys a paste may land on — the form's own, which is what keeps
// `aspectRatio` out of reach: it rides in the same profile object but is a
// picker setting rather than a tab field, so it isn't in ALL_FIELD_KEYS and a
// paste can never move it.
const PASTEABLE_KEYS = new Set<string>(ALL_FIELD_KEYS)

export interface ParsedPromptJson {
  fields: Record<string, string>
  count: number
}

// The inverse of buildImagePrompt: read a pasted prompt JSON back into form
// fields.
//
// Tolerant about SHAPE, strict about KEYS. This app itself emits three
// different section layouts over the same fields — buildImagePrompt's lowercase
// sections (physical / wardrobe / scene / pose / camera), the Single view's
// display JSON (`Physical` / `Style` / `Pose & Action` / …), and a flat map with
// no sections at all — and a member pasting from an LLM will produce a fourth.
// What every one of them agrees on is the camelCase FIELD key, so section names
// are walked through and thrown away, and only keys the form actually owns are
// taken. Anything else (a sheet's `layout`, an editor's `direction`, a stray
// note) is ignored rather than treated as an error, because refusing a paste
// over one unknown key would refuse most real ones.
//
// One key is remapped: a top-level `style` STRING is where buildImagePrompt
// puts `cameraDevice` (the photorealism directive), so it round-trips back
// there. It can't collide with the display JSON's `Style` SECTION, which is an
// object and is walked like any other.
//
// Returns null when the text isn't JSON at all, or when nothing in it is a
// field this form owns — the two cases the caller has to say something about.
export function fieldsFromPromptJson(text: string): ParsedPromptJson | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const fields: Record<string, string> = {}
  const take = (key: string, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return
    if (key === 'style') { fields.cameraDevice = value.trim(); return }
    if (PASTEABLE_KEYS.has(key)) fields[key] = value.trim()
  }

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // A section — its name is decoration, its entries are the payload.
      for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
        take(innerKey, innerValue)
      }
    } else {
      take(key, value)
    }
  }

  const count = Object.keys(fields).length
  return count ? { fields, count } : null
}

// Sheet layout directive — leads the prompt so the model commits to the
// panel composition before reading identity details. Scene/pose/camera form
// fields are deliberately ignored: a reference sheet lives on a neutral
// studio background, and its job is identity consistency, not a vibe.
const SHEET_LAYOUT_HORIZONTAL = `Character reference sheet: one single 16:9 image divided into clean panels on a flat, seamless light-gray studio background with even, shadowless softbox lighting. The exact same person appears in every panel — identical face, hair, skin, and wardrobe throughout.

Layout — left third of the frame: one tall panel with a full-body standing shot, head to toe, arms relaxed at the sides, facing forward. Right two-thirds: a grid of six panels in two rows. Top row: head-and-shoulders front view facing the camera directly; head-and-shoulders three-quarter view (45 degrees); head-and-shoulders true side profile. Bottom row, three expression close-ups: neutral and relaxed; warm genuine smile; mid-laugh.

No text, no labels, no logos, no watermarks. Panels separated only by the plain background.`

const SHEET_LAYOUT_VERTICAL = `Character reference sheet: one single 9:16 vertical image divided into clean panels on a flat, seamless light-gray studio background with even, shadowless softbox lighting. The exact same person appears in every panel — identical face, hair, skin, and wardrobe throughout.

Layout — top section: one wide panel with a full-body standing shot, head to toe, arms relaxed at the sides, facing forward. Middle section, a row of three head-and-shoulders panels: front view facing the camera directly; three-quarter view (45 degrees); true side profile. Bottom section, a row of three expression close-ups: neutral and relaxed; warm genuine smile; mid-laugh.

No text, no labels, no logos, no watermarks. Panels separated only by the plain background.`

// Character-sheet prompt: the same JSON shape, led by a "layout" key carrying
// the panel-composition directive, then identity/physical/wardrobe from the
// form. The photorealism style string still applies so the sheet matches the
// look of the portraits it will be used alongside. The layout swaps with
// orientation — horizontal turnaround strip vs stacked rows.
// `direction` is free-text carried over from the editor — the typed instruction
// and/or a picked visual style. It lands LAST so it reads as the final word,
// and it can override the photoreal `style` above it (a claymation sheet is a
// legitimate ask). Absent for a plain sheet built straight off the form.
export function buildSheetPrompt(profile: CharacterProfile, aspect = '16:9', direction?: string): string {
  const layout = aspect.includes('9:16') ? SHEET_LAYOUT_VERTICAL : SHEET_LAYOUT_HORIZONTAL
  return toJsonPrompt({
    layout,
    ...buildIdentityJson(profile),
    style: has(profile.cameraDevice) ? profile.cameraDevice : undefined,
    direction: direction?.trim() || undefined,
  })
}

export type GenerationKind = 'portrait' | 'sheet'

// Resolve a bank asset / data / http(s) ref to a kie-hosted public URL that
// image-to-image models can read (asset:// refs and data: URIs aren't fetchable
// by kie — they must be uploaded first).
async function hostReference(apiKey: string, ref: string): Promise<string> {
  let source = ref
  if (isAssetRef(ref)) {
    const asset = await getAsBase64(ref)
    if (!asset) throw new Error('Reference image could not be loaded.')
    source = `data:${asset.mimeType};base64,${asset.base64}`
  }
  return ensureHostedUrl(apiKey, source)
}

// When a reference image is supplied the model MUST run image-to-image, or kie
// silently drops the ref and burns credits on a text-only gen. Prefer the
// configured model's own i2i mode, then a same-family `-image-to-image`
// sibling, then the registry's default i2i model. Mirrors the Playground/B-Roll
// swap so the house behaviour stays uniform.
function resolveImageToImageModel(pickedId: string): string {
  const picked = getModel(pickedId)
  if (picked?.modes?.includes('image-to-image')) return picked.id
  if (picked) {
    const family = picked.id.replace(/-(text-to-image|image-to-image|image-edit).*$/, '')
    const sibling = getModel(`${family}-image-to-image`)
    if (sibling?.modes?.includes('image-to-image')) return sibling.id
  }
  return getDefaultModel('playground', 'image', 'image-to-image')?.id ?? 'nano-banana-2'
}

// Phase 1: build the prompt, POST createTask, return the taskId so the caller
// can persist it before awaiting completion. A mid-flight refresh can resume
// polling by calling finishCharacterTask with the stored taskId.
//
// `referenceUrl` (a portrait asset/data/http ref) flips the gen to
// image-to-image: the result keeps that exact person's identity. This is how a
// character sheet stays the same face as the portrait it was made from.
export async function startCharacterTask(
  profile: CharacterProfile,
  modelIdOverride?: string,
  resolution?: ImageResolution,
  signal?: AbortSignal,
  kind: GenerationKind = 'portrait',
  sheetAspect = '16:9',
  referenceUrl?: string,
  // Extras carried over from the edit modal, where the same refs / style /
  // instruction panel drives both output kinds. Grouped into an options object
  // rather than trailing more positional args onto an already-long signature.
  extras?: { direction?: string; extraReferenceUrls?: string[] },
): Promise<{ taskId: string; modelId: string }> {
  const apiKey = useSettingsStore.getState().getKieApiKey()

  let modelId = modelIdOverride
    ?? useSettingsStore.getState().getAppModel('character-studio:image:text-to-image')
    ?? getDefaultModel('character-studio', 'image', 'text-to-image')?.id
  if (!modelId) throw new Error('No image model configured for Characters.')

  // Sheets render in their own orientation (16:9 turnaround or 9:16 stacked);
  // the prompt layout follows the same axis. Portraits tolerate both legacy
  // verbose values ('Landscape (16:9)') and raw ratios.
  const sheetIsVertical = sheetAspect.includes('9:16')
  let prompt = kind === 'sheet'
    ? buildSheetPrompt(profile, sheetAspect, extras?.direction)
    : buildImagePrompt(profile)
  const ar = profile.aspectRatio ?? ''
  const aspectRatio: AspectRatio = kind === 'sheet' ? (sheetIsVertical ? '9:16' : '16:9')
    : ar.includes('16:9') ? '16:9' : ar.includes('1:1') ? '1:1' : '9:16'

  // Image-to-image off a reference portrait: swap to an i2i-capable model,
  // host the reference, and lead the prompt with an identity-lock directive.
  // The source portrait goes FIRST; any extra references the user attached
  // follow, matching the ordering startCharacterEditTask uses.
  let inputUrls: string[] | undefined
  if (referenceUrl) {
    modelId = resolveImageToImageModel(modelId)
    const extraRefs = extras?.extraReferenceUrls ?? []
    inputUrls = await Promise.all([referenceUrl, ...extraRefs].map((r) => hostReference(apiKey, r)))
    prompt = `Use the person in the provided reference image as the exact subject — preserve their facial identity, bone structure, hair, and skin precisely across every panel.\n\n${prompt}`
  }

  const body = buildImageInput(modelId, { prompt, aspectRatio, resolution, inputUrls })
  const taskId = await createTask(apiKey, modelId, body, signal)
  return { taskId, modelId }
}

// Image-to-image EDIT: take a base image (+ optional extra references) and a
// free-text edit instruction, and produce a new variation. Unlike
// startCharacterTask the prompt is the user's edit instruction verbatim (not
// built from the profile form), and multiple input images ride along —
// base first, then references — so editing models (Nano Banana 2 / GPT Image 2
// Edit) preserve the subject while applying the change.
export async function startCharacterEditTask(opts: {
  prompt: string
  baseImageRef: string
  referenceRefs?: string[]
  aspectRatio?: AspectRatio
  resolution?: ImageResolution
  modelIdOverride?: string
  signal?: AbortSignal
}): Promise<{ taskId: string; modelId: string }> {
  const apiKey = useSettingsStore.getState().getKieApiKey()

  let modelId = opts.modelIdOverride
    ?? useSettingsStore.getState().getAppModel('character-studio:image:text-to-image')
    ?? getDefaultModel('character-studio', 'image', 'text-to-image')?.id
  if (!modelId) throw new Error('No image model configured for Characters.')
  modelId = resolveImageToImageModel(modelId)

  const inputUrls: string[] = []
  for (const ref of [opts.baseImageRef, ...(opts.referenceRefs ?? [])]) {
    inputUrls.push(await hostReference(apiKey, ref))
  }

  const body = buildImageInput(modelId, {
    prompt: opts.prompt,
    aspectRatio: opts.aspectRatio,
    resolution: opts.resolution,
    inputUrls,
  })
  const taskId = await createTask(apiKey, modelId, body, opts.signal)
  return { taskId, modelId }
}

// Phase 2: poll the taskId, download the result, save as an asset. Resumable
// across refreshes — call with the taskId returned by startCharacterTask
// (possibly persisted from a prior session).
export async function finishCharacterTask(
  taskId: string,
  modelId: string,
  signal?: AbortSignal,
): Promise<string> {
  return finishImageAssetTask(taskId, modelId, { signal })
}

export async function generateCharacter(
  profile: CharacterProfile,
  signal?: AbortSignal,
  modelIdOverride?: string,
  resolution?: ImageResolution,
): Promise<GenerationResult> {
  const { taskId, modelId } = await startCharacterTask(profile, modelIdOverride, resolution, signal)
  const assetId = await finishCharacterTask(taskId, modelId, signal)
  return {
    imageUrl: assetId,
    jsonPrompt: buildJsonPrompt(profile),
  }
}

// ── Edit-instruction enhancement ──
// Sharpens the creator's rough "describe the change" instruction into a clear,
// specific image-edit instruction. Mirrors the Scripts/Playground prompt-enhance
// but tuned for an image-to-image edit on an existing influencer portrait.
const ENHANCE_EDIT_SYSTEM = `You are a senior photo-retouching director. You rewrite a creator's rough edit instruction into a clear, specific instruction for an image-editing model working on an existing portrait of a person. You KEEP the creator's intent — you only edit what they asked for and never invent a different change. You never alter the person's identity (face, bone structure, ethnicity) unless explicitly asked. You make the change concrete (wardrobe, accessories, lighting, background, colour) without padding.`

export async function enhanceEditInstruction(draft: string): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatTarget()

  const userMessage = `Rewrite the rough image-edit instruction below into a sharper instruction for an image-to-image model editing an existing portrait. Keep the creator's intent; make the requested change concrete and specific. Preserve the person's identity unless they explicitly ask to change it.

Rules:
- Keep it a short, direct instruction (a sentence or two), not a full prompt.
- Return ONLY the rewritten instruction as plain text. No preamble, no quotes, no markdown, no "Here is".

Draft:
"""
${draft}
"""`

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: ENHANCE_EDIT_SYSTEM }] },
    { role: 'user', content: [{ type: 'text', text: userMessage }] },
  ]
  const responseText = await kieChatCompletions(apiKey, endpoint, messages)
  return responseText
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*["']|["']\s*$/g, '')
    .trim()
}
