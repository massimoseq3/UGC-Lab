import type { VoiceSettings, HistoryItem } from '../types'
import { useSettingsStore, resolveTtsModel } from '../../../stores/settingsStore'
import { createTask, pollTask, parseResult, fetchGeneratedAsset } from '../../../utils/kie'
import { saveAsset } from '../../../utils/assetStore'
import { TTS_MODEL_FLASH } from '../../../utils/models'

// The duration is a label on the history card, never a gate — so every failure
// path resolves 0 rather than rejecting, and a clip that simply never reports
// metadata resolves too. This is awaited in the middle of finishVoiceTask,
// AFTER kie has generated and billed for the audio: hanging here would lose a
// paid voiceover to a decode that never settles, for the sake of a timestamp.
const AUDIO_PROBE_TIMEOUT_MS = 10_000

async function probeAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const audio = new Audio()
    let settled = false
    const done = (dur: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(dur)
    }
    const timer = setTimeout(() => done(0), AUDIO_PROBE_TIMEOUT_MS)
    audio.preload = 'metadata'
    audio.addEventListener('loadedmetadata', () => {
      done(isFinite(audio.duration) ? Math.round(audio.duration) : 0)
    })
    audio.addEventListener('error', () => done(0))
    audio.src = url
  })
}

// Build the Gemini TTS `input` body from the app's settings. Both TTS models in
// the registry take this exact body (same speaker fields, same style/pace/accent
// enums, same 30-voice catalog) — only the model id passed to createTask
// differs. They take `speakers` + `dialogue_turns` as native JSON arrays — one speaker
// + one dialogue turn for a single-voice ad read — plus top-level temperature /
// scene / sample_context. (kie's fastjson backend rejects these fields as
// strings with "expect {, actual string" — they must NOT be JSON.stringify'd.)
export function buildVoiceInput(settings: VoiceSettings, scriptText: string): Record<string, unknown> {
  const speakers = [
    {
      speaker_id: 'Speaker 1',
      voice_name: settings.voiceId, // voiceId === Gemini voice_name
      audio_profile: '',
      style: settings.style,
      pace: settings.pace,
      accent: settings.accent,
    },
  ]
  const dialogue_turns = [{ speaker_id: 'Speaker 1', text: scriptText }]

  const input: Record<string, unknown> = { speakers, dialogue_turns, temperature: settings.temperature }
  // scene / sample_context are optional direction — only send when filled.
  if (settings.scene.trim()) input.scene = settings.scene.trim()
  if (settings.sampleContext.trim()) input.sample_context = settings.sampleContext.trim()
  return input
}

// Phase 1: POST createTask, return the kie taskId AND the model it was fired
// against so the caller can persist both before awaiting completion. A mid-flight
// refresh can resume polling by calling finishVoiceTask with the stored taskId.
// The model is snapshotted rather than re-resolved at finish time — a resumed
// task belongs to whichever model was picked when it was submitted.
export async function startVoiceTask(
  settings: VoiceSettings,
  scriptText: string,
): Promise<{ taskId: string; modelId: string }> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const modelId = resolveTtsModel()
  const taskId = await createTask(apiKey, modelId, buildVoiceInput(settings, scriptText))
  return { taskId, modelId }
}

// Phase 2: poll the kie taskId, download the audio, save as an asset, and
// build a HistoryItem from the snapshotted settings + script. Resumable —
// pass the taskId returned by startVoiceTask (possibly from a prior session).
// `modelId` defaults to the Flash entry: the only entries that reach here
// without one are in-flight tasks persisted before the picker shipped, and every
// one of those was fired against that model.
export async function finishVoiceTask(
  taskId: string,
  settings: VoiceSettings,
  scriptText: string,
  modelId: string = TTS_MODEL_FLASH,
): Promise<HistoryItem> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const record = await pollTask(apiKey, taskId)
  const urls = parseResult(record).resultUrls
  if (urls.length === 0) {
    throw new Error(
      `TTS returned no audio. taskId=${taskId} record=${JSON.stringify(record).slice(0, 400)}`,
    )
  }

  const res = await fetchGeneratedAsset(urls[0])
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `Failed to download generated audio (${res.status} ${res.statusText}). url=${urls[0]} body=${body.slice(0, 200)}`,
    )
  }
  const blob = await res.blob()
  const duration = await probeAudioDuration(blob)
  const assetId = await saveAsset(blob)

  return {
    id: crypto.randomUUID(),
    modelId,
    voiceId: settings.voiceId,
    voiceName: settings.voiceName,
    gender: settings.gender,
    style: settings.style,
    pace: settings.pace,
    accent: settings.accent,
    temperature: settings.temperature,
    scene: settings.scene || undefined,
    sampleContext: settings.sampleContext || undefined,
    scriptText,
    scriptPreview: scriptText.slice(0, 80) + (scriptText.length > 80 ? '...' : ''),
    audioUrl: assetId,
    duration,
    createdAt: Date.now(),
  }
}

export async function generateVoice(
  settings: VoiceSettings,
  scriptText: string,
): Promise<HistoryItem> {
  const { taskId, modelId } = await startVoiceTask(settings, scriptText)
  return finishVoiceTask(taskId, settings, scriptText, modelId)
}
