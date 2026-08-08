export interface SensitivityToggleProps {
  checked: boolean
  disabled?: boolean
  label?: string
  onCheckedChange: (checked: boolean) => void
}

/** Feature-level editor for the domain sensitivity flag. */
export function SensitivityToggle({
  checked,
  disabled = false,
  label = 'Sensitive',
  onCheckedChange
}: SensitivityToggleProps): React.JSX.Element {
  return (
    <label className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-background/70 px-2.5 text-xs font-medium text-foreground shadow-xs has-[:focus-visible]:border-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/35 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55">
      <input
        type="checkbox"
        className="size-3.5 accent-primary outline-none"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  )
}
