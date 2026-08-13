import { useState, useEffect, useRef } from 'react'
import { X, ImagePlus, Download, Film } from 'lucide-react'
import Spinner from '../../components/Spinner'
import type { BRoll } from '../../stores/types'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { useAppStore } from '../../stores/appStore'
import { getAsBase64, isAssetRef } from '../../utils/assetStore'
import { downloadImage } from '../../utils/downloadImage'
import { SectionLabel } from '../../components/SectionCard'

interface BRollFormProps {
  item?: BRoll | null
  onSave: (data: Omit<BRoll, 'id' | 'createdAt'>) => Promise<void> | void
  onCancel: () => void
}

export default function BRollForm({ item, onSave, onCancel }: BRollFormProps) {
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? '')
  const [prompt, setPrompt] = useState(item?.prompt ?? '')
  const [localImagePreview, setLocalImagePreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const resolvedImageUrl = useAssetUrl(imageUrl)
  const displayImage = localImagePreview ?? resolvedImageUrl
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (item) {
      setImageUrl(item.imageUrl)
      setPrompt(item.prompt)
    }
  }, [item])

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setImageUrl(dataUrl)
      setLocalImagePreview(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  const handleDownloadImage = () => {
    if (!displayImage) return
    downloadImage(displayImage, `broll-${item?.id?.slice(0, 8) ?? 'image'}`)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!prompt.trim()) return
    setSaving(true)
    try {
      await onSave({
        imageUrl,
        prompt,
        productId: item?.productId,
        modelId: item?.modelId,
        scriptId: item?.scriptId,
        videoUrl: item?.videoUrl,
        videos: item?.videos,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSendToVideos = async () => {
    if (!imageUrl) return
    let dataUri = imageUrl
    if (isAssetRef(imageUrl)) {
      const asset = await getAsBase64(imageUrl)
      if (!asset) return
      dataUri = `data:${asset.mimeType};base64,${asset.base64}`
    }
    useAppStore.getState().sendToApp({
      targetApp: 'playground',
      targetField: 'videoStartFrame',
      data: { imageUrl: dataUri, prompt },
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight text-ink-200">
          {item ? 'B-Roll Details' : 'New B-Roll'}
        </h3>
        <button type="button" onClick={onCancel} className="text-ink-500 hover:text-ink-300 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Side-by-side: large image left, prompt right */}
      <div className="flex flex-col md:flex-row gap-6">
        {/* Left — b-roll image */}
        <div className="relative group/img w-full shrink-0 md:w-[340px]">
          {displayImage ? (
            <>
              <img
                src={displayImage}
                alt=""
                className="w-full rounded-3xl border border-ink/[0.06] object-contain bg-black/30"
              />
              <button
                type="button"
                onClick={handleDownloadImage}
                className="absolute right-2.5 top-2.5 rounded-full border border-white/20 bg-black/35 p-2 text-white opacity-0 backdrop-blur transition-all hover:bg-black/50 group-hover/img:opacity-100"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute bottom-2.5 right-2.5 rounded-full border border-white/20 bg-black/35 px-3 py-1.5 text-[10px] font-medium text-white opacity-0 backdrop-blur transition-all hover:bg-black/50 group-hover/img:opacity-100"
              >
                Replace
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="group flex aspect-[9/16] w-full items-center justify-center rounded-3xl border border-dashed border-ink/10 bg-ink/[0.02] transition-colors hover:border-ink/20"
            >
              <div className="flex flex-col items-center gap-2">
                <ImagePlus className="h-6 w-6 text-ink-600 transition-colors group-hover:text-ink-400" />
                <span className="text-[11px] text-ink-600">Upload image</span>
              </div>
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" className="hidden" onChange={handleImage} />

        {/* Right — prompt + save */}
        <div className="flex flex-1 flex-col gap-3 min-w-0">
          {/* No card: the prompt is the only input on this side, and a border
              around one row says nothing while costing 24px. The label picks up
              the shared register and the dot, so the `*` stops being the one
              thing on the row you can't see. */}
          <label className="flex flex-1 flex-col gap-1.5">
            <SectionLabel label="Prompt" filled={!!prompt.trim()} required />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={12}
              placeholder="Describe the image generation prompt..."
              className="min-h-[280px] flex-1 rounded-3xl border border-ink/[0.06] bg-ink/[0.02] px-5 py-4 text-[13px] leading-relaxed text-ink-300 placeholder-ink-700 outline-none transition-colors focus:border-ink/15 resize-none"
            />
          </label>

          <div className="flex flex-col gap-2">
            {item && imageUrl && (
              <button
                type="button"
                onClick={handleSendToVideos}
                className="flex items-center justify-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-medium text-green-300 light:text-green-700 transition-colors hover:bg-green-500/20"
                title="Open Playground in video mode with this image as the start frame"
              >
                <Film className="h-3.5 w-3.5" />
                Animate in Playground
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving && <Spinner className="h-4 w-4" />}
              {saving ? 'Saving…' : (item ? 'Save Changes' : 'Add B-Roll')}
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}
