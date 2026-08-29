import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Check,
  PenLine,
  ArrowUpRight,
  FileText,
  Clapperboard,
  Film,
  Bookmark,
  Lightbulb,
  Palette,
  AudioLines,
  Quote,
  Type,
  Camera,
} from 'lucide-react'
import type {
  AnalysisResult,
  MasterVisualStyle,
  MasterVoiceProfile,
  ReverseEngineeredPrompt,
  Scene,
} from '../types'
import { parseScenePrompt, type SceneSegment } from '../utils/scenePrompt'
import { useAppStore } from '../../../stores/appStore'
import { useBankStore } from '../../../stores/bankStore'
import SegmentedToggle from '../../../components/SegmentedToggle'
import { useExclusiveVideo } from '../../../hooks/useInlineVideo'
import { rangeDurationLabel } from '../../../utils/timecode'
import { captureFrameFromElement, frameTimeStamp } from '../../../utils/videoFrames'
import { downloadImage } from '../../../utils/downloadImage'
import Spinner from '../../../components/Spinner'
import { suspendChromeAutoHide } from '../../../hooks/useChromeAutoHide'

interface ResultsViewProps {
  result: AnalysisResult
  // Set when the analysis came from a fresh upload; the asset:// blob URL.
  videoSrc: string | null
  // Set when the user restored from History; we don't keep the source video,
  // only the saved first-frame still.
  restoredThumbUrl?: string | null
  fileName: string
  // Legacy rows predate the field; a missing kind is a video, which is what
  // every analysis was when they were written.
  mediaKind?: 'video' | 'image'
}

// Pull a 3-6 word descriptor out of the file name if the LLM didn't return
// adTitle. Kept here for the save flows since legacy results don't have it.
function deriveFallbackTitle(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const cleaned = stem.replace(/[_-]+/g, ' ').trim()
  return cleaned || 'Untitled ad'
}

function useCopy() {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    let ok = false
    try {
      await navigator.clipboard.writeText(text)
      ok = true
    } catch {
      // Fallback for non-secure contexts or browsers blocking the async API.
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  return { copied, copy }
}

// Scripts-style output card: rounded, subtly elevated, with full-width header
// (and optional footer) separators. Mirrors the Scripts app's OutputPanel card.
function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.06] light:bg-[#F1F1F2] card-soft-shadow ${className}`}>
      {children}
    </div>
  )
}

// Left-aligned card heading with a full-width bottom separator. The accent
// color lives on the icon; the title stays neutral. An optional action (e.g.
// Copy) sits at the right of the band.
function CardHeader({ icon: Icon, title, accentClass = 'text-[#FF5257]/80', action }: { icon: React.ElementType; title: string; accentClass?: string; action?: React.ReactNode }) {
  return (
    // A 3-column grid, not an absolutely-positioned action slot: the two 1fr
    // gutters are equal, so the title is genuinely centred, and a pane too
    // narrow for both squeezes the title instead of letting the button land on
    // top of it. The absolute version takes no layout space at all, so at 375px
    // "Reverse-Engineered Scenes" ran straight under "Copy All" — the same
    // failure `SectionCard`'s header was rebuilt to avoid.
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-ink/5 px-4 py-3">
      <span aria-hidden />
      <span className="flex min-w-0 items-center justify-center gap-2 text-sm font-semibold tracking-tight text-ink-200">
        <Icon className={`h-4 w-4 shrink-0 ${accentClass}`} strokeWidth={1.5} />
        <span className="truncate">{title}</span>
      </span>
      <div className="flex min-w-0 justify-end">{action}</div>
    </div>
  )
}

/* ─── 1. Breakdown — scorecard + creative breakdown in one card ─── */
// One distinct hue per score, stepping across the spectrum from red (1) to
// light blue (10) so adjacent scores never read as the same color.
const SCORE_COLORS: Record<number, { text: string; bg: string }> = {
  1: { text: 'text-red-500 light:text-red-600', bg: 'bg-red-500/10' },
  2: { text: 'text-orange-500 light:text-orange-600', bg: 'bg-orange-500/10' },
  3: { text: 'text-amber-500 light:text-amber-600', bg: 'bg-amber-500/10' },
  4: { text: 'text-yellow-400 light:text-yellow-600', bg: 'bg-yellow-400/10' },
  5: { text: 'text-lime-400 light:text-lime-600', bg: 'bg-lime-400/10' },
  6: { text: 'text-green-500 light:text-green-600', bg: 'bg-green-500/10' },
  7: { text: 'text-emerald-400 light:text-emerald-600', bg: 'bg-emerald-400/10' },
  8: { text: 'text-teal-400 light:text-teal-600', bg: 'bg-teal-400/10' },
  9: { text: 'text-cyan-400 light:text-cyan-600', bg: 'bg-cyan-400/10' },
  10: { text: 'text-sky-400 light:text-sky-600', bg: 'bg-sky-400/10' },
}

function scoreColor(score: number) {
  const step = Math.max(1, Math.min(10, Math.round(score)))
  return SCORE_COLORS[step]
}

// Scorecard rows + analyst note — lives at the top of the merged Breakdown
// section (it kept its own card until the two were folded together).
function ScorecardBody({ result }: { result: AnalysisResult }) {
  const { scorecard } = result
  return (
    <div className="flex flex-col md:flex-row gap-5 p-4">
      <div className="flex flex-1 flex-col gap-0.5">
        {scorecard.scores.map((s) => {
          const color = scoreColor(s.score)
          const isOverall = s.label === 'Overall Execution'
          return (
            <div key={s.label}>
              {isOverall && <div className="mb-1.5 mt-1 h-px w-full bg-ink/10" />}
              <div className="flex items-center gap-2.5 rounded-full px-1 py-0.5 transition-colors hover:bg-ink/[0.04]">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums tracking-tight ${color.bg} ${color.text}`}>
                  {s.score}
                </span>
                <span className={`text-[13px] ${isOverall ? 'font-bold text-ink-200' : 'text-ink-400'}`}>{s.label}</span>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex-1 rounded-xl bg-surface-0 px-4 py-3">
        <span className="text-[11px] font-medium uppercase tracking-tight text-ink-600">Analyst&apos;s Note</span>
        <p className="mt-1.5 text-[13px] font-light leading-relaxed tracking-tight text-ink-200">{scorecard.analystNote}</p>
      </div>
    </div>
  )
}


// One labelled insight row — mirrors the Analyst's Note block styling.
function BreakdownBlock({ label, text, pre = false }: { label: string; text: string; pre?: boolean }) {
  return (
    <div className="rounded-xl bg-surface-0 px-4 py-3">
      <span className="text-[11px] font-medium uppercase tracking-tight text-ink-600">{label}</span>
      <p className={`mt-1.5 text-[13px] font-light leading-relaxed tracking-tight text-ink-200 ${pre ? 'whitespace-pre-wrap' : ''}`}>
        {text}
      </p>
    </div>
  )
}

// The merged Breakdown card: scorecard + analyst note on top, then (when the
// analysis has one — legacy results don't) the creative breakdown blocks.
// It has no bottom action row on purpose: the Script Style Prompt it used to
// ship is gone, and hook/angle/structure are things you read, not artifacts
// you send anywhere.
function BreakdownSection({ result }: { result: AnalysisResult }) {
  const breakdown = result.creativeBreakdown ?? null

  return (
    <Section>
      <CardHeader
        icon={Lightbulb}
        title="Breakdown"
        accentClass="text-amber-400/90 light:text-amber-600"
      />

      <ScorecardBody result={result} />

      {breakdown && (
        <>
          {/* Inset divider between the scorecard block and the creative blocks. */}
          <div className="mx-4 h-px bg-ink/5" />
          <div className="flex flex-col gap-3 p-4">
            <BreakdownBlock label="Hook" text={breakdown.hook} />
            <BreakdownBlock label="Angle" text={breakdown.angle} />
            <BreakdownBlock label="Structure" text={breakdown.structure} pre />
          </div>
        </>
      )}
    </Section>
  )
}

/* ─── 2. Transcript ─── */
function TranscriptSection({ result, fileName }: { result: AnalysisResult; fileName: string }) {
  const { copied, copy } = useCopy()
  const addToast = useAppStore((s) => s.addToast)
  const sendToApp = useAppStore((s) => s.sendToApp)
  const addScript = useBankStore((s) => s.addScript)

  const withoutTimestamps = result.transcript.map((l) => l.text).join('\n')
  const adTitle = result.adTitle?.trim() || deriveFallbackTitle(fileName)
  const scriptTitle = `${adTitle} — Transcript`

  const handleSaveToBank = () => {
    addScript({
      title: scriptTitle,
      scriptText: withoutTimestamps,
      linkedProductId: '',
      source: 'manual',
    })
    addToast(`Saved "${scriptTitle}" to Script Bank`)
  }

  const handleSendToScripts = () => {
    addScript({
      title: scriptTitle,
      scriptText: withoutTimestamps,
      linkedProductId: '',
      source: 'manual',
    })
    sendToApp({
      targetApp: 'script-architect',
      targetField: 'winningTranscript',
      data: withoutTimestamps,
    })
    addToast('Sent to Scripts + saved to bank')
  }

  return (
    <Section>
      <CardHeader
        icon={FileText}
        title="Transcript"
        action={
          <button
            onClick={() => copy(withoutTimestamps)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        }
      />

      <div className="flex flex-col gap-0.5 p-4">
        {result.transcript.map((line, i) => (
          <div key={i} className="flex gap-3 rounded-full px-3 py-1.5 transition-colors hover:bg-ink/[0.03]">
            <span className="mt-0.5 shrink-0 tabular-nums text-[11px] text-ink-700">{line.timestamp}</span>
            <span className="text-[13px] font-light leading-relaxed tracking-tight text-ink-200">{line.text}</span>
          </div>
        ))}
      </div>

      <ScriptActionRow onSave={handleSaveToBank} onSend={handleSendToScripts} sendLabel="Remix transcript" />
    </Section>
  )
}

/* ─── 3. Reverse-Engineered Prompt ─── */

// EVERY scene carries its "--- Scene N ---" header, a one-scene ad included.
// The header is what makes this text a BLUEPRINT rather than prose: Scripts
// routes a pasted remix source on `detectSceneBlueprint`, which matches on
// those headers, so a lone scene handed over without one was silently remixed
// as a plain spoken script — no scene rewrite, no voice profile, three script
// variations written off a video prompt. And a lone scene is the COMMON case,
// not an edge one: the analyser's chunking rule returns a single scene for any
// ad of 15 seconds or less. The bare prompt is still one click away on the
// scene's own Copy button, which hands over `scene.prompt` verbatim.
function sceneHeader(s: Scene): string {
  const time = s.startTime && s.endTime ? ` (${s.startTime}-${s.endTime})` : ''
  return `--- Scene ${s.index}: ${s.label}${time} ---`
}

function joinScenes(scenes: Scene[]): string {
  return scenes.map((s) => `${sceneHeader(s)}\n${s.prompt}`).join('\n\n')
}

// The two master blocks as plain text. Each scene prompt is self-contained (it
// is fired as its own clip), so these aren't needed to render a single shot —
// they exist so the LOOK and the VOICE can't drift between clips, which is what
// makes a set of separately-generated clips read as one ad.
function styleText(style: MasterVisualStyle): string {
  return `${style.label} — ${style.liveAction ? 'live action' : 'animated / rendered'}\n${style.brief}`
}

function voiceText(voice: MasterVoiceProfile): string {
  const head = [voice.label, voice.traits.join(' · '), voice.delivery].filter(Boolean).join('\n')
  return `${head}\n\n${voice.profile}`
}

// The whole recreation as one pasteable artifact — the masters, then the
// scenes. Header wording mirrors the "=== VOICE PROFILE ... ===" block Scripts
// emits at the end of a blueprint, so a member moving text between the two apps
// sees the same shape. Scripts' blueprint detection matches on scene headers
// anywhere in the source, so a preamble in front of them is safe.
function buildFullPrompt(rep: ReverseEngineeredPrompt): string {
  const masters: string[] = []
  if (rep.masterVisualStyle) {
    masters.push(`=== MASTER VISUAL STYLE (every scene is shot in this look) ===\n${styleText(rep.masterVisualStyle)}`)
  }
  if (rep.masterVoiceProfile) {
    masters.push(`=== MASTER VOICE PROFILE (same voice in every scene) ===\n${voiceText(rep.masterVoiceProfile)}`)
  }
  const scenes = joinScenes(rep.scenes)
  return masters.length > 0 ? `${masters.join('\n\n')}\n\n${scenes}` : scenes
}

/* Master blocks — the ad-wide look and voice, above the per-scene cards. */

// Shared shell: the Breakdown card's labelled block, plus a title row that can
// carry pills and its own actions.
function MasterBlock({
  label,
  icon: Icon,
  title,
  pills,
  actions,
  children,
}: {
  label: string
  icon: React.ElementType
  title: string
  pills?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl bg-surface-0 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-tight text-ink-600">
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          {label}
        </span>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium tracking-tight text-ink-100">{title}</span>
        {pills}
      </div>
      {children}
    </div>
  )
}

// The utility beside a master block's title — Save style, Copy.
//
// **Glyph only below `md`** (Massimo's call, August 2026): these sit on the
// title's own line inside a card that is already inset twice, so at 375px
// "Save style" and "Copy" were two labels competing with the block's heading
// for a line none of the three fit on. The glyph says what the button does,
// the wording survives as the tooltip and the accessible name, and the 28px
// square it takes there is a better tap target than the 20px pill was.
function MiniButton({ onClick, icon: Icon, label }: { onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex shrink-0 items-center gap-1 rounded-full text-[10px] font-medium text-ink-600 transition-colors hover:bg-ink/5 hover:text-ink-300 max-md:h-7 max-md:w-7 max-md:justify-center max-md:gap-0 md:px-2 md:py-0.5"
    >
      <Icon className="h-3 w-3 shrink-0" strokeWidth={1.75} />
      <span className="max-md:hidden">{label}</span>
    </button>
  )
}

// The look, saveable to the Styles bank: `brief` is written to the same
// contract a bank style holds (how it looks, never what's in it), so the member
// can render their OWN ad in the analysed ad's look.
function VisualStyleBlock({ style, adTitle }: { style: MasterVisualStyle; adTitle: string }) {
  const { copied, copy } = useCopy()
  const addStyle = useBankStore((s) => s.addStyle)
  // The saved brief, not a boolean: this component stays mounted when the
  // member picks a different analysis in the History rail, so a flag would
  // leave the next ad's style reading "Saved" before it ever was.
  const [savedBrief, setSavedBrief] = useState<string | null>(null)
  const saved = savedBrief === style.brief

  const handleSave = () => {
    // addStyle toasts on success; a second click would just write a duplicate row.
    void addStyle({ name: `${adTitle} — Visual Style`, brief: style.brief })
    setSavedBrief(style.brief)
  }

  return (
    <MasterBlock
      label="Visual Style"
      icon={Palette}
      title={style.label}
      pills={
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tight ${
            style.liveAction
              ? 'bg-emerald-500/10 text-emerald-300 light:text-emerald-700'
              : 'bg-violet-500/10 text-violet-300 light:text-violet-700'
          }`}
        >
          {style.liveAction ? 'Live action' : 'Animated'}
        </span>
      }
      actions={
        <>
          <MiniButton
            onClick={saved ? () => {} : handleSave}
            icon={saved ? Check : Bookmark}
            label={saved ? 'Saved' : 'Save style'}
          />
          <MiniButton onClick={() => copy(styleText(style))} icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy'} />
        </>
      }
    >
      <p className="mt-1.5 text-[13px] font-light leading-relaxed tracking-tight text-ink-200">{style.brief}</p>
    </MasterBlock>
  )
}

function VoiceProfileBlock({ voice }: { voice: MasterVoiceProfile }) {
  const { copied, copy } = useCopy()
  return (
    <MasterBlock
      label="Voice"
      icon={AudioLines}
      title={voice.label}
      pills={voice.traits.map((t) => (
        <span key={t} className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] text-ink-400">
          {t}
        </span>
      ))}
      actions={
        <MiniButton onClick={() => copy(voiceText(voice))} icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy'} />
      }
    >
      {voice.delivery && (
        <p className="mt-1.5 text-[13px] font-light leading-relaxed tracking-tight text-ink-400">{voice.delivery}</p>
      )}
      <p className="mt-1.5 text-[13px] font-light leading-relaxed tracking-tight text-ink-200">{voice.profile}</p>
    </MasterBlock>
  )
}

// The `[0:00–0:03]` marker a beat opens with. Red, in its own brackets, on its
// own line: it's the one thing in a scene prompt you navigate by, and inline in
// the prose it was indistinguishable from the sentence around it.
//
// It's followed by how long the beat RUNS, because that's the number the beat is
// reproduced at — a range on its own is two clock times to subtract, once per
// scene, before you know whether a shot is three seconds or eight.
function BeatTime({ time }: { time: string }) {
  const duration = rangeDurationLabel(time)
  return (
    <span className="w-fit select-none rounded-full bg-[#FF5257]/10 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums tracking-tight text-[#FF5257] light:text-[#C4272C]">
      [{time}]
      {duration && <span className="opacity-60"> · {duration}</span>}
    </span>
  )
}

// A verbatim quote pulled out of the direction, in the shape Scripts gives a
// spoken line: separately copyable, because it's the part that leaves this app
// (into a voiceover, or into the recreation's dialogue). Two variants — speech
// carries the scene accent, on-screen text stays neutral chrome, since one is
// heard and the other is read.
function QuoteBlock({ segment }: { segment: Extract<SceneSegment, { kind: 'quote' }> }) {
  const { copied, copy } = useCopy()
  const speech = segment.variant === 'speech'
  const Icon = speech ? Quote : Type
  return (
    <div
      className={`relative rounded-xl border py-2.5 pl-3.5 pr-10 ${
        speech ? 'border-fuchsia-500/15 bg-fuchsia-500/[0.06]' : 'border-ink/10 bg-ink/[0.04]'
      }`}
    >
      <div
        className={`mb-1 flex select-none items-center gap-1.5 text-[10px] font-semibold uppercase tracking-tight ${
          speech ? 'text-fuchsia-300/90 light:text-fuchsia-700' : 'text-ink-500'
        }`}
      >
        <Icon className="h-2.5 w-2.5" strokeWidth={2.5} />
        {/* An unattributed line still gets a label — which kind of quote it is
            is the thing the box is claiming, and a bare quote with no header
            reads as a styling accident. */}
        {segment.speaker || (speech ? 'Spoken line' : 'On-screen text')}
      </div>
      <p className="text-[14px] font-light leading-snug tracking-tight text-ink-100">“{segment.text}”</p>
      <button
        onClick={() => copy(segment.text)}
        title={speech ? 'Copy line' : 'Copy text'}
        aria-label={speech ? 'Copy line' : 'Copy text'}
        className="absolute right-1.5 top-1.5 flex h-6 w-6 select-none items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-ink/5 hover:text-ink-300"
      >
        {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )
}

function SceneCard({ scene }: { scene: Scene }) {
  const { copied, copy } = useCopy()
  // The prompt read as its own beats. A scene the model wrote without a
  // timeline comes back as one untimed beat, so nothing renders empty — and
  // Copy still hands over `scene.prompt` verbatim, which is what gets pasted
  // into a video model.
  const beats = parseScenePrompt(scene.prompt)
  return (
    <div className="rounded-2xl border border-ink/5 bg-ink/[0.02] p-3 card-soft-shadow">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="shrink-0 rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tight text-fuchsia-300 light:text-fuchsia-700">
            Scene {scene.index}
          </span>
          <span className="text-[11px] font-medium text-ink-300">{scene.label}</span>
          <span className="shrink-0 rounded-full bg-ink/5 px-2 py-0.5 tabular-nums text-[10px] text-ink-500">
            {scene.startTime}–{scene.endTime} · {scene.durationSeconds}s
          </span>
        </div>
        <button
          onClick={() => copy(scene.prompt)}
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-ink-600 transition-colors hover:bg-ink/5 hover:text-ink-300"
        >
          {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* Beats are spaced, not ruled: a hairline between them read as a divider
          between unrelated blocks, when they're consecutive shots of one take. */}
      <div className="flex flex-col gap-4 rounded-xl bg-surface-0 p-3">
        {beats.map((beat, i) => (
          <div key={i} className="flex flex-col gap-2">
            {beat.time && <BeatTime time={beat.time} />}
            {beat.segments.map((segment, j) =>
              segment.kind === 'quote' ? (
                <QuoteBlock key={j} segment={segment} />
              ) : (
                <p key={j} className="whitespace-pre-wrap text-[13px] font-light leading-relaxed tracking-tight text-ink-200">
                  {segment.text}
                </p>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ReverseEngineeredSection({ result, fileName }: { result: AnalysisResult; fileName: string }) {
  const { copied, copy } = useCopy()
  const { reverseEngineeredPrompt } = result
  const scenes = reverseEngineeredPrompt.scenes
  const fullPrompt = useMemo(() => buildFullPrompt(reverseEngineeredPrompt), [reverseEngineeredPrompt])
  const sendToApp = useAppStore((s) => s.sendToApp)
  const addToast = useAppStore((s) => s.addToast)
  const addScript = useBankStore((s) => s.addScript)

  const adTitle = result.adTitle?.trim() || deriveFallbackTitle(fileName)
  const scriptTitle = `${adTitle} — Prompt`

  const handleSaveToBank = () => {
    addScript({
      title: scriptTitle,
      scriptText: fullPrompt,
      linkedProductId: '',
      source: 'script-architect',
      kind: 'reverse-engineer',
    })
    addToast(`Saved "${scriptTitle}" to Script Bank`)
  }

  const handleSendToScripts = () => {
    addScript({
      title: scriptTitle,
      scriptText: fullPrompt,
      linkedProductId: '',
      source: 'script-architect',
      kind: 'reverse-engineer',
    })
    sendToApp({
      targetApp: 'script-architect',
      targetField: 'reverseEngineerPrompt',
      data: {
        scenes,
        totalDurationSeconds: reverseEngineeredPrompt.totalDurationSeconds,
        fullPrompt,
      },
    })
    addToast('Sent to Scripts + saved to bank')
  }

  // A "Clone this with my product" button used to sit in the action row below,
  // handing `buildAdBlueprint(result, fileName)` to B-Roll as an `adBlueprint`
  // payload. Removed July 2026: it read as "recreate this ad" but actually
  // dropped the member on the B-Roll page. The service, the payload type and
  // B-Roll's consumer are all still wired — restore the button here if the
  // handoff comes back under a label that says where it goes.

  // This button hands over the whole blueprint — the master blocks and every
  // scene under its own header — never a bare prompt, which is what the scene's
  // own Copy gives. So the only thing left for the label to say is how many
  // scenes are in it.
  const copyLabel = copied ? 'Copied' : scenes.length > 1 ? 'Copy all prompts' : 'Copy blueprint'

  return (
    <Section>
      <CardHeader
        icon={Clapperboard}
        title="Reverse-Engineered Scenes"
        accentClass="text-fuchsia-400/90 light:text-fuchsia-700"
        action={
          // Glyph only (Massimo's call, August 2026). This is the longest title
          // in the read and it sits beside the longest label — "Reverse-
          // Engineered Scenes" and "Copy All" don't share a 375px line, and the
          // copy icon says what the button does without being read. The wording
          // survives as the tooltip and the accessible name: "Copy Prompt" only
          // when the copy IS one prompt — with a master block in front of it,
          // or several scenes, it's the whole set.
          <button
            onClick={() => copy(fullPrompt)}
            title={copyLabel}
            aria-label={copyLabel}
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            {copied
              ? <Check className="h-3.5 w-3.5 text-green-400 light:text-green-600" />
              : <Copy className="h-3.5 w-3.5" />}
          </button>
        }
      />

      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-2 text-[11px] text-ink-500">
          <span className="rounded-full bg-ink/5 px-2.5 py-0.5">
            Total: {reverseEngineeredPrompt.totalDurationSeconds}s
          </span>
          <span className="rounded-full bg-ink/5 px-2.5 py-0.5">
            {scenes.length === 1 ? '1 scene' : `${scenes.length} scenes (≤15s each)`}
          </span>
        </div>

        {/* The ad-wide look and voice, above the shots they hold together.
            Both are absent on results analysed before they existed, and the
            voice is absent on an ad with no speech. */}
        {reverseEngineeredPrompt.masterVisualStyle && (
          <VisualStyleBlock style={reverseEngineeredPrompt.masterVisualStyle} adTitle={adTitle} />
        )}
        {reverseEngineeredPrompt.masterVoiceProfile && (
          <VoiceProfileBlock voice={reverseEngineeredPrompt.masterVoiceProfile} />
        )}

        <div className="flex flex-col gap-3">
          {scenes.map((scene) => (
            <SceneCard key={scene.index} scene={scene} />
          ))}
        </div>
      </div>

      <ScriptActionRow
        onSave={handleSaveToBank}
        onSend={handleSendToScripts}
        sendLabel="Remix for your product"
      />
    </Section>
  )
}

// Shared bottom action row for the Transcript + Scenes sections — the larger,
// Scripts-styled "Save to Script Bank" (neutral) + remix (scripts accent, with
// a trailing arrow) buttons, matching the Scripts app. `sendLabel` names what
// is actually handed over ("Remix transcript" / "Remix for your product")
// rather than the destination app: both land in Scripts' Remix box, and the
// section already says which one you're looking at.
// The label uses `text-scripts-text`, not `text-scripts-400`: the scripts
// accent is a dark navy, so a 400 label on its own tint reads as disabled.
function ScriptActionRow({ onSave, onSend, sendLabel }: { onSave: () => void; onSend: () => void; sendLabel: string }) {
  return (
    <div className="flex flex-wrap gap-2 border-t border-ink/5 p-3">
      <button
        onClick={onSave}
        className="flex flex-1 min-w-0 items-center justify-center gap-2 rounded-full border border-ink/15 px-4 py-2.5 text-[12px] font-medium tracking-tight text-ink-300 transition-colors hover:bg-ink/[0.06] hover:text-ink-100"
      >
        <Bookmark className="h-4 w-4" strokeWidth={1.75} />
        Save to Script Bank
      </button>
      <button
        onClick={onSend}
        className="flex flex-1 min-w-0 items-center justify-center gap-2 rounded-full border border-scripts-500/20 bg-scripts-500/10 px-4 py-2.5 text-[12px] font-medium tracking-tight text-scripts-text transition-colors hover:bg-scripts-500/20"
      >
        <PenLine className="h-4 w-4" strokeWidth={1.75} />
        {sendLabel}
        <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  )
}

/* ─── Frame grab ─── */
// Hands over the frame the player is showing right now, at the ad's own full
// resolution. The native controls ARE the scrubber — the member parks the
// playhead on the moment they want and presses this — so there's no second
// timeline to build, and what lands on disk is the source frame rather than a
// cropped screenshot of the app window.
//
// Module scope on purpose: a try/finally inside a component makes the React
// Compiler skip that component entirely (see the root CLAUDE.md).
async function grabFrameToDisk(video: HTMLVideoElement, fileName: string): Promise<boolean> {
  let url: string | null = null
  try {
    const blob = await captureFrameFromElement(video)
    url = URL.createObjectURL(blob)
    const stem = fileName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'ad'
    await downloadImage(url, `${stem}-frame-${frameTimeStamp(video.currentTime)}`, 'png')
    return true
  } catch {
    return false
  } finally {
    if (url) URL.revokeObjectURL(url)
  }
}

// The scroll port a set of sections lives in. It is the read column on a
// desktop and the whole results pane on a phone, and an IntersectionObserver
// rooted on a box that isn't the one scrolling reports every section as
// intersecting at once, which pins the jump toggle to "Breakdown" for the
// length of the read.
function nearestScrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

function FrameGrabButton({
  videoRef,
  fileName,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  fileName: string
}) {
  const addToast = useAppStore((s) => s.addToast)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function handleGrab() {
    const video = videoRef.current
    if (!video || busy) return
    // Mid-playback the grab would race the click for whichever frame happened
    // to be up; pausing makes the file match what's on screen.
    video.pause()
    setBusy(true)
    const ok = await grabFrameToDisk(video, fileName)
    setBusy(false)
    if (!ok) {
      addToast('Could not grab that frame — let the ad finish loading, then try again.', 'error')
      return
    }
    setDone(true)
    window.setTimeout(() => setDone(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleGrab}
      disabled={busy}
      title="Download the frame showing now — scrub the player to pick your moment"
      className="flex shrink-0 items-center justify-center gap-2 rounded-full border border-[#FF5257]/20 bg-[#FF5257]/10 px-4 py-2.5 text-[12px] font-medium tracking-tight text-[#FF5257] transition-colors hover:bg-[#FF5257]/20 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? (
        <Spinner className="h-4 w-4" />
      ) : done ? (
        <Check className="h-4 w-4" strokeWidth={1.75} />
      ) : (
        <Camera className="h-4 w-4" strokeWidth={1.75} />
      )}
      <span>{done ? 'Frame downloaded' : 'Download this frame'}</span>
    </button>
  )
}

/* ─── Section jump toggle ─── */
type SectionKey = 'breakdown' | 'transcript' | 'scenes'

/* ─── Main ResultsView ─── */
export default function ResultsView({ result, videoSrc, restoredThumbUrl, fileName, mediaKind = 'video' }: ResultsViewProps) {
  // Hide the media column entirely when neither a video nor a saved
  // still is available (e.g. restored from a history row whose thumbnail
  // capture had failed). Results panels then take the full width.
  const hasMedia = !!videoSrc || !!restoredThumbUrl
  // An image ad is a still: it plays in no player, and there's no frame to
  // pick out of it that isn't the file the member already has.
  const isVideo = mediaKind !== 'image'
  // Native controls, but the same app-wide rule: one clip plays at a time.
  const sourceVideo = useExclusiveVideo()

  const breakdownRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const scenesRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<SectionKey>('breakdown')

  const refFor = (k: SectionKey) =>
    k === 'breakdown' ? breakdownRef : k === 'transcript' ? transcriptRef : scenesRef

  const scrollTo = (k: SectionKey) => {
    setActive(k)
    // A tap is not a swipe: hold the dock still for the length of the jump, or
    // it hides mid-animation and relayouts the pane under the browser's own
    // smooth scroll (see `suspendChromeAutoHide`).
    suspendChromeAutoHide()
    refFor(k).current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Scroll-spy — keep the toggle in sync with whichever section sits near the
  // top of the scroll viewport, whether reached by tap or by manual scroll.
  useEffect(() => {
    // The scroll port is the read column on a desktop and the whole results
    // pane on a phone, so it's found rather than named — an observer rooted on
    // a box that isn't scrolling reports every section as visible at once.
    const root = nearestScrollParent(breakdownRef.current)
    if (!root) return
    const els = [breakdownRef.current, transcriptRef.current, scenesRef.current].filter(Boolean) as HTMLElement[]
    if (els.length === 0) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const key = visible[0]?.target.getAttribute('data-section') as SectionKey | null
        if (key) setActive(key)
      },
      { root, rootMargin: '-15% 0px -75% 0px', threshold: 0 },
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [hasMedia])

  return (
    // One scroller on a phone, two columns on a desktop. The ad used to be a
    // fixed 38dvh block with the read scrolling in the ~55% left under it —
    // two thirds of a phone screen spent on a player you have already watched,
    // and the thing you came to read moving through a slot. Stacked in one
    // scroll the ad is simply the top of the page: it scrolls away, and the
    // breakdown gets the whole screen.
    <div className="flex h-full flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      {/* The ad itself — right column on desktop, top of the stack on phones.
          It stays FIRST in the DOM and moves with `md:order-2`, because the
          reading order the two layouts want is different: on a phone the ad is
          the anchor you land on and the breakdown scrolls under it, while on a
          desktop the breakdown is the thing being read and the ad belongs
          beside it, in the margin. */}
      {hasMedia && (
        // max-h on phones: a portrait video would otherwise fill the whole
        // stacked column and leave no room for the scorecard below.
        <div className="flex w-full shrink-0 flex-col border-b border-ink/5 max-md:max-h-[70dvh] md:order-2 md:h-full md:min-h-0 md:w-1/3 md:border-b-0 md:border-l">
          {/* The file's own header band, at the shared h-[57px] panel-header
              height with the same hairline under it, so the line the rail and
              the results column already draw carries straight across all three
              panels instead of stopping two thirds of the way over. The pill
              used to sit at the FOOT of this column, which is what left the
              gap. */}
          <div className="flex h-[57px] shrink-0 items-center border-b border-ink/5 px-4 md:px-5">
            <div className="flex min-w-0 items-center gap-2 rounded-full bg-ink/[0.03] px-3.5 py-2">
              <Film className="h-3.5 w-3.5 shrink-0 text-ink-600" />
              <span className="truncate text-xs text-ink-500">{fileName}</span>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-5">
            {/* Media sizes to its own aspect ratio so there are no letterbox
                black bars. The flex parent centers it within whatever vertical
                space is left after the frame-grab button. */}
            <div className="flex flex-1 min-h-0 w-full items-center justify-center">
              {videoSrc && isVideo ? (
                <video
                  {...sourceVideo}
                  src={videoSrc}
                  className="block max-h-full max-w-full rounded-xl border border-ink/10 transition-all hover:-translate-y-px card-soft-shadow"
                  controls
                />
              ) : videoSrc || restoredThumbUrl ? (
                <img
                  src={videoSrc ?? restoredThumbUrl ?? ''}
                  alt={videoSrc ? 'The analyzed ad' : 'First frame of the analyzed ad'}
                  className="block max-h-full max-w-full rounded-xl border border-ink/10 transition-all hover:-translate-y-px card-soft-shadow"
                />
              ) : null}
            </div>

            {/* Scrub to a moment in the player above, then take that exact frame
                at the ad's own resolution instead of screenshotting the app. */}
            {videoSrc && isVideo && (
              <FrameGrabButton videoRef={sourceVideo.ref} fileName={fileName} />
            )}
            {/* When the live source is gone, make it explicit that this is the
                saved still — not a broken or missing video. */}
            {!videoSrc && restoredThumbUrl && (
              <p className="-mt-2 shrink-0 text-center text-[11px] italic text-ink-500">
                Still frame — source ad not retained
              </p>
            )}
          </div>
        </div>
      )}

      {/* The read — the section-jump toggle above its own scroll port.
          The bar is a SIBLING of the scroller, not `sticky` inside it: it was
          pinned at top-0 from the first pixel and never scrolled away, so
          sticky bought nothing but the chance to come loose from the edge on
          the way back up a long read (the app-wide rule in the root
          CLAUDE.md). Outside the scroller it can't move by construction. */}
      <div className="flex min-h-0 flex-1 flex-col max-md:flex-none md:order-1">
        {/* Sticky on a phone, where this bar really does scroll away and come
            back — the one case the app-wide rule keeps `sticky` for, and the
            reason it has to paint SOMETHING: the read scrolls underneath it, so
            transparent is not on the table (tried, August 2026, and the bar had
            to come back).
            It paints `.app-backdrop-fill` — AppBackground's own gradient,
            anchored to the viewport — so it is opaque without being a surface:
            it lines up with the canvas behind it and reads as the page. See the
            note on that class. `bg-surface-0` was tried (a black band five to
            fourteen units darker than everything around it), then a flat colour
            sampled off the canvas (still seams — the backdrop is radial and
            drops ~10 units across one bar's width), then no fill at all, which
            cost the pin.
            Never glass: a backdrop-filter bar lags its own scroller on the way
            back up, which is the app-wide rule for sticky chrome. The fill is
            harmless above `md` where the bar doesn't stick — it matches the
            backdrop there too, by construction. */}
        <div className="app-backdrop-fill flex h-[57px] shrink-0 items-center border-b border-ink/5 px-5 max-md:sticky max-md:top-0 max-md:z-20">
          <SegmentedToggle<SectionKey>
            className="h-10 !p-1"
            value={active}
            onChange={scrollTo}
            options={[
              { value: 'breakdown', label: 'Breakdown', icon: Lightbulb },
              { value: 'transcript', label: 'Transcript', icon: FileText },
              { value: 'scenes', label: 'Scenes', icon: Clapperboard },
            ]}
          />
        </div>

        {/* min-h-0: in the phones' stacked column the scroller must be allowed
            to shrink below its content, or it clips instead of scrolling. */}
        <div className="min-h-0 flex-1 md:overflow-y-auto">
          <div className="flex flex-col gap-5 p-5">
            {/* When the media column is hidden, surface the filename so there's
                still an anchor with no media. */}
            {!hasMedia && (
              <div className="flex items-center gap-3 rounded-xl border border-ink/5 bg-ink/[0.02] px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Film className="h-3.5 w-3.5 shrink-0 text-ink-600" />
                  <span className="truncate text-xs text-ink-500">{fileName || 'Untitled analysis'}</span>
                </div>
              </div>
            )}
            {/* `scroll-mt` is what a section jump lands ON, and on a phone it
                has to clear the toggle bar. The bar is `sticky top-0` at 57px
                INSIDE this scroller there, so a plain `block: 'start'` put each
                section's own heading squarely behind it — you tapped Transcript
                and arrived 57px into the transcript, with nothing on screen
                saying which section you were in. 73px = the bar plus 16px, so
                the heading lands just under it. Desktop keeps the bare 20px:
                there the bar is a sibling OUTSIDE the scroll port and nothing
                overlaps the top edge. */}
            <div ref={breakdownRef} data-section="breakdown" className="scroll-mt-5 max-md:scroll-mt-[73px]">
              <BreakdownSection result={result} />
            </div>
            <div ref={transcriptRef} data-section="transcript" className="scroll-mt-5 max-md:scroll-mt-[73px]">
              <TranscriptSection result={result} fileName={fileName} />
            </div>
            <div ref={scenesRef} data-section="scenes" className="scroll-mt-5 max-md:scroll-mt-[73px]">
              <ReverseEngineeredSection result={result} fileName={fileName} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
