import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type OnMoveApi } from '../shared/contracts'

const api: OnMoveApi = {
  getAppState: () => ipcRenderer.invoke(IPC_CHANNELS.getAppState),
  recordGreeting: () => ipcRenderer.invoke(IPC_CHANNELS.recordGreeting),
  showDataFolder: () => ipcRenderer.invoke(IPC_CHANNELS.showDataFolder),
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
    setFocusStatus: (id, status) =>
      ipcRenderer.invoke(IPC_CHANNELS.setFocusStatus, id, status),
    deleteFocus: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteFocus, id),
    getFocusStatusHistory: (id) =>
      ipcRenderer.invoke(IPC_CHANNELS.getFocusStatusHistory, id),
    listThreads: (focusId) => ipcRenderer.invoke(IPC_CHANNELS.listThreads, focusId),
    createThread: (input) => ipcRenderer.invoke(IPC_CHANNELS.createThread, input),
    listCommitments: (parent) => ipcRenderer.invoke(IPC_CHANNELS.listCommitments, parent),
    createCommitment: (input) => ipcRenderer.invoke(IPC_CHANNELS.createCommitment, input),
    listUpdates: (parent) => ipcRenderer.invoke(IPC_CHANNELS.listUpdates, parent),
    createUpdate: (input) => ipcRenderer.invoke(IPC_CHANNELS.createUpdate, input),
    updateUpdate: (id, input) => ipcRenderer.invoke(IPC_CHANNELS.updateUpdate, id, input),
    deleteUpdate: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteUpdate, id)
  }
}

contextBridge.exposeInMainWorld('onmove', api)
