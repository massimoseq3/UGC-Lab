import { useRef, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import { fileToDataUri } from '../../utils/kie'
import { isAssetRef, getAsBase64 } from '../../utils/assetStore'
import type { AnyBankItem, BRoll } from '../../stores/types'
import type { BankType } from '../../utils/constants'
import BankPicker from '../BankPicker'
import SlotActionMenu from './SlotActionMenu'
import { RefSlotPill, RefChip } from './RefSlot'

type BankItem = AnyBankItem

export interface VideoInputValue {
  dataUri: string
}

interface VideoInputSlotProps {
  label: string
  // Short muted suffix on the pill, e.g. why the slot is disabled.
  helper?: string
  value: VideoInputValue | null
  onChange: (next: VideoInputValue | null) => void
  // When set, the BankPicker opens on this bank instead of the default 'brolls'.
  bankType?: BankType
  // When set, BankPicker renders an inline tab strip so the user can switch
  // between these bank types without closing. See BankPicker for the prop shape.
  tabs?: Array<BankType | { type: BankType; filter?: (item: BankItem) => boolean }>
  // Dimmed, non-interactive (e.g. an End frame on a model that has no
  // frames-to-video mode).
  disabled?: boolean
}

// Each bank type stores its image in a different field. Extract whichever
// one is present so this slot works with brolls / characters / products
// when used in tab-mode.
function bankItemImageField(item: BankItem): string | undefined {
  if ('imageUrl' in item && item.imageUrl) return item.imageUrl as string
  if ('characterImage' in item && item.characterImage) return item.characterImage as string
  if ('productImage' in item && item.productImage) return item.productImage as string
  return undefined
}

async function bankItemToDataUri(item: BankItem): Promise<string | null> {
  const src = bankItemImageField(item)
  if (!src) return null
  if (src.startsWith('data:')) return src
  if (isAssetRef(src)) {
    const asset = await getAsBase64(src)
    if (!asset) return null
    return `data:${asset.mimeType};base64,${asset.base64}`
  }
  return src
}

// Single-image input slot (start / end frame, Motion Control's character). Two
// sources: Upload and Pick from Bank. Empty it's a dashed pill; filled it's a
// chip carrying the picked still. Renders as a fragment so the parent's
// attachment row treats it as one more item in the flow.
export default function VideoInputSlot({ label, helper, value, onChange, bankType, tabs, disabled = false }: VideoInputSlotProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [actionMenu, setActionMenu] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  async function handleFile(file: File | null) {
    if (!file) return
    const dataUri = await fileToDataUri(file)
    onChange({ dataUri })
  }

  async function handleBankPick(item: unknown) {
    const dataUri = await bankItemToDataUri(item as BankItem)
    if (!dataUri) return
    onChange({ dataUri })
  }

  return (
    <>
      {value ? (
        <RefChip thumbnail={value.dataUri} label={label} onRemove={() => onChange(null)} />
      ) : (
        <>
          <RefSlotPill
            triggerRef={triggerRef}
            icon={ImageIcon}
            label={label}
            helper={helper}
            disabled={disabled}
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
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        // Reset after reading: without it, re-picking the same file the user
        // just removed fires no change event and silently does nothing.
        onChange={(e) => { void handleFile(e.target.files?.[0] ?? null); e.target.value = '' }}
      />

      <BankPicker
        bankType={bankType ?? 'brolls'}
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleBankPick}
        // Without tabs we keep the legacy filter (brolls with stills only).
        // With tabs, each tab can supply its own filter and we don't apply
        // a global one because Characters / Products always have an image.
        filter={tabs ? undefined : (item) => !!(item as BRoll).imageUrl}
        tabs={tabs}
        expandProductImages
      />
    </>
  )
}
