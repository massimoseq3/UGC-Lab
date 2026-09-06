import { Star } from 'lucide-react'
import SavingsPill from './SavingsPill'

/**
 * The name + star + "% off" block inside a collapsed model TRIGGER.
 *
 * Six triggers had hand-rolled the identical three lines (`ModelPicker`'s two
 * variants, Playground's video row, B-Roll's card modal, Continuous' bar and
 * its two detail modals), which is why the fix below had to be made in one
 * place to be made at all.
 *
 * **The pill collapses before the name truncates** (Massimo's call, September
 * 2026). These rows are `min-w-0 flex-1` with a `truncate` name, so the pill —
 * `shrink-0`, as a pill has to be — took its ~52px out of the name's share and
 * "GPT Image 2" rendered as "GPT I…". A row whose one job is naming what's
 * picked must not spend its last 50px on the discount, so the discount goes.
 *
 * It's a CONTAINER query, not a viewport one, and that is the whole point: what
 * squeezes this row is the PANE it sits in — a third of the window in
 * Characters, half a modal in B-Roll — so a `md:` rule would hide the pill on a
 * phone where the trigger is full-width and keep it on a 1400px desktop where
 * the trigger is 210px. It also means the pill comes BACK on its own the moment
 * the trigger gets a full line to itself (see Characters' generate bar, which
 * stacks its chips under the model at narrow widths).
 */
export default function ModelTriggerLabel({
  name,
  recommended = false,
  savings,
  size = 'md',
}: {
  name: string
  recommended?: boolean
  // null / undefined for a model with no verified official rate — no pill.
  savings?: number | null
  // 'sm' is `ModelPicker compact`'s 12px; every other trigger is 13px.
  size?: 'sm' | 'md'
}) {
  return (
    <div className="@container flex min-w-0 flex-1 items-center gap-1.5">
      <span className={`truncate font-medium text-ink-100 ${size === 'sm' ? 'text-[12px]' : 'text-[13px]'}`}>
        {name}
      </span>
      {recommended && (
        <Star className="h-3 w-3 shrink-0 fill-yellow-400 text-yellow-400 light:fill-yellow-600 light:text-yellow-600" strokeWidth={1.5} />
      )}
      {savings != null && <SavingsPill pct={savings} className="hidden @[200px]:inline-block" />}
    </div>
  )
}
