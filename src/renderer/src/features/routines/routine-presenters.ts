import type { RoutineSnapshot } from '../../../../shared/contracts'
import type { ContextDrawerAdapter } from '@/components/ui/context-drawer'
import type { StateLabelModel } from '@/components/ui/state-label'
import type { WorkspaceTabBarModel } from '@/components/ui/workspace-tab-bar'
import type { RoutineHistoryModel } from '@/features/routines/routine-history'
import type { RoutineManagementListModel } from '@/features/routines/routine-management-list'
import type { RoutineCellChecklistModel } from '@/features/routines/routine-cell-checklist'
import { entityReference } from '../../../../shared/entity-reference'

const WEEKDAY_LABELS = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri'
} as const

export function routineScheduleLabel(routine: RoutineSnapshot): string {
  if (routine.scheduleWeekdays.length === 0) return 'No schedule'
  if (routine.scheduleWeekdays.length === 5) return 'Monday–Friday'
  return routine.scheduleWeekdays.map((weekday) => WEEKDAY_LABELS[weekday]).join(', ')
}

export function routineCellChecklistModel(
  cell: NonNullable<RoutineSnapshot['currentRun']>['cells'][number]
): RoutineCellChecklistModel {
  return {
    id: cell.id,
    subjectLabel: cell.subject?.name ?? 'No scope',
    completionDate: cell.completionDate,
    progress: cell.progress,
    items: cell.items.map((item) => ({
      id: item.id,
      inspection: item.inspection,
      required: item.required,
      resolution: item.resolution,
      attestedAt: item.attestedAt,
      note: item.note ?? ''
    }))
  }
}

function statusModel(status: RoutineSnapshot['status']): StateLabelModel {
  if (status === 'green') return { label: 'Current', tone: 'success' }
  if (status === 'yellow') return { label: 'Overdue', tone: 'warning' }
  return { label: 'Lapsed', tone: 'danger' }
}

export function routineWorkingContextModel(routine: RoutineSnapshot): WorkspaceTabBarModel {
  return {
    ariaLabel: 'Routine attestation context',
    items: (routine.currentRun?.cells ?? [])
      .flatMap((cell) => cell.subject === null ? [] : [{
        id: `subject:${cell.subject.id}`,
        label: cell.subject.name,
        accessibleLabel: `Attest ${routine.name} for ${cell.subject.name}`,
        meta: `${cell.progress.complete} of ${cell.progress.required} attested`
      }])
  }
}

export function routineHistoryModel(
  routine: RoutineSnapshot,
  subjectId?: number
): RoutineHistoryModel {
  const projectRun = (run: NonNullable<RoutineSnapshot['currentRun']>) => {
    const cells = run.cells
      .filter((cell) => subjectId === undefined || cell.subject?.id === subjectId)
    const progress = subjectId === undefined
      ? run.progress
      : cells.reduce((total, cell) => ({
          complete: total.complete + cell.progress.complete,
          required: total.required + cell.progress.required
        }), { complete: 0, required: 0 })
    return {
      id: String(run.id),
      scheduledLabel: `Scheduled ${run.scheduledDate}`,
      completionLabel: run.completionDate
        ? `Completed ${run.completionDate}`
        : 'Incomplete',
      progressLabel: `${progress.complete} of ${progress.required} attested`,
      templateLabel: `Template v${run.templateVersion}`,
      late: run.completedLate,
      cells: cells.map((cell) => ({
        id: String(cell.id),
        subjectLabel: cell.subject?.name ?? 'No scope',
        progressLabel: `${cell.progress.complete} of ${cell.progress.required} attested`,
        completionLabel: cell.completionDate
          ? `Completed ${cell.completionDate}${cell.completedLate ? ' · late' : ''}`
          : 'Incomplete',
        checklist: routineCellChecklistModel(cell)
      }))
    }
  }
  const checkIns = routine.previousRuns
    .filter((run, index, runs) => runs.findIndex(({ id }) => id === run.id) === index)
    .sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate))

  return {
    name: routine.name,
    reference: { value: entityReference('routine', routine.id), label: 'Routine ID' },
    stateLabel: statusModel(routine.status),
    scheduleLabel: routineScheduleLabel(routine),
    scopeLabel: routine.scope?.name ?? 'No scope',
    nextReviewLabel: routine.nextReviewDate
      ? `Next review ${routine.nextReviewDate}`
      : 'No review scheduled',
    needsAttestationLabel: routine.needsAttestation
      ? 'Included in Routines'
      : routine.attestationRequested
        ? 'No schedule'
        : 'Excluded from Routines',
    currentCheckIn: routine.currentRun ? projectRun(routine.currentRun) : null,
    checkIns: checkIns.map(projectRun)
  }
}

export function routineManagementListModel(
  routines: readonly RoutineSnapshot[]
): RoutineManagementListModel {
  return {
    items: routines.map((routine) => ({
      id: routine.id,
      name: routine.name,
      scheduleLabel: routineScheduleLabel(routine),
      scopeLabel: routine.scope?.name ?? 'No scope',
      detailLabels: [
        ...(!routine.needsAttestation ? ['Not in queue'] : []),
        ...(routine.sensitive ? ['Sensitive'] : [])
      ],
      stateLabel: statusModel(routine.status)
    }))
  }
}

export function routineDrawerAdapter({
  routine,
  parentLabel,
  ancestorKeys,
  onDelete
}: {
  routine: RoutineSnapshot
  parentLabel: string
  ancestorKeys: readonly string[]
  onDelete?: () => void | Promise<void>
}): ContextDrawerAdapter {
  return {
    id: `routine:${routine.id}`,
    revision: [
      routine.name,
      routine.scheduleWeekdays.join(','),
      routine.attestationRequested,
      routine.needsAttestation,
      routine.sensitive,
      routine.scope?.id ?? 'open',
      routine.template.version,
      routine.updatedAt
    ].join(':'),
    invalidationKeys: [...ancestorKeys, `routine:${routine.id}`],
    model: {
      title: 'Routine',
      description: routine.name,
      ariaLabel: `${routine.name} Routine context drawer`,
      sections: [
        {
          id: 'routine',
          fields: [
            { kind: 'static', id: 'name', label: 'Name', value: routine.name },
            {
              kind: 'static',
              id: 'schedule',
              label: 'Check every',
              value: routineScheduleLabel(routine)
            },
            { kind: 'static', id: 'parent', label: 'Parent', value: parentLabel },
            {
              kind: 'static',
              id: 'scope',
              label: 'Scope',
              value: routine.scope?.name ?? 'No scope'
            },
            {
              kind: 'static',
              id: 'needs-attestation',
              label: 'Needs attestation',
              value: routine.needsAttestation
                ? 'Included'
                : routine.attestationRequested
                  ? 'No schedule'
                  : 'Excluded'
            },
            {
              kind: 'static',
              id: 'sensitive',
              label: 'Sensitive',
              value: routine.sensitive ? 'Yes' : 'No'
            }
          ],
          note: 'Edit this Routine in its Focus or Thread main screen. The global Routines workspace is reserved for completing immutable attestations.'
        }
      ],
      actions: onDelete ? [
        {
          id: 'delete',
          label: 'Delete',
          pendingLabel: 'Deleting…',
          variant: 'destructive',
          align: 'start',
          confirmation: {
            title: 'Delete Routine?',
            description: `“${routine.name}” and every immutable Run will be permanently deleted.`,
            body: 'This action cannot be undone.',
            confirmLabel: 'Delete Routine'
          },
          errorMessage: 'The Routine could not be deleted. Please try again.',
          onInvoke: onDelete
        }
      ] : undefined
    }
  }
}
