import type { TodoParent, UpdateScopeCell } from '../../../../shared/contracts'
import { TodoList } from '@/features/todos/todo-list'
import type { TodoListCreateTargetModel } from '@/features/todos/todo-list-contract'
import { todoListProjection } from '@/features/todos/todo-presenters'
import { useTodosModel } from '@/features/todos/use-todos-model'

const ALL_SUBJECTS_TARGET_ID = 'all-subjects'

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function cellTargetId(cell: UpdateScopeCell): string {
  return `scope:${cell.scopeId}:subject:${cell.subjectId}`
}

interface CurrentTodoCell {
  cell: UpdateScopeCell
  subjectName: string
}

export function DirectTodos({
  context,
  currentCells = [],
  onMutation
}: {
  context: TodoParent
  currentCells?: readonly CurrentTodoCell[]
  onMutation?: () => void | Promise<void>
}): React.JSX.Element {
  const currentCellsKey = currentCells
    .map(({ cell }) => `${cell.scopeId}:${cell.subjectId}`)
    .join('|')
  const model = useTodosModel(context, currentCellsKey)
  const aggregateContext = context.type === 'focus' || context.type === 'thread' ||
    context.type === 'commitment'
  const createTargets: TodoListCreateTargetModel[] = aggregateContext &&
    context.type !== 'focus' && currentCells.length > 0
    ? [
        { id: ALL_SUBJECTS_TARGET_ID, label: 'All subjects' },
        ...currentCells.map(({ cell, subjectName }) => ({
          id: cellTargetId(cell),
          label: subjectName
        }))
      ]
    : []

  function creationParent(targetId?: string): TodoParent {
    if (!aggregateContext || context.type === 'focus' || currentCells.length === 0) return context
    if (targetId === ALL_SUBJECTS_TARGET_ID) return context
    if (targetId === undefined) throw new Error('A current Todo Subject is required')
    const selected = currentCells.find(({ cell }) => cellTargetId(cell) === targetId)
    if (!selected) throw new Error('Todo Scope is no longer available')
    return context.type === 'thread'
      ? { type: 'thread-scope', id: context.id, scope: selected.cell }
      : { type: 'commitment-scope', id: context.id, scope: selected.cell }
  }

  const todoProjection = todoListProjection(model.todos, {
    today: today(),
    ...(context.type === 'thread-scope' || context.type === 'commitment-scope'
      ? { selectedSubjectId: context.scope.subjectId }
      : {}),
    ...(aggregateContext && context.type !== 'focus'
      ? { currentCells: currentCells.map(({ cell }) => cell) }
      : {})
  })

  return (
    <TodoList
      ariaLabel={`${context.type.replace('-scope', '')} Todos`}
      items={todoProjection.items}
      orphanedItems={aggregateContext && context.type !== 'focus'
        ? todoProjection.orphanedItems
        : undefined}
      orphanedItemsLabel="Orphaned Todos"
      loading={model.loading}
      loadError={model.loadError}
      createTargets={createTargets}
      defaultCreateTargetId={createTargets[0]?.id}
      onCreate={async (draft, targetId) => {
        await model.createTodo({
          parent: creationParent(targetId),
          name: draft.name,
          dueDate: draft.dueDate,
          ...(targetId === ALL_SUBJECTS_TARGET_ID
            ? { sharedAcrossSubjects: true }
            : {})
        })
        await onMutation?.()
      }}
      onUpdate={async (itemId, input) => {
        await model.updateTodo(Number(itemId), input)
        await onMutation?.()
      }}
      onDelete={async (itemId) => {
        await model.deleteTodo(Number(itemId))
        await onMutation?.()
      }}
      onSubjectCompletionChange={async (itemId, subjectId, done) => {
        await model.updateSubjectCompletion(Number(itemId), Number(subjectId), done)
        await onMutation?.()
      }}
      onReorder={async (orderedItemIds) => {
        await model.reorderTodos(orderedItemIds.map(Number))
        await onMutation?.()
      }}
    />
  )
}
