import { isAssetRef, getAsBase64 } from '../../utils/assetStore'
import type { BRoll, Product, Model, Script, VoicePreset } from '../../stores/types'

export type BankItem = Product | Model | Script | VoicePreset | BRoll

// Each bank type stores its image in a different field. Extract whichever one
// is present so a slot can accept brolls / characters / products in tab-mode.
export function bankItemImageField(item: BankItem): string | undefined {
  if ('imageUrl' in item && item.imageUrl) return item.imageUrl as string
  if ('characterImage' in item && item.characterImage) return item.characterImage as string
  if ('productImage' in item && item.productImage) return item.productImage as string
  return undefined
}

// Resolve a picked bank item's image to a renderable data URI (resolving
// asset:// refs through IndexedDB when needed).
export async function bankItemToDataUri(item: BankItem): Promise<string | null> {
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
