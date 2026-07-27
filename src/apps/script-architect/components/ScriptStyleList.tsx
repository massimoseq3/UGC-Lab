import { FileText, Video } from 'lucide-react'
import {
  WRITE_STYLE_META,
  WRITE_STYLE_GROUP_META,
  writeStylesInGroup,
  type WriteStyle,
  type WriteStyleGroup,
} from '../types'

// The sectioned Script Style list — Structures over Formats — as it appears
// inside a slide-over.
//
// Shared because B-Roll picks the same styles now: a member with no script
// picks one there and B-Roll writes the script AND stages the shots from it.
// Two copies of this list would drift the moment a style is added, renamed or
// reordered, and the slugs are persisted, so a drifted list is a wrong label on
// somebody's saved session rather than a cosmetic bug.
//
// `accent` is the only thing that differs between hosts (Scripts' orange,
// B-Roll's purple), so it's a parameter rather than a fork.
export default function ScriptStyleList({
  value,
  onSelect,
  accent = 'scripts',
}: {
  // The active style, or null when nothing has been picked yet.
  value: WriteStyle | null
  onSelect: (style: WriteStyle) => void
  accent?: 'scripts' | 'broll'
}) {
  const activeRing = accent === 'broll'
    ? 'border-broll-500/30 bg-broll-500/10'
    : 'border-scripts-500/30 bg-scripts-500/10'
  const activeIcon = accent === 'broll'
    ? 'bg-broll-500/10 text-broll-400'
    : 'bg-scripts-500/10 text-scripts-400'
  const activeText = accent === 'broll' ? 'text-broll-300' : 'text-scripts-300'

  return (
    <div className="flex flex-col gap-5 p-4">
      {(Object.keys(WRITE_STYLE_GROUP_META) as WriteStyleGroup[]).map((group) => {
        const GroupIcon = group === 'format' ? Video : FileText
        return (
          <div key={group} className="flex flex-col gap-2">
            <div className="px-1">
              <div className="text-[11px] font-semibold uppercase tracking-widest text-ink-500">
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
