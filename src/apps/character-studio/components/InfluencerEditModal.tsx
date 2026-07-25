import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, Download, Bookmark, Check, ImagePlus, Wand2, LayoutGrid, Pencil, Upload, FolderOpen, Copy, Maximize2, Coins, Sparkles, Undo2, Redo2 } from 'lucide-react'
import { useBankStore } from '../../../stores/bankStore'
import { useAppStore } from '../../../stores/appStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { getUrl } from '../../../utils/assetStore'
import { downloadImage } from '../../../utils/downloadImage'
import { copyToClipboard } from '../../../utils/clipboard'
import { humanizeError } from '../../../utils/friendlyError'
import type { CharacterHistoryItem, BRoll, AnyBankItem } from '../../../stores/types'
import {
  getModel,
  getDefaultModel,
  estimateCredits,
  formatCredits,
  type AspectRatio,
  type ImageResolution,
} from '../../../utils/models'
import ModelPicker from '../../../components/ModelPicker'
import ConstraintChip from '../../../components/ConstraintChip'
import AspectIcon from '../../../components/AspectIcon'
import SegmentedToggle from '../../../components/SegmentedToggle'
import ModelWaitNotice from '../../../components/ModelWaitNotice'
import BankPicker from '../../../components/BankPicker'
import ExpandTextModal, { ExpandButton } from '../../../components/ExpandableText'
import {
  buildJsonPrompt,
  buildImagePrompt,
  buildSheetPrompt,
  enhanceEditInstruction,
} from '../services/generateCharacter'
import type { InFlightCharacterGen, LaunchGenOptions } from '../types'
import { pickInfluencerName, sheetNameFrom } from './nameGenerator'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import GeneratingTile from './GeneratingTile'
import InfluencerLightbox from './InfluencerLightbox'

// A B-Roll-style editor for an influencer image. Clicking a portrait opens this:
// the left column mirrors the B-Roll card editor — a segmented mode toggle,
// an Image Model picker + constraint chips, references / prompt, and a single
// accent Generate pill. The right column is the per-influencer outputs gallery;
// the highlighted tile is the "cover" every edit / sheet is built from.
//
// Two modes:
//   • Edit Influencer — attach square reference slots + type an edit instruction,
//     re-generate image-to-image off the cover.
//   • Influencer Sheet — image-model options only; builds a reference sheet
//     (turnaround + expressions) from the cover via image-to-image, same face.
// New outputs persist to characterHistory so nothing is lost on close.

type Mode = 'edit' | 'sheet'

// Reference-image cap — mirrors the Playground's 4-slot limit.
const MAX_REFS = 4

interface SessionOutput {
  // The characterHistory id this tile renders — the base image's id, or the new
  // row we stamp on each generation.
  id: string
  imageRef: string
  aspectRatio: string
  kind: 'portrait' | 'sheet'
  // Set once the row has been saved to the Influencers bank — drives the tile's
  // Saved badge straight from the store so it survives a reopen.
  linkedModelId?: string
}

interface UploadedRef {
  // data: URI held in memory (too large for the persisted draft, and the modal
  // is ephemeral anyway).
  url: string
  name: string
}

interface InfluencerEditModalProps {
  item: CharacterHistoryItem
  onClose: () => void
  // Which mode to open in. The gallery's "Make Sheet" action opens straight
  // into 'sheet' so the user just hits Generate; a normal tile click is 'edit'.
  initialMode?: Mode
  // Generations are owned by CharacterStudio, not by this pop-up — the modal
  // only fires the launcher and renders whichever in-flight entries belong to
  // this character's lineage. That's what lets a running edit survive closing
  // and reopening the editor (and a refresh).
  inFlight: InFlightCharacterGen[]
  onLaunchGen: (opts: LaunchGenOptions) => void
  onCancelGen: (id: string) => void
}

function coerceAspect(ar: string): AspectRatio {
  if (ar.includes('16:9')) return '16:9'
  if (ar.includes('1:1')) return '1:1'
  return '9:16'
}

function aspectStyle(ar: string): React.CSSProperties {
  if (ar.includes('16:9')) return { aspectRatio: '16 / 9' }
  if (ar.includes('1:1')) return { aspectRatio: '1 / 1' }
  return { aspectRatio: '9 / 16' }
}

export default function InfluencerEditModal({
  item,
  onClose,
  initialMode = 'edit',
  inFlight,
  onLaunchGen,
  onCancelGen,
}: InfluencerEditModalProps) {
  const addModel = useBankStore((s) => s.addModel)
  const deleteModel = useBankStore((s) => s.deleteModel)
  const updateCharacterHistory = useBankStore((s) => s.updateCharacterHistory)
  const models = useBankStore((s) => s.models)
  const characterHistory = useBankStore((s) => s.characterHistory)
  const addToast = useAppStore((s) => s.addToast)

  // Every generation in this influencer's lineage — the source portrait plus
  // every edit / sheet derived from it. Form rows leave lineageId unset, so the
  // key is the row's own id; derived gens inherit the source's lineageId. This
  // is what makes the strip survive a close + reopen of the editor (the same
  // rows that show in the main gallery).
  const lineageKey = item.lineageId ?? item.id

  const [mode, setMode] = useState<Mode>(initialMode)
  const [promptExpanded, setPromptExpanded] = useState(false)
  // Add-reference affordance: the "+" tile opens a tiny Upload / From bank menu.
  const [refMenuOpen, setRefMenuOpen] = useState(false)
  const [bankPickerOpen, setBankPickerOpen] = useState(false)
  // The reference add-tile menu opens on hover; a short close delay bridges the
  // gap between the tile and the menu so moving onto it doesn't dismiss it.
  const refMenuTimer = useRef<number | null>(null)
  const openRefMenu = () => { if (refMenuTimer.current) window.clearTimeout(refMenuTimer.current); setRefMenuOpen(true) }
  const closeRefMenuSoon = () => { refMenuTimer.current = window.setTimeout(() => setRefMenuOpen(false), 120) }
  // Newest-first so fresh gens land at the top of the strip (mirrors the old
  // prepend behaviour). Falls back to the clicked item if the row isn't in
  // history yet (shouldn't happen — the editor only opens on persisted rows).
  const outputs = useMemo<SessionOutput[]>(() => {
    const rows = characterHistory
      .filter((h) => (h.lineageId ?? h.id) === lineageKey)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((h) => ({
        id: h.id,
        imageRef: h.imageRef,
        aspectRatio: h.aspectRatio,
        kind: h.kind ?? 'portrait',
        linkedModelId: h.linkedModelId,
      }))
    return rows.length > 0
      ? rows
      : [{ id: item.id, imageRef: item.imageRef, aspectRatio: item.aspectRatio, kind: item.kind ?? 'portrait' }]
  }, [characterHistory, lineageKey, item])
  const [selectedId, setSelectedId] = useState(item.id)
  const [prompt, setPrompt] = useState('')
  // Edit-instruction enhance + undo/redo (mirrors the Scripts / Playground
  // prompt controls). History is local to the open modal; a committed entry is
  // pushed on blur so undo steps through coherent chunks, not keystrokes.
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [promptHistory, setPromptHistory] = useState<string[]>([''])
  const [promptIndex, setPromptIndex] = useState(0)
  const canUndoPrompt = promptIndex > 0
  const canRedoPrompt = promptIndex < promptHistory.length - 1
  const [refs, setRefs] = useState<UploadedRef[]>([])
  // In-flight gens started from this editor. Derived from the app-level list, so
  // reopening the modal mid-generation shows the tile again instead of losing it.
  const lineageInFlight = useMemo(
    () => inFlight.filter((g) => g.lineageId === lineageKey),
    [inFlight, lineageKey],
  )
  const generating = lineageInFlight.length > 0
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const selected = outputs.find((o) => o.id === selectedId) ?? outputs[0]
  const selectedUrl = useAssetUrl(selected?.imageRef)

  // The influencer's display name for the sheet-mode reference card. Prefer the
  // bank name when this generation is saved; otherwise a stable generated one
  // (matches how the gallery names an influencer at save time).
  const linkedModelName = item.linkedModelId ? models.find((m) => m.id === item.linkedModelId)?.name : undefined
  const fallbackName = useMemo(() => pickInfluencerName(item.profile.gender), [item.id])
  // Prefer the lineage's source-portrait name so a sheet saved off it inherits
  // that influencer's name (not this row's, which may itself be a sheet).
  const lineagePortrait = characterHistory.find((h) => h.id === lineageKey && h.kind !== 'sheet')
  const lineageModelName = lineagePortrait?.linkedModelId
    ? models.find((m) => m.id === lineagePortrait.linkedModelId)?.name
    : undefined
  const influencerName = lineageModelName ?? linkedModelName ?? fallbackName

  // The Image Model the picker resolves to (same persisted key the form uses),
  // so its constraint chips and credit estimate stay in sync with the picker.
  const persistedImageModel = useSettingsStore((s) => s.getAppModel('character-studio:image:text-to-image'))
  const imageModelId = persistedImageModel ?? getDefaultModel('character-studio', 'image', 'text-to-image')?.id
  const imageConstraints = imageModelId ? getModel(imageModelId)?.imageConstraints : undefined
  const resolutionOptions = (imageConstraints?.resolutions ?? []) as string[]
  const aspectOptions = imageConstraints?.aspectRatios ?? []
  // A sheet only makes sense in a turnaround (16:9) or stacked (9:16) layout.
  const sheetAspectOptions: string[] = aspectOptions.filter((a) => a === '16:9' || a === '9:16')

  // Resolution is shared across modes; flipping to Sheet bumps to a crisp tier
  // (sheets pack many panels into one frame) and flipping back restores it. The
  // sheet tier mirrors the main form — 4K when the model offers it, else its
  // highest available resolution.
  const itemResolution = (item.resolution as ImageResolution) ?? '1K'
  const sheetResolution = (resolutionOptions.includes('4K')
    ? '4K'
    : resolutionOptions[resolutionOptions.length - 1] ?? '4K') as ImageResolution
  const [resolution, setResolution] = useState<ImageResolution>(initialMode === 'sheet' ? sheetResolution : itemResolution)
  const [preSheetResolution, setPreSheetResolution] = useState<ImageResolution>(itemResolution)
  // Aspect is per-mode: edits keep the source framing; sheets pick an orientation.
  const [editAspect, setEditAspect] = useState<string>(coerceAspect(item.aspectRatio))
  const [sheetAspect, setSheetAspect] = useState<string>('16:9')

  // Clamp the per-mode settings to whatever the chosen model supports when the
  // user swaps models (mirrors the B-Roll card editor).
  useEffect(() => {
    if (!imageConstraints) return
    if (resolutionOptions.length > 0 && !resolutionOptions.includes(resolution)) {
      setResolution(resolutionOptions[0] as ImageResolution)
    }
    if (aspectOptions.length > 0 && !aspectOptions.includes(editAspect)) {
      setEditAspect(aspectOptions[0])
    }
    if (sheetAspectOptions.length > 0 && !sheetAspectOptions.includes(sheetAspect)) {
      setSheetAspect(sheetAspectOptions[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageModelId])

  function handleModeChange(next: Mode) {
    if (next === mode) return
    if (next === 'sheet') {
      setPreSheetResolution(resolution)
      setResolution(sheetResolution)
    } else {
      setResolution(preSheetResolution)
    }
    setMode(next)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Closing mid-generation is safe — the job lives on CharacterStudio and keeps
  // running (visible in the main gallery, and back here on reopen).
  useCloseOnAppSwitch(true, onClose)

  function handlePickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setRefs((prev) => (prev.length >= MAX_REFS ? prev : [...prev, { url: reader.result as string, name: file.name }]))
        }
      }
      reader.readAsDataURL(file)
    }
  }

  // Add a reference from the bank — pull the image ref + a label off whichever
  // bank item the user picked (product / influencer / b-roll still). hostReference
  // in the service resolves asset:// refs at gen time, so we store the ref as-is.
  function handlePickFromBank(item: AnyBankItem) {
    let url: string | undefined
    let name = 'Reference'
    if ('productImage' in item) { url = item.productImage; name = item.productName }
    else if ('characterImage' in item) { url = item.sheetImage || item.characterImage; name = item.name }
    else if ('imageUrl' in item) { url = (item as BRoll).imageUrl; name = (item as BRoll).prompt || 'B-Roll' }
    if (url) setRefs((prev) => (prev.length >= MAX_REFS ? prev : [...prev, { url: url as string, name }]))
  }

  // A finished gen becomes the new cover, the way it did when this modal owned
  // the generation itself. The row arrives through the store (CharacterStudio
  // writes it), so we watch the head of the strip and select anything new. The
  // first run only records what was already there — opening the editor must not
  // hijack the tile the user clicked.
  const newestSeenRef = useRef<string | null>(null)
  useEffect(() => {
    const newest = outputs[0]?.id
    if (!newest) return
    if (newestSeenRef.current === null) { newestSeenRef.current = newest; return }
    if (newest !== newestSeenRef.current) {
      newestSeenRef.current = newest
      setSelectedId(newest)
    }
  }, [outputs])

  // Push a committed value onto the prompt history (truncating any redo tail).
  function pushPromptHistory(next: string, base = promptHistory, baseIndex = promptIndex) {
    const nextHistory = [...base.slice(0, baseIndex + 1), next]
    setPromptHistory(nextHistory)
    setPromptIndex(nextHistory.length - 1)
    setPrompt(next)
  }
  // Commit the current typed draft into history (fired on blur). No-op when it
  // already matches the latest entry.
  function commitPromptDraft() {
    if (prompt !== promptHistory[promptIndex]) pushPromptHistory(prompt)
  }
  function handlePromptUndo() {
    if (promptIndex <= 0) return
    const i = promptIndex - 1
    setPromptIndex(i)
    setPrompt(promptHistory[i])
  }
  function handlePromptRedo() {
    if (promptIndex >= promptHistory.length - 1) return
    const i = promptIndex + 1
    setPromptIndex(i)
    setPrompt(promptHistory[i])
  }
  async function handleEnhancePrompt() {
    if (isEnhancing || !prompt.trim()) return
    // Fold any uncommitted typed draft into history first so Undo returns to
    // exactly what the user had before enhancing.
    const committed = prompt !== promptHistory[promptIndex]
      ? [...promptHistory.slice(0, promptIndex + 1), prompt]
      : promptHistory.slice(0, promptIndex + 1)
    setIsEnhancing(true)
    try {
      const rewritten = await enhanceEditInstruction(prompt)
      pushPromptHistory(rewritten, committed, committed.length - 1)
    } catch (err) {
      addToast(humanizeError(err, 'Enhance failed.'), 'error')
    } finally {
      setIsEnhancing(false)
    }
  }

  function handleEdit() {
    const instruction = prompt.trim()
    if (!instruction || generating || !selected) return
    onLaunchGen({
      profile: item.profile,
      resolution,
      kind: 'portrait',
      aspect: coerceAspect(editAspect),
      lineageId: lineageKey,
      edit: {
        instruction,
        baseImageRef: selected.imageRef,
        referenceUrls: refs.map((r) => r.url),
      },
    })
    // Clear the box for the next instruction, but park the fired one in history
    // so Undo brings it straight back.
    const committed = prompt !== promptHistory[promptIndex]
      ? [...promptHistory.slice(0, promptIndex + 1), prompt]
      : promptHistory.slice(0, promptIndex + 1)
    pushPromptHistory('', committed, committed.length - 1)
  }

  function handleSheet() {
    if (generating || !selected) return
    // Image-to-image off the cover so the sheet keeps the exact same person —
    // startCharacterTask swaps to an i2i model and leads with an identity lock.
    onLaunchGen({
      profile: item.profile,
      resolution,
      kind: 'sheet',
      aspect: sheetAspect,
      referenceUrl: selected.imageRef,
      lineageId: lineageKey,
    })
  }

  // Suggested name when opening the inline save input — sheets file next to
  // their source portrait ("<influencer> - Influencer Sheet"); a fresh portrait
  // gets a fresh generated name. Mirrors the main gallery's save flow.
  function suggestSaveName(output: SessionOutput): string {
    return output.kind === 'sheet'
      ? sheetNameFrom(influencerName)
      : pickInfluencerName(item.profile.gender)
  }

  async function handleSave(output: SessionOutput, rawName: string) {
    const name = rawName.trim()
    if (!name || savingId || savedIds.has(output.id) || output.linkedModelId) return
    setSavingId(output.id)
    try {
      await addModel({
        name,
        characterImage: output.imageRef,
        // A saved sheet doubles as its own reference, so stamp it as sheetImage
        // too — downstream apps prefer it for consistency.
        ...(output.kind === 'sheet' ? { sheetImage: output.imageRef } : {}),
        notes: '',
        source: 'character-studio',
        jsonProfile: buildJsonPrompt(item.profile) as Record<string, unknown>,
      })
      // Link back to the history row (base or persisted gen) so the main
      // gallery shows the saved badge too.
      const justAdded = useBankStore.getState().models.find(
        (m) => m.characterImage === output.imageRef && m.name === name,
      )
      if (justAdded) await updateCharacterHistory(output.id, { linkedModelId: justAdded.id })
      setSavedIds((prev) => new Set(prev).add(output.id))
      addToast(`Saved to bank as ${name}`, 'success')
    } catch (err) {
      addToast(humanizeError(err, 'Save failed'), 'error')
    } finally {
      setSavingId(null)
    }
  }

  // Toggle off: remove the linked Bank entry (keeping this output) so it can be
  // re-saved + renamed afterwards. Mirrors the gallery tile's unsave.
  async function handleUnsave(output: SessionOutput) {
    if (savingId) return
    setSavingId(output.id)
    try {
      if (output.linkedModelId) await deleteModel(output.linkedModelId)
      await updateCharacterHistory(output.id, { linkedModelId: undefined })
      setSavedIds((prev) => { const next = new Set(prev); next.delete(output.id); return next })
      addToast('Removed from bank', 'success')
    } catch (err) {
      addToast(humanizeError(err, 'Failed to remove from Bank'), 'error')
    } finally {
      setSavingId(null)
    }
  }

  async function handleDownload(output: SessionOutput) {
    const url = await getUrl(output.imageRef)
    if (url) await downloadImage(url, `${output.kind === 'sheet' ? 'character-sheet' : 'character'}-${output.id}`)
  }

  const creditsLabel = imageModelId
    ? formatCredits(estimateCredits(imageModelId, { imageCount: 1, resolution }))
    : null

  const modal = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Floating close — anchored to the screen corner (like every other
          pop-up) so it never overlaps an output tile. */}
      <button
        type="button"
        onClick={onClose}
        title="Close (Esc)"
        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white transition-colors hover:bg-black/60"
      >
        <X className="h-4 w-4" />
      </button>

      <div
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-ink/10 bg-surface-0 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Body — 50/50 grid; each column scrolls. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-2">
          {/* LEFT — scrollable body (model + refs/prompt) over a pinned footer
              (output settings + Generate), mirroring the Playground panel. */}
          <div className="col-span-1 flex min-h-0 flex-col border-b border-ink/5 md:border-b-0 md:border-r">
            {/* Scrollable body */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="flex grow flex-col gap-3 px-5 pb-6 pt-5">
              {/* Edit Influencer / Influencer Sheet — full-width segmented
                  toggle. Slim (h-10 !p-1) to match the Playground mode toggle. */}
              <SegmentedToggle<Mode>
                className="h-10 !p-1"
                value={mode}
                onChange={handleModeChange}
                accent="influencers"
                options={[
                  { value: 'edit', label: 'Edit Character', icon: Pencil },
                  { value: 'sheet', label: 'Character Sheet', icon: LayoutGrid },
                ]}
              />

              {/* Separator between the toggle and the controls below. */}
              <div className="-mt-1 border-b border-ink/5" />

              {mode === 'edit' ? (
                <>
                  {/* Reference images — Playground-style: picked thumbnails in a
                      four-up strip above a full-width dashed add card (Optional
                      badge left, count right, centered icon + label). */}
                  <div>
                    {refs.length > 0 && (
                      <div className="mb-2 grid grid-cols-4 gap-2">
                        {refs.map((r, i) => (
                          <div key={i} className="relative aspect-square w-full overflow-hidden rounded-xl border border-ink/10 bg-ink/[0.02]">
                            <img src={r.url} alt="" className="h-full w-full object-cover" />
                            <button
                              type="button"
                              title="Remove"
                              onClick={() => setRefs((prev) => prev.filter((_, idx) => idx !== i))}
                              className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white/80 transition-colors hover:bg-black/90"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="relative" onMouseEnter={openRefMenu} onMouseLeave={closeRefMenuSoon}>
                      <button
                        type="button"
                        disabled={refs.length >= MAX_REFS}
                        onClick={() => { if (refs.length < MAX_REFS) setRefMenuOpen((v) => !v) }}
                        className={`group relative flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-ink/15 bg-ink/[0.02] transition-colors ${
                          refs.length >= MAX_REFS ? 'cursor-not-allowed opacity-50' : 'hover:border-ink/25 hover:bg-ink/[0.04]'
                        }`}
                      >
                        <span className="absolute left-2 top-2 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[9px] font-medium capitalize tracking-tight text-ink-500">
                          Optional
                        </span>
                        <span className="absolute right-2 top-2 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[9px] font-medium tabular-nums tracking-tight text-ink-500">
                          {refs.length}/{MAX_REFS}
                        </span>
                        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ink/15 bg-ink/[0.03] text-ink-400 transition-colors group-hover:text-ink-200">
                          <ImagePlus className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-[12px] font-normal text-ink-500">Reference images</span>
                      </button>
                      {refMenuOpen && refs.length < MAX_REFS && (
                        <div
                          className="absolute left-0 top-full z-[62] mt-1 w-40 overflow-hidden rounded-xl border border-ink/10 bg-surface-2/95 p-1 shadow-xl backdrop-blur-xl"
                          onMouseEnter={openRefMenu}
                          onMouseLeave={closeRefMenuSoon}
                        >
                          <button
                            type="button"
                            onClick={() => { setRefMenuOpen(false); fileInputRef.current?.click() }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-ink-300 transition-colors hover:bg-ink/[0.06]"
                          >
                            <Upload className="h-3.5 w-3.5" />
                            Upload Image
                          </button>
                          <button
                            type="button"
                            onClick={() => { setRefMenuOpen(false); setBankPickerOpen(true) }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-ink-300 transition-colors hover:bg-ink/[0.06]"
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                            Pick from Bank
                          </button>
                        </div>
                      )}
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePickFiles} />
                  </div>

                  {/* Edit instruction — grows to absorb leftover height.
                      Textarea + a footer toolbar (Expand) inside one rounded
                      box, matching the Playground prompt field. */}
                  <div className="flex grow flex-col">
                    <div className="relative flex grow flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.03] transition-colors focus-within:border-ink/20 focus-within:bg-ink/[0.05]">
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onBlur={commitPromptDraft}
                        rows={4}
                        placeholder="Describe the change — e.g. 'change the top to a red hoodie', 'add round glasses', 'softer warm lighting'…"
                        className="relative min-h-[120px] w-full grow resize-none border-0 bg-transparent px-3.5 pb-3 pt-3 text-[13px] leading-[1.5] text-ink-200 placeholder-ink-600 outline-none"
                      />
                      {/* Footer toolbar — Enhance + Undo/Redo bottom-left;
                          Expand bottom-right, under a hairline (mirrors the
                          Playground prompt field). */}
                      <div className="flex items-center justify-between gap-2 border-t border-ink/10 px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            title="Enhance prompt"
                            onClick={handleEnhancePrompt}
                            disabled={isEnhancing || !prompt.trim()}
                            className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium text-ink-400 transition-colors hover:bg-influencers-500/10 hover:text-influencers-300 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isEnhancing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                            Enhance Prompt
                          </button>
                          <button
                            type="button"
                            title="Undo"
                            onClick={handlePromptUndo}
                            disabled={!canUndoPrompt || isEnhancing}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Undo2 className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            title="Redo"
                            onClick={handlePromptRedo}
                            disabled={!canRedoPrompt || isEnhancing}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Redo2 className="h-3 w-3" />
                          </button>
                        </div>
                        <ExpandButton onClick={() => setPromptExpanded(true)} />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* Sheet mode — no prompt; the sheet is built from the source. */
                <div className="flex grow flex-col">
                  <span className="text-sm font-medium text-ink-200">Reference character</span>
                  <div className="mt-2 flex items-center gap-3 rounded-full border border-ink/10 bg-ink/[0.02] px-3 py-2">
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-ink/10 bg-black">
                      {selectedUrl
                        ? <img src={selectedUrl} alt="" className="h-full w-full object-cover" />
                        : <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-ink-500" /></div>}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-ink-100">{influencerName}</p>
                      <p className="text-[11px] text-ink-500">Character</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
                    Builds a turnaround + expressions sheet from this character — same face, neutral studio background. Pick a different output on the right to change the source.
                  </p>
                </div>
              )}

            </div>
            </div>

            {/* Pinned footer — output settings (resolution / aspect) just above
                the Generate button, separated by a hairline. Matches the
                Playground panel's sticky footer; chips open upward. */}
            <div className="shrink-0 border-t border-ink/5 px-5 py-4">
              {/* Image Model picker — sits just above the resolution/aspect row
                  (mirrors the main Influencers footer); the picker auto-opens
                  upward this close to the footer. */}
              <div className="mb-3">
                <ModelPicker
                  appId="character-studio"
                  task="image"
                  mode="text-to-image"
                  large
                />
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {resolutionOptions.length > 0 && (
                  <ConstraintChip
                    grow
                    size="sm"
                    openDirection="up"
                    options={resolutionOptions}
                    value={resolution}
                    onChange={(v) => setResolution(v as ImageResolution)}
                    renderOption={(v) => {
                      const credits = formatCredits(estimateCredits(imageModelId ?? '', { imageCount: 1, resolution: v as ImageResolution }))
                      return (
                        <span className="flex w-full items-center justify-between gap-6">
                          <span>{v}</span>
                          {credits && <span className="text-ink-500">{credits}</span>}
                        </span>
                      )
                    }}
                  />
                )}
                {mode === 'edit'
                  ? aspectOptions.length > 0 && (
                      <ConstraintChip
                        grow
                        size="sm"
                        openDirection="up"
                        options={aspectOptions}
                        value={editAspect}
                        onChange={setEditAspect}
                        render={(v) => (
                          <span className="flex items-center gap-1.5">
                            <AspectIcon ratio={v} />
                            <span>{v}</span>
                          </span>
                        )}
                      />
                    )
                  : sheetAspectOptions.length > 0 && (
                      <ConstraintChip
                        grow
                        size="sm"
                        openDirection="up"
                        options={sheetAspectOptions}
                        value={sheetAspect}
                        onChange={setSheetAspect}
                        render={(v) => (
                          <span className="flex items-center gap-1.5">
                            <AspectIcon ratio={v} />
                            <span>{v}</span>
                          </span>
                        )}
                      />
                    )}
              </div>

              {/* Generate — single accent pill (edit / sheet). */}
              {mode === 'edit' ? (
                <button
                  type="button"
                  onClick={handleEdit}
                  disabled={!prompt.trim() || generating || !selected}
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-influencers-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all hover:bg-influencers-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  {generating ? 'Generating edit…' : 'Generate Edit'}
                  {!generating && creditsLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
                      <Coins className="h-3 w-3" strokeWidth={2} />
                      {creditsLabel}
                    </span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSheet}
                  disabled={generating || !selected}
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-influencers-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all hover:bg-influencers-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutGrid className="h-4 w-4" />}
                  {generating ? 'Generating character sheet…' : 'Generate Character Sheet'}
                  {!generating && creditsLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
                      <Coins className="h-3 w-3" strokeWidth={2} />
                      {creditsLabel}
                    </span>
                  )}
                </button>
              )}
              <ModelWaitNotice modelId={imageModelId} className="mt-2" />
            </div>
          </div>

          {/* RIGHT — outputs gallery: portraits pack 2-up (bigger source preview);
              landscapes span the row. */}
          <div className="col-span-1 flex min-h-0 flex-col overflow-y-auto">
            <div className="px-4 py-4">
              <div className="grid grid-cols-2 gap-2 [grid-auto-flow:dense]">
                {lineageInFlight.map((gen) => (
                  <div key={gen.id} className={gen.aspectRatio.includes('16:9') ? 'col-span-2' : ''}>
                    <GeneratingTile
                      modelId={gen.modelId}
                      kind={gen.kind}
                      aspectRatio={gen.aspectRatio}
                      onCancel={() => onCancelGen(gen.id)}
                    />
                  </div>
                ))}
                {outputs.map((o) => (
                  <OutputTile
                    key={o.id}
                    output={o}
                    selected={o.id === selectedId}
                    saved={savedIds.has(o.id) || !!o.linkedModelId}
                    saving={savingId === o.id}
                    promptText={o.kind === 'sheet' ? buildSheetPrompt(item.profile, o.aspectRatio) : buildImagePrompt(item.profile)}
                    suggestName={() => suggestSaveName(o)}
                    onSelect={() => setSelectedId(o.id)}
                    onSave={(name) => handleSave(o, name)}
                    onUnsave={() => handleUnsave(o)}
                    onDownload={() => handleDownload(o)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  // BankPicker + ExpandTextModal portal to <body> themselves; rendering them as
  // SIBLINGS of the overlay (not children) keeps their clicks from bubbling
  // through the React tree to the overlay's close-on-click handler.
  return createPortal(
    <>
      {modal}
      <BankPicker
        bankType="products"
        isOpen={bankPickerOpen}
        onClose={() => setBankPickerOpen(false)}
        onSelect={handlePickFromBank}
        tabs={['products', 'models', { type: 'brolls', filter: (it) => !!(it as BRoll).imageUrl }]}
      />
      <ExpandTextModal
        open={promptExpanded}
        onClose={() => { commitPromptDraft(); setPromptExpanded(false) }}
        value={prompt}
        onChange={setPrompt}
        title="Edit instruction"
        placeholder="Describe the change — e.g. 'change the top to a red hoodie', 'add round glasses', 'softer warm lighting'…"
        accent="ink"
      />
    </>,
    document.body,
  )
}

function OutputTile({
  output,
  selected,
  saved,
  saving,
  promptText,
  suggestName,
  onSelect,
  onSave,
  onUnsave,
  onDownload,
}: {
  output: SessionOutput
  selected: boolean
  saved: boolean
  saving: boolean
  promptText: string
  suggestName: () => string
  onSelect: () => void
  onSave: (name: string) => void
  onUnsave: () => void
  onDownload: () => void
}) {
  const url = useAssetUrl(output.imageRef)
  const [copied, setCopied] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  // Inline naming: clicking Save on an unsaved tile opens a name input over the
  // bottom edge (mirrors the main gallery tile) so the user names it before it
  // lands in the bank. null = closed.
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (nameDraft !== null) {
      const id = window.setTimeout(() => nameInputRef.current?.focus(), 0)
      return () => window.clearTimeout(id)
    }
  }, [nameDraft])

  // Save button is a toggle: saved → remove from bank; unsaved → open the name
  // input. Matches the gallery tile's behaviour.
  function handleSaveClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (saving) return
    if (saved) { onUnsave(); return }
    setNameDraft(suggestName())
  }
  function commitSave() {
    const name = (nameDraft ?? '').trim()
    if (!name || saving) return
    onSave(name)
    setNameDraft(null)
  }

  const handleCopyPrompt = async () => {
    if (await copyToClipboard(promptText)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }
  // Landscape outputs (sheets / 16:9 portraits) span the full row; portraits
  // pack two to a row.
  const isWide = output.aspectRatio.includes('16:9')
  return (
    <div
      onClick={onSelect}
      className={`group relative cursor-pointer overflow-hidden rounded-lg bg-black light:bg-zinc-200 transition-all card-soft-shadow ${
        isWide ? 'col-span-2' : ''
      } ${
        selected ? 'ring-2 ring-influencers-500/60' : 'hover:-translate-y-px'
      }`}
    >
      {url
        ? <img src={url} alt="" className="block h-auto w-full" />
        : <div className="flex w-full items-center justify-center" style={aspectStyle(output.aspectRatio)}><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>}

      {output.kind === 'sheet' && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-medium text-zinc-200 backdrop-blur">
          <LayoutGrid className="h-3 w-3" strokeWidth={2} />
          Sheet
        </span>
      )}

      {selected && (
        <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-influencers-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur">
          Source
        </span>
      )}

      {/* Bottom-left: view full screen. Hidden while naming so the input owns
          the bottom edge. */}
      <div className={`absolute bottom-1.5 left-1.5 flex items-center gap-1 transition-opacity ${nameDraft !== null ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover:opacity-100'}`}>
        <TileButton title="View full screen" onClick={(e) => { e.stopPropagation(); setLightboxOpen(true) }}>
          <Maximize2 className="h-4 w-4" />
        </TileButton>
      </div>

      {/* Hover actions: Copy Prompt · Save to Bank · Download. Hidden while
          naming so the input owns the bottom edge. */}
      <div className={`absolute bottom-1.5 right-1.5 flex items-center gap-1 transition-opacity ${nameDraft !== null ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover:opacity-100'}`}>
        <TileButton
          title={copied ? 'Prompt copied' : 'Copy Prompt'}
          tone={copied ? 'saved' : 'default'}
          onClick={(e) => { e.stopPropagation(); void handleCopyPrompt() }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </TileButton>
        <TileButton
          title={saved ? 'Saved — click to remove from Bank' : saving ? 'Saving…' : 'Save to Bank'}
          tone={saved ? 'saved' : 'default'}
          onClick={handleSaveClick}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
        </TileButton>
        <TileButton title="Download image" onClick={(e) => { e.stopPropagation(); onDownload() }}>
          <Download className="h-4 w-4" />
        </TileButton>
      </div>

      {/* Inline name input — takes over the bottom edge while naming a save
          (mirrors the main gallery tile). */}
      {nameDraft !== null && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-2 bottom-2 flex items-center gap-1 rounded-full border border-white/15 bg-black/70 py-1 pl-2.5 pr-1 backdrop-blur"
        >
          <input
            ref={nameInputRef}
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitSave() }
              if (e.key === 'Escape') { e.preventDefault(); setNameDraft(null) }
            }}
            placeholder="Name this character"
            disabled={saving}
            className="min-w-0 flex-1 bg-transparent text-[11px] font-medium text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            title="Cancel"
            onClick={() => setNameDraft(null)}
            disabled={saving}
            className="flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
          >
            <X className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Save"
            onClick={commitSave}
            disabled={saving || !nameDraft.trim()}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/80 text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          </button>
        </div>
      )}

      {lightboxOpen && (
        <InfluencerLightbox
          imageRef={output.imageRef}
          prompt={promptText}
          isSheet={output.kind === 'sheet'}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  )
}

function TileButton({
  children,
  onClick,
  title,
  tone = 'default',
}: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
  title: string
  tone?: 'default' | 'saved'
}) {
  const toneClass = tone === 'saved'
    ? 'border-emerald-400/50 bg-emerald-500/45 text-emerald-100'
    : 'border-white/20 bg-black/55 text-white hover:bg-black/70'
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${toneClass}`}
    >
      {children}
    </button>
  )
}
