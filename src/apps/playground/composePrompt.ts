import type { PromptPanelState } from './components/PromptPanel'

// What actually gets sent: the member's prompt, a blank line, then the Voice
// box's profile verbatim — exactly what they were typing on the end by hand,
// which is the contract the box is offered under. Nothing is wrapped around it,
// because a label we invented here would be a word in the prompt they never
// wrote.
//
// It rides on `promptText` in `handleSubmit` rather than travelling as its own
// parameter, so the in-flight tile, the history row and Copy prompt all show
// the string the model was actually given.
//
// Video only, and never on Motion Control: that model takes no audio at all,
// and the box isn't rendered there either.
//
// A separate module from `PromptPanel.tsx` only because a component file that
// also exports a plain function loses Fast Refresh (`react-refresh/
// only-export-components`). The state type comes across as a TYPE import, so
// nothing is imported back at runtime.
export function composePlaygroundPrompt(state: PromptPanelState, isMotionControl: boolean): string {
  const prompt = state.prompt.trim()
  const voice = state.mode === 'video' && !isMotionControl ? (state.voiceProfile ?? '').trim() : ''
  if (!voice) return prompt
  return prompt ? `${prompt}\n\n${voice}` : voice
}
