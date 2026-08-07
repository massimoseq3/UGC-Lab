import { memo, useMemo, useRef, useState, useEffect } from 'react'
import { Loader2, Image as ImageIcon, UserRound, Bookmark, X, Download, Check, Copy, LayoutGrid, List, Maximize2, RectangleVertical, Plus, Braces, ChevronDown, Pencil, Frame, History } from 'lucide-react'
import { useBankStore } from '../../../stores/bankStore'
import { useAssetUrlState } from '../../../hooks/useAssetUrl'
import { getUrl } from '../../../utils/assetStore'
import { useAppStore } from '../../../stores/appStore'
import { usePersistedState } from '../../../hooks/usePersistedState'
import { humanizeError } from '../../../utils/friendlyError'
import { sectionLabel, groupByDay, formatRelative } from '../../../utils/history'
import type { CharacterHistoryItem } from '../../../stores/types'
import { createEmptyProfile, type CharacterProfile, type InFlightCharacterGen, type LaunchGenOptions } from '../types'
import { getModel } from '../../../utils/models'
import SegmentedToggle from '../../../components/SegmentedToggle'
import { TileActionStack, TileActionButton, TileDeleteButton } from '../../../components/tileActions'
import DayPill from '../../../components/DayPill'
import { AwaitingCanvas } from '../../../components/GridCanvas'
import InfluencerEditModal from './InfluencerEditModal'
import GeneratingTile from './GeneratingTile'
import { buildJsonPrompt, buildImagePrompt } from '../services/generateCharacter'
import { pickInfluencerName, sheetNameFrom, uniqueBankName, variantNameFrom } from './nameGenerator'
import { downloadImage } from '../../../utils/downloadImage'

// List-view size-slider bounds. The raw value only drives the slider fill % and
// the media frame's aspect ratio (see `mediaAspect`); it's no longer a pixel
// height. Min → a 16:9 frame (landscape fills, no bars); max → a tall frame.
const LIST_CARD_MIN = 200
const LIST_CARD_MAX = 560

type ViewMode = 'single' | 'list' | 'grid'

interface GalleryPanelProps {
  inFlight: InFlightCharacterGen[]
  onCancelGen: (id: string) => void
  onLaunchGen: (opts: LaunchGenOptions) => void
}

// Memoized: this panel renders every character the member has ever generated
// (characterHistory is uncapped) and it sits beside a ~28-field form. Without
// the bail-out, one keystroke in the form re-rendered the whole history — each
// row with its own asset lookup. All three props are stable while typing (the
// parent useCallback's both handlers), so the subtree is skipped entirely.
export default memo(function GalleryPanel({
  inFlight,
  onCancelGen,
  onLaunchGen,
}: GalleryPanelProps) {
  // The editor is anchored by ID, not by a snapshot of the row: a generation
  // can be opened while it's still running, and `finishGen` writes its history
  // row under the generation's own id — so the same anchor resolves to the
  // pending gen first and the finished row the moment it lands.
  const [previewId, setPreviewId] = useState<string | null>(null)
  // Which mode the edit pop-up opens in. "Make Sheet" on a tile opens straight
  // into sheet mode so the user just hits Generate; a normal click is edit.
  const [previewMode, setPreviewMode] = useState<'edit' | 'sheet'>('edit')

  // Single (just the newest generation) vs Grid (masonry) vs List (stacked
  // rows). Persisted globally so the choice sticks across reloads — Grid/List
  // mirror the Playground's switch; Single is the distraction-free view for
  // screen recording, where a full history of past characters is on camera.
  const [viewMode, setViewMode] = usePersistedState<ViewMode>('ai-ugc-lab:influencers:history-view', 'grid')
  // List-view card size — the media frame height (px), set by the header slider.
  const [listCardHeight, setListCardHeight] = usePersistedState<number>('ai-ugc-lab:influencers:list-card-height', 300)
  const cardPct = ((listCardHeight - LIST_CARD_MIN) / (LIST_CARD_MAX - LIST_CARD_MIN)) * 100
  // The list media frame keeps a constant width (its column) and grows taller as
  // the slider moves right. At the minimum it's a perfect 16:9 so landscape fills
  // edge-to-edge with no bars; sliding right lowers the ratio toward 9:16,
  // letterboxing landscape top/bottom while portraits get bigger.
  const mediaAspect = 16 / 9 + (cardPct / 100) * (9 / 16 - 16 / 9)

  // Copy an influencer's generation prompt (built from its saved profile) to
  // the clipboard. Replaces the old "Edit in form" tile action.
  async function handleCopyPrompt(item: CharacterHistoryItem) {
    const text = buildImagePrompt(item.profile).trim()
    if (!text) {
      useAppStore.getState().addToast('No prompt to copy', 'error')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      useAppStore.getState().addToast('Prompt copied', 'success')
    } catch {
      useAppStore.getState().addToast('Could not copy the prompt', 'error')
    }
  }

  const characterHistory = useBankStore((s) => s.characterHistory)
  const deleteCharacterHistory = useBankStore((s) => s.deleteCharacterHistory)

  const dayGroups = useMemo(
    () => groupByDay(characterHistory, (e) => e.createdAt),
    [characterHistory],
  )

  const isEmpty = characterHistory.length === 0 && inFlight.length === 0

  const newestId = characterHistory[0]?.id ?? 'none'

  // Single view's "clear the frame" state. Holds the id that was cleared, so a
  // newer generation (or one still running) fills the frame again on its own —
  // no effect, no stale flag to reset.
  const [clearedId, setClearedId] = useState<string | null>(null)
  const frameCleared = inFlight.length === 0 && clearedId === newestId

  // Which character the Single view is showing. Default is the newest, which is
  // what this view has always done; pinning one from the grid or list puts THAT
  // character on the stage instead — the view is for screen recording, and the
  // character you want on camera isn't always the last one you made.
  //
  // The pin remembers which row was newest when it was set, so it retires
  // itself the moment a newer generation lands (the same self-resetting trick
  // as `clearedId`): finishing a character and then finding the stage still
  // holding an older one would read as the generation having failed. A pin
  // whose row has since been deleted falls through to the newest too.
  const [pin, setPin] = usePersistedState<{ id: string; newestId: string } | null>(
    'ai-ugc-lab:influencers:single-pin',
    null,
  )
  const pinnedItem = pin && pin.newestId === newestId
    ? characterHistory.find((h) => h.id === pin.id)
    : undefined
  const singleItem = frameCleared ? undefined : (pinnedItem ?? characterHistory[0])

  // Put a character on the Single stage and go there, so the click has a
  // visible result rather than silently arming a view the member isn't on.
  function showInSingle(item: CharacterHistoryItem) {
    setPin({ id: item.id, newestId })
    setClearedId(null)
    setViewMode('single')
  }

  // The editor's anchor: the finished row if there is one, otherwise the
  // still-running generation shaped as the row it is about to become.
  const previewRow = previewId ? characterHistory.find((h) => h.id === previewId) : undefined
  const previewGen = previewId && !previewRow ? inFlight.find((g) => g.id === previewId) : undefined
  const previewItem = previewRow ?? (previewGen ? pendingItemFromGen(previewGen) : null)

  function openEditor(id: string, mode: 'edit' | 'sheet' = 'edit') {
    setPreviewMode(mode)
    setPreviewId(id)
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header — card-size slider (list view only) + view switch (Grid / List).
          Renders even when the gallery is empty: every other app keeps a
          h-[57px] bar on BOTH panes, so hiding it here left the two columns'
          divider lines out of alignment on a fresh visit. */}
      <div className="flex h-[57px] shrink-0 items-center justify-end gap-3 border-b border-ink/5 px-4">
        {!isEmpty && (
          <>
            {/* Single view only: empty the frame back to "Awaiting generation".
                Nothing is deleted — the history is one toggle away, and the next
                generation fills the frame again. */}
            {/* Only while a character is pinned to the stage — the way back to
                "whatever I just made", so a pin is never a state the member is
                stuck in wondering why new work isn't showing. */}
            {viewMode === 'single' && pinnedItem && (
              <button
                type="button"
                title="Show the newest character instead"
                onClick={() => setPin(null)}
                className="flex h-9 items-center gap-1.5 rounded-full border border-influencers-500/30 bg-influencers-500/10 px-3 text-[11px] font-medium text-influencers-300 transition-colors hover:bg-influencers-500/20"
              >
                <History className="h-3.5 w-3.5" />
                Newest
              </button>
            )}
            {viewMode === 'single' && !frameCleared && (
              <button
                type="button"
                title="Clear the frame"
                onClick={() => setClearedId(newestId)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/10 bg-ink/[0.03] text-ink-300 transition-colors hover:bg-ink/[0.08] hover:text-ink-100"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
            {viewMode === 'list' && (
              <div className="flex items-center gap-2.5" title="Card size">
                <Maximize2 className="h-3.5 w-3.5 text-ink-500" />
                <input
                  type="range"
                  min={LIST_CARD_MIN}
                  max={LIST_CARD_MAX}
                  step={10}
                  value={listCardHeight}
                  onChange={(e) => setListCardHeight(Number(e.target.value))}
                  className="slider-thin w-28"
                  style={{
                    ['--slider-pct' as string]: `${cardPct}%`,
                    ['--slider-fill' as string]: 'var(--color-influencers-500)',
                  }}
                  aria-label="List card size"
                />
              </div>
            )}
            <ViewToggle value={viewMode} onChange={setViewMode} />
          </>
        )}
      </div>

      {isEmpty ? (
        // Same graph-paper stage the Single view and the other apps' output
        // panels use while they hold nothing — an empty column reads as a
        // waiting stage rather than a dead panel.
        <AwaitingCanvas
          icon={UserRound}
          title="No generations yet"
          hint="Configure parameters on the left and hit Generate. Every character you make lands here, sorted by day."
        />
      ) : viewMode === 'single' ? (
        // Every callback targets the item ACTUALLY on the stage. They used to
        // read characterHistory[0] directly, which was the same row only
        // because the stage was always the newest one; with a pin it would
        // delete or edit a character the member isn't looking at.
        <SingleView
          inFlight={inFlight}
          item={singleItem}
          onCancelGen={onCancelGen}
          onOpenGen={(id) => openEditor(id)}
          onClick={() => singleItem && openEditor(singleItem.id)}
          onDelete={() => singleItem && deleteCharacterHistory(singleItem.id)}
          onMakeSheet={() => singleItem && openEditor(singleItem.id, 'sheet')}
          onCopyPrompt={() => singleItem && handleCopyPrompt(singleItem)}
        />
      ) : (
        <>
          {/* Scrollable gallery */}
          <div className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
            {inFlight.length > 0 && (
              <>
                <DayPill label={inFlight.length === 1 ? 'In progress' : `In progress · ${inFlight.length}`} />
                {viewMode === 'grid' ? (
                  <div className="grid grid-cols-2 gap-2 [grid-auto-flow:dense] lg:grid-cols-3">
                    {inFlight.map((gen) => (
                      <div key={gen.id} className={isWide(gen.aspectRatio) ? 'col-span-2 lg:col-span-3' : ''}>
                        <InFlightTile gen={gen} onCancel={() => onCancelGen(gen.id)} onClick={() => openEditor(gen.id)} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {inFlight.map((gen) => (
                      <InFlightRow key={gen.id} gen={gen} mediaAspect={mediaAspect} onCancel={() => onCancelGen(gen.id)} onClick={() => openEditor(gen.id)} />
                    ))}
                  </div>
                )}
              </>
            )}

            {dayGroups.map(([dayTs, items]) => (
              <div key={dayTs}>
                <DayPill label={sectionLabel(dayTs)} />
                {viewMode === 'grid' ? (
                  <div className="grid grid-cols-2 gap-2 [grid-auto-flow:dense] lg:grid-cols-3">
                    {items.map((item) => (
                      <div key={item.id} className={isWide(item.aspectRatio) ? 'col-span-2 lg:col-span-3' : ''}>
                        <HistoryTile
                          item={item}
                          onClick={() => openEditor(item.id)}
                          onDelete={() => deleteCharacterHistory(item.id)}
                          onMakeSheet={() => openEditor(item.id, 'sheet')}
                          onCopyPrompt={() => handleCopyPrompt(item)}
                          onShowInSingle={() => showInSingle(item)}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {items.map((item) => (
                      <HistoryListRow
                        key={item.id}
                        item={item}
                        mediaAspect={mediaAspect}
                        onClick={() => openEditor(item.id)}
                        onDelete={() => deleteCharacterHistory(item.id)}
                        onMakeSheet={() => openEditor(item.id, 'sheet')}
                        onCopyPrompt={() => handleCopyPrompt(item)}
                        onShowInSingle={() => showInSingle(item)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {previewItem && (
        <InfluencerEditModal
          // Keyed on the anchor so the editor re-seeds its own state when the
          // member opens a different character; the pending → finished swap of
          // ONE generation keeps the same id, so it doesn't remount there.
          key={previewItem.id}
          item={previewItem}
          initialMode={previewMode}
          inFlight={inFlight}
          onLaunchGen={onLaunchGen}
          onCancelGen={onCancelGen}
          onClose={() => setPreviewId(null)}
        />
      )}
    </div>
  )
})

// ── View toggle ─────────────────────────────────────────────────

// Single / List / Grid switch in the gallery header. List and Grid keep the
// Playground's shape so the two tabs read as a matched pair; Single sits first
// because it's the narrowest view of the same feed.
function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <SegmentedToggle<ViewMode>
      fitContent
      className="h-10 !p-1"
      value={value}
      onChange={onChange}
      options={[
        { value: 'single', label: 'Single', icon: RectangleVertical },
        { value: 'list', label: 'List', icon: List },
        { value: 'grid', label: 'Grid', icon: LayoutGrid },
      ]}
    />
  )
}

// Horizontal (16:9) outputs — character sheets or landscape portraits — claim
// a full grid row instead of a single column so the wide frame stays readable.
function isWide(ar: string): boolean {
  return ar.includes('16:9')
}

function aspectStyle(ar: string): React.CSSProperties {
  if (ar.includes('16:9')) return { aspectRatio: '16 / 9' }
  if (ar.includes('1:1')) return { aspectRatio: '1 / 1' }
  return { aspectRatio: '9 / 16' }
}

// ── Shared per-item logic ───────────────────────────────────────

// Save / delete / download + name-draft state for one history entry. Shared by
// the grid tile and the list row so both views stay in lockstep. Copy-prompt and
// make-sheet stay as parent callbacks (they reach into modal/clipboard concerns).
function useHistoryTileActions(item: CharacterHistoryItem, onDelete: () => void | Promise<unknown>) {
  const { url, status } = useAssetUrlState(item.imageRef)
  const addModel = useBankStore((s) => s.addModel)
  const deleteModel = useBankStore((s) => s.deleteModel)
  const updateCharacterHistory = useBankStore((s) => s.updateCharacterHistory)
  const models = useBankStore((s) => s.models)
  const characterHistory = useBankStore((s) => s.characterHistory)
  const addToast = useAppStore((s) => s.addToast)
  const [savingToBank, setSavingToBank] = useState(false)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const isSheet = item.kind === 'sheet'
  const linkedModel = item.linkedModelId ? models.find((m) => m.id === item.linkedModelId) : undefined
  // Portraits and sheets alike save as their own Bank entry, tracked by
  // linkedModelId — once saved the tile shows the Saved/attached state.
  const savedAsModel = !!linkedModel

  // Anything derived from a portrait — a sheet or an edit — files under that
  // character's name rather than a fresh random one: sheets take the
  // " - Character Sheet" suffix, edits take the style they were rendered in
  // ("Mia - Claymation") or the next free number ("Mia 2"). The fallback name is
  // seeded on the lineage, so an unsaved character reads the same here and in
  // the edit modal.
  const lineageKey = item.lineageId ?? item.id
  const isDerived = !!item.lineageId
  const sourcePortrait = characterHistory.find((h) => h.id === lineageKey && h.kind !== 'sheet')
  const sourceModelName = sourcePortrait?.linkedModelId
    ? models.find((m) => m.id === sourcePortrait.linkedModelId)?.name
    : undefined
  function suggestSaveName(): string {
    const taken = models.map((m) => m.name)
    const base = sourceModelName ?? pickInfluencerName(item.profile.gender, lineageKey)
    if (isSheet) return uniqueBankName(sheetNameFrom(base), taken)
    if (isDerived) return variantNameFrom(base, item.styleName, taken)
    return uniqueBankName(base, taken)
  }

  function openNameInput() {
    if (savingToBank) return
    setNameDraft(suggestSaveName())
  }

  // Toggle: clicking Save when already saved removes the linked Bank entry
  // (keeping this gallery image) so it can be re-saved afterwards.
  async function toggleSave() {
    if (savingToBank) return
    if (!savedAsModel) { openNameInput(); return }
    setSavingToBank(true)
    try {
      if (linkedModel) await deleteModel(linkedModel.id)
      await updateCharacterHistory(item.id, { linkedModelId: undefined })
    } catch (err) {
      addToast(humanizeError(err, 'Failed to remove from Bank'), 'error')
    } finally {
      setSavingToBank(false)
    }
  }

  async function commitSave() {
    const name = (nameDraft ?? '').trim()
    if (!name || savingToBank) return
    setSavingToBank(true)
    try {
      await addModel({
        name,
        characterImage: item.imageRef,
        // A saved sheet doubles as its own reference, so stamp it as the
        // entry's sheetImage too — downstream apps prefer it for consistency.
        ...(isSheet ? { sheetImage: item.imageRef } : {}),
        notes: '',
        source: 'character-studio',
        jsonProfile: buildJsonPrompt(item.profile) as Record<string, unknown>,
      })
      const justAdded = useBankStore.getState().models.find(
        (m) => m.characterImage === item.imageRef && m.name === name,
      )
      if (justAdded) await updateCharacterHistory(item.id, { linkedModelId: justAdded.id })
      setNameDraft(null)
    } catch (err) {
      addToast(humanizeError(err, 'Save failed'), 'error')
    } finally {
      setSavingToBank(false)
    }
  }

  // Arming/confirming lives in TileDeleteButton — this just performs the
  // delete and tracks the in-flight state so the button can show a spinner.
  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      await onDelete()
    } catch {
      setDeleting(false)
    }
  }

  async function handleDownload() {
    const resolved = await getUrl(item.imageRef)
    if (!resolved) return
    await downloadImage(resolved, `${isSheet ? 'character-sheet' : 'character'}-${item.id}`)
  }

  return {
    url, status,
    isSheet, savedAsModel,
    savingToBank, nameDraft, setNameDraft, commitSave, openNameInput, toggleSave,
    deleting, confirmingDelete, setConfirmingDelete, confirmDelete,
    handleDownload,
  }
}

// Inline name input shown while a save is being named — same controls in both
// views, wrapped by each with its own container positioning.
function NameEditor({
  nameDraft,
  setNameDraft,
  onCommit,
  onCancel,
  saving,
  dark,
}: {
  nameDraft: string
  setNameDraft: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  saving: boolean
  dark?: boolean
}) {
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const id = window.setTimeout(() => nameInputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`flex w-full items-center gap-1 rounded-full border py-1 pl-2.5 pr-1 ${
        dark ? 'border-white/15 bg-black/70 backdrop-blur' : 'border-ink/10 bg-ink/[0.04]'
      }`}
    >
      <input
        ref={nameInputRef}
        type="text"
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onCommit() }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        placeholder="Name this character"
        disabled={saving}
        className={`min-w-0 flex-1 bg-transparent text-[11px] font-medium focus:outline-none ${
          dark ? 'text-zinc-100 placeholder:text-zinc-500' : 'text-ink-100 placeholder:text-ink-500'
        }`}
      />
      <button
        type="button"
        title="Cancel"
        onClick={onCancel}
        disabled={saving}
        className={`flex h-5 w-5 items-center justify-center rounded-full ${
          dark ? 'text-zinc-400 hover:bg-white/10 hover:text-zinc-200' : 'text-ink-400 hover:bg-ink/10 hover:text-ink-200'
        }`}
      >
        <X className="h-3 w-3" />
      </button>
      <button
        type="button"
        title="Save"
        onClick={onCommit}
        disabled={saving || !nameDraft.trim()}
        className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/80 text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      </button>
    </div>
  )
}

// ── Single view ─────────────────────────────────────────────────

function ratioOf(ar: string): number {
  if (ar.includes('16:9')) return 16 / 9
  if (ar.includes('1:1')) return 1
  return 9 / 16
}

// Sizes the single view's media frame so it hugs the picture exactly: the frame
// keeps the output's aspect ratio and fills whichever axis runs out first, which
// puts the badge and the glow on the image's own edges instead of stranding them
// in letterbox space. CSS alone can't do it — `aspect-ratio` needs one definite
// axis, and a fixed choice either distorts the box (a 16:9 sheet in a tall
// panel) or overflows it. Measures the container, never the frame, so setting
// the frame's size can't feed back into the measurement.
function useFitFrame(aspectRatio: string) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [fit, setFit] = useState<'width' | 'height'>('height')
  const ratio = ratioOf(aspectRatio)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width === 0 || height === 0) return
      setFit(width / height < ratio ? 'width' : 'height')
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ratio])

  const frameStyle: React.CSSProperties = fit === 'width'
    ? { width: '100%', aspectRatio: ratio }
    : { height: '100%', aspectRatio: ratio }

  return { containerRef, frameStyle }
}

// The graph-paper stage every single-view frame sits on: the picture floats on
// a faint grid instead of butting against the panel, which is what makes one
// image on an otherwise empty column read as a deliberate composition. Hands
// its children the fitted frame style (see `useFitFrame`).
function Stage({
  aspectRatio,
  children,
}: {
  aspectRatio: string
  children: (frameStyle: React.CSSProperties) => React.ReactNode
}) {
  const { containerRef, frameStyle } = useFitFrame(aspectRatio)
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.02] p-4">
      <div aria-hidden className="stage-grid pointer-events-none absolute inset-0" />
      <div ref={containerRef} className="relative flex h-full w-full items-center justify-center">
        {children(frameStyle)}
      </div>
    </div>
  )
}

// The distraction-free view: one generation, nothing else. Whatever is
// happening right now — the newest in-flight gen if one is running, otherwise
// the newest finished character — fills the panel, so a screen recording shows
// the character being made and not the reel of everything made before it. The
// history is untouched; the toggle brings it back.
function SingleView({
  inFlight,
  item,
  onCancelGen,
  onOpenGen,
  onClick,
  onDelete,
  onMakeSheet,
  onCopyPrompt,
}: {
  inFlight: InFlightCharacterGen[]
  item: CharacterHistoryItem | undefined
  onCancelGen: (id: string) => void
  onOpenGen: (id: string) => void
  onClick: () => void
  onDelete: () => void | Promise<unknown>
  onMakeSheet: () => void
  onCopyPrompt: () => void
}) {
  // Parallel gens are allowed, so show the one started last and only count the
  // rest — a queue of tiles is exactly the clutter this view exists to avoid.
  const active = inFlight.length > 0 ? inFlight[inFlight.length - 1] : undefined
  const others = Math.max(0, inFlight.length - 1)

  return (
    // min-h carries the mobile layout, where the column isn't height-constrained
    // and a flex-1 media frame sized by `height: 100%` would collapse to nothing.
    <div className="flex min-h-[420px] flex-1 flex-col gap-3 px-4 py-4">
      {active ? (
        <>
          <SingleInFlight gen={active} onCancel={() => onCancelGen(active.id)} onClick={() => onOpenGen(active.id)} />
          <PromptData profile={active.profile as CharacterProfile | undefined} />
          <p className="text-center text-[10px] font-medium tracking-wider text-influencers-300">
            {others > 0 ? `Generating · +${others} more in the queue` : 'Generating…'}
          </p>
        </>
      ) : item ? (
        <SingleCard
          item={item}
          onClick={onClick}
          onDelete={onDelete}
          onMakeSheet={onMakeSheet}
          onCopyPrompt={onCopyPrompt}
        />
      ) : (
        <AwaitingFrame />
      )}
    </div>
  )
}

// The cleared frame: what the + button leaves behind, and what the view shows
// before the first generation of a recording session.
function AwaitingFrame() {
  return (
    <Stage aspectRatio="9:16">
      {() => (
        <div className="flex flex-col items-center justify-center gap-2">
          <UserRound className="h-8 w-8 text-ink-800" strokeWidth={1.5} />
          <p className="text-sm text-ink-500">Awaiting generation</p>
          <p className="max-w-[280px] text-center text-xs leading-relaxed text-ink-600">
            The next character lands here. Nothing was deleted — switch to List
            or Grid for the full history.
          </p>
        </div>
      )}
    </Stage>
  )
}

// The running generation, at the shape it will land in: the frame is already
// the output's aspect ratio, and the scanning sweep + accent glow read as the
// picture being developed inside it.
function SingleInFlight({ gen, onCancel, onClick }: { gen: InFlightCharacterGen; onCancel: () => void; onClick: () => void }) {
  return (
    <Stage aspectRatio={gen.aspectRatio}>
      {(frameStyle) => (
        <div
          className="relative overflow-hidden rounded-xl shadow-[0_0_60px_-28px_rgba(247,79,158,0.35)]"
          style={frameStyle}
        >
          <GeneratingTile
            modelId={gen.modelId}
            kind={gen.kind}
            aspectRatio={gen.aspectRatio}
            onCancel={onCancel}
            onClick={onClick}
            fill
          />
        </div>
      )}
    </Stage>
  )
}

// The newest finished character, as large as the panel allows, over its prompt
// data and a row of named actions. The grid and list views hide the same actions
// behind hover icons — here they're spelled out, because this is the view that's
// on camera and the one where there's room for them.
function SingleCard({
  item,
  onClick,
  onDelete,
  onMakeSheet,
  onCopyPrompt,
}: {
  item: CharacterHistoryItem
  onClick: () => void
  onDelete: () => void | Promise<unknown>
  onMakeSheet: () => void
  onCopyPrompt: () => void
}) {
  const a = useHistoryTileActions(item, onDelete)

  return (
    <>
      <Stage aspectRatio={item.aspectRatio}>
        {(frameStyle) => (
          <div
            onClick={onClick}
            className="group relative cursor-pointer overflow-hidden rounded-xl border border-ink/10 bg-black light:bg-zinc-200 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.75)]"
            style={frameStyle}
          >
            {a.status === 'ready' && a.url ? (
              <img src={a.url} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-contain" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                {a.status === 'loading'
                  ? <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
                  : <ImageIcon className="h-7 w-7 text-zinc-700" />}
              </div>
            )}
            <SourceBadge isSheet={a.isSheet} savedAsModel={a.savedAsModel} />
            {/* Delete rides the picture's own top-right corner, the same place
                it sits on every other media tile in the app — not in the row of
                named actions below, where it was the one destructive control
                among five safe ones and threw their centring off. */}
            <TileActionStack forceVisible={a.deleting}>
              <TileDeleteButton onDelete={a.confirmDelete} busy={a.deleting} />
            </TileActionStack>
          </div>
        )}
      </Stage>

      {a.nameDraft !== null ? (
        <div className="mx-auto w-full max-w-[340px]">
          <NameEditor
            nameDraft={a.nameDraft}
            setNameDraft={a.setNameDraft}
            onCommit={a.commitSave}
            onCancel={() => a.setNameDraft(null)}
            saving={a.savingToBank}
          />
        </div>
      ) : (
        // Named actions only, so they centre on the picture above them. Delete
        // used to sit at the end of this row, reserving 32px it never drew
        // (its hover reveal needed a `group` this row didn't have) and pushing
        // the whole row left of centre; it lives on the image now.
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <ActionPill
            icon={a.savingToBank ? Loader2 : a.savedAsModel ? Check : Bookmark}
            label={a.savedAsModel ? 'Saved' : 'Save to Bank'}
            title={a.savedAsModel ? 'Saved — click to remove from Bank' : 'Save to Bank'}
            tone={a.savedAsModel ? 'saved' : 'default'}
            spin={a.savingToBank}
            onClick={a.toggleSave}
          />
          <ActionPill icon={Download} label="Download" onClick={a.handleDownload} />
          <ActionPill icon={Copy} label="Copy prompt" onClick={onCopyPrompt} />
          {/* Same destination as clicking the picture — spelled out, because in
              this view the image reads as a still rather than a button. */}
          <ActionPill
            icon={Pencil}
            label="Edit character"
            title="Edit this character"
            onClick={onClick}
          />
          {!a.isSheet && (
            <ActionPill
              icon={LayoutGrid}
              label="Character sheet"
              title="Make a character sheet from this portrait"
              onClick={onMakeSheet}
            />
          )}
        </div>
      )}

      <PromptData profile={item.profile} />

      <p className="truncate text-center text-[10px] font-medium tracking-wider text-ink-500">
        {formatRelative(item.createdAt)}
      </p>
    </>
  )
}

// Named pill button — the single view's spelled-out version of a tile action.
function ActionPill({
  icon: Icon,
  label,
  title,
  onClick,
  tone = 'default',
  spin = false,
}: {
  icon: React.ElementType
  label: string
  title?: string
  onClick: () => void
  tone?: 'default' | 'saved'
  spin?: boolean
}) {
  const toneClass = tone === 'saved'
    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300 light:text-emerald-700'
    : 'border-ink/10 bg-ink/[0.03] text-ink-300 hover:bg-ink/[0.08] hover:text-ink-100'
  return (
    <button
      type="button"
      title={title ?? label}
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium tracking-tight transition-colors ${toneClass}`}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${spin ? 'animate-spin' : ''}`} />
      {label}
    </button>
  )
}

// The generation's parameters as JSON, folded away behind a row. Collapsed by
// default — the picture is what this view is for — and open it to read or copy
// the exact object the prompt was built from.
function PromptData({ profile }: { profile: CharacterProfile | undefined }) {
  const [open, setOpen] = useState(false)
  if (!profile) return null

  const json = JSON.stringify(buildJsonPrompt(profile), null, 2)

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(json)
      useAppStore.getState().addToast('Prompt JSON copied', 'success')
    } catch {
      useAppStore.getState().addToast('Could not copy the JSON', 'error')
    }
  }

  return (
    <div className="shrink-0">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-ink/10 bg-ink/[0.03] px-3 text-[12px] font-medium tracking-tight text-ink-300 transition-colors hover:bg-ink/[0.08] hover:text-ink-100"
        >
          <Braces className="h-3.5 w-3.5 shrink-0 text-ink-500" />
          <span className="truncate">Prompt data</span>
          <ChevronDown className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && <ActionPill icon={Copy} label="Copy JSON" onClick={copyJson} />}
      </div>
      {open && (
        <pre className="mt-1.5 max-h-44 overflow-auto rounded-2xl border border-ink/10 bg-ink/[0.03] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-400">
          {json}
        </pre>
      )}
    </div>
  )
}

// ── Grid tile ───────────────────────────────────────────────────

// A generation that hasn't landed yet, shaped as the history row it is about to
// become — the anchor the editor opens on when an in-flight tile is clicked.
// `finishGen` writes the real row under this same id, so the editor re-resolves
// to it on arrival with nothing to re-target and no remount. `imageRef` is
// deliberately empty: that's the flag the editor reads to know it has no base
// image yet, and it keeps Generate disabled until one exists.
function pendingItemFromGen(gen: InFlightCharacterGen): CharacterHistoryItem {
  return {
    id: gen.id,
    imageRef: '',
    profile: (gen.profile as CharacterProfile | undefined) ?? createEmptyProfile(),
    modelId: gen.modelId,
    aspectRatio: gen.aspectRatio,
    resolution: gen.resolution,
    kind: gen.kind ?? 'portrait',
    lineageId: gen.lineageId,
    styleName: gen.styleName,
    createdAt: gen.startedAt,
  }
}

function HistoryTile({
  item,
  onClick,
  onDelete,
  onMakeSheet,
  onCopyPrompt,
  onShowInSingle,
}: {
  item: CharacterHistoryItem
  onClick: () => void
  onDelete: () => void | Promise<unknown>
  onMakeSheet: () => void
  onCopyPrompt: () => void
  onShowInSingle: () => void
}) {
  const a = useHistoryTileActions(item, onDelete)

  return (
    <div
      onClick={onClick}
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-ink/10 bg-black light:bg-zinc-200 transition-all hover:border-ink/20 hover:-translate-y-px card-soft-shadow"
    >
      {a.status === 'ready' && a.url ? (
        <img src={a.url} alt="" loading="lazy" decoding="async" className="block h-auto w-full" />
      ) : (
        <div className="flex w-full items-center justify-center" style={aspectStyle(item.aspectRatio)}>
          {a.status === 'loading'
            ? <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
            : <ImageIcon className="h-6 w-6 text-zinc-700" />}
        </div>
      )}

      <SourceBadge isSheet={a.isSheet} savedAsModel={a.savedAsModel} />

      {/* Hover actions — the shared tile stack (components/tileActions). Order
          is the app-wide standard: Download · Save · Copy · extras · Delete.
          The inline name input takes over the bottom edge while a save is
          being named, so the stack steps aside for it. */}
      {a.nameDraft === null && (
        <TileActionStack forceVisible={a.deleting || a.confirmingDelete}>
          <TileActionButton title="Download image" onClick={() => a.handleDownload()}>
            <Download className="h-4 w-4" />
          </TileActionButton>
          <TileActionButton
            title={a.savedAsModel ? 'Saved — click to remove from Bank' : a.savingToBank ? 'Saving…' : 'Save to Bank'}
            tone={a.savedAsModel ? 'saved' : 'default'}
            onClick={() => a.toggleSave()}
          >
            {a.savingToBank ? <Loader2 className="h-4 w-4 animate-spin" /> : a.savedAsModel ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          </TileActionButton>
          <TileActionButton title="Copy prompt" onClick={() => onCopyPrompt()}>
            <Copy className="h-4 w-4" />
          </TileActionButton>
          <TileActionButton title="Show this one in Single view" onClick={() => onShowInSingle()}>
            <Frame className="h-4 w-4" />
          </TileActionButton>
          {!a.isSheet && (
            <TileActionButton
              title="Make a character sheet from this portrait"
              onClick={() => onMakeSheet()}
            >
              <LayoutGrid className="h-4 w-4" />
            </TileActionButton>
          )}
          <TileDeleteButton onDelete={a.confirmDelete} busy={a.deleting} onArmedChange={a.setConfirmingDelete} />
        </TileActionStack>
      )}

      {/* Inline name input — takes over the bottom edge while a save is being
          named (portraits and sheets alike). */}
      {a.nameDraft !== null && (
        <div className="absolute inset-x-2 bottom-2">
          <NameEditor
            dark
            nameDraft={a.nameDraft}
            setNameDraft={a.setNameDraft}
            onCommit={a.commitSave}
            onCancel={() => a.setNameDraft(null)}
            saving={a.savingToBank}
          />
        </div>
      )}
    </div>
  )
}

// Sheet / Saved badge overlaid on the media top-left. Shared by the grid tile
// and the list row.
function SourceBadge({ isSheet, savedAsModel }: { isSheet: boolean; savedAsModel: boolean }) {
  if (isSheet) {
    return (
      <div
        title={savedAsModel ? 'Sheet saved to Characters bank' : 'Character sheet'}
        className={`absolute left-1.5 top-1.5 flex h-6 items-center gap-1 rounded-full px-2 text-[9px] font-medium backdrop-blur ${
          savedAsModel ? 'bg-emerald-500/30 text-emerald-100' : 'bg-black/60 text-zinc-200'
        }`}
      >
        <LayoutGrid className="h-3 w-3" strokeWidth={2} />
        Sheet
        {savedAsModel && <Check className="h-3 w-3" strokeWidth={2.5} />}
      </div>
    )
  }
  if (savedAsModel) {
    return (
      <div
        title="Saved to Characters bank"
        className="absolute left-1.5 top-1.5 flex h-6 items-center gap-1 rounded-full bg-emerald-500/30 px-2 text-[9px] font-medium text-emerald-100 backdrop-blur"
      >
        <Bookmark className="h-3 w-3" strokeWidth={2} />
        Saved
      </div>
    )
  }
  return null
}

// ── List row ────────────────────────────────────────────────────

// One generation as a full-width row: a large image taking two-thirds of the
// width (letterboxed on black, click to edit) and a side panel (the remaining
// third) with the model, prompt, metadata, and actions. The header slider drives
// `cardHeight`. Mirrors the Playground's List view.
function HistoryListRow({
  item,
  mediaAspect,
  onClick,
  onDelete,
  onMakeSheet,
  onCopyPrompt,
  onShowInSingle,
}: {
  item: CharacterHistoryItem
  mediaAspect: number
  onClick: () => void
  onDelete: () => void | Promise<unknown>
  onMakeSheet: () => void
  onCopyPrompt: () => void
  onShowInSingle: () => void
}) {
  const a = useHistoryTileActions(item, onDelete)
  const prompt = buildImagePrompt(item.profile).trim()

  // Landscape (16:9) outputs always render in a 16:9 frame so they fill edge-to-
  // edge with no letterbox bars, whatever the slider is set to. Only portraits
  // follow the slider-driven aspect (taller as it moves right).
  const frameAspect = item.aspectRatio.includes('16:9') ? 16 / 9 : mediaAspect

  const meta: string[] = []
  if (item.resolution) meta.push(item.resolution)
  if (item.aspectRatio) meta.push(item.aspectRatio)

  return (
    <div className="flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.02] card-soft-shadow">
      {/* Media — fixed-width column whose height is the slider-driven aspect
          ratio. At the slider minimum it's 16:9 so landscape fills with no bars;
          taller frames letterbox landscape on black and grow portraits. The
          side panel keeps enough width for the action row to stay on one line. */}
      <div className="relative min-w-0 flex-[5] bg-black light:bg-[#EAEAEC]" style={{ aspectRatio: frameAspect }}>
        {a.status === 'ready' && a.url ? (
          <img
            src={a.url}
            alt=""
            loading="lazy"
            decoding="async"
            onClick={onClick}
            className="absolute inset-0 h-full w-full cursor-pointer object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {a.status === 'loading'
              ? <Loader2 className="h-6 w-6 animate-spin text-ink-600" />
              : <ImageIcon className="h-7 w-7 text-ink-700" />}
          </div>
        )}
        <SourceBadge isSheet={a.isSheet} savedAsModel={a.savedAsModel} />
      </div>

      {/* Side panel — slimmer (the remaining quarter): model, prompt, meta,
          actions. Its content is absolutely filled so the panel contributes no
          intrinsic height — the media's aspect ratio alone drives the row height
          (otherwise a long prompt would stretch the media past 16:9). The prompt
          scrolls within the stretched panel. */}
      <div className="relative min-w-0 flex-[2]">
        <div className="absolute inset-0 flex flex-col gap-2 py-3 pr-3">
        {meta.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {meta.map((m) => (
              <span key={m} className="rounded-full bg-ink/[0.06] px-1.5 py-0.5 text-[9px] font-medium text-ink-400">{m}</span>
            ))}
          </div>
        )}
        {prompt && (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-ink/[0.03] px-3 py-2 text-[12px] leading-relaxed text-ink-300">
            {prompt}
          </div>
        )}
        {a.nameDraft !== null ? (
          <NameEditor
            nameDraft={a.nameDraft}
            setNameDraft={a.setNameDraft}
            onCommit={a.commitSave}
            onCancel={() => a.setNameDraft(null)}
            saving={a.savingToBank}
          />
        ) : (
          // Canonical action order, kept on one centered line: download · save ·
          // copy · make-sheet · delete (delete last). Buttons are compact so the
          // narrow side panel never wraps them onto a second row.
          <div className="flex flex-nowrap items-center justify-center gap-1">
            <ListRowButton title="Download image" onClick={a.handleDownload}>
              <Download className="h-3.5 w-3.5" />
            </ListRowButton>
            <ListRowButton
              title={a.savedAsModel ? 'Saved — click to remove from Bank' : a.savingToBank ? 'Saving…' : 'Save to Bank'}
              tone={a.savedAsModel ? 'saved' : 'default'}
              onClick={a.toggleSave}
            >
              {a.savingToBank ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : a.savedAsModel ? <Check className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
            </ListRowButton>
            <ListRowButton title="Copy prompt" onClick={onCopyPrompt}>
              <Copy className="h-3.5 w-3.5" />
            </ListRowButton>
            <ListRowButton title="Show this one in Single view" onClick={onShowInSingle}>
              <Frame className="h-3.5 w-3.5" />
            </ListRowButton>
            {!a.isSheet && (
              <ListRowButton title="Make a character sheet from this portrait" onClick={onMakeSheet}>
                <LayoutGrid className="h-3.5 w-3.5" />
              </ListRowButton>
            )}
            <TileDeleteButton variant="chrome" onDelete={a.confirmDelete} busy={a.deleting} />
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

// In-flight generation as a list row — placeholder + progress, matching the
// finished-row layout (2/3 media · 1/3 info) so the feed doesn't jump.
function InFlightRow({ gen, mediaAspect, onCancel, onClick }: { gen: InFlightCharacterGen; mediaAspect: number; onCancel: () => void; onClick: () => void }) {
  // Match HistoryListRow: landscape gens keep a 16:9 frame; portraits follow the
  // slider so the in-flight placeholder doesn't jump when the result lands.
  const frameAspect = gen.aspectRatio.includes('16:9') ? 16 / 9 : mediaAspect
  return (
    <div className="flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border border-influencers-500/20 bg-influencers-500/[0.04] card-soft-shadow">
      <div className="relative min-w-0 flex-[5]" style={{ aspectRatio: frameAspect }}>
        <GeneratingTile modelId={gen.modelId} kind={gen.kind} aspectRatio={gen.aspectRatio} onCancel={onCancel} onClick={onClick} fill />
      </div>
      <div className="flex min-w-0 flex-[2] flex-col justify-center gap-2 py-3 pr-3">
        <span className="text-[12px] font-semibold tracking-wide text-influencers-200">
          {getModel(gen.modelId)?.displayName ?? gen.modelId}
        </span>
        <span className="text-[11px] text-ink-500">{gen.kind === 'sheet' ? 'Character sheet' : 'Character'}</span>
      </div>
    </div>
  )
}

// Round 32px hover icon button — mirrors the B-Roll tile cluster so gallery
// tiles read the same across apps.
// Round icon button for list rows — tuned for the lighter list surface (no media
// backdrop to sit over). Mirrors the Playground list row buttons.
function ListRowButton({
  children,
  onClick,
  title,
  tone = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  tone?: 'default' | 'saved'
}) {
  const toneClass = tone === 'saved'
    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300 light:text-emerald-700'
    : 'border-ink/10 bg-ink/[0.03] text-ink-300 hover:bg-ink/[0.08] hover:text-ink-100'
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${toneClass}`}
    >
      {children}
    </button>
  )
}

function InFlightTile({ gen, onCancel, onClick }: { gen: InFlightCharacterGen; onCancel: () => void; onClick: () => void }) {
  return <GeneratingTile modelId={gen.modelId} kind={gen.kind} aspectRatio={gen.aspectRatio} onCancel={onCancel} onClick={onClick} />
}
