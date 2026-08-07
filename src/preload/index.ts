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
      ipcRenderer.invoke(IPC_CHANNELS.getItemStatusHistory, id)
  }
}

contextBridge.exposeInMainWorld('onmove', api)
