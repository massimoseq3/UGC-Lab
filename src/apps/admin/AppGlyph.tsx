import { appTint } from './appDisplay'
import { getAppConfig } from '../../utils/constants'

/**
 * An app's dock glyph, drawn in its chart tint. Renders nothing for an id that
 * has left the registry.
 *
 * A component rather than an `appIcon()` lookup the caller renders itself:
 * `const Icon = lookup(id)` followed by `<Icon />` reads to the linter as a
 * component constructed during render (react-hooks), and the repo's rule is
 * that an eslint-disable of a react-hooks rule makes the React Compiler skip
 * the whole file. Declaring it once here keeps both call sites clean and puts
 * "the glyph wears the app's colour" in one place.
 */
export default function AppGlyph({ appId, className }: { appId: string; className?: string }) {
  const Icon = getAppConfig(appId)?.icon
  if (!Icon) return null
  return <Icon className={className} style={{ color: appTint(appId) }} />
}
