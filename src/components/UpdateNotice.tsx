import { ArrowUpCircle, X } from 'lucide-react'

import { reloadForUpdate, useUpdateStore } from '../stores/updateStore'

/**
 * The one place the app says "there's a newer version of me than the one you're
 * looking at". A pill under the menu bar: it doesn't block anything, because a
 * member mid-generation shouldn't be reloaded out of it — but it doesn't fade
 * out either, because unlike a toast this is a thing still waiting to be done.
 *
 * Dismiss hides it for the life of the tab. The update is still pending; if the
 * member then opens an app whose chunk is gone, the pane says so with its own
 * copy (AppErrorBoundary) and the reload button is there instead.
 */
export default function UpdateNotice() {
  const available = useUpdateStore((s) => s.available)
  const dismissed = useUpdateStore((s) => s.dismissed)
  const dismiss = useUpdateStore((s) => s.dismiss)

  if (!available || dismissed) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-11 z-[100] flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-ink/10 bg-surface-2/90 py-1.5 pl-3 pr-1.5 shadow-lg backdrop-blur-xl">
        <ArrowUpCircle className="h-3.5 w-3.5 shrink-0 text-emerald-400 light:text-emerald-600" strokeWidth={2} />
        <span className="truncate text-[12px] font-medium text-ink-300">
          UGC OS was updated
        </span>
        <button
          onClick={reloadForUpdate}
          className="shrink-0 rounded-full bg-ink px-3 py-1 text-[12px] font-semibold tracking-tight text-paper transition-colors hover:bg-ink/90"
        >
          Reload
        </button>
        <button
          onClick={dismiss}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-ink/[0.06] hover:text-ink-300"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
