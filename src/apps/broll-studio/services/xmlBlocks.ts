// The storyboard half of the tag reader. The generic leaf reader (`extractBlock`)
// moved to utils/xmlBlocks.ts once the Bank's product extraction started reading
// tagged prose too; what stays here is the part that knows storyboard shapes.
//
// It's re-exported so B-Roll's call sites keep importing one file.
import { extractBlock } from '../../../utils/xmlBlocks'

export { extractBlock } from '../../../utils/xmlBlocks'

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

/**
 * A numbered sibling container — <VAR_2>, <CONCEPT_3>, <SCENE_1>. Accepts the
 * underscore-less spelling too (<VAR2>), which the models produce often enough
 * to be worth one extra match rather than another silently missing card.
 */
export function extractNumberedBlock(source: string, prefix: string, n: number): string | null {
  const boundary = siblingBoundary(prefix)
  return extractBlock(source, `${prefix}_${n}`, boundary) ?? extractBlock(source, `${prefix}${n}`, boundary)
}
