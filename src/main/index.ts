import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { AppDatabase } from './database'
import { registerAppIpc } from './ipc'
import { createMenuTemplate } from './menu'
import { resolveDatabasePath } from './paths'

app.setName('OnMove')

if (process.env.ONMOVE_USER_DATA_DIR) {
  app.setPath('userData', process.env.ONMOVE_USER_DATA_DIR)
}

let database: AppDatabase | undefined
let unregisterIpc: (() => void) | undefined

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: '#f7f7f5',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function showDataFolder(): void {
  if (database) {
    shell.showItemInFolder(database.getState().databasePath)
  }
}

app.whenReady().then(() => {
  database = new AppDatabase(resolveDatabasePath(app.getPath('userData')))
  database.recordLaunch()
  unregisterIpc = registerAppIpc(ipcMain, database, shell)

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createMenuTemplate({
        createWindow,
        showDataFolder
      })
    )
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  unregisterIpc?.()
  unregisterIpc = undefined
  database?.close()
  database = undefined
})
