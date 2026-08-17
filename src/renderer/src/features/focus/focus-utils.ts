import type { FocusSnapshot, ThreadSnapshot } from '../../../../shared/contracts'

export function isVisibleFocus(focus: FocusSnapshot): boolean {
  return focus.status === 'active' || focus.status === 'paused'
}

export function isVisibleThread(thread: ThreadSnapshot): boolean {
  return thread.status === 'active' || thread.status === 'paused'
}
