import type { RoutineSnapshot, UpdateRoutineInput } from '../../../../shared/contracts'
import type {
  ContextDrawerAdapter,
  ContextDrawerValues
} from '@/components/ui/context-drawer'

function text(values: ContextDrawerValues, id: string): string {
  const value = values[id]
  return typeof value === 'string' ? value : ''
}

function bool(values: ContextDrawerValues, id: string): boolean {
  return values[id] === true
}

export function routineDrawerAdapter({
  routine,
  parentLabel,
  ancestorKeys,
  onSave,
  onEditTemplate,
  onDelete
}: {
  routine: RoutineSnapshot
  parentLabel: string
  ancestorKeys: readonly string[]
  onSave: (input: UpdateRoutineInput) => Promise<void>
  onEditTemplate: () => void
  onDelete: () => Promise<void>
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
            { kind: 'text', id: 'name', label: 'Name', value: routine.name, required: true },
            {
              kind: 'number',
              id: 'cadence-days',
              label: 'Check every (days)',
              value: String(routine.cadenceDays),
              required: true,
              min: 1,
              step: 1,
              integer: true
            },
            { kind: 'static', id: 'parent', label: 'Parent', value: parentLabel },
            {
              kind: 'static',
              id: 'scope',
              label: 'Scope',
              value: routine.scope?.name ?? 'No scope'
            },
            {
              kind: 'checkbox',
              id: 'needs-attestation',
              label: 'Needs attestation',
              value: routine.needsAttestation,
              description: 'Include this Routine’s Subject cells in the Routines queue.'
            },
            {
              kind: 'checkbox',
              id: 'sensitive',
              label: 'Sensitive',
              value: routine.sensitive,
              description: 'Hide this Routine from lists when sensitive content is hidden.'
            }
          ],
          note: 'Scope membership is snapshotted per scheduled Run. Each Subject has an independent attestation cell.'
        }
      ],
      autosave: {
        fieldIds: ['name'],
        errorMessage: 'The Routine name could not be saved.',
        onInvoke: (values) => onSave({ name: text(values, 'name') })
      },
      actions: [
        {
          id: 'edit-template',
          label: 'Edit future checklist',
          variant: 'outline',
          align: 'start',
          errorMessage: 'The checklist editor could not be opened.',
          onInvoke: onEditTemplate
        },
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
          errorMessage: 'The Routine could not be deleted.',
          onInvoke: onDelete
        },
        {
          id: 'save',
          label: 'Save changes',
          pendingLabel: 'Saving…',
          requiresValidFields: true,
          includesAutosaveFields: true,
          errorMessage: 'The Routine could not be updated.',
          onInvoke: (values) => onSave({
            name: text(values, 'name'),
            cadenceDays: Number(text(values, 'cadence-days')),
            needsAttestation: bool(values, 'needs-attestation'),
            sensitive: bool(values, 'sensitive')
          })
        }
      ]
    }
  }
}
