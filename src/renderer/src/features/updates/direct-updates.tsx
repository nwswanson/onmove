import type {
  HealthState,
  SubjectSnapshot,
  UpdateParent,
  UpdateScopeCell
} from '../../../../shared/contracts'
import { UpdateList } from '@/features/updates/update-list'
import type { UpdateListDraft } from '@/features/updates/update-list-contract'
import {
  UPDATE_LIST_STATE_OPTIONS,
  updateListItems
} from '@/features/updates/updates-presenters'
import { useUpdatesModel } from '@/features/updates/use-updates-model'
import { visibleSensitiveRecords } from '@/features/shared/sensitivity'

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function parentLabel(parent: UpdateParent): string {
  if (parent.type === 'focus') return 'Focus'
  if (parent.type === 'thread') return 'Thread'
  return 'Commitment'
}

export function DirectUpdates({
  parent,
  context = { mode: 'aggregate' },
  hideSensitiveContent = false,
  ancestorSensitive = false,
  onUpdatesChanged
}: {
  parent: UpdateParent
  context?:
    | { mode: 'aggregate' }
    | {
        mode: 'scope-overview'
        currentScopeId: number
        subjects: readonly SubjectSnapshot[]
        knownSubjects?: readonly SubjectSnapshot[]
      }
    | { mode: 'subject'; cell: UpdateScopeCell; subject: SubjectSnapshot }
  hideSensitiveContent?: boolean
  ancestorSensitive?: boolean
  onUpdatesChanged?: () => void | Promise<void>
}): React.JSX.Element {
  const scopedCreationAvailable =
    context.mode === 'scope-overview' && context.subjects.length > 0
  const workingContext = context.mode === 'aggregate'
    ? { mode: 'unfiltered' as const }
    : context.mode === 'scope-overview'
      ? { mode: 'scope-overview' as const }
      : { mode: 'cell' as const, cell: context.cell }
  const model = useUpdatesModel(parent, workingContext)
  const contextLabels = new Map(
    context.mode === 'scope-overview'
      ? (context.knownSubjects ?? context.subjects).map(({ id, name }) => [id, name] as const)
      : context.mode === 'subject'
        ? [[context.subject.id, context.subject.name] as const]
        : []
  )

  async function changed(): Promise<void> {
    try {
      await onUpdatesChanged?.()
    } catch {
      // The Update mutation already succeeded; a derived-view refresh must not
      // turn that success into a misleading create or autosave failure.
    }
  }

  return (
    <UpdateList
      ariaLabel={`${parentLabel(parent)} updates`}
      heading={context.mode === 'subject' ? `Updates · ${context.subject.name}` : 'Updates'}
      supportingText={context.mode === 'scope-overview'
        ? context.subjects.length > 0
          ? `All ${parentLabel(parent)} updates across current and former scopes. Choose a Subject to add evidence.`
          : `This ${parentLabel(parent)} has no applicable Subjects, so there is no current cell to update.`
        : context.mode === 'subject'
          ? 'New Updates are attributed only to this Scope and Subject.'
          : undefined}
      items={updateListItems(
        visibleSensitiveRecords(
          model.updates,
          hideSensitiveContent,
          ancestorSensitive
        ),
        {
          subjectLabels: contextLabels,
          ...(context.mode === 'scope-overview'
            ? { currentSubjectIds: new Set(context.subjects.map(({ id }) => id)) }
            : {})
        }
      )}
      stateOptions={UPDATE_LIST_STATE_OPTIONS}
      defaultDate={today()}
      defaultState="none"
      loading={model.loading}
      loadError={model.loadError}
      onCreate={context.mode === 'scope-overview' ? undefined : async (draft: UpdateListDraft) => {
        await model.createUpdate({
          date: draft.date,
          observation: draft.observation,
          state: draft.state as HealthState,
          sensitive: draft.sensitive
        })
        await changed()
      }}
      createOptions={scopedCreationAvailable
        ? context.subjects.map(({ id, name }) => ({ id: String(id), label: name }))
        : undefined}
      createOptionsLabel={scopedCreationAvailable
        ? 'Add update for Subject…'
        : undefined}
      onCreateFor={scopedCreationAvailable
        ? async (subjectId, draft) => {
            await model.createUpdate({
              date: draft.date,
              observation: draft.observation,
              state: draft.state as HealthState,
              sensitive: draft.sensitive,
              scope: {
                scopeId: context.currentScopeId,
                subjectId: Number(subjectId)
              }
            })
            await changed()
          }
        : undefined}
      onUpdate={async (rowId, draft) => {
        await model.editUpdate(Number(rowId), {
          date: draft.date,
          observation: draft.observation,
          state: draft.state as HealthState,
          sensitive: draft.sensitive
        })
        await changed()
      }}
      onDelete={async (rowId) => {
        await model.deleteUpdate(Number(rowId))
        await changed()
      }}
    />
  )
}
