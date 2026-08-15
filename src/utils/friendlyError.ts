// Single source of truth for the user-facing error text shown anywhere a
// generation/API call can fail. Every catch block that surfaces an error to a
// real user (toast, inline chip, history row) should run the caught value
// through humanizeError so the whole app speaks with one voice and users get a
// plain-English "here's what to do" line instead of a raw kie.ai 4xx/5xx dump.
//
// NOTE: This deliberately overrides the older CLAUDE.md "surface raw kie.ai
// response shape" rule for *end-user* surfaces — the operator asked for friendly
// copy so members stop forwarding raw errors as support questions. The raw text
// still lives in kie.ai's own request logs (which the operator reads) and in
// admin/settings/infra surfaces, which intentionally keep verbatim messages.

// Each rule matches case-insensitively against the raw error message. Order
// matters: most specific first, generic codes last. The first match wins.
const RULES: Array<{ test: (m: string) => boolean; message: string }> = [
  // ── ScrapeCreators (Outliers search) ──
  //
  // These MUST stay above the kie.ai rules below: both services use 401 and
  // 402, and the generic kie rules would otherwise tell a member to go and
  // replace their kie.ai key when it's the ScrapeCreators one that's wrong.
  // ScrapeCreatorsError prefixes every message with the vendor name so this
  // test can't be fooled by a kie error that happens to contain a number.
  {
    test: (m) => m.includes('scrapecreators') && m.includes('401'),
    message:
      "That ScrapeCreators API key isn't valid. Open Settings, paste a fresh key from scrapecreators.com, and try again.",
  },
  {
    // ScrapeCreators answers an UNRECOGNISED key with 402 "out of credits",
    // not 401 — verified against the live API. So this one message has to cover
    // both causes, or a member who typo'd their key is sent off to buy credits
    // they already have.
    test: (m) => m.includes('scrapecreators') && (m.includes('402') || m.includes('credit')),
    message:
      "ScrapeCreators turned that search down — either the key is wrong or you're out of credits. Check the key in Settings, then top up at scrapecreators.com if it's correct.",
  },
  {
    test: (m) => m.includes('scrapecreators') && m.includes('429'),
    message:
      'ScrapeCreators is rate-limiting requests right now. Wait a few seconds and search again.',
  },
  {
    test: (m) => m.includes('scrapecreators') && /\b(0|5\d\d)\b/.test(m),
    message:
      'Could not reach ScrapeCreators. Check your internet connection and try the search again.',
  },
  {
    test: (m) => m.includes('scrapecreators'),
    message:
      'That search failed. Try a different phrase, or check your ScrapeCreators key in Settings.',
  },

  // ── Veo: Google's per-prompt audio-generation failure (HTTP 400) ──
  {
    test: (m) => m.includes('unable to generate audio') || (m.includes('google model') && m.includes('audio')),
    message:
      "Veo couldn't generate audio for this prompt — this is a Google model limitation, not a problem with your account. Try rephrasing the prompt (simplify or change any dialogue) and generate again, or switch to a different video model.",
  },

  // ── Content moderation / safety filters ──
  {
    test: (m) =>
      m.includes('sensitive') ||
      m.includes('moderation') ||
      m.includes('flagged') ||
      m.includes('content policy') ||
      m.includes('safety') ||
      m.includes('nsfw'),
    message:
      "The model's content filter flagged this request. Edit the wording of your prompt (or swap any reference images) and try again.",
  },

  // ── Auth / billing on the kie.ai key ──
  {
    test: (m) => m.includes('401') || (m.includes('invalid') && m.includes('key')) || (m.includes('expired') && m.includes('key')),
    message:
      'Your kie.ai API key looks invalid or expired. Open Settings, paste a fresh key from kie.ai, and try again.',
  },
  {
    test: (m) => m.includes('402') || m.includes('insufficient credit') || m.includes('not enough credit'),
    message:
      "You're out of kie.ai credits. Top up your balance at kie.ai, then try again.",
  },
  {
    test: (m) => m.includes('433') || (m.includes('usage limit') || m.includes('limit exceeded')),
    message:
      'Your kie.ai key has hit its usage limit. Check your plan limits at kie.ai, then try again.',
  },
  {
    test: (m) => m.includes('429') || m.includes('rate limit') || m.includes('too many request'),
    message:
      'kie.ai is rate-limiting requests right now. Wait a few seconds and try again.',
  },

  // ── kie.ai-side outages (incl. the 200-envelope maintenance case) ──
  {
    test: (m) => m.includes('455') || m.includes('maintenance') || m.includes('maintain'),
    message:
      'kie.ai is under maintenance right now — this is on their end, not yours. Try again in a few minutes.',
  },
  {
    test: (m) => /\b5\d\d\b/.test(m) || m.includes('server error'),
    message:
      'kie.ai had a server error — this is on their end, not yours. Try again in a moment.',
  },

  // ── Network / timeouts (our own messages) ──
  //
  // These four were one rule, and its advice ("the model is likely busy, give
  // it a minute") was wrong for three of them. A dropped connection, a request
  // we hung up on (kie finishes and bills it anyway), and a poll budget that
  // ran out while the task was still rendering all need different next steps —
  // and "try again" is the expensive answer when the work already happened.
  //
  // Order matters: a stalled upload and a blind poll loop both say "timed out"
  // too, so the connection rules must sit above the generic catch-all.
  {
    // r2.ts's stalled upload, and fetchWithRetry giving up on the socket.
    test: (m) =>
      m.includes('stalled') ||
      m.includes('connection failed') ||
      m.includes('failed to fetch') ||
      m.includes('network'),
    message:
      'The connection dropped mid-request. Check your internet connection and try again.',
  },
  {
    // PollTimeoutError with unreachable=true — we gave up while the polls
    // themselves were failing, so the model was never the problem.
    test: (m) => m.includes('connection to kie.ai kept failing'),
    message:
      'Lost the connection to kie.ai while waiting. Check your internet — the generation may have finished anyway, so check kie.ai before running it again.',
  },
  {
    // fetchWithRetry's AbortController fired: we stopped listening before kie
    // answered. kie bills for whatever it finished after that.
    test: (m) => m.includes('request timed out'),
    message:
      'The request was dropped before kie.ai answered. It may have finished anyway, so check kie.ai before retrying.',
  },
  {
    // fetchGeneratedAsset's deadline: kie FINISHED and billed, and the download
    // of the finished file stalled. This used to fall through to the poll-timeout
    // rule below and tell the member their clip was "still running on kie.ai",
    // which sent them off to check a task that was already done — and left them
    // a Retry that re-billed a full generation. It's the biggest files that trip
    // it, so this is the one a Seedance 2.5 clip lands on.
    test: (m) => m.includes('timed out downloading'),
    message:
      "Your result finished, but downloading it timed out. Retry — it picks up the finished file rather than generating it again, so it costs no extra credits.",
  },
  {
    // PollTimeoutError on a healthy connection — the task is very likely still
    // rendering on kie.ai, and regenerating pays for it twice.
    test: (m) => m.includes('timed out') || m.includes('timeout'),
    message:
      "This is taking longer than we wait for, so we stopped watching — it's likely still running on kie.ai. Check there before generating it again.",
  },

  // ── Truncated model responses (TruncatedResponseError) ──
  //
  // Distinct from the empty/malformed rule below: the model DID answer, it just
  // ran out of room mid-answer. That matters because the parsers downstream
  // would otherwise accept the fragment — a cut-off storyboard renders as a
  // short one — so this copy has to say the result is incomplete, not that
  // something failed. Keyed on 'output token limit', which is narrower than the
  // 'usage limit' / 'rate limit' rules above and so can't be caught by them.
  {
    test: (m) => m.includes('output token limit'),
    message:
      'The model ran out of room and stopped partway, so this result is incomplete. Try again with a shorter script or fewer scenes, or pick a different model.',
  },

  // ── Empty / malformed model responses ──
  {
    test: (m) =>
      m.includes('empty sse') ||
      m.includes('empty response') ||
      m.includes('non-json') ||
      m.includes('no result') ||
      m.includes('no tracks') ||
      m.includes('no audiourl'),
    message:
      'The model returned an empty result. Try again, or simplify your prompt.',
  },

  // ── Generic validation ──
  {
    test: (m) => m.includes('422') || m.includes('validation'),
    message:
      'The request was rejected as invalid. Try adjusting your inputs (prompt, reference images, or settings) and generate again.',
  },
]

const GENERIC_FALLBACK =
  'Something went wrong while generating. Please try again in a moment — if it keeps failing, the model may be temporarily down on kie.ai.'

/**
 * Turn any thrown value into one friendly, plain-English sentence for end users.
 * Pass an optional `fallback` to override the generic message for unrecognized
 * errors (e.g. "Couldn't save to your bank. Try again.").
 *
 * The return value is ALWAYS a complete sentence — never prefix it at the call
 * site. `addToast(\`Video generation failed: ${humanizeError(err, 'Video
 * generation failed.')}\`)` renders the operation name twice. Name the
 * operation in the `fallback` instead and toast the result verbatim:
 * `addToast(humanizeError(err, 'Video generation failed.'), 'error')`.
 */
// Where a message stops explaining and starts dumping debug context. Several
// generation errors append the raw evidence an operator needs — `taskId=…`,
// `url=…`, `record={…}`, `body=…`, `size=…B` — and those payloads are full of
// arbitrary digits, while the status-code rules above are plain substring
// matches. So `kie.ai returned an undecodable video (size=402B, …)` matched the
// 402 rule and told a member with a full balance to go and buy credits, and any
// blob size or CDN URL containing 401 told them to replace a working API key.
//
// Matching against the human half only fixes that without weakening anything:
// kie's own status codes and messages always land BEFORE this boundary
// (`friendlyHttpError` builds `kie.ai 402 (insufficient credits) at POST /x: …`),
// and so does every phrase the non-numeric rules look for.
// The leading boundary is "any non-identifier char", not whitespace: these keys
// appear bracketed as often as spaced (`blob (size=1401234B, …)`). `type` is
// deliberately NOT in the list — it only ever follows a `size=`/`url=` that
// already cuts, and including it would truncate at `content-type=` and throw
// away the sentence that names the failure.
const DEBUG_TAIL = /(?:^|[^a-z0-9])(?:taskid|url|record|body|size|endpoint|response shape|first \d+ chars)\s*[=:]/i

export function humanizeError(err: unknown, fallback: string = GENERIC_FALLBACK): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (!raw) return fallback
  const cut = raw.search(DEBUG_TAIL)
  const lower = (cut === -1 ? raw : raw.slice(0, cut)).toLowerCase()
  if (!lower.trim()) return fallback
  for (const rule of RULES) {
    if (rule.test(lower)) return rule.message
  }
  return fallback
}
