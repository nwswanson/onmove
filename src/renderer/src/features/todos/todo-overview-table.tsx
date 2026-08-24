import { Fragment, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TaggedText } from '@/components/ui/tagged-text'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  sortTodoOverviewRows,
  type TodoOverviewRowModel,
  type TodoOverviewSort,
  type TodoOverviewSortKey
} from '@/features/todos/todo-overview-presenters'
import { cn } from '@/lib/utils'

interface TodoOverviewTableProps {
  rows: readonly TodoOverviewRowModel[]
  recentlyCompletedDays: number
  pendingTodoIds: ReadonlySet<number>
  onDoneChange: (todoId: string, done: boolean) => Promise<void>
  onSubjectDoneChange: (todoId: string, subjectId: string, done: boolean) => Promise<void>
  onOpenContext: (todoId: string) => void
}

const columns: readonly { key: TodoOverviewSortKey; label: string }[] = [
  { key: 'name', label: 'Todo' },
  { key: 'project', label: 'Project' },
  { key: 'context', label: 'Context' },
  { key: 'dueDate', label: 'Due date' },
  { key: 'status', label: 'Status' }
]

function formatDate(value: string | null): string {
  if (value === null) return '—'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value)
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date)
}

function SortIcon({ sort, column }: { sort: TodoOverviewSort; column: TodoOverviewSortKey }) {
  if (sort.key !== column) return <ArrowUpDown aria-hidden="true" />
  return sort.direction === 'ascending'
    ? <ArrowUp aria-hidden="true" />
    : <ArrowDown aria-hidden="true" />
}

export function TodoOverviewTable({
  rows,
  recentlyCompletedDays,
  pendingTodoIds,
  onDoneChange,
  onSubjectDoneChange,
  onOpenContext
}: TodoOverviewTableProps): React.JSX.Element {
  const [showCompleted, setShowCompleted] = useState(false)
  const [sort, setSort] = useState<TodoOverviewSort>({
    key: 'dueDate',
    direction: 'ascending'
  })
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [expandedTodoIds, setExpandedTodoIds] = useState<ReadonlySet<string>>(new Set())
  const visibleRows = useMemo(
    () => sortTodoOverviewRows(
      showCompleted ? rows : rows.filter(({ done }) => !done),
      sort
    ),
    [rows, showCompleted, sort]
  )
  const completedCount = rows.filter(({ done }) => done).length

  function changeSort(key: TodoOverviewSortKey): void {
    setSort((current) => current.key === key
      ? {
          key,
          direction: current.direction === 'ascending' ? 'descending' : 'ascending'
        }
      : { key, direction: 'ascending' })
  }

  async function updateDone(todoId: string, done: boolean): Promise<void> {
    setMutationError(null)
    try {
      await onDoneChange(todoId, done)
    } catch {
      setMutationError('The Todo could not be updated.')
    }
  }

  async function updateSubjectDone(
    todoId: string,
    subjectId: string,
    done: boolean
  ): Promise<void> {
    setMutationError(null)
    try {
      await onSubjectDoneChange(todoId, subjectId, done)
    } catch {
      setMutationError('The Todo Subject completion could not be updated.')
    }
  }

  function toggleExpanded(todoId: string): void {
    setExpandedTodoIds((current) => {
      const next = new Set(current)
      if (next.has(todoId)) next.delete(todoId)
      else next.add(todoId)
      return next
    })
  }

  return (
    <div className="mt-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {visibleRows.length === 1 ? '1 Todo' : `${visibleRows.length} Todos`}
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            aria-label={`Show completed from last ${recentlyCompletedDays} days`}
            checked={showCompleted}
            className="size-4 accent-primary"
            onChange={(event) => setShowCompleted(event.target.checked)}
          />
          Show completed from last {recentlyCompletedDays} days
          {completedCount > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.625rem] tabular-nums text-muted-foreground">
              {completedCount}
            </span>
          )}
        </label>
      </div>

      {mutationError && (
        <p role="alert" className="mb-3 text-sm text-destructive">{mutationError}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-border/80 bg-card/45 shadow-xs">
        <Table aria-label="All Todos" className="min-w-[50rem]">
          <TableHeader className="bg-muted/45">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-11"><span className="sr-only">Complete</span></TableHead>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  aria-sort={sort.key === column.key ? sort.direction : 'none'}
                  className={cn(column.key === 'name' && 'min-w-64')}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-8 gap-1.5 px-2 text-xs text-muted-foreground"
                    aria-label={`Sort by ${column.label}`}
                    onClick={() => changeSort(column.key)}
                  >
                    {column.label}
                    <SortIcon sort={sort} column={column.key} />
                  </Button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => {
              const pending = pendingTodoIds.has(Number(row.id))
              const expanded = expandedTodoIds.has(row.id)
              return (
                <Fragment key={row.id}>
                  <TableRow
                    data-todo-id={row.id}
                    className={cn(row.done && 'bg-muted/20 text-muted-foreground')}
                  >
                    <TableCell>
                      {row.sharedAcrossSubjects ? (
                        row.subjectCompletions.length > 0 ? (
                          <button
                            type="button"
                            aria-label={`${expanded ? 'Hide' : 'Show'} ${row.name} Subject progress`}
                            aria-expanded={expanded}
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/55"
                            onClick={() => toggleExpanded(row.id)}
                          >
                            <ChevronDown
                              aria-hidden="true"
                              className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                            />
                          </button>
                        ) : <span className="block size-7" />
                      ) : (
                        <input
                          type="checkbox"
                          checked={row.done}
                          disabled={pending}
                          aria-label={row.done ? `Reopen ${row.name}` : `Mark ${row.name} done`}
                          className="size-4 accent-primary"
                          onChange={(event) => void updateDone(row.id, event.target.checked)}
                        />
                      )}
                    </TableCell>
                  <TableCell className={cn('font-medium', row.done && 'line-through')}>
                    <TaggedText value={row.name} />
                  </TableCell>
                  <TableCell>{row.project}</TableCell>
                  <TableCell>
                    <a
                      href={`#todo-context-${row.id}`}
                      className="font-medium text-primary underline decoration-primary/45 underline-offset-3 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      onClick={(event) => {
                        event.preventDefault()
                        onOpenContext(row.id)
                      }}
                    >
                      {row.context}
                    </a>
                  </TableCell>
                  <TableCell className={cn(
                    'whitespace-nowrap tabular-nums',
                    row.overdue && 'font-semibold text-destructive'
                  )}>
                    {formatDate(row.dueDate)}
                    {row.overdue && <span className="sr-only">, overdue</span>}
                  </TableCell>
                    <TableCell>
                    {row.sharedAcrossSubjects && !row.done ? (
                      <span className="whitespace-nowrap text-xs">
                        {row.subjectCompletions.filter(({ done }) => done).length}/
                        {row.subjectCompletions.length} subjects
                      </span>
                    ) : row.done ? (
                      <span className="whitespace-nowrap text-xs">
                        Completed {formatDate(row.completedAt)}
                      </span>
                    ) : row.overdue ? (
                      <Badge className="bg-destructive text-destructive-foreground">Overdue</Badge>
                    ) : (
                      <Badge variant="outline">Open</Badge>
                    )}
                    </TableCell>
                  </TableRow>
                  {row.sharedAcrossSubjects && expanded && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="bg-muted/15 px-12 py-3">
                        <ul aria-label={`${row.name} Subject progress`} className="grid gap-2 sm:grid-cols-2">
                          {row.subjectCompletions.map((completion) => (
                            <li key={completion.subjectId} className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={completion.done}
                                disabled={pending}
                                aria-label={`Mark ${row.name} done for ${completion.label}`}
                                className="size-4 accent-primary"
                                onChange={(event) => void updateSubjectDone(
                                  row.id,
                                  completion.subjectId,
                                  event.target.checked
                                )}
                              />
                              <span className={cn(
                                completion.done && 'text-muted-foreground line-through'
                              )}>
                                {completion.label}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
            {visibleRows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="h-32 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? 'No Todos yet.'
                    : showCompleted
                      ? 'No Todos match this view.'
                      : 'No open Todos. Show recently completed items to review closed work.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
