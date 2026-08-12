import {
  ContextDrawerOutlet,
  type ContextDrawerControl
} from '@/components/ui/context-drawer'
import { WorkspaceShell } from '@/components/ui/workspace-shell'
import type { FocusWorkspaceDestinationTarget } from '@/features/application/application-navigation'
import { dueWorkGroups } from '@/features/due/due-presenters'
import { DueWorkTable } from '@/features/due/due-work-table'
import { useDueModel } from '@/features/due/use-due-model'

interface DueWorkspaceProps {
  contextDrawer: ContextDrawerControl
  hideSensitiveContent: boolean
  onOpenContext: (destination: FocusWorkspaceDestinationTarget) => void
  onWorkChanged?: (focusId: number) => void | Promise<void>
}

export function DueWorkspace({
  contextDrawer,
  hideSensitiveContent,
  onOpenContext,
  onWorkChanged
}: DueWorkspaceProps): React.JSX.Element {
  const model = useDueModel({ onWorkChanged })
  const groups = model.overview
    ? dueWorkGroups(model.overview, hideSensitiveContent)
    : []
  const rows = groups.flatMap(({ rows: groupRows }) => groupRows)

  return (
    <WorkspaceShell
      main={
        <main className="min-w-0 flex-1 overflow-auto bg-background" aria-labelledby="due-heading">
          <section className="mx-auto w-full max-w-7xl p-8 sm:p-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 id="due-heading" className="text-2xl font-semibold tracking-[-0.025em]">
                  Due
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Explicit deadlines across Focuses, Threads, and Commitments.
                </p>
              </div>
              {!model.loading && model.overview && (
                <p className="text-xs font-medium text-muted-foreground" aria-live="polite">
                  {rows.length === 1 ? '1 dated item' : `${rows.length} dated items`}
                </p>
              )}
            </div>

            {model.loading ? (
              <p className="mt-8 text-sm text-muted-foreground">Loading due work…</p>
            ) : model.error && model.overview === null ? (
              <p role="alert" className="mt-8 text-sm text-destructive">{model.error}</p>
            ) : model.overview ? (
              <>
                {model.error && (
                  <p role="alert" className="mt-5 text-sm text-destructive">{model.error}</p>
                )}
                <DueWorkTable
                  groups={groups}
                  pendingKeys={model.pendingKeys}
                  onDueDateChange={model.changeDueDate}
                  onStatusChange={model.changeStatus}
                  onOpen={(key) => {
                    const row = rows.find(({ id }) => id === key)
                    if (row) onOpenContext(row.destination)
                  }}
                />
              </>
            ) : null}
          </section>
        </main>
      }
      drawer={<ContextDrawerOutlet {...contextDrawer} />}
    />
  )
}
