import { createContext, useContext } from 'react'

export interface UpdateComposerControl {
  open: () => void
}

export const UpdateComposerContext = createContext<UpdateComposerControl | null>(null)

export function useUpdateComposer(): UpdateComposerControl {
  const control = useContext(UpdateComposerContext)
  if (!control) throw new Error('Update composition requires an UpdateComposerProvider.')
  return control
}
