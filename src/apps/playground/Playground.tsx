import { useCallback, useEffect, useRef, useState } from 'react'
import { Images, Wand2 } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import MobilePaneTabs from '../../components/MobilePaneTabs'
import { paneClass } from '../../components/paneClass'
import { clampBatchCount } from '../../utils/batchCount'
import { useReportActivity } from '../../stores/activityStore'
import type { VideoSourceClipPayload, ImageHistoryItem } from '../../stores/types'
import { isAssetRef, getAsBase64 } from '../../utils/assetStore'
import { useSettingsStore } from '../../stores/settingsStore'
import {
  startPlaygroundImageTask,
  finishPlaygroundImageTask,
  startPlaygroundVideoTask,
  finishPlaygroundVideoTask,
  startPlaygroundMusicTask,
  finishPlaygroundMusicTask,
} from './service'
import PromptPanel, { type PromptPanelState, type PromptRef } from './components/PromptPanel'
import { composePlaygroundPrompt } from './composePrompt'
import PlaygroundHistoryGrid from './components/PlaygroundHistoryGrid'
import { getDefaultModel, getModel, mixedImageInputPolicy, type AspectRatio, type ImageResolution, type VideoMode } from '../../utils/models'
import type { PlaygroundMode, InFlightGen } from './types'
import { usePersistedState, useProjectScopedKey } from '../../hooks/usePersistedState'
import { humanizeError } from '../../utils/friendlyError'
import { isPollTimeout } from '../../utils/kie'

// How long an in-flight task stays resumable. A poll timeout no longer drops
// the tile (the kie task may still be rendering — Seedance 2 can run 15+ min),
// so the entry survives until either it finishes on a later poll/refresh or it
// crosses this age, at which point we give up and clear the tile. Must be
// comfortably larger than the poll budget (VIDEO_POLL_ATTEMPTS ≈ 20 min) so a
// refresh after kie finishes still has a window to download the result.
const STALE_TASK_MS = 60 * 60 * 1000 // 60 minutes

// Infer the video mode from which ref slots the user filled. Only image
// slots participate — audio/video reference clips and the Omni inputs are
// orthogonal extras that don't change the kie request family.
function inferVideoMode(refs: PromptRef[]): VideoMode {
  const startCount = refs.filter((r) => r.slot === 'start').length
  const endCount = refs.filter((r) => r.slot === 'end').length
  const refCount = refs.filter((r) => r.slot === 'ref').length
  if (refCount > 0 && startCount === 0 && endCount === 0) return 'reference-to-video'
  if (startCount > 0 && endCount > 0) return 'frames-to-video'
  if (startCount > 0) return 'image-to-video'
  if (refCount > 0) return 'reference-to-video'
  return 'text-to-video'
}

// Uploaded audio/video clips are data URIs far beyond the localStorage quota
// (a 15MB clip is ~20MB of JSON), so they're kept in memory only — the
// persisted draft drops them. Bank-picked media (`asset://` refs) and image
// refs keep their existing persistence behaviour.
function pruneHeavyRefs(refs: PromptRef[]): PromptRef[] {
  return refs.filter(
    (r) => !(
      (r.slot === 'audio' || r.slot === 'video' || r.slot === 'omni-clip' || r.slot === 'motion-video') &&
      r.url.startsWith('data:')
    ),
  )
}

// When the user picks a text-to-image model but attaches reference images,
// kie silently runs a text-only generation and ignores the refs — burning
// credits for nothing. Mirror the B-Roll Studio swap (`startImageTask` in
// `generateBroll.ts`): prefer the picked model's own i2i mode, fall back to
// a same-family `-image-to-image` sibling, then the registry default i2i.
function resolveImageModelForRefs(pickedId: string, hasRefs: boolean): string {
  const targetMode = hasRefs ? 'image-to-image' : 'text-to-image'
  const picked = getModel(pickedId)
  if (picked?.modes?.includes(targetMode)) return picked.id
  if (hasRefs && picked) {
    const family = picked.id.replace(/-(text-to-image|image-to-image|image-edit).*$/, '')
    const sibling = getModel(`${family}-image-to-image`)
    if (sibling) return sibling.id
  }
  return useSettingsStore.getState().getAppModel(`playground:image:${targetMode}`)
    ?? getDefaultModel('playground', 'image', targetMode)?.id
    ?? pickedId
}

// Finish one persisted in-flight task (the resume-on-mount walk below).
//
// Module scope on purpose: this lives outside the component so the component
// itself stays compilable. The React Compiler cannot lower a `try`/`finally`,
// and one anywhere inside a component makes it skip optimizing the whole thing
// — which for Playground means the history grid re-renders on every character
// typed into the prompt bar.
async function finishResumedTask(gen: InFlightGen): Promise<void> {
  if (gen.mode === 'image' && gen.imageParams) {
    await finishPlaygroundImageTask(gen.taskId!, gen.modelId, {
      prompt: gen.prompt,
      aspectRatio: gen.imageParams.aspectRatio,
      resolution: gen.imageParams.resolution,
    })
  } else if (gen.mode === 'video' && gen.videoParams) {
    await finishPlaygroundVideoTask(gen.taskId!, gen.modelId, gen.videoParams.videoEndpoint, {
      prompt: gen.prompt,
      mode: gen.videoParams.mode,
      aspectRatio: gen.videoParams.aspectRatio,
      durationSeconds: gen.videoParams.durationSeconds,
      resolution: gen.videoParams.resolution,
      audio: gen.videoParams.audio,
    })
  } else if (gen.mode === 'music' && gen.musicParams) {
    await finishPlaygroundMusicTask(gen.taskId!, gen.modelId, {
      prompt: gen.prompt,
      instrumental: gen.musicParams.instrumental,
    })
  }
}

// For video, a silent ref-drop is harder to recover from — duration / aspect
// / audio caps differ per model, so substituting a different model family
// risks changing what the user expects. Try only a same-family sibling that
// declares the inferred mode; otherwise return null so the caller surfaces a
// toast and aborts. (No registry-default fallback — too lossy across families.)
function resolveVideoModelForMode(pickedId: string, inferred: VideoMode): string | null {
  const picked = getModel(pickedId)
  if (picked?.modes?.includes(inferred)) return picked.id
  if (picked) {
    const family = picked.id.replace(/-(text-to-video|image-to-video|frames-to-video|reference-to-video).*$/, '')
    const sibling = getModel(`${family}-${inferred}`)
    if (sibling?.modes?.includes(inferred)) return sibling.id
  }
  return null
}

function initialState(): PromptPanelState {
  // Playground opens on the Image tab — the workflow it's used for starts with
  // a still, which the Animate button then carries into Video. Seed the model
  // from the user's last image pick (or the registry's image default) so the
  // picker isn't briefly out of sync with the mode on first paint.
  const defaultImage = getDefaultModel('playground', 'image', 'text-to-image')?.id ?? 'nano-banana-2'
  const persistedImage = useSettingsStore.getState().getAppModel('playground:image:text-to-image')
  return {
    mode: 'image',
    prompt: '',
    modelId: persistedImage ?? defaultImage,
    aspectRatio: '9:16',
    durationSeconds: 5,
    resolution: '1K', // snapped to the model's video default by sanitize / the constraint effect
    audio: true,
    instrumental: true,
    refs: [],
    batchCount: 1,
  }
}

export default function Playground() {
  const baseKey = useProjectScopedKey('playground')
  // Phone-only: which of the two panes is on screen (ignored from md up).
  const [pane, setPane] = useState<'prompt' | 'history'>('prompt')
  // Sanitize hydrated state so a few "users always want this" defaults
  // re-assert themselves on every load:
  // - Audio = on. Users routinely forget to flip the chip and end up with a
  //   silent video clip. Easier to mute occasionally than miss audio always.
  // - Instrumental = on. UGC ad scoring is overwhelmingly instrumental;
  //   lyrics are the rare case worth opting into per-track.
  // - Video resolution = clamped to a tier the picked model actually offers.
  //   Deliberately NOT re-stamped to the model's preferred default: that ran on
  //   every hydrate, so a member who chose a different tier lost it on the next
  //   refresh. The default belongs to picking a model, not to reloading a draft.
  const [state, setState] = usePersistedState<PromptPanelState>(`${baseKey}:state`, initialState(), {
    sanitize: (v) => {
      const next = { ...v, audio: true, instrumental: true, batchCount: clampBatchCount(v.batchCount) }
      // A persisted draft can point at a model that has since been removed
      // from the registry (e.g. a retired video model). Snap back to the
      // mode's default so generate doesn't throw "Unknown model".
      let m = getModel(v.modelId)
      if (!m) {
        const task = v.mode === 'image' ? 'image' : v.mode === 'music' ? 'music' : 'video'
        next.modelId = getDefaultModel('playground', task)?.id ?? next.modelId
        m = getModel(next.modelId)
      }
      const videoConstraints = m?.videoConstraints
      if (v.mode === 'video' && videoConstraints && !videoConstraints.resolutions.includes(v.resolution)) {
        next.resolution = videoConstraints.default ?? videoConstraints.resolutions[0] ?? next.resolution
      }
      return next
    },
    prune: (v) => ({ ...v, refs: pruneHeavyRefs(v.refs) }),
  })
  // Persisted across reload so a tab refresh / app switch can resume polling
  // an in-flight kie task. Tasks without a `taskId` (still in the createTask
  // leg when the tab died) and tasks older than 30 min are auto-expired on
  // mount — see the resume effect below.
  const [inFlight, setInFlight] = usePersistedState<InFlightGen[]>(`${baseKey}:inflight`, [])
  // Per-tab prompt + refs. Each mode keeps its own inputs so typing a video
  // prompt and flipping to Image doesn't drag the text along. Persisted so a
  // refresh keeps every tab's draft. The active tab's inputs live in `state`;
  // this only holds the *other* tabs' stashed drafts.
  const [promptStash, setPromptStash] = usePersistedState<Record<PlaygroundMode, { prompt: string; refs: PromptRef[] }>>(
    `${baseKey}:promptstash`,
    { image: { prompt: '', refs: [] }, video: { prompt: '', refs: [] }, music: { prompt: '', refs: [] } },
    {
      prune: (v) => ({
        image: { ...v.image, refs: pruneHeavyRefs(v.image.refs) },
        video: { ...v.video, refs: pruneHeavyRefs(v.video.refs) },
        music: { ...v.music, refs: pruneHeavyRefs(v.music.refs) },
      }),
    },
  )
  // The live draft, read by handlers that must NOT be re-created on every
  // keystroke. `handleAnimateImage` is handed to the history grid: closing it
  // over `state` directly gave the grid a new prop on every character typed
  // into the prompt bar, which re-rendered every history row — at a few hundred
  // generations that alone was tens of milliseconds per keystroke. Reading
  // through the ref keeps the handler's identity stable, so React skips the
  // whole grid while you type.
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])
  const promptStashRef = useRef(promptStash)
  useEffect(() => { promptStashRef.current = promptStash }, [promptStash])

  const interAppPayload = useAppStore((s) => s.interAppPayload)
  const consumePayload = useAppStore((s) => s.consumePayload)
  const activeApp = useAppStore((s) => s.activeApp)
  const addToast = useAppStore((s) => s.addToast)

  // Inter-app payload consumer: incoming refs / prompt seed from other apps.
  useEffect(() => {
    if (activeApp !== 'playground') return
    if (!interAppPayload || interAppPayload.targetApp !== 'playground') return
    const { targetField, data } = interAppPayload
    if (targetField === 'prompt' && typeof data === 'string') {
      setState((s) => ({ ...s, prompt: data }))
    } else if (targetField === 'videoPrompt' && typeof data === 'string') {
      // A scene or shot prompt from Scripts / the Ad Analyzer → land in video
      // mode with the prompt prefilled. Everything ELSE on the draft is left
      // alone, which is what makes this worth a button per shot: the Voice box,
      // the references and the model all survive, so sending shot after shot
      // only ever swaps the words.
      //
      // The mode flip stashes like `handleModeChange` does, and restores the
      // Video tab's own refs. Without the stash an image draft is silently
      // overwritten by the incoming prompt; without the restore you arrive on a
      // video prompt carrying the Image tab's attachments. Read through
      // `stateRef`, which this effect's sibling above has already refreshed.
      const draft = stateRef.current
      if (draft.mode === 'video') {
        setState((s) => ({ ...s, prompt: data }))
      } else {
        setPromptStash((prev) => ({ ...prev, [draft.mode]: { prompt: draft.prompt, refs: draft.refs } }))
        const restored = promptStashRef.current.video ?? { prompt: '', refs: [] }
        setState((s) => ({ ...s, mode: 'video', prompt: data, refs: restored.refs }))
      }
    } else if (targetField === 'imageRef' && typeof data === 'string') {
      setState((s) => ({
        ...s,
        refs: [...s.refs, { url: data, label: 'imported', source: 'upload', slot: 'ref' }],
      }))
    } else if (targetField === 'videoStartFrame') {
      // Accept either a bare data URI (string) or { imageUrl, prompt } from
      // upstream apps (B-Roll bank "Animate" sends the object form so the user
      // arrives with the source prompt already in the bar).
      let imageUrl: string | undefined
      let incomingPrompt: string | undefined
      if (typeof data === 'string') {
        imageUrl = data
      } else if (data && typeof data === 'object' && 'imageUrl' in data) {
        const obj = data as { imageUrl: string; prompt?: string }
        imageUrl = obj.imageUrl
        incomingPrompt = obj.prompt
      }
      if (imageUrl) {
        setState((s) => ({
          ...s,
          mode: 'video',
          prompt: incomingPrompt?.trim() ? incomingPrompt : s.prompt,
          refs: [...s.refs.filter((r) => r.slot !== 'start'), { url: imageUrl!, label: 'start', source: 'upload', slot: 'start' }],
        }))
      }
    } else if (targetField === 'videoSourceClip' && data && typeof data === 'object' && 'videoRef' in data) {
      // Generated video (B-Roll take, etc.) → Gemini Omni source clip, for
      // redubs/restyles of an existing clip. The Omni family is what takes a
      // source video at all, so the handoff switches to it outright, and it
      // picks Flash 1.1 — the newer of the two, and the same flat price on a
      // clip-input run (168 credits, 252 at 4k), so there is nothing to trade.
      // Refs are replaced wholesale: leftover images could bust the 7-slot
      // quota, and a stale start frame is worse here than it looks — 1.0 has no
      // frame fields and would fold it in as another reference, while 1.1 DOES,
      // so it would land as frame one and fight the clip for what the take
      // opens on. The prompt is left alone — with a source clip it's the change
      // instruction ("same take, dialogue in Spanish"), not a scene brief.
      const clip = data as VideoSourceClipPayload
      const omni = getModel('google/gemini-omni-flash-1-1')
      const knownDuration = Number.isFinite(clip.durationSeconds) && clip.durationSeconds! > 0
        ? clip.durationSeconds!
        : undefined
      // Same floor the trim inputs enforce (ends ≥ start + 0.5).
      const ends = Math.max(0.5, Math.min(10, knownDuration ?? 10))
      setState((s) => ({
        ...s,
        mode: 'video',
        modelId: 'google/gemini-omni-flash-1-1',
        resolution: omni?.videoConstraints?.default ?? s.resolution,
        audio: true,
        refs: [{
          url: clip.videoRef,
          label: clip.label ?? 'Source clip',
          source: 'broll',
          slot: 'omni-clip',
          clipStart: 0,
          clipEnds: Math.round(ends * 10) / 10,
          durationSeconds: knownDuration,
        }],
      }))
    }
    consumePayload()
  }, [interAppPayload, activeApp, consumePayload])

  // Resume-on-mount. Walks persisted inFlight[] and finishes any task that
  // still has a taskId. useRef<Set> guards against React 18 strict-mode
  // double-invoke. Only runs once on mount — new entries added during this
  // session don't need resume, they already run in handleSubmit.
  const resuming = useRef<Set<string>>(new Set())
  // Read the queue through a ref rather than closing over it with a suppressed
  // exhaustive-deps warning: a disabled React lint rule tells the React
  // Compiler the file breaks its rules, and it then skips optimizing this
  // WHOLE component — which is the one holding the prompt draft, so every
  // keystroke re-rendered the history grid beside it.
  const inFlightRef = useRef(inFlight)
  useEffect(() => { inFlightRef.current = inFlight }, [inFlight])
  // The deps below are stable identities, so this fires once — but the ref now
  // tracks the LIVE queue, so a re-fire would try to resume this session's own
  // gens (which handleSubmit already owns) and download each result twice.
  // The flag makes "once" structural rather than a property of the deps.
  const didResumeRef = useRef(false)
  useEffect(() => {
    if (didResumeRef.current) return
    didResumeRef.current = true
    for (const gen of inFlightRef.current) {
      if (resuming.current.has(gen.id)) continue
      if (!gen.taskId) {
        setInFlight((prev) => prev.filter((g) => g.id !== gen.id))
        continue
      }
      if (Date.now() - gen.startedAt > STALE_TASK_MS) {
        setInFlight((prev) => prev.filter((g) => g.id !== gen.id))
        addToast(`${gen.mode} generation expired — it ran too long to recover`, 'error')
        continue
      }
      resuming.current.add(gen.id)
      void finishResumedTask(gen)
        .then(() => {
          addToast(`${gen.mode} resumed and ready`, 'success')
          setInFlight((prev) => prev.filter((g) => g.id !== gen.id))
        })
        .catch((err: unknown) => {
          if (isPollTimeout(err)) {
            // The poll budget ran out but kie may still be rendering. Leave the
            // entry persisted so a later refresh resumes it again; the staleness
            // guard above evicts it once it crosses STALE_TASK_MS.
            return
          }
          addToast(humanizeError(err, `Resume failed (${gen.mode})`), 'error')
          setInFlight((prev) => prev.filter((g) => g.id !== gen.id))
        })
        .finally(() => { resuming.current.delete(gen.id) })
    }
    // Mount-only in effect: `resuming` dedupes, and both deps are stable
    // identities (a zustand action and a useState setter).
  }, [addToast, setInFlight])

  async function handleSubmit() {
    if (!state.modelId) return

    // On a phone only one pane is on screen — follow the run to the grid.
    setPane('history')

    const mode = state.mode

    // Snapshot every input synchronously so subsequent prompt-bar edits don't
    // mutate this job's params while it runs.
    const refsSnapshot = state.refs.slice()
    const hasRefs = refsSnapshot.length > 0
    // Motion Control fixes the video mode (it doesn't infer from frame slots)
    // and makes the prompt optional but the character image + driving video
    // required. Everything else infers the mode from the attached frames.
    const isMotionControl = mode === 'video' && !!getModel(state.modelId)?.motionControl
    // The prompt as the model will actually see it — the member's text with the
    // Voice box's profile on the end. Composed here rather than folded into
    // `state.prompt` so the box keeps holding it across a Clear, an Enhance and
    // the next idea, and read from `promptText` everywhere below so the tile,
    // the history row and Copy prompt all show the string that was sent.
    const promptText = composePlaygroundPrompt(state, isMotionControl)
    let inferredVideoMode: VideoMode = isMotionControl ? 'motion-control' : inferVideoMode(refsSnapshot)
    // Reconcile the inferred mode with what the picked model actually declares,
    // in BOTH directions, because the pictures reach the model either way:
    //
    //   ref → image: an image-to-video-only model (Kling 3.0 Turbo) can't take
    //     a reference image but CAN animate it as a start frame.
    //   frame → ref: a frame-less model (Seedance 2.5, Gemini Omni) has no
    //     first_frame_url/last_frame_url at all and folds every attached image
    //     into its reference array — see the per-model branches in
    //     buildVideoInput, which do exactly that with a stray frame.
    //
    // The second direction is why this exists. Attaching a start frame AND a
    // reference image made inferVideoMode return 'image-to-video', which
    // Seedance 2.5 doesn't declare, so the run was refused with a toast naming
    // a limitation the model doesn't have — on a generation it would have run
    // fine. Downgrade instead, and send the frames as references below.
    if (!isMotionControl && mode === 'video') {
      const picked = getModel(state.modelId)
      const modes = picked?.modes ?? []
      if (picked && !modes.includes(inferredVideoMode)) {
        if (inferredVideoMode === 'reference-to-video' && modes.includes('image-to-video')) {
          inferredVideoMode = 'image-to-video'
        } else if (modes.includes('reference-to-video')) {
          inferredVideoMode = 'reference-to-video'
        } else if (inferredVideoMode === 'frames-to-video' && modes.includes('image-to-video')) {
          // Start frame only — the end frame has nowhere to go on this model.
          inferredVideoMode = 'image-to-video'
        }
      }
      // A frame and a reference attached together, on a model that re-routes
      // for references (MiniMax H3, Kling 3.0 Omni): take the reference route,
      // which carries BOTH — the frame rides as a reference image. Dropping the
      // character to keep frame-one is the worse half of that trade, and it's
      // the one the request builders already make for themselves further down
      // (minimaxH3Route / klingOmniRoute pick 'reference' the moment a
      // reference is present, so this only makes the mode agree with the body).
      if (
        mixedImageInputPolicy(picked?.id) === 'reference' &&
        inferredVideoMode !== 'reference-to-video' &&
        refsSnapshot.some((r) => r.slot === 'ref')
      ) {
        inferredVideoMode = 'reference-to-video'
      }
    }
    // The member's own text, not the composed string: a voice profile with no
    // prompt in front of it isn't a generation (and the button is already grey).
    if (!isMotionControl && !state.prompt.trim()) return
    if (isMotionControl) {
      const hasImg = refsSnapshot.some((r) => r.slot === 'motion-image')
      const hasVid = refsSnapshot.some((r) => r.slot === 'motion-video')
      if (!hasImg || !hasVid) {
        addToast('Motion Control needs a character image and a driving video.', 'error')
        return
      }
    }
    const motionOrientation = state.characterOrientation ?? 'video'
    const motionDuration = Math.min(
      refsSnapshot.find((r) => r.slot === 'motion-video')?.durationSeconds ?? 5,
      motionOrientation === 'image' ? 10 : 30,
    )

    // Auto-swap the model to match what the user actually attached.
    // Image: text-to-image → image-to-image sibling when refs are present.
    // Video: abort if the picked model can't run the inferred mode (refs
    // would be silently dropped by the body builder otherwise).
    let modelId = state.modelId
    if (mode === 'image') {
      modelId = resolveImageModelForRefs(state.modelId, hasRefs)
    } else if (mode === 'video' && !isMotionControl) {
      const resolved = resolveVideoModelForMode(state.modelId, inferredVideoMode)
      if (!resolved) {
        // Everything the model COULD do with the attached pictures has already
        // been tried above, so reaching here means it takes no images at all.
        // Say that, rather than naming an internal mode ("image to video") the
        // member never picked and can't see.
        const pickedLabel = getModel(state.modelId)?.displayName ?? state.modelId
        addToast(
          `${pickedLabel} generates from the prompt only — it takes no images. Remove the attached images, or pick a model that accepts them.`,
          'error',
        )
        return
      }
      modelId = resolved
    }

    // What this run does with a frame and a reference attached together, and
    // whether anything is left behind — decided per model, and said out loud
    // before the credits go. Every branch here used to be one silent drop: the
    // tile generated, the clip came back without the character in it, and
    // nothing on screen had mentioned it.
    const mixedPolicy = mixedImageInputPolicy(modelId)
    const hasPlainRefs = refsSnapshot.some((r) => r.slot === 'ref')
    const hasFrames = refsSnapshot.some((r) => r.slot === 'start' || r.slot === 'end')
    // 'merged' models take both in one flat array and nothing is dropped, so
    // they deliberately say nothing. 'reference' models were re-routed above and
    // carry both too — but the start frame is a reference there, not frame one,
    // which changes what the member gets and has to be named.
    if (mode === 'video' && !isMotionControl && hasPlainRefs && hasFrames && mixedPolicy === 'reference') {
      const label = getModel(modelId)?.displayName ?? modelId
      addToast(
        `${label} can't hold a start frame and reference images apart — everything attached is sent as a reference, so the frame guides this clip rather than opening it.`,
        'info',
      )
    }
    // 'exclusive' is the provider forbidding the combination outright (the whole
    // Seedance family documents frames and multimodal references as mutually
    // exclusive scenarios). Sending both is a 400, so the frames win — they're
    // the more specific instruction, and the frame slot is a deliberate act
    // rather than somewhere pictures land by default — and the references are
    // dropped and named, with the way to get them honoured instead.
    if (mode === 'video' && !isMotionControl && hasPlainRefs && mixedPolicy === 'exclusive'
      && inferredVideoMode !== 'reference-to-video') {
      const label = getModel(modelId)?.displayName ?? modelId
      addToast(
        `${label} takes either frames or reference images, not both. Rendering from the frames — clear the start frame to use your references instead.`,
        'info',
      )
    }
    // No reference input on this model at all, and an end frame with nowhere to
    // go on an image-to-video-only one.
    if (mode === 'video' && !isMotionControl && inferredVideoMode !== 'reference-to-video') {
      const dropped: string[] = []
      if (hasPlainRefs && mixedPolicy === 'frames-only') dropped.push('reference images')
      if (inferredVideoMode === 'image-to-video' && refsSnapshot.some((r) => r.slot === 'end')) {
        dropped.push('the end frame')
      }
      if (dropped.length > 0) {
        const label = getModel(modelId)?.displayName ?? modelId
        addToast(
          `${label} takes only a start frame here — ${dropped.join(' and ')} won't be sent with this clip.`,
          'info',
        )
      }
    }

    const imageParams = mode === 'image'
      ? { aspectRatio: state.aspectRatio as AspectRatio, resolution: state.resolution as ImageResolution }
      : undefined
    const videoParams = mode === 'video'
      ? {
          mode: inferredVideoMode,
          aspectRatio: state.aspectRatio,
          durationSeconds: isMotionControl ? motionDuration : state.durationSeconds,
          resolution: state.resolution,
          audio: isMotionControl ? false : state.audio,
          videoEndpoint: getModel(modelId)?.videoEndpoint === 'veo' ? ('veo' as const) : undefined,
        }
      : undefined
    const musicParams = mode === 'music'
      ? { instrumental: state.instrumental }
      : undefined

    // One member of the run. Everything above is snapshotted once and shared by
    // all of them; each call here is its own kie task, its own in-flight tile
    // and its own history row — exactly what pressing Generate N times has
    // always produced, minus the N presses.
    const runOne = async () => {
    const id = crypto.randomUUID()
    // Add to inFlight WITHOUT a taskId yet — covers the createTask leg.
    setInFlight((prev) => [...prev, {
      id, mode, modelId, prompt: promptText, startedAt: Date.now(),
      imageParams, videoParams, musicParams,
    }])

    // Leave the prompt + refs in place so the user can fire off the same (or a
    // tweaked) generation again immediately — gens run in parallel, each job
    // already snapshotted its own inputs above.

    try {
      let taskId: string
      let videoEndpoint: 'veo' | undefined

      if (mode === 'image') {
        const started = await startPlaygroundImageTask({
          prompt: promptText,
          modelId,
          aspectRatio: imageParams!.aspectRatio,
          resolution: imageParams!.resolution,
          referenceUrls: refsSnapshot.map((r) => r.url),
        })
        taskId = started.taskId
      } else if (mode === 'video' && isMotionControl) {
        const started = await startPlaygroundVideoTask({
          prompt: promptText,
          modelId,
          mode: 'motion-control',
          aspectRatio: videoParams!.aspectRatio,
          durationSeconds: videoParams!.durationSeconds,
          resolution: videoParams!.resolution,
          audio: false,
          motionImageUrl: refsSnapshot.find((r) => r.slot === 'motion-image')?.url,
          motionVideoUrl: refsSnapshot.find((r) => r.slot === 'motion-video')?.url,
          characterOrientation: motionOrientation,
        })
        taskId = started.taskId
        videoEndpoint = started.videoEndpoint
      } else if (mode === 'video') {
        const first = refsSnapshot.find((r) => r.slot === 'start')?.url
          ?? (inferredVideoMode === 'reference-to-video' ? undefined : refsSnapshot.find((r) => r.slot === 'ref')?.url)
        const last = refsSnapshot.find((r) => r.slot === 'end')?.url
        // In reference mode the frame slots have nowhere else to go — the model
        // either has no frame fields at all, or the mode was downgraded to this
        // one above precisely because it hasn't. Send them AS references, in
        // shot order ahead of the explicit ones, which is what every ref-capable
        // model's body builder does with a stray frame.
        const frameRefs = inferredVideoMode === 'reference-to-video'
          ? [refsSnapshot.find((r) => r.slot === 'start')?.url, last].filter((u): u is string => !!u)
          : []
        const references = [
          ...frameRefs,
          ...refsSnapshot.filter((r) => r.slot === 'ref').map((r) => r.url),
        ]
        const referenceAudioUrls = refsSnapshot.filter((r) => r.slot === 'audio').map((r) => r.url)
        const referenceVideoUrls = refsSnapshot.filter((r) => r.slot === 'video').map((r) => r.url)
        const omniCharacterBankIds = refsSnapshot
          .filter((r) => r.slot === 'omni-character' && r.bankModelId)
          .map((r) => r.bankModelId!)
        // Uploaded characters carry a pre-minted kie character id in `omniId`.
        const omniCharacterIds = refsSnapshot
          .filter((r) => r.slot === 'omni-character' && !r.bankModelId && r.omniId)
          .map((r) => r.omniId!)
        const omniAudioIds = refsSnapshot
          .filter((r) => r.slot === 'omni-voice' && r.omniId)
          .map((r) => r.omniId!)
        const clip = refsSnapshot.find((r) => r.slot === 'omni-clip')
        const started = await startPlaygroundVideoTask({
          prompt: promptText,
          modelId,
          mode: inferredVideoMode,
          aspectRatio: videoParams!.aspectRatio,
          durationSeconds: videoParams!.durationSeconds,
          resolution: videoParams!.resolution,
          audio: videoParams!.audio,
          firstFrameUrl: inferredVideoMode === 'image-to-video' || inferredVideoMode === 'frames-to-video' ? first : undefined,
          lastFrameUrl: last,
          // Reference mode carries everything. A frame mode carries the
          // references too on a 'merged' model, whose body is one flat image
          // array with no frame/reference distinction to violate; the other two
          // policies must not send both (see the toasts above) — 'exclusive'
          // because the provider rejects the pair outright, 'frames-only'
          // because there is no field to put them in.
          referenceImageUrls: inferredVideoMode === 'reference-to-video' || mixedPolicy === 'merged'
            ? (references.length > 0 ? references : undefined)
            : undefined,
          referenceAudioUrls: referenceAudioUrls.length > 0 ? referenceAudioUrls : undefined,
          referenceVideoUrls: referenceVideoUrls.length > 0 ? referenceVideoUrls : undefined,
          omniCharacterBankIds: omniCharacterBankIds.length > 0 ? omniCharacterBankIds : undefined,
          omniCharacterIds: omniCharacterIds.length > 0 ? omniCharacterIds : undefined,
          omniAudioIds: omniAudioIds.length > 0 ? omniAudioIds : undefined,
          videoClip: clip
            ? { url: clip.url, start: clip.clipStart ?? 0, ends: clip.clipEnds ?? Math.min(10, clip.durationSeconds ?? 10) }
            : undefined,
        })
        taskId = started.taskId
        videoEndpoint = started.videoEndpoint
      } else {
        const started = await startPlaygroundMusicTask({
          prompt: promptText,
          modelId,
          instrumental: musicParams!.instrumental,
        })
        taskId = started.taskId
      }

      // Patch the in-flight entry with the taskId so a refresh from this
      // point on resumes correctly. For video, also persist the endpoint
      // identifier in case the model registry changes between sessions.
      setInFlight((prev) => prev.map((g) => g.id === id
        ? {
            ...g,
            taskId,
            videoParams: g.videoParams && videoEndpoint !== undefined
              ? { ...g.videoParams, videoEndpoint }
              : g.videoParams,
          }
        : g))

      if (mode === 'image') {
        await finishPlaygroundImageTask(taskId, modelId, {
          prompt: promptText,
          aspectRatio: imageParams!.aspectRatio,
          resolution: imageParams!.resolution,
        })
        addToast('Image ready', 'success')
      } else if (mode === 'video') {
        await finishPlaygroundVideoTask(taskId, modelId, videoEndpoint, {
          prompt: promptText,
          mode: inferredVideoMode,
          aspectRatio: videoParams!.aspectRatio,
          durationSeconds: videoParams!.durationSeconds,
          resolution: videoParams!.resolution,
          audio: videoParams!.audio,
        })
        addToast('Video ready', 'success')
      } else {
        await finishPlaygroundMusicTask(taskId, modelId, {
          prompt: promptText,
          instrumental: musicParams!.instrumental,
        })
        addToast('Track ready', 'success')
      }
      // Success — the result is now a history row, so drop the in-flight tile.
      setInFlight((prev) => prev.filter((g) => g.id !== id))
    } catch (err) {
      if (isPollTimeout(err)) {
        // We stopped polling, but the kie task is very likely still rendering
        // (Seedance 2 can run 15+ min). Keep the in-flight entry persisted so
        // the resume-on-mount effect finishes the download on the next refresh.
        // Deleting it here was the "video succeeds on kie but never shows up"
        // bug — it's now evicted only once it crosses STALE_TASK_MS.
        const noun = mode === 'image' ? 'Image' : mode === 'music' ? 'Track' : 'Video'
        addToast(`${noun} is still rendering on kie — refresh in a bit and it'll appear here once it's ready.`, 'info')
      } else {
        addToast(humanizeError(err, 'Generation failed.'), 'error')
        setInFlight((prev) => prev.filter((g) => g.id !== id))
      }
    }
    }

    // Music stays one per press: Suno already returns a pair of tracks for a
    // single call, so a count chip there would be billing twice for something
    // the API hands over anyway.
    const count = mode === 'music' ? 1 : clampBatchCount(state.batchCount)
    for (let i = 0; i < count; i++) void runOne()
  }

  // Switch tabs without bleeding inputs across them: stash the current tab's
  // prompt + refs, then restore whatever the target tab had last.
  function handleModeChange(nextMode: PlaygroundMode) {
    if (nextMode === state.mode) return
    setPromptStash((prev) => ({ ...prev, [state.mode]: { prompt: state.prompt, refs: state.refs } }))
    const restored = promptStash[nextMode] ?? { prompt: '', refs: [] }
    setState((s) => ({ ...s, mode: nextMode, prompt: restored.prompt, refs: restored.refs }))
  }

  // Image → Video handoff. The loop this app is actually used for is "make a
  // still, then animate it", which otherwise meant downloading the image,
  // flipping tabs, re-uploading it as a start frame and retyping the prompt.
  // Goes through the same stash as a manual tab switch so the Image tab keeps
  // its own draft instead of bleeding its refs into Video.
  //
  // Refs carry a renderable URL, not an asset id (FrameSlot renders the value
  // straight into an <img>), so the history item's asset is inlined first —
  // same conversion the Bank's own Animate button does.
  //
  // useCallback with only stable deps, because this is the grid's prop and the
  // grid is memoized: a fresh identity here would re-render every history row
  // on every keystroke in the prompt bar. The live draft comes from the refs.
  const handleAnimateImage = useCallback(async (item: ImageHistoryItem) => {
    let url = item.imageUrl
    if (isAssetRef(url)) {
      const asset = await getAsBase64(url)
      if (!asset) {
        addToast('That image is no longer available to animate.')
        return
      }
      url = `data:${asset.mimeType};base64,${asset.base64}`
    }
    const startRef: PromptRef = { url, label: 'start', source: 'upload', slot: 'start' }
    const seedPrompt = item.prompt?.trim()

    // Read the draft through the ref, not the closure — see stateRef above.
    const draft = stateRef.current

    // Already on Video (the grid is mode-filtered, so this only happens on a
    // deep link): just swap the start frame and leave the draft alone.
    if (draft.mode === 'video') {
      setState((s) => ({ ...s, refs: [...s.refs.filter((r) => r.slot !== 'start'), startRef] }))
      return
    }

    setPromptStash((prev) => ({ ...prev, [draft.mode]: { prompt: draft.prompt, refs: draft.refs } }))
    const restored = promptStashRef.current.video ?? { prompt: '', refs: [] }
    setState((s) => ({
      ...s,
      mode: 'video',
      // The prompt that made the still is the best starting point for the
      // motion; fall back to whatever the Video tab already had.
      prompt: seedPrompt || restored.prompt,
      refs: [...restored.refs.filter((r) => r.slot !== 'start'), startRef],
    }))
  }, [addToast, setState, setPromptStash])

  // Put a past generation's prompt back in the box, replacing what's there.
  //
  // The grid is filtered to the active mode, so a card's prompt always belongs
  // to the tab it lands in and no mode switch is involved. Everything ELSE on
  // the draft is left alone — the Voice box, the references, the model — which
  // is the same contract the Scripts handoff runs on: reusing a prompt swaps
  // the words and nothing else.
  //
  // It genuinely REPLACES, with no undo of its own (`PromptPanel`'s stack only
  // tracks changes made inside the box). That's what the button says it does,
  // and it's how every other prompt handoff into this app already behaves.
  //
  // `useCallback` is not optional here: the history grid is `memo`'d against
  // hundreds of rows, and a fresh identity per render re-renders the whole list
  // on every keystroke in the prompt box. See the note on `stateRef` above.
  const handleReusePrompt = useCallback((prompt: string) => {
    const text = prompt.trim()
    if (!text) return
    setState((s) => ({ ...s, prompt: text }))
    // On a phone only one pane is on screen and it's the grid you pressed this
    // from — follow the prompt to the panel that now holds it. No toast: the
    // box visibly changes, which is better feedback than a line of copy.
    setPane('prompt')
  }, [setState])

  // Filter the history grid to the active mode. Users frequently bounce
  // between modes and want to see what they just made, not noise from the
  // other tabs.
  const filterMode: PlaygroundMode = state.mode

  // Submit button no longer disables on in-flight count — users can queue
  // unlimited parallel generations. The prop stays for any future use.
  const isGenerating = inFlight.length > 0

  // Pulse the dock dot while any image/video/music generation is in flight.
  useReportActivity('playground', isGenerating)

  return (
    <div className="relative flex h-full flex-col">
      <MobilePaneTabs
        options={[
          { value: 'prompt', label: 'Prompt', icon: Wand2 },
          { value: 'history', label: 'History', icon: Images },
        ]}
        value={pane}
        onChange={setPane}
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Left — prompt panel. */}
        <div className={paneClass(pane === 'prompt', 'md:w-1/3 md:min-w-[380px] md:shrink-0 md:border-r md:border-ink/5')}>
          <PromptPanel
            state={state}
            onChange={setState}
            onModeChange={handleModeChange}
            onSubmit={handleSubmit}
            isGenerating={isGenerating}
          />
        </div>

        {/* Right — history grid */}
        <div className={paneClass(pane === 'history', 'md:flex-1 md:overflow-hidden')}>
          <PlaygroundHistoryGrid
            inFlight={inFlight}
            filterMode={filterMode}
            onAnimateImage={handleAnimateImage}
            onReusePrompt={handleReusePrompt}
          />
        </div>
      </div>
    </div>
  )
}
