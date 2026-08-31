import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Copy, Check, Braces } from 'lucide-react'
import type { CharacterProfile } from '../types'
import { createEmptyProfile, ASPECT_RATIO_KEY } from '../types'
import { buildImagePrompt, fieldsFromPromptJson } from '../services/generateCharacter'
import { copyToClipboard } from '../../../utils/clipboard'
import { useAppStore } from '../../../stores/appStore'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import { useBackdropClose } from '../../../hooks/useBackdropClose'

interface PromptJsonModalProps {
  open: boolean
  onClose: () => void
  profile: CharacterProfile
  onProfileChange: (profile: CharacterProfile) => void
}

// The whole character as one editable JSON box: copy it out, or paste one in.
//
// Copy and paste are the SAME box rather than two buttons on the panel, because
// the two halves need each other. A member pasting a prompt has to know the
// shape it's read in — and the shape is exactly what this box is already
// showing, seeded from the form they're looking at. Two separate actions would
// have meant a copy that shows nothing and a paste that asks blind.
//
// The box is seeded on open and the modal is mounted only while open, so a
// mangled edit is undone by closing it — no Reset button needed.
export default function PromptJsonModal({ open, onClose, profile, onProfileChange }: PromptJsonModalProps) {
  // The union of the two scoped copies the tab dividers already offer
  // (physical + scene & pose), which is what "the full prompt" means on this
  // panel. Deliberately NOT the sheet variant even in sheet mode: a sheet wraps
  // this in a fixed layout directive, and a layout is not a parameter — it
  // would be a wall of prose at the top of a box whose subject is the fields.
  const seed = buildImagePrompt(profile)
  const [text, setText] = useState(seed)
  const [copied, setCopied] = useState(false)

  const backdrop = useBackdropClose(onClose)
  useCloseOnEscape(open, onClose)
  useCloseOnAppSwitch(open, onClose)

  if (!open) return null

  const parsed = fieldsFromPromptJson(text)

  const handleCopy = async () => {
    if (await copyToClipboard(text)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  const handleApply = () => {
    if (!parsed) return
    // A paste replaces the character rather than merging onto it: a field the
    // pasted prompt doesn't mention is a field that character doesn't have, and
    // leaving the last one's value behind would ship it into the render.
    const next = createEmptyProfile()
    for (const [key, value] of Object.entries(parsed.fields)) next[key] = value
    // The aspect ratio is the picker's, not the prompt's — see the note on
    // PASTEABLE_KEYS. Carry the member's own pick straight through.
    next[ASPECT_RATIO_KEY] = profile[ASPECT_RATIO_KEY] ?? next[ASPECT_RATIO_KEY]
    onProfileChange(next)
    useAppStore.getState().addToast(
      `${parsed.count} field${parsed.count === 1 ? '' : 's'} filled from the prompt`,
      'success',
    )
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface-0 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-[57px] shrink-0 items-center justify-between gap-3 border-b border-ink/5 px-5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-tight text-ink-200">Prompt JSON</h3>
            <p className="truncate text-[11px] text-ink-600">Copy this character out, or paste one in</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="shrink-0 rounded-full p-2 text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 p-4">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder="Paste a character prompt as JSON"
            className="h-[52vh] w-full resize-none rounded-2xl border border-ink/10 bg-ink/[0.03] px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-200 outline-none transition-colors placeholder-ink-600 focus:border-ink/20"
          />
          {/* Only the failure speaks. A running count of what the box holds was
              tried and cut: it narrated the obvious on every keystroke, and the
              toast on Fill already says how many fields landed. What a member
              can't work out for themselves is why Fill went grey. */}
          {!parsed && (
            <p className="mt-2 px-1 text-[11px] text-red-400 light:text-red-600">
              That isn't valid JSON, or it holds no fields this form owns.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-ink/10 px-5 py-3">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.02] px-3 py-1.5 text-[12px] font-medium text-ink-300 transition-colors hover:border-ink/20 hover:bg-ink/[0.05] hover:text-ink-100"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400 light:text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!parsed}
            className="flex items-center gap-1.5 rounded-full bg-influencers-500/15 px-4 py-1.5 text-[12px] font-medium text-influencers-300 transition-colors hover:bg-influencers-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Braces className="h-3.5 w-3.5" />
            Fill fields
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
