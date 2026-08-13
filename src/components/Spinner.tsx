/**
 * The one "this is working" spinner — a ring, not an icon.
 *
 * Every busy state in the app used lucide's `Loader2` under `animate-spin`,
 * which draws a 288° arc with a 72° gap. Geometrically that arc is centred, but
 * its INK isn't: three quarters of a ring has its visual mass opposite the gap,
 * and rotating it swings that mass around the centre. The eye tracks the mass,
 * not the geometry, so a bare arc reads as wobbling off its axis rather than
 * turning in place — which is exactly how it was reported, on the generate
 * buttons where a spinner sits still beside a label and gets stared at.
 *
 * A full faint ring with one bright quarter fixes it by construction: the
 * complete circle anchors the eye, nothing about the silhouette changes as it
 * turns, and only the highlight travels. Same trick Voiceovers' avatar rings
 * already used; this is that shape extracted so the rest of the app can stop
 * hand-rolling either one.
 *
 * Size and colour come from `className` (`h-4 w-4`, plus a `text-*` if the
 * inherited colour is wrong) — the ring is drawn in `currentColor`, so it takes
 * the colour of whatever button or panel it sits in without being told.
 */
export default function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current/25 border-t-current ${className}`}
    />
  )
}
