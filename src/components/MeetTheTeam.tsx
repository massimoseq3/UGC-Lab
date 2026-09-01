import { useState, type CSSProperties } from 'react'
import { ArrowUpRight, Check, Eye, EyeOff, X, Zap } from 'lucide-react'
import Spinner from './Spinner'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { dockOrderedApps, getAppConfig } from '../utils/constants'
import { getTeamMember } from '../utils/team'
import { useIsAppVisible } from '../stores/appVisibilityStore'
import type { TeamMember } from '../utils/team'
import AppGlassTile, { GlassTile } from './AppGlassTile'
import AppLogo from './AppLogo'
import { useKeyConnect } from './useKeyConnect'
import useCloseOnEscape from '../hooks/useCloseOnEscape'
import { useBackdropClose } from '../hooks/useBackdropClose'

// NO EM DASHES IN THIS SCREEN'S COPY. Massimo's call (August 2026): this is
// the introduction, and it should read like someone talking rather than like
// something written. Use a comma, a colon or a full stop. It applies to every
// string this file RENDERS, which includes the team blurbs in utils/team.ts —
// they surface here and nowhere else. Comments are prose about the code and
// are not covered.
//
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

// Counted off the roster rather than written out, so adding a crew member can't
// leave the headline claiming the old number (it said "Eight" for a day after
// Outliers made nine). Counted at RENDER time, because a member who has
// switched an optional app off is being introduced to one teammate fewer.
const TEAM_COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
function defaultCaption(count: number): string {
  const word = TEAM_COUNT_WORDS[count] ?? String(count)
  return `${word[0].toUpperCase()}${word.slice(1)} teammates, one workspace, and everything they make lands in the shared Bank.`
}

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
        {/* A violet glow off the top edge, so the intro reads as part of the
            sky it opens over rather than a green panel sitting on it. It was
            named after a bloom `.desktop-wallpaper` used to paint; that layer
            is gone (the two full-page screens now show the shared
            `AppBackground` gradient), and this stayed because the modal wants
            its own light regardless of what is behind it. */}
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
  const isVisible = useIsAppVisible()

  // ONE chain, in the dock's own order (September 2026, Massimo's call). It was
  // two groups — "The workflow" over "Always on call" — which split the crew by
  // a distinction the member has no use for on the way in: Bank and the Ad
  // Analyzer are as much part of making an ad as Scripts is, and the second
  // heading mostly said "these three didn't fit the row above". Reading the
  // roster off `dockOrderedApps` is what makes the chain honest — it is the
  // literal order of the tiles waiting behind this modal, so the intro can't
  // promise a flow the dock lays out differently.
  const crew = dockOrderedApps()
    .map((app) => getTeamMember(app.id))
    // Dashboard has no teammate; an optional app switched off has no way in, so
    // introducing its teammate would be introducing a stranger.
    .filter((m): m is TeamMember => !!m && isVisible(m.appId))

  return (
    <div onMouseLeave={() => setHovered(null)}>
      {/* The chain runs along a single rail: a hairline behind the tiles, from
          the first teammate to the last. It replaces the chevrons the old
          workflow row carried between cards — eight of them across a row this
          tight read as clutter, and the rail says the same thing in one stroke.
          It is `sm`-only, because below that the row wraps and a straight line
          behind two-and-a-bit rows would be drawing a flow that isn't there. */}
      <div className="relative pt-1">
        <span aria-hidden className="absolute left-[8%] right-[8%] top-[37px] hidden h-px bg-ink/10 sm:block" />
        {/* `flex-wrap` with thirds below `sm` rather than a grid: eight cards
            leave an orphan row of two, and a wrapping flex row CENTRES it where
            `grid-cols-3` would hang it off the left edge. One nowrap line from
            `sm` up, which is the shape the rail is drawn for. */}
        <div className="relative flex flex-wrap justify-center gap-y-1 sm:flex-nowrap sm:items-stretch">
          {crew.map((member) => (
            <CrewCard key={member.appId} member={member} onVisit={onVisit} onHover={setHovered} />
          ))}
        </div>
      </div>

      {/* The caption slot: it now carries the ROLE as well as the blurb, because
          the role came off the cards. Eight names on one line leave ~78px each,
          which is enough for "Ad Analyzer" and not for "Casting Director" under
          it — and a job title that truncates names no job. Fixed height so a
          hover never nudges the layout. */}
      <p className="mt-3 flex min-h-[38px] items-center justify-center px-4 text-center text-[12.5px] leading-snug text-ink-400">
        {hovered ? (
          <span>
            <span className="font-medium text-ink-200">{hovered.role}</span>
            <span className="px-1.5 text-ink-600">·</span>
            {hovered.blurb}
          </span>
        ) : (
          defaultCaption(crew.length)
        )}
      </p>
    </div>
  )
}

// One teammate, wearing the SAME icon the dock does (`AppGlassTile`) — the
// crab alone introduced a picture that appears nowhere else in the workspace,
// so a member met the crew and then went looking for them among eight glass
// tiles. The crab still arrives on hover, out of the top-right corner, exactly
// as it does in the dock; the card's own lift moves the pair together.
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
      title={`Open ${app.name}: ${member.blurb}`}
      // --tint is the accent at 10%: each teammate's colour appears on demand
      // instead of eight competing swatches at rest.
      style={{ '--tint': `${app.accent}1A` } as CSSProperties}
      className="group relative flex min-w-0 basis-1/3 flex-col items-center gap-1.5 rounded-2xl px-1.5 py-3 transition-colors duration-200 hover:bg-[var(--tint)] focus-visible:bg-[var(--tint)] sm:flex-1 sm:basis-auto"
    >
      {/* The tile sits ON the rail, so it needs its own opaque ground: the
          hairline runs behind the whole row and would otherwise cut across the
          gap either side of every icon. The hover lift carries it. */}
      <span className="relative flex h-12 items-center rounded-2xl bg-surface-1 px-1 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1">
        <AppGlassTile app={app} />
      </span>
      {/* The name alone. The JOB it does moved into the caption slot under the
          row when the two groups became one chain: eight cards on one line
          leave ~78px each, and "Creative Director" clipped to "Creative Dir…"
          names no job. The caption already followed the cursor, so the role is
          one hover away rather than gone. */}
      <span className="w-full min-w-0">
        <span className="block truncate text-[12.5px] font-semibold tracking-tight text-ink-100">{app.name}</span>
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
        {/* The fuel wears the SAME face as the crew it powers: the glass
            squircle every app tile is cut from, in kie.ai's gold, with a bolt
            for a glyph. See ApiKeyGuide for the reasoning — the two key cards
            carry one mark. */}
        <span className="shrink-0">
          <GlassTile icon={Zap} accent="#F2B231" size={44} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-tight text-ink-100">
            {done && <Check className="h-3.5 w-3.5 text-dashboard-400" strokeWidth={3} />}
            {done ? 'Your crew is fuelled' : 'Fuel the crew with a kie.ai key'}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">
            {done
              ? 'Top up anytime via Get Credits in the menu bar.'
              : 'Every generation runs on your own key. Stored only in this browser, and never shared with anyone.'}
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
              placeholder="Paste your key (sk-...)"
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
            {status.phase === 'checking' && <Spinner className="h-3.5 w-3.5" />}
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
