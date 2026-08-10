import CrabSprite from '../../components/CrabSprite'
import { SKILL_VERSION } from '../../stores/skillUpdateStore'

// The downloadable video editor skill, drawn as a glowing macOS-style folder
// (recreates Massimo's "edit video" folder art in live DOM so it can animate).
// On hover the folder lifts a touch and the work-in-progress cards (a video
// frame, a caption card, a waveform) rise straight out of the top; the folder
// body itself does NOT morph. Clicking anywhere downloads the .skill file.
// The folder keeps its literal ivory/orange colors in both themes (it's
// artwork, like user media); only the page chrome around it is tokenized.

const ACCENT = '#F77646'

// The app's own icon tile: the editor crab (Snips) on an orange, sheened
// rounded square, matching the dock's app-tile look.
function AppIcon({ className }: { className?: string }) {
  return (
    <span
      className={`relative flex items-center justify-center overflow-hidden rounded-[24%] shadow-md shadow-orange-900/25 ${className ?? ''}`}
      style={{ backgroundColor: ACCENT }}
    >
      <span className="absolute inset-0 bg-gradient-to-b from-white/35 via-white/5 to-transparent" />
      <span className="absolute inset-0 rounded-[24%] ring-1 ring-inset ring-white/25" />
      <CrabSprite variant="edit-studio" body="#FFF6F0" className="relative h-auto w-[74%]" />
    </span>
  )
}

// One of the cards that rise out of the folder on hover. Hidden (tucked low
// behind the front pocket) at rest; hover lifts + fans it above the top edge.
function PopCard({
  children,
  restClass,
  hoverClass,
  delay,
}: {
  children: React.ReactNode
  restClass: string
  hoverClass: string
  delay: string
}) {
  return (
    <div
      className={`absolute z-10 rounded-xl bg-white p-2 shadow-lg shadow-black/25 ring-1 ring-black/[0.06] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${restClass} ${hoverClass}`}
      style={{ transitionDelay: delay }}
    >
      {children}
    </div>
  )
}

// Trigger the download from JS (via a throwaway anchor) rather than wrapping
// the folder in an <a href>, so hovering it shows neither the browser's URL
// preview nor a native tooltip.
export function downloadSkill() {
  const link = document.createElement('a')
  link.href = '/video-editor.skill'
  link.download = 'video-editor.skill'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

// The version sticker on the folder's corner. The skill is installed by hand
// and never auto-updates, so the folder has to say which cut is inside it —
// and shout when that's a newer one than the member last took.
function VersionBadge({ fresh }: { fresh: boolean }) {
  return (
    <span
      className={`absolute right-[1%] top-[16%] z-30 rotate-[4deg] rounded-full px-2.5 py-1 text-[11px] font-bold leading-none tracking-tight shadow-md shadow-black/25 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-[7deg] ${
        fresh
          ? 'text-white ring-1 ring-inset ring-white/30'
          : 'bg-[#F7F5F0] text-zinc-500 ring-1 ring-inset ring-black/10'
      }`}
      style={fresh ? { backgroundColor: ACCENT } : undefined}
    >
      {fresh ? `New update · v${SKILL_VERSION}` : `v${SKILL_VERSION}`}
    </span>
  )
}

export default function SkillFolder({ fresh = false }: { fresh?: boolean }) {
  return (
    <button
      type="button"
      onClick={downloadSkill}
      className="group relative mx-auto block w-[300px] cursor-pointer select-none outline-none sm:w-[340px]"
      aria-label={`Download the video editor Claude skill, version ${SKILL_VERSION}`}
    >
      {/* Orange halo, brightens and widens on hover */}
      <div
        className="absolute left-1/2 top-1/2 h-[135%] w-[135%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-80 blur-2xl transition-all duration-500 group-hover:opacity-100 group-hover:blur-3xl"
        style={{ background: `radial-gradient(closest-side, ${ACCENT}70, ${ACCENT}2A 55%, transparent 78%)` }}
      />

      {/* Folder stage. The drop-shadow filter hugs the folder shape and carries
          a soft highlight above the top edge (so it stops blending into the
          background) plus a grounded shadow below. */}
      <div className="relative aspect-[10/7.6] w-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1 [filter:drop-shadow(0_-5px_11px_rgba(0,0,0,0.10))_drop-shadow(0_18px_26px_rgba(0,0,0,0.22))]">
        {/* Tab, poking up behind the back panel */}
        <div className="absolute left-[6%] top-[5%] h-[13%] w-[34%] rounded-t-[10px] bg-[#EAE7DF]" />

        {/* Back panel */}
        <div className="absolute inset-x-[3%] bottom-[3%] top-[14%] rounded-[16px] bg-gradient-to-b from-[#EFEDE6] to-[#DED9CE]" />

        {/* Cards inside the folder (z-10, behind the front pocket at z-20). They
            sit low and hidden at rest, then pop up over the top edge on hover as
            a tight overlapping fan. Left → video, middle → script, right →
            waveform. */}
        <PopCard
          restClass="left-[15%] top-[30%] w-[29%] translate-y-[16%] rotate-0 opacity-0"
          hoverClass="group-hover:-translate-y-[4rem] group-hover:-rotate-[9deg] group-hover:opacity-100"
          delay="60ms"
        >
          {/* mini video frame with play button, 16:9 */}
          <div className="flex aspect-video items-center justify-center rounded-md bg-zinc-900">
            <svg viewBox="0 0 12 12" className="h-[18px] w-[18px]" aria-hidden="true">
              <path d="M3.5 2.2 10 6 3.5 9.8Z" fill="#fff" />
            </svg>
          </div>
        </PopCard>
        <PopCard
          restClass="left-[37%] top-[26%] w-[27%] translate-y-[16%] rotate-0 opacity-0"
          hoverClass="group-hover:-translate-y-[4.75rem] group-hover:rotate-1 group-hover:opacity-100"
          delay="0ms"
        >
          {/* script card, bold heading over faint lines */}
          <p className="text-center text-[11px] font-black leading-tight tracking-tight text-zinc-900">FULL SCRIPT</p>
          <div className="mx-auto mt-1.5 h-1 w-4/5 rounded-full bg-zinc-200" />
          <div className="mx-auto mt-1 h-1 w-3/5 rounded-full bg-zinc-200" />
        </PopCard>
        <PopCard
          restClass="left-[56%] top-[30%] w-[27%] translate-y-[16%] rotate-0 opacity-0"
          hoverClass="group-hover:-translate-y-[4rem] group-hover:rotate-[9deg] group-hover:opacity-100"
          delay="110ms"
        >
          {/* waveform card */}
          <div className="flex h-8 items-center justify-center gap-[3px]">
            {[35, 60, 90, 55, 100, 70, 45, 80, 50, 30].map((h, i) => (
              <span
                key={i}
                className="w-[3px] rounded-full"
                style={{ height: `${h}%`, backgroundColor: ACCENT }}
              />
            ))}
          </div>
        </PopCard>

        {/* Front pocket (z-20, stays put, no morph). Holds the app icon + label. */}
        <div className="absolute inset-x-[1.5%] bottom-0 top-[24%] z-20 flex flex-col items-center justify-center gap-[5%] rounded-[16px] bg-gradient-to-b from-[#F7F5F0] via-[#EFECE4] to-[#E4DFD4]">
          <AppIcon className="h-[36%] w-auto aspect-square" />
          <span className="text-[1.55rem] font-extrabold tracking-tight text-zinc-800 sm:text-[1.8rem]">
            /video-editor
          </span>
        </div>

        <VersionBadge fresh={fresh} />
      </div>
    </button>
  )
}
