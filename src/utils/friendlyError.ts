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
  {
    test: (m) => m.includes('timed out') || m.includes('timeout'),
    message:
      'This took too long and timed out. Try again — if it keeps happening the model is likely busy, so give it a minute.',
  },
  {
    test: (m) => m.includes('connection failed') || m.includes('failed to fetch') || m.includes('network'),
    message:
      "Couldn't reach kie.ai. Check your internet connection and try again.",
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
export function humanizeError(err: unknown, fallback: string = GENERIC_FALLBACK): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (!raw) return fallback
  const lower = raw.toLowerCase()
  for (const rule of RULES) {
    if (rule.test(lower)) return rule.message
  }
  return fallback
}
