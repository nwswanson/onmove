import type { RoutineSnapshot } from '../../../../shared/contracts'
import type { ContextDrawerAdapter } from '@/components/ui/context-drawer'
import type { StateLabelModel } from '@/components/ui/state-label'
import type { RoutineManagementListModel } from '@/features/routines/routine-management-list'

function statusModel(status: RoutineSnapshot['status']): StateLabelModel {
  if (status === 'green') return { label: 'Current', tone: 'success' }
  if (status === 'yellow') return { label: 'Overdue', tone: 'warning' }
  return { label: 'Lapsed', tone: 'danger' }
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
