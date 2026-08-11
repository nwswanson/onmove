import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS, IPC_SYNC_CHANNELS } from '../../src/shared/contracts'
import { registerAppIpc } from '../../src/main/ipc'

describe('registerAppIpc', () => {
  it('registers typed application handlers and removes them during cleanup', async () => {
    const handlers = new Map<string, (...arguments_: unknown[]) => unknown>()
    const listeners = new Map<string, (...arguments_: unknown[]) => unknown>()
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...arguments_: unknown[]) => unknown) =>
        handlers.set(channel, handler)
      ),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
      on: vi.fn((channel: string, handler: (...arguments_: unknown[]) => unknown) =>
        listeners.set(channel, handler)
      ),
      removeListener: vi.fn((channel: string) => listeners.delete(channel))
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
      backups: {
        getState: vi.fn(() => ({ retentionLimit: 10, backups: [{ fileName: 'backup.sqlite3' }] })),
        create: vi.fn(() => ({ retentionLimit: 10, backups: [{ fileName: 'new.sqlite3' }] })),
        ensureDirectory: vi.fn(() => '/tmp/Backups')
      },
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
            })),
            pokeReview: vi.fn(() => ({
              toSnapshot: () => ({ id: 12, title: 'Launch', lastReviewDate: '2026-08-10' })
            }))
          })),
          delete: vi.fn(() => true),
          statusHistory: vi.fn(() => [{ id: 1, from: null, to: 'active' }])
        },
        focusScopes: {
          get: vi.fn(() => ({ focusId: 12, mode: 'open', scopeId: null, subjects: [] })),
          addSubject: vi.fn(() => ({
            focusId: 12,
            mode: 'explicit',
            scopeId: 51,
            subjects: [{ id: 61, name: 'Customer Operations' }]
          })),
          removeSubject: vi.fn(() => ({
            focusId: 12,
            mode: 'explicit',
            scopeId: 51,
            subjects: []
          }))
        },
        threadScopes: {
          get: vi.fn(() => ({
            threadId: 21,
            focusId: 12,
            mode: 'inherited',
            scopeId: 51,
            subjects: [{ id: 61, name: 'Customer Operations' }],
            focusSubjects: [{ id: 61, name: 'Customer Operations' }]
          })),
          addSubject: vi.fn(() => ({
            threadId: 21,
            focusId: 12,
            mode: 'explicit',
            scopeId: 52,
            subjects: [
              { id: 61, name: 'Customer Operations' },
              { id: 62, name: 'Platform Team' }
            ],
            focusSubjects: [{ id: 61, name: 'Customer Operations' }]
          })),
          removeSubject: vi.fn(() => ({
            threadId: 21,
            focusId: 12,
            mode: 'explicit',
            scopeId: 53,
            subjects: [],
            focusSubjects: [{ id: 61, name: 'Customer Operations' }]
          })),
          followFocus: vi.fn(() => ({
            threadId: 21,
            focusId: 12,
            mode: 'inherited',
            scopeId: 51,
            subjects: [{ id: 61, name: 'Customer Operations' }],
            focusSubjects: [{ id: 61, name: 'Customer Operations' }]
          })),
          customize: vi.fn(() => ({
            threadId: 21,
            focusId: 12,
            mode: 'explicit',
            scopeId: 54,
            subjects: [{ id: 61, name: 'Customer Operations' }],
            focusSubjects: [{ id: 61, name: 'Customer Operations' }]
          })),
        },
        threads: {
          listForFocus: vi.fn(() => [{ id: 21, focusId: 12, title: 'Sprint execution' }]),
          planMove: vi.fn(() => ({
            threadId: 21,
            title: 'Sprint execution',
            fromFocusId: 12,
            toFocusId: 13,
            scopeStrategy: 'follow-destination',
            subjectsToAdd: [],
            ownedRecords: { commitments: 1, updates: 2, todos: 3, notes: 4 },
            requiresConfirmation: false
          })),
          move: vi.fn(() => ({
            id: 21,
            focusId: 13,
            title: 'Sprint execution'
          })),
          subjectMatrix: vi.fn(() => [{
            scopeId: 51,
            subjectId: 61,
            subject: { id: 61, name: 'Customer Operations' },
            state: 'green',
            lastReviewDate: '2026-08-08',
            nextReviewDate: '2026-08-15',
            reviewDue: false,
            commitments: []
          }]),
          create: vi.fn(() => ({
            snapshot: () => ({ id: 22, focusId: 12, title: 'Team health' })
          })),
          requireModel: vi.fn(() => ({
            update: vi.fn(() => ({
              snapshot: () => ({ id: 21, focusId: 12, title: 'Sprint execution', needsReview: false })
            })),
            pokeReview: vi.fn(() => ({
              snapshot: () => ({ id: 21, focusId: 12, lastReviewDate: '2026-08-10' })
            }))
          })),
          delete: vi.fn(() => true)
        },
        commitments: {
          listForFocus: vi.fn(() => [
            { id: 31, parent: { type: 'focus', id: 12 }, title: 'Ship safely' }
          ]),
          listForThread: vi.fn(() => [
            { id: 32, parent: { type: 'thread', id: 21 }, title: 'Refine weekly' }
          ]),
          requireModel: vi.fn(() => ({
            scopeApplication: vi.fn(() => ({ effectiveScopeId: 51 })),
            scopeMatrix: vi.fn(() => [{
              scopeId: 51,
              subjectId: 61,
              subject: { id: 61, name: 'Customer Operations' },
              state: 'green',
              lastUpdateDate: '2026-08-08',
              nextUpdateDate: null,
              needsUpdate: false
            }]),
            update: vi.fn(() => ({
              snapshot: () => ({ id: 31, title: 'Ship safely', status: 'paused' })
            })),
            pokeReview: vi.fn(() => ({
              snapshot: () => ({ id: 31, title: 'Ship safely', lastReviewDate: '2026-08-10' })
            }))
          })),
          create: vi.fn(() => ({
            snapshot: () => ({ id: 33, title: 'Align sponsors' })
          })),
          planMove: vi.fn(() => ({
            commitmentId: 31,
            from: { type: 'focus', id: 12 },
            to: { type: 'thread', id: 21 },
            scopeSubjectAdditions: [],
            requiresConfirmation: false
          })),
          move: vi.fn(() => ({
            id: 31,
            parent: { type: 'thread', id: 21 },
            title: 'Ship safely'
          })),
          delete: vi.fn(() => true)
        },
        updates: {
          listForFocus: vi.fn(() => [{ id: 41, observation: 'Focus update' }]),
          listForThread: vi.fn(() => [{ id: 42, observation: 'Thread update' }]),
          listForCommitment: vi.fn(() => [{ id: 43, observation: 'Commitment update' }]),
          create: vi.fn(() => ({
            toSnapshot: () => ({ id: 44, observation: 'Created update', state: 'green' })
          })),
          requireModel: vi.fn(() => ({
            update: vi.fn(() => ({
              toSnapshot: () => ({ id: 43, observation: 'Edited update', state: 'yellow' })
            }))
          })),
          delete: vi.fn(() => true)
        },
        todos: {
          list: vi.fn(() => [{ id: 71, name: 'Review plan', done: false }]),
          query: vi.fn(() => [{ id: 72, name: 'Cross-context Todo', done: false }]),
          overview: vi.fn(() => ({
            items: [{ id: 72, name: 'Cross-context Todo', done: false }],
            today: '2026-08-10',
            recentlyCompletedDays: 7,
            completedSince: '2026-08-03T12:00:00.000Z'
          })),
          create: vi.fn(() => ({
            toSnapshot: () => ({ id: 73, name: 'Created Todo', done: false })
          })),
          requireModel: vi.fn(() => ({
            update: vi.fn(() => ({
              toSnapshot: () => ({ id: 71, name: 'Edited Todo', done: true })
            }))
          })),
          updateSubjectCompletion: vi.fn(() => ({
            id: 74,
            name: 'Shared Todo',
            done: false,
            subjectCompletions: [{ subject: { id: 61 }, done: true }]
          })),
          reorder: vi.fn(() => [
            { id: 72, name: 'Second Todo' },
            { id: 71, name: 'Review plan' }
          ]),
          delete: vi.fn(() => true)
        },
        notes: {
          list: vi.fn(() => [{ id: 81, title: 'Default', content: '' }])
        },
        tags: {
          list: vi.fn(() => [{ name: 'launch', useCount: 2, sensitiveUseCount: 0 }]),
          uses: vi.fn(() => [{
            id: 'focus:12:goal:launch',
            name: 'launch',
            source: { type: 'focus', id: 12, field: 'goal' },
            snippet: 'Ship @Launch',
            effectiveSensitive: false
          }])
        },
        richTextDocuments: {
          get: vi.fn((reference) => ({
            reference,
            title: 'Launch — Goal',
            value: 'Ship',
            revision: 1,
            updatedAt: '2026-08-09T12:00:00.000Z'
          })),
          save: vi.fn((reference, value) => ({
            reference,
            title: 'Launch — Goal',
            value,
            revision: 2,
            updatedAt: '2026-08-09T12:01:00.000Z'
          }))
        }
      }
    }
    const shell = { showItemInFolder: vi.fn(), openPath: vi.fn().mockResolvedValue('') }

    const cleanup = registerAppIpc(
      ipcMain as never,
      database as never,
      shell as never,
      () => true
    )

    expect(ipcMain.handle).toHaveBeenCalledTimes(Object.keys(IPC_CHANNELS).length)
    expect(await handlers.get(IPC_CHANNELS.getAppState)?.()).toEqual(state)
    expect(await handlers.get(IPC_CHANNELS.getSensitiveContentHidden)?.()).toBe(true)
    expect(await handlers.get(IPC_CHANNELS.recordGreeting)?.()).toMatchObject({ greetingCount: 3 })
    await handlers.get(IPC_CHANNELS.showDataFolder)?.()
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/tmp/onmove.sqlite3')
    expect(await handlers.get(IPC_CHANNELS.getBackupState)?.()).toMatchObject({
      retentionLimit: 10,
      backups: [{ fileName: 'backup.sqlite3' }]
    })
    expect(await handlers.get(IPC_CHANNELS.createBackup)?.()).toMatchObject({
      backups: [{ fileName: 'new.sqlite3' }]
    })
    await handlers.get(IPC_CHANNELS.showBackupFolder)?.()
    expect(shell.openPath).toHaveBeenCalledWith('/tmp/Backups')

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
    expect(await handlers.get(IPC_CHANNELS.pokeFocusReview)?.(undefined, 12)).toMatchObject({
      lastReviewDate: '2026-08-10'
    })
    expect(await handlers.get(IPC_CHANNELS.setFocusStatus)?.(undefined, 12, 'paused')).toMatchObject({
      status: 'paused'
    })
    expect(await handlers.get(IPC_CHANNELS.deleteFocus)?.(undefined, 12)).toBe(true)
    expect(await handlers.get(IPC_CHANNELS.getFocusStatusHistory)?.(undefined, 12)).toEqual([
      { id: 1, from: null, to: 'active' }
    ])
    expect(await handlers.get(IPC_CHANNELS.getFocusScope)?.(undefined, 12)).toEqual({
      focusId: 12,
      mode: 'open',
      scopeId: null,
      subjects: []
    })
    expect(await handlers.get(IPC_CHANNELS.addFocusScopeSubject)?.(
      undefined,
      12,
      { name: 'Customer Operations' }
    )).toMatchObject({
      mode: 'explicit',
      subjects: [{ id: 61, name: 'Customer Operations' }]
    })
    expect(await handlers.get(IPC_CHANNELS.removeFocusScopeSubject)?.(
      undefined,
      12,
      61
    )).toMatchObject({ mode: 'explicit', subjects: [] })
    expect(await handlers.get(IPC_CHANNELS.getThreadScope)?.(undefined, 21)).toMatchObject({
      mode: 'inherited',
      subjects: [{ id: 61, name: 'Customer Operations' }]
    })
    expect(await handlers.get(IPC_CHANNELS.getThreadSubjectMatrix)?.(undefined, 21)).toMatchObject([
      { subjectId: 61, state: 'green', commitments: [] }
    ])
    expect(await handlers.get(IPC_CHANNELS.customizeThreadScope)?.(undefined, 21)).toMatchObject({
      mode: 'explicit',
      scopeId: 54
    })
    expect(await handlers.get(IPC_CHANNELS.addThreadScopeSubject)?.(
      undefined,
      21,
      { name: 'Platform Team' }
    )).toMatchObject({ mode: 'explicit', subjects: [{ id: 61 }, { id: 62 }] })
    expect(await handlers.get(IPC_CHANNELS.removeThreadScopeSubject)?.(
      undefined,
      21,
      61
    )).toMatchObject({ mode: 'explicit', subjects: [] })
    expect(await handlers.get(IPC_CHANNELS.followFocusThreadScope)?.(
      undefined,
      21
    )).toMatchObject({ mode: 'inherited', scopeId: 51 })
    expect(await handlers.get(IPC_CHANNELS.listThreads)?.(undefined, 12)).toMatchObject([
      { id: 21, title: 'Sprint execution' }
    ])
    expect(await handlers.get(IPC_CHANNELS.createThread)?.(undefined, {
      focusId: 12,
      title: 'Team health',
      reviewFrequencyDays: 7
    })).toMatchObject({ id: 22, title: 'Team health' })
    expect(await handlers.get(IPC_CHANNELS.updateThread)?.(undefined, 21, {
      needsReview: false
    })).toMatchObject({ id: 21, needsReview: false })
    expect(await handlers.get(IPC_CHANNELS.planThreadMove)?.(undefined, 21, 13)).toMatchObject({
      threadId: 21,
      fromFocusId: 12,
      toFocusId: 13,
      requiresConfirmation: false
    })
    expect(await handlers.get(IPC_CHANNELS.moveThread)?.(undefined, 21, {
      focusId: 13,
      plannedFromFocusId: 12
    })).toMatchObject({ id: 21, focusId: 13 })
    expect(await handlers.get(IPC_CHANNELS.pokeThreadReview)?.(undefined, 21)).toMatchObject({
      id: 21,
      lastReviewDate: '2026-08-10'
    })
    expect(await handlers.get(IPC_CHANNELS.deleteThread)?.(undefined, 21)).toBe(true)
    expect(await handlers.get(IPC_CHANNELS.listCommitments)?.(undefined, {
      type: 'focus',
      id: 12
    })).toMatchObject([{ id: 31, title: 'Ship safely' }])
    expect(await handlers.get(IPC_CHANNELS.listCommitments)?.(undefined, {
      type: 'thread',
      id: 21
    })).toMatchObject([{ id: 32, title: 'Refine weekly' }])
    expect(await handlers.get(IPC_CHANNELS.getCommitmentWorkingContext)?.(
      undefined,
      31
    )).toMatchObject({
      commitmentId: 31,
      scopeId: 51,
      cells: [{ subjectId: 61, state: 'green' }]
    })
    expect(await handlers.get(IPC_CHANNELS.createCommitment)?.(undefined, {
      parent: { type: 'focus', id: 12 },
      type: 'ongoing',
      title: 'Align sponsors'
    })).toMatchObject({ id: 33, title: 'Align sponsors' })
    expect(await handlers.get(IPC_CHANNELS.updateCommitment)?.(undefined, 31, {
      status: 'paused'
    })).toMatchObject({ id: 31, status: 'paused' })
    expect(await handlers.get(IPC_CHANNELS.planCommitmentMove)?.(
      undefined,
      31,
      { type: 'thread', id: 21 }
    )).toMatchObject({ commitmentId: 31, requiresConfirmation: false })
    expect(await handlers.get(IPC_CHANNELS.moveCommitment)?.(
      undefined,
      31,
      { parent: { type: 'thread', id: 21 } }
    )).toMatchObject({ id: 31, parent: { type: 'thread', id: 21 } })
    expect(await handlers.get(IPC_CHANNELS.pokeCommitmentReview)?.(undefined, 31)).toMatchObject({
      id: 31,
      lastReviewDate: '2026-08-10'
    })
    expect(await handlers.get(IPC_CHANNELS.deleteCommitment)?.(undefined, 31)).toBe(true)
    expect(await handlers.get(IPC_CHANNELS.listUpdates)?.(undefined, {
      type: 'commitment',
      id: 31
    })).toMatchObject([{ id: 43, observation: 'Commitment update' }])
    expect(await handlers.get(IPC_CHANNELS.createUpdate)?.(undefined, {
      parent: { type: 'commitment', id: 31 },
      observation: 'Created update',
      state: 'green'
    })).toMatchObject({ id: 44, state: 'green' })
    expect(await handlers.get(IPC_CHANNELS.updateUpdate)?.(undefined, 43, {
      observation: 'Edited update',
      state: 'yellow'
    })).toMatchObject({ id: 43, observation: 'Edited update', state: 'yellow' })
    expect(await handlers.get(IPC_CHANNELS.deleteUpdate)?.(undefined, 43)).toBe(true)
    expect(await handlers.get(IPC_CHANNELS.listTodos)?.(undefined, {
      type: 'thread',
      id: 21
    }, { done: false })).toMatchObject([{ id: 71, name: 'Review plan' }])
    expect(await handlers.get(IPC_CHANNELS.queryTodos)?.(undefined, {
      dueOnOrBefore: '2026-08-09'
    })).toMatchObject([{ id: 72, name: 'Cross-context Todo' }])
    expect(await handlers.get(IPC_CHANNELS.getTodoOverview)?.()).toMatchObject({
      items: [{ id: 72, name: 'Cross-context Todo' }],
      recentlyCompletedDays: 7
    })
    expect(await handlers.get(IPC_CHANNELS.createTodo)?.(undefined, {
      parent: { type: 'thread', id: 21 },
      name: 'Created Todo'
    })).toMatchObject({ id: 73, name: 'Created Todo' })
    expect(await handlers.get(IPC_CHANNELS.updateTodo)?.(undefined, 71, {
      done: true
    })).toMatchObject({ id: 71, done: true })
    expect(await handlers.get(IPC_CHANNELS.updateTodoSubjectCompletion)?.(
      undefined,
      74,
      61,
      true
    )).toMatchObject({
      id: 74,
      subjectCompletions: [{ subject: { id: 61 }, done: true }]
    })
    expect(await handlers.get(IPC_CHANNELS.reorderTodos)?.(undefined, {
      type: 'thread',
      id: 21
    }, [72, 71])).toMatchObject([{ id: 72 }, { id: 71 }])
    expect(await handlers.get(IPC_CHANNELS.deleteTodo)?.(undefined, 71)).toBe(true)
    expect(await handlers.get(IPC_CHANNELS.listNotes)?.(undefined, {
      type: 'focus', id: 12
    })).toEqual([{ id: 81, title: 'Default', content: '' }])
    expect(await handlers.get(IPC_CHANNELS.listTags)?.()).toEqual([
      { name: 'launch', useCount: 2, sensitiveUseCount: 0 }
    ])
    expect(await handlers.get(IPC_CHANNELS.listTagUses)?.(undefined, 'launch')).toMatchObject([
      { id: 'focus:12:goal:launch', name: 'launch', snippet: 'Ship @Launch' }
    ])
    expect(await handlers.get(IPC_CHANNELS.getRichTextDocument)?.(undefined, {
      type: 'focus', id: 12, field: 'goal'
    })).toMatchObject({ value: 'Ship', revision: 1 })

    const syncEvent = { sender: { id: 7 }, returnValue: undefined as unknown }
    listeners.get(IPC_SYNC_CHANNELS.saveRichTextDocument)?.(
      syncEvent,
      { type: 'focus', id: 12, field: 'goal' },
      'Ship now'
    )
    expect(syncEvent.returnValue).toMatchObject({
      ok: true,
      document: { value: 'Ship now', revision: 2 }
    })

    cleanup()
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(Object.keys(IPC_CHANNELS).length)
    expect(ipcMain.removeListener).toHaveBeenCalledWith(
      IPC_SYNC_CHANNELS.saveRichTextDocument,
      expect.any(Function)
    )
    expect(handlers.size).toBe(0)
  })
})
