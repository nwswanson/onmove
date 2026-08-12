import { Menu } from 'electron'
import type {
  BrowserWindow,
  ContextMenuParams,
  MenuItemConstructorOptions
} from 'electron'

type EditFlags = ContextMenuParams['editFlags']

export interface TextContextMenuModel {
  editable: boolean
  hasSelection: boolean
  misspelledWord: string
  suggestions: readonly string[]
  editFlags: EditFlags
}

export interface TextContextMenuActions {
  replaceMisspelling: (suggestion: string) => void
  learnSpelling: (word: string) => void
}

function spellingItems(
  model: TextContextMenuModel,
  actions: TextContextMenuActions
): MenuItemConstructorOptions[] {
  if (!model.editable || !model.misspelledWord) return []

  const replacements: MenuItemConstructorOptions[] = model.suggestions.length > 0
    ? model.suggestions.slice(0, 8).map((suggestion) => ({
        label: suggestion,
        click: () => actions.replaceMisspelling(suggestion)
      }))
    : [{ label: 'No Replacements Found', enabled: false }]

  return [
    ...replacements,
    { type: 'separator' },
    {
      label: 'Learn Spelling',
      click: () => actions.learnSpelling(model.misspelledWord)
    },
    { type: 'separator' }
  ]
}

/** Builds the native, receiver-owned menu for editable and selected text. */
export function createTextContextMenuTemplate(
  model: TextContextMenuModel,
  actions: TextContextMenuActions,
  isMac = process.platform === 'darwin'
): MenuItemConstructorOptions[] {
  if (!model.editable) {
    return [
      { role: 'copy', enabled: model.editFlags.canCopy && model.hasSelection },
      { type: 'separator' },
      { role: 'selectAll', enabled: model.editFlags.canSelectAll }
    ]
  }

  return [
    ...spellingItems(model, actions),
    { role: 'undo', enabled: model.editFlags.canUndo },
    { role: 'redo', enabled: model.editFlags.canRedo },
    { type: 'separator' },
    { role: 'cut', enabled: model.editFlags.canCut },
    { role: 'copy', enabled: model.editFlags.canCopy },
    { role: 'paste', enabled: model.editFlags.canPaste },
    ...(isMac
      ? [{ role: 'pasteAndMatchStyle' as const, enabled: model.editFlags.canPaste }]
      : []),
    { role: 'delete', enabled: model.editFlags.canDelete },
    { type: 'separator' },
    { role: 'selectAll', enabled: model.editFlags.canSelectAll }
  ]
}

/** Enables OS spellchecking and attaches the native menu to one sandboxed window. */
export function installTextContextMenu(window: BrowserWindow): void {
  window.webContents.session.setSpellCheckerEnabled(true)
  window.webContents.on('context-menu', (_event, params) => {
    const hasSelection = params.selectionText.length > 0
    if (!params.isEditable && !hasSelection) return

    const menu = Menu.buildFromTemplate(createTextContextMenuTemplate(
      {
        editable: params.isEditable,
        hasSelection,
        misspelledWord: params.misspelledWord,
        suggestions: params.dictionarySuggestions,
        editFlags: params.editFlags
      },
      {
        replaceMisspelling: (suggestion) =>
          window.webContents.replaceMisspelling(suggestion),
        learnSpelling: (word) =>
          window.webContents.session.addWordToSpellCheckerDictionary(word)
      }
    ))
    menu.popup({
      window,
      frame: params.frame ?? undefined,
      x: params.x,
      y: params.y
    })
  })
}
