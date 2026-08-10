import type { TodoSnapshot, UpdateScopeCell } from '../../../../shared/contracts'
import type { TodoListItemModel } from '@/features/todos/todo-list-contract'

export interface TodoListProjection {
  items: TodoListItemModel[]
  orphanedItems: TodoListItemModel[]
}

export function todoListProjection(
  todos: readonly TodoSnapshot[],
  options: {
    today: string
    currentCells?: readonly UpdateScopeCell[]
  }
): TodoListProjection {
  const currentSubjectIds = options.currentCells === undefined
    ? null
    : new Set(options.currentCells.map(({ subjectId }) => subjectId))
  const projection: TodoListProjection = { items: [], orphanedItems: [] }

  for (const todo of todos) {
    const scope = todo.parent.type === 'thread-scope' ||
      todo.parent.type === 'commitment-scope'
      ? todo.parent.scope
      : null
    // Scope ids are immutable application-history nodes. Reapplying the same
    // canonical Subject can replace its Scope id, so current applicability is
    // classified by Subject identity instead of the historical Scope id.
    const orphaned = currentSubjectIds !== null && (
      scope === null
        ? currentSubjectIds.size > 0
        : !currentSubjectIds.has(scope.subjectId)
    )
    const subjectName = todo.subject?.name ?? (scope ? `Subject ${scope.subjectId}` : null)
    const contextLabel = orphaned
      ? subjectName ? `${subjectName} · Orphaned` : 'Orphaned'
      : subjectName
    const item = {
      id: String(todo.id),
      name: todo.name,
      dueDate: todo.dueDate,
      done: todo.done,
      overdue: !todo.done && todo.dueDate !== null && todo.dueDate < options.today,
      ...(contextLabel ? { contextLabel } : {})
    }
    if (orphaned) projection.orphanedItems.push(item)
    else projection.items.push(item)
  }
  return projection
}
