import { AlertTriangle, ArrowUpCircle } from 'lucide-react'

import { reloadForUpdate } from '../stores/updateStore'

/**
 * What a member sees instead of a blank page. Two readings of the same
 * situation: a chunk that a deploy renamed (by far the common one, and not an
 * error as far as the member is concerned), and everything else.
 *
 * Its own file because AppErrorBoundary has to be a class — the only thing in
 * React that can catch a render error — and a file exporting a class component
 * can't fast-refresh a function component beside it.
 */
export default function AppErrorScreen({ stale, className }: { stale: boolean; className?: string }) {
  const Icon = stale ? ArrowUpCircle : AlertTriangle

  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-3 bg-surface-0 px-6 text-center ${className ?? ''}`}
    >
      <Icon
        className={`h-8 w-8 ${stale ? 'text-emerald-400 light:text-emerald-600' : 'text-ink-600'}`}
        strokeWidth={1.5}
      />
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight text-ink-100">
          {stale ? 'UGC OS was updated' : 'Something went wrong'}
        </h2>
        <p className="text-[13px] text-ink-500">
          {stale
            ? 'Reload to pick up the latest version.'
            : 'Reloading usually clears it.'}
        </p>
      </div>
      <button
        onClick={reloadForUpdate}
        className="rounded-full bg-ink px-5 py-2 text-[13px] font-semibold tracking-tight text-paper transition-colors hover:bg-ink/90"
      >
        Reload
      </button>
    </div>
  )
}
