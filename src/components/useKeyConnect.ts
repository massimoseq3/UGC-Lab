import { useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useCreditsStore } from '../stores/creditsStore'
import { kieTestConnection } from '../utils/kie'

type Status =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'connected'; credits: number }
  | { phase: 'error'; message: string }

/**
 * The connect-a-key transaction, shared by the ApiKeyGuide modal and the
 * Meet-your-team intro. The rule that has to hold in both places: the key is
 * checked against the live balance BEFORE it is saved, so nothing is ever
 * stored that can't generate. Each surface draws its own markup around it.
 *
 * Lives in its own file rather than inside ApiKeyGuide: a file that exports
 * both a component and a hook loses React Fast Refresh.
 */
export function useKeyConnect() {
  const setKieApiKey = useSettingsStore((s) => s.setKieApiKey)
  const refreshCredits = useCreditsStore((s) => s.refresh)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<Status>({ phase: 'idle' })

  const key = draft.trim()

  async function connect() {
    if (!key || status.phase === 'checking') return
    setStatus({ phase: 'checking' })
    const result = await kieTestConnection(key)
    if (!result.ok) {
      setStatus({ phase: 'error', message: result.error })
      return
    }
    setKieApiKey(key)
    refreshCredits()
    setStatus({ phase: 'connected', credits: result.credits })
  }

  return {
    draft,
    key,
    status,
    connected: status.phase === 'connected',
    connect,
    setDraft: (value: string) => {
      setDraft(value)
      setStatus({ phase: 'idle' })
    },
  }
}
