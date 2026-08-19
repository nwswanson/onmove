import { useEffect, useState } from 'react'
import type {
  TodoOverviewItemSnapshot,
  TodoOverviewSnapshot
} from '../../../../shared/contracts'

export interface TodoOverviewModel {
  snapshot: TodoOverviewSnapshot | null
  loading: boolean
  error: string | null
  pendingTodoIds: ReadonlySet<number>
  setDone: (todoId: number, done: boolean) => Promise<void>
  setSubjectDone: (todoId: number, subjectId: number, done: boolean) => Promise<void>
}

export function useTodoOverviewModel(): TodoOverviewModel {
  const [snapshot, setSnapshot] = useState<TodoOverviewSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingTodoIds, setPendingTodoIds] = useState<ReadonlySet<number>>(new Set())

  useEffect(() => {
    let active = true
    window.onmove.domain.getTodoOverview().then(
      (next) => {
        if (!active) return
        setSnapshot(next)
        setError(null)
      },
      () => {
        if (!active) return
        setError('Todos could not be loaded.')
      }
    )
    return () => {
      active = false
    }
  }, [])

  useEffect(() => window.onmove.onDomainChanged(() => {
    void window.onmove.domain.getTodoOverview().then((next) => {
      setSnapshot(next)
      setError(null)
    }).catch(() => undefined)
  }), [])

  async function setDone(todoId: number, done: boolean): Promise<void> {
    setPendingTodoIds((current) => new Set(current).add(todoId))
    setError(null)
    try {
      const updated = await window.onmove.domain.updateTodo(todoId, { done })
      setSnapshot((current) => current === null
        ? current
        : {
            ...current,
            items: current.items.map((item): TodoOverviewItemSnapshot =>
              item.id === todoId ? { ...item, ...updated } : item
            )
          })
    } catch {
      setError('The Todo could not be updated.')
      throw new Error('The Todo could not be updated.')
    } finally {
      setPendingTodoIds((current) => {
        const next = new Set(current)
        next.delete(todoId)
        return next
      })
    }
  }

  async function setSubjectDone(
    todoId: number,
    subjectId: number,
    done: boolean
  ): Promise<void> {
    setPendingTodoIds((current) => new Set(current).add(todoId))
    setError(null)
    try {
      const updated = await window.onmove.domain.updateTodoSubjectCompletion(
        todoId,
        subjectId,
        done
      )
      setSnapshot((current) => current === null
        ? current
        : {
            ...current,
            items: current.items.map((item): TodoOverviewItemSnapshot =>
              item.id === todoId ? { ...item, ...updated } : item
            )
          })
    } catch {
      setError('The Todo Subject completion could not be updated.')
      throw new Error('The Todo Subject completion could not be updated.')
    } finally {
      setPendingTodoIds((current) => {
        const next = new Set(current)
        next.delete(todoId)
        return next
      })
    }
  }

  return {
    snapshot,
    loading: snapshot === null && error === null,
    error,
    pendingTodoIds,
    setDone,
    setSubjectDone
  }
}
