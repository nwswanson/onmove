import type { UpdateSnapshot } from '../../../../shared/contracts'

export interface UpdateCreatedEvent {
  update: UpdateSnapshot
  focusId: number
}

type UpdateCreatedListener = (event: UpdateCreatedEvent) => void

const updateCreatedListeners = new Set<UpdateCreatedListener>()

/** Keeps independently mounted feature models coherent after global composition. */
export function publishUpdateCreated(event: UpdateCreatedEvent): void {
  for (const listener of updateCreatedListeners) listener(event)
}

export function subscribeToUpdateCreated(listener: UpdateCreatedListener): () => void {
  updateCreatedListeners.add(listener)
  return () => updateCreatedListeners.delete(listener)
}
