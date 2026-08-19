import { join } from 'node:path'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell } from 'electron'
import { AppDatabase } from './database'
import { registerAppIpc } from './ipc'
import { createMenuTemplate } from './menu'
import { resolveDatabasePath } from './paths'
import { isAllowedExternalLink } from './external-links'
import { installTextContextMenu } from './text-context-menu'
import { OnMoveMcpRuntime } from '../mcp/live-server'
import {
  IPC_EVENTS,
  type McpSettingsSnapshot,
  type RichTextDocumentChange,
  type RichTextDocumentReference
} from '../shared/contracts'

app.setName('OnMove')

if (process.env.ONMOVE_USER_DATA_DIR) {
  app.setPath('userData', process.env.ONMOVE_USER_DATA_DIR)
}

let database: AppDatabase | undefined
let mcpRuntime: OnMoveMcpRuntime | undefined
let unregisterIpc: (() => void) | undefined
let sensitiveContentHidden = false
const richTextWindowTargets = new Map<number, RichTextDocumentReference>()
const MAX_IMPORT_BYTES = 512 * 1024 * 1024
let dataTransferInProgress = false
let backupMaintenanceTimer: NodeJS.Timeout | undefined
const BACKUP_MAINTENANCE_CHECK_MS = 60 * 60 * 1000
const MAIN_WINDOW_DEFAULT_WIDTH = 1120
const MAIN_WINDOW_DEFAULT_HEIGHT = 760
const MAIN_WINDOW_MIN_WIDTH = 1040
const MAIN_WINDOW_MIN_HEIGHT = 600
const WINDOW_SIZE_SAVE_DELAY_MS = 150
let pendingMainWindowSize: { width: number; height: number } | undefined
let windowSizeSaveTimer: NodeJS.Timeout | undefined

function flushMainWindowSize(): void {
  if (windowSizeSaveTimer) clearTimeout(windowSizeSaveTimer)
  windowSizeSaveTimer = undefined
  const size = pendingMainWindowSize
  pendingMainWindowSize = undefined
  if (!database || !size) return
  try {
    database.windowPreferences.setSize(size)
  } catch (error) {
    console.error('OnMove window size could not be saved:', error)
  }
}

function scheduleMainWindowSize(window: BrowserWindow): void {
  if (
    window.isDestroyed() ||
    window.isMaximized() ||
    window.isFullScreen()
  ) return
  const [width, height] = window.getSize()
  pendingMainWindowSize = { width, height }
  if (windowSizeSaveTimer) clearTimeout(windowSizeSaveTimer)
  windowSizeSaveTimer = setTimeout(flushMainWindowSize, WINDOW_SIZE_SAVE_DELAY_MS)
}

function initialMainWindowSize(): { width: number; height: number } {
  flushMainWindowSize()
  const saved = database?.windowPreferences.getSize()
  if (!saved) {
    return { width: MAIN_WINDOW_DEFAULT_WIDTH, height: MAIN_WINDOW_DEFAULT_HEIGHT }
  }

  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  return {
    width: Math.max(MAIN_WINDOW_MIN_WIDTH, Math.min(saved.width, workArea.width)),
    height: Math.max(MAIN_WINDOW_MIN_HEIGHT, Math.min(saved.height, workArea.height))
  }
}

function persistMainWindowResize(window: BrowserWindow): void {
  window.on('resize', () => scheduleMainWindowSize(window))
  window.on('resized', () => {
    scheduleMainWindowSize(window)
    flushMainWindowSize()
  })
}

function createWindow(richTextTarget?: RichTextDocumentReference): BrowserWindow {
  const initialSize = richTextTarget
    ? { width: 820, height: 720 }
    : initialMainWindowSize()
  const window = new BrowserWindow({
    ...initialSize,
    minWidth: richTextTarget ? 520 : MAIN_WINDOW_MIN_WIDTH,
    minHeight: richTextTarget ? 420 : MAIN_WINDOW_MIN_HEIGHT,
    show: false,
    backgroundColor: '#f7f7f5',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })

  if (richTextTarget) {
    const webContentsId = window.webContents.id
    richTextWindowTargets.set(webContentsId, structuredClone(richTextTarget))
    window.on('closed', () => richTextWindowTargets.delete(webContentsId))
  } else {
    persistMainWindowResize(window)
  }

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalLink(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  installTextContextMenu(window)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function openRichTextDocumentWindow(reference: RichTextDocumentReference): void {
  createWindow(reference)
}

function broadcastRichTextChange(change: RichTextDocumentChange): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_EVENTS.richTextDocumentChanged, change)
    }
  }
}

function invalidateNavigationBadges(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_EVENTS.navigationBadgesInvalidated)
    }
  }
}

function broadcastRoutinesChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_EVENTS.routinesChanged)
    }
  }
}

function broadcastDomainChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_EVENTS.domainChanged)
    }
  }
  invalidateNavigationBadges()
  broadcastRoutinesChanged()
}

function broadcastMcpSettingsChanged(settings: McpSettingsSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_EVENTS.mcpSettingsChanged, settings)
    }
  }
}

function showDataFolder(): void {
  if (database) {
    shell.showItemInFolder(database.getState().databasePath)
  }
}

function maintainRollingBackup(): void {
  try {
    database?.backups.createIfDue()
  } catch (error) {
    console.error('OnMove automatic backup failed:', error)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.'
}

async function exportData(): Promise<void> {
  if (!database || dataTransferInProgress) return
  dataTransferInProgress = true
  let temporaryPath: string | null = null
  try {
    const date = new Date().toISOString().slice(0, 10)
    const result = await dialog.showSaveDialog({
      title: 'Export OnMove Data',
      defaultPath: join(app.getPath('documents'), `OnMove Export ${date}.json`),
      message: 'The export includes all records, including content marked sensitive.',
      filters: [{ name: 'OnMove data archive', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return

    const archive = database.dataArchive.export(app.getVersion())
    temporaryPath = `${result.filePath}.onmove-export-${process.pid}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(archive, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
    await rename(temporaryPath, result.filePath)
    temporaryPath = null
    await dialog.showMessageBox({
      type: 'info',
      title: 'Export Complete',
      message: 'OnMove data was exported successfully.',
      detail: result.filePath,
      buttons: ['OK']
    })
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Export Failed',
      message: 'OnMove could not export your data.',
      detail: errorMessage(error),
      buttons: ['OK']
    })
  } finally {
    if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined)
    dataTransferInProgress = false
  }
}

async function importData(): Promise<void> {
  if (!database || dataTransferInProgress) return
  dataTransferInProgress = true
  let importCommitted = false
  try {
    const selected = await dialog.showOpenDialog({
      title: 'Import OnMove Data',
      message: 'Choose an OnMove JSON data archive.',
      properties: ['openFile'],
      filters: [{ name: 'OnMove data archive', extensions: ['json'] }]
    })
    const filePath = selected.filePaths[0]
    if (selected.canceled || !filePath) return

    const file = await stat(filePath)
    if (!file.isFile() || file.size > MAX_IMPORT_BYTES) {
      throw new Error('The selected archive is not a regular file or is larger than 512 MB.')
    }
    const source = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: 'Replace OnMove Data?',
      message: 'Importing replaces the data currently stored in OnMove.',
      detail:
        'The import is transactional: incompatible records are skipped, and the existing database is left unchanged if the archive cannot be made safe.',
      buttons: ['Cancel', 'Import and Replace'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (confirmation.response !== 1) return

    database.backups.create()
    const summary = database.dataArchive.import(source)
    importCommitted = true
    const compatibility = [
      summary.skippedRows > 0 ? `${summary.skippedRows} incompatible records skipped` : null,
      summary.repairedRows > 0 ? `${summary.repairedRows} required records repaired` : null,
      summary.ignoredTables.length > 0
        ? `${summary.ignoredTables.length} unknown tables ignored`
        : null,
      summary.ignoredFields.length > 0
        ? `${summary.ignoredFields.length} unknown fields ignored`
        : null
    ].filter((part): part is string => part !== null)
    await dialog.showMessageBox({
      type: 'info',
      title: 'Import Complete',
      message: 'OnMove imported the archive safely and will now reopen.',
      detail: compatibility.length > 0
        ? compatibility.join(' · ')
        : `${summary.importedRows} records imported`,
      buttons: ['Reopen OnMove']
    })
    app.relaunch()
    app.quit()
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Import Failed',
      message: importCommitted
        ? 'The data was imported, but OnMove could not finish reopening.'
        : 'No OnMove data was changed.',
      detail: errorMessage(error),
      buttons: ['OK']
    })
    if (importCommitted) {
      app.relaunch()
      app.quit()
    }
  } finally {
    dataTransferInProgress = false
  }
}

function setSensitiveContentHidden(hidden: boolean): void {
  sensitiveContentHidden = hidden
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_EVENTS.sensitiveContentVisibilityChanged, hidden)
  }
}

app.whenReady().then(async () => {
  database = new AppDatabase(resolveDatabasePath(app.getPath('userData')))
  database.recordLaunch()
  maintainRollingBackup()
  backupMaintenanceTimer = setInterval(maintainRollingBackup, BACKUP_MAINTENANCE_CHECK_MS)
  backupMaintenanceTimer.unref()
  mcpRuntime = new OnMoveMcpRuntime(database, broadcastDomainChanged)
  await mcpRuntime.initialize()
  unregisterIpc = registerAppIpc(
    ipcMain,
    database,
    mcpRuntime,
    shell,
    () => sensitiveContentHidden,
    {
      open: openRichTextDocumentWindow,
      targetFor: (webContentsId) => richTextWindowTargets.get(webContentsId) ?? null,
      broadcast: broadcastRichTextChange
    },
    invalidateNavigationBadges,
    broadcastRoutinesChanged,
    broadcastMcpSettingsChanged
  )

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createMenuTemplate({
        createWindow,
        importData: () => void importData(),
        exportData: () => void exportData(),
        showDataFolder,
        sensitiveContentHidden,
        setSensitiveContentHidden
      })
    )
  )

  createWindow()

  app.on('activate', () => {
    const hasMainWindow = BrowserWindow.getAllWindows().some(
      (window) => !richTextWindowTargets.has(window.webContents.id)
    )
    if (!hasMainWindow) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let shutdownInProgress = false
app.on('before-quit', (event) => {
  if (shutdownInProgress) return
  event.preventDefault()
  shutdownInProgress = true
  flushMainWindowSize()
  if (backupMaintenanceTimer) clearInterval(backupMaintenanceTimer)
  backupMaintenanceTimer = undefined
  unregisterIpc?.()
  unregisterIpc = undefined

  const runtime = mcpRuntime
  mcpRuntime = undefined
  void (runtime?.close() ?? Promise.resolve()).finally(() => {
    database?.close()
    database = undefined
    app.quit()
  })
})
