import type { TodoSnapshot, UpdateScopeCell } from '../../../../shared/contracts'
import type { TodoListItemModel } from '@/features/todos/todo-list-contract'
import { entityReference } from '../../../../shared/entity-reference'

export interface TodoListProjection {
  items: TodoListItemModel[]
  orphanedItems: TodoListItemModel[]
}

export function todoListProjection(
  todos: readonly TodoSnapshot[],
  options: {
    today: string
    currentCells?: readonly UpdateScopeCell[]
    selectedSubjectId?: number
  }
): TodoListProjection {
  const currentSubjectIds = options.currentCells === undefined
    ? null
    : new Set(options.currentCells.map(({ subjectId }) => subjectId))
  const projection: TodoListProjection = { items: [], orphanedItems: [] }

  for (const todo of todos) {
    const selectedCompletion = todo.sharedAcrossSubjects && options.selectedSubjectId !== undefined
      ? todo.subjectCompletions.find(
          ({ subject }) => subject.id === options.selectedSubjectId
        )
      : undefined
    if (todo.sharedAcrossSubjects && options.selectedSubjectId !== undefined && !selectedCompletion) {
      continue
    }
    const scope = todo.parent.type === 'thread-scope' ||
      todo.parent.type === 'commitment-scope'
      ? todo.parent.scope
      : null
    // Scope ids are immutable application-history nodes. Reapplying the same
    // canonical Subject can replace its Scope id, so current applicability is
    // classified by Subject identity instead of the historical Scope id.
    const orphaned = !todo.sharedAcrossSubjects && currentSubjectIds !== null && (
      scope === null
        ? currentSubjectIds.size > 0
        : !currentSubjectIds.has(scope.subjectId)
    )
    const subjectName = todo.subject?.name ?? (
      scope ? `Subject ${entityReference('subject', scope.subjectId)}` : null
    )
    const contextLabel = todo.sharedAcrossSubjects
      ? options.selectedSubjectId === undefined ? 'All subjects' : 'Shared'
      : orphaned
      ? subjectName ? `${subjectName} · Orphaned` : 'Orphaned'
      : subjectName
    const displayedDone = selectedCompletion?.done ?? todo.done
    const item = {
      id: String(todo.id),
      reference: { value: entityReference('todo', todo.id), label: 'Todo ID' },
      name: todo.name,
      dueDate: todo.dueDate,
      done: displayedDone,
      overdue: !displayedDone && todo.dueDate !== null && todo.dueDate < options.today,
      ...(todo.sharedAcrossSubjects && options.selectedSubjectId === undefined
        ? {
            canToggleDone: false,
            subjectCompletions: todo.subjectCompletions.map((completion) => ({
            subjectId: String(completion.subject.id),
            label: completion.subject.name,
            reference: {
              value: entityReference('subject', completion.subject.id),
              label: 'Subject ID'
            },
              done: completion.done
            }))
          }
        : {}),
      ...(selectedCompletion
        ? {
            canEdit: false,
            canDelete: false,
            completionSubjectId: String(selectedCompletion.subject.id)
          }
        : {}),
      ...(contextLabel ? { contextLabel } : {})
    }
    if (orphaned) projection.orphanedItems.push(item)
    else projection.items.push(item)
  }
  return projection
}
