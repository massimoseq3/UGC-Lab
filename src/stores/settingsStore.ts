import { create } from 'zustand'
import { saveProfile } from '../lib/cloudSync'
import { isCloudEnabled } from '../lib/supabase'
import { useAuthStore } from './authStore'
import { useAppStore } from './appStore'
import { getModel, getDefaultModel, CHAT_MODEL_DEFAULT } from '../utils/models'

const STORAGE_KEY = 'ai-ugc-lab-settings'

function cloudActive(): boolean {
  return isCloudEnabled() && !!useAuthStore.getState().user
}

// Best-effort profile push. Awaited inline; failures toast and re-throw so
// the caller can surface them too.
async function pushProfile(): Promise<void> {
  if (!cloudActive()) return
  try {
    await saveProfile()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    try { useAppStore.getState().addToast(`Settings sync failed: ${msg}`, 'error') } catch { /* ignore */ }
    throw e
  }
}

interface SettingsState {
  kieApiKey: string
  // ScrapeCreators key, powering Outliers. Same doctrine as the kie key: the
  // member's own, browser-local, never written to Supabase.
  scrapeCreatorsKey: string
  perAppModel: Record<string, string>

  setKieApiKey: (key: string) => void
  setScrapeCreatorsKey: (key: string) => void

  getKieApiKey: () => string
  getScrapeCreatorsKey: () => string

  setAppModel: (appId: string, modelId: string) => void
  getAppModel: (appId: string) => string | undefined
}

interface PersistedShape {
  kieApiKey?: string
  scrapeCreatorsKey?: string
  perAppModel?: Record<string, string>
  // Legacy field — read once during migration, never written again.
  googleApiKey?: string
}

// Everything persisted under STORAGE_KEY. Named so the write paths below can't
// silently drop a field the way a hand-built object literal did when the
// ScrapeCreators key was added to a shape that only listed two.
type PersistedSettings = Pick<SettingsState, 'kieApiKey' | 'scrapeCreatorsKey' | 'perAppModel'>

const MIGRATIONS_KEY = 'ai-ugc-lab-settings-migrations'

// One-shot migrations applied to perAppModel. Each runs once per browser, then
// its name is recorded under MIGRATIONS_KEY so it never runs again.
const MODEL_MIGRATIONS: Array<{ name: string; apply: (m: Record<string, string>) => void }> = [
  {
    // Veo 3.1 Fast / Lite / Quality removed from the registry. getAppModel
    // already drops an id that no longer resolves, so this is belt-and-braces
    // for the picks — but Playground ALSO snapshots modelId inside its draft
    // `state` blob, which nothing validates against the registry, so a stale
    // 'veo3_fast' there would reach buildVideoInput. Repair both.
    name: '2026-07-remove-veo',
    apply: (m) => {
      const GONE = ['veo3', 'veo3_fast', 'veo3_lite']
      for (const k of Object.keys(m)) {
        if (GONE.includes(m[k])) delete m[k]
      }
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (!key || !key.endsWith(':playground:state')) continue
          const raw = localStorage.getItem(key)
          if (!raw) continue
          const parsed = JSON.parse(raw)
          if (parsed && GONE.includes(parsed.modelId)) {
            parsed.modelId = 'grok-imagine-video-1-5-preview'
            localStorage.setItem(key, JSON.stringify(parsed))
          }
        }
      } catch { /* ignore */ }
    },
  },
  {
    // Earlier builds let users persist Nano Banana 2 as the Characters image
    // model. GPT Image 2 is the registered default for character-studio; clear
    // the stale entry so the registry default kicks in.
    name: '2026-05-character-studio-default',
    apply: (m) => { delete m['character-studio:image:text-to-image'] },
  },
  {
    // Default for character-studio flipped to Nano Banana 2. Clear any
    // persisted selection so users see the new default unless they pick
    // explicitly afterwards.
    name: '2026-05-character-studio-nano-banana-default',
    apply: (m) => { delete m['character-studio:image:text-to-image'] },
  },
  {
    // Default for broll-studio image gen flipped to Nano Banana 2. Clear
    // any stale persisted selection so users see the new default unless
    // they pick explicitly afterwards.
    name: '2026-05-broll-studio-nano-banana-default',
    apply: (m) => { delete m['broll-studio:image:text-to-image'] },
  },
  {
    // B-Roll Videos dropped its mode toggle. Old per-mode keys
    // ('video-studio:video:image-to-video', etc.) collapse into a single
    // 'video-studio:video' slot. Take whichever per-mode value the user
    // had selected last (image-to-video is the most common starting point)
    // as the new flat selection.
    name: '2026-05-video-studio-flatten-modes',
    apply: (m) => {
      const modes = ['image-to-video', 'frames-to-video', 'reference-to-video', 'text-to-video']
      if (!m['video-studio:video']) {
        for (const mode of modes) {
          const old = m[`video-studio:video:${mode}`]
          if (old) {
            m['video-studio:video'] = old
            break
          }
        }
      }
      for (const mode of modes) {
        delete m[`video-studio:video:${mode}`]
      }
    },
  },
  {
    // Flux 2 Pro was removed from the image model lineup. Drop any persisted
    // selection so those slots fall back to the registry default (GPT Image 2).
    name: '2026-06-remove-flux-2-pro',
    apply: (m) => {
      for (const k of Object.keys(m)) {
        if (m[k] === 'flux-2/pro-text-to-image') delete m[k]
      }
    },
  },
  {
    // B-Roll video default flipped to Veo 3.1 Fast. Clear any persisted
    // selection so users see the new default unless they pick explicitly after.
    name: '2026-06-broll-veo-fast-default',
    apply: (m) => { delete m['broll-studio:video'] },
  },
  {
    // Image default flipped to Nano Banana 2 app-wide. Drop GPT Image 2 (the
    // previous default) from the picker-persistence layer so users land on the
    // new default unless they pick it explicitly afterwards. Playground also
    // snapshots its image model inside its draft `state` blob (not just
    // perAppModel), so repair those keys directly too.
    name: '2026-06-image-default-nano-banana',
    apply: (m) => {
      const OLD = ['gpt-image-2-text-to-image', 'gpt-image-2-image-to-image']
      for (const k of Object.keys(m)) {
        if (OLD.includes(m[k])) delete m[k]
      }
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (!key || !key.endsWith(':playground:state')) continue
          const raw = localStorage.getItem(key)
          if (!raw) continue
          const parsed = JSON.parse(raw)
          if (parsed && OLD.includes(parsed.modelId)) {
            parsed.modelId = 'nano-banana-2'
            localStorage.setItem(key, JSON.stringify(parsed))
          }
        }
      } catch { /* ignore */ }
    },
  },
  {
    // Video default flipped to Gemini Omni for both video surfaces (B-Roll was
    // Veo 3.1 Fast, Playground fell through to Seedance 2.0 by registry order).
    // Clear the persisted picks so users land on the new default unless they
    // pick explicitly afterwards, and repair Playground's draft `state` blob,
    // which snapshots modelId separately from perAppModel (see the Nano Banana
    // migration above). A user who had deliberately picked the old default is
    // indistinguishable from one who never opened the picker, so both move —
    // same trade-off the image-default migration accepted.
    name: '2026-07-video-default-gemini-omni',
    apply: (m) => {
      delete m['broll-studio:video']
      delete m['playground:video']
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (!key || !key.endsWith(':playground:state')) continue
          const raw = localStorage.getItem(key)
          if (!raw) continue
          const parsed = JSON.parse(raw)
          if (parsed && parsed.modelId === 'bytedance/seedance-2') {
            parsed.modelId = 'gemini-omni-video'
            localStorage.setItem(key, JSON.stringify(parsed))
          }
        }
      } catch { /* ignore */ }
    },
  },
]

function loadFromStorage(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedShape
      const perAppModel = { ...(parsed.perAppModel ?? {}) }

      let ranMigrations: Record<string, true> = {}
      try {
        const rawMig = localStorage.getItem(MIGRATIONS_KEY)
        if (rawMig) ranMigrations = JSON.parse(rawMig) as Record<string, true>
      } catch { /* ignore */ }

      let migrated = false
      for (const m of MODEL_MIGRATIONS) {
        if (!ranMigrations[m.name]) {
          m.apply(perAppModel)
          ranMigrations[m.name] = true
          migrated = true
        }
      }
      const next: PersistedSettings = {
        kieApiKey: parsed.kieApiKey ?? '',
        scrapeCreatorsKey: parsed.scrapeCreatorsKey ?? '',
        perAppModel,
      }
      if (migrated) {
        localStorage.setItem(MIGRATIONS_KEY, JSON.stringify(ranMigrations))
        // Writes the WHOLE snapshot. An earlier version rebuilt a literal with
        // only the two fields it knew about, which would wipe any key added to
        // the shape later the first time a migration ran.
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      }
      return next
    }
  } catch {
    // Corrupted data — start fresh
  }
  return { kieApiKey: '', scrapeCreatorsKey: '', perAppModel: {} }
}

function saveToStorage(state: PersistedSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

// The persisted slice of the live store. Every setter spreads this and
// overrides its own field, so adding a key to PersistedSettings can never
// leave one setter quietly writing a snapshot that drops it.
function snapshot(s: SettingsState): PersistedSettings {
  return {
    kieApiKey: s.kieApiKey,
    scrapeCreatorsKey: s.scrapeCreatorsKey,
    perAppModel: s.perAppModel,
  }
}

// Wipe the in-memory settings and the localStorage snapshot. Called on
// sign-out so a different user signing in on the same browser can't pick
// up the previous user's kie.ai API key or per-app model picks.
export function resetSettingsStore(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  useSettingsStore.setState({ kieApiKey: '', scrapeCreatorsKey: '', perAppModel: {} })
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadFromStorage(),

  setKieApiKey: (key) => {
    // The kie.ai key lives in localStorage only — it is never written to the
    // cloud. No pushProfile() call here (per-app model picks still sync via
    // setAppModel below).
    saveToStorage({ ...snapshot(get()), kieApiKey: key })
    set({ kieApiKey: key })
  },

  setScrapeCreatorsKey: (key) => {
    // Same rule as the kie key above: browser-local, never synced.
    saveToStorage({ ...snapshot(get()), scrapeCreatorsKey: key })
    set({ scrapeCreatorsKey: key })
  },

  getKieApiKey: () => {
    const key = get().kieApiKey
    if (!key) throw new Error('No kie.ai API key configured. Open Settings to add it.')
    return key
  },

  getScrapeCreatorsKey: () => {
    const key = get().scrapeCreatorsKey
    if (!key) throw new Error('No ScrapeCreators API key configured. Open Settings to add it.')
    return key
  },

  setAppModel: (appId, modelId) => {
    const perAppModel = { ...get().perAppModel, [appId]: modelId }
    saveToStorage({ ...snapshot(get()), perAppModel })
    set({ perAppModel })
    pushProfile().catch(() => { /* toast already raised */ })
  },

  // Drop a persisted pick that no longer resolves (e.g. a retired model) so
  // the picker falls back to its default instead of showing "Select model".
  getAppModel: (appId) => {
    const id = get().perAppModel[appId]
    return id && getModel(id) ? id : undefined
  },
}))

// The two apps that let a member choose who writes their words. The slot key
// matches what ModelSidePanel derives from `${appId}:${task}`, so the panel and
// the services agree without either knowing about the other.
export type ScriptModelApp = 'script-architect' | 'broll-studio'

export function scriptModelSlot(appId: ScriptModelApp): string {
  return `${appId}:chat`
}

// Which chat model writes this app's scripts and prompts. Falls back to the
// registry default (Gemini 3 Flash), so a member who never opens the picker
// pays exactly what they paid before it existed.
export function resolveScriptModel(appId: ScriptModelApp): string {
  return (
    useSettingsStore.getState().getAppModel(scriptModelSlot(appId)) ??
    getDefaultModel(appId, 'chat')?.id ??
    CHAT_MODEL_DEFAULT
  )
}
