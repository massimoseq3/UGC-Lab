import { useState, useRef, useLayoutEffect } from 'react'
import { X, Palette, Sparkles, Check, ImagePlus, Package, Bookmark, Trash2 } from 'lucide-react'
import Spinner from './Spinner'
import type { StylePreset } from '../stores/types'
import { useBankStore } from '../stores/bankStore'
import { useAppStore } from '../stores/appStore'
import { useAssetUrl } from '../hooks/useAssetUrl'
import { saveFromDataUrl } from '../utils/assetStore'
import { CONTINUOUS_STYLES } from '../utils/visualStyle'
import SlideOver from './SlideOver'
// Preview art + the per-app accent palettes. They live in their own module so a
// host that only needs an accent (or, like Playground, only the artwork) doesn't
// drag the whole modal in with it — see the note at the top of styleArt.ts.
import { STYLE_PREVIEWS, type StyleModalAccent } from './styleArt'

export type { StyleModalAccent } from './styleArt'

// How many reference frames one style can be read from. Matches the cap the
// parent enforces when adding refs.
const MAX_REFS = 4

export interface StyleSelection {
  brief: string
  // Display name — set when the style came from (or was just saved to) the
  // bank. A one-off analysed brief has none and reads as "Custom style".
  name: string | null
  bankId: string | null
}

interface StyleModalProps {
  open: boolean
  onClose: () => void
  // Current selection: a custom brief wins over the preset id, exactly as it
  // does at generate time.
  styleId: string
  styleBrief: string | null
  styleBankId: string | null
  onPickPreset: (id: string) => void
  onUseCustom: (selection: StyleSelection) => void
  // Reference frames staged for analysis — memory-only data URIs owned by the
  // parent, since the bank picker that can add to them lives there too.
  styleRefs: string[]
  onAddStyleRefs: (files: File[]) => void
  onRemoveStyleRef: (index: number) => void
  onClearStyleRefs: () => void
  // Route to the host's own bank picker for reference frames. Optional: a host
  // with no suitable bank (Characters) omits it and the button doesn't render,
  // leaving the file uploader as the only way in.
  onPickStyleRefsFromBank?: () => void
  // Runs the vision pass and hands back the style paragraph (null on failure —
  // the parent has already toasted). The modal, not the parent, decides what
  // to do with it, so nothing is applied until the user picks Use or Save.
  onAnalyze: () => Promise<string | null>
  isAnalyzing: boolean
  // Host app's accent classes — see StyleModalAccent.
  accent: StyleModalAccent
  // What the style applies to in this host ("every clip" / "every character").
  subjectLabel?: string
}

// A style is a look, so the card is a picture of it — the same 9:16 tile the
// Characters preset picker uses, three across in a 380px panel. Built-in presets
// pass a bundled `imageUrl` from STYLE_PREVIEWS; a saved style passes an
// `imageRef` and covers itself with the first frame it was read from. Neither
// present (a style with no preview art yet) falls back to the glyph.
export function StyleTile({
  imageRef,
  imageUrl,
  name,
  active,
  accent,
  onClick,
}: {
  imageRef?: string
  imageUrl?: string
  name: string
  active: boolean
  accent: StyleModalAccent
  onClick: () => void
}) {
  const assetUrl = useAssetUrl(imageRef)
  const url = imageUrl ?? assetUrl
  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      className={`group relative block aspect-[9/16] w-full overflow-hidden rounded-xl border transition-all hover:-translate-y-px ${
        active ? accent.card : 'border-ink/5 bg-ink/[0.03] hover:border-ink/15'
      }`}
    >
      {url ? (
        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Palette className={`h-6 w-6 ${active ? accent.titleOn : 'text-ink-700'}`} strokeWidth={1.5} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2.5 pt-7">
        {/* Wraps to two lines rather than truncating: at three tiles across a
            380px panel, anything past ~12 characters clipped — which hit both
            the longer preset names and most user-named saved styles. */}
        <span className="block line-clamp-2 text-[12px] font-semibold leading-tight tracking-tight text-zinc-100">{name}</span>
      </div>
      {active && (
        <span className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white ${accent.solid}`}>
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

export default function StyleModal({
  open,
  onClose,
  styleId,
  styleBrief,
  styleBankId,
  onPickPreset,
  onUseCustom,
  styleRefs,
  onAddStyleRefs,
  onRemoveStyleRef,
  onClearStyleRefs,
  onPickStyleRefsFromBank,
  onAnalyze,
  isAnalyzing,
  accent,
  subjectLabel = 'clip',
}: StyleModalProps) {
  const savedStyles = useBankStore((s) => s.styles)
  const addStyle = useBankStore((s) => s.addStyle)
  const deleteStyle = useBankStore((s) => s.deleteStyle)
  const addToast = useAppStore((s) => s.addToast)

  // 'browse' picks an existing look; 'create' reads a new one off references.
  const [view, setView] = useState<'browse' | 'create'>('browse')
  // The analysed paragraph, editable before it's used or saved. Empty until the
  // vision pass returns.
  const [draftBrief, setDraftBrief] = useState('')
  const [draftName, setDraftName] = useState('')
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  // Every open lands on the browse view with a clean draft. The panel stays
  // mounted (SlideOver animates it in and out), so this replaces the remount-
  // on-open key the hosts used to pass; a layout effect runs before paint, so
  // the previous session's create view never flashes.
  const wasOpen = useRef(open)
  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      setView('browse')
      setDraftBrief('')
      setDraftName('')
    }
    wasOpen.current = open
  }, [open])

  const usingCustom = !!styleBrief?.trim()

  const openCreate = () => {
    setDraftBrief('')
    setDraftName('')
    setView('create')
  }

  const backToBrowse = () => {
    setDraftBrief('')
    setDraftName('')
    setView('browse')
  }

  const handleAnalyze = async () => {
    const brief = await onAnalyze()
    if (brief) setDraftBrief(brief)
  }

  const handleUseOnce = () => {
    const brief = draftBrief.trim()
    if (!brief) return
    onUseCustom({ brief, name: draftName.trim() || null, bankId: null })
    // The frames have done their job — drop them so the next visit to this
    // view starts empty instead of re-offering the last style's references.
    onClearStyleRefs()
    onClose()
  }

  // Save to the Styles bank, then apply it. The reference frames become the
  // row's thumbnails so the bank card shows what the look was read from —
  // they're this bank's own assets, nothing else links them.
  const handleSaveAndUse = async () => {
    const brief = draftBrief.trim()
    const name = draftName.trim()
    if (!brief || !name || saving) return
    setSaving(true)
    try {
      const thumbRefs: string[] = []
      for (const ref of styleRefs.slice(0, MAX_REFS)) {
        if (!ref.startsWith('data:')) continue
        try {
          thumbRefs.push(await saveFromDataUrl(ref))
        } catch {
          /* a thumbnail is cosmetic — never block the save on one */
        }
      }
      const id = await addStyle({ name, brief, thumbRefs: thumbRefs.length > 0 ? thumbRefs : undefined })
      onUseCustom({ brief, name, bankId: id })
      onClearStyleRefs()
      onClose()
    } catch {
      addToast('Could not save that style. It is still applied to this session.', 'error')
      onUseCustom({ brief, name, bankId: null })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleFiles = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length > 0) onAddStyleRefs(images)
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      onBack={view === 'create' ? backToBrowse : undefined}
      title={view === 'create' ? 'New style from references' : 'Visual style'}
      subtitle={
        view === 'create'
          ? 'The look is read from these frames — never their subjects'
          : `The look every ${subjectLabel} is rendered in`
      }
      // The standard 380px panel, matching the Characters preset picker: the
      // browse grid is three 9:16 tiles across now rather than two text cards,
      // so a look is picked off its picture and the whole list fits without
      // scrolling past the presets to reach your own styles.
      size={view === 'create' ? 'wide' : 'default'}
      // The create view routes to the host's own BankPicker for reference
      // frames, and that picker has to land on top of this panel.
      layer="below-pickers"
      footer={
        // Only the create view commits anything.
        view === 'create' && draftBrief ? (
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleUseOnce}
              className="rounded-full px-4 py-2 text-[12px] font-medium text-ink-400 transition-colors hover:bg-ink/[0.06] hover:text-ink-200"
            >
              Use without saving
            </button>
            <button
              type="button"
              onClick={() => void handleSaveAndUse()}
              disabled={!draftName.trim() || saving}
              title={draftName.trim() ? undefined : 'Name the style to save it'}
              className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${accent.button}`}
            >
              {saving ? <Spinner className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
              Save to bank & use
            </button>
          </div>
        ) : undefined
      }
    >
      {view === 'browse' ? (
        <div className="px-5 py-4">
          {/* A one-off analysed brief isn't in the bank, so no card can carry
              its selected state — surface it here with a way back out. */}
          {usingCustom && !styleBankId && (
            <div className={`mb-4 rounded-2xl border px-4 py-3 ${accent.banner}`}>
              <div className="flex items-start justify-between gap-3">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${accent.bannerLabel}`}>Custom style in use</span>
                <button
                  type="button"
                  onClick={() => { setDraftBrief(styleBrief ?? ''); setDraftName(''); setView('create') }}
                  className="shrink-0 rounded-full bg-ink/10 px-2.5 py-0.5 text-[11px] font-medium text-ink-200 transition-colors hover:bg-ink/[0.16]"
                >
                  Name & save it
                </button>
              </div>
              <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-ink-400">{styleBrief}</p>
            </div>
          )}

          <p className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-ink-600">Presets</p>
          <div className="grid grid-cols-3 gap-2">
            {CONTINUOUS_STYLES.map((s) => (
              <StyleTile
                key={s.id}
                name={s.label}
                imageUrl={STYLE_PREVIEWS[s.id]}
                active={!usingCustom && s.id === styleId}
                accent={accent}
                onClick={() => { onPickPreset(s.id); onClose() }}
              />
            ))}
          </div>

          <p className="mb-2.5 mt-6 text-[11px] font-medium uppercase tracking-wider text-ink-600">Your styles</p>
          <div className="grid grid-cols-3 gap-2">
            {savedStyles.map((s) => (
              <SavedStyleCard
                key={s.id}
                item={s}
                active={usingCustom && styleBankId === s.id}
                accent={accent}
                onUse={() => { onUseCustom({ brief: s.brief, name: s.name, bankId: s.id }); onClose() }}
                onDelete={() => void deleteStyle(s.id)}
              />
            ))}
            {/* Dashed create card — always last, so the row reads "…and one
                more of your own". Same 9:16 footprint as the tiles beside it. */}
            <button
              type="button"
              onClick={openCreate}
              className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink/10 bg-ink/[0.02] p-2 text-center transition-colors hover:border-ink/25 hover:bg-ink/[0.05]"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/5 text-ink-500">
                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <span className="text-[11px] font-semibold leading-tight tracking-tight text-ink-200">New from images</span>
            </button>
          </div>
        </div>
      ) : (
        // min-h-full so the drop zone covers the whole scroll area, not just
        // the height the (initially short) create view happens to occupy.
        <div
          className="min-h-full px-5 py-4"
          onDragEnter={(e) => {
            if (!Array.from(e.dataTransfer.types).includes('Files')) return
            dragDepth.current += 1
            setDragging(true)
          }}
          onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault() }}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false) }}
          onDrop={(e) => {
            if (!Array.from(e.dataTransfer.types).includes('Files')) return
            e.preventDefault()
            dragDepth.current = 0
            setDragging(false)
            handleFiles(Array.from(e.dataTransfer.files))
          }}
        >
          {/* Reference frames. Dashed only while empty — once frames are in,
              the panel goes solid so the dashed Add tile is the only dashed
              thing left and reads as the affordance it is. */}
          <div
            className={`rounded-2xl border p-4 transition-colors ${
              dragging
                ? `border-dashed ${accent.dropActive}`
                : styleRefs.length === 0
                  ? 'border-dashed border-ink/10 bg-ink/[0.02]'
                  : 'border-ink/[0.07] bg-ink/[0.02]'
            }`}
          >
            {styleRefs.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-ink-500">
                  <ImagePlus className="h-5 w-5" strokeWidth={1.5} />
                </span>
                <p className="text-[12px] leading-relaxed text-ink-500">
                  Drop up to {MAX_REFS} frames here, or pick them from your banks.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-paper transition-colors hover:bg-ink/90">
                    <ImagePlus className="h-3.5 w-3.5" />
                    Upload images
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handleFiles(Array.from(e.target.files ?? []))
                        e.target.value = ''
                      }}
                    />
                  </label>
                  {onPickStyleRefsFromBank && (
                    <button
                      type="button"
                      onClick={onPickStyleRefsFromBank}
                      className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.04] px-4 py-2 text-[12px] font-medium text-ink-200 transition-colors hover:bg-ink/[0.08]"
                    >
                      <Package className="h-3.5 w-3.5" />
                      Choose from Bank
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3.5">
                {/* Caption row — the count on the left, the two secondary
                    actions as quiet links on the right, so the primary CTA
                    below is the only button competing for attention. */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-ink-600">
                    Reference frames · {styleRefs.length} of {MAX_REFS}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {onPickStyleRefsFromBank && (
                      <>
                        <button
                          type="button"
                          onClick={onPickStyleRefsFromBank}
                          className="rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-200"
                        >
                          Choose from Bank
                        </button>
                        <span className="h-3 w-px bg-ink/10" />
                      </>
                    )}
                    <button
                      type="button"
                      onClick={onClearStyleRefs}
                      className="rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-200"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {styleRefs.map((ref, i) => (
                    <div key={i} className="group/ref relative h-20 w-20 overflow-hidden rounded-xl border border-ink/10">
                      <img src={ref} alt={`Style reference ${i + 1}`} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => onRemoveStyleRef(i)}
                        title="Remove"
                        className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover/ref:opacity-100"
                      >
                        <X className="h-4 w-4 text-white" />
                      </button>
                    </div>
                  ))}
                  {styleRefs.length < MAX_REFS && (
                    <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ink/15 text-ink-500 transition-colors hover:border-ink/30 hover:text-ink-300">
                      <ImagePlus className="h-4 w-4" strokeWidth={1.5} />
                      <span className="text-[10px] font-medium">Add</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          handleFiles(Array.from(e.target.files ?? []))
                          e.target.value = ''
                        }}
                      />
                    </label>
                  )}
                </div>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => void handleAnalyze()}
                    disabled={isAnalyzing}
                    className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[12px] font-semibold tracking-tight text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${accent.button}`}
                  >
                    {isAnalyzing ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {isAnalyzing ? 'Reading the style…' : draftBrief ? 'Re-read the style' : `Read the style from ${styleRefs.length} image${styleRefs.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* The distilled brief — editable before it's used or saved. */}
          {draftBrief && (
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-600">Style brief</span>
                <textarea
                  value={draftBrief}
                  onChange={(e) => setDraftBrief(e.target.value)}
                  rows={7}
                  className="resize-y rounded-2xl border border-ink/10 bg-ink/[0.03] px-4 py-3 text-[13px] leading-relaxed text-ink-200 outline-none transition-colors focus:border-ink/20"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-600">Name</span>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder='e.g. "Warm 90s Camcorder"'
                  className="rounded-full border border-ink/10 bg-ink/[0.03] px-4 py-2.5 text-[13px] text-ink-200 placeholder-ink-600 outline-none transition-colors focus:border-ink/20"
                />
              </label>
            </div>
          )}
        </div>
      )}
    </SlideOver>
  )
}

function SavedStyleCard({
  item,
  active,
  accent,
  onUse,
  onDelete,
}: {
  item: StylePreset
  active: boolean
  accent: StyleModalAccent
  onUse: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  // The cover is the first frame the style was read from — the closest thing a
  // saved look has to a picture of itself. The rest stay in the row's edit form.
  const cover = (item.thumbRefs ?? [])[0]

  return (
    <div className="group/style relative">
      <StyleTile
        imageRef={cover}
        name={item.name}
        active={active}
        accent={accent}
        onClick={onUse}
      />
      {/* Two-click delete, matching the app-wide tile idiom: the first click
          arms a red Confirm pill that reverts after 3s. Sits top-left so it
          clears both the active check bubble and the name plate. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (!confirming) {
            setConfirming(true)
            setTimeout(() => setConfirming(false), 3000)
            return
          }
          setConfirming(false)
          onDelete()
        }}
        title={confirming ? 'Click again to delete' : 'Delete style'}
        className={`absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full transition-all ${
          confirming
            ? 'bg-red-500/90 px-2 py-1 text-[9px] font-semibold text-white opacity-100'
            : 'h-7 w-7 justify-center bg-black/55 text-white opacity-0 hover:bg-red-500/60 group-hover/style:opacity-100'
        }`}
      >
        {confirming ? 'Confirm' : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
