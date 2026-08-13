import type { RoutineSnapshot } from '../../../../shared/contracts'
import type { ContextDrawerAdapter } from '@/components/ui/context-drawer'
import type { StateLabelModel } from '@/components/ui/state-label'
import type { RoutineHistoryModel } from '@/features/routines/routine-history'
import type { RoutineManagementListModel } from '@/features/routines/routine-management-list'

function statusModel(status: RoutineSnapshot['status']): StateLabelModel {
  if (status === 'green') return { label: 'Current', tone: 'success' }
  if (status === 'yellow') return { label: 'Overdue', tone: 'warning' }
  return { label: 'Lapsed', tone: 'danger' }
}

export function routineHistoryModel(routine: RoutineSnapshot): RoutineHistoryModel {
  const checkIns = [routine.currentRun, ...routine.previousRuns]
    .filter((run): run is NonNullable<RoutineSnapshot['currentRun']> => run !== null)
    .filter((run, index, runs) => runs.findIndex(({ id }) => id === run.id) === index)
    .sort((left, right) => right.scheduledDate.localeCompare(left.scheduledDate))

  return {
    name: routine.name,
    stateLabel: statusModel(routine.status),
    cadenceLabel: `Every ${routine.cadenceDays} days`,
    scopeLabel: routine.scope?.name ?? 'No scope',
    nextReviewLabel: `Next review ${routine.nextReviewDate}`,
    needsAttestationLabel: routine.needsAttestation
      ? 'Included in Routines'
      : 'Excluded from Routines',
    checkIns: checkIns.map((run) => ({
      id: String(run.id),
      scheduledLabel: `Scheduled ${run.scheduledDate}`,
      completionLabel: run.completionDate
        ? `Completed ${run.completionDate}`
        : 'Incomplete',
      progressLabel: `${run.progress.complete} of ${run.progress.required} attested`,
      templateLabel: `Template v${run.templateVersion}`,
      late: run.completedLate,
      cells: run.cells.map((cell) => ({
        id: String(cell.id),
        subjectLabel: cell.subject?.name ?? 'No scope',
        progressLabel: `${cell.progress.complete} of ${cell.progress.required} attested`,
        completionLabel: cell.completionDate
          ? `Completed ${cell.completionDate}${cell.completedLate ? ' · late' : ''}`
          : 'Incomplete',
        items: cell.items.map((item) => ({
          id: item.id,
          inspection: item.inspection,
          resolutionLabel: item.resolution === 'attested'
            ? 'Attested'
            : item.resolution === 'not_applicable'
              ? 'Not applicable'
              : 'Pending',
          resolutionTone: item.resolution === 'attested' ? 'success' as const : 'neutral' as const,
          attestedLabel: item.attestedAt ? `Recorded ${item.attestedAt}` : null,
          note: item.note ?? '',
          resolution: item.resolution
        }))
      }))
    }))
  }
}

export function routineManagementListModel(
  routines: readonly RoutineSnapshot[]
): RoutineManagementListModel {
  return {
    items: routines.map((routine) => ({
      id: routine.id,
      name: routine.name,
      cadenceLabel: `Every ${routine.cadenceDays} days`,
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
  ancestorKeys
}: {
  routine: RoutineSnapshot
  parentLabel: string
  ancestorKeys: readonly string[]
}): ContextDrawerAdapter {
  return {
    id: `routine:${routine.id}`,
    revision: [
      routine.name,
      routine.cadenceDays,
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
              id: 'cadence-days',
              label: 'Check every (days)',
              value: String(routine.cadenceDays)
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
              value: routine.needsAttestation ? 'Included' : 'Excluded'
            },
            {
              kind: 'static',
              id: 'sensitive',
              label: 'Sensitive',
              value: routine.sensitive ? 'Yes' : 'No'
            }
          ],
          note: 'Manage this Routine from its Focus or Thread. This workspace is reserved for completing immutable attestations.'
        }
      ]
    }
  }
}
