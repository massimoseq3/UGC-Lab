export type Gender = 'Female' | 'Male'

// Gemini 3.1 Flash TTS ships 30 prebuilt voices. We group them by delivery
// vibe so the picker's filter chips are useful for ad work (not by gender —
// gender is shown separately). Each voice's `description` is Google's canonical
// one-word character for that voice.
export type VoiceCategory =
  | 'Energetic'
  | 'Warm'
  | 'Authoritative'
  | 'Friendly'

export const VOICE_CATEGORIES: VoiceCategory[] = [
  'Energetic',
  'Warm',
  'Authoritative',
  'Friendly',
]

// Google publishes a pitch band for every voice (in AI Studio's voice library).
// The picker groups AND filters by these, highest → lowest, so members can scan
// by register.
export type VoicePitch = 'Higher' | 'Middle' | 'Lower-middle' | 'Lower'
export const PITCH_ORDER: VoicePitch[] = ['Higher', 'Middle', 'Lower-middle', 'Lower']
export const PITCH_LABELS: Record<VoicePitch, string> = {
  Higher: 'Higher pitch',
  Middle: 'Middle pitch',
  'Lower-middle': 'Lower or mid pitch',
  Lower: 'Lower pitch',
}

export interface VoiceOption {
  // For Gemini the voice IS the name (e.g. "Zephyr") — it's what the API's
  // `voice_name` field wants. `id` mirrors it so bank rows / seed colours keep
  // keying on a stable string.
  id: string
  name: string
  description: string       // Google's one-word character for the voice
  category: VoiceCategory
  pitch: VoicePitch         // Google's published pitch band; groups the picker
  gender?: Gender
}

// The 30 Gemini 3.1 Flash TTS voices. Names + genders are from Google's TTS
// voice docs; the one-word characters are Google's published descriptors.
// Do not rename — the name is the `voice_name` sent to kie.ai.
export const VOICES: VoiceOption[] = [
  // ── Energetic ──────────────────────────────────────────────────
  { id: 'Puck',          name: 'Puck',          description: 'Upbeat and lively',        category: 'Energetic',     pitch: 'Middle',       gender: 'Male' },
  { id: 'Zephyr',        name: 'Zephyr',        description: 'Bright and clear',         category: 'Energetic',     pitch: 'Higher',       gender: 'Female' },
  { id: 'Autonoe',       name: 'Autonoe',       description: 'Bright and buoyant',       category: 'Energetic',     pitch: 'Middle',       gender: 'Female' },
  { id: 'Laomedeia',     name: 'Laomedeia',     description: 'Upbeat and peppy',         category: 'Energetic',     pitch: 'Higher',       gender: 'Female' },
  { id: 'Fenrir',        name: 'Fenrir',        description: 'Excitable and eager',      category: 'Energetic',     pitch: 'Lower-middle', gender: 'Male' },
  { id: 'Sadachbia',     name: 'Sadachbia',     description: 'Lively and animated',      category: 'Energetic',     pitch: 'Lower',        gender: 'Male' },
  { id: 'Pulcherrima',   name: 'Pulcherrima',   description: 'Forward and expressive',   category: 'Energetic',     pitch: 'Middle',       gender: 'Female' },

  // ── Warm ───────────────────────────────────────────────────────
  { id: 'Sulafat',       name: 'Sulafat',       description: 'Warm and inviting',        category: 'Warm',          pitch: 'Middle',       gender: 'Female' },
  { id: 'Achernar',      name: 'Achernar',      description: 'Soft and gentle',          category: 'Warm',          pitch: 'Higher',       gender: 'Female' },
  { id: 'Vindemiatrix',  name: 'Vindemiatrix',  description: 'Gentle and soothing',      category: 'Warm',          pitch: 'Middle',       gender: 'Female' },
  { id: 'Aoede',         name: 'Aoede',         description: 'Breezy and easy',          category: 'Warm',          pitch: 'Middle',       gender: 'Female' },
  { id: 'Enceladus',     name: 'Enceladus',     description: 'Breathy and mellow',       category: 'Warm',          pitch: 'Lower',        gender: 'Male' },
  { id: 'Algieba',       name: 'Algieba',       description: 'Smooth and rich',          category: 'Warm',          pitch: 'Lower',        gender: 'Male' },
  { id: 'Despina',       name: 'Despina',       description: 'Smooth and calm',          category: 'Warm',          pitch: 'Middle',       gender: 'Female' },

  // ── Authoritative ──────────────────────────────────────────────
  { id: 'Charon',        name: 'Charon',        description: 'Informative and steady',   category: 'Authoritative', pitch: 'Lower',        gender: 'Male' },
  { id: 'Rasalgethi',    name: 'Rasalgethi',    description: 'Informative and precise',  category: 'Authoritative', pitch: 'Middle',       gender: 'Male' },
  { id: 'Kore',          name: 'Kore',          description: 'Firm and confident',       category: 'Authoritative', pitch: 'Middle',       gender: 'Female' },
  { id: 'Orus',          name: 'Orus',          description: 'Firm and grounded',        category: 'Authoritative', pitch: 'Lower-middle', gender: 'Male' },
  { id: 'Alnilam',       name: 'Alnilam',       description: 'Firm and assured',         category: 'Authoritative', pitch: 'Lower-middle', gender: 'Male' },
  { id: 'Iapetus',       name: 'Iapetus',       description: 'Clear and articulate',     category: 'Authoritative', pitch: 'Lower-middle', gender: 'Male' },
  { id: 'Erinome',       name: 'Erinome',       description: 'Clear and crisp',          category: 'Authoritative', pitch: 'Middle',       gender: 'Female' },
  { id: 'Algenib',       name: 'Algenib',       description: 'Gravelly and textured',    category: 'Authoritative', pitch: 'Lower',        gender: 'Male' },
  { id: 'Schedar',       name: 'Schedar',       description: 'Even and measured',        category: 'Authoritative', pitch: 'Lower-middle', gender: 'Male' },
  { id: 'Gacrux',        name: 'Gacrux',        description: 'Mature and composed',      category: 'Authoritative', pitch: 'Middle',       gender: 'Female' },
  { id: 'Sadaltager',    name: 'Sadaltager',    description: 'Knowledgeable and calm',   category: 'Authoritative', pitch: 'Middle',       gender: 'Male' },

  // ── Friendly ───────────────────────────────────────────────────
  { id: 'Achird',        name: 'Achird',        description: 'Friendly and open',        category: 'Friendly',      pitch: 'Lower-middle', gender: 'Male' },
  { id: 'Zubenelgenubi', name: 'Zubenelgenubi', description: 'Casual and relaxed',       category: 'Friendly',      pitch: 'Lower-middle', gender: 'Male' },
  { id: 'Leda',          name: 'Leda',          description: 'Youthful and fresh',       category: 'Friendly',      pitch: 'Higher',       gender: 'Female' },
  { id: 'Callirrhoe',    name: 'Callirrhoe',    description: 'Easy-going and mellow',    category: 'Friendly',      pitch: 'Middle',       gender: 'Female' },
  { id: 'Umbriel',       name: 'Umbriel',       description: 'Easy-going and laid back', category: 'Friendly',      pitch: 'Lower-middle', gender: 'Male' },
]

export function getVoiceById(id: string): VoiceOption | undefined {
  return VOICES.find((v) => v.id === id)
}

// ── Delivery controls (Gemini 3.1 Flash TTS `speakers` fields) ──────
// These are the exact option sets kie.ai exposes for the model's `style`,
// `pace`, and `accent` selects — do not invent values, the model only
// recognizes these. Verified against https://kie.ai/gemini-3.1-flash-tts.
export const VOICE_STYLES = [
  'Vocal Smile',
  'Newscaster',
  'Whisper',
  'Empathetic',
  'Promo/Hype',
  'Deadpan',
] as const

export const VOICE_PACES = ['Natural', 'Rapid Fire', 'The Drift', 'Staccato'] as const

export const VOICE_ACCENTS = [
  'Neutral',
  'American (Gen)',
  'American (Valley)',
  'American (South)',
  'British (RP)',
  'British (Brixton)',
  'Transatlantic',
  'Australian',
] as const

export interface VoiceSettings {
  // For Gemini, voiceId === the voice_name (kept as `voiceId` so bank rows,
  // cloud sync, and seed colours don't have to change shape).
  voiceId: string
  voiceName: string
  gender?: Gender
  // Gemini 3.1 Flash TTS delivery parameters:
  style: string              // overall delivery style ('Natural' = neutral)
  pace: string               // one of VOICE_PACES
  accent: string             // 'Neutral' | 'American' | …
  temperature: number        // 0–2 — variation in delivery (1 = default)
  scene: string              // optional scene description (empty = unused)
  sampleContext: string      // optional overall tone / context (empty = unused)
  // The bank preset these settings were loaded from, if any. A label only —
  // never sent to kie. Cleared the moment any control is changed by hand, so
  // the row can't keep claiming a preset the settings no longer match.
  presetId?: string
  presetLabel?: string
}

// The Tone / Context box ships pre-filled rather than empty. It's optional, but
// left blank the model picks its own register, and the read that suits a UGC ad
// is a person talking to a friend — so the default says so, and stays editable.
export const DEFAULT_SAMPLE_CONTEXT = 'Creator talks at a normal tempo.'

export const DEFAULT_VOICE_SETTINGS: Omit<VoiceSettings, 'voiceId' | 'voiceName' | 'gender'> = {
  // 'Empathetic' = the read that lands for UGC ads — a person who means it,
  // talking to you. (kie's own default is the flat 'Deadpan', which reads
  // wrong for ads; 'Vocal Smile' held this slot before it.)
  style: 'Empathetic',
  pace: 'Rapid Fire',
  accent: 'Neutral',
  temperature: 1,
  scene: '',
  sampleContext: DEFAULT_SAMPLE_CONTEXT,
  // Explicitly undefined so "Reset values" (which spreads this object over the
  // live settings) also drops a loaded preset's stamp.
  presetId: undefined,
  presetLabel: undefined,
}

// Normalize a persisted settings blob into a valid, fully-populated VoiceSettings.
// localStorage survives across versions and is NOT run through the bank's
// migrateVoiceShape, so settings saved by the old ElevenLabs Voiceovers (no
// `temperature`, numeric `style`, an ElevenLabs `voiceId`, etc.) reach us here.
// Rendering those directly crashes (e.g. the Expressiveness slider does
// `temperature.toFixed(2)`), so every field is defended and back-filled. Applied
// at READ time (not in an effect) so the very first render is already safe.
export function sanitizeVoiceSettings(s: VoiceSettings | Partial<VoiceSettings> | null | undefined): VoiceSettings {
  const src = (s ?? {}) as Partial<VoiceSettings>
  const def = createDefaultSettings()
  const inList = (v: unknown, opts: readonly string[], fallback: string) =>
    typeof v === 'string' && (opts as readonly string[]).includes(v) ? v : fallback

  // A voiceId that isn't a current Gemini voice (e.g. a leftover ElevenLabs id)
  // can't be sent as `voice_name`, so fall back to the default voice.
  const known = typeof src.voiceId === 'string' ? getVoiceById(src.voiceId) : undefined

  return {
    voiceId: known ? known.id : def.voiceId,
    voiceName: known ? known.name : def.voiceName,
    gender: known ? known.gender : def.gender,
    style: inList(src.style, VOICE_STYLES, DEFAULT_VOICE_SETTINGS.style),
    pace: inList(src.pace, VOICE_PACES, DEFAULT_VOICE_SETTINGS.pace),
    accent: inList(src.accent, VOICE_ACCENTS, DEFAULT_VOICE_SETTINGS.accent),
    temperature:
      typeof src.temperature === 'number' && Number.isFinite(src.temperature)
        ? src.temperature
        : DEFAULT_VOICE_SETTINGS.temperature,
    scene: typeof src.scene === 'string' ? src.scene : '',
    sampleContext: typeof src.sampleContext === 'string' ? src.sampleContext : '',
    presetId: typeof src.presetId === 'string' ? src.presetId : undefined,
    presetLabel: typeof src.presetLabel === 'string' ? src.presetLabel : undefined,
  }
}

// Flatten a saved bank preset into a full settings blob. Runs through
// `sanitizeVoiceSettings` so a preset written against an older option list
// (or a voice that has since left the catalog) still loads without crashing.
export function settingsFromPreset(preset: {
  id: string
  label: string
  voiceId: string
  voiceName: string
  gender?: Gender
  style: string
  pace: string
  accent: string
  temperature: number
  scene?: string
  sampleContext?: string
}): VoiceSettings {
  return sanitizeVoiceSettings({
    voiceId: preset.voiceId,
    voiceName: preset.voiceName,
    gender: preset.gender,
    style: preset.style,
    pace: preset.pace,
    accent: preset.accent,
    temperature: preset.temperature,
    scene: preset.scene ?? '',
    sampleContext: preset.sampleContext ?? '',
    presetId: preset.id,
    presetLabel: preset.label,
  })
}

export interface HistoryItem {
  id: string
  // The TTS model this read was generated with (see stores/types.ts).
  modelId?: string
  voiceId: string
  voiceName: string
  gender?: Gender
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

export function createDefaultSettings(): VoiceSettings {
  // Default to "Puck — Upbeat and lively": an energetic read that suits most
  // AI UGC ads. Falls back to the first voice if Puck ever leaves the catalog.
  const def = VOICES.find((v) => v.id === 'Puck') ?? VOICES[0]
  return {
    voiceId: def.id,
    voiceName: def.name,
    gender: def.gender,
    ...DEFAULT_VOICE_SETTINGS,
  }
}
