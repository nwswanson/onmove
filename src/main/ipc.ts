import type { IpcMain, IpcMainEvent, Shell } from 'electron'
import {
  IPC_CHANNELS,
  IPC_SYNC_CHANNELS,
  type AddFocusScopeSubjectInput,
  type AttestRoutineRunItemInput,
  type CommitmentParent,
  type CreateCommitmentInput,
  type CreateFocusInput,
  type CreateItemInput,
  type CreateRelationInput,
  type CreateRoutineInput,
  type CreateThreadInput,
  type CreateTodoInput,
  type CreateUpdateInput,
  type EditUpdateInput,
  type MoveCommitmentInput,
  type MoveThreadInput,
  type FocusStatus,
  type SetItemStatusInput,
  type TodoListOptions,
  type TodoParent,
  type NoteParent,
  type RichTextDocumentChange,
  type RichTextDocumentReference,
  type UpdateScopeCell,
  type UpdateParent,
  type UpdateCommitmentInput,
  type UpdateFocusInput,
  type UpdateRoutineInput,
  type UpdateThreadInput,
  type UpdateTodoInput
} from '../shared/contracts'
import type { AppDatabase } from './database'

type IpcRegistrar = Pick<IpcMain, 'handle' | 'removeHandler' | 'on' | 'removeListener'>
type FolderOpener = Pick<Shell, 'showItemInFolder' | 'openPath'>

export interface RichTextWindowCoordinator {
  open: (reference: RichTextDocumentReference) => void
  targetFor: (webContentsId: number) => RichTextDocumentReference | null
  broadcast: (change: RichTextDocumentChange) => void
}

const emptyRichTextWindows: RichTextWindowCoordinator = {
  open: () => undefined,
  targetFor: () => null,
  broadcast: () => undefined
}

export function registerAppIpc(
  ipcMain: IpcRegistrar,
  database: AppDatabase,
  shell: FolderOpener,
  getSensitiveContentHidden: () => boolean = () => false,
  richTextWindows: RichTextWindowCoordinator = emptyRichTextWindows,
  invalidateNavigationBadges: () => void = () => undefined
): () => void {
  function mutation<T>(operation: () => T): T {
    const result = operation()
    invalidateNavigationBadges()
    return result
  }

  ipcMain.handle(IPC_CHANNELS.getAppState, () => database.getState())
  ipcMain.handle(IPC_CHANNELS.getSensitiveContentHidden, getSensitiveContentHidden)
  ipcMain.handle(IPC_CHANNELS.recordGreeting, () => database.recordGreeting())
  ipcMain.handle(IPC_CHANNELS.showDataFolder, () => shell.showItemInFolder(database.getState().databasePath))
  ipcMain.handle(IPC_CHANNELS.getBackupState, () => database.backups.getState())
  ipcMain.handle(IPC_CHANNELS.createBackup, () => database.backups.create())
  ipcMain.handle(IPC_CHANNELS.showBackupFolder, async () => {
    const error = await shell.openPath(database.backups.ensureDirectory())
    if (error) throw new Error(error)
  })
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
    mutation(() => database.domain.focuses.create(input).toSnapshot())
  )
  ipcMain.handle(IPC_CHANNELS.updateFocus, (_event, id: number, input: UpdateFocusInput) =>
    mutation(() => database.domain.focuses.requireModel(id).update(input).toSnapshot())
  )
  ipcMain.handle(IPC_CHANNELS.pokeFocusReview, (_event, id: number) =>
    mutation(() => database.domain.focuses.requireModel(id).pokeReview().toSnapshot())
  )
  ipcMain.handle(IPC_CHANNELS.setFocusStatus, (_event, id: number, status: FocusStatus) =>
    mutation(() => database.domain.focuses.requireModel(id).setStatus(status).toSnapshot())
  )
  ipcMain.handle(IPC_CHANNELS.deleteFocus, (_event, id: number) =>
    mutation(() => database.domain.focuses.delete(id))
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
      mutation(() => database.domain.focusScopes.addSubject(focusId, input))
  )
  ipcMain.handle(
    IPC_CHANNELS.removeFocusScopeSubject,
    (_event, focusId: number, subjectId: number) =>
      mutation(() => database.domain.focusScopes.removeSubject(focusId, subjectId))
  )
  ipcMain.handle(IPC_CHANNELS.getThreadScope, (_event, threadId: number) =>
    database.domain.threadScopes.get(threadId)
  )
  ipcMain.handle(IPC_CHANNELS.getThreadSubjectMatrix, (_event, threadId: number) =>
    database.domain.threads.subjectMatrix(threadId)
  )
  ipcMain.handle(IPC_CHANNELS.customizeThreadScope, (_event, threadId: number) =>
    mutation(() => database.domain.threadScopes.customize(threadId))
  )
  ipcMain.handle(
    IPC_CHANNELS.addThreadScopeSubject,
    (_event, threadId: number, input: AddFocusScopeSubjectInput) =>
      mutation(() => database.domain.threadScopes.addSubject(threadId, input))
  )
  ipcMain.handle(
    IPC_CHANNELS.removeThreadScopeSubject,
    (_event, threadId: number, subjectId: number) =>
      mutation(() => database.domain.threadScopes.removeSubject(threadId, subjectId))
  )
  ipcMain.handle(IPC_CHANNELS.followFocusThreadScope, (_event, threadId: number) =>
    mutation(() => database.domain.threadScopes.followFocus(threadId))
  )
  ipcMain.handle(IPC_CHANNELS.listThreads, (_event, focusId: number) =>
    database.domain.threads.listForFocus(focusId)
  )
  ipcMain.handle(IPC_CHANNELS.createThread, (_event, input: CreateThreadInput) =>
    mutation(() => database.domain.threads.create(input).snapshot())
  )
  ipcMain.handle(IPC_CHANNELS.updateThread, (_event, id: number, input: UpdateThreadInput) =>
    mutation(() => database.domain.threads.requireModel(id).update(input).snapshot())
  )
  ipcMain.handle(IPC_CHANNELS.planThreadMove, (_event, id: number, focusId: number) =>
    database.domain.threads.planMove(id, focusId)
  )
  ipcMain.handle(IPC_CHANNELS.moveThread, (_event, id: number, input: MoveThreadInput) =>
    mutation(() => database.domain.threads.move(id, input))
  )
  ipcMain.handle(IPC_CHANNELS.pokeThreadReview, (_event, id: number, cell?: UpdateScopeCell) =>
    mutation(() => database.domain.threads.requireModel(id).pokeReview(new Date(), cell).snapshot())
  )
  ipcMain.handle(IPC_CHANNELS.deleteThread, (_event, id: number) =>
    mutation(() => database.domain.threads.delete(id))
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
    mutation(() => database.domain.commitments.create(input).snapshot())
  )
  ipcMain.handle(
    IPC_CHANNELS.updateCommitment,
    (_event, id: number, input: UpdateCommitmentInput) =>
      mutation(() => database.domain.commitments.requireModel(id).update(input).snapshot())
  )
  ipcMain.handle(
    IPC_CHANNELS.planCommitmentMove,
    (_event, id: number, parent: CommitmentParent) =>
      database.domain.commitments.planMove(id, parent)
  )
  ipcMain.handle(
    IPC_CHANNELS.moveCommitment,
    (_event, id: number, input: MoveCommitmentInput) =>
      mutation(() => database.domain.commitments.move(id, input))
  )
  ipcMain.handle(
    IPC_CHANNELS.pokeCommitmentReview,
    (_event, id: number, cell?: UpdateScopeCell) =>
      mutation(() =>
        database.domain.commitments.requireModel(id).pokeReview(new Date(), cell).snapshot())
  )
  ipcMain.handle(IPC_CHANNELS.deleteCommitment, (_event, id: number) =>
    mutation(() => database.domain.commitments.delete(id))
  )
  ipcMain.handle(IPC_CHANNELS.listRoutines, () => database.domain.routines.list())
  ipcMain.handle(IPC_CHANNELS.createRoutine, (_event, input: CreateRoutineInput) =>
    mutation(() => database.domain.routines.create(input).snapshot())
  )
  ipcMain.handle(IPC_CHANNELS.updateRoutine, (_event, id: number, input: UpdateRoutineInput) =>
    mutation(() => database.domain.routines.update(id, input))
  )
  ipcMain.handle(IPC_CHANNELS.deleteRoutine, (_event, id: number) =>
    mutation(() => database.domain.routines.delete(id))
  )
  ipcMain.handle(
    IPC_CHANNELS.attestRoutineCellItem,
    (_event, attestationId: number, input: AttestRoutineRunItemInput) =>
      mutation(() => database.domain.routines.attestCellItem(attestationId, input))
  )
  ipcMain.handle(IPC_CHANNELS.listUpdates, (_event, parent: UpdateParent) => {
    if (parent.type === 'focus') return database.domain.updates.listForFocus(parent.id)
    if (parent.type === 'thread') return database.domain.updates.listForThread(parent.id)
    return database.domain.updates.listForCommitment(parent.id)
  })
  ipcMain.handle(IPC_CHANNELS.createUpdate, (_event, input: CreateUpdateInput) =>
    mutation(() => database.domain.updates.create(input).toSnapshot())
  )
  ipcMain.handle(IPC_CHANNELS.updateUpdate, (_event, id: number, input: EditUpdateInput) =>
    mutation(() => database.domain.updates.requireModel(id).update(input).toSnapshot())
  )
  ipcMain.handle(IPC_CHANNELS.deleteUpdate, (_event, id: number) =>
    mutation(() => database.domain.updates.delete(id))
  )
  ipcMain.handle(IPC_CHANNELS.getArchivedUpdateOverview, () =>
    database.domain.archivedUpdates.overview()
  )
  ipcMain.handle(IPC_CHANNELS.deleteArchivedUpdate, (_event, archiveId: string) =>
    database.domain.archivedUpdates.delete(archiveId)
  )
  ipcMain.handle(IPC_CHANNELS.clearArchivedUpdates, () =>
    database.domain.archivedUpdates.clear()
  )
  ipcMain.handle(
    IPC_CHANNELS.listTodos,
    (_event, context: TodoParent, options?: TodoListOptions) =>
      database.domain.todos.list(context, options)
  )
  ipcMain.handle(IPC_CHANNELS.queryTodos, (_event, options?: TodoListOptions) =>
    database.domain.todos.query(options)
  )
  ipcMain.handle(IPC_CHANNELS.getTodoOverview, () =>
    database.domain.todos.overview()
  )
  ipcMain.handle(IPC_CHANNELS.createTodo, (_event, input: CreateTodoInput) =>
    mutation(() => database.domain.todos.create(input).toSnapshot())
  )
  ipcMain.handle(IPC_CHANNELS.updateTodo, (_event, id: number, input: UpdateTodoInput) =>
    mutation(() => database.domain.todos.requireModel(id).update(input).toSnapshot())
  )
  ipcMain.handle(
    IPC_CHANNELS.updateTodoSubjectCompletion,
    (_event, id: number, subjectId: number, done: boolean) =>
      mutation(() => database.domain.todos.updateSubjectCompletion(id, subjectId, done))
  )
  ipcMain.handle(
    IPC_CHANNELS.reorderTodos,
    (_event, context: TodoParent, orderedTodoIds: readonly number[]) =>
      database.domain.todos.reorder(context, orderedTodoIds)
  )
  ipcMain.handle(IPC_CHANNELS.deleteTodo, (_event, id: number) =>
    mutation(() => database.domain.todos.delete(id))
  )
  ipcMain.handle(IPC_CHANNELS.listNotes, (_event, parent: NoteParent) =>
    database.domain.notes.list(parent)
  )
  ipcMain.handle(IPC_CHANNELS.listTags, () => database.domain.tags.list())
  ipcMain.handle(IPC_CHANNELS.listTagUses, (_event, name: string) =>
    database.domain.tags.uses(name)
  )
  ipcMain.handle(IPC_CHANNELS.getNavigationBadgeOverview, () =>
    database.domain.navigation.getBadgeOverview()
  )
  ipcMain.handle(IPC_CHANNELS.getReviewOverview, () =>
    database.domain.reviews.getOverview()
  )
  ipcMain.handle(IPC_CHANNELS.getDueOverview, () =>
    database.domain.due.getOverview()
  )
  ipcMain.handle(
    IPC_CHANNELS.getRichTextDocument,
    (_event, reference: RichTextDocumentReference) =>
      database.domain.richTextDocuments.get(reference)
  )
  ipcMain.handle(
    IPC_CHANNELS.openRichTextDocumentWindow,
    (_event, reference: RichTextDocumentReference) => {
      database.domain.richTextDocuments.get(reference)
      richTextWindows.open(reference)
    }
  )
  ipcMain.handle(IPC_CHANNELS.getRichTextWindowTarget, (event) =>
    richTextWindows.targetFor(event.sender.id)
  )

  const saveRichTextDocument = (
    event: IpcMainEvent,
    reference: RichTextDocumentReference,
    value: string
  ): void => {
    try {
      const document = database.domain.richTextDocuments.save(reference, value)
      const change = { document, sourceWindowId: event.sender.id }
      richTextWindows.broadcast(change)
      event.returnValue = { ok: true, document }
    } catch (error) {
      event.returnValue = {
        ok: false,
        message: error instanceof Error ? error.message : 'The document could not be saved.'
      }
    }
  }
  ipcMain.on(IPC_SYNC_CHANNELS.saveRichTextDocument, saveRichTextDocument)

  return () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel)
    }
    ipcMain.removeListener(IPC_SYNC_CHANNELS.saveRichTextDocument, saveRichTextDocument)
  }
}
