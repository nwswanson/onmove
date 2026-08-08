import type { FocusStatus } from '../../../../shared/contracts'
import type { LifecycleStatusOptionModel } from '@/components/ui/lifecycle-status'

/** Shared lifecycle vocabulary used by Focuses, Threads, and Commitments. */
export type WorkStatus = FocusStatus

export const WORK_STATUS_OPTIONS = [
  { value: 'active', label: 'Active', tone: 'primary' },
  { value: 'paused', label: 'Paused', tone: 'neutral' },
  { value: 'done', label: 'Done', tone: 'success' },
  { value: 'cancelled', label: 'Cancelled', tone: 'danger' }
] as const satisfies readonly LifecycleStatusOptionModel[]

/** Translate the shared domain lifecycle into the generic UI label contract. */
export function workStatusLabel(status: WorkStatus): LifecycleStatusOptionModel {
  const option = WORK_STATUS_OPTIONS.find((candidate) => candidate.value === status)
  if (!option) throw new Error(`Unsupported work status "${status}".`)
  return option
}
