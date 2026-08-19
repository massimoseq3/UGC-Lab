// Tolerant extraction of the XML-ish blocks our prompts ask models to emit
// (<PROMPT>…</PROMPT>, <KEY_SPECS>…</KEY_SPECS>, <VAR_2>…</VAR_2>).
//
// A strict `<TAG>(.*?)</TAG>` match throws the WHOLE block away when the model
// forgets, mistypes, or truncates the closing tag — which is how a scene came
// back with two variations instead of three. Everything inside the block was
// fine; only its terminator was missing, and dropping content the model
// actually wrote is the worst possible response to a one-character defect.
//
// So: strict match first, and when there's no closing tag, read up to a
// BOUNDARY instead of giving up. The boundary differs by what's being read:
//   - a leaf field (LINE, PROMPT, USPS) holds prose, so it ends at the next
//     tag of any kind — that's the default here;
//   - a container (VAR_2, SCENE_1) is FULL of tags, so it ends at the next
//     sibling of its own family. That rule is storyboard-shaped and lives with
//     the storyboard, in broll-studio/services/xmlBlocks.ts.
//
// This half lives in utils because two apps read tagged prose now: B-Roll's
// storyboard and the Bank's product extraction.

/** Where an unterminated LEAF field ends: at the next tag, open or close. */
export const NEXT_TAG = /<\/?[A-Z][A-Z0-9_]*>/

export function extractBlock(source: string, tag: string, boundary: RegExp = NEXT_TAG): string | null {
  const strict = source.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  if (strict) return strict[1].trim()

  const open = source.match(new RegExp(`<${tag}>`, 'i'))
  if (!open || open.index === undefined) return null
  const rest = source.slice(open.index + open[0].length)
  const end = rest.search(boundary)
  const body = (end === -1 ? rest : rest.slice(0, end)).trim()
  return body || null
}
