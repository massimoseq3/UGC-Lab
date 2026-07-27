import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, ClipboardCopy, Check, AlertTriangle, FileDown, Download, Info } from 'lucide-react'
import type { BrollMode } from '../types'
import { buildImportBrief, parseImport, type ImportContext, type ImportParsed } from '../services/importPrompts'
import { copyToClipboard } from '../../../utils/clipboard'
import { useAppStore } from '../../../stores/appStore'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'

const MODE_LABEL: Record<BrollMode, string> = {
  broll: 'B-Roll',
  dialogue: 'Dialogue',
  continuous: 'Continuous',
}

const MODE_WHAT: Record<BrollMode, string> = {
  broll: 'three silent shot prompts per script line',
  dialogue: 'three ways of delivering each script line on camera',
  continuous: 'a keyframe chain — scenes, keyframe concepts and their motion',
}

const BRIEF_FILENAME: Record<BrollMode, string> = {
  broll: 'broll-brief.txt',
  dialogue: 'dialogue-brief.txt',
  continuous: 'continuous-brief.txt',
}

// Text-ish files only — the importer reads the tagged envelope, so anything a
// text editor can open works. Binary drops are rejected by the reader itself.
const ACCEPTED = '.txt,.md,.xml,.json,text/plain,text/markdown'

interface ImportPromptsModalProps {
  open: boolean
  onClose: () => void
  mode: BrollMode
  ctx: ImportContext
  // What the panel's style row currently reads — shown so the member knows
  // which look gets appended to every imported prompt at render time.
  styleLabel: string
  onImport: (parsed: ImportParsed) => void
}

export default function ImportPromptsModal({
  open,
  onClose,
  mode,
  ctx,
  styleLabel,
  onImport,
}: ImportPromptsModalProps) {
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useCloseOnAppSwitch(open, onClose)
  useCloseOnEscape(open, onClose)

  // Parsed on every keystroke: the member sees "6 scenes · 24 prompts" (or the
  // exact reason it won't parse) before spending a click, not after.
  const outcome = useMemo(
    () => (text.trim() ? parseImport(mode, text, ctx) : null),
    // ctx is rebuilt each render by the parent; the fields that matter for a
    // parse are stable within an open modal, so key on the text and mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, mode],
  )

  if (!open) return null

  const readFile = async (file: File) => {
    try {
      setText(await file.text())
    } catch {
      useAppStore.getState().addToast('Could not read that file. Paste the text instead.', 'error')
    }
  }

  const handleCopyBrief = async () => {
    const ok = await copyToClipboard(buildImportBrief(mode, ctx))
    if (!ok) {
      useAppStore.getState().addToast('Could not copy the brief. Download it instead.', 'error')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownloadBrief = () => {
    const blob = new Blob([buildImportBrief(mode, ctx)], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = BRIEF_FILENAME[mode]
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    if (!outcome?.ok) return
    onImport(outcome.parsed)
    setText('')
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold tracking-tight text-ink-100">Import prompts</span>
            <span className="shrink-0 rounded-full bg-broll-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-broll-300 light:text-broll-700">
              {MODE_LABEL[mode]}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/10 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Step 1 — the brief. Assembled from the same system + user prompt
              the in-app generator sends, so an outside model is working to the
              identical spec. */}
          <div className="rounded-2xl border border-ink/10 bg-ink/[0.03] p-4">
            <p className="text-[13px] font-medium tracking-tight text-ink-100">
              1 · Copy the brief into Claude (or any model)
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
              It carries this session's script, product and character context plus the exact output format B-Roll
              parses — {MODE_WHAT[mode]}. Attach your product and character photos in that chat for context, then
              paste the reply back here.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyBrief}
                className="flex items-center gap-1.5 rounded-full bg-broll-500 px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-broll-400"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy brief'}
              </button>
              <button
                type="button"
                onClick={handleDownloadBrief}
                className="flex items-center gap-1.5 rounded-full border border-ink/10 px-3.5 py-2 text-[12px] font-medium text-ink-300 transition-colors hover:bg-ink/5 hover:text-ink-100"
              >
                <FileDown className="h-3.5 w-3.5" />
                Download as file
              </button>
              {!ctx.scriptText.trim() && (
                <span className="flex items-center gap-1.5 text-[11px] text-amber-300 light:text-amber-700">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  No script in the panel — the brief won't include one.
                </span>
              )}
            </div>
          </div>

          {/* Step 2 — the paste box. */}
          <p className="mb-2 mt-4 text-[13px] font-medium tracking-tight text-ink-100">
            2 · Paste what it gives you back
          </p>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void readFile(file)
            }}
            className={`relative overflow-hidden rounded-2xl border transition-colors ${
              dragOver ? 'border-broll-500/50 bg-broll-500/10' : 'border-ink/10 bg-ink/[0.03] focus-within:border-ink/20'
            }`}
          >
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                mode === 'continuous'
                  ? '<STORYBOARD>\n<STYLE>…</STYLE>\n<SCENE_1>…'
                  : '<SCENE>\n<LINE>…</LINE>…'
              }
              className="h-[34vh] w-full resize-none border-0 bg-transparent px-4 pb-3 pt-3 font-mono text-[12px] leading-relaxed text-ink-200 placeholder-ink-700 outline-none"
            />
            <div className="flex items-center justify-between gap-3 border-t border-ink/10 px-3 py-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-100"
              >
                <Upload className="h-3 w-3" />
                Upload a file
              </button>
              {text.trim() && (
                <button
                  type="button"
                  onClick={() => setText('')}
                  className="rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-200"
                >
                  Clear
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void readFile(file)
                e.target.value = ''
              }}
            />
          </div>

          {/* Parse feedback — what landed, or exactly why it didn't. */}
          {outcome && (
            <div className="mt-3">
              {outcome.ok ? (
                <>
                  <p className="flex items-center gap-2 text-[12px] font-medium text-emerald-300 light:text-emerald-700">
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    {outcome.parsed.summary} ready to import
                  </p>
                  {outcome.parsed.notes.map((note) => (
                    <p key={note} className="mt-1.5 flex items-start gap-2 text-[11px] leading-relaxed text-amber-300 light:text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{note}</span>
                    </p>
                  ))}
                </>
              ) : (
                <p className="flex items-start gap-2 text-[12px] leading-relaxed text-red-300 light:text-red-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{outcome.error}</span>
                </p>
              )}
            </div>
          )}

          <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-ink-600">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Importing replaces the {MODE_LABEL[mode]} storyboard on screen and starts a new history row — the old one
              stays in History. Visual style stays as picked in the panel ({styleLabel}) and is applied at render time.
            </span>
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-ink/10 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-[12px] font-medium text-ink-400 transition-colors hover:bg-ink/5 hover:text-ink-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!outcome?.ok}
            className="flex items-center gap-1.5 rounded-full bg-broll-500 px-5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            Import prompts
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
