// Downscale an uploaded photo to a JPEG data URI.
//
// Two callers, two sizes. The reference library persists to localStorage, so
// each row has to stay in the tens of KB — that's `makeThumbnail`. The DNA
// extraction call sends the photo to a vision model, and a phone photo straight
// off the camera is several MB, which becomes ~33% more again as base64 on the
// wire — that's `makeVisionImage`. Neither buys the model anything: it resamples
// to its own tile size regardless, so the extra megabytes are pure upload time
// counted against the request timeout.
//
// The canvas work itself lives in `utils/visionImage.ts` — the Bank's product
// auto-fill needed the same thing, and a second copy of it is how the two drift.
import { downscaleFileForVision } from '../../../utils/visionImage'

export async function makeThumbnail(file: File, maxPx = 224, quality = 0.72): Promise<string> {
  // A thumbnail is a nicety — a row with no picture still carries its DNA.
  return (await downscaleFileForVision(file, maxPx, quality)) ?? ''
}

/**
 * The photo as a vision model should receive it. Returns `null` when the browser
 * can't re-encode it, so the caller can fall back to sending the original rather
 * than sending nothing — an image-less vision call doesn't fail, it invents.
 */
export function makeVisionImage(file: File): Promise<string | null> {
  return downscaleFileForVision(file)
}
