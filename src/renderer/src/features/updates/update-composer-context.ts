import { createContext, useContext } from 'react'
import type { UpdateCommandTarget } from '@/features/updates/update-command-presenters'

export interface UpdateComposerControl {
  open: () => void
  openFor: (target: UpdateCommandTarget) => void
}

export const UpdateComposerContext = createContext<UpdateComposerControl | null>(null)

export function useUpdateComposer(): UpdateComposerControl {
  const control = useContext(UpdateComposerContext)
  if (!control) throw new Error('Update composition requires an UpdateComposerProvider.')
  return control
}
