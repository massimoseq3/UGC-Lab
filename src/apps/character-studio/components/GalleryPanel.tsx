import { memo, useMemo, useRef, useState, useEffect } from 'react'
import { Image as ImageIcon, UserRound, Bookmark, X, Download, Check, Copy, LayoutGrid, List, Maximize2, RectangleVertical, Plus, Braces, ChevronDown, Pencil, Frame, History, CornerDownLeft } from 'lucide-react'
import Spinner from '../../../components/Spinner'
import { useBankStore } from '../../../stores/bankStore'
import { useAssetUrlState, useAssetThumb } from '../../../hooks/useAssetUrl'
import useNearViewport from '../../../hooks/useNearViewport'
import { getUrl } from '../../../utils/assetStore'
import { useAppStore } from '../../../stores/appStore'
import { usePersistedState } from '../../../hooks/usePersistedState'
import { humanizeError } from '../../../utils/friendlyError'
import { sectionLabel, groupByDay, formatRelative } from '../../../utils/history'
import type { CharacterHistoryItem } from '../../../stores/types'
import { createEmptyProfile, type CharacterProfile, type InFlightCharacterGen, type LaunchGenOptions } from '../types'
import { getModel } from '../../../utils/models'
import SegmentedToggle from '../../../components/SegmentedToggle'
import { TileActionStack, TileActionButton, TileDeleteButton, TileMenuButton, TileMenuItem } from '../../../components/tileActions'
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

export type GalleryViewMode = 'single' | 'list' | 'grid'
type ViewMode = GalleryViewMode

interface GalleryPanelProps {
  inFlight: InFlightCharacterGen[]
  // Owned by CharacterStudio (same localStorage key it has always used), because
  // Generate moves the member to the view that can show what they just fired.
  viewMode: ViewMode
  onViewModeChange: (v: ViewMode) => void
  onCancelGen: (id: string) => void
  onLaunchGen: (opts: LaunchGenOptions) => void
  // Put a finished character's parameters back in the left-hand form. Lives in
  // CharacterStudio because the form does; stable, like the two above it, or
  // this memoized panel would re-render its whole history on every keystroke.
  onReuseProfile: (profile: Record<string, string>) => void
}

// One cell on the Single stage: a generation still running, or a finished
// character. A batch mixes both while it lands, which is the whole reason the
// stage takes a list rather than one of each.
type StageSlot =
  | { key: string; order: number; kind: 'gen'; gen: InFlightCharacterGen }
  | { key: string; order: number; kind: 'item'; item: CharacterHistoryItem }

// A generation with no batch stamp is a group of one keyed by its own id, so
// nothing below has to special-case "a batch of one".
function batchKeyOf(entry: { id: string; batchId?: string }): string {
  return entry.batchId ?? entry.id
}

// Memoized: this panel renders every character the member has ever generated
// (characterHistory is uncapped) and it sits beside a ~28-field form. Without
// the bail-out, one keystroke in the form re-rendered the whole history — each
// row with its own asset lookup. All three props are stable while typing (the
// parent useCallback's both handlers), so the subtree is skipped entirely.
export default memo(function GalleryPanel({
  inFlight,
  viewMode,
  onViewModeChange: setViewMode,
  onCancelGen,
  onLaunchGen,
  onReuseProfile,
}: GalleryPanelProps) {
  // The editor is anchored by ID, not by a snapshot of the row: a generation
  // can be opened while it's still running, and `finishGen` writes its history
  // row under the generation's own id — so the same anchor resolves to the
  // pending gen first and the finished row the moment it lands.
  const [previewId, setPreviewId] = useState<string | null>(null)
  // The gallery's scroll port, handed to every tile so its media waits until
  // the tile is near the window (see useHistoryTileActions).
  const galleryScrollRef = useRef<HTMLDivElement | null>(null)
  // Which mode the edit pop-up opens in. "Make Sheet" on a tile opens straight
  // into sheet mode so the user just hits Generate; a normal click is edit.
  const [previewMode, setPreviewMode] = useState<'edit' | 'sheet'>('edit')

  // Single (just what's happening now) vs Grid (masonry) vs List (stacked
  // rows). Grid/List mirror the Playground's switch; Single is the
  // distraction-free view for screen recording, where a full history of past
  // characters is on camera. The state itself lives in CharacterStudio.
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

  // What the Single stage holds. One press of Generate can fire up to four
  // characters, and they finish one at a time — so the stage is a LIST of
  // slots, drawn from the in-flight queue and the history bank together, and
  // a cell simply swaps from generating to a picture where it stands.
  //
  // Which group: whatever is running (the newest gen names its batch), else
  // the batch the newest finished character belongs to. A pinned character is
  // the exception — a pin is one face someone chose to have on camera, not a
  // run — so it stays a single cell.
  const activeGen = inFlight.length > 0 ? inFlight[inFlight.length - 1] : undefined
  const stageKey = frameCleared ? undefined
    : activeGen ? batchKeyOf(activeGen)
    : pinnedItem ? undefined
    : singleItem ? batchKeyOf(singleItem)
    : undefined

  let stageSlots: StageSlot[]
  if (stageKey !== undefined) {
    stageSlots = [
      ...inFlight
        .filter((g) => batchKeyOf(g) === stageKey)
        .map((gen): StageSlot => ({ key: gen.id, order: gen.batchIndex ?? 0, kind: 'gen', gen })),
      ...characterHistory
        .filter((h) => batchKeyOf(h) === stageKey)
        .map((item): StageSlot => ({ key: item.id, order: item.batchIndex ?? 0, kind: 'item', item })),
    ].sort((a, b) => a.order - b.order)
  } else {
    stageSlots = singleItem ? [{ key: singleItem.id, order: 0, kind: 'item', item: singleItem }] : []
  }

  // Gens that belong to some OTHER run — a second batch fired while this one is
  // still going, or an edit-modal generation. Reported as a count rather than
  // crowding the stage, exactly as a queue was before batches existed.
  const queuedElsewhere = inFlight.length - stageSlots.filter((s) => s.kind === 'gen').length

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

  // The bar is PINNED OVER the body and frosted only where something scrolls
  // under it — the Grid and List galleries (Massimo's call, September 2026: the
  // shape B-Roll's storyboard bar already has, so the wall of stills reads as
  // one surface running the height of the pane rather than as a panel bolted
  // under a strip). Single view is a fixed stage and the empty state is a
  // centred canvas: neither scrolls, so there is nothing for the bar to be in
  // front OF, and floating it there would only push its hairline down over
  // artwork. Those two keep the plain laid-out band.
  const bodyScrolls = !isEmpty && viewMode !== 'single'

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      {/* Header — card-size slider (list view only) + view switch (Grid / List).
          Renders even when the gallery is empty: every other app keeps a
          h-[57px] bar on BOTH panes, so hiding it here left the two columns'
          divider lines out of alignment on a fresh visit.

          `app-backdrop-frost` is the one definition of that material — the
          page's own gradient at 90% plus the blur on a pseudo-element, which is
          what keeps the tint anchored to the viewport (see the note beside it
          in index.css). `absolute` rather than `sticky`: this bar never scrolls
          away, and the app-wide rule is that chrome which doesn't move
          shouldn't be sticky. */}
      <div
        className={`flex h-[57px] items-center justify-end gap-3 border-b border-ink/5 px-4 ${
          bodyScrolls ? 'absolute inset-x-0 top-0 z-20 app-backdrop-frost' : 'shrink-0'
        }`}
      >
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
                  aria-label="List Card Size"
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
          title="No Generations Yet"
          // No "on the left" — on a phone the controls are the other tab, not a
          // column beside this one.
          hint="Fill in the Controls and hit Generate. Every character you make lands here, sorted by day."
        />
      ) : viewMode === 'single' ? (
        // Every callback targets the item ACTUALLY on the stage. They used to
        // read characterHistory[0] directly, which was the same row only
        // because the stage was always the newest one; with a pin it would
        // delete or edit a character the member isn't looking at.
        <SingleView
          slots={stageSlots}
          queuedElsewhere={queuedElsewhere}
          onCancelGen={onCancelGen}
          onOpen={(id) => openEditor(id)}
          onDelete={(item) => deleteCharacterHistory(item.id)}
          onMakeSheet={(item) => openEditor(item.id, 'sheet')}
          onCopyPrompt={(item) => handleCopyPrompt(item)}
          onReuse={(item) => onReuseProfile(item.profile)}
          onShowInSingle={showInSingle}
        />
      ) : (
        <>
          {/* Scrollable gallery. The ref is the IntersectionObserver root every
              tile below observes against: ancestor clipping is applied before
              `rootMargin`, so an observer left on the viewport would only fire
              once a tile was already on screen and the picture would pop in
              under the pointer. */}
          {/* The scroll port runs the FULL height of the pane, behind the
              absolute bar, which is what lets tiles pass under it blurred.
              `pt-[69px]` is the bar's own 57px plus the 12px the content
              already stood off by — change the bar's height and change this
              with it. */}
          <div ref={galleryScrollRef} className="min-w-0 flex-1 overflow-y-auto px-4 pb-3 pt-[69px]">
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
                          scrollRoot={galleryScrollRef}
                          onClick={() => openEditor(item.id)}
                          onDelete={() => deleteCharacterHistory(item.id)}
                          onMakeSheet={() => openEditor(item.id, 'sheet')}
                          onCopyPrompt={() => handleCopyPrompt(item)}
                          onReuse={() => onReuseProfile(item.profile)}
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
                        scrollRoot={galleryScrollRef}
                        mediaAspect={mediaAspect}
                        onClick={() => openEditor(item.id)}
                        onDelete={() => deleteCharacterHistory(item.id)}
                        onMakeSheet={() => openEditor(item.id, 'sheet')}
                        onCopyPrompt={() => handleCopyPrompt(item)}
                        onReuse={() => onReuseProfile(item.profile)}
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
// `near` is how a LIST keeps its media cost proportional to the window rather
// than to the history. The gallery is uncapped, so a working member's grid is
// hundreds of tiles — and every one of them used to resolve its blob and hand
// the browser a full-size picture to decode on mount, with about nine on screen.
// `loading="lazy"` does not help: it defers a FETCH, and by the time the <img>
// exists the blob URL has already been made. Gating the resolution itself is
// what actually keeps the decode off, and the placeholder branch below is
// already sized by `aspectStyle` / the row's own `aspectRatio`, so a tile
// waiting its turn holds exactly the shape it will fill — the scroll height
// never changes and nothing jumps as pictures arrive.
//
// Defaults to true so the callers with ONE item (the Single stage) are
// unchanged; only the grid and list rows pass a scroller to observe against.
// Re-entering the viewport is instant rather than a second read: the component
// stays mounted while it waits, so useAssetUrlState still holds the resolved
// entry for this ref and hands it straight back.
//
// This gates the PICTURE only. `handleDownload` re-resolves through getUrl on
// its own, so every action on the tile works the same whether it has painted
// or not.
// `full` asks for the ORIGINAL file rather than the grid-sized thumbnail
// (utils/mediaThumbs). The grid tile and the list row show the thumbnail —
// it's what keeps a wall of 4K portraits from being re-decoded every time the
// column scrolls back over them — and the Single stage, where one picture is
// judged large, shows the original. Downloads always re-resolve the original.
function useHistoryTileActions(
  item: CharacterHistoryItem,
  onDelete: () => void | Promise<unknown>,
  near = true,
  full = false,
) {
  const thumb = useAssetThumb(near && !full ? item.imageRef : undefined)
  const original = useAssetUrlState(near && full ? item.imageRef : undefined)
  const { url, status } = full ? original : thumb
  const addModel = useBankStore((s) => s.addModel)
  const deleteModel = useBankStore((s) => s.deleteModel)
  const updateCharacterHistory = useBankStore((s) => s.updateCharacterHistory)
  const models = useBankStore((s) => s.models)
  const characterHistory = useBankStore((s) => s.characterHistory)
  const addToast = useAppStore((s) => s.addToast)
  const [savingToBank, setSavingToBank] = useState(false)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  // Scoped to the item, not a bare boolean. `confirmDelete` deliberately leaves
  // this SET on success — the tile is about to disappear with its row, and
  // clearing it would flash the button back to life on the way out — which is
  // only safe while the tile actually unmounts. The Single view doesn't unmount
  // it: it swaps the item on the stage for the next character, so a bare flag
  // stayed true against a row it was never about, and the `if (deleting) return`
  // guard below then refused every further delete behind a spinner that would
  // never stop.
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const deleting = deletingId === item.id
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
    setDeletingId(item.id)
    try {
      await onDelete()
    } catch {
      setDeletingId(null)
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
        {saving ? <Spinner className="h-3 w-3" /> : <Check className="h-3 w-3" />}
      </button>
    </div>
  )
}

// ── Single view ─────────────────────────────────────────────────

// The frame's shape. A number is a ratio MEASURED off the picture that landed
// and always wins: what the member asked for and what the model returned are
// routinely different shapes — GPT Image 2 answers a 9:16 request with a 2:3
// file — and the frame is only honest about the output if it follows the file.
// The string is the requested ratio, used before a picture exists (an in-flight
// tile, the awaiting frame) and as the placeholder shape until one decodes.
function ratioOf(ar: string | number): number {
  if (typeof ar === 'number') return ar
  if (ar.includes('16:9')) return 16 / 9
  if (ar.includes('1:1')) return 1
  return 9 / 16
}

// The picture's own ratio, read off the decoded file. Null until it lands.
function useNaturalRatio() {
  const [ratio, setRatio] = useState<number | null>(null)
  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (w > 0 && h > 0) setRatio(w / h)
  }
  // For a frame whose picture is drawn by a child component rather than inline.
  return { ratio, onLoad, set: setRatio }
}

// Sizes the single view's media frame so it hugs the picture exactly: the frame
// keeps the output's aspect ratio and fills whichever axis runs out first, which
// puts the badge and the glow on the image's own edges instead of stranding them
// in letterbox space. CSS alone can't do it — `aspect-ratio` needs one definite
// axis, and a fixed choice either distorts the box (a 16:9 sheet in a tall
// panel) or overflows it. Measures the container, never the frame, so setting
// the frame's size can't feed back into the measurement.
function useFitFrame(aspectRatio: string | number) {
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

// A cell that measures itself and hands its child a frame hugging the output's
// aspect ratio. One per picture, so a 2×2 of 9:16 portraits packs each cell
// without letterboxing any of them.
function FittedFrame({
  aspectRatio,
  children,
}: {
  aspectRatio: string | number
  children: (frameStyle: React.CSSProperties) => React.ReactNode
}) {
  const { containerRef, frameStyle } = useFitFrame(aspectRatio)
  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 w-full items-center justify-center">
      {children(frameStyle)}
    </div>
  )
}

// The graph-paper stage every single-view frame sits on: the picture floats on
// a faint grid instead of butting against the panel, which is what makes one
// image on an otherwise empty column read as a deliberate composition.
function StageSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-ink/5 bg-ink/[0.02] p-4">
      <div aria-hidden className="stage-grid pointer-events-none absolute inset-0" />
      {children}
    </div>
  )
}

// The one-picture stage. Hands its children the fitted frame style.
function Stage({
  aspectRatio,
  children,
}: {
  aspectRatio: string | number
  children: (frameStyle: React.CSSProperties) => React.ReactNode
}) {
  return (
    <StageSurface>
      <FittedFrame aspectRatio={aspectRatio}>{children}</FittedFrame>
    </StageSurface>
  )
}

// The batch stage. The grid follows the count the member asked for, because
// that count is the composition: two side by side, three side by side, four as
// a 2×2 — never a wrapping gallery, which is what the Grid view is for.
function stageGridClass(count: number): string {
  if (count >= 4) return 'grid-cols-2 grid-rows-2'
  if (count === 3) return 'grid-cols-3 grid-rows-1'
  return 'grid-cols-2 grid-rows-1'
}

// The distraction-free view: one generation, nothing else. Whatever is
// happening right now — the newest in-flight gen if one is running, otherwise
// the newest finished character — fills the panel, so a screen recording shows
// the character being made and not the reel of everything made before it. The
// history is untouched; the toggle brings it back.
function SingleView({
  slots,
  queuedElsewhere,
  onCancelGen,
  onOpen,
  onDelete,
  onMakeSheet,
  onCopyPrompt,
  onReuse,
  onShowInSingle,
}: {
  slots: StageSlot[]
  queuedElsewhere: number
  onCancelGen: (id: string) => void
  onOpen: (id: string) => void
  onDelete: (item: CharacterHistoryItem) => void | Promise<unknown>
  onMakeSheet: (item: CharacterHistoryItem) => void
  onCopyPrompt: (item: CharacterHistoryItem) => void
  onReuse: (item: CharacterHistoryItem) => void
  onShowInSingle: (item: CharacterHistoryItem) => void
}) {
  const generating = slots.filter((s) => s.kind === 'gen').length
  // Every member of a run was fired from the same form, so one Prompt data
  // block describes all of them — read off whichever slot is first.
  const first = slots[0]
  const stageProfile = first
    ? first.kind === 'gen'
      ? (first.gen.profile as CharacterProfile | undefined)
      : first.item.profile
    : undefined

  return (
    // min-h carries the mobile layout, where the column isn't height-constrained
    // and a flex-1 media frame sized by `height: 100%` would collapse to nothing.
    <div className="flex min-h-[420px] flex-1 flex-col gap-3 px-4 py-4">
      {slots.length === 0 ? (
        <AwaitingFrame />
      ) : slots.length === 1 ? (
        // One output keeps the view it always had: the picture as large as the
        // panel allows, over its named actions and prompt data.
        first!.kind === 'gen' ? (
          <>
            <SingleInFlight
              gen={first!.gen}
              onCancel={() => onCancelGen(first!.gen.id)}
              onClick={() => onOpen(first!.gen.id)}
            />
            <PromptData profile={stageProfile} />
            <StageCaption generating={1} total={1} queuedElsewhere={queuedElsewhere} />
          </>
        ) : (
          // Keyed on the item, like the multi-slot branch below: the state
          // this card owns is scoped to its item, but `TileDeleteButton`'s
          // two-click ARMED state is internal to that component and can only be
          // cleared by a remount — without this, deleting a character left the
          // next one's delete button already showing "Confirm".
          <SingleCard
            key={first!.item.id}
            item={first!.item}
            onClick={() => onOpen(first!.item.id)}
            onDelete={() => onDelete(first!.item)}
            onMakeSheet={() => onMakeSheet(first!.item)}
            onCopyPrompt={() => onCopyPrompt(first!.item)}
            onReuse={() => onReuse(first!.item)}
          />
        )
      ) : (
        <>
          <StageSurface>
            <div className={`relative grid h-full w-full gap-3 ${stageGridClass(slots.length)}`}>
              {slots.map((slot) => slot.kind === 'gen' ? (
                <FittedFrame key={slot.key} aspectRatio={slot.gen.aspectRatio}>
                  {(frameStyle) => (
                    <div
                      className="relative overflow-hidden rounded-xl shadow-[0_0_60px_-28px_rgba(247,79,158,0.35)]"
                      style={frameStyle}
                    >
                      <GeneratingTile
                        modelId={slot.gen.modelId}
                        kind={slot.gen.kind}
                        aspectRatio={slot.gen.aspectRatio}
                        onCancel={() => onCancelGen(slot.gen.id)}
                        onClick={() => onOpen(slot.gen.id)}
                        fill
                      />
                    </div>
                  )}
                </FittedFrame>
              ) : (
                <StageCell
                  key={slot.key}
                  item={slot.item}
                  onClick={() => onOpen(slot.item.id)}
                  onDelete={() => onDelete(slot.item)}
                  onMakeSheet={() => onMakeSheet(slot.item)}
                  onCopyPrompt={() => onCopyPrompt(slot.item)}
                  onReuse={() => onReuse(slot.item)}
                  onShowInSingle={() => onShowInSingle(slot.item)}
                />
              ))}
            </div>
          </StageSurface>
          <PromptData profile={stageProfile} />
          <StageCaption generating={generating} total={slots.length} queuedElsewhere={queuedElsewhere} />
        </>
      )}
    </div>
  )
}

// One finished cell of a multi-slot stage. The tile is the grid view's own —
// so its hover actions, badges and inline name input are the ones the member
// already knows — but the frame around it follows the decoded picture rather
// than the ratio the run was fired at, the same rule `SingleCard` follows.
function StageCell({
  item,
  onClick,
  onDelete,
  onMakeSheet,
  onCopyPrompt,
  onReuse,
  onShowInSingle,
}: {
  item: CharacterHistoryItem
  onClick: () => void
  onDelete: () => void | Promise<unknown>
  onMakeSheet: () => void
  onCopyPrompt: () => void
  onReuse: () => void
  onShowInSingle: () => void
}) {
  const natural = useNaturalRatio()
  return (
    <FittedFrame aspectRatio={natural.ratio ?? item.aspectRatio}>
      {(frameStyle) => (
        <HistoryTile
          item={item}
          frameStyle={frameStyle}
          onNaturalRatio={natural.set}
          onClick={onClick}
          onDelete={onDelete}
          onMakeSheet={onMakeSheet}
          onCopyPrompt={onCopyPrompt}
          onReuse={onReuse}
          onShowInSingle={onShowInSingle}
        />
      )}
    </FittedFrame>
  )
}

// The line under the stage while a run is in progress. Silent once everything
// has landed — a finished single character captions itself with its model and
// time, and a finished batch needs no commentary.
function StageCaption({
  generating,
  total,
  queuedElsewhere,
}: {
  generating: number
  total: number
  queuedElsewhere: number
}) {
  if (generating === 0 && queuedElsewhere === 0) return null
  const parts: string[] = []
  if (generating > 0) {
    parts.push(total > 1 ? `Generating ${generating} of ${total}` : 'Generating…')
  }
  if (queuedElsewhere > 0) parts.push(`+${queuedElsewhere} more in the queue`)
  return (
    <p className="text-center text-[10px] font-medium tracking-wider text-influencers-300">
      {parts.join(' · ')}
    </p>
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
          <p className="text-sm text-ink-500">Awaiting Generation</p>
          <p className="max-w-[280px] text-center text-xs leading-relaxed text-ink-600">
            The next character lands here. Nothing was deleted. Switch to List
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
  onReuse,
}: {
  item: CharacterHistoryItem
  onClick: () => void
  onDelete: () => void | Promise<unknown>
  onMakeSheet: () => void
  onCopyPrompt: () => void
  onReuse: () => void
}) {
  const a = useHistoryTileActions(item, onDelete, true, true)
  const natural = useNaturalRatio()

  return (
    <>
      {/* The frame follows the PICTURE once it decodes, not the ratio the run
          was fired at. Sized to the request, a 2:3 file in a 9:16 frame was
          letterboxed, and `bg-black light:bg-zinc-200` painted those bars as a
          pale strip above and below the character. */}
      <Stage aspectRatio={natural.ratio ?? item.aspectRatio}>
        {(frameStyle) => (
          <div
            onClick={onClick}
            className="group relative cursor-pointer overflow-hidden rounded-xl border border-ink/10 bg-black light:bg-zinc-200 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.75)]"
            style={frameStyle}
          >
            {a.status === 'ready' && a.url ? (
              <img src={a.url} alt="" loading="lazy" decoding="async" onLoad={natural.onLoad} className="absolute inset-0 h-full w-full object-contain" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                {a.status === 'loading'
                  ? <Spinner className="h-6 w-6 text-zinc-500" />
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

      {/* Model · when, directly under the picture it describes (Massimo's call,
          August 2026). It sat at the FOOT of the card, under Prompt data, where
          it was a lone line of chrome holding open the gap between the panel's
          last content and its bottom edge — and a caption three controls away
          from its subject isn't read as a caption at all. Quieter with it:
          `ink-600` at the normal weight, no tracking, since here it sits close
          enough to the image to be found without being announced. */}
      <p className="-mt-1 truncate text-center text-[10px] text-ink-600">
        {getModel(item.modelId)?.displayName ?? item.modelId} · {formatRelative(item.createdAt)}
      </p>

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
            icon={a.savingToBank ? Spinner : a.savedAsModel ? Check : Bookmark}
            label={a.savedAsModel ? 'Saved' : 'Save to Bank'}
            title={a.savedAsModel ? 'Saved · click to remove from Bank' : 'Save to Bank'}
            tone={a.savedAsModel ? 'saved' : 'default'}
            spin={a.savingToBank}
            onClick={a.toggleSave}
          />
          <ActionPill icon={Download} label="Download" onClick={a.handleDownload} />
          <ActionPill icon={Copy} label="Copy Prompt" onClick={onCopyPrompt} />
          {/* Straight after Copy prompt, because it's the same object headed
              somewhere else: copy puts this character's parameters on the
              clipboard, reuse puts them back in the form on the left. The arrow
              points at where they land. */}
          <ActionPill
            icon={CornerDownLeft}
            label="Reuse Prompt"
            title="Load this character's parameters back into the form"
            onClick={onReuse}
          />
          {/* Same destination as clicking the picture — spelled out, because in
              this view the image reads as a still rather than a button. */}
          <ActionPill
            icon={Pencil}
            label="Edit Character"
            title="Edit this character"
            onClick={onClick}
          />
          {!a.isSheet && (
            <ActionPill
              icon={LayoutGrid}
              label="Character Sheet"
              title="Make a character sheet from this portrait"
              onClick={onMakeSheet}
            />
          )}
        </div>
      )}

      <PromptData profile={item.profile} />
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
          <span className="truncate">Prompt Data</span>
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
  frameStyle,
  onNaturalRatio,
  onClick,
  onDelete,
  onMakeSheet,
  onCopyPrompt,
  onReuse,
  onShowInSingle,
  scrollRoot,
}: {
  item: CharacterHistoryItem
  // Set only on the Single stage, where the tile is sized to a measured cell
  // rather than to its own image. The picture then fills that frame
  // `object-contain` instead of driving the tile's height.
  frameStyle?: React.CSSProperties
  // Fitted tiles only: the picture's measured ratio, so the cell that sized
  // this frame can reshape itself around the file instead of the request.
  onNaturalRatio?: (ratio: number) => void
  onClick: () => void
  onDelete: () => void | Promise<unknown>
  onMakeSheet: () => void
  onCopyPrompt: () => void
  onReuse: () => void
  onShowInSingle: () => void
  // The gallery's scroll port. Present for the grid (hundreds of tiles, so the
  // media waits its turn); absent on the Single stage, where there is one tile
  // and nothing to defer.
  scrollRoot?: React.RefObject<HTMLElement | null>
}) {
  const ownRoot = useRef<HTMLElement | null>(null)
  const { ref: tileRef, near } = useNearViewport<HTMLDivElement>(scrollRoot ?? ownRoot)
  const fitted = !!frameStyle
  // A fitted tile is one picture on the Single stage: the original. The grid
  // tile is one of hundreds: the thumbnail.
  const a = useHistoryTileActions(item, onDelete, scrollRoot ? near : true, fitted)
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  return (
    <div
      ref={tileRef}
      onClick={onClick}
      style={frameStyle}
      className={`group relative cursor-pointer overflow-hidden border border-ink/10 bg-black light:bg-zinc-200 transition-all hover:border-ink/20 card-soft-shadow ${
        fitted ? 'rounded-xl' : 'rounded-lg hover:-translate-y-px'
      }`}
    >
      {a.status === 'ready' && a.url ? (
        <img
          src={a.url}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget
            if (w > 0 && h > 0) onNaturalRatio?.(w / h)
          }}
          className={fitted ? 'absolute inset-0 h-full w-full object-contain' : 'block h-auto w-full'}
        />
      ) : (
        <div
          className={fitted ? 'absolute inset-0 flex items-center justify-center' : 'flex w-full items-center justify-center'}
          style={fitted ? undefined : aspectStyle(item.aspectRatio)}
        >
          {a.status === 'loading'
            ? <Spinner className="h-5 w-5 text-zinc-500" />
            : <ImageIcon className="h-6 w-6 text-zinc-700" />}
        </div>
      )}

      <SourceBadge isSheet={a.isSheet} savedAsModel={a.savedAsModel} />

      {/* Which model drew this. Hover-only and bottom-left, clear of the action
          stack — the grid is scanned for faces, not for model names, but "what
          made this one?" is the question you ask about the tile under the
          pointer. Steps aside for the inline name input like the stack does. */}
      {a.nameDraft === null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 opacity-0 transition-opacity duration-200 group-hover:opacity-100 touch:opacity-100">
          <span className="truncate text-[10px] font-medium text-white/80">
            {getModel(item.modelId)?.displayName ?? item.modelId}
          </span>
        </div>
      )}

      {/* Hover actions — the shared tile stack (components/tileActions), read
          top to bottom: Download · Save · Edit · Delete · ⋮. The inline name
          input takes over the bottom edge while a save is being named, so the
          stack steps aside for it. */}
      {a.nameDraft === null && (
        <TileActionStack forceVisible={a.deleting || a.confirmingDelete || menuOpen}>
          <TileActionButton title="Download image" onClick={() => a.handleDownload()}>
            <Download className="h-4 w-4" />
          </TileActionButton>
          <TileActionButton
            title={a.savedAsModel ? 'Saved · click to remove from Bank' : a.savingToBank ? 'Saving…' : 'Save to Bank'}
            tone={a.savedAsModel ? 'saved' : 'default'}
            onClick={() => a.toggleSave()}
          >
            {a.savingToBank ? <Spinner className="h-4 w-4" /> : a.savedAsModel ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          </TileActionButton>
          {/* Four keep their circle (Massimo's call): Download and Save, which
              you reach for constantly and which carry a state worth seeing
              without opening anything; Edit, directly above the trash; and
              Delete, whose two-click arm has to be reachable without opening
              anything. Everything else is behind the ⋮, with its name beside it
              — seven unlabelled circles down a tile is a column you have to
              hover to read. */}
          <TileActionButton title="Edit image" onClick={() => onClick()}>
            <Pencil className="h-4 w-4" />
          </TileActionButton>
          <TileDeleteButton onDelete={a.confirmDelete} busy={a.deleting} onArmedChange={a.setConfirmingDelete} />
          <TileMenuButton
            open={menuOpen}
            onToggle={() => setMenuOpen((v) => !v)}
            onClose={() => setMenuOpen(false)}
            count={a.isSheet ? 3 : 4}
          >
            <TileMenuItem icon={Copy} label="Copy Prompt" onClick={onCopyPrompt} onClose={closeMenu} />
            <TileMenuItem icon={CornerDownLeft} label="Reuse Prompt" onClick={onReuse} onClose={closeMenu} />
            <TileMenuItem icon={Frame} label="Show in Single View" onClick={onShowInSingle} onClose={closeMenu} />
            {!a.isSheet && (
              <TileMenuItem icon={LayoutGrid} label="Make Character Sheet" onClick={onMakeSheet} onClose={closeMenu} />
            )}
          </TileMenuButton>
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
  onReuse,
  onShowInSingle,
  scrollRoot,
}: {
  item: CharacterHistoryItem
  mediaAspect: number
  onClick: () => void
  onDelete: () => void | Promise<unknown>
  onMakeSheet: () => void
  onCopyPrompt: () => void
  onReuse: () => void
  onShowInSingle: () => void
  scrollRoot?: React.RefObject<HTMLElement | null>
}) {
  const ownRoot = useRef<HTMLElement | null>(null)
  const { ref: rowRef, near } = useNearViewport<HTMLDivElement>(scrollRoot ?? ownRoot)
  const a = useHistoryTileActions(item, onDelete, scrollRoot ? near : true)
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)
  const prompt = buildImagePrompt(item.profile).trim()

  // Landscape (16:9) outputs always render in a 16:9 frame so they fill edge-to-
  // edge with no letterbox bars, whatever the slider is set to. Only portraits
  // follow the slider-driven aspect (taller as it moves right).
  const frameAspect = item.aspectRatio.includes('16:9') ? 16 / 9 : mediaAspect

  const modelLabel = getModel(item.modelId)?.displayName ?? item.modelId

  const meta: string[] = []
  if (item.resolution) meta.push(item.resolution)
  if (item.aspectRatio) meta.push(item.aspectRatio)

  return (
    <div ref={rowRef} className="flex w-full items-stretch gap-3 overflow-hidden rounded-2xl border border-ink/10 bg-ink/[0.02] card-soft-shadow">
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
              ? <Spinner className="h-6 w-6 text-ink-600" />
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
        {/* Model name over the meta pills, the same shape InFlightRow uses, so a
            row reads identically whether it's still rendering or finished. */}
        <p className="truncate text-[11px] font-medium text-ink-200">{modelLabel}</p>
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
          // Download · Save · Delete · ⋮ — FOUR, which is what this line fits.
          //
          // This was seven compact circles; five of them moved behind the ⋮,
          // where they read as words instead of being seven glyphs to learn
          // (Massimo's call, September 2026). Four is a real ceiling, not a
          // preference: the panel is a quarter of a half-pane, so the line gets
          // 155px at a 1084px window and less below it, and five ~28px buttons
          // want 156. Both ways of exceeding it lose a button silently — with
          // `flex-nowrap` the row's `overflow-hidden` cut the last one off
          // (Delete, unreachable on every portrait row under about a 1350px
          // window), and wrapping instead pushes the second line past the
          // panel's own bottom edge, where the same clip eats it. Which is why
          // the grid tile's fifth circle (Edit) is a menu row here. The wrap
          // stays as the backstop for a narrower panel than we've measured.
          <div className="flex flex-wrap items-center justify-center gap-1">
            <ListRowButton title="Download image" onClick={a.handleDownload}>
              <Download className="h-3.5 w-3.5" />
            </ListRowButton>
            <ListRowButton
              title={a.savedAsModel ? 'Saved · click to remove from Bank' : a.savingToBank ? 'Saving…' : 'Save to Bank'}
              tone={a.savedAsModel ? 'saved' : 'default'}
              onClick={a.toggleSave}
            >
              {a.savingToBank ? <Spinner className="h-3.5 w-3.5" /> : a.savedAsModel ? <Check className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
            </ListRowButton>
            {/* `alwaysVisible`, because this row is NOT a `group`: the default
                hover fade left the delete invisible here at every width, which
                is what "Delete is missing from the list view" was. */}
            <TileDeleteButton alwaysVisible variant="chrome" onDelete={a.confirmDelete} busy={a.deleting} />
            <TileMenuButton
              chrome
              open={menuOpen}
              onToggle={() => setMenuOpen((v) => !v)}
              onClose={closeMenu}
              count={a.isSheet ? 4 : 5}
            >
              {/* Edit leads the menu here rather than taking a circle of its
                  own as it does on the grid tile: four is what this line fits,
                  and the row's own picture already opens the editor. */}
              <TileMenuItem icon={Pencil} label="Edit Image" onClick={onClick} onClose={closeMenu} />
              <TileMenuItem icon={Copy} label="Copy Prompt" onClick={onCopyPrompt} onClose={closeMenu} />
              <TileMenuItem icon={CornerDownLeft} label="Reuse Prompt" onClick={onReuse} onClose={closeMenu} />
              <TileMenuItem icon={Frame} label="Show in Single View" onClick={onShowInSingle} onClose={closeMenu} />
              {!a.isSheet && (
                <TileMenuItem icon={LayoutGrid} label="Make Character Sheet" onClick={onMakeSheet} onClose={closeMenu} />
              )}
            </TileMenuButton>
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
