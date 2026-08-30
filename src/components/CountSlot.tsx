/**
 * A facet count in a fixed-width slot.
 *
 * These counts are live — they re-tally against whatever else is filtered — so
 * a segment reading "All 81" becomes "All 9" on the next click. Left to size
 * itself, that digit takes ~5px with it and every segment to its right slides,
 * which is what made the Characters preset picker's filter row feel like it
 * moved under the pointer. Two digits' worth of room is reserved always (the
 * template library is 81 rows; a three-digit one would want another `ch`), and
 * `tabular-nums` keeps 11 the same width as 76 so nothing shifts between two
 * numbers of the same length either.
 */
export default function CountSlot({ value }: { value: number }) {
  return <span className="inline-block min-w-[2ch] text-center tabular-nums">{value}</span>
}
