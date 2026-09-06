import { useState, type ElementType } from 'react'
import { AlignLeft, Download, Pause, Play, RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { VoiceHistoryItem } from '../../../stores/types'
import type { VoiceSettings } from '../types'
import { getVoiceById } from '../types'
import Modal from '../../../components/Modal'
import SectionCard from '../../../components/SectionCard'
import AudioScrubber from '../../../components/AudioScrubber'
import { useAudioPlayback } from '../../../hooks/useAudioPlayback'
import { formatClock, resolveAudioUrl } from '../../../utils/audioPlayback'
import { formatRelative } from '../../../utils/history'
import { getModel, TTS_MODEL_FLASH } from '../../../utils/models'
import { seedColor, PLAY_DISC_RIM } from './seedColor'

interface HistoryDetailsModalProps {
  // Null when nothing is open. The panel stays MOUNTED either way — the shared
  // Modal animates from `open`, so a conditionally-rendered one arrives already
  // at full size and skips the app's own 200ms pop.
  item: VoiceHistoryItem | null
  onClose: () => void
  onRestoreText: (text: string) => void
  onRestoreSettings: (settings: Partial<VoiceSettings>) => void
}

// A row written before the TTS picker shipped carries no modelId — those are
// all Flash, the entry that held the slot alone. Resolved through the registry
// rather than hardcoded, so a Pro read isn't labelled as a Flash one.
function modelNameFor(modelId: string | undefined): string {
  const id = modelId ?? TTS_MODEL_FLASH
  return getModel(id)?.displayName ?? id
}

// Module scope, not a handler in the component: a `try` inside a component body
// makes the React Compiler skip the whole file (see CLAUDE.md).
async function downloadAudio(item: VoiceHistoryItem) {
  try {
    const url = await resolveAudioUrl(item.audioUrl)
    const a = document.createElement('a')
    a.href = url
    a.download = `${item.voiceName}-${Date.now()}.mp3`
    a.click()
  } catch {
    /* swallow — the row is still playable, and there is nothing to retry */
  }
}

// A read's full detail, in the app's one centred Modal.
//
// It was an opaque pane that rode over the script column with a "Back to
// history" bar of its own, which made it the only surface in the app with its
// own overlay shape — and it covered the words being read, which is the one
// thing the output column exists to show. Below 980px it cost more: opening a
// read's details had to hand the pane back and shut the rail, so the list you
// clicked from went away.
//
// The actions come with it, and none of them is a full-width pill any more:
// Play IS the metal disc (the shape it already wears on every history card),
// Download sits beside the name, and the two restores are header actions on the
// cards they act on — a script goes back to the editor from the Script card,
// the delivery params from the Settings card. Four identical grey slabs stacked
// down a column say nothing about which one you want.
export default function HistoryDetailsModal({
  item,
  onClose,
  onRestoreText,
  onRestoreSettings,
}: HistoryDetailsModalProps) {
  // The read stays on screen while the panel fades out, so the body doesn't
  // blank a frame before the modal has gone.
  const [shown, setShown] = useState(item)
  if (item && item !== shown) setShown(item)

  const open = item !== null
  // Closing the panel stops the clip: the hook tears its element down when the
  // ref changes, and `null` on close is what fires that.
  const playback = useAudioPlayback(open && shown ? shown.audioUrl : null, shown?.duration ?? 0)

  const voice = shown ? getVoiceById(shown.voiceId) : undefined
  const clipDuration = playback.duration || shown?.duration || 0

  return (
    <Modal open={open} onClose={onClose} title="Voiceover Details" size="medium">
      {shown && (
        <div className="flex flex-col gap-3.5 p-5">
          {/* Who read it, how long ago, and the two things you do with the
              audio itself — press the disc to hear it, the pill to keep it. */}
          <div className="flex items-center gap-3.5">
            <button
              onClick={playback.toggle}
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white transition-all hover:brightness-110 ${PLAY_DISC_RIM}`}
              style={{ background: seedColor(shown.voiceId) }}
              title={playback.isPlaying ? 'Pause' : 'Play'}
              aria-label={playback.isPlaying ? 'Pause' : 'Play'}
            >
              {playback.isPlaying
                ? <Pause className="h-4 w-4 fill-current" />
                : <Play className="h-4 w-4 translate-x-px fill-current" />}
            </button>

            <div className="min-w-0 flex-1">
              <h4 className="truncate text-base font-semibold tracking-tight text-ink-100">
                {voice ? `${voice.name} · ${voice.description}` : shown.voiceName}
              </h4>
              <p className="mt-0.5 text-[11.5px] tabular-nums text-ink-500">
                {formatRelative(shown.createdAt)}
                {clipDuration > 0 && ` · ${formatClock(clipDuration)}`}
                {` · ${shown.scriptText.length} chars`}
              </p>
            </div>

            <button
              onClick={() => void downloadAudio(shown)}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.02] px-3 py-1.5 text-[12px] font-medium text-ink-200 transition-colors hover:bg-ink/[0.06] hover:text-ink-100"
              title="Download Voiceover"
            >
              <Download className="h-3.5 w-3.5" />
              Download Voiceover
            </button>
          </div>

          {/* The same transport the history card and the footer player draw, so
              one clip isn't three different-looking controls. */}
          <div className="flex items-center gap-2.5 px-0.5">
            <span className="shrink-0 text-[10.5px] tabular-nums text-ink-500">
              {formatClock(playback.position)}
            </span>
            <AudioScrubber
              progress={clipDuration > 0 ? playback.position / clipDuration : 0}
              onSeek={playback.isLoaded ? (f) => playback.seekTo(f * clipDuration) : undefined}
              className="min-w-0 flex-1"
            />
            <span className="shrink-0 text-[10.5px] tabular-nums text-ink-500">
              {formatClock(clipDuration)}
            </span>
          </div>

          <SectionCard
            icon={AlignLeft}
            title="Script"
            right={
              <HeaderAction
                icon={RotateCcw}
                label="Add to Editor"
                title="Put this script back in the editor"
                onClick={() => onRestoreText(shown.scriptText)}
              />
            }
          >
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-300">
              {shown.scriptText}
            </p>
          </SectionCard>

          <SectionCard
            icon={SlidersHorizontal}
            title="Settings"
            right={
              <HeaderAction
                icon={RotateCcw}
                label="Restore"
                title="Load these settings back into the voice panel"
                onClick={() => onRestoreSettings({
                  voiceId: shown.voiceId,
                  voiceName: shown.voiceName,
                  gender: shown.gender,
                  style: shown.style,
                  pace: shown.pace,
                  accent: shown.accent,
                  temperature: shown.temperature,
                  scene: shown.scene ?? '',
                  sampleContext: shown.sampleContext ?? '',
                })}
              />
            }
            contentClassName="grid grid-cols-2 gap-2"
          >
            {/* The model is named HERE and nowhere else in the panel — it used
                to be a pill over the script as well, which printed it twice.
                It belongs with the params because it is one of them: restoring
                these settings restores the model that made the read. */}
            <Spec label="Model" value={modelNameFor(shown.modelId)} wide />
            <Spec label="Style" value={shown.style ?? '—'} />
            <Spec label="Pace" value={shown.pace ?? '—'} />
            <Spec label="Accent" value={shown.accent ?? '—'} />
            <Spec label="Expressiveness" value={(shown.temperature ?? 1).toFixed(2)} />
            {shown.scene && <Spec label="Scene" value={shown.scene} wide />}
            {shown.sampleContext && <Spec label="Tone / Context" value={shown.sampleContext} wide />}
          </SectionCard>
        </div>
      )}
    </Modal>
  )
}

// A card's own action, in the header's right slot rather than as a slab under
// the body: it is the thing you do with what that card is showing.
function HeaderAction({
  icon: Icon,
  label,
  title,
  onClick,
}: {
  icon: ElementType
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-1 text-[11px] font-medium text-ink-200 transition-colors hover:border-ink/20 hover:bg-ink/[0.07] hover:text-ink-100"
    >
      <Icon className="h-3 w-3 shrink-0" />
      {label}
    </button>
  )
}

// One delivery param, as a small block rather than a dotted-leader row. The
// leader was this file's own invention and appeared nowhere else in the app;
// at the modal's 672px it also ran half the panel wide between a label and its
// value. `wide` is for a value that needs the full row.
function Spec({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl bg-ink/[0.03] px-3 py-2 ${wide ? 'col-span-2' : ''}`}>
      <div className="text-[10.5px] text-ink-500">{label}</div>
      <div className="mt-0.5 break-words text-[13px] font-medium tabular-nums text-ink-100">{value}</div>
    </div>
  )
}
