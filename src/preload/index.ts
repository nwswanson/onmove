import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  IPC_SYNC_CHANNELS,
  type OnMoveApi,
  type RichTextDocumentSnapshot
} from '../shared/contracts'

const api: OnMoveApi = {
  getAppState: () => ipcRenderer.invoke(IPC_CHANNELS.getAppState),
  getSensitiveContentHidden: () => ipcRenderer.invoke(IPC_CHANNELS.getSensitiveContentHidden),
  onSensitiveContentVisibilityChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, hidden: boolean): void => listener(hidden)
    ipcRenderer.on(IPC_EVENTS.sensitiveContentVisibilityChanged, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.sensitiveContentVisibilityChanged, handler)
  },
  onNavigationBadgesInvalidated: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(IPC_EVENTS.navigationBadgesInvalidated, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.navigationBadgesInvalidated, handler)
  },
  onRoutinesChanged: (listener) => {
    const handler = (): void => listener()
    ipcRenderer.on(IPC_EVENTS.routinesChanged, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.routinesChanged, handler)
  },
  recordGreeting: () => ipcRenderer.invoke(IPC_CHANNELS.recordGreeting),
  showDataFolder: () => ipcRenderer.invoke(IPC_CHANNELS.showDataFolder),
  backups: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.getBackupState),
    createNow: () => ipcRenderer.invoke(IPC_CHANNELS.createBackup),
    showFolder: () => ipcRenderer.invoke(IPC_CHANNELS.showBackupFolder)
  },
  domain: {
    createRelation: (input) => ipcRenderer.invoke(IPC_CHANNELS.createRelation, input),
    deleteRelation: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteRelation, id),
    createItem: (input) => ipcRenderer.invoke(IPC_CHANNELS.createItem, input),
    getItem: (id) => ipcRenderer.invoke(IPC_CHANNELS.getItem, id),
    deleteItem: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteItem, id),
    moveItem: (id, parentId) => ipcRenderer.invoke(IPC_CHANNELS.moveItem, id, parentId),
    setItemRelation: (id, relationId) =>
      ipcRenderer.invoke(IPC_CHANNELS.setItemRelation, id, relationId),
    setItemStatus: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.setItemStatus, id, input),
    getItemStatusHistory: (id) =>
      ipcRenderer.invoke(IPC_CHANNELS.getItemStatusHistory, id),
    listFocuses: () => ipcRenderer.invoke(IPC_CHANNELS.listFocuses),
    createFocus: (input) => ipcRenderer.invoke(IPC_CHANNELS.createFocus, input),
    updateFocus: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.updateFocus, id, input),
    pokeFocusReview: (id) => ipcRenderer.invoke(IPC_CHANNELS.pokeFocusReview, id),
    setFocusStatus: (id, status) =>
      ipcRenderer.invoke(IPC_CHANNELS.setFocusStatus, id, status),
    deleteFocus: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteFocus, id),
    getFocusStatusHistory: (id) =>
      ipcRenderer.invoke(IPC_CHANNELS.getFocusStatusHistory, id),
    getFocusScope: (focusId) => ipcRenderer.invoke(IPC_CHANNELS.getFocusScope, focusId),
    addFocusScopeSubject: (focusId, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.addFocusScopeSubject, focusId, input),
    removeFocusScopeSubject: (focusId, subjectId) =>
      ipcRenderer.invoke(IPC_CHANNELS.removeFocusScopeSubject, focusId, subjectId),
    getThreadScope: (threadId) => ipcRenderer.invoke(IPC_CHANNELS.getThreadScope, threadId),
    getThreadSubjectMatrix: (threadId) =>
      ipcRenderer.invoke(IPC_CHANNELS.getThreadSubjectMatrix, threadId),
    customizeThreadScope: (threadId) =>
      ipcRenderer.invoke(IPC_CHANNELS.customizeThreadScope, threadId),
    addThreadScopeSubject: (threadId, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.addThreadScopeSubject, threadId, input),
    removeThreadScopeSubject: (threadId, subjectId) =>
      ipcRenderer.invoke(IPC_CHANNELS.removeThreadScopeSubject, threadId, subjectId),
    followFocusThreadScope: (threadId) =>
      ipcRenderer.invoke(IPC_CHANNELS.followFocusThreadScope, threadId),
    listThreads: (focusId) => ipcRenderer.invoke(IPC_CHANNELS.listThreads, focusId),
    createThread: (input) => ipcRenderer.invoke(IPC_CHANNELS.createThread, input),
    updateThread: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.updateThread, id, input),
    planThreadMove: (id, focusId) =>
      ipcRenderer.invoke(IPC_CHANNELS.planThreadMove, id, focusId),
    moveThread: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.moveThread, id, input),
    pokeThreadReview: (id, cell) =>
      ipcRenderer.invoke(IPC_CHANNELS.pokeThreadReview, id, cell),
    deleteThread: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteThread, id),
    listCommitments: (parent) => ipcRenderer.invoke(IPC_CHANNELS.listCommitments, parent),
    getCommitmentWorkingContext: (commitmentId) =>
      ipcRenderer.invoke(IPC_CHANNELS.getCommitmentWorkingContext, commitmentId),
    createCommitment: (input) => ipcRenderer.invoke(IPC_CHANNELS.createCommitment, input),
    updateCommitment: (id, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.updateCommitment, id, input),
    planCommitmentMove: (id, parent) =>
      ipcRenderer.invoke(IPC_CHANNELS.planCommitmentMove, id, parent),
    moveCommitment: (id, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.moveCommitment, id, input),
    pokeCommitmentReview: (id, cell) =>
      ipcRenderer.invoke(IPC_CHANNELS.pokeCommitmentReview, id, cell),
    deleteCommitment: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteCommitment, id),
    listRoutines: () => ipcRenderer.invoke(IPC_CHANNELS.listRoutines),
    createRoutine: (input) => ipcRenderer.invoke(IPC_CHANNELS.createRoutine, input),
    updateRoutine: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.updateRoutine, id, input),
    planRoutineMove: (id, parent) =>
      ipcRenderer.invoke(IPC_CHANNELS.planRoutineMove, id, parent),
    moveRoutine: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.moveRoutine, id, input),
    deleteRoutine: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteRoutine, id),
    attestRoutineCellItem: (attestationId, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.attestRoutineCellItem, attestationId, input),
    finalizeRoutineCell: (cellId) =>
      ipcRenderer.invoke(IPC_CHANNELS.finalizeRoutineCell, cellId),
    listUpdates: (parent) => ipcRenderer.invoke(IPC_CHANNELS.listUpdates, parent),
    createUpdate: (input) => ipcRenderer.invoke(IPC_CHANNELS.createUpdate, input),
    updateUpdate: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.updateUpdate, id, input),
    deleteUpdate: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteUpdate, id),
    getArchivedUpdateOverview: () =>
      ipcRenderer.invoke(IPC_CHANNELS.getArchivedUpdateOverview),
    deleteArchivedUpdate: (archiveId) =>
      ipcRenderer.invoke(IPC_CHANNELS.deleteArchivedUpdate, archiveId),
    clearArchivedUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.clearArchivedUpdates),
    listTodos: (context, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.listTodos, context, options),
    queryTodos: (options) => ipcRenderer.invoke(IPC_CHANNELS.queryTodos, options),
    getTodoOverview: () => ipcRenderer.invoke(IPC_CHANNELS.getTodoOverview),
    createTodo: (input) => ipcRenderer.invoke(IPC_CHANNELS.createTodo, input),
    updateTodo: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.updateTodo, id, input),
    updateTodoSubjectCompletion: (id, subjectId, done) =>
      ipcRenderer.invoke(IPC_CHANNELS.updateTodoSubjectCompletion, id, subjectId, done),
    reorderTodos: (context, orderedTodoIds) =>
      ipcRenderer.invoke(IPC_CHANNELS.reorderTodos, context, orderedTodoIds),
    deleteTodo: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteTodo, id),
    listNotes: (parent) => ipcRenderer.invoke(IPC_CHANNELS.listNotes, parent),
    listTags: () => ipcRenderer.invoke(IPC_CHANNELS.listTags),
    listTagUses: (name) => ipcRenderer.invoke(IPC_CHANNELS.listTagUses, name),
    getNavigationBadgeOverview: () =>
      ipcRenderer.invoke(IPC_CHANNELS.getNavigationBadgeOverview),
    getReviewOverview: () => ipcRenderer.invoke(IPC_CHANNELS.getReviewOverview),
    getDueOverview: () => ipcRenderer.invoke(IPC_CHANNELS.getDueOverview)
  },
  richText: {
    getDocument: (reference) =>
      ipcRenderer.invoke(IPC_CHANNELS.getRichTextDocument, reference),
    saveDocument: (reference, value) => {
      const result = ipcRenderer.sendSync(
        IPC_SYNC_CHANNELS.saveRichTextDocument,
        reference,
        value
      ) as
        | { ok: true; document: RichTextDocumentSnapshot }
        | { ok: false; message: string }
      if (!result.ok) throw new Error(result.message)
      return result.document
    },
    openWindow: (reference) =>
      ipcRenderer.invoke(IPC_CHANNELS.openRichTextDocumentWindow, reference),
    getWindowTarget: () => ipcRenderer.invoke(IPC_CHANNELS.getRichTextWindowTarget),
    onDocumentChanged: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        change: Parameters<typeof listener>[0]
      ): void => listener(change)
      ipcRenderer.on(IPC_EVENTS.richTextDocumentChanged, handler)
      return () => ipcRenderer.removeListener(IPC_EVENTS.richTextDocumentChanged, handler)
    }
  }
}

contextBridge.exposeInMainWorld('onmove', api)
