import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Check, Bookmark, ArrowUpRight, Mic, Film, PenLine, AlertCircle, ImagePlay, Pencil, X, Undo2, Redo2 } from 'lucide-react'
import GenerationProgress from '../../../components/GenerationProgress'
import GridCanvas from '../../../components/GridCanvas'
import { useBankStore } from '../../../stores/bankStore'
import { useAppStore } from '../../../stores/appStore'
import { REMIX_ANGLE_LABEL, remixAnglesForCount, HOOK_CATEGORY_META, HOOK_COUNT, parseHooks, hooksPlainText, type ParsedHook, type RemixAngle, type ScriptMode, type WriteFormat } from '../types'

interface OutputPanelProps {
  variations: string[]
  // Remix only: angles that produced these cards, when the run stamped them.
  outputAngles?: RemixAngle[] | null
  // Mode that produced the shown variations — drives the card titles, the
  // "spoken vs scenes" send buttons, and the angle labels.
  mode: ScriptMode
  // Live left-panel mode — drives the empty-state + loading copy only.
  liveMode?: ScriptMode
  writeFormat?: WriteFormat
  writeStyleLabel?: string
  // Hooks format only — the family choice that produced the shown pack.
  hookCategoryLabel?: string
  linkedProductId: string | null
  isGenerating?: boolean
  error?: string | null
  // Commits an inline edit of take `index` back to the persisted output state.
  onEditVariation?: (index: number, text: string) => void
}

// Canonically "--- Scene N: label (mm:ss-mm:ss) ---", but we tolerate a model
// near-miss that drops the surrounding dashes ("Scene 1:", "SCENE 1 —") so a
// scenes/reverse output still splits into cards instead of silently degrading
// to a plain spoken script. Mirrors detectSceneBlueprint's input matcher.
const SCENE_HEADER = /^(?:---\s*)?scene\s*\d+\s*[—:–-]/i
const SCENE_REGEX = /(^|\n)\s*(?:---\s*)?scene\s*\d+\s*[—:–-]/i

interface SceneChunk {
  header: string
  body: string
}

function splitScenes(text: string): SceneChunk[] | null {
  if (!SCENE_REGEX.test(text)) return null
  const lines = text.split('\n')
  const chunks: SceneChunk[] = []
  let current: SceneChunk | null = null
  for (const line of lines) {
    if (SCENE_HEADER.test(line.trim())) {
      if (current) chunks.push(current)
      current = { header: line.trim(), body: '' }
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line
    }
  }
  if (current) chunks.push(current)
  return chunks
    .map((c) => ({ ...c, body: c.body.trim() }))
    .filter((c) => c.body.length > 0)
}

// Content that precedes the first "--- Scene N ---" header — used by the scene
// formats to carry a leading "=== VOICE PROFILE ... ===" block. Stripped of its
// own divider markers so it renders as a clean voice card above the scenes.
function extractIntro(text: string): string {
  const idx = text.search(SCENE_REGEX)
  if (idx <= 0) return ''
  return text
    .slice(0, idx)
    .replace(/^[=\s]*VOICE PROFILE[^\n]*\n/i, '')
    .replace(/^[=\s]+|[=\s]+$/g, '')
    .trim()
}

// Matches the voice-profile header line wherever it appears — the model is told
// to emit it AFTER the last scene, so it gets appended to (and merged into) the
// final scene's body unless we pull it out. Case-insensitive; tolerates the
// "(same voice in every scene)" parenthetical and trailing "===" markers.
const VOICE_HEADER_REGEX = /(^|\n)[=\s]*VOICE PROFILE\b[^\n]*\n?/i

// Pulls the voice-profile block out of a scenes script. It can sit BEFORE the
// first scene (legacy `extractIntro` shape) or be appended AFTER/within the last
// scene (what the prompt actually produces). Returns the voice-profile body
// (with its "=== ... ===" markers stripped) and the rest of the text with the
// block removed, ready for scene-splitting.
function splitVoiceProfile(text: string): { body: string; rest: string } {
  const match = VOICE_HEADER_REGEX.exec(text)
  if (!match) {
    // No appended header — fall back to the intro-based shape.
    return { body: extractIntro(text), rest: text }
  }
  const headerStart = match.index + match[1].length
  // Everything from the header to the end is the voice-profile block; strip the
  // header line and any standalone "===" divider lines from the body.
  const body = text
    .slice(headerStart)
    .replace(VOICE_HEADER_REGEX, '')
    .replace(/^[=\s]+|[=\s]+$/g, '')
    .trim()
  const rest = text.slice(0, headerStart).replace(/\s+$/, '')
  // The intro shape and the appended shape are mutually exclusive in practice,
  // but prefer whichever yielded a body so both shapes work.
  return { body: body || extractIntro(rest), rest }
}

interface VariationCardProps {
  text: string
  cardTitle: string
  defaultSaveTitle: string
  linkedProductId: string | null
  mode: ScriptMode
  // Hooks format: renders the tagged one-liners as per-hook rows; copy/save use
  // the clean spoken lines (tags stripped).
  isHooks?: boolean
  // Commits an inline edit of this take's text back to the persisted output
  // state. Omitted → the edit affordance is hidden.
  onEdit?: (text: string) => void
  // Callback ref to the card's root — lets the OutputPanel scroll a given take
  // into view when its number is clicked in the take switcher.
  cardRef?: (el: HTMLDivElement | null) => void
}

function VariationCard({
  text,
  cardTitle,
  defaultSaveTitle,
  linkedProductId,
  mode,
  isHooks = false,
  onEdit,
  cardRef,
}: VariationCardProps) {
  const [copied, setCopied] = useState(false)
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [saveTitle, setSaveTitle] = useState(defaultSaveTitle)
  const [saved, setSaved] = useState(false)
  // Inline edit of the take's raw text. `draft` is the live textarea value;
  // committing on Done flows it up via onEdit (persisted in the parent) and the
  // refreshed `text` prop re-renders the parsed view.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  // Undo/redo stack for committed edits to this take. `textSync` lets the
  // render-time check tell our own commits (keep the stack) from an external
  // change — a new generation or a loaded history item (reset the stack).
  const [history, setHistory] = useState<string[]>([text])
  const [histIndex, setHistIndex] = useState(0)
  const [textSync, setTextSync] = useState(text)
  if (text !== textSync) {
    setTextSync(text)
    setHistory([text])
    setHistIndex(0)
  }
  const canUndo = histIndex > 0
  const canRedo = histIndex < history.length - 1
  // Sticky "already in the bank" flag — `saved` is only the 3s visual flash.
  // Send-to-app auto-saves use this to avoid writing duplicate bank rows.
  const [savedOnce, setSavedOnce] = useState(false)

  const addScript = useBankStore((s) => s.addScript)
  const sendToApp = useAppStore((s) => s.sendToApp)
  const addToast = useAppStore((s) => s.addToast)

  // Pull the voice-profile block (wherever it sits) out FIRST, then split the
  // remaining text into scenes — otherwise the appended profile gets merged into
  // the last scene's body.
  const { scenes, voiceProfile } = useMemo(() => {
    if (isHooks) return { scenes: null, voiceProfile: '' }
    const { body, rest } = splitVoiceProfile(text)
    const parsed = splitScenes(rest)
    return { scenes: parsed, voiceProfile: parsed ? body : '' }
  }, [text, isHooks])

  // Hooks: the raw text carries <FAMILY> tags — parse them into rows, and use
  // the clean spoken lines for copy / save-to-bank.
  const hooks = useMemo<ParsedHook[] | null>(() => (isHooks ? parseHooks(text) : null), [text, isHooks])
  const shareText = isHooks ? hooksPlainText(text) : text

  // A plain spoken script (remix variation, or a write-mode 'script' output)
  // can be read aloud → Voiceovers. A scene blueprint (reverse-engineer, or a
  // write-mode 'scenes' output) is a prompt asset → Playground. A hooks pack is
  // a list of standalone openers — copy/save only, no sends.
  const isSpokenScript = !isHooks && (mode === 'remix' || (mode === 'write' && !scenes))

  const startEdit = () => {
    setDraft(text)
    setShowSaveForm(false)
    setEditing(true)
  }

  // Push `next` as a new committed state and flow it to the parent. Setting
  // `textSync` in step keeps the render-time check from mistaking our own
  // commit for an external reset (which would wipe the undo stack).
  const applyText = (next: string) => {
    setTextSync(next)
    onEdit?.(next)
  }

  const commitEdit = () => {
    if (draft !== history[histIndex]) {
      const nextHistory = [...history.slice(0, histIndex + 1), draft]
      setHistory(nextHistory)
      setHistIndex(nextHistory.length - 1)
      applyText(draft)
      addToast('Edit saved')
    }
    setEditing(false)
  }

  const cancelEdit = () => {
    setDraft(text)
    setEditing(false)
  }

  const handleUndo = () => {
    if (!canUndo) return
    const i = histIndex - 1
    setHistIndex(i)
    applyText(history[i])
  }

  const handleRedo = () => {
    if (!canRedo) return
    const i = histIndex + 1
    setHistIndex(i)
    applyText(history[i])
  }

  const handleCopyAll = async () => {
    const ok = await copyToClipboard(shareText)
    if (ok) {
      setCopied(true)
      addToast(isHooks ? 'Hooks copied to clipboard' : 'Script copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } else {
      addToast('Copy failed', 'error')
    }
  }

  const saveToBank = (title: string) => {
    addScript({
      title,
      scriptText: shareText,
      linkedProductId: linkedProductId ?? '',
      source: 'script-architect',
      // Hooks are spoken one-liners, so they file with the spoken scripts.
      kind: isSpokenScript || isHooks ? 'remix' : 'reverse-engineer',
    })
    setSavedOnce(true)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleSave = () => {
    const title = saveTitle.trim()
    if (!title) return
    saveToBank(title)
    setShowSaveForm(false)
    addToast('Script saved to bank')
  }

  const handleSendToVoiceStudio = () => {
    const autoSaved = !savedOnce
    if (autoSaved) saveToBank(defaultSaveTitle)
    sendToApp({ targetApp: 'voice-studio', targetField: 'scriptText', data: text })
    addToast(autoSaved ? 'Script saved to bank · sent to Voiceovers' : 'Script sent to Voiceovers')
  }

  const handleSendToBrollStudio = () => {
    const autoSaved = !savedOnce
    if (autoSaved) saveToBank(defaultSaveTitle)
    sendToApp({ targetApp: 'broll-studio', targetField: 'scriptText', data: text })
    addToast(autoSaved ? 'Script saved to bank · sent to B-Roll' : 'Script sent to B-Roll')
  }

  const handleSendToPlayground = () => {
    sendToApp({ targetApp: 'playground', targetField: 'videoPrompt', data: text })
    addToast('Prompt sent to Playground')
  }

  return (
    <div ref={cardRef} className="flex shrink-0 flex-col rounded-3xl border border-ink/10 bg-ink/[0.06] light:bg-[#F1F1F2] overflow-hidden card-soft-shadow">
      <div className="relative flex items-center justify-center border-b border-ink/5 px-12 py-2.5">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-scripts-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-tight text-scripts-300">
            {cardTitle}
          </span>
          {scenes && !editing && (
            <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-[10px] text-ink-500">
              {scenes.length} scene{scenes.length === 1 ? '' : 's'}
            </span>
          )}
          {hooks && !editing && (
            <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-[10px] text-ink-500">
              {hooks.length} hook{hooks.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {onEdit && !editing && (
          <div className="absolute left-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <button
              onClick={startEdit}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              title="Undo"
              className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Undo2 className="h-3 w-3" />
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              title="Redo"
              className="flex h-6 w-6 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Redo2 className="h-3 w-3" />
            </button>
          </div>
        )}
        {!editing && (
          <button
            onClick={handleCopyAll}
            className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink/5 hover:text-ink-300"
          >
            {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : scenes ? 'Copy Full Script' : hooks ? 'Copy All' : 'Copy'}
          </button>
        )}
        {editing && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-tight text-scripts-300">
            Editing
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4">
        {editing ? (
          // One textarea over the raw take text — works for every output shape
          // (scenes / plain script). Committing re-parses on render.
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            spellCheck={false}
            className="min-h-[320px] w-full resize-y rounded-2xl border border-ink/10 bg-surface-0 p-3 text-[13px] font-light leading-relaxed tracking-tight text-ink-100 outline-none transition-colors focus:border-scripts-500/30"
          />
        ) : hooks ? (
          // One row per hook — family chip + the line + its own copy button.
          <>
            {hooks.map((hook, i) => <HookLineCard key={i} hook={hook} index={i} />)}
          </>
        ) : scenes ? (
          <>
            {scenes.map((scene, i) => <SceneChunkCard key={i} chunk={scene} />)}
            {voiceProfile && <VoiceProfileCard body={voiceProfile} />}
          </>
        ) : mode === 'reverse-engineer' ? (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed tracking-tight text-ink-100">
            {text}
          </pre>
        ) : (
          // Each source line is its own paragraph: normal line-height within a
          // (wrapped) sentence, a slight gap between sentences. No `font-sans`
          // — that falls back to system-ui; we want the inherited Geist.
          <div className="flex flex-col gap-2 text-sm font-light leading-normal tracking-tight text-ink-100">
            {text.split('\n').map((line, i) =>
              line.trim() === ''
                ? <div key={i} aria-hidden className="h-1.5" />
                : <p key={i}>{line}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-ink/5 p-3">
        {editing ? (
          <div className="flex gap-2">
            <button
              onClick={commitEdit}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-scripts-500/15 px-4 py-2.5 text-[12px] font-medium tracking-tight text-scripts-400 transition-colors hover:bg-scripts-500/25"
            >
              <Check className="h-3.5 w-3.5" /> Done
            </button>
            <button
              onClick={cancelEdit}
              className="flex items-center justify-center gap-2 rounded-full border border-ink/15 px-4 py-2.5 text-[12px] font-medium tracking-tight text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-200"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        ) : showSaveForm ? (
          <div className="flex gap-2">
            <input
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
              placeholder="Script title..."
              autoFocus
              className="flex-1 rounded-full border border-ink/10 bg-transparent px-4 py-2 text-sm text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-scripts-500/30"
            />
            <button
              onClick={handleSave}
              disabled={!saveTitle.trim()}
              className="rounded-full bg-scripts-500/15 px-4 py-2 text-xs font-medium text-scripts-400 transition-colors hover:bg-scripts-500/25 disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={() => setShowSaveForm(false)}
              className="rounded-full px-4 py-2 text-xs text-ink-500 transition-colors hover:text-ink-300"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowSaveForm(true)}
              className={`flex flex-1 min-w-0 items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-[12px] font-medium tracking-tight transition-colors ${
                saved
                  ? 'border-green-500/20 bg-green-500/10 text-green-400 light:text-green-600'
                  : 'border-ink/15 text-ink-300 hover:bg-ink/[0.06] hover:text-ink-100'
              }`}
            >
              {saved ? (<><Check className="h-3.5 w-3.5" /> Saved</>) : (<><Bookmark className="h-3.5 w-3.5" /> Save to Bank</>)}
            </button>
            {isHooks ? (
              // A hook pack has no full-script send target — each line is a
              // different video's opener. Copy per row / save the pack.
              null
            ) : (
              <>
                {isSpokenScript && (
                  <button
                    onClick={handleSendToVoiceStudio}
                    className="flex flex-1 min-w-0 items-center justify-center gap-2 rounded-full border border-voice-500/20 bg-voice-500/10 px-4 py-2.5 text-[12px] font-medium tracking-tight text-voice-400 transition-colors hover:bg-voice-500/20"
                  >
                    <Mic className="h-4 w-4" strokeWidth={1.75} />
                    Send to Voiceovers
                    <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                )}
                <button
                  onClick={handleSendToBrollStudio}
                  className="flex flex-1 min-w-0 items-center justify-center gap-2 rounded-full border border-broll-500/20 bg-broll-500/10 px-4 py-2.5 text-[12px] font-medium tracking-tight text-broll-400 transition-colors hover:bg-broll-500/20"
                >
                  <Film className="h-4 w-4" strokeWidth={1.75} />
                  Send to B-Roll
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
                {!isSpokenScript && (
                  <button
                    onClick={handleSendToPlayground}
                    className="flex flex-1 min-w-0 items-center justify-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-[12px] font-medium tracking-tight text-emerald-400 light:text-emerald-600 transition-colors hover:bg-emerald-500/20"
                  >
                    <ImagePlay className="h-4 w-4" strokeWidth={1.75} />
                    Send to Playground
                    <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// The shared voice spec for a scene blueprint — the same on-camera voice every
// scene's clip should be read in. Rendered once, below the scenes.
function VoiceProfileCard({ body }: { body: string }) {
  const [copied, setCopied] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const handleCopy = async () => {
    const ok = await copyToClipboard(body)
    if (ok) {
      setCopied(true)
      addToast('Voice profile copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } else {
      addToast('Copy failed', 'error')
    }
  }
  return (
    <div className="rounded-2xl border border-scripts-500/15 bg-scripts-500/[0.04] p-3 card-soft-shadow">
      <div className="relative mb-2 flex items-center justify-center gap-2 px-8">
        <span className="flex items-center gap-1.5 text-center text-[10px] font-semibold uppercase tracking-tight text-scripts-300">
          <Mic className="h-3 w-3 text-scripts-300" strokeWidth={2} />
          Voice Profile · same in every scene
        </span>
        <button
          onClick={handleCopy}
          className="absolute right-0 top-1/2 flex -translate-y-1/2 shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-ink-600 transition-colors hover:bg-ink/5 hover:text-ink-300"
        >
          {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="whitespace-pre-wrap rounded-xl bg-surface-0 p-2.5 text-[13px] font-light leading-relaxed tracking-tight text-ink-100">
        {body}
      </div>
    </div>
  )
}

// One hook in the pack — its family chip, the spoken line, and a copy button.
// The copy target is the clean line only (the chip is UI metadata).
function HookLineCard({ hook, index }: { hook: ParsedHook; index: number }) {
  const [copied, setCopied] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const handleCopy = async () => {
    const ok = await copyToClipboard(hook.text)
    if (ok) {
      setCopied(true)
      addToast('Hook copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } else {
      addToast('Copy failed', 'error')
    }
  }
  return (
    <div className="rounded-2xl border border-ink/5 bg-ink/[0.02] p-3 card-soft-shadow">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[10px] font-semibold tabular-nums text-ink-600">{index + 1}</span>
          {hook.category && (
            <span className="truncate rounded-full bg-scripts-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-tight text-scripts-300">
              {HOOK_CATEGORY_META[hook.category].label}
            </span>
          )}
        </span>
        <button
          onClick={handleCopy}
          className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-ink-600 transition-colors hover:bg-ink/5 hover:text-ink-300"
        >
          {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="text-sm font-light leading-normal tracking-tight text-ink-100">{hook.text}</p>
    </div>
  )
}

function SceneChunkCard({ chunk }: { chunk: SceneChunk }) {
  const [copied, setCopied] = useState(false)
  const addToast = useAppStore((s) => s.addToast)
  const handleCopy = async () => {
    const ok = await copyToClipboard(chunk.body)
    if (ok) {
      setCopied(true)
      addToast('Scene copied to clipboard')
      setTimeout(() => setCopied(false), 2000)
    } else {
      addToast('Copy failed', 'error')
    }
  }
  return (
    <div className="rounded-2xl border border-ink/5 bg-ink/[0.02] p-3 card-soft-shadow">
      <div className="relative mb-2 flex items-center justify-center gap-2 px-8">
        <span className="text-center text-[10px] font-semibold uppercase tracking-tight text-scripts-300">
          {chunk.header.replace(/^---\s*|\s*---$/g, '')}
        </span>
        <button
          onClick={handleCopy}
          className="absolute right-0 top-1/2 flex -translate-y-1/2 shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-ink-600 transition-colors hover:bg-ink/5 hover:text-ink-300"
        >
          {copied ? <Check className="h-3 w-3 text-green-400 light:text-green-600" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* Body matches the Write/Remix script output: inherited Geist + white
          (a div, not <pre>, so it doesn't fall back to UA monospace). */}
      <div className="whitespace-pre-wrap rounded-xl bg-surface-0 p-2.5 text-[13px] font-light leading-relaxed tracking-tight text-ink-100">
        {chunk.body}
      </div>
    </div>
  )
}

export default function OutputPanel({ variations, outputAngles, mode, liveMode, writeFormat, writeStyleLabel, hookCategoryLabel, linkedProductId, isGenerating, error, onEditVariation }: OutputPanelProps) {
  // Resolve the linked product so saved scripts get a meaningful default title
  // ("<Product> — Hook-Led Script").
  const products = useBankStore((s) => s.products)
  const product = linkedProductId ? products.find((p) => p.id === linkedProductId) : undefined
  const productName = product?.productName

  // A hooks pack (write mode + 'hooks' format) renders as tagged one-liners.
  const isHooks = mode === 'write' && writeFormat === 'hooks'

  // Take switcher — a 1/2/3 row above the cards that scrolls the matching take
  // into view. `activeTake` tracks which card is currently nearest the top so
  // the row highlights as you scroll, not just on click.
  const scrollRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const [activeTake, setActiveTake] = useState(0)

  // New generation → reset to the first take and the top of the list. Keyed on
  // the takes' *content*, not the array identity — the parent hands down a fresh
  // array every render, so depending on the reference would reset the scroll on
  // every unrelated re-render (including our own click handler's setState).
  const variationsKey = variations.join('')
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setActiveTake(0)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [variationsKey])
  /* eslint-enable react-hooks/set-state-in-effect */

  const scrollToTake = (i: number) => {
    setActiveTake(i)
    const card = cardRefs.current[i]
    const container = scrollRef.current
    if (!card || !container) return
    const top = card.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    container.scrollTo({ top: Math.max(0, top - 20), behavior: 'smooth' })
  }

  const handleScroll = () => {
    const container = scrollRef.current
    if (!container) return
    // At the bottom the trailing cards can't reach the top, so anchor the
    // last take as active; otherwise pick the last card whose top has scrolled
    // past the container's upper edge.
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4
    let idx = variations.length - 1
    if (!atBottom) {
      const cTop = container.getBoundingClientRect().top
      idx = 0
      for (let i = 0; i < variations.length; i++) {
        const card = cardRefs.current[i]
        if (card && card.getBoundingClientRect().top - cTop <= 40) idx = i
      }
    }
    setActiveTake((prev) => (prev === idx ? prev : idx))
  }

  // Empty + loading copy follows the live selector (what you're about to make);
  // the cards themselves follow `mode` (what actually produced them).
  const copyMode = liveMode ?? mode

  if (isGenerating) {
    const message = copyMode === 'write'
      ? (writeFormat === 'hooks'
          ? ['Reading your brief...', 'Digging through the hook library...', `Writing ${HOOK_COUNT} hooks...`, 'Cutting the weak ones...']
          : ['Reading your brief...', 'Writing the takes...', 'Making it sound human...', 'Tightening the hooks...'])
      : copyMode === 'remix'
        ? ['Building the angles...', 'Sending parallel requests...', 'Writing variations...', 'Polishing final drafts...']
        : ['Reading scene blueprint...', 'Mapping product into structure...', 'Rewriting scenes...', 'Preserving structure...']
    return (
      <GridCanvas className="h-full">
        <div className="relative flex h-full flex-col gap-2 p-5">
          <GenerationProgress isActive color="bg-scripts-500" messages={message} showHelper={false} />
          {/* Accent glow while the words are being written — the same "this is
              alive" cue the media apps get on a generating frame. */}
          <div className="flex flex-1 min-h-0 flex-col gap-3 rounded-3xl border border-scripts-500/20 bg-surface-1 p-5 shadow-[0_0_90px_-24px_var(--color-scripts-500)]">
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-[90%]" />
            <div className="skeleton h-4 w-[95%]" />
            <div className="skeleton h-4 w-[70%]" />
            <div className="mt-2 skeleton h-4 w-full" />
            <div className="skeleton h-4 w-[85%]" />
            <div className="skeleton h-4 w-[92%]" />
          </div>
        </div>
      </GridCanvas>
    )
  }

  if (variations.length === 0) {
    return (
      <GridCanvas className="h-full">
        <div className="relative flex h-full flex-col items-center justify-center gap-3 p-8">
          <PenLine className="h-8 w-8 text-ink-800" strokeWidth={1.5} />
          <p className="text-sm text-ink-700">
            {copyMode === 'write'
              ? (writeFormat === 'hooks' ? `Your ${HOOK_COUNT} hooks will appear here` : 'Your takes will appear here')
              : copyMode === 'remix' ? 'Your script variations will appear here' : 'Your scene prompts will appear here'}
          </p>
          {error && (
            <div className="mt-2 flex max-w-sm items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400 light:text-red-600" />
              <p className="text-xs leading-relaxed text-red-300 light:text-red-700">{error}</p>
            </div>
          )}
        </div>
      </GridCanvas>
    )
  }

  // Prefer what the run actually used; fall back to matching by count for rows
  // saved before the angle list was stamped.
  const angles = outputAngles?.length === variations.length
    ? outputAngles
    : remixAnglesForCount(variations.length)
  const takeUnit = mode === 'remix' ? 'Variation' : 'Take'

  // No canvas once the takes are in: the grid marks an empty stage waiting for
  // work, and behind finished output it's just texture under the reading.
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {variations.length > 1 && (
        <div className="flex items-center justify-center border-b border-ink/5 px-5 py-2.5">
          <div className="flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.02] p-0.5">
            {variations.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => scrollToTake(i)}
                aria-label={`Jump to ${takeUnit} ${i + 1}`}
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums transition-colors ${
                  activeTake === i
                    ? 'bg-scripts-500/15 text-scripts-300'
                    : 'text-ink-500 hover:bg-ink/5 hover:text-ink-200'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
      <div ref={scrollRef} onScroll={handleScroll} className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto p-5">
        {variations.map((text, i) => {
          const isRemix = mode === 'remix'
          const isWrite = mode === 'write'
          const angleLabel = isRemix && angles ? REMIX_ANGLE_LABEL[angles[i]] : null
          const cardTitle = isHooks
            ? `Hooks · ${hookCategoryLabel ?? 'Best Mix'}`
            : isWrite
              ? `Take ${i + 1}${writeStyleLabel ? ` · ${writeStyleLabel}` : ''}`
              : angleLabel
                ? `Variation ${i + 1}: ${angleLabel}`
                : isRemix
                  ? `Variation ${i + 1}`
                  : 'Scene prompts'
          const defaultSaveTitle = isHooks
            ? (productName ? `${productName} — Hooks (${hookCategoryLabel ?? 'Best Mix'})` : `Hooks — ${hookCategoryLabel ?? 'Best Mix'}`)
            : isWrite && productName
              ? `${productName} — ${writeStyleLabel ?? 'New'} Take ${i + 1}`
              : isRemix && productName
                ? `${productName} — ${angleLabel ?? `Variation ${i + 1}`} Script`
                : deriveTitleFromContent(
                      text,
                      mode === 'reverse-engineer' ? 'Reverse-engineered prompts' : 'Untitled script',
                    )
          return (
            <VariationCard
              key={i}
              cardRef={(el) => { cardRefs.current[i] = el }}
              text={text}
              cardTitle={cardTitle}
              defaultSaveTitle={defaultSaveTitle}
              linkedProductId={linkedProductId}
              mode={mode}
              isHooks={isHooks}
              onEdit={onEditVariation ? (newText) => onEditVariation(i, newText) : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}

// Derive a human-readable title from reverse-engineered prompt content.
// Strategy: skip scene dividers and label lines, find the first prose
// sentence, take ~6 words, Title Case. Falls back to a sensible default.
function deriveTitleFromContent(text: string, fallback = 'Untitled script'): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    // Skip scene dividers ("--- Scene 1: HOOK ---") and short ALL-CAPS labels
    // ("HOOK", "VISUAL:", "VOICEOVER:").
    if (/^---/.test(line)) continue
    if (/^[A-Z][A-Z\s:]{0,30}:?$/.test(line)) continue
    // Skip lines that are only a bracketed section label, e.g. "[HOOK]".
    if (/^\[[^\]]+\]\s*$/.test(line)) continue
    // Strip leading markers like "[HOOK]", "Visual:", "Voiceover:", "1.", "- ".
    const cleaned = line
      .replace(/^\[[^\]]+\]\s*/, '')
      .replace(/^[*\-•]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/^(visual|voiceover|action|dialogue|shot|scene|hook|cta)\s*[:-]\s*/i, '')
      .trim()
    if (cleaned.length < 6) continue
    const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned
    const words = firstSentence.split(/\s+/).slice(0, 7).join(' ')
    const trimmed = words.replace(/[.,;:!?-]+$/, '').trim()
    if (trimmed.length < 4) continue
    // Title case the first letter only; preserve original casing otherwise.
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  }
  return fallback
}

// Robust clipboard write with a textarea fallback for older browsers / non-
// secure contexts. Returns true if the copy succeeded.
async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
