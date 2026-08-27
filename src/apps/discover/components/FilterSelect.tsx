import Dropdown from '../../../components/Dropdown'

/**
 * A compact labelled select for the filter row.
 *
 * Wraps the app's own `Dropdown` rather than a native `<select>`: the browser's
 * stock popup is the one piece of unstyled OS chrome left in the app, and it
 * ignores the theme entirely (a white system menu over the dark workspace).
 *
 * Its own file because both of Outliers' modes have a filter row — the paid
 * search and the Outlier Vault — and the two have to look like one control set
 * across a tab flip, not two that drifted.
 */
export default function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  menuMinWidth,
  dense = false,
  className,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string; count?: number }>
  onChange: (value: T) => void
  /** For a list whose option labels run past the trigger — see Dropdown. */
  menuMinWidth?: number
  /** 36px, to sit level with a `dense` SegmentedToggle on the same row. */
  dense?: boolean
  /** Sizing for a row that has to fit on one line — the vault's phone layout
   *  gives its two selects `max-md:flex-auto`, so they share the shortfall by
   *  truncating instead of one of them wrapping onto a third line. */
  className?: string
}) {
  return (
    <Dropdown
      compact
      dense={dense}
      fitContent
      className={className}
      // No app accent: this row is chrome above the grid, sitting under a
      // monochrome search field and Search button.
      accent="neutral"
      label={label}
      menuMinWidth={menuMinWidth}
      value={value}
      options={options}
      onChange={(v) => onChange(v as T)}
    />
  )
}
