// Downscale an uploaded photo to a JPEG data URI.
//
// Two callers, two sizes. The reference library persists to localStorage, so
// each row has to stay in the tens of KB — that's `makeThumbnail`. The DNA
// extraction call sends the photo to a vision model, and a phone photo straight
// off the camera is several MB, which becomes ~33% more again as base64 on the
// wire — that's `makeVisionImage`. Neither buys the model anything: it resamples
// to its own tile size regardless, so the extra megabytes are pure upload time
// counted against the request timeout.

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = url
  })
}

/** Re-encode `file` at `maxPx` on its longest edge. `null` if the canvas work fails. */
async function downscale(file: File, maxPx: number, quality: number): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const longest = Math.max(img.naturalWidth, img.naturalHeight)
    const scale = longest > maxPx ? maxPx / longest : 1
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function makeThumbnail(file: File, maxPx = 224, quality = 0.72): Promise<string> {
  // A thumbnail is a nicety — a row with no picture still carries its DNA.
  return (await downscale(file, maxPx, quality)) ?? ''
}

// 1536px is above what the vision models actually sample from a single image, so
// the forensic detail the DNA prompt asks for (pores, freckles, fine lines) is
// all still there — this only sheds resolution the model was going to throw away.
const VISION_MAX_PX = 1536
const VISION_QUALITY = 0.85

/**
 * The photo as a vision model should receive it. Returns `null` when the browser
 * can't re-encode it, so the caller can fall back to sending the original rather
 * than sending nothing — an image-less vision call doesn't fail, it invents.
 */
export function makeVisionImage(file: File): Promise<string | null> {
  return downscale(file, VISION_MAX_PX, VISION_QUALITY)
}
