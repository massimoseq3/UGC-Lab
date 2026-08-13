import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, Copy, Check, LayoutGrid } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import { getUrl } from '../../../utils/assetStore'
import { downloadImage } from '../../../utils/downloadImage'
import { copyToClipboard } from '../../../utils/clipboard'
import { useBackdropClose } from '../../../hooks/useBackdropClose'

// Full-screen image viewer for the Influencers tab — mirrors the Playground's
// preview modal: the picture centered with its real aspect, the generation
// prompt underneath, and Copy Prompt / Download actions. Opened from the expand
// button that appears on hover over any gallery / editor tile.

export default function InfluencerLightbox({
  imageRef,
  prompt,
  isSheet,
  onClose,
}: {
  imageRef: string
  prompt: string
  isSheet: boolean
  onClose: () => void
}) {
  const url = useAssetUrl(imageRef)
  const [copied, setCopied] = useState(false)
  useCloseOnAppSwitch(true, onClose)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleDownload() {
    if (!url) return
    const resolved = (await getUrl(imageRef)) ?? url
    await downloadImage(resolved, `${isSheet ? 'character-sheet' : 'character'}-${imageRef}`)
  }
  const backdrop = useBackdropClose(onClose)

  async function handleCopy() {
    if (await copyToClipboard(prompt)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black/80 backdrop-blur-sm"
      {...backdrop}
    >
      <div className="absolute right-4 top-4 z-10" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white transition-colors hover:bg-black/60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mx-auto flex h-full w-full max-w-5xl flex-col items-center justify-center gap-4 overflow-hidden px-6 py-16">
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          {url ? (
            <img
              src={url}
              alt=""
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full rounded-xl border border-white/10 object-contain"
            />
          ) : (
            <Spinner className="h-6 w-6 text-white/60" />
          )}
        </div>

        <div
          onClick={(e) => e.stopPropagation()}
          className="flex w-full max-w-2xl shrink-0 flex-col items-center gap-3"
        >
          {isSheet && (
            <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-white/80">
              <LayoutGrid className="h-3 w-3" strokeWidth={2} />
              Character Sheet
            </span>
          )}
          {prompt && (
            <div className="max-h-[18vh] w-full overflow-y-auto rounded-lg bg-white/[0.02] px-4 py-3 text-center text-[12px] leading-relaxed text-zinc-400">
              {prompt}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {prompt && (
              <LightboxButton onClick={handleCopy} tone={copied ? 'saved' : 'default'}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied ? 'Copied' : 'Copy Prompt'}</span>
              </LightboxButton>
            )}
            <LightboxButton onClick={handleDownload}>
              <Download className="h-4 w-4" />
              <span>Download Image</span>
            </LightboxButton>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function LightboxButton({
  children,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'default' | 'saved'
}) {
  const toneClass = tone === 'saved'
    ? 'border-emerald-400/40 bg-emerald-500/30 text-emerald-100'
    : 'border-white/15 bg-white/10 text-white hover:bg-white/15'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors ${toneClass}`}
    >
      {children}
    </button>
  )
}
