import { useEffect, useMemo, useState } from 'react'
import type {
  AttestRoutineRunItemInput,
  CommitmentParent,
  CreateRoutineInput,
  FocusSnapshot,
  RoutineSnapshot,
  ThreadSnapshot,
  UpdateRoutineInput
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
  create: (input: CreateRoutineInput) => Promise<boolean>
  update: (id: number, input: UpdateRoutineInput) => Promise<boolean>
  remove: (id: number) => Promise<boolean>
  attest: (runItemId: number, input: AttestRoutineRunItemInput) => Promise<boolean>
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

  function replace(next: RoutineSnapshot): void {
    setRoutines((current) => current
      .map((routine) => routine.id === next.id ? next : routine)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id))
  }

  async function create(input: CreateRoutineInput): Promise<boolean> {
    setSaving(true)
    setError(null)
    try {
      const created = await window.onmove.domain.createRoutine(input)
      setRoutines((current) => [...current, created]
        .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id))
      return true
    } catch {
      setError('The Routine could not be created.')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function update(id: number, input: UpdateRoutineInput): Promise<boolean> {
    setSaving(true)
    setError(null)
    try {
      replace(await window.onmove.domain.updateRoutine(id, input))
      return true
    } catch {
      setError('The Routine could not be updated.')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number): Promise<boolean> {
    setSaving(true)
    setError(null)
    try {
      const removed = await window.onmove.domain.deleteRoutine(id)
      if (removed) setRoutines((current) => current.filter((routine) => routine.id !== id))
      return removed
    } catch {
      setError('The Routine could not be deleted.')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function attest(
    runItemId: number,
    input: AttestRoutineRunItemInput
  ): Promise<boolean> {
    setSaving(true)
    setError(null)
    try {
      replace(await window.onmove.domain.attestRoutineRunItem(runItemId, input))
      return true
    } catch {
      setError('The attestation could not be saved.')
      return false
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
    create,
    update,
    remove,
    attest,
    parentFor: (routine) => parentMap.get(parentKey(routine.parent)) ?? null
  }
}
