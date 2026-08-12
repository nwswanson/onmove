import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  createTextContextMenuTemplate,
  type TextContextMenuActions,
  type TextContextMenuModel
} from '../../src/main/text-context-menu'

function model(overrides: Partial<TextContextMenuModel> = {}): TextContextMenuModel {
  return {
    editable: true,
    hasSelection: true,
    misspelledWord: '',
    suggestions: [],
    editFlags: {
      canUndo: true,
      canRedo: true,
      canCut: true,
      canCopy: true,
      canPaste: true,
      canDelete: true,
      canSelectAll: true,
      canEditRichly: true
    } satisfies ContextMenuParams['editFlags'],
    ...overrides
  }
}

function actions(): TextContextMenuActions {
  return {
    replaceMisspelling: vi.fn(),
    learnSpelling: vi.fn()
  }
}

function itemWithRole(
  template: MenuItemConstructorOptions[],
  role: MenuItemConstructorOptions['role']
): MenuItemConstructorOptions {
  const item = template.find((candidate) => candidate.role === role)
  if (!item) throw new Error(`Missing ${role} menu role`)
  return item
}

describe('text context menu', () => {
  it('uses native edit roles and the renderer-provided availability flags', () => {
    const template = createTextContextMenuTemplate(model({
      editFlags: { ...model().editFlags, canUndo: false, canPaste: false }
    }), actions(), true)

    expect(itemWithRole(template, 'undo').enabled).toBe(false)
    expect(itemWithRole(template, 'redo').enabled).toBe(true)
    expect(itemWithRole(template, 'cut').enabled).toBe(true)
    expect(itemWithRole(template, 'copy').enabled).toBe(true)
    expect(itemWithRole(template, 'paste').enabled).toBe(false)
    expect(itemWithRole(template, 'pasteAndMatchStyle').enabled).toBe(false)
    expect(itemWithRole(template, 'delete').enabled).toBe(true)
    expect(itemWithRole(template, 'selectAll').enabled).toBe(true)
  })

  it('offers bounded spellcheck replacements and dictionary learning', () => {
    const menuActions = actions()
    const template = createTextContextMenuTemplate(model({
      misspelledWord: 'mispeling',
      suggestions: ['misspelling', 'dispelling']
    }), menuActions)

    const replacement = template.find(({ label }) => label === 'misspelling')!
    replacement.click?.({} as never, {} as never, {} as never)
    const learn = template.find(({ label }) => label === 'Learn Spelling')!
    learn.click?.({} as never, {} as never, {} as never)

    expect(menuActions.replaceMisspelling).toHaveBeenCalledWith('misspelling')
    expect(menuActions.learnSpelling).toHaveBeenCalledWith('mispeling')
  })

  it('shows a native no-replacements state and limits read-only selections', () => {
    const misspelled = createTextContextMenuTemplate(model({
      misspelledWord: 'zzzzzz',
      suggestions: []
    }), actions())
    expect(misspelled.find(({ label }) => label === 'No Replacements Found'))
      .toMatchObject({ enabled: false })

    const selection = createTextContextMenuTemplate(model({
      editable: false,
      misspelledWord: '',
      hasSelection: true
    }), actions())
    expect(selection.filter(({ role }) => role).map(({ role }) => role))
      .toEqual(['copy', 'selectAll'])
  })
})
