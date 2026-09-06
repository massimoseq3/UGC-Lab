/**
 * The red dot + NEW on a row this member has not opened yet.
 *
 * One definition, worn by every unseen row in the What's New list — a video
 * and an unread announcement wear the same mark, because from the member's
 * side they are the same news. It carries NO margin of its own: it sits inline
 * on the row's meta line beside the date, so spacing belongs to that row.
 * What counts as unseen lives in `stores/videoLogStore`.
 */
export default function NewBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.08em] text-red-400 light:text-red-600 ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />
      New
    </span>
  )
}
