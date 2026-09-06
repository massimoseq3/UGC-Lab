import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Film, Music as MusicIcon, ChevronRight, Volume2, VolumeX, Coins, Layers, Eraser } from 'lucide-react'
import ModelPicker from '../../../components/ModelPicker'
import ModelPickerModal from '../../../components/ModelPickerModal'
import ProviderLogo from '../../../components/ProviderLogo'
import ModelTriggerLabel from '../../../components/ModelTriggerLabel'
import SegmentedToggle from '../../../components/SegmentedToggle'
import AspectIcon from '../../../components/AspectIcon'
import ConstraintChip from '../../../components/ConstraintChip'
import BatchCountStepper from '../../../components/BatchCountStepper'
import { clampBatchCount } from '../../../utils/batchCount'
import ModelWaitNotice from '../../../components/ModelWaitNotice'
import {
  getDefaultModel,
  getModel,
  estimateCredits,
  formatCredits,
  videoResolutionLabel,
  snapVideoDuration,
  officialSavingsPercent,
  referenceAudioCapacity,
  referenceClipCapacitySeconds,
  referenceVideoCapacity,
  type Task,
  type Mode,
} from '../../../utils/models'
import { useSettingsStore } from '../../../stores/settingsStore'
import { fileToDataUri } from '../../../utils/kie'
import { type VideoInputValue } from '../../../components/video/VideoInputSlot'
import FrameSlot from '../../../components/video/FrameSlot'
import RefTiles from '../../../components/video/RefTiles'
import MediaRefStrip, { type MediaRefValue } from '../../../components/video/MediaRefStrip'
import { readMediaDuration } from '../../../utils/media'
import OmniInputsSection from './OmniInputsSection'
import { OMNI_SLOT_QUOTA, omniImageCapacity, omniQuotaUsed } from '../omniQuota'
import MotionControlSection from './MotionControlSection'
import { useAppStore } from '../../../stores/appStore'
import type { BankType } from '../../../utils/constants'
import type { BRoll } from '../../../stores/types'
import PresetCard from './PresetCard'
import { StyleTile } from '../../../components/StyleModal'
import { STYLE_PREVIEWS, PLAYGROUND_STYLE_ACCENT } from '../../../components/styleArt'
import { CONTINUOUS_STYLES, styleBriefFor, styleBriefForStill } from '../../../utils/visualStyle'
import { useBankStore } from '../../../stores/bankStore'
import Modal from '../../../components/Modal'
import SectionRail, { GallerySectionHeading } from '../../../components/SectionRail'
import { GALLERY_GRID, useSectionSpy } from '../../../components/sectionSpy'
import ExpandTextModal, { BracketHighlightArea } from '../../../components/ExpandableText'
import SectionCard from '../../../components/SectionCard'
import PromptToolbar from '../../../components/PromptToolbar'
import VoiceCard from './VoiceCard'
import MentionPopover from './MentionPopover'
import type { PlaygroundMode, BankReference } from '../types'
import { VIDEO_PRESETS, IMAGE_PRESETS, type Preset } from '../presets'
import { enhancePlaygroundPrompt } from '../service'
import { humanizeError } from '../../../utils/friendlyError'

// Tabs passed to BankPicker when used from Playground refs. Characters comes
// first so opening the picker lands the user there by default; B-Rolls are
// filtered to those with stills (videos-only b-rolls aren't useful as image
// refs).
const PLAYGROUND_REF_TABS: Array<{ type: BankType; filter?: (item: BRoll | unknown) => boolean }> = [
  { type: 'models' },
  { type: 'products' },
  { type: 'brolls', filter: (item) => !!(item as BRoll).imageUrl },
]

// Start/end frame picker leads with B-Rolls — the most common source for a
// video's opening frame — then characters and products.
const PLAYGROUND_FRAME_TABS: Array<{ type: BankType; filter?: (item: BRoll | unknown) => boolean }> = [
  { type: 'brolls', filter: (item) => !!(item as BRoll).imageUrl },
  { type: 'models' },
  { type: 'products' },
]

// Reference attached to the prompt — either dropped/uploaded by the user or
// resolved from an @-mention. `source` distinguishes so the UI can render
// the right chip text.
export interface PromptRef {
  // Renderable URL: data: URI, http(s) URL, or asset:// ref. Empty for
  // omni-voice refs (they're ids, not media).
  url: string
  label: string
  source: 'upload' | 'product' | 'character' | 'broll'
  // Where to slot the ref. 'start' → start frame, 'end' → end frame,
  // 'ref' → reference image array. 'audio'/'video' → Seedance reference
  // clips. 'omni-*' → Gemini Omni characters / designed voices / source clip.
  // 'motion-image'/'motion-video' → Kling Motion Control's character + driving clip.
  slot: 'start' | 'end' | 'ref' | 'audio' | 'video' | 'omni-character' | 'omni-voice' | 'omni-clip' | 'motion-image' | 'motion-video'
  // audio / video / omni-clip: clip length read from file metadata.
  durationSeconds?: number
  // omni-character: the Influencers bank row id. The kie characterId is
  // resolved (and minted on first use) at generate time.
  bankModelId?: string
  // omni-voice: the kieAudioId from /omni/audio/create.
  omniId?: string
  // omni-clip: trim window in seconds (ends − start ≤ 10).
  clipStart?: number
  clipEnds?: number
}

export interface PromptPanelState {
  mode: PlaygroundMode
  prompt: string
  modelId: string
  aspectRatio: string
  durationSeconds: number
  resolution: string
  audio: boolean
  instrumental: boolean
  refs: PromptRef[]
  // How many outputs one press of Generate fires (image + video; music stays
  // one per press). Absent on drafts saved before batching shipped — every
  // read goes through clampBatchCount, which lands those on 1.
  batchCount?: number
  // Kling Motion Control: how the output character is oriented. Defaults to
  // 'video' (follow the driving clip). Unused by other models.
  characterOrientation?: 'image' | 'video'
  // Video only: the voice profile appended to the prompt at generate time (see
  // `composePrompt.ts`). Its own field rather than part of `prompt`
  // because it is the one thing in a UGC video prompt that must NOT change
  // between generations — so it has to survive Clear, Enhance, Undo and a whole
  // new idea, none of which the prompt box does. Absent on drafts saved before
  // it shipped; every read goes through `?? ''`.
  voiceProfile?: string
  // Whether the Voice box is folded open. Persisted with the draft because the
  // whole point of the field is setting it once and leaving it — a fold that
  // reset on reload would put a 90px box back under the prompt every session.
  // Absent (a fresh draft, or one saved before this shipped) means OPEN: the
  // field is the reason the card is there, and a member who has never opened it
  // has never seen what it takes. Folding it away is the one-click part.
  voiceOpen?: boolean
}

interface PromptPanelProps {
  state: PromptPanelState
  onChange: (next: PromptPanelState) => void
  // Mode switch is special-cased so the parent can stash/restore each tab's
  // own prompt + refs instead of carrying them across tabs.
  onModeChange: (mode: PlaygroundMode) => void
  onSubmit: () => void
  isGenerating: boolean
}

const MODE_TABS: Array<{ id: PlaygroundMode; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  // Image leads: the common loop is making a still and then animating it, so
  // the tab you start in sits first and the Animate handoff reads left→right.
  { id: 'image', label: 'Image', icon: ImageIcon },
  { id: 'video', label: 'Video', icon: Film },
  { id: 'music', label: 'Music', icon: MusicIcon },
]

export default function PromptPanel({ state, onChange, onModeChange, onSubmit, isGenerating }: PromptPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Mention popover state — open when the user just typed an @ that isn't
  // followed by a space. `mentionQuery` is what follows the most recent @.
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  // Drag-over visual hint.
  const [dragOver, setDragOver] = useState(false)
  // Preset picker overlay.
  const [presetOpen, setPresetOpen] = useState(false)
  // The preset modal's rail: two sections, one scroll.
  const presetSpy = useSectionSpy(['styles', 'presets'])
  // Video mode swaps the inline model dropdown for the full picker modal.
  const [modelPanelOpen, setModelPanelOpen] = useState(false)
  // Full-screen prompt editor.
  const [promptExpanded, setPromptExpanded] = useState(false)

  // Prompt enhance + undo/redo. History is session-local (not persisted) and
  // resets when the mode flips (each tab keeps its own prompt). The textarea
  // commits its typed draft into history on blur, so Undo steps back through
  // both manual edits and enhancements — same model as B-Roll's card prompt.
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [promptHistory, setPromptHistory] = useState<string[]>([state.prompt])
  const [promptHistoryIndex, setPromptHistoryIndex] = useState(0)
  // Reset the undo stack when the active mode changes (prompt swaps with it).
  const [prevMode, setPrevMode] = useState(state.mode)
  if (state.mode !== prevMode) {
    setPrevMode(state.mode)
    setPromptHistory([state.prompt])
    setPromptHistoryIndex(0)
  }

  const canUndo = promptHistoryIndex > 0
  const canRedo = promptHistoryIndex < promptHistory.length - 1

  // Push a new prompt onto the undo stack, dropping any forward redo branch.
  // `base`/`baseIndex` let callers fold an uncommitted draft into the same
  // update (avoids stale-state races from two setState calls in a row).
  function pushPromptHistory(next: string, base = promptHistory, baseIndex = promptHistoryIndex) {
    const truncated = base.slice(0, baseIndex + 1)
    const nextHistory = [...truncated, next]
    setPromptHistory(nextHistory)
    setPromptHistoryIndex(nextHistory.length - 1)
    onChange({ ...state, prompt: next })
  }

  // Commit the current textarea draft into history (fired on blur). No-op when
  // unchanged from the latest entry.
  function commitPromptDraft() {
    if (state.prompt !== promptHistory[promptHistoryIndex]) pushPromptHistory(state.prompt)
  }

  function handlePromptUndo() {
    if (promptHistoryIndex <= 0) return
    const i = promptHistoryIndex - 1
    setPromptHistoryIndex(i)
    onChange({ ...state, prompt: promptHistory[i] })
  }
  function handlePromptRedo() {
    if (promptHistoryIndex >= promptHistory.length - 1) return
    const i = promptHistoryIndex + 1
    setPromptHistoryIndex(i)
    onChange({ ...state, prompt: promptHistory[i] })
  }
  // Clear the prompt — pushed as a history entry so it's undoable.
  function handlePromptClear() {
    if (!state.prompt.trim()) return
    pushPromptHistory('')
  }

  async function handleEnhancePrompt() {
    if (isEnhancing) return
    const draft = state.prompt.trim()
    if (!draft) return
    // Fold any uncommitted typed draft into history first, then enhance from it,
    // so Undo returns to exactly what the user had before enhancing.
    const committed = state.prompt !== promptHistory[promptHistoryIndex]
      ? [...promptHistory.slice(0, promptHistoryIndex + 1), state.prompt]
      : promptHistory.slice(0, promptHistoryIndex + 1)
    setIsEnhancing(true)
    try {
      const rewritten = await enhancePlaygroundPrompt(state.prompt, state.mode)
      pushPromptHistory(rewritten, committed, committed.length - 1)
    } catch (err) {
      useAppStore.getState().addToast(humanizeError(err, 'Enhance failed.'), 'error')
    } finally {
      setIsEnhancing(false)
    }
  }

  const model = getModel(state.modelId)
  const modelSavings = model ? officialSavingsPercent(model.id) : null
  const taskForMode: Task = state.mode === 'image' ? 'image' : state.mode === 'video' ? 'video' : 'music'
  const addToast = useAppStore((s) => s.addToast)
  // The member's saved looks, listed beside the built-in styles in the presets
  // panel.
  const savedStyles = useBankStore((s) => s.styles)

  // Video ref slots derived from the refs[] array — start/end frames live as
  // single-value slots, ref strip as a list. Mutating these calls back through
  // setRefs which rewrites the whole refs[] array.
  function startFrameValue(): VideoInputValue | null {
    const r = state.refs.find((x) => x.slot === 'start')
    return r ? { dataUri: r.url } : null
  }
  function endFrameValue(): VideoInputValue | null {
    const r = state.refs.find((x) => x.slot === 'end')
    return r ? { dataUri: r.url } : null
  }
  function refStripValues(): VideoInputValue[] {
    return state.refs.filter((r) => r.slot === 'ref').map((r) => ({ dataUri: r.url }))
  }

  function setSlot(slot: PromptRef['slot'], value: VideoInputValue | null) {
    const others = state.refs.filter((r) => r.slot !== slot)
    if (!value) {
      onChange({ ...state, refs: others })
      return
    }
    onChange({
      ...state,
      refs: [...others, { url: value.dataUri, label: slot, source: 'upload', slot }],
    })
  }

  function setRefStrip(values: VideoInputValue[]) {
    const nonRefs = state.refs.filter((r) => r.slot !== 'ref')
    const refs = values.map((v) => ({ url: v.dataUri, label: 'ref', source: 'upload' as const, slot: 'ref' as const }))
    onChange({ ...state, refs: [...nonRefs, ...refs] })
  }

  // Audio / video reference clips (Seedance 2 family) live in refs[] under
  // their own slots, surfaced as MediaRefStrip chip values.
  function mediaStripValues(slot: 'audio' | 'video'): MediaRefValue[] {
    return state.refs
      .filter((r) => r.slot === slot)
      .map((r) => ({ dataUri: r.url, name: r.label, durationSeconds: r.durationSeconds }))
  }

  function setMediaStrip(slot: 'audio' | 'video', values: MediaRefValue[]) {
    const others = state.refs.filter((r) => r.slot !== slot)
    const refs = values.map((v) => ({
      url: v.dataUri, label: v.name, source: 'upload' as const, slot, durationSeconds: v.durationSeconds,
    }))
    onChange({ ...state, refs: [...others, ...refs] })
  }

  // A model's own declared cap wins (the Seedance family takes 9 — see
  // `maxReferenceImages` in the registry); anything undeclared keeps the
  // panel's historical 9. The Gemini Omni family is the exception: its image
  // cap is whatever its 7-slot quota leaves after characters (×1 each) and the
  // source clip (×2), so it's derived rather than read off the entry — from
  // `../omniQuota`, the one place that arithmetic is written, shared with the
  // header's readout and with the checks OmniInputsSection refuses on.
  const maxRefs = model?.omniInputs
    ? omniImageCapacity(state.refs)
    : model?.maxReferenceImages ?? 9
  const refsAllowed = model?.supportsReferenceImages ?? false
  const supportsFrames = !!model?.modes?.includes('image-to-video') || !!model?.modes?.includes('frames-to-video')
  const supportsEndFrame = !!model?.modes?.includes('frames-to-video')
  const supportsRefAudio = state.mode === 'video' && !!model?.supportsReferenceAudio
  const supportsRefVideos = state.mode === 'video' && !!model?.supportsReferenceVideos
  // Combined seconds per media strip — 15s on the Seedance 2.0 family, 30s on
  // 2.5. Read off the registry so the drop handler and both strips agree.
  const refClipSeconds = referenceClipCapacitySeconds(state.modelId)
  // How many clips the video strip accepts — 3 on the Seedance family, exactly
  // 1 on Kling 3.0 Omni, which takes a single source video.
  const refVideoMax = referenceVideoCapacity(state.modelId)
  // Same for the audio strip — 3 on the Seedance family, 5 on Wan 3.0.
  const refAudioMax = referenceAudioCapacity(state.modelId)
  // A source clip in the request moves several models onto a different billing
  // tier (Omni's flat per-call rate, Kling 3.0 Omni's higher per-second one).
  // Omni carries its clip in its own slot; every other model uses the shared
  // reference-video strip — both count.
  const hasVideoInput = state.refs.some((r) => r.slot === 'omni-clip' || r.slot === 'video')
  const isOmni = state.mode === 'video' && !!model?.omniInputs
  // Whether the model accepts any input at all — a text-only model shows no
  // attachment row rather than an empty one.
  const hasAnyRefSlot = supportsFrames || refsAllowed || supportsRefAudio || supportsRefVideos || isOmni
  const isMotionControl = state.mode === 'video' && !!model?.motionControl
  const motionOrientation = state.characterOrientation ?? 'video'

  // For Image we register text-to-image by default; pickers filter on task
  // alone so models can advertise multiple modes and the picker shows them.
  const pickerMode: Mode | undefined = state.mode === 'image'
    ? 'text-to-image'
    : state.mode === 'video'
    ? undefined
    : 'text-to-music'

  // The per-mode model memory key: what ModelPicker persists under, and what
  // the mode-swap effect below reads back. Video's picker is ModelPickerModal,
  // which leaves persistence to its caller (elsewhere it drives per-card picks
  // that must NOT become an app default), so Playground writes the key itself.
  // Without that write the key stayed empty and every Image → Video flip fell
  // through to the registry default, throwing away the user's pick.
  const modelKey = `playground:${taskForMode}${pickerMode ? `:${pickerMode}` : ''}`

  // When the mode flips, swap to a sensible default model for that mode if
  // the previously-selected model doesn't fit.
  useEffect(() => {
    if (!model || model.task !== taskForMode) {
      const persisted = useSettingsStore.getState().getAppModel(modelKey)
      const fallback = getDefaultModel('playground', taskForMode, pickerMode)?.id
      const next = persisted ?? fallback ?? ''
      if (next && next !== state.modelId) {
        onChange({ ...state, modelId: next })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode])

  // Snap constraint controls to allowed values when the model OR the mode
  // changes. Video and Image constraint sets don't overlap (video tier
  // strings like '720p' aren't valid image tiers like '1K'), so swapping
  // modes without re-clamping leaves stale values in `state.resolution`.
  useEffect(() => {
    const patch: Partial<PromptPanelState> = {}
    if (state.mode === 'video' && model?.videoConstraints) {
      const c = model.videoConstraints
      // Motion Control declares no aspect ratios (output inherits the image),
      // so only snap when the model actually offers a set.
      if (c.aspectRatios.length > 0 && !c.aspectRatios.includes(state.aspectRatio)) patch.aspectRatio = c.aspectRatios[0]
      const snappedDuration = snapVideoDuration(state.durationSeconds, c.durations)
      if (snappedDuration !== state.durationSeconds) patch.durationSeconds = snappedDuration
      // Snap to the model's preferred default on switch (e.g. Omni prefers
      // 1080p — same credits as 720p). Models without a declared default keep
      // a still-valid resolution, only clamping when the current tier is gone.
      const nextRes = c.default ?? (c.resolutions.includes(state.resolution) ? state.resolution : c.resolutions[0] ?? '720p')
      if (nextRes !== state.resolution) patch.resolution = nextRes
      // Audio defaults ON for every audio-capable model (matches B-Roll); OFF
      // when the model can't do audio. User can still mute via the toggle.
      if (state.audio !== (c.supportsAudio === true)) patch.audio = c.supportsAudio === true
    } else if (state.mode === 'image' && model?.imageConstraints) {
      const c = model.imageConstraints
      if (!c.resolutions.includes(state.resolution)) {
        patch.resolution = c.default ?? c.resolutions[0] ?? '1K'
      }
    }

    // Keep refs[] consistent with what the new model's UI can show — a slot
    // the panel doesn't render would otherwise hold invisible, undeletable
    // state that still alters the generation.
    if (state.mode === 'video') {
      let nextRefs = state.refs
      if (model?.motionControl) {
        // Motion Control only understands its own image + driving clip; every
        // other slot is dead state the panel won't render.
        nextRefs = nextRefs.filter((r) => r.slot === 'motion-image' || r.slot === 'motion-video')
      } else {
        // Leaving a motion-control model: drop its slots before the rest.
        nextRefs = nextRefs.filter((r) => r.slot !== 'motion-image' && r.slot !== 'motion-video')
        if (model?.omniInputs) {
          // Omni 1.0 has no frame fields, so a start/end frame there is just
          // another image ref and the slot has to be folded or the panel would
          // hold state it doesn't render. Flash 1.1 DOES have them, so it keeps
          // its frames — read off the declared modes rather than off
          // `omniInputs`, which says what extra inputs the family takes and
          // nothing about frames.
          if (!supportsFrames) {
            nextRefs = nextRefs.map((r) =>
              r.slot === 'start' || r.slot === 'end' ? { ...r, slot: 'ref' as const } : r,
            )
          }
        } else {
          nextRefs = nextRefs.filter(
            (r) => r.slot !== 'omni-character' && r.slot !== 'omni-voice' && r.slot !== 'omni-clip',
          )
        }
        if (!model?.supportsReferenceAudio) {
          nextRefs = nextRefs.filter((r) => r.slot !== 'audio')
        } else {
          const audioCap = referenceAudioCapacity(state.modelId)
          const keptAudio = nextRefs.filter((r) => r.slot === 'audio').slice(0, audioCap)
          nextRefs = nextRefs.filter((r) => r.slot !== 'audio' || keptAudio.includes(r))
        }
        if (!model?.supportsReferenceVideos) {
          nextRefs = nextRefs.filter((r) => r.slot !== 'video')
        } else {
          // Caps differ across models (3 on Seedance, 1 on Kling Omni), so the
          // clips past the new model's limit go with the switch — the strip
          // stops rendering them and they'd otherwise ride along invisibly.
          const cap = referenceVideoCapacity(state.modelId)
          const kept = nextRefs.filter((r) => r.slot === 'video').slice(0, cap)
          nextRefs = nextRefs.filter((r) => r.slot !== 'video' || kept.includes(r))
        }
      }
      const changed = nextRefs.length !== state.refs.length
        || nextRefs.some((r, i) => r !== state.refs[i])
      if (changed) patch.refs = nextRefs
    }

    if (Object.keys(patch).length > 0) onChange({ ...state, ...patch })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.modelId, state.mode])

  function handlePromptChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    onChange({ ...state, prompt: value })

    // Detect mention trigger: most recent @ in the text, no space after.
    const caret = e.target.selectionStart ?? value.length
    const left = value.slice(0, caret)
    const at = left.lastIndexOf('@')
    if (at >= 0) {
      const after = left.slice(at + 1)
      if (!/\s/.test(after) && after.length <= 30) {
        setMentionQuery(after)
        setMentionOpen(true)
        return
      }
    }
    setMentionOpen(false)
  }

  function handleMentionSelect(ref: BankReference) {
    const textarea = textareaRef.current
    if (!textarea) return
    const value = state.prompt
    const caret = textarea.selectionStart ?? value.length
    const left = value.slice(0, caret)
    const at = left.lastIndexOf('@')
    if (at < 0) return

    // Scripts are different: instead of a chip token + attached asset, we drop
    // the script's full text into the prompt (replacing the @query).
    if (ref.kind === 'script') {
      const insertion = `${ref.item.scriptText.trim()} `
      const before = value.slice(0, at)
      const after = value.slice(caret)
      onChange({ ...state, prompt: before + insertion + after })
      setMentionOpen(false)
      requestAnimationFrame(() => {
        const t = textareaRef.current
        if (!t) return
        t.focus()
        const pos = (before + insertion).length
        t.setSelectionRange(pos, pos)
      })
      return
    }

    const label =
      ref.kind === 'product' ? ref.item.productName
      : ref.kind === 'character' ? ref.item.name
      : ref.item.prompt.slice(0, 30) || 'b-roll'

    // Replace the @query with @Label + space; users see a chip-like inline token.
    const token = `@${label} `
    const before = value.slice(0, at)
    const after = value.slice(caret)
    const nextPrompt = before + token + after

    // Add a ref slot for the picked item.
    const imageSource =
      ref.kind === 'product' ? ref.item.productImage
      : ref.kind === 'character' ? ref.item.characterImage
      : ref.item.imageUrl

    // Skip refs for music mode (Suno doesn't accept them).
    const acceptsRefs = state.mode !== 'music' && !!imageSource
    const nextRefs = acceptsRefs
      ? [...state.refs, { url: imageSource, label, source: ref.kind, slot: 'ref' as const }]
      : state.refs

    onChange({ ...state, prompt: nextPrompt, refs: nextRefs })
    setMentionOpen(false)

    // Focus + put caret after the inserted token.
    requestAnimationFrame(() => {
      const t = textareaRef.current
      if (!t) return
      t.focus()
      const pos = (before + token).length
      t.setSelectionRange(pos, pos)
    })
  }

  function applyPreset(preset: Preset) {
    const aspectFromPreset = preset.defaultAspect ?? state.aspectRatio
    const durationFromPreset = preset.defaultDuration ?? state.durationSeconds
    // Clamp aspect / duration to the active model's constraints so the chips
    // don't show an unsupported value (the constraint useEffect only re-snaps
    // on model/mode change, not on a preset apply).
    const vc = model?.videoConstraints
    const allowedAspects = state.mode === 'image'
      ? model?.imageConstraints?.aspectRatios
      : vc?.aspectRatios
    const finalAspect = allowedAspects && allowedAspects.length > 0 && !allowedAspects.includes(aspectFromPreset)
      ? allowedAspects[0]
      : aspectFromPreset
    const finalDuration = vc ? snapVideoDuration(durationFromPreset, vc.durations) : durationFromPreset

    // Append (with a blank-line separator) when there's already text in the
    // textarea — users were losing typed context every time they picked a
    // preset. Empty box → replace cleanly.
    const existing = state.prompt.trim()
    const nextPrompt = existing ? `${existing}\n\n${preset.prompt}` : preset.prompt

    onChange({
      ...state,
      prompt: nextPrompt,
      aspectRatio: finalAspect,
      durationSeconds: finalDuration,
    })
    textareaRef.current?.focus()
  }

  // A visual style applies exactly like a preset: its brief is appended to
  // whatever is already typed. Playground stores no "picked style" of its own —
  // the prompt IS the state here, so a look you've applied stays visible and
  // editable rather than hiding in a row above the box.
  //
  // Image mode gets the still-scoped brief (every style paragraph ends on camera
  // movement and cutting cadence, which a single frame can't express);
  // `styleBriefForStill` returns null for UGC Realism — the photoreal default —
  // so that one falls back to the plain brief rather than applying nothing.
  function applyStyle(input: { styleId: string; styleBrief?: string }) {
    const brief = state.mode === 'video'
      ? styleBriefFor(input)
      : styleBriefForStill(input) ?? styleBriefFor(input)
    if (!brief) return
    const existing = state.prompt.trim()
    onChange({ ...state, prompt: existing ? `${existing}\n\n${brief}` : brief })
    textareaRef.current?.focus()
  }

  // Adds a dropped audio/video file to the matching media strip, enforcing
  // the same total-length cap as the strip's own upload button.
  async function addDroppedMedia(slot: 'audio' | 'video', file: File) {
    const existing = mediaStripValues(slot)
    if (existing.length >= 3) return
    const dataUri = await fileToDataUri(file)
    let durationSeconds: number | undefined
    try {
      durationSeconds = await readMediaDuration(dataUri, slot)
    } catch { /* let kie validate */ }
    if (durationSeconds) {
      const total = existing.reduce((s, v) => s + (v.durationSeconds ?? 0), 0) + durationSeconds
      if (total > refClipSeconds) {
        addToast(`Combined ${slot} length can't exceed ${refClipSeconds}s. This clip would make it ${Math.ceil(total)}s.`, 'error')
        return
      }
    }
    setMediaStrip(slot, [...existing, { dataUri, name: file.name, durationSeconds }])
  }

  // Drag-and-drop a file onto the prompt panel. Routes by file type:
  // - Images: video mode → start frame if empty, else the reference strip;
  //   image mode → reference strip.
  // - Audio / video files: the matching reference strip when the active
  //   model accepts them (Seedance 2 family).
  // - Music mode → ignored.
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (state.mode === 'music') return
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (file.type.startsWith('audio/')) {
      if (supportsRefAudio) await addDroppedMedia('audio', file)
      return
    }
    if (file.type.startsWith('video/')) {
      if (supportsRefVideos) await addDroppedMedia('video', file)
      return
    }
    if (!file.type.startsWith('image/')) return
    const dataUri = await fileToDataUri(file)
    if (state.mode === 'video' && supportsFrames && !startFrameValue()) {
      setSlot('start', { dataUri })
      return
    }
    if (refsAllowed || state.mode === 'image') {
      setRefStrip([...refStripValues(), { dataUri }])
    }
  }

  // Parallel generations are allowed — the in-flight count never gates
  // submit. The user's kie.ai credits are the natural ceiling. Motion Control
  // has an optional prompt but two required inputs (character image + driving
  // video), so it gates on those instead of the prompt.
  const hasMotionInputs =
    state.refs.some((r) => r.slot === 'motion-image') && state.refs.some((r) => r.slot === 'motion-video')
  const canSubmit = !!state.modelId && (
    isMotionControl ? hasMotionInputs : state.prompt.trim().length > 0
  )
  void isGenerating

  // Every attached slot, whatever kind — frames, ref images, Seedance clips,
  // Omni characters/voices, Motion Control's pair. Clear empties them all; the
  // prompt is the member's own writing and is deliberately left alone.
  const hasAnyRef = state.refs.length > 0
  const clearRefs = () => onChange({ ...state, refs: [] })

  const hasRefsSection = state.mode === 'video' || state.mode === 'image'
  // Presets are prompt formats; Motion Control's prompt is secondary, so skip them.
  const presetsApplicable = state.mode === 'image' || (state.mode === 'video' && !isMotionControl)

  const generateLabel =
    state.mode === 'music' ? 'Generate Music'
    : state.mode === 'image'
      ? (clampBatchCount(state.batchCount) === 1 ? 'Generate Image' : `Generate ${clampBatchCount(state.batchCount)} Images`)
      : (clampBatchCount(state.batchCount) === 1 ? 'Generate Video' : `Generate ${clampBatchCount(state.batchCount)} Videos`)

  const GenerateIcon =
    state.mode === 'image' ? ImageIcon
    : state.mode === 'video' ? Film
    : MusicIcon

  // Motion Control bills per second of the *output*, which tracks the driving
  // clip clamped to the orientation cap (≤30s video / ≤10s photo). Estimate
  // from the attached clip's measured length so the credit readout is honest.
  const motionDrivingSeconds = state.refs.find((r) => r.slot === 'motion-video')?.durationSeconds
  const motionDuration = Math.min(motionDrivingSeconds ?? 5, motionOrientation === 'image' ? 10 : 30)

  const batchCount = clampBatchCount(state.batchCount)

  // Cost of a whole run. Image models price by `imageCount` natively; video and
  // music have no count dimension, so the per-call estimate is multiplied here.
  const creditsForRun = (n: number) => {
    const one = estimateCredits(state.modelId, {
      durationSeconds: isMotionControl ? motionDuration : state.mode === 'video' ? state.durationSeconds : undefined,
      imageCount: state.mode === 'image' ? n : undefined,
      resolution: state.mode !== 'music' ? state.resolution : undefined,
      audio: state.mode === 'video' ? state.audio : undefined,
      videoInput: state.mode === 'video' ? hasVideoInput : undefined,
    })
    if (one === null) return null
    return state.mode === 'image' ? one : one * n
  }

  const generateCredits = formatCredits(creditsForRun(state.mode === 'music' ? 1 : batchCount))

  // Does the output-settings row have anything to draw? Music never does, and
  // neither does a mode whose resolved model declares no constraints. The row
  // used to be unconditional because the batch stepper always sat in it; now
  // that the stepper rides on the model row, an unguarded row would render as
  // an empty 8px margin above Generate.
  const hasOutputSettings =
    (state.mode === 'video' && !!model?.videoConstraints) ||
    (state.mode === 'image' && !!model?.imageConstraints)

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (state.mode !== 'music') setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      /* On a phone everything BELOW the mode toggle is one scroller and the
         Generate band is simply the last thing in it — see the wrapper and
         the note on the band below. */
      className={`relative flex h-full flex-col transition-colors ${
        dragOver ? 'bg-playground-500/[0.04]' : ''
      }`}
    >
      {/* Mode toggle — mirrors Voiceovers' Settings/History pattern. */}
      <div className="flex h-[57px] items-center border-b border-ink/5 px-5">
        <SegmentedToggle<PlaygroundMode>
          className="h-10 !p-1"
          value={state.mode}
          onChange={onModeChange}
          options={MODE_TABS.map((tab) => ({ value: tab.id, label: tab.label, icon: tab.icon }))}
        />
      </div>

      {/* The phone's scroll port. It starts BELOW the mode toggle, which is why
          that toggle is a sibling of this box and not its first child: the panel
          root used to be the scroller, so Image/Video/Music scrolled away with
          the fields and the member lost the way back to the other modes halfway
          down the column. Above `md` this is a plain wrapper and the body below
          scrolls on its own. */}
      <div className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto">

        {/* Middle: scrollable body — model picker, preset, refs, prompt. On a
            phone it stops being a scroller of its own and just grows: the panel
            root above scrolls instead, so the inputs and the Generate band are
            one page rather than a short window with a bar parked under it. */}
        <div className="relative min-h-0 flex-1 overflow-hidden max-md:flex-none max-md:overflow-visible">
          <div className="flex h-full flex-col overflow-y-auto max-md:h-auto max-md:overflow-visible">
            {/* `min-h-full`, not `h-full`. Both make the column at least the port,
                so the prompt box below still has a ceiling to shrink against and
                `grow` still fills a short panel — but `h-full` also made it at
                MOST the port, which means the scroller never learns its content is
                taller than it. Pick a model with a lot of inputs (Seedance 2: two
                frame slots, a reference strip, and the audio + video clip strips)
                and the References card alone outgrew the port: the prompt box was
                pushed past the bottom edge and clipped there with no scrollbar to
                recover it, while the wheel fell through to the page behind. With
                `min-h-full` the column grows, this scroller scrolls, and the box
                simply sits at its own 206px floor. Same rule on a phone, so the
                `max-md` override is gone with it. */}
            <div className="flex min-h-full min-w-0 flex-col gap-2 px-5 pb-0 pt-3 max-md:min-h-0">
              {/* Model picker now lives in the footer, above the output-settings
                  pills (see below) — the scrollable body opens straight into the
                  reference inputs. */}

              {/* Reference inputs — every slot the active model accepts renders
                  as a labelled group (big frame squares, thumbnail tiles, media
                  cards) stacked in one column. */}
              {/* References — the Influencers section card around every slot the
                  ACTIVE MODEL accepts. It renders exactly where the slots
                  themselves do, so it inherits the model's own capabilities
                  instead of adding a second set of conditionals: Music has no
                  slots and gets no card, a text-only video model likewise
                  (`hasAnyRefSlot`), Motion Control's own section takes the card
                  over, Omni's characters/voices/clip stack under the images, and
                  the Seedance clip strips share a row inside it. Image mode's
                  single group still gets the card — a lone row of three tiles
                  floating with no boundary is the thing the card exists to fix,
                  and one mode reading structurally differently to save 22px is a
                  worse trade than the 22px. Clear empties the slots (and only the
                  slots — the prompt is the member's writing, not a reference). */}
              {/* `isMotionControl` is in this gate explicitly, and has to be:
                  the model declares `modes: ['motion-control']` and no
                  `supportsReferenceImages`, so `hasAnyRefSlot` is FALSE for it.
                  Without this term the card never renders — and since Motion
                  Control's section lives inside the card, its character image and
                  driving video had nowhere to be attached, which left the model
                  impossible to run (`hasMotionInputs` can never become true).
                  Regression from #437, which added the `hasAnyRefSlot` gate. */}
              {hasRefsSection && (hasAnyRefSlot || isMotionControl || state.mode === 'image') && (
                <SectionCard
                  icon={Layers}
                  title="References"
                  contentClassName="flex flex-col gap-3"
                  /* The slot quota only — the word "Optional" came off this
                     card in September 2026 (Massimo's call). Everything in this
                     column that isn't marked otherwise is optional; saying so on
                     the one card that is unmistakably a pile of extras spent a
                     pill telling members what they already knew. The quota
                     stays: it's a live count of a limit that until it landed
                     here only ever surfaced as an error toast AFTER a member had
                     spent it. Motion Control still gets nothing — its two inputs
                     really do gate the run, which is what its red dots are for. */
                  left={isOmni && !isMotionControl ? (
                    <span className="rounded-full bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink-500">
                      {`${omniQuotaUsed(state.refs)}/${OMNI_SLOT_QUOTA}`}
                    </span>
                  ) : undefined}
                  right={hasAnyRef ? (
                    <button
                      type="button"
                      onClick={clearRefs}
                      title="Remove every attached reference"
                      className="flex items-center gap-1 rounded-full bg-ink/[0.03] px-2 py-0.5 text-[10px] text-ink-500 transition-colors hover:bg-ink/[0.06] hover:text-ink-300"
                    >
                      <Eraser className="h-2.5 w-2.5" strokeWidth={2.5} />
                      Clear
                    </button>
                  ) : undefined}
                >
                  {state.mode === 'video' && isMotionControl && (
                    <MotionControlSection
                      refs={state.refs}
                      onChangeRefs={(refs) => onChange({ ...state, refs })}
                      orientation={motionOrientation}
                      onChangeOrientation={(o) => onChange({ ...state, characterOrientation: o })}
                      onError={(m) => addToast(m, 'error')}
                    />
                  )}
                  {state.mode === 'video' && !isMotionControl && hasAnyRefSlot && (
                    <div className="flex flex-col gap-3">
                      {supportsFrames && (
                        <div className="grid grid-cols-2 gap-2">
                          <FrameSlot
                            label="Start frame"
                            value={startFrameValue()}
                            onChange={(v) => setSlot('start', v)}
                            bankType="brolls"
                            tabs={PLAYGROUND_FRAME_TABS}
                          />
                          <FrameSlot
                            label="End frame"
                            value={supportsEndFrame ? endFrameValue() : null}
                            onChange={(v) => supportsEndFrame && setSlot('end', v)}
                            bankType="brolls"
                            tabs={PLAYGROUND_FRAME_TABS}
                            disabled={!supportsEndFrame}
                            disabledNote="Not supported"
                          />
                        </div>
                      )}
                      {/* Reference images and the clip strips SHARE a row when a
                          model takes both (the Seedance 2 family), images left
                          and the two clip cards stacked on the right. The images
                          row is one 64px tile high whether it holds nothing or
                          three, so on that model it was 210px of dead space
                          beside an Add tile while the clip cards took a full row
                          of their own underneath. Either kind alone spans the
                          width — the split only pays when there's something to
                          put in the gap, and the tiles want the width when the
                          clips aren't there to claim it.
                          `items-start` so a filled image grid doesn't stretch the
                          clip column to match it. */}
                      {(refsAllowed || supportsRefAudio || supportsRefVideos) && (
                        <div className={refsAllowed && (supportsRefAudio || supportsRefVideos)
                          ? 'grid grid-cols-2 items-start gap-2'
                          : ''}
                        >
                          {refsAllowed && (
                            <RefTiles
                              label="Reference Images"
                              filled={refStripValues().length > 0}
                              values={refStripValues()}
                              onChange={setRefStrip}
                              max={maxRefs}
                              bankType="models"
                              tabs={PLAYGROUND_REF_TABS}
                            />
                          )}
                          {(supportsRefAudio || supportsRefVideos) && (
                            <div className="flex flex-col gap-2">
                              {supportsRefAudio && (
                                <MediaRefStrip
                                  label="Reference Audio"
                                  filled={mediaStripValues('audio').length > 0}
                                  kind="audio"
                                  values={mediaStripValues('audio')}
                                  onChange={(v) => setMediaStrip('audio', v)}
                                  max={refAudioMax}
                                  maxTotalSeconds={refClipSeconds}
                                  onLimitError={(m) => addToast(m, 'error')}
                                />
                              )}
                              {supportsRefVideos && (
                                <MediaRefStrip
                                  label="Reference Videos"
                                  filled={mediaStripValues('video').length > 0}
                                  kind="video"
                                  values={mediaStripValues('video')}
                                  onChange={(v) => setMediaStrip('video', v)}
                                  max={refVideoMax}
                                  maxTotalSeconds={refClipSeconds}
                                  onLimitError={(m) => addToast(m, 'error')}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {isOmni && (
                        <OmniInputsSection refs={state.refs} onChangeRefs={(refs) => onChange({ ...state, refs })} />
                      )}
                    </div>
                  )}
                  {state.mode === 'image' && (
                    <RefTiles
                      label="Reference Images"
                      filled={refStripValues().length > 0}
                      values={refStripValues()}
                      onChange={setRefStrip}
                      max={4}
                      bankType="models"
                      tabs={PLAYGROUND_REF_TABS}
                    />
                  )}
                </SectionCard>
              )}

              {/* Prompt — takes the column's leftover height, and never more.
                  `grow` fills the gap that would otherwise sit between the box and
                  the pinned footer; every wrapper below is `min-h-0` so the box can
                  also SHRINK, and a long prompt stops at the bottom of the column
                  and scrolls inside itself instead of running past the port and
                  taking the Enhance / Clear toolbar off screen with it.
                  The floor lives HERE, on the section, and never as `min-h-0` plus
                  a min-height on the field: that pair lets the section collapse
                  while the field holds its own floor, and the box's overflow-hidden
                  then slices its footer toolbar off (a short window with the frame
                  + ref rows filled did exactly that).
                  150px = the box's fixed chrome (the 48px preset row + the 38px
                  toolbar) plus ~4 lines of field. It was 206, which reserved a
                  120px field even when there was nothing spare to give it — and a
                  floor is what the box collapses TO under pressure, not the size
                  it normally renders at: `grow` still hands it every spare pixel
                  the moment the column has one. The 56px that bought is what puts
                  the prompt box (and its toolbar) on screen without scrolling on
                  the most input-heavy model in the picker. */}
              <div className="relative flex min-h-[150px] grow flex-col max-md:grow-0">
                {/* Prompt field — a normal, visible textarea on top of a
                    transparent backdrop that only paints the [bracket] highlights.
                    The textarea owns every glyph, so the caret, selection and
                    click targets are always exactly where the text appears. The
                    UGC Preset trigger sits as a header row, and the Enhance /
                    Undo / Redo + Expand toolbar as a footer — both separated from
                    the text by hairlines, all inside the same rounded box. */}
                {/* Relative wrapper so the @-mention popover can float ABOVE the
                    textarea (bottom-full) instead of overlaying the text being
                    typed. The popover sits outside the overflow-hidden box below
                    so it isn't clipped. */}
                <div className="relative flex min-h-0 grow flex-col">
                  <div className="relative flex min-h-0 grow flex-col overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.03] transition-colors focus-within:border-ink/20 focus-within:bg-ink/[0.05]">
                    {/* `grow` with no basis-0: the field's base size is its own
                        content and grow only tops it up to the free space. It's
                        the scroll port once the text outruns the column, which is
                        what keeps revealCaret honest. No min-height of its own —
                        the section above carries the floor for the whole box, so
                        this shrinks WITH its siblings rather than holding a size
                        that pushes the toolbar out through the overflow-hidden. */}
                    <BracketHighlightArea
                      value={state.prompt}
                      onChange={handlePromptChange}
                      textareaRef={textareaRef}
                      onBlur={() => { commitPromptDraft(); setTimeout(() => setMentionOpen(false), 150) }}
                      className="min-h-0 grow"
                      padClass="px-3.5 pb-3 pt-3"
                      textClass="text-[13px] leading-[1.5]"
                      textareaClass="text-ink-200 placeholder-ink-600"
                      placeholder={
                        state.mode === 'image'
                          ? 'Describe the image you want… (type @ to reference banks)'
                          : isMotionControl
                          ? 'Optional. Refine the motion or leave blank…'
                          : state.mode === 'video'
                          ? 'Describe the video… (type @ to reference banks)'
                          : 'Describe the music: genre, mood, instruments…'
                      }
                    />
                    <PromptToolbar
                      accent="playground"
                      /* Presets moved OFF the top of the box and into this row
                         (September 2026). It was a 48px labelled header inside
                         the prompt box — the field's own chrome ate 48px above
                         and 38px below before a single line of the prompt, in the
                         one panel whose whole job is that field. As a pill it
                         leads the toolbar it belongs to: everything in this row
                         acts on the prompt, and appending a preset is exactly
                         that. The modal it opens still carries the full
                         "UGC Prompt Presets & Visual Styles" title, so the long
                         name is one click away rather than permanently on
                         screen. */
                      onPresets={presetsApplicable ? () => setPresetOpen(true) : undefined}
                      presetsTitle="UGC Prompt Presets & Visual Styles"
                      onEnhance={handleEnhancePrompt}
                      enhanceTitle="Enhance prompt"
                      enhanceDisabled={!state.prompt.trim()}
                      busy={isEnhancing}
                      onClear={handlePromptClear}
                      clearDisabled={!state.prompt.trim()}
                      onUndo={handlePromptUndo}
                      canUndo={canUndo}
                      onRedo={handlePromptRedo}
                      canRedo={canRedo}
                      onExpand={() => setPromptExpanded(true)}
                    />
                  </div>
                  {mentionOpen && state.mode !== 'music' && !isMotionControl && (
                    <div className="absolute bottom-full left-0 z-50 mb-2 w-[300px] max-w-full">
                      <MentionPopover
                        query={mentionQuery}
                        onSelect={handleMentionSelect}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Voice — directly under the prompt box, appended to the end of
                  it at generate time. It's a field of its own because the
                  profile is the one part of a UGC video prompt that must stay
                  identical across every clip of an ad: in the prompt box it had
                  to be re-pasted two lines under every rewrite, and it went with
                  Clear. Video only (and not Motion Control, which has no audio)
                  — a voice says nothing about a still or a music track. */}
              {state.mode === 'video' && !isMotionControl && (
                <VoiceCard
                  value={state.voiceProfile ?? ''}
                  open={state.voiceOpen ?? true}
                  onChange={(voiceProfile) => onChange({ ...state, voiceProfile })}
                  onToggleOpen={() => onChange({ ...state, voiceOpen: !(state.voiceOpen ?? true) })}
                />
              )}

            </div>
          </div>

          {/* Preset picker — the same modal chrome as the bank pickers, so the
              app reads as one pattern. */}
          <Modal
            open={presetOpen}
            onClose={() => setPresetOpen(false)}
            title="UGC Prompt Presets & Visual Styles"
            // The Characters preset picker's own width, because this is the
            // longest picture library in the app: fourteen prompt presets under
            // seven looks and your own saved styles. Three tiles across a 672px
            // panel made that six screens of scroll. It is the one gallery here
            // that still scrolls at all, which is exactly what earns it the
            // rail — one click to the presets instead of three rows.
            size="gallery"
            rail={
              <SectionRail
                sections={[
                  { key: 'styles', label: 'Visual Styles', count: CONTINUOUS_STYLES.length + savedStyles.length },
                  { key: 'presets', label: 'Prompt Presets', count: (state.mode === 'image' ? IMAGE_PRESETS : VIDEO_PRESETS).length },
                ]}
                activeKey={presetSpy.activeKey}
                accent="playground"
                onJump={presetSpy.jumpTo}
              />
            }
            bodyRef={presetSpy.portRef}
            onBodyScroll={presetSpy.onScroll}
            // A body that scrolls holds its height, or the rail's rows move
            // under the pointer as the panel resizes itself.
            fill
          >
            {/* Visual styles FIRST: a look is the broader decision — it applies to
                anything you were going to make — where a preset is one specific
                shot. Same 9:16 tiles and the same preview art as the B-Roll and
                Characters style pickers, so a style is recognised by its picture
                wherever it's offered. Nothing is marked "active": Playground keeps
                no style of its own, it appends the brief to the prompt, which is
                then the member's to edit like anything else they typed. */}
            <div className="px-4 py-3">
              <GallerySectionHeading label="Visual Styles" innerRef={presetSpy.register('styles')} className="mb-3" />
              <div className={GALLERY_GRID}>
                {CONTINUOUS_STYLES.map((s) => (
                  <StyleTile
                    key={s.id}
                    name={s.label}
                    imageUrl={STYLE_PREVIEWS[s.id]}
                    active={false}
                    accent={PLAYGROUND_STYLE_ACCENT}
                    onClick={() => { applyStyle({ styleId: s.id }); setPresetOpen(false) }}
                  />
                ))}
                {/* The member's own saved looks, from the Styles bank — read-only
                    here; creating one still lives in B-Roll's style picker, which
                    owns the reference-frame analysis. */}
                {savedStyles.map((s) => (
                  <StyleTile
                    key={s.id}
                    imageRef={(s.thumbRefs ?? [])[0]}
                    name={s.name}
                    active={false}
                    accent={PLAYGROUND_STYLE_ACCENT}
                    onClick={() => { applyStyle({ styleId: 'ugc', styleBrief: s.brief }); setPresetOpen(false) }}
                  />
                ))}
              </div>

              <GallerySectionHeading label="Prompt Presets" innerRef={presetSpy.register('presets')} className="mb-3 mt-6" />
              <div className={GALLERY_GRID}>
                {(state.mode === 'image' ? IMAGE_PRESETS : VIDEO_PRESETS).map((preset) => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    onClick={() => {
                      applyPreset(preset)
                      setPresetOpen(false)
                    }}
                  />
                ))}
              </div>
            </div>
          </Modal>

          <ExpandTextModal
            open={promptExpanded}
            onClose={() => { commitPromptDraft(); setPromptExpanded(false) }}
            value={state.prompt}
            onChange={(v) => onChange({ ...state, prompt: v })}
            title="Prompt"
            accent="playground"
            highlightBrackets
            placeholder={
              state.mode === 'image'
                ? 'Describe the image you want…'
                : state.mode === 'video'
                ? 'Describe the video…'
                : 'Describe the music: genre, mood, instruments…'
            }
          />
        </div>

        {/* Bottom: pinned footer — model picker + output settings + big Generate
            button. The model picker sits directly above the output-settings pills
            it configures. */}
        {/* No hairline above this: the prompt box now ends where its text ends, so
            the gap between it and the model row already reads as the seam. */}
        {/* 8px between the model row, the settings pills and Generate — the
            rhythm Scripts and B-Roll run on — and 8px from the scrolling column
            above, which is this band's own `pt-2` rather than the column's
            padding: padding inside a scroller scrolls away with the content. */}
        {/* Not pinned on a phone (August 2026, Massimo's call): a fixed band cost
            ~180px of a ~700px column — the picker row, the settings pills and a
            54px button, all of it standing over the fields it belongs to — and
            the flow it protected wasn't worth it. You fill the form top to
            bottom, and Generate is where you arrive. It stays pinned from `md`
            up, where the column has the height to spare. */}
        <div className="shrink-0 px-5 pb-3 pt-2">
          {/* Model — video uses the full picker modal (matching B-Roll); image
              and music keep the inline dropdown (which auto-opens upward here).
              Music's pair sat ABOVE the prompt box for a stint (August 2026) on
              the reasoning that neither is an output setting; they came back
              down here in September 2026 (Massimo's call) because what a member
              reads top to bottom in this panel is the mode tabs, then the thing
              they type, and standing two full-width controls between the two put
              the panel's whole subject 110px down the column. Every mode now
              settles what it is making in the same band, directly over the
              button that makes it. */}
          {/* The model row is a TWO-UP: the picker, and the how-many stepper
              beside it at the same 58px picker-row height. The count used to
              ride in the settings row below, where a video model that declares
              every dimension it has (Seedance: resolution, aspect, duration,
              audio) already fills the line — a fifth pill wrapped that row onto
              a third line and the band grew by 56px every time. The count is
              also the one control there that isn't a property of the OUTPUT:
              resolution, aspect, duration and audio all describe the clip, and
              this describes the run. It belongs beside the model, which is the
              other thing the run is. */}
          <div className="mb-2 flex items-center gap-2">
            <div className="min-w-0 flex-1">
            {state.mode === 'video' ? (
              <>
                {/* Trigger — provider logo + name + star + "% off", an arrow
                    (not a chevron) for the picker modal, and no credits badge. */}
                <button
                  type="button"
                  onClick={() => setModelPanelOpen(true)}
                  className="flex h-[58px] w-full items-center gap-3 rounded-full border border-ink/10 bg-ink/[0.02] px-4 text-left transition-colors hover:bg-ink/[0.05]"
                >
                  {model ? (
                    <>
                      <ProviderLogo provider={model.provider} />
                      <ModelTriggerLabel
                        name={model.displayName}
                        recommended={model.tags.includes('recommended')}
                        savings={modelSavings}
                      />
                    </>
                  ) : (
                    <span className="flex-1 truncate text-sm text-ink-400">Select model</span>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-500" />
                </button>
                <ModelPickerModal
                  appId="playground"
                  task="video"
                  mode={pickerMode}
                  isOpen={modelPanelOpen}
                  onClose={() => setModelPanelOpen(false)}
                  value={state.modelId}
                  onChange={(modelId) => {
                    useSettingsStore.getState().setAppModel(modelKey, modelId)
                    onChange({ ...state, modelId })
                  }}
                  costParams={{
                    durationSeconds: isMotionControl ? motionDuration : state.durationSeconds,
                    resolution: state.resolution,
                    audio: state.audio,
                    videoInput: hasVideoInput,
                  }}
                />
              </>
            ) : (
              <ModelPicker
                row
                appId="playground"
                task={taskForMode}
                mode={pickerMode}
                value={state.modelId}
                onChange={(modelId) => onChange({ ...state, modelId })}
              />
            )}
            </div>
            {/* How many. Playground is where a prompt gets TRIED, so a run of
                one is the wrong unit most of the time. `stacked` because at
                58px a number and its word side by side float mid-pill, and the
                word is what makes a bare stepper on a model row read as a
                count rather than as a nudge on the model itself. */}
            {/* Not on Music: Suno returns a pair of tracks per call, so a
                count here would multiply an already-doubled run. */}
            {state.mode !== 'music' && (
              <BatchCountStepper
                stacked
                size="xl"
                accent="playground"
                noun={state.mode === 'video' ? 'clip' : 'image'}
                // Title Case, like every other label the member reads on a
                // control (Massimo's call). `noun` stays lower case — it is
                // written into sentences ("2 clips per press"), not shown as a
                // label of its own.
                label={state.mode === 'video' ? 'Clips' : 'Images'}
                value={batchCount}
                onChange={(n) => onChange({ ...state, batchCount: n })}
                creditsFor={creditsForRun}
              />
            )}
          </div>
          {/* Music's delivery toggle — the one thing that is settled about the
              track before it is written, so it takes the slot the other modes'
              output settings take: under the model, over Generate. `h-12` is
              the `size='lg'` chip height those settings run at, so the band is
              the same three rows in every mode. */}
          {state.mode === 'music' && (
            <SegmentedToggle<'instrumental' | 'lyrics'>
              className="mb-2 h-12 !p-1"
              accent="playground"
              value={state.instrumental ? 'instrumental' : 'lyrics'}
              onChange={(v) => onChange({ ...state, instrumental: v === 'instrumental' })}
              options={[
                { value: 'instrumental', label: 'Instrumental' },
                { value: 'lyrics', label: 'Lyrics' },
              ]}
            />
          )}
          {/* Output settings — resolution / aspect / duration / audio, all of
              them properties of the thing being made. A model that declares no
              constraints has none, and the row is skipped rather than rendered
              empty with its own margin under it — which it now can be, since the
              batch stepper moved up to the model row and no longer holds the line
              open on its own. Sits just above Generate; dropdowns open upward. */}
          {hasOutputSettings && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {state.mode === 'video' && model?.videoConstraints && (
            <>
              <ConstraintChip
                grow
                size="lg"
                openDirection="up"
                options={model.videoConstraints.resolutions}
                value={state.resolution}
                onChange={(v) => onChange({ ...state, resolution: v })}
                render={videoResolutionLabel}
              />
              {/* Motion Control has no aspect/duration/audio controls — clip
                  length comes from the driving video and aspect from the
                  character image. Only the resolution chip applies.
                  Image-conditioned models (e.g. Kling 3.0 Turbo) also expose
                  no aspect param — aspect is inherited from the input image,
                  so aspectRatios is [] and the chip stays hidden. */}
              {!isMotionControl && model.videoConstraints.aspectRatios.length > 0 && (
              <ConstraintChip
                grow
                size="lg"
                openDirection="up"
                options={model.videoConstraints.aspectRatios}
                value={state.aspectRatio}
                onChange={(v) => onChange({ ...state, aspectRatio: v })}
                render={(v) => (
                  <span className="flex items-center gap-1.5">
                    <AspectIcon ratio={v} />
                    <span>{v}</span>
                  </span>
                )}
              />
              )}
              {!isMotionControl && model.videoConstraints.durations.length > 0 && (
                <ConstraintChip
                  grow
                  size="lg"
                  openDirection="up"
                  options={model.videoConstraints.durations.map(String)}
                  value={String(state.durationSeconds)}
                  onChange={(v) => onChange({ ...state, durationSeconds: Number(v) })}
                  render={(v) => <span>{v}s</span>}
                />
              )}
              {!isMotionControl && model.videoConstraints.supportsAudio && (
                <ConstraintChip
                  grow
                  size="lg"
                  openDirection="up"
                  options={['Audio', 'Mute']}
                  value={state.audio ? 'Audio' : 'Mute'}
                  onChange={(v) => onChange({ ...state, audio: v === 'Audio' })}
                  triggerClassName={state.audio
                    ? 'border-playground-500/30 bg-playground-500/10 text-playground-200'
                    : 'border-ink/10 bg-ink/[0.02] text-ink-400 group-hover:bg-ink/[0.05]'}
                  render={(v) => (
                    <span className="flex items-center gap-1.5">
                      {v === 'Audio' ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                      <span>{v}</span>
                    </span>
                  )}
                />
              )}
            </>
          )}

          {state.mode === 'image' && model?.imageConstraints && (
            <>
              <ConstraintChip
                grow
                size="lg"
                openDirection="up"
                options={model.imageConstraints.resolutions}
                value={state.resolution}
                onChange={(v) => onChange({ ...state, resolution: v })}
                renderOption={(v) => {
                  // Priced for the armed run, so this menu and the Generate
                  // button can't quote two different numbers.
                  const credits = formatCredits(estimateCredits(state.modelId, { imageCount: batchCount, resolution: v }))
                  return (
                    <span className="flex w-full items-center justify-between gap-6">
                      <span>{v}</span>
                      {credits && <span className="text-ink-500">{credits}</span>}
                    </span>
                  )
                }}
              />
              {model.imageConstraints.aspectRatios && (
                <ConstraintChip
                  grow
                  size="lg"
                  openDirection="up"
                  options={model.imageConstraints.aspectRatios}
                  value={state.aspectRatio}
                  onChange={(v) => onChange({ ...state, aspectRatio: v })}
                  render={(v) => (
                    <span className="flex items-center gap-1.5">
                      <AspectIcon ratio={v} />
                      <span>{v}</span>
                    </span>
                  )}
                />
              )}
            </>
          )}

          </div>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2.5 glass-fill glass-fill-soft rounded-full border border-white/15 bg-playground-500 px-7 py-4 text-sm font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(255,255,255,0.08)] btn-soft-shadow transition-all hover:brightness-110 disabled:hover:brightness-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <GenerateIcon className="h-4 w-4" strokeWidth={2.5} />
            <span>{generateLabel}</span>
            {generateCredits && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs font-semibold tracking-tight">
                <Coins className="h-3 w-3" strokeWidth={2} />
                {generateCredits}
              </span>
            )}
          </button>
          {state.mode === 'image' && <ModelWaitNotice modelId={state.modelId} className="mt-2" />}
        </div>
      </div>
    </div>
  )
}

