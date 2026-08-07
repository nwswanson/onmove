import type { HealthState, UpdateParent } from '../../../../shared/contracts'
import { UpdateList } from '@/features/updates/update-list'
import type { UpdateListDraft } from '@/features/updates/update-list-contract'
import {
  UPDATE_LIST_STATE_OPTIONS,
  updateListItems
} from '@/features/updates/updates-presenters'
import { useUpdatesModel } from '@/features/updates/use-updates-model'

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
  onUpdatesChanged
}: {
  parent: UpdateParent
  onUpdatesChanged?: () => void | Promise<void>
}): React.JSX.Element {
  const model = useUpdatesModel(parent)

  async function changed(): Promise<void> {
    await onUpdatesChanged?.()
  }

  return (
    <UpdateList
      ariaLabel={`${parentLabel(parent)} updates`}
      items={updateListItems(model.updates)}
      stateOptions={UPDATE_LIST_STATE_OPTIONS}
      defaultDate={today()}
      defaultState="none"
      loading={model.loading}
      loadError={model.loadError}
      onCreate={async (draft: UpdateListDraft) => {
        await model.createUpdate({
          date: draft.date,
          observation: draft.observation,
          state: draft.state as HealthState
        })
        await changed()
      }}
      onUpdate={async (rowId, draft) => {
        await model.editUpdate(Number(rowId), {
          date: draft.date,
          observation: draft.observation,
          state: draft.state as HealthState
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
