import type { TodoOverviewItemSnapshot } from '../../../../shared/contracts'
import type {
  FocusWorkspaceDestinationTarget
} from '@/features/application/application-navigation'
import type { EntityReferenceModel } from '@/components/ui/entity-reference'
import { entityReference } from '../../../../shared/entity-reference'

export const TODO_OVERVIEW_SORT_KEYS = [
  'name',
  'project',
  'context',
  'dueDate',
  'status'
] as const

export type TodoOverviewSortKey = (typeof TODO_OVERVIEW_SORT_KEYS)[number]
export type TodoOverviewSortDirection = 'ascending' | 'descending'

export interface TodoOverviewSort {
  key: TodoOverviewSortKey
  direction: TodoOverviewSortDirection
}

/** Receiver-owned row contract; the table never receives domain records. */
export interface TodoOverviewRowModel {
  id: string
  reference: EntityReferenceModel
  name: string
  project: string
  context: string
  dueDate: string | null
  done: boolean
  completedAt: string | null
  overdue: boolean
  sharedAcrossSubjects: boolean
  subjectCompletions: readonly {
    subjectId: string
    label: string
    reference: EntityReferenceModel
    done: boolean
  }[]
}

export function todoOverviewRows(
  todos: readonly TodoOverviewItemSnapshot[],
  options: { today: string; hideSensitiveContent: boolean }
): TodoOverviewRowModel[] {
  return todos.flatMap((todo) => {
    const hidden = options.hideSensitiveContent && (
      todo.focus.sensitive ||
      (todo.thread?.sensitive ?? false) ||
      (todo.commitment?.sensitive ?? false) ||
      (todo.subject?.sensitive ?? false)
    )
    if (hidden) return []

    const context = [
      todo.thread?.title ?? 'Overall',
      todo.commitment?.title,
      todo.subject?.name
    ].filter((part): part is string => part !== undefined).join(' › ')
    return [{
      id: String(todo.id),
      reference: { value: entityReference('todo', todo.id), label: 'Todo ID' },
      name: todo.name,
      project: todo.focus.title,
      context,
      dueDate: todo.dueDate,
      done: todo.done,
      completedAt: todo.completedAt,
      overdue: !todo.done && todo.dueDate !== null && todo.dueDate < options.today,
      sharedAcrossSubjects: todo.sharedAcrossSubjects,
      subjectCompletions: todo.subjectCompletions.flatMap((completion) =>
        options.hideSensitiveContent && completion.subject.sensitive
          ? []
          : [{
              subjectId: String(completion.subject.id),
              label: completion.subject.name,
              reference: {
                value: entityReference('subject', completion.subject.id),
                label: 'Subject ID'
              },
              done: completion.done
            }]
      )
    }]
  })
}

/** Translate a domain snapshot into the application-owned deep-link contract. */
export function todoOverviewDestination(
  todo: TodoOverviewItemSnapshot
): FocusWorkspaceDestinationTarget {
  return {
    focusId: todo.focus.id,
    threadId: todo.thread?.id ?? null,
    commitmentId: todo.commitment?.id ?? null,
    subjectId: todo.subject?.id ?? null
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compareNullableDate(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return left.localeCompare(right)
}

function compareRowValue(
  left: TodoOverviewRowModel,
  right: TodoOverviewRowModel,
  key: TodoOverviewSortKey
): number {
  switch (key) {
    case 'name':
      return collator.compare(left.name, right.name)
    case 'project':
      return collator.compare(left.project, right.project)
    case 'context':
      return collator.compare(left.context, right.context)
    case 'dueDate':
      return compareNullableDate(left.dueDate, right.dueDate)
    case 'status':
      return Number(left.done) - Number(right.done)
  }
}

export function sortTodoOverviewRows(
  rows: readonly TodoOverviewRowModel[],
  sort: TodoOverviewSort
): TodoOverviewRowModel[] {
  const direction = sort.direction === 'ascending' ? 1 : -1
  return [...rows].sort((left, right) => {
    const primary = compareRowValue(left, right, sort.key)
    if (primary !== 0) return primary * direction
    const project = collator.compare(left.project, right.project)
    if (project !== 0) return project
    const dueDate = compareNullableDate(left.dueDate, right.dueDate)
    if (dueDate !== 0) return dueDate
    const name = collator.compare(left.name, right.name)
    return name !== 0 ? name : Number(left.id) - Number(right.id)
  })
}
