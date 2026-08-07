import { useRef, useState } from 'react'
import { fileToDataUri } from '../../utils/kie'
import type { BankType } from '../../utils/constants'
import BankPicker from '../BankPicker'
import SlotActionMenu from './SlotActionMenu'
import { RefGroup, ImageTile, AddTile } from './refInputParts'
import { bankItemToDataUri, type BankItem } from './bankImage'
import type { VideoInputValue } from './VideoInputSlot'

interface RefTilesProps {
  label: string
  values: VideoInputValue[]
  onChange: (next: VideoInputValue[]) => void
  max: number
  bankType?: BankType
  tabs?: Array<BankType | { type: BankType; filter?: (item: BankItem) => boolean }>
}

// Reference-image slot rendered as a labelled grid of thumbnail tiles plus a
// dashed add tile — so the attached images are visible at a glance instead of
// hidden behind a "0/9" pill. A half-width media card with a 28px thumbnail was
// tried here and reverted: on a reference image the PICTURE is the point, and
// shrinking it to a chip beside a filename made the one thing you check ("did I
// attach the right photo?") the smallest thing on the row. Omni's characters
// keep the card shape, because there the name is what identifies the row.
export default function RefTiles({ label, values, onChange, max, bankType, tabs }: RefTilesProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [actionMenu, setActionMenu] = useState(false)

  const remaining = max - values.length

  async function handleFiles(files: FileList | null) {
    if (!files) return
    const additions: VideoInputValue[] = []
    for (const file of Array.from(files).slice(0, remaining)) {
      if (!file.type.startsWith('image/')) continue
      additions.push({ dataUri: await fileToDataUri(file) })
    }
    if (additions.length) onChange([...values, ...additions])
  }

  async function handleBankPickMany(items: unknown[]) {
    const additions: VideoInputValue[] = []
    for (const item of (items as BankItem[]).slice(0, remaining)) {
      const dataUri = await bankItemToDataUri(item)
      if (dataUri) additions.push({ dataUri })
    }
    if (additions.length) onChange([...values, ...additions])
  }

  return (
    <RefGroup label={label} count={values.length} max={max}>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <ImageTile key={i} src={v.dataUri} onRemove={() => onChange(values.filter((_, idx) => idx !== i))} />
        ))}
        {remaining > 0 && (
          <AddTile triggerRef={triggerRef} onClick={() => setActionMenu((v) => !v)} />
        )}
      </div>

      {remaining > 0 && (
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
        multiple
        className="hidden"
        onChange={(e) => { void handleFiles(e.target.files); e.target.value = '' }}
      />

      <BankPicker
        bankType={bankType ?? 'brolls'}
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={() => { /* unused in multi-select mode */ }}
        multiSelect
        onSelectMany={handleBankPickMany}
        filter={tabs ? undefined : (item) => !!(item as { imageUrl?: string }).imageUrl}
        tabs={tabs}
        expandProductImages
      />
    </RefGroup>
  )
}
