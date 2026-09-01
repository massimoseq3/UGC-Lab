import { useRef, useState } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'
import { fileToDataUri } from '../../utils/kie'
import type { BankType } from '../../utils/constants'
import BankPicker from '../BankPicker'
import SlotActionMenu from './SlotActionMenu'
import { MediaAddCard } from './refInputParts'
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

// A single frame slot (start / end), and it is TWO shapes rather than one.
// EMPTY it's the same 40px `MediaAddCard` every other attach-something control
// in the panel wears; FILLED it opens out to a 2:1 tile showing the frame. An
// empty slot needs room for one word and a filled one needs room for the
// picture, and the single 2:1 shape paid the picture's price either way: 124px
// of dashed box holding a 28px icon, twice over, directly above the prompt box
// the whole panel exists to fill. With nothing attached — the normal state —
// that was the biggest block in the References card by some way.
// The frame inside is `object-contain`, so the 2:1 only sets how tall a FILLED
// slot is; a 9:16 UGC still letterboxes either way. Upload or pick from a bank;
// whole-panel drag-and-drop is wired by the parent straight into the value.
// The "Optional" tag that used to ride in the empty corner is gone: the
// References card header now says it once for every slot inside it, rather than
// four times over in four different registers.
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
      <div className="group relative aspect-[2/1] w-full overflow-hidden rounded-2xl border border-ink/10 bg-black/30">
        <img src={value.dataUri} alt="" className="h-full w-full object-contain" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1 pt-5">
          <span className="text-[11px] font-medium text-white">{label}</span>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          title={`Remove ${label.toLowerCase()}`}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100 touch:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  // Stretched by the grid when its sibling is filled, so a lone attached frame
  // sits beside a full-height drop target rather than a 40px card pinned to the
  // top of an 84px gap. `MediaAddCard` centres its own content either way.
  return (
    <>
      <MediaAddCard
        icon={ImageIcon}
        label={label}
        helper={disabled ? disabledNote : undefined}
        disabled={disabled}
        triggerRef={triggerRef}
        onClick={() => setActionMenu((v) => !v)}
      />

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
