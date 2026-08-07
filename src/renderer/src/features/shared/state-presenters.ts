import type { HealthState } from '../../../../shared/contracts'
import type { StateLabelModel } from '@/components/ui/state-label'

/** Translate domain state into the state-label receiver's presentation contract. */
export function healthStateLabel(state: HealthState): StateLabelModel {
  switch (state) {
    case 'red':
      return { label: 'Red', tone: 'danger' }
    case 'yellow':
      return { label: 'Yellow', tone: 'warning' }
    case 'green':
      return { label: 'Green', tone: 'success' }
    case 'none':
      return { label: 'None', tone: 'neutral' }
  }
}
