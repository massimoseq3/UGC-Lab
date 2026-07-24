// kie.ai unified API client.
//
// Architecture per https://docs.kie.ai/:
//   POST https://api.kie.ai/api/v1/jobs/createTask  { model, input, callBackUrl? } -> { code, msg, data: { taskId } }
//   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...                       -> { code, msg, data: { state, resultJson, ... } }
//
// All generation tasks are async. We poll recordInfo until state in {success, fail}.

const BASE_URL = 'https://api.kie.ai/api/v1'

const DEFAULT_TIMEOUT_MS = 90_000
const MAX_RETRIES = 3
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504, 455])

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 30_000
const MAX_POLL_ATTEMPTS = 60 // 5 minutes — default for short tasks
export const IMAGE_POLL_ATTEMPTS = 120 // 10 minutes — GPT Image 2 can run long on complex prompts
export const VIDEO_POLL_ATTEMPTS = 240 // 20 minutes — Seedance 2 / Veo Quality routinely run 10–15+ min
export const MUSIC_POLL_ATTEMPTS = 120 // 10 minutes — Suno can stall on busy days

// ── Types ───────────────────────────────────────────────────────

export type TaskState = 'waiting' | 'queuing' | 'generating' | 'success' | 'fail'

export interface KieEnvelope<T> {
  code: number
  msg: string
  data: T
}

export interface CreateTaskData {
  taskId: string
}

export interface TaskRecord {
  taskId: string
  model: string
  state: TaskState
  param: string
  resultJson: string
  failCode: string
  failMsg: string
  costTime: number
  completeTime: number
  createTime: number
  updateTime: number
  progress: number
}

export interface RunTaskOptions {
  signal?: AbortSignal
  onProgress?: (progress: number, state: TaskState) => void
  pollIntervalMs?: number
  maxPollAttempts?: number
}

// ── Errors ──────────────────────────────────────────────────────

function friendlyHttpError(status: number, msg: string, endpoint?: string): string {
  // CLAUDE.md rule: surface raw kie.ai response shape on failures. We add a short
  // hint for common codes so the user can act, but the raw `msg` (kie's envelope
  // text) is always appended verbatim — never replaced.
  const tag = endpoint ? ` at ${endpoint}` : ''
  const raw = msg || 'no response body'
  if (status === 401) return `kie.ai 401 (invalid/expired API key)${tag}: ${raw}`
  if (status === 402) return `kie.ai 402 (insufficient credits)${tag}: ${raw}`
  if (status === 422) return `kie.ai 422 (validation error)${tag}: ${raw}`
  if (status === 429) return `kie.ai 429 (rate limit)${tag}: ${raw}`
  if (status === 433) return `kie.ai 433 (key usage limit exceeded)${tag}: ${raw}`
  if (status === 455) return `kie.ai 455 (maintenance)${tag}: ${raw}`
  if (status >= 500) return `kie.ai ${status} (server error)${tag}: ${raw}`
  return `kie.ai error (${status})${tag}: ${raw}`
}

// Carries the kie/HTTP status code alongside the message so poll loops can tell
// "won't fix itself by waiting" (bad key, no credits, validation) apart from
// transient blips (network, 429, 5xx maintenance) and fail fast.
class KieHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'KieHttpError'
    this.status = status
  }
}

// Codes where continuing to poll is pointless: bad/expired key, no credits,
// forbidden, validation, key-usage-cap. 429 (rate limit), 455 (maintenance) and
// 5xx stay retryable. 404 is deliberately excluded — an early poll can 404 while
// a freshly-created task is still registering server-side.
const TERMINAL_POLL_STATUS = new Set([401, 402, 403, 422, 433])

function isTerminalPollError(err: unknown): boolean {
  return err instanceof KieHttpError && TERMINAL_POLL_STATUS.has(err.status)
}

// Thrown when a poll loop exhausts its attempt budget. Distinct from a genuine
// `fail` so callers can tell "we stopped watching" (the kie task may STILL be
// rendering — resume it later) apart from "the generation actually failed"
// (drop it). The message keeps the old "...timed out after N minutes." wording
// so humanizeError's timeout rule still matches.
export class PollTimeoutError extends Error {
  readonly minutes: number
  constructor(minutes: number, label = 'Generation') {
    super(`${label} timed out after ${minutes} minute${minutes === 1 ? '' : 's'}.`)
    this.name = 'PollTimeoutError'
    this.minutes = minutes
  }
}

export function isPollTimeout(err: unknown): err is PollTimeoutError {
  return err instanceof PollTimeoutError
}

function endpointTag(method: string | undefined, url: string): string {
  let path = url
  try { path = new URL(url).pathname } catch { /* leave as-is */ }
  return `${(method ?? 'GET').toUpperCase()} ${path}`
}

function friendlyTaskError(failCode: string, failMsg: string): string {
  if (!failMsg && !failCode) return 'Generation failed (no details returned).'
  return `Generation failed${failCode ? ` (${failCode})` : ''}: ${failMsg || 'unknown error'}`
}

// ── Retry/timeout fetch ────────────────────────────────────────

function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 1000 + Math.random() * 500, 10_000)
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options
  let lastError: Error = new Error('Request failed')

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)

      if (res.ok) return res

      // Read the full response body so we can always surface *something* meaningful.
      // kie.ai usually returns JSON like { code, msg, ... }, but on misrouted requests
      // (404s, gateway errors) the body may be HTML, plain text, or empty. We try JSON
      // first for the common case, then fall back to raw text, so the user never sees
      // "kie.ai error (404):" with a blank message.
      const rawText = await res.text().catch(() => '')
      let parsed: Record<string, unknown> | null = null
      try { parsed = rawText ? JSON.parse(rawText) : null } catch { /* not JSON */ }

      const errObj = parsed && typeof parsed.error === 'object' && parsed.error !== null
        ? parsed.error as Record<string, unknown>
        : null
      const fromJson =
        (parsed?.msg as string | undefined) ??
        (parsed?.message as string | undefined) ??
        (typeof parsed?.error === 'string' ? parsed.error as string : undefined) ??
        (errObj?.message as string | undefined)

      const truncated = rawText.length > 400 ? rawText.slice(0, 400) + '…' : rawText
      const msg =
        fromJson?.trim() ||
        truncated.trim() ||
        res.statusText ||
        `${url} returned no response body`

      const tag = endpointTag(init.method, url)
      if (RETRYABLE_HTTP.has(res.status) && attempt < MAX_RETRIES) {
        if (res.status === 429) {
          const ra = res.headers.get('Retry-After')
          const waitMs = ra ? parseInt(ra, 10) * 1000 : NaN
          if (!isNaN(waitMs) && waitMs > 0 && waitMs <= 60_000) {
            lastError = new KieHttpError(res.status, friendlyHttpError(res.status, msg, tag))
            await new Promise(r => setTimeout(r, waitMs))
            continue
          }
        }
        lastError = new KieHttpError(res.status, friendlyHttpError(res.status, msg, tag))
      } else {
        throw new KieHttpError(res.status, friendlyHttpError(res.status, msg, tag))
      }
    } catch (err) {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)

      if (err instanceof DOMException && err.name === 'AbortError') {
        if (signal?.aborted) throw err
        throw new Error('Request timed out — kie.ai took too long to respond. Try again.')
      }

      if (err instanceof Error && !(err instanceof TypeError)) throw err

      if (attempt === MAX_RETRIES) {
        throw new Error('Connection failed. Check your internet connection and try again.')
      }
      lastError = err as Error
    }

    await new Promise(r => setTimeout(r, backoffMs(attempt)))
  }

  throw lastError
}

// ── Core API ────────────────────────────────────────────────────

async function authedFetch<T>(
  apiKey: string,
  path: string,
  init: RequestInit,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetchWithRetry(
    `${BASE_URL}${path}`,
    {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(init.headers ?? {}),
      },
    },
    options,
  )
  const json = (await res.json()) as KieEnvelope<T>
  if (json.code !== 200) {
    throw new KieHttpError(json.code, friendlyHttpError(json.code, json.msg, endpointTag(init.method, `${BASE_URL}${path}`)))
  }
  return json.data
}

export async function createTask(
  apiKey: string,
  model: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const data = await authedFetch<CreateTaskData>(
    apiKey,
    '/jobs/createTask',
    { method: 'POST', body: JSON.stringify({ model, input }) },
    { signal },
  )
  return data.taskId
}

export async function getTaskRecord(
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<TaskRecord> {
  return authedFetch<TaskRecord>(
    apiKey,
    `/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    { method: 'GET' },
    { signal, timeoutMs: POLL_TIMEOUT_MS },
  )
}

export async function pollTask(
  apiKey: string,
  taskId: string,
  opts: RunTaskOptions = {},
): Promise<TaskRecord> {
  const { signal, onProgress, pollIntervalMs = POLL_INTERVAL_MS, maxPollAttempts = MAX_POLL_ATTEMPTS } = opts

  for (let i = 0; i < maxPollAttempts; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    // First poll waits only 1.5s (kie usually returns 'queued' or 'running'
    // immediately, but giving it a moment avoids hammering the API for tasks
    // that haven't been registered server-side yet). Subsequent polls use the
    // full interval. Without this, fast generations (e.g. GPT Image 2 nano
    // tier finishing in ~10s) feel artificially slow by the full poll
    // interval on the very first check.
    const waitMs = i === 0 ? Math.min(1500, pollIntervalMs) : pollIntervalMs
    await new Promise(r => setTimeout(r, waitMs))

    let record: TaskRecord
    try {
      record = await getTaskRecord(apiKey, taskId, signal)
    } catch (err) {
      // Transient poll error — keep going unless caller aborted. A terminal
      // credential/credit/validation error won't resolve by waiting, so surface
      // it now instead of burning the full ~10-minute poll window.
      if (signal?.aborted) throw err
      if (isTerminalPollError(err)) throw err
      continue
    }

    onProgress?.(record.progress ?? 0, record.state)

    if (record.state === 'success') return record
    if (record.state === 'fail') {
      throw new Error(friendlyTaskError(record.failCode, record.failMsg))
    }
  }

  const minutes = Math.round((maxPollAttempts * pollIntervalMs) / 60_000)
  throw new PollTimeoutError(minutes)
}

// ── Result parsing ──────────────────────────────────────────────

export interface ParsedResult {
  resultUrls: string[]
  raw: unknown
}

export function parseResult(record: TaskRecord): ParsedResult {
  let parsed: { resultUrls?: string[] } = {}
  try {
    parsed = JSON.parse(record.resultJson || '{}')
  } catch {
    console.warn('[kie] parseResult: failed to JSON.parse resultJson', {
      resultJson: record.resultJson?.slice(0, 400),
    })
  }
  const resultUrls = parsed.resultUrls ?? []
  if (resultUrls.length === 0) {
    console.warn('[kie] parseResult: no resultUrls in', parsed)
  }
  return {
    resultUrls,
    raw: parsed,
  }
}

// Download a generated URL and return base64 + mimeType for local persistence.
export async function downloadAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download generated asset (${res.status}).`)
  const blob = await res.blob()
  const mimeType = blob.type || 'image/png'
  const buffer = await blob.arrayBuffer()
  // Avoid `String.fromCharCode(...new Uint8Array(...))` which blows the call
  // stack on large buffers — chunk it.
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 32_768
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return { base64: btoa(binary), mimeType }
}

// ── OpenAI-compatible chat completions ─────────────────────────
//
// kie.ai's chat models (Gemini 3 Flash, GPT-5.5, Claude Opus 4, etc.) are
// served at per-model endpoints that mirror the OpenAI chat completions API:
//   POST /<model-slug>/v1/chat/completions
// The endpoint is sync — no taskId polling.

export type ChatRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool'

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMessage {
  role: ChatRole
  content: ChatContentPart[] | string
}

export interface ChatCompletionsOptions {
  signal?: AbortSignal
  reasoningEffort?: 'low' | 'high'
  includeThoughts?: boolean
  timeoutMs?: number
}

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: { role: string; content: string }
    finish_reason?: string
  }>
}

export async function kieChatCompletions(
  apiKey: string,
  endpointPath: string,
  messages: ChatMessage[],
  opts: ChatCompletionsOptions = {},
): Promise<string> {
  const { signal, reasoningEffort = 'low', includeThoughts = false, timeoutMs = 120_000 } = opts

  // kie.ai's chat completions default to streaming (SSE). We request streaming
  // explicitly and accumulate deltas — this is the documented happy path.
  const res = await fetchWithRetry(
    `https://api.kie.ai${endpointPath}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        messages,
        stream: true,
        include_thoughts: includeThoughts,
        reasoning_effort: reasoningEffort,
      }),
    },
    { signal, timeoutMs },
  )

  // Read the body once as text; dispatch based on content-type / shape.
  const raw = await res.text()
  const contentType = res.headers.get('content-type') ?? ''
  const looksLikeSSE = contentType.includes('text/event-stream') || raw.startsWith('data:') || raw.includes('\ndata:')

  if (looksLikeSSE) {
    const text = parseSSEContent(raw)
    if (text.length > 0) return text
    throw new Error(
      `Chat model produced empty SSE stream. First 200 chars: ${raw.slice(0, 200)}`,
    )
  }

  // Plain JSON response
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new Error(`Chat model returned non-JSON response: ${raw.slice(0, 200)}`)
  }
  const text = (body as ChatCompletionsResponse).choices?.[0]?.message?.content
  if (typeof text === 'string' && text.length > 0) return text

  throw new Error(
    `Empty response from chat model. Response shape: ${JSON.stringify(body).slice(0, 400)}`,
  )
}

function parseSSEContent(raw: string): string {
  let content = ''
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (!line || !line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const parsed = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: string }
          message?: { content?: string }
        }>
      }
      const delta = parsed.choices?.[0]?.delta?.content
      const message = parsed.choices?.[0]?.message?.content
      if (typeof delta === 'string') content += delta
      else if (typeof message === 'string') content += message
    } catch {
      // skip non-JSON event payloads (comments, keepalives)
    }
  }
  return content
}

// ── Veo generate (custom endpoint) ──────────────────────────────
//
// Veo 3.1 family uses POST /api/v1/veo/generate (NOT /jobs/createTask).
// Returns a taskId; poll /api/v1/veo/record-info to check status.
// Different envelope, same shape philosophy as the standard recordInfo.

interface VeoCreateData {
  taskId: string
}

interface VeoRecordData {
  taskId: string
  successFlag?: number   // 0 = pending, 1 = success, 2/3 = failed (varies)
  state?: TaskState
  // Real shape (per https://docs.kie.ai/veo3-api/get-veo-3-video-details):
  // result URLs live under `response`. The other fields are kept as fallbacks
  // for older/unknown response shapes.
  response?: {
    resultUrls?: string[]
    originUrls?: string[]
    fullResultUrls?: string[]
    resolution?: string
  }
  resultUrls?: string[]
  resultJson?: string
  errorMessage?: string
  errorCode?: string
}

// Create-only leg of the Veo generation pipeline. Returns the kie taskId
// so the caller can persist it and resume polling across reload.
export async function kieVeoCreate(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const createRes = await fetchWithRetry(
    'https://api.kie.ai/api/v1/veo/generate',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    { signal },
  )
  const createJson = (await createRes.json()) as KieEnvelope<VeoCreateData>
  if (createJson.code !== 200) throw new Error(friendlyHttpError(createJson.code, createJson.msg, 'POST /api/v1/veo/generate'))
  return createJson.data.taskId
}

// Poll-only leg. Polls an existing Veo taskId until success / fail and
// returns the result URLs.
export async function kieVeoPoll(
  apiKey: string,
  taskId: string,
  opts: RunTaskOptions = {},
): Promise<string[]> {
  const { signal, pollIntervalMs = POLL_INTERVAL_MS, maxPollAttempts = VIDEO_POLL_ATTEMPTS, onProgress } = opts

  for (let i = 0; i < maxPollAttempts; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await new Promise((r) => setTimeout(r, pollIntervalMs))

    let record: VeoRecordData
    try {
      const res = await fetchWithRetry(
        `https://api.kie.ai/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        { signal, timeoutMs: POLL_TIMEOUT_MS },
      )
      const env = (await res.json()) as KieEnvelope<VeoRecordData>
      if (env.code !== 200) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        if (TERMINAL_POLL_STATUS.has(env.code)) {
          throw new KieHttpError(env.code, friendlyHttpError(env.code, env.msg, 'GET /veo/record-info'))
        }
        continue
      }
      record = env.data
    } catch (err) {
      if (signal?.aborted) throw err
      if (isTerminalPollError(err)) throw err
      continue
    }

    onProgress?.(0, record.state ?? 'generating')

    // Veo's state semantics: successFlag 1 = done; result URLs live under
    // `response.resultUrls` per the real API shape. We fall back through
    // older shapes (top-level resultUrls, stringified resultJson) just in
    // case kie ever changes the envelope.
    if (record.successFlag === 1 || record.state === 'success') {
      const fromResponse = record.response?.resultUrls
      const fromFullResponse = record.response?.fullResultUrls
      const fromOrigin = record.response?.originUrls
      const fromTop = record.resultUrls
      const fromJson = record.resultJson
        ? (JSON.parse(record.resultJson) as { resultUrls?: string[] }).resultUrls
        : undefined
      const urls = fromResponse ?? fromFullResponse ?? fromOrigin ?? fromTop ?? fromJson ?? []
      if (urls.length === 0) {
        console.warn('[kie] kieVeoPoll: success state but no resultUrls in', record)
        throw new Error('Veo returned no result URLs.')
      }
      return urls
    }
    if (record.errorMessage || record.state === 'fail') {
      throw new Error(friendlyTaskError(record.errorCode ?? '', record.errorMessage ?? 'Veo generation failed.'))
    }
  }

  const minutes = Math.round((maxPollAttempts * pollIntervalMs) / 60_000)
  throw new PollTimeoutError(minutes, 'Veo generation')
}

// ── Suno music generation (custom endpoint) ────────────────────
//
// Suno uses its own endpoint pair (NOT /jobs/createTask):
//   POST /api/v1/generate                              -> { data: { taskId } }
//   GET  /api/v1/generate/record-info?taskId=...       -> { data: { status, response, ... } }
// Status values are Suno-specific: PENDING, TEXT_SUCCESS, FIRST_SUCCESS,
// SUCCESS, plus error states. Result audio URLs live under response.sunoData[].

export type SunoStatus =
  | 'PENDING' | 'TEXT_SUCCESS' | 'FIRST_SUCCESS' | 'SUCCESS'
  | 'CREATE_TASK_FAILED' | 'GENERATE_AUDIO_FAILED'
  | 'CALLBACK_EXCEPTION' | 'SENSITIVE_WORD_ERROR'

export interface SunoTrack {
  id: string
  audioUrl: string
  streamAudioUrl?: string
  imageUrl?: string
  title?: string
  tags?: string
  duration?: number
  createTime?: string
}

interface SunoRecordData {
  taskId: string
  status: SunoStatus
  type?: string
  operationType?: string
  errorCode?: number
  errorMessage?: string
  response?: {
    sunoData?: SunoTrack[]
  }
}

const SUNO_TERMINAL_FAILURE: SunoStatus[] = [
  'CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED',
  'CALLBACK_EXCEPTION', 'SENSITIVE_WORD_ERROR',
]

export async function kieMusicGenerate(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetchWithRetry(
    'https://api.kie.ai/api/v1/generate',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    { signal },
  )
  const json = (await res.json()) as KieEnvelope<{ taskId: string }>
  if (json.code !== 200) throw new Error(friendlyHttpError(json.code, json.msg, 'POST /api/v1/generate'))
  return json.data.taskId
}

export async function kieMusicPoll(
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<SunoRecordData> {
  const res = await fetchWithRetry(
    `https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    { signal, timeoutMs: POLL_TIMEOUT_MS },
  )
  const env = (await res.json()) as KieEnvelope<SunoRecordData>
  if (env.code !== 200) throw new Error(friendlyHttpError(env.code, env.msg, 'GET /api/v1/generate/record-info'))
  return env.data
}

// Poll an existing Suno taskId until SUCCESS (the final terminal success
// state). FIRST_SUCCESS and TEXT_SUCCESS are intermediate — they mean Suno
// produced the first track / lyric pass but the full set isn't done. We
// wait for SUCCESS so callers get the complete sunoData[] (typically 2 tracks).
export async function pollMusicTask(
  apiKey: string,
  taskId: string,
  opts: RunTaskOptions = {},
): Promise<SunoRecordData> {
  const { signal, pollIntervalMs = POLL_INTERVAL_MS, maxPollAttempts = MUSIC_POLL_ATTEMPTS, onProgress } = opts

  for (let i = 0; i < maxPollAttempts; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await new Promise((r) => setTimeout(r, pollIntervalMs))

    let record: SunoRecordData
    try {
      record = await kieMusicPoll(apiKey, taskId, signal)
    } catch (err) {
      if (signal?.aborted) throw err
      if (isTerminalPollError(err)) throw err
      continue
    }

    onProgress?.(0, record.status === 'SUCCESS' ? 'success' : 'generating')

    if (record.status === 'SUCCESS') {
      if (!record.response?.sunoData?.length) {
        throw new Error('Suno returned SUCCESS but no tracks.')
      }
      return record
    }
    if (SUNO_TERMINAL_FAILURE.includes(record.status)) {
      throw new Error(friendlyTaskError(String(record.errorCode ?? ''), record.errorMessage ?? `Suno ${record.status}`))
    }
  }

  const minutes = Math.round((maxPollAttempts * pollIntervalMs) / 60_000)
  throw new PollTimeoutError(minutes, 'Music generation')
}

// ── Gemini Omni create endpoints (synchronous) ─────────────────
//
// The Omni ecosystem has two non-task endpoints that mint persistent ids,
// returned immediately (no polling):
//   POST /omni/audio/create     -> { kieAudioId }   designed voice
//   POST /omni/character/create -> { characterId }  reusable character
// The ids are scoped to the member's kie.ai account and are later passed to
// gemini-omni-video createTask bodies as audio_ids / character_ids.
// kie's docs show success as code 0 in one example and 200 in another, so
// accept both.

export interface OmniAudioCreateInput {
  // Preset base voice id (see OMNI_BASE_VOICES in the Playground app).
  audioId: string
  name: string
  voiceDescription?: string
  exampleDialogue?: string
}

export interface OmniCharacterCreateInput {
  // Public URL (host data URIs via ensureHostedUrl first). Exactly 1 image.
  imageUrl: string
  descriptions: string
  characterName?: string
  audioIds?: string[]
}

async function omniFetch<T>(apiKey: string, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetchWithRetry(
    `${BASE_URL}${path}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    {},
  )
  const json = (await res.json()) as KieEnvelope<T>
  if (json.code !== 200 && json.code !== 0) {
    throw new KieHttpError(json.code, friendlyHttpError(json.code, json.msg, `POST ${path}`))
  }
  return json.data
}

export async function kieOmniAudioCreate(
  apiKey: string,
  input: OmniAudioCreateInput,
): Promise<{ kieAudioId: string; name?: string }> {
  return omniFetch(apiKey, '/omni/audio/create', {
    audio_id: input.audioId,
    name: input.name,
    ...(input.voiceDescription ? { voice_description: input.voiceDescription } : {}),
    ...(input.exampleDialogue ? { example_dialogue: input.exampleDialogue } : {}),
  })
}

export async function kieOmniCharacterCreate(
  apiKey: string,
  input: OmniCharacterCreateInput,
): Promise<{ characterId: string; characterName?: string; imageUrl?: string }> {
  return omniFetch(apiKey, '/omni/character/create', {
    image_urls: [input.imageUrl],
    descriptions: input.descriptions,
    ...(input.characterName ? { character_name: input.characterName } : {}),
    ...(input.audioIds?.length ? { audio_ids: input.audioIds } : {}),
  })
}

// ── File upload (kie.ai-hosted, 3 day retention) ───────────────
//
// Image and video models on kie.ai expect publicly accessible URLs in their
// reference-image fields (input_urls, first_frame_url, etc.). This helper
// uploads a base64 / data URI to kie's hosted storage and returns the public
// downloadUrl. Note: uploaded files are deleted after 3 days, so always
// download generated outputs and save them as local assets.

export interface UploadedFile {
  fileName: string
  filePath: string
  downloadUrl: string
  fileSize: number
  mimeType: string
}

export async function kieUploadBase64(
  apiKey: string,
  base64Data: string,
  uploadPath: string = 'ugc-lab',
  fileName?: string,
): Promise<UploadedFile> {
  const res = await fetchWithRetry(
    'https://kieai.redpandaai.co/api/file-base64-upload',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ base64Data, uploadPath, fileName }),
    },
    {},
  )
  const json = (await res.json()) as KieEnvelope<UploadedFile>
  if (json.code !== 200) throw new Error(friendlyHttpError(json.code, json.msg, 'POST /api/file-base64-upload'))
  return json.data
}

// Uploads of identical bytes, memoised for the tab's lifetime. The same
// character / product / keyframe image is attached to many generations — a
// Line-by-Line "Generate all" over 5 scenes × 4 cards used to upload the same
// two references 20 times each, and a Continuous run re-uploaded every keyframe
// for the chain and again for each clip. The value is the in-flight PROMISE, so
// a parallel batch that all misses at once still performs one upload.
//
// Entries expire well inside kie's ~3-day file lifetime, and the map is capped
// so a long session can't grow it without bound.
const HOSTED_TTL_MS = 6 * 60 * 60 * 1000
const HOSTED_CACHE_MAX = 64
const hostedUrlCache = new Map<string, { url: Promise<string>; at: number }>()

async function hashSource(source: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    // No SubtleCrypto (non-secure context) — upload uncached rather than fail.
    return null
  }
}

// Convert any image source (data URI, http(s) URL) to a kie-hosted public URL.
// Pure http(s) URLs pass through; data URIs get uploaded.
export async function ensureHostedUrl(apiKey: string, source: string): Promise<string> {
  if (source.startsWith('http://') || source.startsWith('https://')) return source
  if (source.startsWith('data:')) {
    const key = await hashSource(source)
    if (!key) return (await kieUploadBase64(apiKey, source)).downloadUrl

    const hit = hostedUrlCache.get(key)
    if (hit && Date.now() - hit.at < HOSTED_TTL_MS) return hit.url

    const pending = kieUploadBase64(apiKey, source).then((u) => u.downloadUrl)
    // A failed upload must not be cached — drop it so the next attempt retries.
    pending.catch(() => {
      if (hostedUrlCache.get(key)?.url === pending) hostedUrlCache.delete(key)
    })
    if (hostedUrlCache.size >= HOSTED_CACHE_MAX) {
      let oldestKey: string | undefined
      let oldestAt = Infinity
      for (const [k, v] of hostedUrlCache) {
        if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k }
      }
      if (oldestKey) hostedUrlCache.delete(oldestKey)
    }
    hostedUrlCache.set(key, { url: pending, at: Date.now() })
    return pending
  }
  throw new Error(`Cannot host image source — unsupported format: ${source.slice(0, 64)}`)
}

// ── File helpers ────────────────────────────────────────────────

export function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('Failed to read file as data URI.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('File read error.'))
    reader.readAsDataURL(file)
  })
}

// ── Connection test ─────────────────────────────────────────────
//
// Hits a lightweight account endpoint to verify the API key is valid.
// Used by the SettingsModal "Test connection" button.

export async function kieTestConnection(apiKey: string): Promise<{ ok: true; credits: number } | { ok: false; error: string }> {
  try {
    const credits = await authedFetch<number>(
      apiKey,
      '/chat/credit',
      { method: 'GET' },
      { timeoutMs: 10_000 },
    )
    return { ok: true, credits }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
