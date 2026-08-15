import { useEffect, useState } from 'react'

/**
 * A counter that ticks when this browser's connection comes back.
 *
 * It exists for the in-flight resume passes: a generation kie has already run
 * — and billed for — is recoverable for 3 days, and the download is the half
 * that a dropped connection kills. Re-running the resume pass the moment the
 * network returns is what turns "the clip is lost unless you reload" into
 * "the clip lands on its own", which is the whole point of holding the taskId.
 *
 * Deliberately `online` ONLY, not `visibilitychange`. Every resume attempt
 * that fails re-toasts its error, and a genuinely dead task (content filter,
 * expired result) would re-report itself on every tab switch. Losing and
 * regaining a connection is rare and is exactly the case worth retrying;
 * mounting the view already covers coming back to it.
 */
export function useReconnectTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    window.addEventListener('online', bump)
    return () => window.removeEventListener('online', bump)
  }, [])
  return tick
}
