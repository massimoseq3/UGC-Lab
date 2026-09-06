import { useRef } from 'react'
import { Film } from 'lucide-react'
import VideoInputSlot, { type VideoInputValue } from '../../../components/video/VideoInputSlot'
import { RefSlotPill, RefChip } from '../../../components/video/RefSlot'
import { RefGroup } from '../../../components/video/refInputParts'
import { fileToDataUri } from '../../../utils/kie'
import { readMediaDuration } from '../../../utils/media'
import type { BankType } from '../../../utils/constants'
import type { BRoll } from '../../../stores/types'
import type { PromptRef } from './PromptPanel'

// Kling Motion Control's inputs: a reference character image (the look) and a
// driving video (the motion), plus an orientation choice. Mirrors the shape of
// OmniInputsSection — it owns the refs[] slots it cares about ('motion-image',
// 'motion-video') and the parent threads the orientation through state.

// The character image leads with Influencers (the headline use case: animate an
// AI influencer), then B-Roll stills, then Products.
const MOTION_IMAGE_TABS: Array<{ type: BankType; filter?: (item: BRoll | unknown) => boolean }> = [
  { type: 'models' },
  { type: 'brolls', filter: (item) => !!(item as BRoll).imageUrl },
  { type: 'products' },
]

// kie caps the driving clip at 30s for 'video' orientation, 10s for 'image'.
// We validate against the generous bound and let kie reject the narrower case.
const MAX_DRIVING_SECONDS = 30

interface MotionControlSectionProps {
  refs: PromptRef[]
  onChangeRefs: (next: PromptRef[]) => void
  orientation: 'image' | 'video'
  onChangeOrientation: (next: 'image' | 'video') => void
  onError: (message: string) => void
}

export default function MotionControlSection({
  refs,
  onChangeRefs,
  orientation,
  onChangeOrientation,
  onError,
}: MotionControlSectionProps) {
  const videoInputRef = useRef<HTMLInputElement>(null)

  const imageRef = refs.find((r) => r.slot === 'motion-image')
  const videoRef = refs.find((r) => r.slot === 'motion-video')

  function setImage(value: VideoInputValue | null) {
    const others = refs.filter((r) => r.slot !== 'motion-image')
    if (!value) {
      onChangeRefs(others)
      return
    }
    onChangeRefs([...others, { url: value.dataUri, label: 'character', source: 'upload', slot: 'motion-image' }])
  }

  async function handleVideoFile(file: File | null) {
    if (!file) return
    const dataUri = await fileToDataUri(file)
    let durationSeconds: number | undefined
    try {
      durationSeconds = await readMediaDuration(dataUri, 'video')
    } catch {
      // Unreadable metadata — let kie validate length server-side.
    }
    if (durationSeconds && durationSeconds > MAX_DRIVING_SECONDS) {
      onError(`The driving video can't exceed ${MAX_DRIVING_SECONDS}s. This one is ${Math.ceil(durationSeconds)}s.`)
      return
    }
    onChangeRefs([
      ...refs.filter((r) => r.slot !== 'motion-video'),
      { url: dataUri, label: file.name, source: 'upload', slot: 'motion-video', durationSeconds },
    ])
  }

  return (
    /* Three labelled groups, not one wrapping row of three different shapes.
       This section sits inside Playground's References card and was the one
       thing in it with no labels at all — its two input names were captions
       INSIDE the empty slots, so they vanished the moment you filled them,
       which is exactly when you want to check you filled the right one.
       Both dots are `required` and this is the only place in Playground that
       is true: the run refuses without both (see Playground.tsx), so an empty
       slot here really is why nothing generates. */
    <div className="flex flex-col gap-3">
      <RefGroup label="Character Image" filled={!!imageRef} required>
        <VideoInputSlot
          label="Character Image"
          value={imageRef ? { dataUri: imageRef.url } : null}
          onChange={setImage}
          bankType="models"
          tabs={MOTION_IMAGE_TABS}
        />
      </RefGroup>

      <RefGroup
        label="Driving Video"
        filled={!!videoRef}
        required
        note={`≤ ${orientation === 'video' ? MAX_DRIVING_SECONDS : 10}s`}
      >
        {videoRef ? (
          <RefChip
            icon={Film}
            label={videoRef.label}
            meta={videoRef.durationSeconds != null ? `${Math.round(videoRef.durationSeconds)}s` : undefined}
            onRemove={() => onChangeRefs(refs.filter((r) => r.slot !== 'motion-video'))}
          />
        ) : (
          <RefSlotPill icon={Film} label="Upload a Clip" onClick={() => videoInputRef.current?.click()} />
        )}
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            void handleVideoFile(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />
      </RefGroup>

      {/* Orientation — its own group, so it stops queueing in the run of
          attachments as though it were one. No dot: it always holds a value. */}
      <RefGroup label="Follow the">
        <div className="flex h-9 w-fit items-center rounded-full border border-ink/10 bg-ink/[0.02] p-0.5">
          <button
            type="button"
            onClick={() => onChangeOrientation('video')}
            className={`h-full rounded-full px-3 text-[12px] transition-colors ${
              orientation === 'video'
                ? 'bg-playground-500/15 text-playground-200'
                : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            Follow video
          </button>
          <button
            type="button"
            onClick={() => onChangeOrientation('image')}
            className={`h-full rounded-full px-3 text-[12px] transition-colors ${
              orientation === 'image'
                ? 'bg-playground-500/15 text-playground-200'
                : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            Match photo
          </button>
        </div>
      </RefGroup>

      <p className="text-[11px] text-ink-600">
        The image sets the look, the video sets the motion.{' '}
        {orientation === 'video'
          ? 'Character faces the same way as the driving video (clip up to 30s).'
          : 'Character keeps the orientation of the reference photo (clip up to 10s).'}
      </p>
    </div>
  )
}
