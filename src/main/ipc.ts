import type { IpcMain, Shell } from 'electron'
import {
  IPC_CHANNELS,
  type CreateItemInput,
  type CreateRelationInput,
  type SetItemStatusInput
} from '../shared/contracts'
import type { AppDatabase } from './database'

type IpcRegistrar = Pick<IpcMain, 'handle' | 'removeHandler'>
type FolderOpener = Pick<Shell, 'showItemInFolder'>

export function registerAppIpc(
  ipcMain: IpcRegistrar,
  database: AppDatabase,
  shell: FolderOpener
): () => void {
  ipcMain.handle(IPC_CHANNELS.getAppState, () => database.getState())
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

  return () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel)
    }
  }
}
