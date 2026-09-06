import { useState, useEffect } from 'react'

// A live `min-width` media query. Read one ONLY for behaviour CSS cannot
// express — a drawer deciding whether picking something inside it should close
// it. Layout itself stays in the class string, where it can't drift from what
// is on screen.
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return matches
}

/** Tailwind's `md` — the width at which every app shows both its panes. */
export function useIsDesktop(): boolean {
  return useMinWidth(768)
}
