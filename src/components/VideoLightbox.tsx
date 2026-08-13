import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bookmark, Check, Copy, Download, Film, Maximize2, X } from 'lucide-react'
import Spinner from './Spinner'
import { useExclusiveVideo } from '../hooks/useInlineVideo'
import useCloseOnEscape from '../hooks/useCloseOnEscape'
import { useCloseOnAppSwitch } from '../hooks/useCloseOnAppSwitch'
import { useBankStore } from '../stores/bankStore'
import type { BRoll } from '../stores/types'
import { useAppStore } from '../stores/appStore'
import { saveAsset } from '../utils/assetStore'
import { downloadImage } from '../utils/downloadImage'
import { copyToClipboard } from '../utils/clipboard'
import { extractVideoFrame } from '../utils/videoFrames'
import { TileActionButton } from './tileActions'
import { useBackdropClose } from '../hooks/useBackdropClose'

// The full-screen clip view: the video large on the left, and on the right its
// first / last frame pulled straight out of the file (save either to the
// B-Rolls bank as a reusable start frame, or download it) over the prompt and
// the clip's own actions.
//
// Started life inside the Playground history grid; B-Roll's video tiles wanted
// exactly the same view behind an expand button, so it lives here now and both
// apps render it.

function aspectStyle(ar?: string): React.CSSProperties {
  const [w, h] = (ar ?? '').split(':').map(Number)
  if (!w || !h) return { aspectRatio: '9 / 16' }
  return { aspectRatio: `${w} / ${h}` }
}

export interface VideoLightboxProps {
  // A resolved, playable URL (blob: from useAssetUrl, or http). Frame grabs are
  // canvas reads, so the source has to be same-origin or CORS-clean.
  videoUrl: string
  prompt?: string
  // Stem for downloaded filenames — `${fileStem}-first-frame.png` etc.
  fileStem: string
  aspectRatio?: string
  // Which app a saved frame is stamped with in the B-Rolls bank.
  sourceApp?: BRoll['sourceApp']
  // Accent for the Copy-prompt pill, so the view reads as part of its app.
  accentClass?: string
}

export default function VideoLightbox({
  videoUrl,
  prompt = '',
  fileStem,
  aspectRatio,
  sourceApp = 'broll-studio',
  accentClass = 'border-broll-500/40 bg-broll-500/20 text-broll-100 hover:bg-broll-500/30',
  onClose,
}: VideoLightboxProps & { onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const player = useExclusiveVideo()

  useCloseOnEscape(true, onClose)
  // Portaled to the body, so it would otherwise float over the next app.
  useCloseOnAppSwitch(true, onClose)

  const backdrop = useBackdropClose(onClose)

  async function handleCopyPrompt() {
    if (!prompt) return
    if (await copyToClipboard(prompt)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/85 backdrop-blur-sm"
      {...backdrop}
    >
      <div className="absolute right-4 top-4 z-10" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          title="Close"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white transition-colors hover:bg-black/60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mx-auto flex h-full w-full max-w-6xl flex-row items-center justify-center gap-8 overflow-hidden px-6 py-16">
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          {/* Autoplays with sound, so it claims the app-wide playback slot —
              expanding a clip stops whatever tile was playing. */}
          <video
            {...player}
            src={videoUrl}
            controls
            autoPlay
            loop
            onClick={(e) => e.stopPropagation()}
            className="max-h-[72vh] max-w-full rounded-xl border border-white/10 object-contain"
          />
        </div>

        <div
          onClick={(e) => e.stopPropagation()}
          className="flex h-full w-[380px] shrink-0 flex-col items-center justify-center gap-4 overflow-y-auto py-4"
        >
          <VideoFrameActions
            videoUrl={videoUrl}
            prompt={prompt}
            fileStem={fileStem}
            aspectRatio={aspectRatio}
            sourceApp={sourceApp}
          />
          {prompt && (
            <div className="max-h-[18vh] w-full overflow-y-auto rounded-lg bg-white/[0.02] px-4 py-3 text-center text-[12px] leading-relaxed text-zinc-400">
              {prompt}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {prompt && (
              <LightboxBarButton
                onClick={handleCopyPrompt}
                toneClass={copied ? SAVED_TONE : accentClass}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied ? 'Copied' : 'Copy prompt'}</span>
              </LightboxBarButton>
            )}
            <LightboxBarButton onClick={() => void downloadImage(videoUrl, fileStem, 'mp4')}>
              <Download className="h-4 w-4" />
              <span>Download Video</span>
            </LightboxBarButton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The expand affordance itself: an action button that opens the lightbox above.
 * Drop it into a tile's `TileActionStack` (`chrome='stack'`, the default) or
 * onto a bespoke overlay row (`chrome='plain'`, the 28px black circle the
 * Continuous galleries use).
 */
export function ExpandVideoButton({
  chrome = 'stack',
  ...lightbox
}: VideoLightboxProps & { chrome?: 'stack' | 'plain' }) {
  const [open, setOpen] = useState(false)
  const label = 'Expand — full view with first/last frame'
  return (
    <>
      {chrome === 'stack' ? (
        <TileActionButton title={label} onClick={(e) => { e.stopPropagation(); setOpen(true) }}>
          <Maximize2 className="h-4 w-4" />
        </TileActionButton>
      ) : (
        <button
          type="button"
          title={label}
          onClick={(e) => { e.stopPropagation(); setOpen(true) }}
          className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      )}
      {open && <VideoLightbox {...lightbox} onClose={() => setOpen(false)} />}
    </>
  )
}

// ── Frame grabs ─────────────────────────────────────────────────

export function VideoFrameActions({
  videoUrl,
  prompt,
  fileStem,
  aspectRatio,
  sourceApp,
}: {
  videoUrl: string
  prompt: string
  fileStem: string
  aspectRatio?: string
  sourceApp?: BRoll['sourceApp']
}) {
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Frames</span>
      <div className="grid w-full grid-cols-2 items-start gap-2.5">
        <FrameCard label="First frame" position="first" videoUrl={videoUrl} prompt={prompt} fileStem={fileStem} aspectRatio={aspectRatio} sourceApp={sourceApp} />
        <FrameCard label="Last frame" position="last" videoUrl={videoUrl} prompt={prompt} fileStem={fileStem} aspectRatio={aspectRatio} sourceApp={sourceApp} />
      </div>
    </div>
  )
}

function FrameCard({
  label,
  position,
  videoUrl,
  prompt,
  fileStem,
  aspectRatio,
  sourceApp = 'playground',
}: {
  label: string
  position: 'first' | 'last'
  videoUrl: string
  prompt: string
  fileStem: string
  aspectRatio?: string
  sourceApp?: BRoll['sourceApp']
}) {
  const addBRoll = useBankStore((s) => s.addBRoll)
  const addToast = useAppStore((s) => s.addToast)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // The thumbnail box matches the frame's real aspect ratio. Seed it from the
  // video's declared ratio (so there's no layout shift while the frame loads),
  // then refine from the decoded image's actual dimensions on load.
  const [ratio, setRatio] = useState<React.CSSProperties>(aspectStyle(aspectRatio))

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setStatus('loading')
    extractVideoFrame(videoUrl, position)
      .then((b) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(b)
        setBlob(b)
        setThumbUrl(objectUrl)
        setStatus('ready')
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [videoUrl, position])

  async function handleSave() {
    if (!blob || saving || saved) return
    setSaving(true)
    try {
      const id = await saveAsset(blob, 'image/png')
      await addBRoll({ imageUrl: id, prompt, sourceApp })
      setSaved(true)
    } catch {
      addToast('Could not save the frame', 'error')
    } finally {
      setSaving(false)
    }
  }

  function handleDownload() {
    if (!thumbUrl) return
    void downloadImage(thumbUrl, `${fileStem}-${position}-frame`, 'png')
  }

  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2.5">
      <div
        style={ratio}
        className="flex w-full items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40"
      >
        {status === 'ready' && thumbUrl ? (
          <img
            src={thumbUrl}
            alt={`${label} preview`}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget
              if (w && h) setRatio({ aspectRatio: `${w} / ${h}` })
            }}
            className="h-full w-full object-cover"
          />
        ) : status === 'loading' ? (
          <Spinner className="h-4 w-4 text-zinc-400" />
        ) : (
          <Film className="h-5 w-5 text-zinc-600" />
        )}
      </div>
      <span className="text-[11px] font-medium text-zinc-300">{label}</span>
      <div className="flex w-full flex-col gap-1.5">
        <FrameButton
          title={saved ? 'Saved to B-Rolls' : 'Save to Bank'}
          disabled={status !== 'ready' || saving || saved}
          tone={saved ? 'saved' : 'default'}
          onClick={handleSave}
        >
          {saving ? <Spinner className="h-4 w-4" /> : saved ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          <span>{saved ? 'Saved' : 'Save'}</span>
        </FrameButton>
        <FrameButton title="Download frame" disabled={status !== 'ready'} onClick={handleDownload}>
          <Download className="h-4 w-4" />
          <span>Download</span>
        </FrameButton>
      </div>
    </div>
  )
}

const SAVED_TONE = 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'

function FrameButton({
  children,
  onClick,
  title,
  disabled,
  tone = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
  tone?: 'default' | 'saved'
}) {
  const toneClass = tone === 'saved'
    ? SAVED_TONE
    : 'border-white/15 bg-white/[0.06] text-zinc-100 hover:bg-white/[0.12]'
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  )
}

function LightboxBarButton({
  children,
  onClick,
  toneClass = 'border-white/15 bg-white/[0.06] text-zinc-100 hover:bg-white/[0.12]',
}: {
  children: React.ReactNode
  onClick: () => void
  toneClass?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full border px-5 py-3 text-[13px] font-semibold tracking-tight transition-colors ${toneClass}`}
    >
      {children}
    </button>
  )
}
