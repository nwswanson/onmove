import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createMenuTemplate } from '../../src/main/menu'

function submenuItems(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  return item.submenu as MenuItemConstructorOptions[]
}

describe('createMenuTemplate', () => {
  it('creates the conventional macOS application menu first', () => {
    const template = createMenuTemplate(
      { createWindow: vi.fn(), showDataFolder: vi.fn() },
      true
    )

    expect(template[0].label).toBe('OnMove')
    expect(submenuItems(template[0]).some((item) => item.role === 'about')).toBe(true)
    expect(submenuItems(template[0]).some((item) => item.role === 'services')).toBe(true)
    expect(submenuItems(template[0]).some((item) => item.role === 'quit')).toBe(true)
  })

  it('omits the application menu on non-macOS platforms', () => {
    const template = createMenuTemplate(
      { createWindow: vi.fn(), showDataFolder: vi.fn() },
      false
    )

    expect(template[0].label).toBe('File')
    expect(template.some((item) => item.label === 'OnMove')).toBe(false)
  })

  it('connects New Window and Show Data File actions', () => {
    const createWindow = vi.fn()
    const showDataFolder = vi.fn()
    const template = createMenuTemplate({ createWindow, showDataFolder }, true)
    const fileMenu = template.find((item) => item.label === 'File')!
    const helpMenu = template.find((item) => item.role === 'help')!

    submenuItems(fileMenu).find((item) => item.label === 'New Window')?.click?.({} as never, {} as never, {} as never)
    submenuItems(helpMenu)
      .find((item) => item.label === 'Show Data File in Finder')
      ?.click?.({} as never, {} as never, {} as never)

    expect(createWindow).toHaveBeenCalledOnce()
    expect(showDataFolder).toHaveBeenCalledOnce()
  })
})
