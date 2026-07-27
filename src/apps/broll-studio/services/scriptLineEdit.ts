// Retyping a scene's spoken line, without paying for a rewrite.
//
// A Dialogue prompt embeds the line VERBATIM inside double quotes — that's the
// contract the storyboard prompt states three times over, because it's what
// makes the clip actually say the words. Which means changing the line is a
// find-and-replace, not a regeneration: swap the quoted words and every other
// detail the member (or the model) put in that prompt — the room, the gesture,
// the light, the camera position — survives untouched.
//
// Deliberately no LLM call here. Re-running the scene would cost credits, take
// seconds, and throw away prompt edits, all to change a sentence the member
// already knows the wording of. The per-card Regenerate prompt button is still
// there for when the new line genuinely needs a different shot.

// Quote characters an LLM might wrap the line in. Straight quotes are what the
// prompt asks for; curly ones show up anyway, and a prompt that came back with
// smart quotes shouldn't be the one scene that silently fails to update.
const OPEN_QUOTES = '"“”«'
const CLOSE_QUOTES = '"“”»'

// Trailing punctuation a model tends to move around when it embeds a line
// ("...cardboard." vs "...cardboard"). Stripped for MATCHING only, so a line
// stored without its full stop still finds the quoted copy that has one.
const TRAILING_PUNCTUATION = /[.,!?;:\s]+$/

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Whitespace-insensitive matcher for `line`, optionally allowing trailing
// punctuation the prompt may have added.
function linePattern(line: string, flags: string): RegExp {
  const core = escapeRegExp(line.replace(TRAILING_PUNCTUATION, ''))
    // Any run of whitespace in the stored line matches any run in the prompt —
    // a line that wrapped across two lines of the response is still the line.
    // Safe after escaping, which never emits a backslash before whitespace.
    .replace(/\s+/g, '\\s+')
  return new RegExp(`${core}[.,!?;:]*`, flags)
}

/**
 * Replace `oldLine` with `newLine` inside `prompt`, preferring the quoted copy.
 *
 * Returns the prompt unchanged when the old line isn't in it — a silent no-op
 * is the right failure here: a b-roll prompt never quotes the line (it SHOWS
 * what the line says), so most cards in a mixed session legitimately have
 * nothing to swap, and rewriting them by force would be the actual bug.
 */
export function swapQuotedLine(prompt: string, oldLine: string, newLine: string): string {
  const from = oldLine.trim()
  const to = newLine.trim()
  if (!from || !to || from === to || !prompt) return prompt

  // Preferred path: the line sitting inside quotes, which is where a dialogue
  // prompt puts it. The quote characters themselves are preserved.
  const quoted = new RegExp(
    `([${escapeRegExp(OPEN_QUOTES)}])(${linePattern(from, '').source})([${escapeRegExp(CLOSE_QUOTES)}])`,
    'i',
  )
  if (quoted.test(prompt)) return prompt.replace(quoted, (_m, open, _body, close) => `${open}${to}${close}`)

  // Fallback: the line embedded without quotes. Rarer, but a prompt that says
  // the words is still saying the words.
  const bare = linePattern(from, 'i')
  if (bare.test(prompt)) return prompt.replace(bare, to)

  return prompt
}

/**
 * Rewrite the scene's line inside the panel's script box, so the script the
 * member sees (and the one the history row is named from) still matches the
 * storyboard.
 *
 * Conservative on purpose: only swaps when the old line appears in the script
 * as its own whole line. The storyboard is allowed to split a sentence into two
 * scenes, so a scene's line is NOT guaranteed to be a line of the script — and
 * a partial match would corrupt a script the member may not have looked at
 * since. No match, no change.
 */
export function swapScriptLine(scriptText: string, oldLine: string, newLine: string): string {
  const from = oldLine.trim()
  const to = newLine.trim()
  if (!from || !to || from === to || !scriptText) return scriptText
  const lines = scriptText.split('\n')
  const index = lines.findIndex((l) => l.trim() === from)
  if (index === -1) return scriptText
  lines[index] = to
  return lines.join('\n')
}
