// The centred day separator every history surface uses ("Today" / "Yesterday" /
// "April 5, 2026", plus in-flight labels like "In progress"). It had drifted
// into four byte-identical local copies — keep the one here so the pills across
// Characters, Playground, B-Roll and Scripts stay a matched set.
//
// `className` owns the vertical spacing only, so a caller whose list already
// spaces its groups (a `gap-*` column) can pass "" and skip the margin.
export default function DayPill({
  label,
  className = 'my-2',
}: {
  label: string
  className?: string
}) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <span className="rounded-full bg-ink/[0.06] px-3 py-1 text-[11px] font-medium text-ink-300">
        {label}
      </span>
    </div>
  )
}
