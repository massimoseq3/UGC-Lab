import { useEffect, useRef } from 'react'
import { useThemeStore, type ResolvedTheme } from '../stores/themeStore'

// Safari doesn't dither CSS gradients, so a near-black radial gradient shows
// hard 8-bit banding there no matter what's layered on top. We paint the
// gradient into a canvas ourselves and dither it — but the dither has to happen
// BEFORE the value is quantised to 8 bits, and that is the whole point of this
// file.
//
// The first version filled the canvas with `createRadialGradient` (already
// rounded to whole levels) and then added ±3 levels of random noise on top. Post
// quantisation there is no sub-level information left to dither, so an amplitude
// under one level would have been a no-op — ±3 was the smallest number that
// could still move an already-rounded pixel, and it applied uniformly across the
// whole canvas. That is not dithering, it is grain: over the outer two thirds of
// the gradient the true value barely changes across hundreds of pixels, so there
// was no band to break there and the noise was the only thing varying at all.
// Measured behind the Playground's empty history panel — the largest
// uninterrupted near-black field in the app — the screen carried a random mix of
// FOUR distinct grey levels where the gradient is flat. Reported as a "static
// glitch" in the Playground, and it does not survive a screenshot: independent
// per-pixel noise averages back out the moment the image is resampled, so a 2×
// Retina grab viewed fit-to-window looks perfectly clean while the screen does
// not. That's the same 2×2 averaging noted below, working against us.
//
// So the gradient is evaluated per pixel in FLOAT here and dithered by ±0.5 of a
// level on the way to the byte. That is textbook dither: a pixel whose true
// value sits between two levels lands on either side in proportion, which
// dissolves every band edge into a smooth ramp, while a pixel sitting ON a level
// (a flat region) rounds to that level every time and stays perfectly clean. No
// banding, and no grain anywhere it isn't buying something.
//
// The other catch, which made earlier attempts fail in Safari: on a Retina
// display the canvas backing store was sized in CSS pixels (1×) while the
// element is shown at 2×, so the browser bilinearly upscaled it — averaging
// every 2×2 block and smoothing the dither right back out, which let the bands
// return. Paint at the device pixel ratio so the canvas maps 1:1 to physical
// pixels. Repainted (debounced) on resize / DPR change; cost is a one-time pass.
const GRADIENT_STOPS: Record<ResolvedTheme, [string, string, string]> = {
  dark: ['#1f1f22', '#09090b', '#000000'],
  light: ['#ffffff', '#f6f6f7', '#e9e9eb'],
}

// Stop position of the middle colour — matches the old
// `gradient.addColorStop(0.45, …)`.
const MID_STOP = 0.45

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function paint(canvas: HTMLCanvasElement, theme: ResolvedTheme) {
  const cssW = window.innerWidth
  const cssH = window.innerHeight
  if (cssW === 0 || cssH === 0) return
  // Cap DPR at 2 — beyond that the dither is invisibly fine and the pixel
  // buffer (and the noise loop) gets needlessly large.
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = Math.round(cssW * dpr)
  const h = Math.round(cssH * dpr)
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Same geometry as the old CSS gradient: circle at 0% 0%, farthest-corner.
  // Coordinates are in device pixels, so the gradient scales naturally.
  const radius = Math.hypot(w, h)
  const [c0, c1, c2] = GRADIENT_STOPS[theme].map(toRgb)

  const image = ctx.createImageData(w, h)
  const px = image.data
  let i = 0
  for (let y = 0; y < h; y++) {
    const ySq = y * y
    for (let x = 0; x < w; x++) {
      const t = Math.sqrt(x * x + ySq) / radius
      // Which half of the ramp this pixel is on, and how far along it. Canvas
      // gradients interpolate componentwise in sRGB for opaque colours, so a
      // plain lerp draws the same ramp `createRadialGradient` did — the only
      // difference is that this one hasn't been rounded yet.
      const inner = t < MID_STOP
      const from = inner ? c0 : c1
      const to = inner ? c1 : c2
      const k = inner ? t / MID_STOP : (t - MID_STOP) / (1 - MID_STOP)
      // ONE noise sample shared across the three channels. Independent samples
      // per channel would tint the dither, turning a grey ramp into faint
      // colour speckle.
      const d = Math.random() - 0.5
      // Uint8ClampedArray rounds on assignment — that rounding IS the
      // quantisation the dither above is steering.
      px[i] = from[0] + (to[0] - from[0]) * k + d
      px[i + 1] = from[1] + (to[1] - from[1]) * k + d
      px[i + 2] = from[2] + (to[2] - from[2]) * k + d
      px[i + 3] = 255
      i += 4
    }
  }
  ctx.putImageData(image, 0, 0)
}

/** Shared full-screen workspace background: dithered radial gradient. */
export default function AppBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const theme = useThemeStore((s) => s.resolved)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    paint(canvas, theme)

    let timer: number | undefined
    const repaint = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => paint(canvas, theme), 150)
    }
    window.addEventListener('resize', repaint)
    // Dragging the window between a Retina and non-Retina monitor changes the
    // DPR without firing resize — listen for that too so we re-dither at the
    // new density.
    const dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    dprQuery.addEventListener?.('change', repaint)
    return () => {
      window.removeEventListener('resize', repaint)
      dprQuery.removeEventListener?.('change', repaint)
      window.clearTimeout(timer)
    }
  }, [theme])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 h-full w-full bg-surface-1"
    />
  )
}
