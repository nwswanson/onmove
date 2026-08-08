import type * as React from 'react'
import {
  LifecycleStatusSelect,
  type LifecycleStatusSelectProps
} from '@/components/ui/lifecycle-status'
import {
  WORK_STATUS_OPTIONS,
  type WorkStatus
} from '@/features/shared/work-status'

export interface WorkStatusSelectProps
  extends Omit<LifecycleStatusSelectProps, 'value' | 'options' | 'onValueChange'> {
  value: WorkStatus
  onValueChange: (status: WorkStatus) => void
}

/** Domain-aware lifecycle selector shared by Focus, Thread, and Commitment screens. */
export function WorkStatusSelect({
  value,
  onValueChange,
  ...props
}: WorkStatusSelectProps): React.JSX.Element {
  return (
    <LifecycleStatusSelect
      {...props}
      value={value}
      options={WORK_STATUS_OPTIONS}
      onValueChange={(status) => onValueChange(status as WorkStatus)}
    />
  )
}
