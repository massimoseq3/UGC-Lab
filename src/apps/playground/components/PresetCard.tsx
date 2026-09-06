import { useRef, useState } from 'react'
import { Film } from 'lucide-react'
import type { Preset } from '../presets'

interface PresetCardProps {
  preset: Preset
  onClick: () => void
}

// One card in the preset picker grid — mirrors the Influencer preset cards: a
// 9:16 portrait thumbnail with the title centered over a bottom gradient, no
// subtext. Hover plays the preview video when one is set.
export default function PresetCard({ preset, onClick }: PresetCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hovering, setHovering] = useState(false)

  const hasVideo = !!preset.previewVideoUrl
  const hasThumbnail = !!preset.thumbnailUrl

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => {
        setHovering(true)
        videoRef.current?.play().catch(() => {})
      }}
      onMouseLeave={() => {
        setHovering(false)
        const v = videoRef.current
        if (v) { v.pause(); v.currentTime = 0 }
      }}
      className="group relative block aspect-[9/16] w-full overflow-hidden rounded-xl border border-ink/5 bg-ink/[0.03] transition-all hover:border-ink/15"
    >
      {hasVideo && (
        <video
          ref={videoRef}
          src={preset.previewVideoUrl}
          muted
          loop
          playsInline
          preload="metadata"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            hovering ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {hasThumbnail ? (
        <img
          src={preset.thumbnailUrl}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            hovering && hasVideo ? 'opacity-0' : 'opacity-100'
          }`}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-ink/[0.04]">
          <Film className="h-6 w-6 text-ink-700" strokeWidth={1.5} />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2.5 pt-7">
        {/* Wraps to two lines rather than truncating, matching StyleTile in the
            grid beside it: at the gallery's tile size "Product Hero Shot" and
            "3D Pixar Animation" both clipped on one line. */}
        <span className="block line-clamp-2 text-center text-[12px] font-semibold leading-tight tracking-tight text-zinc-100">
          {preset.title}
        </span>
      </div>
    </button>
  )
}
