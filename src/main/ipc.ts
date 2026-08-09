import type { IpcMain, Shell } from 'electron'
import {
  IPC_CHANNELS,
  type AddFocusScopeSubjectInput,
  type CommitmentParent,
  type CreateCommitmentInput,
  type CreateFocusInput,
  type CreateItemInput,
  type CreateRelationInput,
  type CreateThreadInput,
  type CreateUpdateInput,
  type EditUpdateInput,
  type FocusStatus,
  type SetItemStatusInput,
  type UpdateParent,
  type UpdateCommitmentInput,
  type UpdateFocusInput,
  type UpdateThreadInput
} from '../shared/contracts'
import type { AppDatabase } from './database'

type IpcRegistrar = Pick<IpcMain, 'handle' | 'removeHandler'>
type FolderOpener = Pick<Shell, 'showItemInFolder'>

export function registerAppIpc(
  ipcMain: IpcRegistrar,
  database: AppDatabase,
  shell: FolderOpener,
  getSensitiveContentHidden: () => boolean = () => false
): () => void {
  ipcMain.handle(IPC_CHANNELS.getAppState, () => database.getState())
  ipcMain.handle(IPC_CHANNELS.getSensitiveContentHidden, getSensitiveContentHidden)
  ipcMain.handle(IPC_CHANNELS.recordGreeting, () => database.recordGreeting())
  ipcMain.handle(IPC_CHANNELS.showDataFolder, () => shell.showItemInFolder(database.getState().databasePath))
  ipcMain.handle(IPC_CHANNELS.createRelation, (_event, input: CreateRelationInput) =>
    database.domain.relations.create(input).toSnapshot()
  )
  ipcMain.handle(IPC_CHANNELS.deleteRelation, (_event, id: number) =>
    database.domain.relations.delete(id)
  )
  ipcMain.handle(IPC_CHANNELS.createItem, (_event, input: CreateItemInput) =>
    database.domain.items.create(input).materialize()
  )
  ipcMain.handle(IPC_CHANNELS.getItem, (_event, id: number) =>
    database.domain.items.findModel(id)?.materialize() ?? null
  )
  ipcMain.handle(IPC_CHANNELS.deleteItem, (_event, id: number) =>
    database.domain.items.delete(id)
  )
  ipcMain.handle(IPC_CHANNELS.moveItem, (_event, id: number, parentId: number | null) =>
    database.domain.items.requireModel(id).moveTo(parentId).materialize()
  )
  ipcMain.handle(IPC_CHANNELS.setItemRelation, (_event, id: number, relationId: number | null) =>
    database.domain.items.requireModel(id).setRelation(relationId).materialize()
  )
  ipcMain.handle(
    IPC_CHANNELS.setItemStatus,
    (_event, id: number, input: SetItemStatusInput) =>
      database.domain.items.requireModel(id).setStatus(input).materialize()
  )
  ipcMain.handle(IPC_CHANNELS.getItemStatusHistory, (_event, id: number) =>
    database.domain.items.statusHistory(id)
  )
  ipcMain.handle(IPC_CHANNELS.listFocuses, () => database.domain.focuses.list())
  ipcMain.handle(IPC_CHANNELS.createFocus, (_event, input: CreateFocusInput) =>
    database.domain.focuses.create(input).toSnapshot()
  )
  ipcMain.handle(IPC_CHANNELS.updateFocus, (_event, id: number, input: UpdateFocusInput) =>
    database.domain.focuses.requireModel(id).update(input).toSnapshot()
  )
  ipcMain.handle(IPC_CHANNELS.setFocusStatus, (_event, id: number, status: FocusStatus) =>
    database.domain.focuses.requireModel(id).setStatus(status).toSnapshot()
  )
  ipcMain.handle(IPC_CHANNELS.deleteFocus, (_event, id: number) =>
    database.domain.focuses.delete(id)
  )
  ipcMain.handle(IPC_CHANNELS.getFocusStatusHistory, (_event, id: number) =>
    database.domain.focuses.statusHistory(id)
  )
  ipcMain.handle(IPC_CHANNELS.getFocusScope, (_event, focusId: number) =>
    database.domain.focusScopes.get(focusId)
  )
  ipcMain.handle(
    IPC_CHANNELS.addFocusScopeSubject,
    (_event, focusId: number, input: AddFocusScopeSubjectInput) =>
      database.domain.focusScopes.addSubject(focusId, input)
  )
  ipcMain.handle(
    IPC_CHANNELS.removeFocusScopeSubject,
    (_event, focusId: number, subjectId: number) =>
      database.domain.focusScopes.removeSubject(focusId, subjectId)
  )
  ipcMain.handle(IPC_CHANNELS.getThreadScope, (_event, threadId: number) =>
    database.domain.threadScopes.get(threadId)
  )
  ipcMain.handle(IPC_CHANNELS.getThreadSubjectMatrix, (_event, threadId: number) =>
    database.domain.threads.subjectMatrix(threadId)
  )
  ipcMain.handle(IPC_CHANNELS.customizeThreadScope, (_event, threadId: number) =>
    database.domain.threadScopes.customize(threadId)
  )
  ipcMain.handle(
    IPC_CHANNELS.addThreadScopeSubject,
    (_event, threadId: number, input: AddFocusScopeSubjectInput) =>
      database.domain.threadScopes.addSubject(threadId, input)
  )
  ipcMain.handle(
    IPC_CHANNELS.removeThreadScopeSubject,
    (_event, threadId: number, subjectId: number) =>
      database.domain.threadScopes.removeSubject(threadId, subjectId)
  )
  ipcMain.handle(IPC_CHANNELS.followFocusThreadScope, (_event, threadId: number) =>
    database.domain.threadScopes.followFocus(threadId)
  )
  ipcMain.handle(IPC_CHANNELS.listThreads, (_event, focusId: number) =>
    database.domain.threads.listForFocus(focusId)
  )
  ipcMain.handle(IPC_CHANNELS.createThread, (_event, input: CreateThreadInput) =>
    database.domain.threads.create(input).snapshot()
  )
  ipcMain.handle(IPC_CHANNELS.updateThread, (_event, id: number, input: UpdateThreadInput) =>
    database.domain.threads.requireModel(id).update(input).snapshot()
  )
  ipcMain.handle(IPC_CHANNELS.listCommitments, (_event, parent: CommitmentParent) =>
    parent.type === 'focus'
      ? database.domain.commitments.listForFocus(parent.id)
      : database.domain.commitments.listForThread(parent.id)
  )
  ipcMain.handle(IPC_CHANNELS.getCommitmentWorkingContext, (_event, id: number) => {
    const commitment = database.domain.commitments.requireModel(id)
    return {
      commitmentId: id,
      scopeId: commitment.scopeApplication().effectiveScopeId,
      cells: commitment.scopeMatrix()
    }
  })
  ipcMain.handle(IPC_CHANNELS.createCommitment, (_event, input: CreateCommitmentInput) =>
    database.domain.commitments.create(input).snapshot()
  )
  ipcMain.handle(
    IPC_CHANNELS.updateCommitment,
    (_event, id: number, input: UpdateCommitmentInput) =>
      database.domain.commitments.requireModel(id).update(input).snapshot()
  )
  ipcMain.handle(IPC_CHANNELS.listUpdates, (_event, parent: UpdateParent) => {
    if (parent.type === 'focus') return database.domain.updates.listForFocus(parent.id)
    if (parent.type === 'thread') return database.domain.updates.listForThread(parent.id)
    return database.domain.updates.listForCommitment(parent.id)
  })
  ipcMain.handle(IPC_CHANNELS.createUpdate, (_event, input: CreateUpdateInput) =>
    database.domain.updates.create(input).toSnapshot()
  )
  ipcMain.handle(IPC_CHANNELS.updateUpdate, (_event, id: number, input: EditUpdateInput) =>
    database.domain.updates.requireModel(id).update(input).toSnapshot()
  )
  ipcMain.handle(IPC_CHANNELS.deleteUpdate, (_event, id: number) =>
    database.domain.updates.delete(id)
  )

  return () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel)
    }
  }
}
