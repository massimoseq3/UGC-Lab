import type { CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import { getAppConfig } from '../utils/constants'
import { TEAM } from '../utils/team'
import type { TeamMember } from '../utils/team'
import CrabSprite from './CrabSprite'
import AppLogo from './AppLogo'
import { API_KEY_STEPS } from './apiKeySteps'
import useCloseOnEscape from '../hooks/useCloseOnEscape'

// "Meet the team" onboarding — frames the dock apps as a production crew,
// one crab per role. Auto-opens once per browser (appStore.teamIntroOpen),
// reopenable from the empty desktop. Clicking a row visits that teammate's
// desk (opens the app) and dismisses the intro.
//
// Laid out as a call sheet, not a tile grid: rows grouped by the app's own
// `category`, with the Create chain numbered because that order is real —
// Characters → Scripts → Voiceovers → B-Roll → Edit is the pipeline, and
// teaching it is half the pitch. A grid of eight equal tiles taught nothing.
//
// Colour discipline: the crabs are the only colour at rest. The old
// per-card accent-tinted panels put eight competing swatches on screen; the
// accent now only appears on hover, as the row's own tint.
//
// The "fuel" callout doubles as the get-started checklist — the crew is
// useless without a kie.ai key. Steps live in ./apiKeySteps so the
// ApiKeyGuide modal stays in sync.

const SERIF = { fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif" }

// Groups follow the dock's own categories so this can't drift from
// constants.ts. Only the Create chain is numbered — Bank and the Tools pair
// aren't steps in a sequence and numbering them would say otherwise.
const GROUPS: { category: string; label: string; numbered?: boolean }[] = [
  { category: 'library', label: 'Shared' },
  { category: 'create', label: 'The workflow', numbered: true },
  { category: 'tools', label: 'Keep on call' },
]

export default function MeetTheTeam() {
  const open = useAppStore((s) => s.teamIntroOpen)
  const close = useAppStore((s) => s.closeTeamIntro)
  const openApp = useAppStore((s) => s.openApp)

  useCloseOnEscape(open, close)

  if (!open) return null

  const visit = (appId: string) => {
    close()
    openApp(appId)
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
      onClick={close}
    >
      {/* Column layout, not a single scrolling box: the header and the
          "Let's get to work" CTA stay pinned and only the roster scrolls.
          The old `overflow-y-auto` on the whole card pushed the CTA below the
          fold on short viewports, and the app hides scrollbars globally
          (index.css) so there was no hint anything was down there. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-intro-title"
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[94dvh] w-full max-w-3xl flex-col rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl"
      >
        <button
          onClick={close}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-200"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>

        {/* Logo sits beside the title rather than above it — this modal opens
            on top of the workspace, where the brand mark is already in the
            menu bar, and the stacked version cost 45px of roster height. */}
        <div className="shrink-0 px-6 pb-3.5 pt-5 text-center">
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

        {/* Scroll region — the roster only. min-h-0 lets it actually shrink
            inside the flex column instead of forcing the card taller. The
            fuel callout is deliberately outside it: on a short viewport the
            one thing that must not scroll out of sight is the to-do. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
          <div className="flex flex-col gap-2.5">
            {GROUPS.map((group) => {
              const members = TEAM.filter(
                (m) => getAppConfig(m.appId)?.category === group.category,
              )
              if (!members.length) return null
              return (
                <section key={group.category}>
                  {/* Section rule: label, then a hairline running out to the
                      edge — the app's usual inset divider, doing double duty
                      as a group header. */}
                  <div className="mb-1 flex items-center gap-3 px-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                      {group.label}
                    </span>
                    <span className="h-px flex-1 bg-ink/10" />
                  </div>
                  <div className="flex flex-col">
                    {members.map((member, i) => (
                      <TeamRow
                        key={member.appId}
                        member={member}
                        index={group.numbered ? i + 1 : undefined}
                        onVisit={visit}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>

        {/* The fuel callout — the crew works for kie.ai credits; no credits,
            no output. The one boxed element on the screen, because it's the
            one thing the member still has to go and do. */}
        <div className="shrink-0 px-4 pt-3 sm:px-6">
          <div className="flex items-center gap-3.5 rounded-2xl border border-ink/10 bg-ink/[0.02] px-4 py-2">
            <span className="flex h-11 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-400/10">
              <CrabSprite variant="kie" className="h-8 w-11" />
            </span>
            <div className="min-w-0">
              <span className="text-[12px] font-semibold tracking-tight text-ink-100">
                kie.ai credits keep your team fed
              </span>
              <ol className="mt-1 flex flex-col gap-x-4 gap-y-1 md:flex-row">
                {API_KEY_STEPS.map((step, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[11px] leading-snug text-ink-500">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink/[0.07] text-[9px] font-semibold text-ink-300 ring-1 ring-inset ring-ink/10">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <div className="shrink-0 px-6 pb-5 pt-3.5">
          <div className="flex justify-center">
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

// One crew row: [step no.] [crab] [app + persona / blurb] [role].
// The numeral column is reserved even in unnumbered groups so every crab
// lines up down the left edge.
function TeamRow({
  member,
  index,
  onVisit,
}: {
  member: TeamMember
  index?: number
  onVisit: (appId: string) => void
}) {
  const app = getAppConfig(member.appId)
  if (!app) return null

  return (
    <button
      onClick={() => onVisit(member.appId)}
      title={`Open ${app.name}`}
      // --tint is the accent at 12% — the sprite well picks it up on hover, so
      // each teammate's colour appears on demand instead of eight at once.
      style={{ '--tint': `${app.accent}1A` } as CSSProperties}
      // focus-visible mirrors hover: the app has no global focus ring (see
      // index.css), but a keyboard user still has to see which crew member
      // they're on. Buttons only match :focus-visible on keyboard focus, so
      // this can't fire on a plain click.
      className="group grid w-full grid-cols-[1.5rem_2.5rem_1fr] items-center gap-x-3 rounded-xl px-2 py-1 text-left transition-colors duration-200 hover:bg-[var(--tint)] focus-visible:bg-[var(--tint)] sm:grid-cols-[1.5rem_2.5rem_1fr_auto]"
    >
      <span
        className="text-right text-lg italic tabular-nums leading-none text-ink-700 transition-colors duration-150 group-hover:text-ink-500"
        style={SERIF}
      >
        {index ? String(index).padStart(2, '0') : ''}
      </span>
      {/* No tinted well behind the crab — the sprite is the only colour at
          rest, and the accent arrives as the row's own hover tint. */}
      <span className="flex h-8 items-center justify-center">
        <CrabSprite
          variant={member.appId}
          body={member.roleColor ?? app.accent}
          className="h-7 w-9 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5"
        />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold tracking-tight text-ink-100">
          {app.name}
          <span className="ml-1.5 font-normal text-ink-500">{member.name}</span>
        </span>
        <span className="block text-[11.5px] leading-snug text-ink-500">
          {member.blurb}
        </span>
      </span>
      {/* Role sits in the right gutter like a credits column — out from under
          the name, where it used to crowd the app title. */}
      <span className="hidden shrink-0 pl-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-600 sm:block">
        {member.role}
      </span>
    </button>
  )
}
