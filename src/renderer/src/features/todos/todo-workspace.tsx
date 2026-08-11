import {
  ContextDrawerOutlet,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import { TodoOverviewTable } from '@/features/todos/todo-overview-table'
import {
  todoOverviewDestination,
  todoOverviewRows
} from '@/features/todos/todo-overview-presenters'
import { useTodoOverviewModel } from '@/features/todos/use-todo-overview-model'
import type {
  FocusWorkspaceDestinationTarget
} from '@/features/application/application-navigation'

interface TodoWorkspaceProps {
  contextDrawer: ContextDrawerControl
  hideSensitiveContent: boolean
  onOpenContext: (destination: FocusWorkspaceDestinationTarget) => void
}

export function TodoWorkspace({
  contextDrawer,
  hideSensitiveContent,
  onOpenContext
}: TodoWorkspaceProps): React.JSX.Element {
  const model = useTodoOverviewModel()
  const rows = model.snapshot
    ? todoOverviewRows(model.snapshot.items, {
        today: model.snapshot.today,
        hideSensitiveContent
      })
    : []

  return (
    <WorkspaceShell
      main={
        <main className="min-w-0 flex-1 overflow-auto bg-background" aria-labelledby="todos-heading">
          <section className="mx-auto w-full max-w-7xl p-8 sm:p-10">
            <h1 id="todos-heading" className="text-2xl font-semibold tracking-[-0.025em]">
              Todos
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Open work across every Focus and its working contexts.
            </p>

            {model.loading ? (
              <p className="mt-8 text-sm text-muted-foreground">Loading Todos…</p>
            ) : model.error && model.snapshot === null ? (
              <p role="alert" className="mt-8 text-sm text-destructive">{model.error}</p>
            ) : model.snapshot ? (
              <TodoOverviewTable
                rows={rows}
                recentlyCompletedDays={model.snapshot.recentlyCompletedDays}
                pendingTodoIds={model.pendingTodoIds}
                onDoneChange={(todoId, done) => model.setDone(Number(todoId), done)}
                onSubjectDoneChange={(todoId, subjectId, done) =>
                  model.setSubjectDone(Number(todoId), Number(subjectId), done)}
                onOpenContext={(todoId) => {
                  const todo = model.snapshot?.items.find(({ id }) => String(id) === todoId)
                  if (todo) onOpenContext(todoOverviewDestination(todo))
                }}
              />
            ) : null}
          </section>
        </main>
      }
      drawer={<ContextDrawerOutlet {...contextDrawer} />}
    />
  )
}
