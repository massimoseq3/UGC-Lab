import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Palette, Sparkles, Loader2, Check, ChevronLeft, ImagePlus, Package, Bookmark, Trash2 } from 'lucide-react'
import type { StylePreset } from '../../../stores/types'
import { useBankStore } from '../../../stores/bankStore'
import { useAppStore } from '../../../stores/appStore'
import { useAssetUrl } from '../../../hooks/useAssetUrl'
import { saveFromDataUrl } from '../../../utils/assetStore'
import useCloseOnEscape from '../../../hooks/useCloseOnEscape'
import { useCloseOnAppSwitch } from '../../../hooks/useCloseOnAppSwitch'
import { CONTINUOUS_STYLES } from '../services/generateContinuous'

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
  onPickStyleRefsFromBank: () => void
  // Runs the vision pass and hands back the style paragraph (null on failure —
  // the parent has already toasted). The modal, not the parent, decides what
  // to do with it, so nothing is applied until the user picks Use or Save.
  onAnalyze: () => Promise<string | null>
  isAnalyzing: boolean
}

// One saved style's reference mosaic (up to four frames).
function SavedThumb({ refId }: { refId: string }) {
  const url = useAssetUrl(refId)
  return url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-ink/[0.06]" />
}

function StyleCardShell({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex w-full flex-col overflow-hidden rounded-2xl border p-3.5 text-left transition-colors ${
        active
          ? 'border-broll-500/40 bg-broll-500/10'
          : 'border-ink/5 bg-ink/[0.03] hover:border-ink/15 hover:bg-ink/[0.06]'
      }`}
    >
      {active && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-broll-500 text-white">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
      {children}
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

  useCloseOnEscape(open, onClose)
  useCloseOnAppSwitch(open, onClose)

  if (!open) return null

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

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-ink/10 px-5 py-3.5">
          {view === 'create' && (
            <button
              type="button"
              onClick={backToBrowse}
              aria-label="Back to styles"
              className="-ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-ink/10 hover:text-ink-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight text-ink-100">
              {view === 'create' ? 'New style from references' : 'Visual style'}
            </p>
            <p className="truncate text-[11px] text-ink-500">
              {view === 'create'
                ? 'The look is read from these frames — never their subjects'
                : 'The look every clip is rendered in'}
            </p>
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

        {view === 'browse' ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {/* A one-off analysed brief isn't in the bank, so no card can carry
                its selected state — surface it here with a way back out. */}
            {usingCustom && !styleBankId && (
              <div className="mb-4 rounded-2xl border border-broll-500/25 bg-broll-500/10 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-broll-300">Custom style in use</span>
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
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {CONTINUOUS_STYLES.map((s) => {
                const active = !usingCustom && s.id === styleId
                return (
                  <StyleCardShell key={s.id} active={active} onClick={() => { onPickPreset(s.id); onClose() }}>
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full ${active ? 'bg-broll-500/20 text-broll-300' : 'bg-ink/5 text-ink-500'}`}>
                      <Palette className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <span className={`mt-2.5 text-[13px] font-semibold tracking-tight ${active ? 'text-broll-200' : 'text-ink-100'}`}>{s.label}</span>
                    <span className="mt-1 line-clamp-3 text-[11px] leading-snug text-ink-500">{s.hint}</span>
                  </StyleCardShell>
                )
              })}
            </div>

            <p className="mb-2.5 mt-6 text-[11px] font-medium uppercase tracking-wider text-ink-600">Your styles</p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {savedStyles.map((s) => (
                <SavedStyleCard
                  key={s.id}
                  item={s}
                  active={usingCustom && styleBankId === s.id}
                  onUse={() => { onUseCustom({ brief: s.brief, name: s.name, bankId: s.id }); onClose() }}
                  onDelete={() => void deleteStyle(s.id)}
                />
              ))}
              {/* Dashed create card — always last, so the row reads "…and one
                  more of your own". */}
              <button
                type="button"
                onClick={openCreate}
                className="flex min-h-[124px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink/10 bg-ink/[0.02] p-3.5 text-center transition-colors hover:border-ink/25 hover:bg-ink/[0.05]"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/5 text-ink-500">
                  <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <span className="text-[13px] font-semibold tracking-tight text-ink-200">New from images</span>
                <span className="text-[11px] leading-snug text-ink-600">Upload frames of an ad whose look you want</span>
              </button>
            </div>
          </div>
        ) : (
          <div
            className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
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
                  ? 'border-dashed border-broll-500/50 bg-broll-500/10'
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
                    <button
                      type="button"
                      onClick={onPickStyleRefsFromBank}
                      className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.04] px-4 py-2 text-[12px] font-medium text-ink-200 transition-colors hover:bg-ink/[0.08]"
                    >
                      <Package className="h-3.5 w-3.5" />
                      Choose from Bank
                    </button>
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
                      <button
                        type="button"
                        onClick={onPickStyleRefsFromBank}
                        className="rounded-full px-2.5 py-1 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-200"
                      >
                        Choose from Bank
                      </button>
                      <span className="h-3 w-px bg-ink/10" />
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
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-broll-500 px-4 py-2.5 text-[12px] font-semibold tracking-tight text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isAnalyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
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

        {/* Footer — only the create view commits anything. */}
        {view === 'create' && draftBrief && (
          <div className="flex items-center justify-end gap-2 border-t border-ink/10 px-5 py-3">
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
              className="flex items-center gap-1.5 rounded-full bg-broll-500 px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-broll-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bookmark className="h-3.5 w-3.5" />}
              Save to bank & use
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function SavedStyleCard({
  item,
  active,
  onUse,
  onDelete,
}: {
  item: StylePreset
  active: boolean
  onUse: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const thumbs = (item.thumbRefs ?? []).slice(0, 4)

  return (
    <div className="group/style relative">
      <StyleCardShell active={active} onClick={onUse}>
        {thumbs.length > 0 ? (
          <div className="flex gap-1">
            {thumbs.map((ref) => (
              <div key={ref} className="h-8 w-8 shrink-0 overflow-hidden rounded-lg border border-ink/10">
                <SavedThumb refId={ref} />
              </div>
            ))}
          </div>
        ) : (
          <span className={`flex h-8 w-8 items-center justify-center rounded-full ${active ? 'bg-broll-500/20 text-broll-300' : 'bg-ink/5 text-ink-500'}`}>
            <Palette className="h-4 w-4" strokeWidth={1.75} />
          </span>
        )}
        <span className={`mt-2.5 truncate pr-6 text-[13px] font-semibold tracking-tight ${active ? 'text-broll-200' : 'text-ink-100'}`}>{item.name}</span>
        <span className="mt-1 line-clamp-3 text-[11px] leading-snug text-ink-500">{item.brief}</span>
      </StyleCardShell>
      {/* Two-click delete, matching the app-wide tile idiom: the first click
          arms a red Confirm pill that reverts after 3s. */}
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
        className={`absolute bottom-2.5 right-2.5 flex items-center gap-1 rounded-full transition-all ${
          confirming
            ? 'bg-red-500/90 px-2.5 py-1 text-[10px] font-semibold text-white opacity-100'
            : 'h-7 w-7 justify-center text-ink-600 opacity-0 hover:bg-ink/10 hover:text-red-300 group-hover/style:opacity-100'
        }`}
      >
        {confirming ? 'Confirm' : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
