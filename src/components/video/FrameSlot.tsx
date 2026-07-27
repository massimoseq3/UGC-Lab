import { useRef, useState } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'
import { fileToDataUri } from '../../utils/kie'
import type { BankType } from '../../utils/constants'
import BankPicker from '../BankPicker'
import SlotActionMenu from './SlotActionMenu'
import { bankItemToDataUri, type BankItem } from './bankImage'
import type { VideoInputValue } from './VideoInputSlot'

interface FrameSlotProps {
  label: string
  value: VideoInputValue | null
  onChange: (next: VideoInputValue | null) => void
  bankType?: BankType
  tabs?: Array<BankType | { type: BankType; filter?: (item: BankItem) => boolean }>
  // Dimmed, non-interactive with a reason caption (e.g. an End frame on a model
  // with no frames-to-video mode). The slot stays visible so the user sees the
  // model can't take it, matching the old pill's behaviour.
  disabled?: boolean
  disabledNote?: string
}

// A 16:9 drop-zone for a single frame (start / end). Empty it's a labelled
// dashed tile with an "Optional" tag; filled it shows the frame with a remove
// button. Upload or pick from a bank; whole-panel drag-and-drop is wired by the
// parent straight into the value. Kept deliberately short — the two slots sit
// directly above the prompt box and every pixel here is a pixel it loses.
export default function FrameSlot({
  label,
  value,
  onChange,
  bankType,
  tabs,
  disabled = false,
  disabledNote,
}: FrameSlotProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [actionMenu, setActionMenu] = useState(false)

  async function handleFile(file: File | null) {
    if (!file) return
    onChange({ dataUri: await fileToDataUri(file) })
  }

  async function handleBankPick(item: unknown) {
    const dataUri = await bankItemToDataUri(item as BankItem)
    if (dataUri) onChange({ dataUri })
  }

  if (value) {
    return (
      <div className="group relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-ink/10 bg-black/30">
        <img src={value.dataUri} alt="" className="h-full w-full object-contain" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1 pt-5">
          <span className="text-[11px] font-medium text-white">{label}</span>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          title={`Remove ${label.toLowerCase()}`}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setActionMenu((v) => !v)}
        className={`group relative flex aspect-[16/9] w-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-ink/15 bg-ink/[0.02] transition-colors ${
          disabled
            ? 'cursor-not-allowed opacity-40'
            : 'hover:border-ink/30 hover:bg-ink/[0.04]'
        }`}
      >
        {!disabled && (
          <span className="absolute right-2 top-2 rounded-full bg-ink/[0.06] px-1.5 py-0.5 text-[9px] text-ink-500">
            Optional
          </span>
        )}
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/[0.05] text-ink-400 transition-colors group-hover:text-ink-200">
          <ImageIcon className="h-3.5 w-3.5" />
        </span>
        <span className="text-[11px] font-medium text-ink-400 transition-colors group-hover:text-ink-200">
          {label}
        </span>
        {disabled && disabledNote && (
          <span className="text-[10px] text-ink-600">{disabledNote}</span>
        )}
      </button>

      {!disabled && (
        <SlotActionMenu
          anchorRef={triggerRef}
          open={actionMenu}
          onClose={() => setActionMenu(false)}
          onUpload={() => fileInputRef.current?.click()}
          onPickFromBank={() => setPickerOpen(true)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { void handleFile(e.target.files?.[0] ?? null); e.target.value = '' }}
      />

      <BankPicker
        bankType={bankType ?? 'brolls'}
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleBankPick}
        filter={tabs ? undefined : (item) => !!(item as { imageUrl?: string }).imageUrl}
        tabs={tabs}
        expandProductImages
      />
    </>
  )
}
