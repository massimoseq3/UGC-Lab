import { useState, useEffect } from 'react'
import { X, FileText } from 'lucide-react'
import Spinner from '../../components/Spinner'
import type { Script } from '../../stores/types'
import { useBankStore } from '../../stores/bankStore'
import SectionCard, { SectionLabel } from '../../components/SectionCard'

interface ScriptFormProps {
  item?: Script | null
  onSave: (data: Omit<Script, 'id' | 'createdAt'>) => Promise<void> | void
  onCancel: () => void
}

export default function ScriptForm({ item, onSave, onCancel }: ScriptFormProps) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [scriptText, setScriptText] = useState(item?.scriptText ?? '')
  const [linkedProductId, setLinkedProductId] = useState(item?.linkedProductId ?? '')
  const [saving, setSaving] = useState(false)
  const products = useBankStore((s) => s.products)

  useEffect(() => {
    if (item) {
      setTitle(item.title)
      setScriptText(item.scriptText)
      setLinkedProductId(item.linkedProductId)
    }
  }, [item])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (!title.trim() || !scriptText.trim()) return
    setSaving(true)
    try {
      await onSave({
        title,
        scriptText,
        linkedProductId,
        source: item?.source ?? 'manual',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight text-ink-200">
          {item ? 'Edit Script' : 'New Script'}
        </h3>
        <button type="button" onClick={onCancel} className="text-ink-500 hover:text-ink-300 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Two-column: tall script editor on the left, controls on the right. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* Left — script editor fills the space. Uncarded on purpose: it's a
            lone control, and the border is what says "these belong together". */}
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <SectionLabel label="Script Text" filled={!!scriptText.trim()} required />
          <textarea
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            rows={22}
            placeholder="Paste or write your script here…"
            className="min-h-[460px] rounded-3xl border border-ink/10 bg-ink/[0.02] px-5 py-4 text-sm leading-relaxed text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20 resize-y"
          />
        </label>

        {/* Right — title, linked product, save (sticky on desktop). The two
            fields are one group, so they sit in a card; Save stays outside it,
            the same way every panel's Generate sits outside its input card. */}
        <div className="flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-1 lg:w-72">
          <SectionCard icon={FileText} title="Details" contentClassName="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <SectionLabel label="Title" filled={!!title.trim()} required />
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder='e.g. "LARQ - Lazy Girl Hook"'
                className="rounded-full border border-ink/10 bg-ink/[0.02] px-4 py-2.5 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <SectionLabel label="Linked Product" filled={!!linkedProductId} />
              <select
                value={linkedProductId}
                onChange={(e) => setLinkedProductId(e.target.value)}
                className="rounded-full border border-ink/10 bg-surface-1 px-4 py-2.5 text-sm text-ink-200 outline-none transition-colors focus:border-ink/20"
              >
                <option value="">None</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.productName}</option>
                ))}
              </select>
            </label>
          </SectionCard>

          <button
            type="submit"
            disabled={saving}
            className="mt-1 flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving && <Spinner className="h-4 w-4" />}
            {saving ? 'Saving…' : (item ? 'Save Changes' : 'Add Script')}
          </button>
        </div>
      </div>
    </form>
  )
}
