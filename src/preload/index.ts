import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  IPC_SYNC_CHANNELS,
  type DomainChangeSnapshot,
  type OnMoveApi,
  type OnMoveEntityLinkTarget,
  type RichTextDocumentSnapshot
} from '../shared/contracts'

const entityLinkListeners = new Set<(target: OnMoveEntityLinkTarget) => void>()
const pendingEntityLinks: OnMoveEntityLinkTarget[] = []

// Install this before React boots so a cold-start URL delivered immediately
// after the document loads cannot be lost between preload and the first effect.
ipcRenderer.on(
  IPC_EVENTS.openEntityLink,
  (_event: Electron.IpcRendererEvent, target: OnMoveEntityLinkTarget) => {
    if (entityLinkListeners.size === 0) {
      pendingEntityLinks.push(target)
      return
    }
    for (const listener of entityLinkListeners) listener(target)
  }
)

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
  onDomainChanged: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      change: DomainChangeSnapshot
    ): void => listener(change)
    ipcRenderer.on(IPC_EVENTS.domainChanged, handler)
    return () => ipcRenderer.removeListener(IPC_EVENTS.domainChanged, handler)
  },
  onOpenEntityLink: (listener) => {
    entityLinkListeners.add(listener)
    while (pendingEntityLinks.length > 0) {
      const target = pendingEntityLinks.shift()
      if (target) listener(target)
    }
    return () => entityLinkListeners.delete(listener)
  },
  recordGreeting: () => ipcRenderer.invoke(IPC_CHANNELS.recordGreeting),
  showDataFolder: () => ipcRenderer.invoke(IPC_CHANNELS.showDataFolder),
  navigationPins: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.getNavigationPins),
    set: (target, pinned) =>
      ipcRenderer.invoke(IPC_CHANNELS.setNavigationPin, target, pinned),
    onChanged: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        pins: Parameters<typeof listener>[0]
      ): void => listener(pins)
      ipcRenderer.on(IPC_EVENTS.navigationPinsChanged, handler)
      return () => ipcRenderer.removeListener(IPC_EVENTS.navigationPinsChanged, handler)
    }
  },
  sidebarFolders: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.listSidebarFolders),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.createSidebarFolder, input),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteSidebarFolder, id),
    setMembership: (target, folderId) =>
      ipcRenderer.invoke(IPC_CHANNELS.setSidebarFolderMembership, target, folderId),
    onChanged: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        folders: Parameters<typeof listener>[0]
      ): void => listener(folders)
      ipcRenderer.on(IPC_EVENTS.sidebarFoldersChanged, handler)
      return () => ipcRenderer.removeListener(IPC_EVENTS.sidebarFoldersChanged, handler)
    }
  },
  backups: {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.getBackupState),
    createNow: () => ipcRenderer.invoke(IPC_CHANNELS.createBackup),
    showFolder: () => ipcRenderer.invoke(IPC_CHANNELS.showBackupFolder)
  },
  mcp: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.getMcpSettings),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.updateMcpSettings, input),
    setUiContext: (context) => ipcRenderer.invoke(IPC_CHANNELS.setMcpUiContext, context),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, settings: Parameters<typeof listener>[0]): void =>
        listener(settings)
      ipcRenderer.on(IPC_EVENTS.mcpSettingsChanged, handler)
      return () => ipcRenderer.removeListener(IPC_EVENTS.mcpSettingsChanged, handler)
    },
    getRetrievalStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getEnhancedRetrievalStatus),
    onRetrievalStatusChanged: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        status: Parameters<typeof listener>[0]
      ): void => listener(status)
      ipcRenderer.on(IPC_EVENTS.enhancedRetrievalStatusChanged, handler)
      return () => ipcRenderer.removeListener(
        IPC_EVENTS.enhancedRetrievalStatusChanged,
        handler
      )
    }
  },
  canvas: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.listCanvases),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.getCanvas, id),
    listEntities: () => ipcRenderer.invoke(IPC_CHANNELS.listCanvasEntities),
    resolveEntity: (target) => ipcRenderer.invoke(IPC_CHANNELS.resolveCanvasEntity, target),
    addEntityReference: (canvasId, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.addCanvasEntityReference, canvasId, input),
    saveDocument: (canvasId, input) =>
      ipcRenderer.invoke(IPC_CHANNELS.saveCanvasDocument, canvasId, input),
    onEntitiesChanged: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on(IPC_EVENTS.canvasEntitiesChanged, handler)
      return () => ipcRenderer.removeListener(IPC_EVENTS.canvasEntitiesChanged, handler)
    }
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
    getFocusOverviewTimeline: (focusId) =>
      ipcRenderer.invoke(IPC_CHANNELS.getFocusOverviewTimeline, focusId),
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
    listHistory: (reference) =>
      ipcRenderer.invoke(IPC_CHANNELS.listRichTextHistory, reference),
    restoreHistory: (reference, revision) =>
      ipcRenderer.invoke(IPC_CHANNELS.restoreRichTextHistory, reference, revision),
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
