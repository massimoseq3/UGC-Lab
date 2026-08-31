// Downscaling a photo before it is sent to a vision model.
//
// Every vision call in this app carries its images INLINE as base64 data URIs,
// and base64 inflates by ~4/3 — so a phone photo or an 8000px product render
// off a brand site becomes a several-megabyte string sitting in the request
// body. None of those megabytes buy the model anything: it resamples to its own
// tile size regardless. What they do buy is upload time, counted against the
// request timeout, on a call that is already slow because it reasons hard.
//
// Characters has downscaled its DNA-extraction photo since it shipped; the
// Bank's product auto-fill did not, which is the difference between a photo
// that reads fine and one that "just never extracts". This is that helper,
// promoted out of `character-studio/utils/thumbnail.ts` once a second app
// needed it.
//
// THIS IS THE WIRE COPY, NEVER THE SAVED ONE. What every caller here does with
// the result is put it in a request body and throw it away. The photo that goes
// into the bank is the ORIGINAL file, byte for byte — a product shot is a
// reference image that gets attached to real image and video generations, so it
// has to stay at full quality, and the model's copy has nothing to do with it.
// If a future caller ever wants to persist what comes back from here, that is a
// different helper with a different name.

// Above what the vision models sample from a single image, so the label text
// the product read has to transcribe is all still there — this only sheds
// resolution that was going to be thrown away.
export const VISION_MAX_PX = 1536
export const VISION_QUALITY = 0.85

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = url
  })
}

/**
 * Re-encode whatever `src` points at (a data URI, a blob: URL, an object URL)
 * as a JPEG data URI no larger than `maxPx` on its longest edge.
 *
 * Returns `null` rather than throwing when the browser can't do it — a
 * cross-origin URL taints the canvas, and Safari refuses some formats outright.
 * Every caller has the original to fall back on, and an image-less vision call
 * doesn't fail, it invents.
 */
export async function downscaleForVision(
  src: string,
  maxPx: number = VISION_MAX_PX,
  quality: number = VISION_QUALITY,
): Promise<string | null> {
  try {
    const img = await loadImage(src)
    const longest = Math.max(img.naturalWidth, img.naturalHeight)
    if (!longest) return null
    const scale = longest > maxPx ? maxPx / longest : 1
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // JPEG has no alpha, so a transparent PNG (every packshot cut out on a
    // white background) would composite onto black and bury the label text.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return null
  }
}

/** The same, from a File. */
export async function downscaleFileForVision(
  file: File,
  maxPx: number = VISION_MAX_PX,
  quality: number = VISION_QUALITY,
): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try {
    return await downscaleForVision(url, maxPx, quality)
  } finally {
    URL.revokeObjectURL(url)
  }
}
