import { useState } from 'react'
import { ChevronRight, Zap } from 'lucide-react'
import SettingsModal from '../../components/SettingsModal'
import { GlassTile } from '../../components/AppGlassTile'
import ApiKeyGuide from '../../components/ApiKeyGuide'
import { WIDGET_SHELL, WIDGET_INTERACTIVE, riseStyle } from './widgetStyles'

// The first step, staged as a macOS notification banner across the top of the
// desktop: cut from the same glass as the widgets, kie.ai's gold bolt on the
// left wearing the dock's own icon material (`GlassTile`), a chevron on the
// right. It sits there until a kie.ai key is saved (nothing can generate
// without one) — chrome, not an error. Clicking opens the same ApiKeyGuide as
// the menu bar alert, which takes the key inline; Settings is still reachable
// from its foot. Dashboard owns the show/hide (it watches kieApiKey), so the
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
        {/* The glass squircle every dock tile is cut from, in kie.ai's gold —
            the same mark `ApiKeyGuide` opens with, since this banner is the way
            in to it. A flat tinted square beside a dock full of glass icons read
            as a different kind of object, and this one belongs to the set:
            nothing in that row generates anything without it. */}
        <GlassTile icon={Zap} accent="#F2B231" size={36} />
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
