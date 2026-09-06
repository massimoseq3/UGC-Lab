// kie.ai unified API client.
//
// Architecture per https://docs.kie.ai/:
//   POST https://api.kie.ai/api/v1/jobs/createTask  { model, input, callBackUrl? } -> { code, msg, data: { taskId } }
//   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...                       -> { code, msg, data: { state, resultJson, ... } }
//
// All generation tasks are async. We poll recordInfo until state in {success, fail}.
//
// Every call that CREATES a generation goes through `submitToKie` — kie
// rate-limits new generations per account, and the batch surfaces here fire a
// whole storyboard at once. See utils/kieSubmitGate.ts.

import { submitToKie, noteRateLimited } from './kieSubmitGate'

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
export const CHAT_POLL_ATTEMPTS = 120 // 10 minutes — a video read at high reasoning effort runs well past the 5-minute default

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
// (drop it). The message keeps the "...timed out after N minutes." wording so
// humanizeError's timeout rules still match.
//
// `unreachable` says the loop was BLIND when it gave up — the polls themselves
// were failing, so this is the member's connection rather than a slow model.
// Both cases used to arrive as the same sentence, which told a member with dead
// Wi-Fi that "the model is likely busy".
export class PollTimeoutError extends Error {
  readonly minutes: number
  readonly unreachable: boolean
  constructor(minutes: number, label = 'Generation', unreachable = false) {
    const elapsed = `${minutes} minute${minutes === 1 ? '' : 's'}`
    super(
      unreachable
        ? `${label} timed out after ${elapsed}. The connection to kie.ai kept failing.`
        : `${label} timed out after ${elapsed}.`,
    )
    this.name = 'PollTimeoutError'
    this.minutes = minutes
    this.unreachable = unreachable
  }
}

// How many consecutive failed polls at the tail of a loop count as "we never
// got a healthy read before giving up". Three cycles is long enough that one
// blip can't trip it, short enough that a connection lost late in a long render
// is still reported as a connection problem.
const UNREACHABLE_STREAK = 3

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

// kie sends Retry-After in seconds. Anything absent, unparseable or beyond a
// minute falls back to null, so the caller uses its own backoff rather than
// sleeping on a header it can't trust.
function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = parseInt(header, 10)
  if (isNaN(seconds) || seconds <= 0) return null
  const ms = seconds * 1000
  return ms <= 60_000 ? ms : null
}

// fetch() settles as soon as the response HEADERS land, so the timeout below is
// disarmed while the body is still in flight — and a chat call asks for
// `stream: true`, which guarantees headers arrive early. A gateway that answered
// and then stalled mid-body left the body read pending FOREVER: the surface sat
// on "generating" with no error and no cancel, and only a page reload cleared
// it. That is one bug reachable from every transport in this file, so it is
// fixed here rather than at nine call sites.
//
// The body readers are re-armed with a fresh budget and abort the request when
// they blow it, so a stalled read fails loudly instead of hanging. Timers are
// created lazily per read, so a response whose body is never read costs nothing.
function armBodyTimeout(res: Response, controller: AbortController, timeoutMs: number): Response {
  const guard = <T>(read: () => Promise<T>) => async (): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(new Error('Request timed out. kie.ai started responding but never finished. Try again.'))
          }, timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  // Own properties shadowing Response.prototype — every caller here reads the
  // body through exactly these three, so guarding them covers the file.
  Object.defineProperties(res, {
    json: { value: guard(() => Response.prototype.json.call(res)) },
    text: { value: guard(() => Response.prototype.text.call(res)) },
    blob: { value: guard(() => Response.prototype.blob.call(res)) },
  })
  return res
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
      const res = armBodyTimeout(
        await fetch(url, { ...init, signal: controller.signal }),
        controller,
        timeoutMs,
      )
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
      // A 429 is the account's rate limit, not this request's problem — stand
      // the whole submit queue down so the rest of a batch backs off together
      // instead of each card walking into the same wall in turn.
      const retryAfterMs = res.status === 429 ? parseRetryAfterMs(res.headers.get('Retry-After')) : null
      if (res.status === 429) noteRateLimited(retryAfterMs ?? undefined)
      if (RETRYABLE_HTTP.has(res.status) && attempt < MAX_RETRIES) {
        if (retryAfterMs !== null) {
          lastError = new KieHttpError(res.status, friendlyHttpError(res.status, msg, tag))
          await new Promise(r => setTimeout(r, retryAfterMs))
          continue
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
        throw new Error('Request timed out. kie.ai took too long to respond. Try again.')
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
  const data = await submitToKie(
    () =>
      authedFetch<CreateTaskData>(
        apiKey,
        '/jobs/createTask',
        { method: 'POST', body: JSON.stringify({ model, input }) },
        { signal },
      ),
    signal,
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
  let blindStreak = 0

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
      blindStreak++
      continue
    }
    blindStreak = 0

    onProgress?.(record.progress ?? 0, record.state)

    if (record.state === 'success') return record
    if (record.state === 'fail') {
      throw new Error(friendlyTaskError(record.failCode, record.failMsg))
    }
  }

  const minutes = Math.round((maxPollAttempts * pollIntervalMs) / 60_000)
  throw new PollTimeoutError(minutes, 'Generation', blindStreak >= UNREACHABLE_STREAK)
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

// The text a CHAT model produced, pulled out of a finished task record.
//
// A chat call can also be run through the jobs API (createTask → recordInfo)
// rather than the streaming transport, which is the only way one survives a
// page reload: the taskId is persisted, so the poll can be re-attached. What
// comes back is loose — kie sometimes hands over `resultJson` as a JSON string
// holding the chat envelope, sometimes as a string holding the raw model text,
// and the envelope itself has turned up in several shapes — so every shape
// seen in the wild is tried before giving up. Returns null when none match, and
// the caller reports the raw record (that's the only way a new shape gets
// found).
//
// Shared by the Ad Analyzer's video read and B-Roll's storyboard call. Keep it
// that way: a shape learned by one is a shape the other needs.
export function extractChatTaskText(record: TaskRecord): string | null {
  let envelope: unknown
  try {
    envelope = JSON.parse(record.resultJson || '""')
  } catch {
    envelope = record.resultJson
  }

  if (typeof envelope === 'string') return envelope || null
  if (!envelope || typeof envelope !== 'object') return null
  const obj = envelope as Record<string, unknown>

  // OpenAI-shape
  const choices = obj.choices
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === 'object') {
    const first = choices[0] as Record<string, unknown>
    const msg = first.message as Record<string, unknown> | undefined
    if (msg && typeof msg.content === 'string') return msg.content
    if (typeof first.text === 'string') return first.text
  }

  // Flatter shapes kie sometimes returns
  if (typeof obj.content === 'string') return obj.content
  if (typeof obj.response === 'string') return obj.response
  if (typeof obj.output === 'string') return obj.output
  if (typeof obj.text === 'string') return obj.text

  return null
}

/**
 * Did a CHAT run through the JOBS transport stop because it ran out of output
 * tokens? The streaming transport has read the stop reason since it shipped
 * (`hitTokenLimit` → `TruncatedResponseError`); this one never did, and the
 * difference mattered because the jobs route is the one the longest output in
 * the app takes — B-Roll's storyboard runs here precisely so it survives a
 * reload. A cut-off answer therefore arrived looking clean, and the tolerant
 * tag readers downstream rendered it as a SHORT storyboard with no error
 * anywhere: half a script's worth of scenes, and paid image and video
 * generations fired against a script that never got written.
 *
 * `resultJson` carries the provider's own envelope, so the same three shapes
 * the streaming side knows are all that's needed — they're checked together
 * because the record doesn't say which transport produced it, and the keys
 * they look at don't overlap. A `resultJson` holding raw model text rather
 * than an envelope says nothing either way, and answers false.
 */
export function chatTaskHitTokenLimit(record: TaskRecord): boolean {
  let envelope: unknown
  try {
    envelope = JSON.parse(record.resultJson || '""')
  } catch {
    return false
  }
  if (!envelope || typeof envelope !== 'object') return false
  return (
    hitTokenLimit(envelope, 'openai-chat') ||
    hitTokenLimit(envelope, 'claude-messages') ||
    hitTokenLimit(envelope, 'openai-responses')
  )
}

// Generous, because a 30s video is tens of MB on a slow line — but NOT
// unbounded, which is what this was. This runs at the TAIL of a generation kie
// has already finished and billed for, so a stalled CDN read meant the result
// never landed: the tile sat on "generating" with no error and no way back
// except a reload. The whole point of the download is that kie's URLs expire in
// 3 days, so failing loudly here is what lets the caller retry.
//
// Raised from 3 to 8 minutes in August 2026. The clips that trip it are the
// biggest files the app pulls — Seedance 2.5 at 720p with audio, the one model
// that reaches 30s — and members were hitting it on a generation kie had
// already finished and charged for. This budget is a hang-breaker, not a
// speed limit for a domestic line: the cost of setting it too high is a tile
// that spins a few minutes longer, and the cost of setting it too low is a
// paid-for clip thrown away.
const ASSET_DOWNLOAD_TIMEOUT_MS = 480_000

// Fetch a finished result off kie's CDN on a deadline.
//
// This is the tail of a generation kie has ALREADY finished and billed for, and
// it is reached by a bare `fetch` from several services. A bare fetch here is
// the same hang `armBodyTimeout` exists to stop, one step further down: fetch()
// settles at the headers, so a CDN that answers and then stalls mid-body leaves
// the read pending forever — the tile sits on "generating" with no error, no
// cancel and no way out but a reload, and the download is exactly what can't be
// skipped, since kie's URLs expire in 3 days.
//
// One controller covers the request AND the body read (aborting it tears down
// the response stream), and the returned Response has its readers re-armed with
// a fresh budget, so `.blob()`/`.text()` are bounded too. Callers keep their own
// status checks and error wording.
export async function fetchGeneratedAsset(
  url: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Response> {
  const { signal, timeoutMs = ASSET_DOWNLOAD_TIMEOUT_MS } = opts
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const res = await fetch(url, { signal: controller.signal })
    // Deliberately leaves `onAbort` attached: the body is still unread at this
    // point, so a caller that cancels afterwards should still tear the download
    // down. It is a `once` listener on a signal the caller owns, so it costs one
    // closure and cannot fire twice.
    return armBodyTimeout(res, controller, timeoutMs)
  } catch (e) {
    signal?.removeEventListener('abort', onAbort)
    if (e instanceof DOMException && e.name === 'AbortError') {
      // The caller's own cancel is not a failure to report as one.
      if (signal?.aborted) throw e
      throw new Error('Timed out downloading the finished result. Try again.')
    }
    throw e
  } finally {
    // Headers landed (or we failed) — the body read carries its own fresh
    // budget via armBodyTimeout, so this deadline has done its job.
    clearTimeout(timer)
  }
}

// ── Chat completions (three transports) ────────────────────────
//
// kie.ai serves chat models at three different endpoint families, each with
// its own request and response shape. All three are sync — no taskId polling.
//
//   'openai-chat'      POST /<model-slug>/v1/chat/completions   (Gemini family)
//                      Model is in the URL. { messages } in, choices[].message
//                      / SSE choices[].delta out.
//   'claude-messages'  POST /claude/v1/messages                 (Claude family)
//                      Model is in the body. Same messages array, but the
//                      system prompt is hoisted to a top-level `system` field
//                      (Anthropic rejects role:'system' inside messages), and
//                      the answer comes back as content[] blocks.
//   'openai-responses' POST /codex/v1/responses, /grok/v1/responses
//                      Model is in the body. `input` instead of `messages`,
//                      part types are input_text/input_image, and the answer is
//                      output[].content[].output_text.
//
// The two non-OpenAI transports are called with stream:false: kie's gateway
// buffers SSE rather than forwarding it (see LONG_CHAT_TIMEOUT_MS), so
// streaming buys nothing here and a single JSON parse is far easier to debug.
// They still fall through to an SSE reader if a gateway streams anyway.

export type ChatRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool'

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMessage {
  role: ChatRole
  content: ChatContentPart[] | string
}

// The ceiling for chat calls that write something long: a storyboard, a batch
// of takes, a whole-video read. kie's gateway usually BUFFERS the SSE stream
// rather than streaming it, so a big call blows through the 120s default while
// kie finishes the job anyway and bills for it.
//
// Applied TWICE per call — once to time-to-headers and again to the body read
// (see armBodyTimeout) — because "kie buffers" is a habit, not a guarantee:
// when headers did arrive early the ceiling used to be silently void, and a
// stall past that point hung the call with nothing to cancel it. The worst case
// is now two ceilings rather than one; that is the deliberate trade for never
// hanging forever. Consuming the stream incrementally, with a per-chunk idle
// timer instead of a total one, is still the real fix.
export const LONG_CHAT_TIMEOUT_MS = 300_000

// The three rungs the OpenAI-compatible layer accepts. 'medium' sat unused
// until the Ad Analyzer asked for it. Note the rungs don't survive every
// transport intact: claude-messages has only a thinking on/off flag, so
// anything above 'low' turns thinking on there.
export type ReasoningEffort = 'low' | 'medium' | 'high'

export interface ChatCompletionsOptions {
  signal?: AbortSignal
  reasoningEffort?: ReasoningEffort
  includeThoughts?: boolean
  timeoutMs?: number
}

interface ChatCompletionsResponse {
  choices?: Array<{
    message?: { role: string; content: string }
    finish_reason?: string
  }>
}

// The model stopped because it ran out of output tokens, not because it had
// finished. Thrown rather than returned: a truncated answer is silently
// SALVAGEABLE downstream — B-Roll's xmlBlocks parser is deliberately tolerant
// of a missing closing tag, so a cut-off storyboard renders as a short one with
// no error, and the member fires paid image/video gens against scenes the
// script never got. Every caller already has a catch, so throwing makes the
// failure honest app-wide with no per-caller plumbing.
//
// The partial text rides along rather than being discarded, so a caller that
// wants to salvage it can `catch (e) { if (e instanceof TruncatedResponseError) … }`
// without changing kieChatCompletions' signature. Nothing does that today.
export class TruncatedResponseError extends Error {
  readonly partial: string
  constructor(partial: string) {
    super(
      'The model hit its output token limit and stopped mid-answer, so the result is incomplete.',
    )
    this.name = 'TruncatedResponseError'
    this.partial = partial
  }
}

// Did this response body (or streamed event) report a max-tokens stop? Each
// transport spells it differently, and the streamed and buffered shapes differ
// again — claude puts `stop_reason` at the top level of a buffered message but
// inside `delta` on its terminal `message_delta` event, and the Responses API
// nests the whole object under `response` while streaming.
function hitTokenLimit(body: unknown, transport: ChatCallTarget['transport'] = 'openai-chat'): boolean {
  if (!body || typeof body !== 'object') return false
  const b = body as {
    choices?: Array<{ finish_reason?: string } | null>
    stop_reason?: string
    delta?: { stop_reason?: string } | string
    incomplete_details?: { reason?: string }
    response?: unknown
  }

  if (transport === 'claude-messages') {
    if (b.stop_reason === 'max_tokens') return true
    return typeof b.delta === 'object' && b.delta?.stop_reason === 'max_tokens'
  }
  if (transport === 'openai-responses') {
    const r = (b.response ?? b) as { incomplete_details?: { reason?: string } }
    return r?.incomplete_details?.reason === 'max_output_tokens'
  }
  return b.choices?.some((c) => c?.finish_reason === 'length') ?? false
}

// What a chat model needs to be reached. Mirrors `ChatTarget` in models.ts —
// duplicated as a structural type rather than imported so this client stays
// dependency-free, which is the property that keeps it easy to test in isolation.
export interface ChatCallTarget {
  endpoint: string
  transport?: 'openai-chat' | 'claude-messages' | 'openai-responses'
  slug?: string
}

// Anthropic caps output explicitly and defaults low. Our longest chat outputs
// are whole storyboards, so ask for plenty of room.
const CLAUDE_MAX_TOKENS = 16_384

// kie answers the CHAT routes with its own `{ code, msg }` envelope inside an
// HTTP 200 — verified live: an unauthenticated POST to a chat endpoint comes
// back `HTTP/2 200`, `content-type: application/json`, body
// `{"code":401,"msg":"Unauthorized – Authentication failed…"}`. `authedFetch`
// reads that envelope on every jobs-API call; this transport never did.
//
// So a bad key, an empty balance, a rate limit, a maintenance window and a 5xx
// all arrived below as a body with no `choices`, fell through to the "Empty
// response from chat model" throw, and reached the member as "The model
// returned an empty result. Try again, or simplify your prompt." — the one
// sentence none of them means, on all ~20 chat call sites in the app. Reported
// from the Ad Analyzer, where it also happens to be the most expensive place to
// send someone back round the loop.
//
// Also reads the OpenAI-style `{ error: { message, code } }` a gateway emits
// for a model-side rejection, so the vendor's own wording reaches
// `humanizeError`'s rule table instead of being thrown away.
//
// Returns null for a normal completion: no chat response shape carries a
// top-level `code` or `error` — openai-chat keys its payload under `choices`,
// claude-messages under `content`, openai-responses under `output`.
function chatEnvelopeError(body: unknown, endpoint: string): Error | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { code?: unknown; msg?: unknown; message?: unknown; error?: unknown }
  const tag = `POST ${endpoint}`

  if (typeof b.code === 'number' && b.code !== 200) {
    const msg =
      (typeof b.msg === 'string' && b.msg) || (typeof b.message === 'string' && b.message) || ''
    return new KieHttpError(b.code, friendlyHttpError(b.code, msg, tag))
  }

  const err = b.error
  if (typeof err === 'string' && err.trim()) return new Error(`kie.ai error at ${tag}: ${err}`)
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown; status?: unknown; type?: unknown }
    // A vendor's `code` is a number as often as a slug ('insufficient_quota'),
    // and the slug is exactly the wording the rule table matches on — so a
    // numeric one becomes the status and a string one rides in the message.
    const status =
      typeof e.code === 'number' ? e.code : typeof e.status === 'number' ? e.status : undefined
    const parts = [
      typeof e.message === 'string' ? e.message : '',
      typeof e.code === 'string' ? e.code : '',
      typeof e.type === 'string' ? e.type : '',
    ].filter(Boolean)
    const msg = parts.join(' · ') || JSON.stringify(err).slice(0, 300)
    return status === undefined
      ? new Error(`kie.ai error at ${tag}: ${msg}`)
      : new KieHttpError(status, friendlyHttpError(status, msg, tag))
  }
  return null
}

// A stream that produced no content, explained. The reason is usually IN the
// body: kie can end an SSE response with an error event, and when it rejects
// the request outright it answers with the envelope above — sometimes still
// under an event-stream content type, which is why the whole body is tried as
// JSON here as well as event by event.
function emptyStreamError(raw: string, endpoint: string): Error {
  const payloads: unknown[] = []
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try { payloads.push(JSON.parse(data)) } catch { /* keepalive or comment */ }
  }
  try { payloads.push(JSON.parse(raw)) } catch { /* not a bare JSON body */ }

  for (const payload of payloads) {
    const err = chatEnvelopeError(payload, endpoint)
    if (err) return err
  }
  return new Error(`Chat model produced empty SSE stream. First 200 chars: ${raw.slice(0, 200)}`)
}

export async function kieChatCompletions(
  apiKey: string,
  target: ChatCallTarget,
  messages: ChatMessage[],
  opts: ChatCompletionsOptions = {},
): Promise<string> {
  const { signal, reasoningEffort = 'low', includeThoughts = false, timeoutMs = 120_000 } = opts
  const transport = target.transport ?? 'openai-chat'

  const body =
    transport === 'claude-messages'
      ? claudeBody(target.slug, messages, reasoningEffort)
      : transport === 'openai-responses'
        ? responsesBody(target.slug, messages, reasoningEffort)
        : {
            messages,
            stream: true,
            include_thoughts: includeThoughts,
            reasoning_effort: reasoningEffort,
          }

  const res = await fetchWithRetry(
    `https://api.kie.ai${target.endpoint}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    },
    { signal, timeoutMs },
  )

  // Read the body once as text; dispatch based on content-type / shape.
  // Bounded by armBodyTimeout in fetchWithRetry — see the note there.
  const raw = await res.text()
  const contentType = res.headers.get('content-type') ?? ''
  const looksLikeSSE = contentType.includes('text/event-stream') || raw.startsWith('data:') || raw.includes('\ndata:')

  if (looksLikeSSE) {
    const { content, truncated } = parseSSEContent(raw, transport)
    // Ahead of the empty check: a run that hit the ceiling before emitting any
    // text is still a token-limit failure, and saying so beats "empty stream".
    if (truncated) throw new TruncatedResponseError(content)
    if (content.length > 0) return content
    throw emptyStreamError(raw, target.endpoint)
  }

  // Plain JSON response
  let body_: unknown
  try {
    body_ = JSON.parse(raw)
  } catch {
    throw new Error(`Chat model returned non-JSON response: ${raw.slice(0, 200)}`)
  }

  // kie's own envelope, inside an HTTP 200 — see chatEnvelopeError. Checked
  // before the content extraction below, which would otherwise read an error
  // body as an empty answer.
  const envelopeError = chatEnvelopeError(body_, target.endpoint)
  if (envelopeError) throw envelopeError

  const text =
    transport === 'claude-messages'
      ? parseClaudeContent(body_)
      : transport === 'openai-responses'
        ? parseResponsesContent(body_)
        : (body_ as ChatCompletionsResponse).choices?.[0]?.message?.content

  if (hitTokenLimit(body_, transport)) {
    throw new TruncatedResponseError(typeof text === 'string' ? text : '')
  }

  if (typeof text === 'string' && text.length > 0) return text

  throw new Error(
    `Empty response from chat model. Response shape: ${JSON.stringify(body_).slice(0, 400)}`,
  )
}

// ── claude-messages ────────────────────────────────────────────

// Anthropic takes no role:'system' message — the system prompt is a top-level
// field. Every caller in this app opens with one, so hoist it rather than
// letting the API 400 on a shape our own services build.
function claudeBody(slug: string | undefined, messages: ChatMessage[], effort: ReasoningEffort) {
  const system = messages
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => (typeof m.content === 'string' ? m.content : textOf(m.content)))
    .join('\n\n')
  const rest = messages
    .filter((m) => m.role !== 'system' && m.role !== 'developer')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : m.content.map(claudePart),
    }))
  return {
    model: slug,
    ...(system ? { system } : {}),
    messages: rest,
    max_tokens: CLAUDE_MAX_TOKENS,
    stream: false,
    // Boolean, not a ladder — 'medium' reads as thinking-on rather than off,
    // which is the closer of the two. Identical to the old `=== 'high'` for
    // every caller that passes 'low' or 'high'.
    thinkingFlag: effort !== 'low',
  }
}

// Anthropic image blocks want the media type and raw base64 split out of the
// data URI; a hosted https URL passes through as a url source.
function claudePart(part: ChatContentPart) {
  if (part.type === 'text') return { type: 'text', text: part.text }
  const url = part.image_url.url
  const dataUri = /^data:([^;]+);base64,(.*)$/s.exec(url)
  return dataUri
    ? { type: 'image', source: { type: 'base64', media_type: dataUri[1], data: dataUri[2] } }
    : { type: 'image', source: { type: 'url', url } }
}

function parseClaudeContent(body: unknown): string {
  const blocks = (body as { content?: Array<{ type?: string; text?: string }> }).content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
}

// ── openai-responses ───────────────────────────────────────────

// The Responses API renames everything: `input` not `messages`, and part types
// gain an `input_` prefix with the image URL flattened onto the part itself.
function responsesBody(slug: string | undefined, messages: ChatMessage[], effort: ReasoningEffort) {
  return {
    model: slug,
    input: messages.map((m) => ({
      // 'system'/'developer' are both accepted here, unlike Claude.
      role: m.role,
      content:
        typeof m.content === 'string'
          ? [{ type: 'input_text', text: m.content }]
          : m.content.map((p) =>
              p.type === 'text'
                ? { type: 'input_text', text: p.text }
                : { type: 'input_image', image_url: p.image_url.url },
            ),
    })),
    reasoning: { effort },
    stream: false,
  }
}

function parseResponsesContent(body: unknown): string {
  const output = (body as {
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
  }).output
  if (!Array.isArray(output)) return ''
  return output
    // Skip the 'reasoning' blocks that sit alongside the message.
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('')
}

function textOf(parts: ChatContentPart[]): string {
  return parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
}

// Each transport names its incremental text differently. We ask the two newer
// transports for stream:false, so their branches here are a safety net for a
// gateway that streams anyway rather than the expected path.
function parseSSEContent(
  raw: string,
  transport: ChatCallTarget['transport'] = 'openai-chat',
): { content: string; truncated: boolean } {
  let content = ''
  let truncated = false
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
        // claude-messages sends an object delta ({ text }); openai-responses
        // sends a bare string on its output_text.delta events.
        delta?: { type?: string; text?: string } | string
        // openai-responses: response.output_text.delta events, and the
        // terminal response.completed carrying the whole assembled response.
        type?: string
        response?: unknown
      }

      // Checked on every event, before the per-transport branches: each
      // transport reports its stop reason on a different event (openai-chat on
      // the last choice, claude on message_delta, responses on the terminal
      // response object), and hitTokenLimit knows all three.
      if (hitTokenLimit(parsed, transport)) truncated = true

      if (transport === 'claude-messages') {
        const text = typeof parsed.delta === 'object' ? parsed.delta?.text : undefined
        if (typeof text === 'string') content += text
        continue
      }
      if (transport === 'openai-responses') {
        if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
          content += parsed.delta
        } else if (
          // `response.incomplete` is the terminal event when the run stopped on
          // max_output_tokens — same assembled shape as `completed`, so it has
          // to be read the same way or the partial text is thrown away.
          (parsed.type === 'response.completed' || parsed.type === 'response.incomplete') &&
          parsed.response
        ) {
          // Prefer the assembled response when we get one — it's complete even
          // if we joined the stream late or a delta event was malformed.
          const whole = parseResponsesContent(parsed.response)
          if (whole.length > 0) return { content: whole, truncated }
        }
        continue
      }

      const delta = parsed.choices?.[0]?.delta?.content
      const message = parsed.choices?.[0]?.message?.content
      if (typeof delta === 'string') content += delta
      else if (typeof message === 'string') content += message
    } catch {
      // skip non-JSON event payloads (comments, keepalives)
    }
  }
  return { content, truncated }
}

// ── Veo generate (custom endpoint) ──────────────────────────────
//
// The Veo family used POST /api/v1/veo/generate (NOT /jobs/createTask).
// No registry entry uses this any more — Veo 3.1 was removed in July 2026 — but
// B-Roll history rows written while it was live carry `videoEndpoint: 'veo'`,
// and the refresh-resume path needs this poller to finish those clips.
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
  const createRes = await submitToKie(
    () =>
      fetchWithRetry(
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
      ),
    signal,
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
  let blindStreak = 0

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
        // A bad envelope code on a healthy read — kie answered, so we're not blind.
        blindStreak = 0
        continue
      }
      record = env.data
    } catch (err) {
      if (signal?.aborted) throw err
      if (isTerminalPollError(err)) throw err
      blindStreak++
      continue
    }
    blindStreak = 0

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
  throw new PollTimeoutError(minutes, 'Veo generation', blindStreak >= UNREACHABLE_STREAK)
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
  const res = await submitToKie(
    () =>
      fetchWithRetry(
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
      ),
    signal,
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
  let blindStreak = 0

  for (let i = 0; i < maxPollAttempts; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await new Promise((r) => setTimeout(r, pollIntervalMs))

    let record: SunoRecordData
    try {
      record = await kieMusicPoll(apiKey, taskId, signal)
    } catch (err) {
      if (signal?.aborted) throw err
      if (isTerminalPollError(err)) throw err
      blindStreak++
      continue
    }
    blindStreak = 0

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
  throw new PollTimeoutError(minutes, 'Music generation', blindStreak >= UNREACHABLE_STREAK)
}

// ── Gemini Omni create endpoints (synchronous) ─────────────────
//
// The Omni ecosystem has two non-task endpoints that mint persistent ids,
// returned immediately (no polling):
//   POST /omni/audio/create     -> { kieAudioId }   designed voice
//   POST /omni/character/create -> { characterId }  reusable character
// The ids are scoped to the member's kie.ai account and are later passed to
// Gemini Omni Flash 1.1 createTask bodies as audio_ids / character_ids.
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
  const res = await submitToKie(() =>
    fetchWithRetry(
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
    ),
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
  throw new Error(`Cannot host image source. Unsupported format: ${source.slice(0, 64)}`)
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
