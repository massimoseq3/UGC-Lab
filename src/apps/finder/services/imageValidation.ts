export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024

// One phrasing of the accepted set, so the `accept` attribute, the drop
// overlay and the rejection toast can't drift apart.
export const ACCEPTED_IMAGE_LABEL = 'JPG, PNG, or WebP'
export const IMAGE_ACCEPT_ATTR = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'

// The format as the member would name it — "AVIF", "HEIC", "SVG". Read from the
// mime type first and the extension second, because a browser that doesn't know
// a format at all reports an EMPTY type for it, which is exactly the case where
// naming it matters most (macOS photos are HEIC; anything saved off a modern
// site is AVIF).
function formatLabel(file: File): string | null {
  const fromType = file.type.startsWith('image/') ? file.type.slice('image/'.length).split('+')[0] : ''
  const fromName = /\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? ''
  const token = (fromType || fromName).trim().toUpperCase()
  return token || null
}

/**
 * Why this file can't be used, as a complete sentence — or null when it can.
 *
 * The format is named out loud on purpose: "unsupported file" next to a photo
 * that opens fine everywhere else in the OS reads as a bug in us, and the member
 * has no way to guess that re-saving it as a JPG is the fix.
 */
export function imageRejectionReason(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    const label = formatLabel(file)
    return label
      ? `${label} isn't a supported image format — use ${ACCEPTED_IMAGE_LABEL}.`
      : `That file isn't an image we can read — use ${ACCEPTED_IMAGE_LABEL}.`
  }
  if (file.size > MAX_IMAGE_SIZE) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return `That image is ${mb} MB — the limit is ${MAX_IMAGE_SIZE / 1024 / 1024} MB.`
  }
  return null
}

/**
 * The same verdict over a batch. Returns the files worth keeping plus one
 * sentence covering everything that fell out — the shared reason when they all
 * failed the same way, a count when they didn't.
 */
export function partitionImageFiles(files: File[]): { accepted: File[]; rejection: string | null } {
  const accepted: File[] = []
  const reasons: string[] = []
  for (const file of files) {
    const reason = imageRejectionReason(file)
    if (reason) reasons.push(reason)
    else accepted.push(file)
  }
  if (reasons.length === 0) return { accepted, rejection: null }
  const allSame = reasons.every((r) => r === reasons[0])
  if (reasons.length === 1 || allSame) {
    return { accepted, rejection: reasons.length === 1 ? reasons[0] : `Skipped ${reasons.length} files — ${reasons[0][0].toLowerCase()}${reasons[0].slice(1)}` }
  }
  return { accepted, rejection: `Skipped ${reasons.length} files — use ${ACCEPTED_IMAGE_LABEL} under ${MAX_IMAGE_SIZE / 1024 / 1024} MB.` }
}
