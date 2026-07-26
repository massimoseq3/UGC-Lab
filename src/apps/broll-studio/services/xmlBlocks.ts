// Tolerant extraction of the XML-ish blocks both storyboard LLMs emit
// (<VAR_2>…</VAR_2>, <CONCEPT_3>…</CONCEPT_3>, <PROMPT>…</PROMPT>).
//
// A strict `<TAG>(.*?)</TAG>` match throws the WHOLE block away when the model
// forgets, mistypes, or truncates the closing tag — which is how a scene came
// back with two variations instead of three, or a keyframe with two concepts.
// Everything inside the block was fine; only its terminator was missing, and
// dropping a prompt the model actually wrote is the worst possible response to
// a one-character defect.
//
// So: strict match first, and when there's no closing tag, read up to a
// BOUNDARY instead of giving up. The boundary differs by what's being read,
// which is the whole subtlety here:
//   - a leaf field (LINE, PROMPT, MOTION) holds prose, so it ends at the next
//     tag of any kind;
//   - a container (VAR_2, CONCEPT_3, SCENE_1) is FULL of tags, so it ends at
//     the next sibling of its own family or at the end of its parent. Using the
//     leaf rule on a container would stop dead at its own first child.

/** Where an unterminated LEAF field ends: at the next tag, open or close. */
const NEXT_TAG = /<\/?[A-Z][A-Z0-9_]*>/

/**
 * Where an unterminated CONTAINER ends: at its next same-family sibling, or at
 * the end of the storyboard. Deliberately NOT "any closing tag" — a container's
 * own children close before it does, so that rule would cut a scene off at its
 * first </LINE>. Callers always pass a body already sliced to the parent, so
 * running to the end of the string when no sibling follows is correct.
 */
function siblingBoundary(prefix: string): RegExp {
  return new RegExp(`<${prefix}_?\\d+>|<FINAL_FRAME>|</STORYBOARD>`, 'i')
}

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

/**
 * A numbered sibling container — <VAR_2>, <CONCEPT_3>, <SCENE_1>. Accepts the
 * underscore-less spelling too (<VAR2>), which the models produce often enough
 * to be worth one extra match rather than another silently missing card.
 */
export function extractNumberedBlock(source: string, prefix: string, n: number): string | null {
  const boundary = siblingBoundary(prefix)
  return extractBlock(source, `${prefix}_${n}`, boundary) ?? extractBlock(source, `${prefix}${n}`, boundary)
}
