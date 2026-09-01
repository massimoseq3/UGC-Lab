import type { ElementType } from 'react'
import { Package, UserRound, FileText, Mic, Film, Palette, Bookmark } from 'lucide-react'
import type { BankType } from '../../utils/constants'
import type { Product, Model, Script, VoicePreset, BRoll, StylePreset, SwipeItem } from '../../stores/types'

export type BankItem = Product | Model | Script | VoicePreset | BRoll | StylePreset | SwipeItem

/**
 * One bank row, flattened.
 *
 * Every bank draws a different card — a product is a photo, a script is a page
 * of text, a voice is a set of delivery params — and both the list view and the
 * search box have to treat all seven the same way. This is the ONE adapter that
 * says what a row is, so adding a bank means adding a case here rather than a
 * case in the list and a second one in the filter that can drift from it.
 */
export interface BankRow {
  id: string
  title: string
  /** One line under the title — whatever that bank's card already puts there. */
  subtitle: string
  /** What kind of thing this row is, in a word or two (its badge). */
  kind: string
  /** Asset ref for the thumbnail. Absent → the bank's own icon is drawn. */
  thumbRef?: string
  icon: ElementType
  createdAt: number
  starred: boolean
  /** Voices carry no `starred` field, so those rows have no star to press. */
  canStar: boolean
  /**
   * Lowercased search haystack. Deliberately more than the title: what you
   * remember about a script is a line IN it, not what you called it, and what
   * you remember about a b-roll still is what's in the shot.
   */
  search: string
}

const BANK_ICONS: Record<BankType, ElementType> = {
  products: Package,
  models: UserRound,
  scripts: FileText,
  voices: Mic,
  brolls: Film,
  styles: Palette,
  swipes: Bookmark,
}

/** Collapse a multi-line field to the single line a row can show. */
function oneLine(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function haystack(parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ').toLowerCase()
}

export function describeRow(bankType: BankType, item: BankItem): BankRow {
  const icon = BANK_ICONS[bankType]
  const base = { icon, createdAt: item.createdAt, starred: false, canStar: true }

  switch (bankType) {
    case 'products': {
      const p = item as Product
      const photos = 1 + (p.extraImages?.length ?? 0)
      return {
        ...base,
        id: p.id,
        title: p.productName || 'Untitled product',
        subtitle: oneLine(p.productDescription),
        // The orange dot on the card, said in a word. Photo count is what the
        // card's second line carries once a product is confirmed.
        kind: p.confirmed === false ? 'Draft' : photos > 1 ? `${photos} photos` : 'Product',
        thumbRef: p.productImage || undefined,
        starred: !!p.starred,
        search: haystack([p.productName, p.productDescription, p.targetMarket, p.uniqueMechanism, p.usps]),
      }
    }
    case 'models': {
      const m = item as Model
      return {
        ...base,
        id: m.id,
        title: m.name || 'Untitled character',
        subtitle: oneLine(m.notes),
        kind: m.sheetImage ? 'Sheet' : m.characterImage ? 'Character' : 'Preset',
        thumbRef: m.characterImage || m.sheetImage || undefined,
        starred: !!m.starred,
        search: haystack([m.name, m.notes]),
      }
    }
    case 'scripts': {
      const s = item as Script
      return {
        ...base,
        id: s.id,
        title: s.title || 'Untitled script',
        subtitle: oneLine(s.scriptText) || 'Empty script',
        kind: s.kind === 'reverse-engineer' ? 'Scenes' : s.kind === 'style' ? 'Style' : 'Script',
        starred: !!s.starred,
        search: haystack([s.title, s.scriptText]),
      }
    }
    case 'voices': {
      const v = item as VoicePreset
      return {
        ...base,
        id: v.id,
        title: v.label || v.voiceName,
        subtitle: `${v.style} · ${v.pace} · ${v.accent}`,
        kind: v.voiceName,
        starred: false,
        canStar: false,
        search: haystack([v.label, v.voiceName, v.gender, v.style, v.pace, v.accent, v.scene]),
      }
    }
    case 'brolls': {
      const b = item as BRoll
      const videos = b.videos?.length ?? (b.videoUrl ? 1 : 0)
      return {
        ...base,
        id: b.id,
        title: oneLine(b.prompt) || 'Untitled shot',
        subtitle: '',
        kind: videos > 0 ? `${videos} video${videos === 1 ? '' : 's'}` : 'Still',
        thumbRef: b.imageUrl || undefined,
        starred: !!b.starred,
        search: haystack([b.prompt]),
      }
    }
    case 'styles': {
      const s = item as StylePreset
      return {
        ...base,
        id: s.id,
        title: s.name || 'Untitled style',
        subtitle: oneLine(s.brief),
        kind: 'Visual style',
        thumbRef: s.thumbRefs?.[0],
        starred: !!s.starred,
        search: haystack([s.name, s.brief]),
      }
    }
    case 'swipes': {
      const s = item as SwipeItem
      return {
        ...base,
        id: s.id,
        title: s.authorName || s.authorHandle || 'Saved ad',
        subtitle: oneLine(s.caption),
        kind: s.platform === 'tiktok' ? 'TikTok' : 'Meta',
        thumbRef: s.thumbRef,
        starred: !!s.starred,
        search: haystack([s.authorName, s.authorHandle, s.caption, s.transcript, s.tag]),
      }
    }
  }
}

/**
 * Every whitespace-separated word has to appear somewhere in the row, in any
 * order — so "glow serum" finds the product whether the row calls it "Glow Lab
 * vitamin C serum" or "serum, Glow Lab". A bare substring match finds neither.
 */
export function matchesQuery(row: BankRow, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  return terms.every((t) => row.search.includes(t))
}

/** Filter a bank's items by the search box. Empty query passes everything through. */
export function filterByQuery<T extends BankItem>(items: T[], bankType: BankType, query: string): T[] {
  if (!query.trim()) return items
  return items.filter((item) => matchesQuery(describeRow(bankType, item), query))
}
