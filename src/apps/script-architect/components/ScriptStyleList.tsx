import { FileText, Video } from 'lucide-react'
import {
  WRITE_STYLE_META,
  WRITE_STYLE_GROUP_META,
  writeStylesInGroup,
  type WriteStyle,
  type WriteStyleGroup,
} from '../types'

// The sectioned Script Style list — Structures over Formats — as it appears
// inside the picker modal.
//
// Shared because B-Roll picks the same styles now: a member with no script
// picks one there and B-Roll writes the script AND stages the shots from it.
// Two copies of this list would drift the moment a style is added, renamed or
// reordered, and the slugs are persisted, so a drifted list is a wrong label on
// somebody's saved session rather than a cosmetic bug.
//
// `accent` and the section order are the only things that differ between hosts,
// so they're parameters rather than a fork.
export default function ScriptStyleList({
  value,
  onSelect,
  accent = 'scripts',
  formatsFirst = false,
}: {
  // The active style, or null when nothing has been picked yet.
  value: WriteStyle | null
  onSelect: (style: WriteStyle) => void
  accent?: 'scripts' | 'broll'
  // Which section leads. B-Roll puts FORMATS on top: it's picking the kind of
  // ad to shoot, and a format is the half that decides the shots (it carries
  // the scene staging) as well as the words. Scripts leads with Structures,
  // where the question is how the argument is built. Same list either way —
  // only the reading order changes.
  formatsFirst?: boolean
}) {
  const activeRing = accent === 'broll'
    ? 'border-broll-500/30 bg-broll-500/10'
    : 'border-scripts-500/30 bg-scripts-500/10'
  const activeIcon = accent === 'broll'
    ? 'bg-broll-500/10 text-broll-400'
    : 'bg-scripts-500/10 text-scripts-text'
  const activeText = accent === 'broll' ? 'text-broll-300' : 'text-scripts-300'

  // Object key order IS the default order (see WRITE_STYLE_GROUP_META). Pulling
  // 'format' to the front rather than reversing, so a third group added later
  // keeps its place instead of being silently flipped.
  const groups = Object.keys(WRITE_STYLE_GROUP_META) as WriteStyleGroup[]
  const ordered = formatsFirst
    ? [...groups].sort((a, b) => Number(b === 'format') - Number(a === 'format'))
    : groups

  return (
    <div className="flex flex-col gap-5 p-4">
      {ordered.map((group) => {
        const GroupIcon = group === 'format' ? Video : FileText
        return (
          <div key={group} className="flex flex-col gap-2">
            <div className="px-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                {WRITE_STYLE_GROUP_META[group].label}
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-ink-600">
                {WRITE_STYLE_GROUP_META[group].hint}
              </div>
            </div>
            {writeStylesInGroup(group).map((style) => {
              const active = style === value
              return (
                <button
                  key={style}
                  type="button"
                  onClick={() => onSelect(style)}
                  className={`flex items-center gap-3 rounded-full border px-4 py-3 text-left transition-colors ${
                    active ? activeRing : 'border-ink/5 bg-ink/[0.02] hover:border-ink/10 hover:bg-ink/[0.04]'
                  }`}
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${active ? activeIcon : 'bg-ink/5 text-ink-500'}`}>
                    <GroupIcon className="h-5 w-5" strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-[13px] font-medium tracking-tight ${active ? activeText : 'text-ink-200'}`}>
                      {WRITE_STYLE_META[style].label}
                    </div>
                    <div className="text-[11px] leading-snug text-ink-500">{WRITE_STYLE_META[style].hint}</div>
                  </div>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
