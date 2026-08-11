import { useEffect, useMemo, useState } from 'react'
import type {
  CreateTodoInput,
  TodoParent,
  TodoSnapshot,
  UpdateTodoInput
} from '../../../../shared/contracts'

function contextKey(context: TodoParent): string {
  if (context.type === 'thread-scope' || context.type === 'commitment-scope') {
    return `${context.type}:${context.id}:${context.scope.scopeId}:${context.scope.subjectId}`
  }
  return `${context.type}:${context.id}`
}

export interface TodosModel {
  todos: TodoSnapshot[]
  loading: boolean
  loadError: string | null
  createTodo: (input: CreateTodoInput) => Promise<TodoSnapshot>
  updateTodo: (id: number, input: UpdateTodoInput) => Promise<TodoSnapshot>
  updateSubjectCompletion: (id: number, subjectId: number, done: boolean) => Promise<TodoSnapshot>
  deleteTodo: (id: number) => Promise<void>
  reorderTodos: (orderedTodoIds: readonly number[]) => Promise<void>
}

export function useTodosModel(context: TodoParent, refreshKey = ''): TodosModel {
  const key = contextKey(context)
  const contextType = context.type
  const contextId = context.id
  const scopeId = context.type === 'thread-scope' || context.type === 'commitment-scope'
    ? context.scope.scopeId
    : null
  const subjectId = context.type === 'thread-scope' || context.type === 'commitment-scope'
    ? context.scope.subjectId
    : null
  const stableContext = useMemo<TodoParent>(() => {
    if (contextType === 'thread-scope' || contextType === 'commitment-scope') {
      return {
        type: contextType,
        id: contextId,
        scope: { scopeId: scopeId as number, subjectId: subjectId as number }
      }
    }
    return { type: contextType, id: contextId }
  }, [contextId, contextType, scopeId, subjectId])
  const [state, setState] = useState<{
    key: string | null
    todos: TodoSnapshot[]
    loadError: string | null
  }>({ key: null, todos: [], loadError: null })
  const currentState = state.key === key
    ? state
    : { key: null, todos: [], loadError: null }

  useEffect(() => {
    let active = true
    window.onmove.domain.listTodos(stableContext).then(
      (nextTodos) => {
        if (!active) return
        setState({ key, todos: nextTodos, loadError: null })
      },
      () => {
        if (!active) return
        setState({ key, todos: [], loadError: 'Todos could not be loaded.' })
      }
    )
    return () => {
      active = false
    }
  }, [key, refreshKey, stableContext])

  async function createTodo(input: CreateTodoInput): Promise<TodoSnapshot> {
    const created = await window.onmove.domain.createTodo(input)
    setState((current) => ({
      key,
      loadError: null,
      todos: [...(current.key === key ? current.todos : []), created]
    }))
    return created
  }

  async function updateTodo(id: number, input: UpdateTodoInput): Promise<TodoSnapshot> {
    const updated = await window.onmove.domain.updateTodo(id, input)
    setState((current) => ({
      key,
      loadError: null,
      todos: (current.key === key ? current.todos : []).map(
        (todo) => todo.id === id ? updated : todo
      )
    }))
    return updated
  }

  async function deleteTodo(id: number): Promise<void> {
    const deleted = await window.onmove.domain.deleteTodo(id)
    if (!deleted) throw new Error('Todo no longer exists')
    setState((current) => ({
      key,
      loadError: null,
      todos: (current.key === key ? current.todos : []).filter((todo) => todo.id !== id)
    }))
  }

  async function updateSubjectCompletion(
    id: number,
    subjectId: number,
    done: boolean
  ): Promise<TodoSnapshot> {
    const updated = await window.onmove.domain.updateTodoSubjectCompletion(id, subjectId, done)
    setState((current) => ({
      key,
      loadError: null,
      todos: (current.key === key ? current.todos : []).map(
        (todo) => todo.id === id ? updated : todo
      )
    }))
    return updated
  }

  async function reorderTodos(orderedTodoIds: readonly number[]): Promise<void> {
    const reordered = await window.onmove.domain.reorderTodos(stableContext, orderedTodoIds)
    setState({ key, todos: reordered, loadError: null })
  }

  return {
    todos: currentState.todos,
    loading: state.key !== key,
    loadError: currentState.loadError,
    createTodo,
    updateTodo,
    updateSubjectCompletion,
    deleteTodo,
    reorderTodos
  }
}
