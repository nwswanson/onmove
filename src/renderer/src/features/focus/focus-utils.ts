import type { FocusSnapshot, ThreadSnapshot } from '../../../../shared/contracts'

export function isCurrentWorkStatus(status: FocusSnapshot['status']): boolean {
  return status === 'active' || status === 'paused'
}

export function isVisibleFocus(focus: FocusSnapshot): boolean {
  return isCurrentWorkStatus(focus.status)
}

export function isVisibleThread(thread: ThreadSnapshot): boolean {
  return isCurrentWorkStatus(thread.status)
}
