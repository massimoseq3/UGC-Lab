import { useSettingsStore } from '../../../stores/settingsStore'
import { kieChatCompletions, type ChatMessage } from '../../../utils/kie'
import { getChatTarget } from '../../../utils/models'

// Gemini 3.1 Flash TTS reads inline square-bracket cues in the dialogue text as
// performance direction (e.g. "[warmly] Hey there. [excited] You have to try
// this."). This turns a plain ad script into an expressive one by inserting
// those cues — WITHOUT changing any of the spoken words.

const SYSTEM_INSTRUCTION = `You are a voiceover director. You take an ad script and add expression tags for a text-to-speech engine, so the read sounds like a real, emotive human creator instead of a flat narrator.

Insert short delivery cues in square brackets, placed immediately BEFORE the words they apply to. Examples of good tags: [warmly], [excited], [confidently], [with a knowing smile], [softly], [playful], [reassuring], [building energy], [slowing down], [genuine], [curious], [matter-of-fact].

STRICT RULES:
- Keep EVERY original word exactly as written, in the same order. Do not add, remove, reword, or reorder any spoken words.
- Only INSERT bracketed tags. Never put a real word inside brackets — brackets are direction only, never spoken.
- Add a tag at the start of the script and wherever the emotion or pace shifts — typically one per sentence or clause. Do not tag every few words; keep it natural.
- Tags are lowercase, 1–5 words, describing tone / emotion / energy / pacing.
- Vary the tags to match the meaning of each line (a hook, a pain point, and a CTA should feel different).
- Preserve the original line breaks and paragraph structure.

Return ONLY the tagged script. No preamble, no explanation, no code fences.`

export async function enhanceScriptWithTags(scriptText: string): Promise<string> {
  const apiKey = useSettingsStore.getState().getKieApiKey()
  const endpoint = getChatTarget()

  const messages: ChatMessage[] = [
    { role: 'system', content: [{ type: 'text', text: SYSTEM_INSTRUCTION }] },
    { role: 'user', content: [{ type: 'text', text: scriptText }] },
  ]

  const raw = await kieChatCompletions(apiKey, endpoint, messages)
  // Defensive: strip any stray code fences the model may wrap it in.
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()
  if (!cleaned) throw new Error('Enhance returned an empty script.')
  return cleaned
}
