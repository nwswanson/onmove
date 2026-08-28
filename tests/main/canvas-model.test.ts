import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('Canvas model', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-canvas-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function createHierarchy() {
    const focus = database.domain.focuses.create({ title: 'Project Atlas' })
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Delivery confidence',
      dueDate: '2026-09-04',
      reviewFrequencyDays: 7
    })
    const commitment = database.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Keep sponsors aligned',
      dueDate: '2026-09-01'
    })
    const routine = database.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Inspect the weekly report',
      scheduleWeekdays: [],
      checklist: [{ inspection: 'Verify delivery risks were represented.' }]
    })
    const todo = database.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: 'Share the revised plan',
      dueDate: '2026-08-30'
    })
    const note = database.domain.notes.list({ type: 'thread', id: thread.id })[0]
    return { focus, thread, commitment, routine, todo, note }
  }

  it('creates one addressable default Canvas and lists every supported live entity kind', () => {
    const hierarchy = createHierarchy()
    database.domain.updates.create({
      parent: { type: 'commitment', id: hierarchy.commitment.id },
      date: '2026-08-27',
      observation: 'Sponsors approved the revised plan.',
      state: 'green'
    })
    database.domain.richTextDocuments.save(
      { type: 'note', id: hierarchy.note.id, field: 'content' },
      'Decisions and rollout context for the delivery team.'
    )

    expect(database.domain.canvases.list()).toEqual([
      expect.objectContaining({ id: 1, name: 'Default', revision: 0 })
    ])
    expect(database.domain.canvases.get(1)).toMatchObject({
      id: 1,
      name: 'Default',
      data: null,
      references: []
    })

    const entities = database.domain.canvases.listEntities()
    expect(entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: { type: 'thread', id: hierarchy.thread.id },
        title: 'Delivery confidence',
        status: 'active',
        context: 'Project Atlas',
        details: expect.objectContaining({
          dueDate: '2026-09-04',
          reviewFrequencyDays: 7
        })
      }),
      expect.objectContaining({
        target: { type: 'commitment', id: hierarchy.commitment.id },
        title: 'Keep sponsors aligned',
        context: 'Project Atlas › Delivery confidence',
        details: expect.objectContaining({
          dueDate: '2026-09-01',
          state: 'green',
          lastUpdateDate: '2026-08-27'
        })
      }),
      expect.objectContaining({
        target: { type: 'routine', id: hierarchy.routine.id },
        title: 'Inspect the weekly report',
        status: 'green',
        details: expect.objectContaining({ scheduleWeekdays: [], progress: null })
      }),
      expect.objectContaining({
        target: { type: 'todo', id: hierarchy.todo.id },
        title: 'Share the revised plan',
        status: 'open',
        details: expect.objectContaining({ dueDate: '2026-08-30' })
      }),
      expect.objectContaining({
        target: { type: 'note', id: hierarchy.note.id },
        title: 'Default',
        status: null,
        details: expect.objectContaining({
          preview: 'Decisions and rollout context for the delivery team.'
        })
      })
    ]))
  })

  it('persists opaque Excalidraw data and refreshes referenced titles and closed statuses', () => {
    const { thread } = createHierarchy()
    database.domain.canvases.addEntityReference(1, {
      elementId: 'onmove_thread-card',
      target: { type: 'thread', id: thread.id }
    })
    database.domain.canvases.saveDocument(1, {
      data: {
        type: 'excalidraw',
        elements: [{ id: 'onmove_thread-card', type: 'rectangle' }]
      },
      entityElementIds: ['onmove_thread-card']
    })

    thread.update({
      title: 'Renamed delivery confidence',
      status: 'done',
      dueDate: '2026-09-12'
    })
    expect(database.domain.canvases.get(1)).toMatchObject({
      revision: 1,
      data: {
        type: 'excalidraw',
        elements: [{ id: 'onmove_thread-card', type: 'rectangle' }]
      },
      references: [expect.objectContaining({
        elementId: 'onmove_thread-card',
        title: 'Renamed delivery confidence',
        status: 'done',
        details: expect.objectContaining({ dueDate: '2026-09-12' }),
        deleted: false
      })]
    })

    database.close()
    database = new AppDatabase(databasePath)
    expect(database.domain.canvases.get(1)).toMatchObject({
      revision: 1,
      references: [expect.objectContaining({
        status: 'done',
        details: expect.objectContaining({ dueDate: '2026-09-12' })
      })]
    })
  })

  it('rescues display metadata as non-live ghosts across parent cascades and restarts', () => {
    const { focus, thread, commitment, routine, todo, note } = createHierarchy()
    const targets = [
      { elementId: 'onmove_thread', target: { type: 'thread' as const, id: thread.id } },
      {
        elementId: 'onmove_commitment',
        target: { type: 'commitment' as const, id: commitment.id }
      },
      { elementId: 'onmove_routine', target: { type: 'routine' as const, id: routine.id } },
      { elementId: 'onmove_todo', target: { type: 'todo' as const, id: todo.id } },
      { elementId: 'onmove_note', target: { type: 'note' as const, id: note.id } }
    ]
    for (const target of targets) database.domain.canvases.addEntityReference(1, target)

    expect(database.domain.focuses.delete(focus.id)).toBe(true)
    const ghosts = database.domain.canvases.get(1).references
    expect(ghosts).toHaveLength(5)
    expect(ghosts.every(({ deleted, deletedAt }) => deleted && deletedAt !== null)).toBe(true)
    expect(ghosts).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Delivery confidence', context: 'Project Atlas' }),
      expect.objectContaining({
        title: 'Keep sponsors aligned',
        context: 'Project Atlas › Delivery confidence'
      })
    ]))

    database.close()
    database = new AppDatabase(databasePath)
    expect(database.domain.canvases.get(1).references).toEqual(
      expect.arrayContaining(targets.map(({ elementId }) =>
        expect.objectContaining({ elementId, deleted: true })))
    )
  })

  it('removes only Canvas references whose cards were removed and rejects duplicate cards', () => {
    const { thread, commitment } = createHierarchy()
    database.domain.canvases.addEntityReference(1, {
      elementId: 'onmove_thread',
      target: { type: 'thread', id: thread.id }
    })
    database.domain.canvases.addEntityReference(1, {
      elementId: 'onmove_commitment',
      target: { type: 'commitment', id: commitment.id }
    })
    expect(() => database.domain.canvases.addEntityReference(1, {
      elementId: 'onmove_duplicate',
      target: { type: 'thread', id: thread.id }
    })).toThrow(/already on this Canvas/)

    database.domain.canvases.saveDocument(1, {
      data: { records: {} },
      entityElementIds: ['onmove_thread']
    })
    expect(database.domain.canvases.get(1).references).toEqual([
      expect.objectContaining({ elementId: 'onmove_thread' })
    ])
    expect(database.domain.commitments.find(commitment.id)).not.toBeNull()
  })

  it('rejects malformed Excalidraw element references and ambiguous document membership', () => {
    const { thread } = createHierarchy()
    expect(() => database.domain.canvases.addEntityReference(1, {
      elementId: 'shape:legacy-id',
      target: { type: 'thread', id: thread.id }
    })).toThrow(/valid Excalidraw element id/)

    database.domain.canvases.addEntityReference(1, {
      elementId: 'onmove_valid',
      target: { type: 'thread', id: thread.id }
    })
    expect(() => database.domain.canvases.saveDocument(1, {
      data: { type: 'excalidraw', elements: [] },
      entityElementIds: ['onmove_valid', 'onmove_valid']
    })).toThrow(/must be unique/)
    expect(() => database.domain.canvases.saveDocument(999_999, {
      data: { type: 'excalidraw', elements: [] },
      entityElementIds: []
    })).toThrow(/Canvas 999999/)
  })

  it('never revives a ghost when SQLite reuses its deleted entity id', () => {
    const focus = database.domain.focuses.create({ title: 'Identity project' })
    const original = database.domain.threads.create({
      focusId: focus.id,
      title: 'Original identity',
      reviewFrequencyDays: 7
    })
    database.domain.canvases.addEntityReference(1, {
      elementId: 'onmove_original-identity',
      target: { type: 'thread', id: original.id }
    })
    expect(database.domain.threads.delete(original.id)).toBe(true)
    const replacement = database.domain.threads.create({
      focusId: focus.id,
      title: 'Replacement identity',
      reviewFrequencyDays: 7
    })
    expect(replacement.id).toBe(original.id)
    replacement.update({ title: 'Edited replacement identity' })

    expect(database.domain.canvases.get(1).references).toEqual([
      expect.objectContaining({
        elementId: 'onmove_original-identity',
        title: 'Original identity',
        deleted: true
      })
    ])
    database.domain.canvases.addEntityReference(1, {
      elementId: 'onmove_replacement-identity',
      target: { type: 'thread', id: replacement.id }
    })
    expect(database.domain.canvases.get(1).references).toEqual(expect.arrayContaining([
      expect.objectContaining({ elementId: 'onmove_original-identity', deleted: true }),
      expect.objectContaining({
        elementId: 'onmove_replacement-identity',
        title: 'Edited replacement identity',
        deleted: false
      })
    ]))
  })
})
