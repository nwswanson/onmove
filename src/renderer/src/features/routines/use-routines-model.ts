import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AttestRoutineRunItemInput,
  CommitmentParent,
  FocusSnapshot,
  RoutineSnapshot,
  ThreadSnapshot
} from '../../../../shared/contracts'

export interface RoutineParentOption {
  key: string
  parent: CommitmentParent
  focusId: number
  label: string
  focus: FocusSnapshot
  thread: ThreadSnapshot | null
  scope: { id: number; name: string } | null
}

export interface RoutinesModel {
  routines: RoutineSnapshot[]
  parents: RoutineParentOption[]
  loading: boolean
  saving: boolean
  error: string | null
  attest: (attestationId: number, input: AttestRoutineRunItemInput) => Promise<RoutineSnapshot | null>
  parentFor: (routine: RoutineSnapshot) => RoutineParentOption | null
}

function parentKey(parent: CommitmentParent): string {
  return `${parent.type}:${parent.id}`
}

export function useRoutinesModel(): RoutinesModel {
  const [routines, setRoutines] = useState<RoutineSnapshot[]>([])
  const [parents, setParents] = useState<RoutineParentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load(): Promise<void> {
      try {
        const [nextRoutines, focuses] = await Promise.all([
          window.onmove.domain.listRoutines(),
          window.onmove.domain.listFocuses()
        ])
        const focusGroups = await Promise.all(focuses.map(async (focus) => {
          const [threads, focusScope] = await Promise.all([
            window.onmove.domain.listThreads(focus.id),
            window.onmove.domain.getFocusScope(focus.id)
          ])
          const threadScopes = await Promise.all(threads.map((thread) =>
            window.onmove.domain.getThreadScope(thread.id)
          ))
          const focusOption: RoutineParentOption = {
            key: `focus:${focus.id}`,
            parent: { type: 'focus', id: focus.id },
            focusId: focus.id,
            label: focus.title,
            focus,
            thread: null,
            scope: focusScope.scopeId === null
              ? null
              : { id: focusScope.scopeId, name: 'Focus scope' }
          }
          return [focusOption, ...threads.map((thread, index): RoutineParentOption => ({
            key: `thread:${thread.id}`,
            parent: { type: 'thread', id: thread.id },
            focusId: focus.id,
            label: `${focus.title} / ${thread.title}`,
            focus,
            thread,
            scope: threadScopes[index].scopeId === null
              ? null
              : {
                  id: threadScopes[index].scopeId as number,
                  name: threadScopes[index].mode === 'inherited'
                    ? 'Inherited scope'
                    : 'Thread scope'
                }
          }))]
        }))
        if (!active) return
        setRoutines(nextRoutines)
        setParents(focusGroups.flat())
        setError(null)
      } catch {
        if (active) setError('Routines could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const parentMap = useMemo(
    () => new Map(parents.map((parent) => [parent.key, parent])),
    [parents]
  )
  const parentFor = useCallback(
    (routine: RoutineSnapshot) => parentMap.get(parentKey(routine.parent)) ?? null,
    [parentMap]
  )

  function replace(next: RoutineSnapshot): void {
    setRoutines((current) => current
      .map((routine) => routine.id === next.id ? next : routine)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id))
  }

  async function attest(
    attestationId: number,
    input: AttestRoutineRunItemInput
  ): Promise<RoutineSnapshot | null> {
    setSaving(true)
    setError(null)
    try {
      const updated = await window.onmove.domain.attestRoutineCellItem(attestationId, input)
      replace(updated)
      return updated
    } catch {
      setError('The attestation could not be saved.')
      return null
    } finally {
      setSaving(false)
    }
  }

  return {
    routines,
    parents,
    loading,
    saving,
    error,
    attest,
    parentFor
  }
}
