import { AlertTriangle, CalendarClock } from 'lucide-react'
import { TaggedText } from '@/components/ui/tagged-text'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import type { DueWorkGroupModel } from '@/features/due/due-presenters'
import { WorkDueDateField } from '@/features/shared/work-due-date-field'
import { WorkKindIcon } from '@/features/shared/work-kind-icon'
import { WorkStatusSelect } from '@/features/shared/work-status-select'
import type { WorkStatus } from '@/features/shared/work-status'
import { EntityReference } from '@/components/ui/entity-reference'

interface DueWorkTableProps {
  groups: readonly DueWorkGroupModel[]
  pendingKeys: ReadonlySet<string>
  onDueDateChange: (key: string, dueDate: string | null) => Promise<boolean>
  onStatusChange: (key: string, status: WorkStatus) => Promise<boolean>
  onOpen: (key: string) => void
}

export function DueWorkTable({
  groups,
  pendingKeys,
  onDueDateChange,
  onStatusChange,
  onOpen
}: DueWorkTableProps): React.JSX.Element {
  if (groups.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-dashed border-border px-5 py-10 text-center">
        <CalendarClock className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium">No due work to show.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add a due date or adjust the page filters.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-border/80 bg-card/25">
      <Table aria-label="Due work" className="min-w-[48rem]">
        <TableHeader>
          <TableRow className="bg-muted/20 hover:bg-muted/20">
            <TableHead className="w-[34%]">Name</TableHead>
            <TableHead className="w-[28%]">Where</TableHead>
            <TableHead>Due date</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.flatMap((group) => [
            <TableRow key={`group:${group.id}`} className="bg-muted/30 hover:bg-muted/30">
              <TableCell colSpan={4} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  {group.id === 'past-due' && (
                    <AlertTriangle className="size-3.5 text-destructive" aria-hidden="true" />
                  )}
                  <span className={group.id === 'past-due'
                    ? 'text-xs font-semibold text-destructive'
                    : 'text-xs font-semibold text-foreground'}>
                    {group.label}
                  </span>
                  <span className="text-[0.6875rem] text-muted-foreground">
                    {group.rows.length}
                  </span>
                </div>
              </TableCell>
            </TableRow>,
            ...group.rows.map((row) => {
              const pending = pendingKeys.has(row.id)
              return (
                <TableRow key={row.id} data-due-item={row.id}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <WorkKindIcon kind={row.kind} />
                      <span className="truncate font-medium">
                        <TaggedText value={row.title} />
                      </span>
                      <EntityReference {...row.reference} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <a
                      href={`#due-work-${row.id}`}
                      className="inline-flex max-w-full items-center text-xs font-medium text-primary-foreground underline decoration-primary/55 underline-offset-4 outline-none hover:decoration-primary focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/45"
                      aria-label={`Open ${row.kindLabel} ${row.title} in ${row.locationLabel}`}
                      onClick={(event) => {
                        event.preventDefault()
                        onOpen(row.id)
                      }}
                    >
                      <span className="truncate">{row.locationLabel}</span>
                    </a>
                  </TableCell>
                  <TableCell>
                    <WorkDueDateField
                      entityLabel={row.kindLabel}
                      value={row.dueDate}
                      parent={row.parent}
                      showLabel={false}
                      disabled={pending}
                      onValueChange={(dueDate) => onDueDateChange(row.id, dueDate)}
                    />
                  </TableCell>
                  <TableCell>
                    <WorkStatusSelect
                      aria-label={`${row.kindLabel} ${row.title} status`}
                      value={row.status}
                      disabled={pending}
                      onValueChange={(status) => void onStatusChange(row.id, status)}
                    />
                  </TableCell>
                </TableRow>
              )
            })
          ])}
        </TableBody>
      </Table>
    </div>
  )
}
