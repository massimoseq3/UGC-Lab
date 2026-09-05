// Media helpers for announcements: YouTube links and the image the admin
// attaches. Both exist to keep an announcement cheap — a video announcement
// needs no upload at all, and an uploaded picture is squeezed to something a
// Postgres row can carry.

/**
 * The 11-character video id out of any YouTube URL shape we might paste
 * (watch?v=, youtu.be/, /shorts/, /embed/, /live/). Returns null for anything
 * else, which is how the card decides whether it can draw a thumbnail.
 */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url.trim())
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0]
      return /^[\w-]{11}$/.test(id) ? id : null
    }
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com') return null
    const v = u.searchParams.get('v')
    if (v && /^[\w-]{11}$/.test(v)) return v
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** YouTube's own thumbnail for a video id — no upload, no storage, no expiry. */
export function youtubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

/** True for a link we can safely turn into an <a href>. */
export function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const scheme = new URL(url.trim()).protocol
    return scheme === 'https:' || scheme === 'http:'
  } catch {
    return false
  }
}

// The image rides inline in the announcement row as base64, so it has to stay
// small: 1000px wide is plenty for a card that renders at ~520px on a retina
// screen, and JPEG at 0.8 keeps a screenshot readable.
const MAX_IMAGE_WIDTH = 1000
const IMAGE_QUALITY = 0.8
// Base64 inflates by ~4/3, so this is roughly a 260 KB file. Past that the row
// starts to cost every member real bytes on every card open.
const MAX_IMAGE_DATA_CHARS = 360_000

/**
 * Downscales an uploaded image to a data URI small enough to live in the row,
 * stepping the quality down before giving up. Throws a member-readable error
 * when even the last step is too big (a huge PNG screenshot of a screenshot).
 */
export async function prepareAnnouncementImage(file: File): Promise<string> {
  const bitmap = await loadBitmap(file)
  // naturalWidth on the <img> fallback: a detached image's `.width` is its
  // layout width, which is 0 until it's in the document.
  const sourceWidth = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width
  const sourceHeight = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height
  if (!sourceWidth || !sourceHeight) throw new Error('Could not read that image.')
  const scale = Math.min(1, MAX_IMAGE_WIDTH / sourceWidth)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not read that image.')
  // JPEG has no alpha, so a transparent PNG would composite onto black —
  // white matches the card surface far better in both themes.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)

  for (const quality of [IMAGE_QUALITY, 0.65, 0.5]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrl.length <= MAX_IMAGE_DATA_CHARS) return dataUrl
  }
  throw new Error('That image is too large even after compression. Try a smaller crop.')
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      /* Safari refuses some formats here — fall through to the <img> path. */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Could not read that image.'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
