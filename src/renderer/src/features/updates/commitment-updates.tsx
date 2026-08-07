import type { HealthState } from '../../../../shared/contracts'
import { UpdateTable } from '@/features/updates/update-table'
import type { UpdateTableDraft } from '@/features/updates/update-table-contract'
import {
  UPDATE_TABLE_STATE_OPTIONS,
  updateTableRows
} from '@/features/updates/updates-presenters'
import { useCommitmentUpdatesModel } from '@/features/updates/use-commitment-updates-model'

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function CommitmentUpdates({
  commitmentId,
  onUpdatesChanged
}: {
  commitmentId: number
  onUpdatesChanged?: () => void | Promise<void>
}): React.JSX.Element {
  const model = useCommitmentUpdatesModel(commitmentId)

  async function changed(): Promise<void> {
    await onUpdatesChanged?.()
  }

  return (
    <UpdateTable
      rows={updateTableRows(model.updates)}
      stateOptions={UPDATE_TABLE_STATE_OPTIONS}
      defaultDate={today()}
      loading={model.loading}
      loadError={model.loadError}
      onCreate={async (draft: UpdateTableDraft) => {
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
