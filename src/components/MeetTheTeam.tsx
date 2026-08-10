import { useState, type CSSProperties } from 'react'
import { ArrowUpRight, Check, ChevronRight, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getAppConfig } from '../utils/constants'
import { TEAM } from '../utils/team'
import type { TeamMember } from '../utils/team'
import CrabSprite from './CrabSprite'
import AppLogo from './AppLogo'
import { useKeyConnect } from './ApiKeyGuide'
import useCloseOnEscape from '../hooks/useCloseOnEscape'
import { useBackdropClose } from '../hooks/useBackdropClose'

// "Meet the team" — the first thing a new member sees. Auto-opens once per
// browser (appStore.teamIntroOpen), reopenable from the wordmark.
//
// It does two jobs, in this order:
//
//   1. Teach the production line. Characters → Scripts → Voiceovers → B-Roll →
//      Edit is the pitch, so it's staged as a row of five crew cards with the
//      flow running left to right, with Bank and the two on-call tools on a
//      quieter second line. It used to be a call sheet — eight rows, eight
//      blurbs — which is a reading task, not an introduction. The blurbs now
//      live in ONE caption slot under the row that follows the cursor, so the
//      screen stays scannable and the copy is still a hover away.
//
//   2. Take the kie.ai key. Nothing in the workspace can generate without one,
//      and this used to be a footnote pointing at Settings — so the member left
//      the intro with the one blocking task undone. The field is here now, on
//      the same verify-then-save path as the ApiKeyGuide (useKeyConnect), and
//      the screen won't pretend the crew is ready until it's filled.

const SERIF = { fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }

// Counted off TEAM rather than written out, so adding a crew member can't
// leave the headline claiming the old number (it said "Eight" for a day after
// Outliers made nine).
const TEAM_COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
const teamCountWord = TEAM_COUNT_WORDS[TEAM.length] ?? String(TEAM.length)
const DEFAULT_CAPTION = `${teamCountWord[0].toUpperCase()}${teamCountWord.slice(1)} teammates, one workspace — and everything they make lands in the shared Bank.`

// The Create chain, in dock order. Category comes from constants.ts so this
// can't drift if an app moves group.
const WORKFLOW = TEAM.filter((m) => getAppConfig(m.appId)?.category === 'create')
const ON_CALL = TEAM.filter((m) => {
  const category = getAppConfig(m.appId)?.category
  return category === 'library' || category === 'tools'
})

export default function MeetTheTeam() {
  const open = useAppStore((s) => s.teamIntroOpen)
  const close = useAppStore((s) => s.closeTeamIntro)
  const openApp = useAppStore((s) => s.openApp)

  useCloseOnEscape(open, close)
  const backdrop = useBackdropClose(close)

  if (!open) return null

  const visit = (appId: string) => {
    close()
    openApp(appId)
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
      {...backdrop}
    >
      {/* Column layout, not a single scrolling box: the header and the CTA stay
          pinned and only the crew scrolls. The app hides scrollbars globally
          (index.css), so anything pushed below the fold is invisible. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-intro-title"
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-ink/10 bg-surface-1 shadow-2xl shadow-black/50"
      >
        {/* The same blue the desktop wallpaper blooms with (rgba(113,101,255) —
            see `.desktop-wallpaper` in index.css), so the intro reads as part of
            the sky it opens over rather than a green panel sitting on it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(600px_220px_at_50%_-10%,rgba(113,101,255,0.16),transparent_75%)]"
        />
        <button
          onClick={close}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-200"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>

        <div className="relative shrink-0 px-6 pb-1 pt-6 text-center">
          <div className="flex items-center justify-center gap-2.5">
            <AppLogo className="h-8 w-8" />
            <h2 id="team-intro-title" className="text-[26px] font-bold tracking-tight text-ink-100">
              Meet Your{' '}
              <span className="font-normal italic" style={SERIF}>
                Team
              </span>
            </h2>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7">
          <Crew onVisit={visit} />
        </div>

        <div className="relative shrink-0 border-t border-ink/[0.07] px-5 py-4 sm:px-7">
          <KeyBlock />
          <div className="mt-4 flex justify-center">
            <button
              onClick={close}
              className="rounded-full bg-ink px-6 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-ink-100"
            >
              Let's get to work
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Crew({ onVisit }: { onVisit: (appId: string) => void }) {
  // One caption for the whole roster, driven by whatever the cursor is on.
  const [hovered, setHovered] = useState<TeamMember | null>(null)

  return (
    <div onMouseLeave={() => setHovered(null)}>
      <SectionLabel>The workflow</SectionLabel>
      {/* Five cards with the pipeline running through them. The arrows carry
          real information — this order is the order you work in — so they only
          appear between the Create apps, never around Bank or the tools. */}
      {/* A 3-across grid on a phone (two rows of three), a single chain from sm
          up. Six cards sharing one 390px line left every name truncated to
          "Ch…" / "Scr…" / "Voi…", which introduces nobody. */}
      <div className="mt-2 grid grid-cols-3 gap-1 sm:flex sm:flex-nowrap sm:items-stretch sm:justify-center">
        {WORKFLOW.map((member, i) => (
          <div key={member.appId} className="flex min-w-0 items-center sm:flex-1">
            {i > 0 && (
              <ChevronRight
                aria-hidden
                className="hidden h-4 w-4 shrink-0 text-ink-700 sm:block"
                strokeWidth={2.5}
              />
            )}
            <CrewCard member={member} onVisit={onVisit} onHover={setHovered} />
          </div>
        ))}
      </div>

      {/* The caption slot. Fixed height so a hover never nudges the layout. */}
      <p className="mt-3 flex min-h-[34px] items-center justify-center px-4 text-center text-[12.5px] leading-snug text-ink-400">
        {hovered ? (
          <span>
            <span className="font-medium text-ink-200">{hovered.name}</span>
            <span className="mx-1.5 text-ink-700">·</span>
            <span className="text-ink-500">{hovered.role}</span>
            <span className="mx-1.5 text-ink-700">·</span>
            {hovered.blurb}
          </span>
        ) : (
          DEFAULT_CAPTION
        )}
      </p>

      <SectionLabel className="mt-4">Always on call</SectionLabel>
      {/* Column count follows the roster: hardcoded at 3, the fourth on-call
          member (Outliers) wrapped onto a line of its own, left-aligned under
          the others. The workflow row above is a fixed chain of five, so only
          this half moves when an app is added. */}
      <div
        className="mt-2 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${ON_CALL.length}, minmax(0, 1fr))` }}
      >
        {ON_CALL.map((member) => (
          <CrewCard key={member.appId} member={member} onVisit={onVisit} onHover={setHovered} />
        ))}
      </div>
    </div>
  )
}

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">{children}</span>
      <span className="h-px flex-1 bg-ink/10" />
    </div>
  )
}

// One teammate. The crab is the card — big enough to read as a character
// rather than a bullet glyph, which is what it was at 28px in the old list.
function CrewCard({
  member,
  onVisit,
  onHover,
}: {
  member: TeamMember
  onVisit: (appId: string) => void
  onHover: (member: TeamMember | null) => void
}) {
  const app = getAppConfig(member.appId)
  if (!app) return null

  return (
    <button
      onClick={() => onVisit(member.appId)}
      onMouseEnter={() => onHover(member)}
      onFocus={() => onHover(member)}
      title={`Open ${app.name} — ${member.blurb}`}
      // --tint is the accent at 10%: each teammate's colour appears on demand
      // instead of eight competing swatches at rest.
      style={{ '--tint': `${app.accent}1A` } as CSSProperties}
      className="group relative flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-2xl px-2 py-3 transition-colors duration-200 hover:bg-[var(--tint)] focus-visible:bg-[var(--tint)]"
    >
      <CrabSprite
        variant={member.appId}
        body={member.roleColor ?? app.accent}
        className="h-10 w-[3.25rem] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1"
      />
      <span className="w-full min-w-0">
        <span className="block truncate text-[12.5px] font-semibold tracking-tight text-ink-100">{app.name}</span>
        <span className="block truncate text-[11px] leading-tight text-ink-500">{member.name}</span>
      </span>
    </button>
  )
}

// The one thing the member still has to do. Connected state included, because
// the intro reopens from the wordmark long after setup.
function KeyBlock() {
  const savedKey = useSettingsStore((s) => s.kieApiKey)
  const { draft, key, status, connected, connect, setDraft } = useKeyConnect()
  const [reveal, setReveal] = useState(false)
  const done = connected || savedKey.trim().length > 0

  return (
    <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-3.5">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-400/10">
          <CrabSprite variant="kie" className="h-8 w-11" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-tight text-ink-100">
            {done && <Check className="h-3.5 w-3.5 text-dashboard-400" strokeWidth={3} />}
            {done ? 'Your crew is fuelled' : 'Fuel the crew with a kie.ai key'}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
            {done
              ? 'Top up anytime via Get Credits in the menu bar.'
              : 'Every generation runs on your own key. Stored only in this browser — do not share it with anyone.'}
          </p>
        </div>
        {!done && (
          <a
            href="https://kie.ai/api-key"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-8 shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 text-[12px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/[0.06] sm:flex"
          >
            Get a key
            <ArrowUpRight className="h-3.5 w-3.5 text-ink-500" strokeWidth={2} />
          </a>
        )}
      </div>

      {!done && (
        <div className="mt-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              type={reveal ? 'text' : 'password'}
              value={draft}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') connect()
              }}
              placeholder="Paste your key — sk-..."
              className="w-full rounded-full border border-ink/10 bg-ink/5 py-2 pl-4 pr-10 text-[13px] text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 focus:bg-ink/[0.07]"
            />
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? 'Hide key' : 'Show key'}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-2 text-ink-500 transition-colors hover:text-ink-300"
            >
              {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <button
            onClick={connect}
            disabled={!key || status.phase === 'checking'}
            className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status.phase === 'checking' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {status.phase === 'checking' ? 'Checking…' : 'Connect'}
          </button>
        </div>
      )}
      {/* Infra surface: kie.ai's own message, not friendly copy — the member
          (or whoever is helping them) needs the real reason. */}
      {status.phase === 'error' && (
        <p className="mt-2 text-[12px] leading-relaxed text-red-300 light:text-red-700">{status.message}</p>
      )}
    </div>
  )
}
