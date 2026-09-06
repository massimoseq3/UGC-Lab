import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, Bookmark, Check, Wand2, LayoutGrid, Pencil, Upload, FolderOpen, Copy, Maximize2, Coins, Palette, ChevronRight, Layers, Eraser } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import { MenuSurface, MenuItem } from '../../../components/Menu'
import DayPill from '../../../components/DayPill'
import { sectionLabel, groupByDay } from '../../../utils/history'
import SectionCard, { SectionLabel } from '../../../components/SectionCard'
import { ImageTile, AddTile } from '../../../components/video/refInputParts'
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
import BankPicker from '../../../components/BankPicker'
import ExpandTextModal from '../../../components/ExpandableText'
import PromptToolbar from '../../../components/PromptToolbar'
import { TileActionStack, TileActionButton } from '../../../components/tileActions'
import {
  buildJsonPrompt,
  buildImagePrompt,
  buildSheetPrompt,
  enhanceEditInstruction,
} from '../services/generateCharacter'
import type { InFlightCharacterGen, LaunchGenOptions } from '../types'
import { pickInfluencerName, sheetNameFrom, uniqueBankName, variantNameFrom } from './nameGenerator'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import StyleModal, { type StyleSelection } from '../../../components/StyleModal'
import { INFLUENCERS_STYLE_ACCENT } from '../../../components/styleArt'
import { analyzeStyleReferences, getContinuousStyle, styleBriefForStill } from '../../../utils/visualStyle'
import { fileToDataUri } from '../../../utils/kie'
import { usePersistedState } from '../../../hooks/usePersistedState'
import GeneratingTile from './GeneratingTile'
import InfluencerLightbox from './InfluencerLightbox'
import { useBackdropClose } from '../../../hooks/useBackdropClose'

// A B-Roll-style editor for an influencer image. Clicking a portrait opens this:
// the left column mirrors the B-Roll card editor — references, visual style and
// an instruction over a pinned footer (mode, Image Model picker, constraint
// chips, and a single accent Generate pill). The right column is the
// per-influencer outputs gallery; the highlighted tile is the "cover" every
// edit / sheet is built from.
//
// The footer's mode toggle picks the OUTPUT KIND only — it does not swap the
// panel:
//   • Edit Character — a new portrait, image-to-image off the cover.
//   • Character Sheet — a reference sheet (turnaround + expressions) off the
//     same cover, same face.
// Both read the same references / visual style / instruction, so flipping the
// toggle re-renders what you already set up in the other form rather than
// throwing it away. New outputs persist to characterHistory so nothing is lost
// on close.

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
  // When the row was made — day-groups this gallery under the same `DayPill`
  // the main gallery uses, so a lineage that spans a week reads as one.
  createdAt: number
  // The visual style this output was rendered in, when one was picked — used to
  // name it on save ("Mia - Claymation").
  styleName?: string
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
  // history yet.
  const outputs = useMemo<SessionOutput[]>(() => {
    const rows = characterHistory
      .filter((h) => (h.lineageId ?? h.id) === lineageKey)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((h) => ({
        id: h.id,
        imageRef: h.imageRef,
        aspectRatio: h.aspectRatio,
        kind: h.kind ?? 'portrait',
        styleName: h.styleName,
        linkedModelId: h.linkedModelId,
        createdAt: h.createdAt,
      }))
    if (rows.length > 0) return rows
    // The editor can be opened on a generation that is still running (clicking
    // an in-flight tile), and that has no row and no image yet. Return NOTHING
    // rather than a synthetic entry: its imageRef would be empty, so the tile
    // would spin forever and Generate would fire with no base image. The
    // in-flight tiles below are what's on screen until the row appears — and it
    // appears under this same id, because finishGen writes the row with the
    // generation's own id.
    return item.imageRef
      ? [{ id: item.id, imageRef: item.imageRef, aspectRatio: item.aspectRatio, kind: item.kind ?? 'portrait', styleName: item.styleName, createdAt: item.createdAt }]
      : []
  }, [characterHistory, lineageKey, item])
  // Same day grouping the main gallery uses — one lineage can span weeks of
  // edits, and until now the strip gave no clue which of these you made today.
  const outputDayGroups = useMemo(() => groupByDay(outputs, (o) => o.createdAt), [outputs])
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

  // ── Visual style ───────────────────────────────────────────────
  // An optional restyle applied on top of the typed instruction: pick a look and
  // the edit re-renders the character in it. Characters are GENERATED as UGC
  // Realism (the form has no style control on purpose — see CLAUDE.md); this is
  // where you take a finished portrait somewhere else, the same way the
  // Playground's preset row reshapes a prompt.
  //
  // Persisted app-wide, not per character, so a run of restyles keeps the look.
  const [styleId, setStyleId] = usePersistedState<string>('character-studio:editStyle', 'ugc')
  const [styleBrief, setStyleBrief] = usePersistedState<string | null>('character-studio:editStyleBrief', null)
  const [styleBankId, setStyleBankId] = usePersistedState<string | null>('character-studio:editStyleBankId', null)
  const [styleName, setStyleName] = usePersistedState<string | null>('character-studio:editStyleName', null)
  const [styleRefs, setStyleRefs] = useState<string[]>([])
  const [isAnalyzingStyle, setIsAnalyzingStyle] = useState(false)
  const [styleModalOpen, setStyleModalOpen] = useState(false)

  // null when the pick is UGC Realism — the look characters are already in, so
  // there is nothing to add to the instruction.
  const styleDirective = styleBriefForStill({ styleId, styleBrief: styleBrief ?? undefined })
  const styleActive = !!styleDirective
  const styleLabel = styleBrief ? (styleName ?? 'Custom style') : getContinuousStyle(styleId).label

  const handlePickPresetStyle = (id: string) => {
    setStyleId(id); setStyleBrief(null); setStyleBankId(null); setStyleName(null)
  }
  const handleUseCustomStyle = (sel: StyleSelection) => {
    setStyleBrief(sel.brief); setStyleName(sel.name); setStyleBankId(sel.bankId)
  }
  const handleClearStyle = () => {
    setStyleId('ugc'); setStyleBrief(null); setStyleBankId(null); setStyleName(null)
  }
  const handleAddStyleRefs = async (files: File[]) => {
    const room = 4 - styleRefs.length
    if (room <= 0) return
    const dataUris = await Promise.all(files.slice(0, room).map((f) => fileToDataUri(f)))
    setStyleRefs((prev) => [...prev, ...dataUris].slice(0, 4))
  }
  const handleAnalyzeStyleRefs = async (): Promise<string | null> => {
    if (styleRefs.length === 0 || isAnalyzingStyle) return null
    if (!useSettingsStore.getState().kieApiKey) {
      useAppStore.getState().addToast('Add your kie.ai key in Settings to analyze a reference style', 'info')
      return null
    }
    setIsAnalyzingStyle(true)
    try {
      return await analyzeStyleReferences(styleRefs)
    } catch (err) {
      useAppStore.getState().addToast(humanizeError(err, 'Could not read the style from those images.'), 'error')
      return null
    } finally {
      setIsAnalyzingStyle(false)
    }
  }
  // In-flight gens started from this editor. Derived from the app-level list, so
  // reopening the modal mid-generation shows the tile again instead of losing it.
  // A gen fired from the main form carries no lineageId — its own id IS its
  // lineage key, which is the same rule `outputs` reads history rows with.
  // Matching both is what lets the editor opened on a running FORM generation
  // show that generation instead of an empty column.
  const lineageInFlight = useMemo(
    () => inFlight.filter((g) => (g.lineageId ?? g.id) === lineageKey),
    [inFlight, lineageKey],
  )
  // Count only — never a gate. Edits queue in parallel (CharacterStudio owns the
  // jobs), so the Generate buttons stay live while work is running and the
  // in-flight tiles on the right are the feedback. Mirrors the main form's
  // "Generate Character · N running" pill.
  const runningCount = lineageInFlight.length
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const selected = outputs.find((o) => o.id === selectedId) ?? outputs[0]

  // The influencer's display name used when saving a sheet. Prefer the
  // bank name when this generation is saved; otherwise a stable generated one
  // (matches how the gallery names an influencer at save time).
  const linkedModelName = item.linkedModelId ? models.find((m) => m.id === item.linkedModelId)?.name : undefined
  // Seeded on the lineage so an unsaved character keeps ONE suggested name
  // across its whole strip (and in the main gallery), instead of a fresh random
  // one per save — the variants have to read as the same person.
  const fallbackName = useMemo(
    () => pickInfluencerName(item.profile.gender, lineageKey),
    [item.profile.gender, lineageKey],
  )
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

  // Resolution and aspect are SHARED by both modes and seeded from the image
  // being edited — flipping Edit ↔ Sheet changes what gets generated, never the
  // output settings. (Sheet mode used to bump resolution to 4K and force 16:9,
  // which quietly overrode a deliberate pick and multiplied the credit cost.)
  const itemResolution = (item.resolution as ImageResolution) ?? '1K'
  const [resolution, setResolution] = useState<ImageResolution>(itemResolution)
  const [aspect, setAspect] = useState<string>(coerceAspect(item.aspectRatio))
  // A sheet's panel grid needs a long axis, so a 1:1 pick renders vertically.
  // The stored aspect is left alone — flipping back to Edit still reads 1:1.
  const sheetAspect = aspect.includes('16:9') ? '16:9' : '9:16'

  // Clamp the per-mode settings to whatever the chosen model supports when the
  // user swaps models (mirrors the B-Roll card editor).
  useEffect(() => {
    if (!imageConstraints) return
    if (resolutionOptions.length > 0 && !resolutionOptions.includes(resolution)) {
      setResolution(resolutionOptions[0] as ImageResolution)
    }
    if (aspectOptions.length > 0 && !aspectOptions.includes(aspect)) {
      setAspect(aspectOptions[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageModelId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Closing mid-generation is safe — the job lives on CharacterStudio and keeps
  // running (visible in the main gallery, and back here on reopen).
  useCloseOnAppSwitch(true, onClose)
  const backdrop = useBackdropClose(onClose)

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

  // A finished gen does NOT become the new cover. It lands at the head of the
  // strip and the source stays whatever the user picked — edits are iterations
  // off one chosen image, so auto-promoting the newest result silently moved
  // the base out from under the next instruction.
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
    const typed = prompt.trim()
    // A visual style is an instruction in its own right — picking one and
    // hitting Generate is a valid "restyle this, change nothing else", so the
    // typed box may be empty as long as one of the two is present.
    if ((!typed && !styleDirective) || !selected) return
    // Style goes LAST so it reads as the final directive, and stands alone as
    // the whole instruction when nothing was typed.
    const instruction = styleDirective
      ? [typed && `${typed}\n`, `Re-render this character in the following visual style, keeping the same person: same face, hair, and build:\n\n${styleDirective}`]
          .filter(Boolean).join('\n')
      : typed
    onLaunchGen({
      profile: item.profile,
      resolution,
      kind: 'portrait',
      aspect: coerceAspect(aspect),
      lineageId: lineageKey,
      styleName: styleActive ? styleLabel : undefined,
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
    if (!selected) return
    // Image-to-image off the cover so the sheet keeps the exact same person —
    // startCharacterTask swaps to an i2i model and leads with an identity lock.
    // The panel doesn't change between modes, so whatever is set up there rides
    // along: the typed instruction, the visual style, and the extra references.
    const typed = prompt.trim()
    const direction = [typed, styleDirective].filter(Boolean).join('\n\n') || undefined
    onLaunchGen({
      profile: item.profile,
      resolution,
      kind: 'sheet',
      aspect: sheetAspect,
      referenceUrl: selected.imageRef,
      lineageId: lineageKey,
      styleName: styleActive ? styleLabel : undefined,
      direction,
      extraReferenceUrls: refs.map((r) => r.url),
    })
  }

  // Suggested name when opening the inline save input. Everything in this strip
  // is the SAME character, so everything files under that character's name:
  // sheets take the " - Character Sheet" suffix, an edit takes the style it was
  // rendered in ("Mia - Claymation") or the next free number ("Mia 2"). Only the
  // source portrait itself keeps the bare name. Mirrors the main gallery.
  function suggestSaveName(output: SessionOutput): string {
    const taken = models.map((m) => m.name)
    if (output.kind === 'sheet') return uniqueBankName(sheetNameFrom(influencerName), taken)
    if (output.id === lineageKey) return uniqueBankName(influencerName, taken)
    return variantNameFrom(influencerName, output.styleName, taken)
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
      {...backdrop}
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
        className="flex h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-ink/10 bg-surface-0 shadow-2xl max-md:h-[calc(100dvh-1rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Body — 50/50 grid; each column scrolls. */}
        {/* One scroller on a phone, two columns on a desktop. Stacked, the two
          halves used to be a pair of ~45dvh scroll windows — the workspace in
          one slot and its own outputs in another, neither tall enough to work
          in. Now the modal is one page: the setup, then what it made. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-2 md:overflow-hidden">
          {/* LEFT — scrollable body (model + refs/prompt) over a pinned footer
              (output settings + Generate), mirroring the Playground panel. */}
          <div className="col-span-1 flex min-h-0 flex-col border-b border-ink/5 max-md:shrink-0 md:border-b-0 md:border-r">
            {/* Scrollable body */}
            <div className="flex min-h-0 flex-1 flex-col max-md:flex-none md:overflow-y-auto">
            {/* One body for BOTH output kinds. The footer toggle picks what
                gets generated — an edited portrait or a character sheet — it
                does not swap the panel, so the references, visual style, and
                instruction you set up carry across either way. */}
            <div className="flex grow flex-col gap-3 px-5 pb-1 pt-5">
                <>
                  {/* Everything this render is built FROM, in the References
                      card the controls column three metres to the left has worn
                      since #437 — this panel was the one surface in Characters
                      that never got it. The reference thumbnails and the visual
                      style were two unlabelled affordances stacked on each
                      other, which is why the add card had to pin `Optional` and
                      its count into its own corners: there was no header to put
                      them on. */}
                  <SectionCard
                    icon={Layers}
                    title="References"
                    contentClassName="flex flex-col gap-3"
                    right={refs.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setRefs([])}
                        title="Remove every attached reference"
                        className="flex items-center gap-1 rounded-full bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-300"
                      >
                        <Eraser className="h-2.5 w-2.5" strokeWidth={2.5} />
                        Clear
                      </button>
                    ) : undefined}
                  >
                    {/* The add tile joins the grid rather than sitting as a slab
                        under it — the Playground `RefTiles` shape, down to the
                        shared 64px `ImageTile` / `AddTile` primitives. It was a
                        four-up `grid` of `aspect-square` cells, so in this
                        half-modal column each attached photo rendered ~110px
                        wide — three times the size of the same reference in
                        Playground. On a reference image the PICTURE is the
                        point, but it's still a reference, not the output. No
                        status dot: nothing in this card gates Generate. */}
                    <div className="flex flex-col gap-1.5">
                      <SectionLabel
                        label="Reference Images"
                        right={(
                          <span className="text-[10px] tabular-nums tracking-tight text-ink-600">
                            {refs.length}/{MAX_REFS}
                          </span>
                        )}
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {refs.map((r, i) => (
                          <ImageTile
                            key={i}
                            src={r.url}
                            onRemove={() => setRefs((prev) => prev.filter((_, idx) => idx !== i))}
                          />
                        ))}
                        {refs.length < MAX_REFS && (
                          <div className="relative" onMouseEnter={openRefMenu} onMouseLeave={closeRefMenuSoon}>
                            <AddTile onClick={() => setRefMenuOpen((v) => !v)} />
                            {refMenuOpen && (
                              <div
                                className="absolute left-0 top-full z-[62] mt-1"
                                onMouseEnter={openRefMenu}
                                onMouseLeave={closeRefMenuSoon}
                              >
                                <MenuSurface className="whitespace-nowrap">
                                  <MenuItem
                                    icon={Upload}
                                    onClick={() => { setRefMenuOpen(false); fileInputRef.current?.click() }}
                                  >
                                    Upload image
                                  </MenuItem>
                                  <MenuItem
                                    icon={FolderOpen}
                                    onClick={() => { setRefMenuOpen(false); setBankPickerOpen(true) }}
                                  >
                                    Pick from Bank
                                  </MenuItem>
                                </MenuSurface>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePickFiles} />
                    </div>

                    {/* Visual Style — LIFTED OUT of the prompt box (August 2026).
                        It rode inside it, as a header row on top of whatever was
                        typed below, so it read as part of the instruction. B-Roll
                        made the opposite call for its own style row: the look is
                        something the render is built FROM, like the reference
                        photos, so it belongs with them and the prompt box goes
                        back to being only a prompt box. The two apps now agree. */}
                    <div className="flex flex-col gap-1.5">
                      {/* No dot, and neither has the group above: nothing in this
                          card gates Generate (the base image does, and that's on
                          the right), so every dot here could only ever be green
                          or neutral — decoration. Leaving both bare also keeps
                          the two labels on one left edge. */}
                      <SectionLabel label="Visual Style" />
                      <button
                        type="button"
                        onClick={() => setStyleModalOpen(true)}
                        className={`group flex h-[58px] w-full items-center gap-3 rounded-full border px-4 text-left transition-colors ${
                          styleActive
                            ? 'border-influencers-500/30 bg-influencers-500/10 hover:bg-influencers-500/[0.16]'
                            : 'border-dashed border-ink/10 bg-ink/[0.02] hover:border-influencers-500/30 hover:bg-influencers-500/5'
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                            styleActive ? 'bg-influencers-500/20 text-influencers-300' : 'bg-influencers-500/10 text-influencers-400'
                          }`}
                        >
                          <Palette className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-[13px] font-medium ${styleActive ? 'text-influencers-200' : 'text-ink-100'}`}>
                            {styleActive ? styleLabel : 'Visual Style'}
                          </p>
                          <p className="truncate text-[11px] text-ink-500">
                            {styleActive
                              ? 'Applied on top of your instruction below'
                              : 'Re-render this character in a different look'}
                          </p>
                        </div>
                        {styleActive ? (
                          <span
                            role="button"
                            tabIndex={0}
                            title="Remove the visual style"
                            onClick={(e) => { e.stopPropagation(); handleClearStyle() }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); handleClearStyle() } }}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/10 hover:text-ink-200"
                          >
                            <X className="h-3.5 w-3.5" />
                          </span>
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
                        )}
                      </button>
                    </div>
                  </SectionCard>

                  {/* Edit instruction — grows to absorb leftover height.
                      Textarea + a footer toolbar (Expand) inside one rounded
                      box, matching the Playground prompt field. */}
                  <div className="flex grow flex-col">
                    <div className="relative flex grow flex-col overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.03] transition-colors focus-within:border-ink/20 focus-within:bg-ink/[0.05]">
                      {/* Only a prompt box now — the Visual Style row that used
                          to head it lives in the References card above. */}
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onBlur={commitPromptDraft}
                        rows={4}
                        placeholder="Describe the change, e.g. 'change the top to a red hoodie', 'add round glasses', 'softer warm lighting'…"
                        className="relative min-h-[120px] w-full grow resize-none border-0 bg-transparent px-3.5 pb-3 pt-3 text-[13px] leading-[1.5] text-ink-200 placeholder-ink-600 outline-none"
                      />
                      <PromptToolbar
                        accent="influencers"
                        onEnhance={handleEnhancePrompt}
                        enhanceTitle="Enhance prompt"
                        enhanceDisabled={!prompt.trim()}
                        busy={isEnhancing}
                        onUndo={handlePromptUndo}
                        canUndo={canUndoPrompt}
                        onRedo={handlePromptRedo}
                        canRedo={canRedoPrompt}
                        onExpand={() => setPromptExpanded(true)}
                      />
                    </div>
                  </div>
                </>

            </div>
            </div>

            {/* Pinned footer — output settings (resolution / aspect) just above
                the Generate button. No rule above it and barely a gap: the
                prompt box ends where its controls end, so the footer reads as
                the same column continuing. Chips open upward. */}
            <div className="shrink-0 px-5 pb-4 pt-2">
              {/* Edit Character / Character Sheet — what this generation will
                  BE, so it leads the footer's settings stack rather than
                  sitting apart at the top of the panel: pick the output, then
                  the model, then the output settings, then Generate. h-12 to
                  match the large ModelPicker trigger below it — the whole
                  footer stack (toggle / model / res+aspect chips) shares one
                  control height. */}
              <div className="mb-3">
                <SegmentedToggle<Mode>
                  className="h-12 !p-1"
                  value={mode}
                  onChange={setMode}
                  accent="influencers"
                  options={[
                    { value: 'edit', label: 'Edit Character', icon: Pencil },
                    { value: 'sheet', label: 'Character Sheet', icon: LayoutGrid },
                  ]}
                />
              </div>
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
                    size="lg"
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
                        size="lg"
                        openDirection="up"
                        options={aspectOptions}
                        value={aspect}
                        onChange={setAspect}
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
                        size="lg"
                        openDirection="up"
                        options={sheetAspectOptions}
                        value={sheetAspect}
                        onChange={setAspect}
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
                  disabled={(!prompt.trim() && !styleDirective) || !selected}
                  className="flex w-full items-center justify-center gap-2.5 glass-fill glass-fill-soft rounded-full border border-white/15 bg-influencers-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] transition-all hover:brightness-110 disabled:hover:brightness-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Wand2 className="h-4 w-4" />
                  <span>
                    Generate Edit
                    {runningCount > 0 && ` · ${runningCount} running`}
                  </span>
                  {creditsLabel && (
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
                  disabled={!selected}
                  className="flex w-full items-center justify-center gap-2.5 glass-fill glass-fill-soft rounded-full border border-white/15 bg-influencers-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] transition-all hover:brightness-110 disabled:hover:brightness-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <LayoutGrid className="h-4 w-4" />
                  <span>
                    Generate Character Sheet
                    {runningCount > 0 && ` · ${runningCount} running`}
                  </span>
                  {creditsLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
                      <Coins className="h-3 w-3" strokeWidth={2} />
                      {creditsLabel}
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* RIGHT — outputs gallery. TWO across, not three (August 2026): this
              column is half of a modal, so a third column bought a third tile at
              the price of every face being too small to judge — which is the one
              thing this gallery is for. It matches the main gallery's base grid
              now (`grid-cols-2`), landscapes span the row in both, and the day
              pills below are that gallery's too, so a lineage that ran across
              several days reads here the same way it does out there. */}
          <div className="col-span-1 flex min-h-0 flex-col max-md:shrink-0 md:overflow-y-auto">
            <div className="px-4 py-4">
              {lineageInFlight.length > 0 && (
                <>
                  <DayPill label={lineageInFlight.length === 1 ? 'In progress' : `In progress · ${lineageInFlight.length}`} />
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
                  </div>
                </>
              )}
              {outputDayGroups.map(([dayTs, items]) => (
                <div key={dayTs}>
                  <DayPill label={sectionLabel(dayTs)} />
                  <div className="grid grid-cols-2 gap-2 [grid-auto-flow:dense]">
                    {items.map((o) => (
                      <div key={o.id} className={o.aspectRatio.includes('16:9') ? 'col-span-2' : ''}>
                        <OutputTile
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
                      </div>
                    ))}
                  </div>
                </div>
              ))}
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
        expandProductImages
      />
      <ExpandTextModal
        open={promptExpanded}
        onClose={() => { commitPromptDraft(); setPromptExpanded(false) }}
        value={prompt}
        onChange={setPrompt}
        title="Edit instruction"
        placeholder="Describe the change, e.g. 'change the top to a red hoodie', 'add round glasses', 'softer warm lighting'…"
        accent="ink"
      />
      <StyleModal
        open={styleModalOpen}
        onClose={() => setStyleModalOpen(false)}
        styleId={styleId}
        styleBrief={styleBrief}
        styleBankId={styleBankId}
        onPickPreset={handlePickPresetStyle}
        onUseCustom={handleUseCustomStyle}
        styleRefs={styleRefs}
        onAddStyleRefs={(files) => { void handleAddStyleRefs(files) }}
        onRemoveStyleRef={(i) => setStyleRefs((prev) => prev.filter((_, idx) => idx !== i))}
        onClearStyleRefs={() => setStyleRefs([])}
        // No bank route in here — this editor has no B-Roll stills picker of its
        // own, so reference frames come from the uploader only.
        onPickStyleRefsFromBank={undefined}
        onAnalyze={handleAnalyzeStyleRefs}
        isAnalyzing={isAnalyzingStyle}
        accent={INFLUENCERS_STYLE_ACCENT}
        railAccent="influencers"
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
  // The row span for a landscape output is set by the grid cell around this
  // tile, not here — the gallery is day-grouped now and the wrapper is what
  // knows which grid it's in.
  return (
    <div
      onClick={onSelect}
      className={`group relative cursor-pointer overflow-hidden rounded-lg bg-black light:bg-zinc-200 transition-all card-soft-shadow ${
        selected ? 'ring-2 ring-influencers-500/60' : ''
      }`}
    >
      {url
        ? <img src={url} alt="" className="block h-auto w-full" />
        : <div className="flex w-full items-center justify-center" style={aspectStyle(output.aspectRatio)}><Spinner className="h-5 w-5 text-ink-500" /></div>}

      {output.kind === 'sheet' && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-medium text-zinc-200 backdrop-blur">
          <LayoutGrid className="h-3 w-3" strokeWidth={2} />
          Sheet
        </span>
      )}

      {/* Source badge sits at the BOTTOM-left: the hover stack owns the top-right
          corner now, and the top-left is the sheet badge's. Hidden while naming,
          which takes over the bottom edge. */}
      {selected && nameDraft === null && (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-influencers-500/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white backdrop-blur">
          Source
        </span>
      )}

      {/* Hover actions — the shared tile stack (components/tileActions): a
          vertical column in the top-right, same as the main gallery's cards.
          App-wide order, minus the delete this editor doesn't have:
          Download · Save · Copy · extras (view full screen). Hidden while
          naming so the input owns the tile. */}
      {nameDraft === null && (
        <TileActionStack forceVisible={saving}>
          <TileActionButton title="Download image" onClick={() => onDownload()}>
            <Download className="h-4 w-4" />
          </TileActionButton>
          <TileActionButton
            title={saved ? 'Saved · click to remove from Bank' : saving ? 'Saving…' : 'Save to Bank'}
            tone={saved ? 'saved' : 'default'}
            onClick={handleSaveClick}
          >
            {saving ? <Spinner className="h-4 w-4" /> : saved ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          </TileActionButton>
          <TileActionButton
            title={copied ? 'Prompt copied' : 'Copy prompt'}
            tone={copied ? 'saved' : 'default'}
            onClick={() => { void handleCopyPrompt() }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </TileActionButton>
          <TileActionButton title="View full screen" onClick={() => setLightboxOpen(true)}>
            <Maximize2 className="h-4 w-4" />
          </TileActionButton>
        </TileActionStack>
      )}

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
            {saving ? <Spinner className="h-3 w-3" /> : <Check className="h-3 w-3" />}
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
