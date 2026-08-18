// Per-app attention tracking — the only signal in the app for WHICH app a
// member is in and for how long.
//
// Everything else the admin panel reports is derived from outputs: assets in
// R2, rows in the bank tables, counts in the usage ledger. That measures what
// members produced, never what they used, so four dock apps are invisible to
// it — Outliers writes no history bank (only a swipe, if one is saved), and
// Bank, Edit and the Dashboard write nothing at all. "Is anyone opening
// Outliers?" was unanswerable, which is what this fills in.
//
// Three rules make the number honest rather than flattering:
//
//   1. It is ATTENTION time, not wall-clock. Time accrues only while the tab is
//      visible and the member has touched something within IDLE_AFTER_MS. A
//      workspace left open on a second monitor all afternoon logs nothing, and
//      it has to — an unbounded "app was open" figure would make whichever app
//      people happen to leave on top look like the most used one in the
//      community.
//   2. It samples rather than integrates. Every TICK_MS the tracker asks "is
//      this still live?" and credits that one tick if so. A machine that sleeps
//      simply stops firing the interval, so a suspended laptop can never wake
//      up and bank eight hours.
//   3. It buffers. Time accumulates in memory across dock switches and commits
//      to the ledger on COMMIT_EVERY_MS, so rapid dock-hopping costs one write,
//      not one per hop. Each commit is a bank-row write (idle-scheduled local
//      cache + one background cloud upsert), which is why the interval is
//      minutes rather than seconds.
//
// Generations are counted separately and always have been, so a member sitting
// on a card watching a three-minute video render does drop out of the count
// after IDLE_AFTER_MS. That is the right trade: the alternative is treating
// "kept a tab open" as engagement.

import { useAppStore } from '../stores/appStore'
import { useBankStore } from '../stores/bankStore'
import type { AppUsageStat } from '../stores/types'

// How often the tracker samples. Also the credit granted per live sample, so
// every recorded figure is a multiple of it.
const TICK_MS = 15_000

// No pointer, key, scroll or touch for this long and the member is treated as
// away. Long enough to read a script or watch a clip through without being
// dropped; short enough that a forgotten tab banks nothing.
const IDLE_AFTER_MS = 2 * 60_000

// How often buffered time is folded into the usage ledger.
const COMMIT_EVERY_MS = 5 * 60_000

// Input signals that count as "still here". `mousemove` is deliberately absent:
// it fires continuously for a cursor merely crossing the window on the way
// somewhere else, and the events below already cover every real interaction.
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const

interface Tracker {
  pending: Map<string, AppUsageStat>
  lastInputAt: number
  tickTimer: ReturnType<typeof setInterval> | null
  commitTimer: ReturnType<typeof setInterval> | null
  unsubscribe: (() => void) | null
  teardown: (() => void) | null
}

let tracker: Tracker | null = null

function bump(t: Tracker, appId: string, field: keyof AppUsageStat, by: number): void {
  const current = t.pending.get(appId) ?? { seconds: 0, opens: 0 }
  t.pending.set(appId, { ...current, [field]: current[field] + by })
}

// Credit one sample to the active app, if the member is actually there.
function tick(t: Tracker): void {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  if (Date.now() - t.lastInputAt > IDLE_AFTER_MS) return
  const appId = useAppStore.getState().activeApp
  if (!appId) return
  bump(t, appId, 'seconds', TICK_MS / 1000)
}

// Fold the buffer into the ledger and empty it. Safe to call with nothing
// buffered — it returns without writing.
function commit(t: Tracker): void {
  if (t.pending.size === 0) return
  const batch = Object.fromEntries(t.pending)
  t.pending.clear()
  try {
    useBankStore.getState().recordAppUsage(batch)
  } catch (e) {
    console.warn('[appUsage] commit failed', e)
  }
}

/**
 * Start tracking. Idempotent — a second call while running is a no-op, so a
 * remount can't end up with two tickers double-counting every sample.
 */
export function startAppUsageTracking(): void {
  if (tracker || typeof window === 'undefined') return

  const t: Tracker = {
    pending: new Map(),
    // Opening the workspace IS an interaction; without this the first two
    // minutes of every session read as idle.
    lastInputAt: Date.now(),
    tickTimer: null,
    commitTimer: null,
    unsubscribe: null,
    teardown: null,
  }
  tracker = t

  const noteInput = () => { t.lastInputAt = Date.now() }
  for (const evt of INPUT_EVENTS) {
    window.addEventListener(evt, noteInput, { passive: true, capture: true })
  }

  // Returning to a backgrounded tab is an interaction too — otherwise a member
  // who switches back and reads for a minute before clicking counts as away.
  // Leaving is the moment to bank what's buffered: a tab that is closed rather
  // than navigated away from may never fire anything else.
  const onVisibility = () => {
    if (document.visibilityState === 'visible') t.lastInputAt = Date.now()
    else commit(t)
  }
  document.addEventListener('visibilitychange', onVisibility)

  const onPageHide = () => commit(t)
  window.addEventListener('pagehide', onPageHide)

  // Count an open per switch INTO an app. The first paint of the session lands
  // here too, since activeApp starts null and the dock/router sets it.
  let previous = useAppStore.getState().activeApp
  if (previous) bump(t, previous, 'opens', 1)
  t.unsubscribe = useAppStore.subscribe((state) => {
    const next = state.activeApp
    if (next === previous) return
    previous = next
    if (next) bump(t, next, 'opens', 1)
  })

  t.tickTimer = setInterval(() => tick(t), TICK_MS)
  t.commitTimer = setInterval(() => commit(t), COMMIT_EVERY_MS)

  t.teardown = () => {
    for (const evt of INPUT_EVENTS) {
      window.removeEventListener(evt, noteInput, { capture: true })
    }
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
  }
}

/**
 * Stop tracking and DISCARD whatever is buffered.
 *
 * Dropping it is deliberate. The only thing that stops the tracker is the
 * workspace unmounting, which means the signed-in user changed — and a commit
 * on the way out races the sign-out wipe of the local banks, so the losing case
 * is one member's minutes landing in the next member's ledger on a shared
 * browser. Up to COMMIT_EVERY_MS of the outgoing session is lost instead, and
 * the ordinary paths (the interval, tab-hide, pagehide) have already banked
 * everything before it.
 */
export function stopAppUsageTracking(): void {
  const t = tracker
  if (!t) return
  tracker = null
  if (t.tickTimer) clearInterval(t.tickTimer)
  if (t.commitTimer) clearInterval(t.commitTimer)
  t.unsubscribe?.()
  t.teardown?.()
  t.pending.clear()
}
