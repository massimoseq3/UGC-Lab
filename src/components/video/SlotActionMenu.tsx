import { type RefObject } from 'react'
import { Upload, Bookmark } from 'lucide-react'
import AnchoredPopover from './AnchoredPopover'
import { MenuSurface, MenuItem, MENU_ROW_HEIGHT } from '../Menu'

interface SlotActionMenuProps {
  // Anchor element — usually the pill / tile that triggers the menu.
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  onUpload: () => void
  onPickFromBank: () => void
}

// Upload / Pick-from-Bank menu that pops out of an image slot. The shape every
// other menu in the app now follows — see `components/Menu.tsx`.
export default function SlotActionMenu({ anchorRef, open, onClose, onUpload, onPickFromBank }: SlotActionMenuProps) {
  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      width={208}
      estimatedHeight={MENU_ROW_HEIGHT * 2 + 2}
    >
      <MenuSurface className="whitespace-nowrap">
        <MenuItem icon={Upload} onClick={() => { onClose(); onUpload() }}>
          Upload image
        </MenuItem>
        <MenuItem icon={Bookmark} onClick={() => { onClose(); onPickFromBank() }}>
          Pick from Bank
        </MenuItem>
      </MenuSurface>
    </AnchoredPopover>
  )
}
