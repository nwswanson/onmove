import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { StateLabel } from '@/components/ui/state-label'
import { SensitivityToggle } from '@/features/shared/sensitivity-toggle'
import type { UpdateListStateOptionModel } from '@/features/updates/update-list-contract'
import { cn } from '@/lib/utils'
import { EntityReference, type EntityReferenceModel } from '@/components/ui/entity-reference'

export interface UpdateMetadataValue {
  date: string
  state: string
  sensitive: boolean
}

interface UpdateMetadataBarProps {
  idPrefix: string
  value: UpdateMetadataValue
  stateOptions: readonly UpdateListStateOptionModel[]
  onValueChange: (changes: Partial<UpdateMetadataValue>) => void
  contextLabel?: string
  reference?: EntityReferenceModel
  disabled?: boolean
  sensitivityDisabled?: boolean
  actions?: ReactNode
  className?: string
}

/**
 * Receiver-owned metadata controls shared by inline and detached Update
 * editors. Callers supply values and mutations, never their own field markup.
 */
export function UpdateMetadataBar({
  idPrefix,
  value,
  stateOptions,
  onValueChange,
  contextLabel,
  reference,
  disabled = false,
  sensitivityDisabled = disabled,
  actions,
  className
}: UpdateMetadataBarProps): React.JSX.Element {
  const selectedState =
    stateOptions.find((option) => option.value === value.state) ?? stateOptions.at(-1)

  return (
    <div className={cn(
      'flex flex-wrap items-end gap-3 border-b border-border/65 bg-muted/20 p-3',
      className
    )}>
      {reference ? <EntityReference {...reference} className="self-center" /> : null}
      {contextLabel ? (
        <span className="self-center rounded-full border border-primary/45 bg-primary/15 px-2 py-1 text-[0.6875rem] font-semibold">
          {contextLabel}
        </span>
      ) : null}
      <label className="flex min-w-0 flex-[1_1_9rem] flex-col gap-1 sm:max-w-48">
        <span className="text-[0.6875rem] font-medium text-muted-foreground">Date</span>
        <Input
          id={`${idPrefix}-date`}
          type="date"
          aria-label="Update date"
          value={value.date}
          disabled={disabled}
          onChange={(event) => onValueChange({ date: event.target.value })}
        />
      </label>

      <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1">
        <label
          htmlFor={`${idPrefix}-state`}
          className="text-[0.6875rem] font-medium text-muted-foreground"
        >
          State
        </label>
        <div className="flex min-w-0 items-center gap-2">
          <select
            id={`${idPrefix}-state`}
            aria-label="Update state"
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background/75 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50"
            value={value.state}
            disabled={disabled}
            onChange={(event) => onValueChange({ state: event.target.value })}
          >
            {stateOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {selectedState ? <StateLabel model={selectedState} /> : null}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center justify-end gap-1 self-center">
        <SensitivityToggle
          checked={value.sensitive}
          disabled={sensitivityDisabled}
          onCheckedChange={(sensitive) => onValueChange({ sensitive })}
        />
        {actions}
      </div>
    </div>
  )
}
