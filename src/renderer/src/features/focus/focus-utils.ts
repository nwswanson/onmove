import type { FocusSnapshot } from '../../../../shared/contracts'

export function isVisibleFocus(focus: FocusSnapshot): boolean {
  return focus.status === 'active' || focus.status === 'paused'
}
