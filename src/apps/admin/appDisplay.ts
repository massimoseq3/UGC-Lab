// How an app is named and coloured in the admin app-usage surfaces. Its glyph
// lives beside this in AppGlyph.tsx — a file that exports a component and
// nothing else, which is what react-refresh requires.
//
// The dock accent is the right colour for an app everywhere else in the UI,
// where it sits on a large glyph or a filled tile. At 12px on a dark admin
// panel two of them stop being colours at all: Scripts (#24365A) and Playground
// (#015C52) are near-black, so a bar or an icon drawn in them reads as an empty
// row. Both take a lighter tint of their own hue here. Everything else passes
// through unchanged, so the dock and the charts agree on nine apps out of
// eleven — and the two that differ still read as the same colour family.
//
// Shared by Insights and MembersTable so one app can't be two colours in the
// same panel.

import { getAppConfig } from '../../utils/constants'

const OVERRIDES: Record<string, string> = {
  'script-architect': '#4C6FB1',
  'playground': '#12A594',
}

const FALLBACK = '#6366f1'

export function appTint(appId: string): string {
  return OVERRIDES[appId] ?? getAppConfig(appId)?.accent ?? FALLBACK
}

/**
 * An app's display name. Falls back to the raw id so a row recorded against an
 * app that has since left the registry still says which one it was.
 */
export function appName(appId: string): string {
  return getAppConfig(appId)?.name ?? appId
}
