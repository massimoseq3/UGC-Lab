// The green "N% off" chip: how much cheaper kie is than the provider's own
// official API at the model's representative params (see officialSavingsPercent
// — null for models with no verified official rate, which render no pill).
//
// Shared by every surface that names a model — ModelPicker's trigger and rows,
// ModelPickerModal's rows, and the hand-rolled side-panel triggers in B-Roll and
// Playground. It lived as two identical copies before, and the side-panel
// triggers had none at all, so a video model quoted its discount in the open
// panel and dropped it the moment the panel closed.
export default function SavingsPill({ pct, className = '' }: { pct: number; className?: string }) {
  return (
    <span
      title="vs the provider's official API price"
      className={`shrink-0 rounded-full border border-dashboard-500/25 bg-dashboard-500/15 px-1.5 py-px text-[10px] font-medium text-dashboard-300 ${className}`}
    >
      {pct}% off
    </span>
  )
}
