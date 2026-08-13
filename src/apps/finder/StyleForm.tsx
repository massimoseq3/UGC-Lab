import { useState, useEffect } from 'react'
import { X, Palette } from 'lucide-react'
import Spinner from '../../components/Spinner'
import type { StylePreset } from '../../stores/types'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import SectionCard, { SectionLabel } from '../../components/SectionCard'

interface StyleFormProps {
  item?: StylePreset | null
  onSave: (data: Omit<StylePreset, 'id' | 'createdAt'>) => Promise<void> | void
  onCancel: () => void
}

// The reference frames a style was read from are read-only here — they're
// captured in B-Roll at analysis time and only exist to remind the user what
// the look came from. The brief is the editable part; it's what a model sees.
function ReferenceThumb({ refId }: { refId: string }) {
  const url = useAssetUrl(refId)
  return (
    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-ink/10 bg-ink/[0.04]">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : null}
    </div>
  )
}

export default function StyleForm({ item, onSave, onCancel }: StyleFormProps) {
  const [name, setName] = useState(item?.name ?? '')
  const [brief, setBrief] = useState(item?.brief ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (item) {
      setName(item.name)
      setBrief(item.brief)
    }
  }, [item])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!name.trim() || !brief.trim()) return
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        brief: brief.trim(),
        thumbRefs: item?.thumbRefs,
        starred: item?.starred,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight text-ink-200">
          {item ? 'Edit Style' : 'New Style'}
        </h3>
        <button type="button" onClick={onCancel} className="text-ink-500 transition-colors hover:text-ink-300">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* Left — the style paragraph itself. A lone control, so no card. */}
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <SectionLabel label="Style brief" filled={!!brief.trim()} required />
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={16}
            placeholder="How everything rendered in this style looks — medium, forms, palette, light, camera and finish. Describe the look only; never the subjects it came from."
            className="min-h-[320px] resize-y rounded-3xl border border-ink/10 bg-ink/[0.02] px-5 py-4 text-sm leading-relaxed text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
          />
          <span className="px-1 text-[11px] leading-relaxed text-ink-600">
            This paragraph is appended to every image and video prompt rendered in this style.
          </span>
        </label>

        {/* Right — name, reference frames, save. The name and the frames it was
            read from are one group (what this style IS and where it came from);
            Save stays outside the card, like every panel's Generate. */}
        <div className="flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-1 lg:w-72">
          <SectionCard icon={Palette} title="Style" contentClassName="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <SectionLabel label="Name" filled={!!name.trim()} required />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. "Warm 90s Camcorder"'
                className="rounded-full border border-ink/10 bg-ink/[0.02] px-4 py-2.5 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
              />
            </label>

            {item?.thumbRefs && item.thumbRefs.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {/* No dot: these are read-only thumbnails of what the brief was
                    distilled from, not an input anything waits on. */}
                <SectionLabel label="Read from" />
                <div className="flex flex-wrap gap-2">
                  {item.thumbRefs.map((ref) => (
                    <ReferenceThumb key={ref} refId={ref} />
                  ))}
                </div>
              </div>
            )}
          </SectionCard>

          {!item && (
            <p className="flex items-start gap-2 rounded-2xl border border-ink/5 bg-ink/[0.03] px-3.5 py-3 text-[11px] leading-relaxed text-ink-500">
              <Palette className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-600" strokeWidth={1.5} />
              <span>Tip: B-Roll can write this for you — upload a few frames of an ad whose look you want and save the result here.</span>
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="mt-1 flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Spinner className="h-4 w-4" />}
            {saving ? 'Saving…' : item ? 'Save Changes' : 'Add Style'}
          </button>
        </div>
      </div>
    </form>
  )
}
