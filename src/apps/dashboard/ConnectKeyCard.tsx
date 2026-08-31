import { useState } from 'react'
import { ChevronRight, KeyRound } from 'lucide-react'
import SettingsModal from '../../components/SettingsModal'
import ApiKeyGuide from '../../components/ApiKeyGuide'
import { WIDGET_SHELL, WIDGET_INTERACTIVE, riseStyle } from './widgetStyles'

// The first step, staged as a macOS notification banner across the top of the
// desktop: cut from the same glass as the widgets, an amber key tile on the
// left, a chevron on the right. It sits there until a kie.ai key is saved
// (nothing can generate without one) — chrome, not an error. Clicking opens the
// same ApiKeyGuide as the menu bar alert, which takes the key inline. Settings
// is still reachable from its foot. Dashboard owns the show/hide (it watches
// kieApiKey), so the
// banner vanishes the moment the key lands.

export default function ConnectKeyCard() {
  const [guideOpen, setGuideOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setGuideOpen(true)}
        style={riseStyle(0)}
        className={`widget-rise group flex items-center gap-3 px-3.5 py-3 text-left ${WIDGET_SHELL} ${WIDGET_INTERACTIVE}`}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px] bg-amber-400/15 light:bg-amber-500/15">
          <KeyRound className="h-[18px] w-[18px] text-amber-300 light:text-amber-600" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold tracking-tight text-ink-100">
            Connect your kie.ai API key
          </span>
          <span className="block truncate text-[12px] text-ink-500">
            Every generation runs through your own kie.ai account.
          </span>
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-ink-600 transition-colors group-hover:text-ink-300"
          strokeWidth={2}
        />
      </button>

      {guideOpen && (
        <ApiKeyGuide
          onClose={() => setGuideOpen(false)}
          onOpenSettings={() => {
            setGuideOpen(false)
            setSettingsOpen(true)
          }}
        />
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
