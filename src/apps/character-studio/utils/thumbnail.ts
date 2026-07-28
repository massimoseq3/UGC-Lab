// Downscale an uploaded photo to a small JPEG data URI.
//
// The reference library persists to localStorage, so each row has to stay in
// the tens of KB. That is affordable because the full-size original is only
// ever needed for the one vision call that extracts the DNA — nothing in the
// app re-sends the reference photo afterwards, so the stored copy exists purely
// to make the row recognisable.

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = url
  })
}

export async function makeThumbnail(file: File, maxPx = 224, quality = 0.72): Promise<string> {
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
    if (!ctx) return ''
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    // A thumbnail is a nicety — a row with no picture still carries its DNA.
    return ''
  } finally {
    URL.revokeObjectURL(url)
  }
}
