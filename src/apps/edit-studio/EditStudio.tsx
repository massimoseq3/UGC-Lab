import { CheckCircle2, Download } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import DesktopWallpaper from '../../components/DesktopWallpaper'
import { SKILL_VERSION, useSkillUpdateStore } from '../../stores/skillUpdateStore'
import SkillFolder, { downloadSkill } from './SkillFolder'

// Edit is the last stop in the create row. Unlike the other apps it doesn't
// generate anything in the browser: it hands out the video editor Claude skill
// (a local Claude Code pipeline that turns a script, voiceover, and B-roll into
// a finished captioned 9:16 ad) and walks through setting it up, in the same
// short numbered-steps style as the kie.ai key guide. Copy is kept plain and
// friendly (roughly 6th-grade reading level) for non-technical members.

const DISPLAY_FONT = { fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }

// A clickable label the member will look for in the Claude UI.
function Ui({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-ink-200">{children}</span>
}

// Four steps, one line each. Every step is a thing to do — the reassurance and
// the "what if I've never used Claude Code" link that used to sit around them
// were read once and then in the way every time after.
const SKILL_STEPS: ReactNode[] = [
  <>
    Get{' '}
    <a
      href="https://claude.com/claude-code"
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-ink-200 underline decoration-ink/30 underline-offset-2 hover:text-ink-100"
    >
      Claude Code
    </a>
    .
  </>,
  <>Download the Skill.</>,
  <>
    In Claude: <Ui>Settings → Customize → Add → Upload a skill</Ui>, and pick the file.
  </>,
  <>
    Start a Claude Code chat in a new folder, type <Ui>/video-editor</Ui>, and paste in the paths to
    your B-roll and voiceover.
  </>,
]

// One benefit per line, each with a small green tick.
const BENEFITS = [
  'Cleans up your voiceover',
  'Picks the best B-roll for each line',
  'Speeds clips up or slows them down to fit the voiceover',
  'Adds smooth zooms and background music',
  'Puts captions on the screen that match every word',
]

// Kept next to SKILL_VERSION so the two are edited together.
const SKILL_FILE_SIZE = '45 KB'

export default function EditStudio() {
  const markSeen = useSkillUpdateStore((s) => s.markSeen)
  // Read once on mount: marking it seen must not pull the badge out from under
  // the member while they're looking at the page it's on.
  const [fresh] = useState(() => useSkillUpdateStore.getState().seenVersion < SKILL_VERSION)

  useEffect(() => {
    markSeen()
  }, [markSeen])

  return (
    // Same deep-space wallpaper as the Dashboard. Edit is the other page with no
    // panels of its own — a folder and a card floating on the bare canvas — so it
    // sits on the sky rather than in an empty room.
    // overflow-x-clip, not hidden: the folder's halo is a 135%-wide radial glow
    // that hangs past both edges, and on a phone that made the whole page
    // scroll ~20px sideways. `clip` trims it without turning this into a scroll
    // container, so the pane's own vertical scroll is untouched.
    <div className="relative flex min-h-full flex-col overflow-x-clip">
      <DesktopWallpaper />

      {/* Phone: one column, and the READING order is not the desktop one — the
          title says what the page is, the folder is the thing to take, the
          benefits and the setup steps follow. Desktop keeps the two columns
          (folder left, everything else right) via explicit grid placement, so
          the header can lead on a phone without being duplicated.
          No vertical centering under `md`: a flex column that centres content
          taller than its scroller puts the top of the page out of reach. */}
      <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-7 sm:px-5 md:grid md:grid-cols-2 md:content-center md:items-center md:justify-center md:gap-x-8 md:gap-y-2 md:px-8 md:py-10">
        <header className="md:col-start-2 md:row-start-1">
          <h1
            className="text-[2rem] italic font-normal leading-tight tracking-tight text-ink-50 sm:text-4xl md:text-[2.6rem]"
            style={DISPLAY_FONT}
          >
            Your AI Video Editor
          </h1>
          <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-ink-400">
            A Claude Skill that edits your videos for you.
          </p>
        </header>

        {/* The folder is the download */}
        <div className="flex flex-col items-center gap-6 md:col-start-1 md:row-span-2 md:row-start-1 md:gap-7 md:self-center">
          <SkillFolder fresh={fresh} />
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={downloadSkill}
              className="flex h-11 items-center gap-2 rounded-full bg-ink px-6 text-[14px] font-medium text-paper transition-opacity hover:opacity-90 md:h-10 md:px-5 md:text-[13px]"
            >
              <Download className="h-4 w-4" strokeWidth={2} />
              Download Skill
            </button>
            <p className="text-[11px] text-ink-600">
              video-editor.skill · v{SKILL_VERSION} · {SKILL_FILE_SIZE}
            </p>
          </div>
        </div>

        {/* What it does + how to set it up */}
        <div className="flex flex-col gap-5 md:col-start-2 md:row-start-2">
          <ul className="space-y-1.5">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex items-start gap-2 text-[13.5px] leading-snug text-ink-300">
                <CheckCircle2
                  className="mt-px h-4 w-4 shrink-0 text-emerald-500 light:text-emerald-600"
                  strokeWidth={2}
                />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>

          {/* Blurred, not just translucent: over the starfield a flat 60% fill
              reads as a smudge — the blur is what makes it a pane. */}
          <div className="rounded-3xl border border-ink/10 bg-ink/[0.045] p-4 backdrop-blur-2xl backdrop-saturate-150 shadow-lg shadow-black/30 light:border-black/[0.05] light:bg-white/70 light:shadow-black/[0.08] md:p-5">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink-100">Set it up</h2>
            <ol className="mt-3.5 space-y-3.5">
              {SKILL_STEPS.map((step, i) => (
                <li key={i} className="flex items-start gap-3 text-[13px] leading-relaxed text-ink-400">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-[11px] font-semibold text-ink-300">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
