import type { ReactNode, RefObject } from 'react'
import { X, Plus, type LucideIcon } from 'lucide-react'

// Shared building blocks for the Playground reference inputs. The design goal:
// every input the active model accepts reads as a labelled, droppable slot you
// can see and understand at a glance — big frame squares, thumbnail tiles for
// images, media cards for clips — instead of a row of ambiguous dashed pills.

// A labelled group. The label names what the slots below are for, so no single
// slot has to carry its own explanatory copy.
export function RefGroup({
  label,
  count,
  max,
  children,
}: {
  label: string
  count?: number
  max?: number
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 px-0.5">
        <span className="text-[11px] font-medium tracking-tight text-ink-500">{label}</span>
        {count != null && max != null && (
          <span className="text-[10px] tabular-nums text-ink-600">
            {count}/{max}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

// Square thumbnail for an attached reference image. Hover scrims it and reveals
// a remove button. An optional caption (e.g. a character name) sits along the
// bottom; `accent` rings it in the Playground colour for bank-backed items.
export function ImageTile({
  src,
  label,
  accent = false,
  onRemove,
}: {
  src: string
  label?: string
  accent?: boolean
  onRemove: () => void
}) {
  return (
    <div
      className={`group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border ${
        accent ? 'border-playground-500/30' : 'border-ink/10'
      }`}
    >
      <img src={src} alt="" className="h-full w-full object-cover" />
      {label && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-3 text-[9px] font-medium text-white">
          {label}
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

// Dashed "add" tile that matches ImageTile's footprint. Opens whatever the
// parent wires to onClick (an upload/bank menu, or a file dialog directly).
export function AddTile({
  onClick,
  triggerRef,
  label = 'Add',
  disabled = false,
}: {
  onClick: () => void
  triggerRef?: RefObject<HTMLButtonElement | null>
  label?: string
  disabled?: boolean
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-ink/15 bg-ink/[0.02] text-ink-500 transition-colors ${
        disabled
          ? 'cursor-not-allowed opacity-40'
          : 'hover:border-ink/30 hover:bg-ink/[0.05] hover:text-ink-300'
      }`}
    >
      <Plus className="h-4 w-4" />
      <span className="text-[9px] font-medium">{label}</span>
    </button>
  )
}

// A wider card for an attached non-image reference (audio / video clip, source
// clip). Icon + name + optional meta + remove, with room for extra controls
// (e.g. the Omni trim window) via children.
export function MediaCard({
  icon: Icon,
  label,
  meta,
  accent = false,
  onRemove,
  children,
}: {
  icon: LucideIcon
  label: string
  meta?: string
  accent?: boolean
  onRemove: () => void
  children?: ReactNode
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 ${
        accent
          ? 'border-playground-500/25 bg-playground-500/10 text-playground-200'
          : 'border-ink/10 bg-ink/[0.03] text-ink-200'
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          accent ? 'bg-playground-500/15 text-playground-300' : 'bg-ink/[0.06] text-ink-500'
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12px] font-medium leading-tight">{label}</span>
        {meta && <span className="text-[10px] leading-tight text-ink-500">{meta}</span>}
      </div>
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink/10 hover:text-ink-200"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// Dashed "add" card matching MediaCard's height, for uploading a clip.
export function MediaAddCard({
  icon: Icon,
  label,
  helper,
  onClick,
  disabled = false,
  triggerRef,
}: {
  icon: LucideIcon
  label: string
  helper?: string
  onClick: () => void
  disabled?: boolean
  triggerRef?: RefObject<HTMLButtonElement | null>
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-xl border border-dashed border-ink/15 bg-ink/[0.02] px-2.5 py-1.5 text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed opacity-40'
          : 'hover:border-ink/30 hover:bg-ink/[0.05]'
      }`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink/[0.05] text-ink-500">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-[12px] font-medium leading-tight text-ink-300">{label}</span>
        {helper && <span className="text-[10px] leading-tight text-ink-600">{helper}</span>}
      </div>
    </button>
  )
}
