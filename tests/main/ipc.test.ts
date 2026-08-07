import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/contracts'
import { registerAppIpc } from '../../src/main/ipc'

describe('registerAppIpc', () => {
  it('registers typed application handlers and removes them during cleanup', async () => {
    const handlers = new Map<string, (...arguments_: unknown[]) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...arguments_: unknown[]) => unknown) =>
        handlers.set(channel, handler)
      ),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel))
    }
    const state = {
      greeting: 'Hello, world.',
      greetingCount: 2,
      launchCount: 3,
      lastGreetingAt: null,
      databasePath: '/tmp/onmove.sqlite3'
    }
    const database = {
      getState: vi.fn(() => state),
      recordGreeting: vi.fn(() => ({ ...state, greetingCount: 3 })),
      domain: {
        relations: {
          create: vi.fn(() => ({ toSnapshot: () => ({ id: 4, name: 'blocks' }) })),
          delete: vi.fn(() => true)
        },
        items: {
          create: vi.fn(() => ({ materialize: () => ({ id: 8 }) })),
          findModel: vi.fn(() => ({ materialize: () => ({ id: 8 }) })),
          delete: vi.fn(() => true),
          requireModel: vi.fn(() => ({
            moveTo: vi.fn(() => ({ materialize: () => ({ id: 8, parentId: 2 }) })),
            setRelation: vi.fn(() => ({ materialize: () => ({ id: 8, relationId: 4 }) })),
            setStatus: vi.fn(() => ({
              materialize: () => ({ id: 8, status: { current: 'good' } })
            }))
          })),
          statusHistory: vi.fn(() => [{ id: 1, from: 'bad', to: 'good' }])
        },
        focuses: {
          list: vi.fn(() => [{ id: 12, title: 'Launch', status: 'active' }]),
          create: vi.fn(() => ({
            toSnapshot: () => ({ id: 13, title: 'New focus', status: 'active' })
          })),
          requireModel: vi.fn(() => ({
            update: vi.fn(() => ({
              toSnapshot: () => ({ id: 12, title: 'Updated', status: 'active' })
            })),
            setStatus: vi.fn(() => ({
              toSnapshot: () => ({ id: 12, title: 'Launch', status: 'paused' })
            }))
          })),
          delete: vi.fn(() => true),
          statusHistory: vi.fn(() => [{ id: 1, from: null, to: 'active' }])
        }
      }
    }
    const shell = { showItemInFolder: vi.fn() }

    const cleanup = registerAppIpc(ipcMain as never, database as never, shell as never)

    expect(ipcMain.handle).toHaveBeenCalledTimes(Object.keys(IPC_CHANNELS).length)
    expect(await handlers.get(IPC_CHANNELS.getAppState)?.()).toEqual(state)
    expect(await handlers.get(IPC_CHANNELS.recordGreeting)?.()).toMatchObject({ greetingCount: 3 })
    await handlers.get(IPC_CHANNELS.showDataFolder)?.()
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/tmp/onmove.sqlite3')

    expect(await handlers.get(IPC_CHANNELS.createRelation)?.(undefined, { name: 'blocks' })).toEqual({
      id: 4,
      name: 'blocks'
    })
    expect(await handlers.get(IPC_CHANNELS.createItem)?.(undefined, { status: 'good' })).toEqual({
      id: 8
    })
    expect(await handlers.get(IPC_CHANNELS.getItem)?.(undefined, 8)).toEqual({ id: 8 })
    expect(await handlers.get(IPC_CHANNELS.setItemStatus)?.(undefined, 8, {
      status: 'good'
    })).toMatchObject({ status: { current: 'good' } })
    expect(await handlers.get(IPC_CHANNELS.getItemStatusHistory)?.(undefined, 8)).toEqual([
      { id: 1, from: 'bad', to: 'good' }
    ])
    expect(await handlers.get(IPC_CHANNELS.listFocuses)?.()).toEqual([
      { id: 12, title: 'Launch', status: 'active' }
    ])
    expect(await handlers.get(IPC_CHANNELS.createFocus)?.(undefined, {
      title: 'New focus'
    })).toMatchObject({ id: 13, status: 'active' })
    expect(await handlers.get(IPC_CHANNELS.updateFocus)?.(undefined, 12, {
      title: 'Updated'
    })).toMatchObject({ title: 'Updated' })
    expect(await handlers.get(IPC_CHANNELS.setFocusStatus)?.(undefined, 12, 'paused')).toMatchObject({
      status: 'paused'
    })
    expect(await handlers.get(IPC_CHANNELS.deleteFocus)?.(undefined, 12)).toBe(true)
    expect(await handlers.get(IPC_CHANNELS.getFocusStatusHistory)?.(undefined, 12)).toEqual([
      { id: 1, from: null, to: 'active' }
    ])

    cleanup()
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(Object.keys(IPC_CHANNELS).length)
    expect(handlers.size).toBe(0)
  })
})
