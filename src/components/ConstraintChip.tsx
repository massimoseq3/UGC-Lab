import { useEffect, useRef, useState } from 'react'

// Compact chip-styled picker used for video/image constraint pickers
// (aspect ratio, duration, resolution, audio). The options reveal on CLICK —
// click the trigger to open the menu, click an option (or outside / Escape) to
// close it. Shared by Playground, B-Roll and Influencers so the surfaces feel
// like one app.
export default function ConstraintChip({
  options,
  value,
  onChange,
  render,
  renderOption,
  openDirection = 'up',
  align = 'left',
  size = 'md',
  grow = false,
  triggerClassName,
  hover = false,
}: {
  options: string[]
  value: string
  onChange: (next: string) => void
  render?: (v: string) => React.ReactNode
  // Optional richer rendering for the dropdown options only (e.g. show the
  // per-option credit cost) while the trigger stays compact via `render`.
  renderOption?: (v: string) => React.ReactNode
  // 'up' matches Playground's footer position; 'down' is for top-of-page bars.
  openDirection?: 'up' | 'down'
  // Horizontal anchor of the menu. 'right' keeps a wide menu from overflowing
  // (and being clipped) when the chip sits near the right edge of its panel.
  align?: 'left' | 'right'
  // 'lg' matches the large ModelPicker trigger height; 'sm' matches a single-
  // line text input (e.g. the Influencers Pose/Action fields).
  size?: 'sm' | 'md' | 'lg'
  // When true, the chip flexes to fill its share of the row (used to spread the
  // constraint chips across the full width under the model picker).
  grow?: boolean
  // Overrides the trigger's border/background/text classes (the default is a
  // neutral chip). Used by the audio pill to keep its tinted accent when on.
  triggerClassName?: string
  // Opt-in hover-to-open (Playground footer chips). A short close delay bridges
  // the trigger→menu gap. Default stays click-only for B-Roll / Influencers.
  hover?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const cancelClose = () => { if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null } }
  const openNow = () => { cancelClose(); setOpen(true) }
  const closeSoon = () => { cancelClose(); closeTimer.current = window.setTimeout(() => setOpen(false), 120) }

  // Close on outside click or Escape while the menu is open.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div
      ref={wrapperRef}
      className={`relative ${grow ? 'flex-1' : ''}`}
      onMouseEnter={hover ? openNow : undefined}
      onMouseLeave={hover ? closeSoon : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-full border transition-colors ${
          triggerClassName ?? 'border-ink/10 bg-ink/[0.02] text-ink-300 hover:bg-ink/[0.05]'
        } ${grow ? 'w-full justify-center' : ''} ${
          size === 'lg' ? 'h-12 px-4 text-[13px]' : size === 'sm' ? 'h-9 px-3.5 text-[13px]' : 'h-10 px-4 text-[12px]'
        }`}
      >
        {render ? render(value) : <span>{value}</span>}
      </button>
      {open && (
        <div
          className={`absolute z-40 ${
            openDirection === 'up' ? 'bottom-full pb-1' : 'top-full pt-1'
          } ${align === 'right' ? 'right-0' : 'left-0'}`}
          onMouseEnter={hover ? openNow : undefined}
          onMouseLeave={hover ? closeSoon : undefined}
        >
          {/* Option rows are a real tap target: 36px tall at the trigger's own
              13px, not the 11px/24px they used to be. These are the resolution
              and aspect menus on every generate bar in the app — the pills
              were fiddly to hit with a mouse and worse on a trackpad. */}
          <div className="min-w-[160px] overflow-hidden rounded-2xl border border-ink/10 bg-surface-2/95 p-1.5 shadow-xl backdrop-blur-xl">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false) }}
                className={`flex min-h-9 w-full items-center whitespace-nowrap rounded-full px-3.5 py-2 text-left text-[13px] transition-colors ${
                  opt === value ? 'bg-ink/[0.08] text-ink-100' : 'text-ink-300 hover:bg-ink/[0.05]'
                }`}
              >
                {renderOption ? renderOption(opt) : render ? render(opt) : opt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
