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
      reviewFrequencyDays: 7
    })
    const commitment = database.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Keep sponsors aligned'
    })
    const routine = database.domain.routines.create({
      parent: { type: 'thread', id: thread.id },
      name: 'Inspect the weekly report',
      scheduleWeekdays: [],
      checklist: [{ inspection: 'Verify delivery risks were represented.' }]
    })
    const todo = database.domain.todos.create({
      parent: { type: 'commitment', id: commitment.id },
      name: 'Share the revised plan'
    })
    const note = database.domain.notes.list({ type: 'thread', id: thread.id })[0]
    return { focus, thread, commitment, routine, todo, note }
  }

  it('creates one addressable default Canvas and lists every supported live entity kind', () => {
    const hierarchy = createHierarchy()

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
        context: 'Project Atlas'
      }),
      expect.objectContaining({
        target: { type: 'commitment', id: hierarchy.commitment.id },
        title: 'Keep sponsors aligned',
        context: 'Project Atlas › Delivery confidence'
      }),
      expect.objectContaining({
        target: { type: 'routine', id: hierarchy.routine.id },
        title: 'Inspect the weekly report',
        status: 'green'
      }),
      expect.objectContaining({
        target: { type: 'todo', id: hierarchy.todo.id },
        title: 'Share the revised plan',
        status: 'open'
      }),
      expect.objectContaining({
        target: { type: 'note', id: hierarchy.note.id },
        title: 'Default',
        status: null
      })
    ]))
  })

  it('persists opaque TLDraw data and refreshes referenced titles and closed statuses', () => {
    const { thread } = createHierarchy()
    database.domain.canvases.addEntityReference(1, {
      shapeId: 'shape:thread-card',
      target: { type: 'thread', id: thread.id }
    })
    database.domain.canvases.saveDocument(1, {
      data: { store: { 'shape:thread-card': { typeName: 'shape' } } },
      entityShapeIds: ['shape:thread-card']
    })

    thread.update({ title: 'Renamed delivery confidence', status: 'done' })
    expect(database.domain.canvases.get(1)).toMatchObject({
      revision: 1,
      data: { store: { 'shape:thread-card': { typeName: 'shape' } } },
      references: [expect.objectContaining({
        shapeId: 'shape:thread-card',
        title: 'Renamed delivery confidence',
        status: 'done',
        deleted: false
      })]
    })

    database.close()
    database = new AppDatabase(databasePath)
    expect(database.domain.canvases.get(1)).toMatchObject({
      revision: 1,
      references: [expect.objectContaining({ status: 'done' })]
    })
  })

  it('rescues display metadata as non-live ghosts across parent cascades and restarts', () => {
    const { focus, thread, commitment, routine, todo, note } = createHierarchy()
    const targets = [
      { shapeId: 'shape:thread', target: { type: 'thread' as const, id: thread.id } },
      {
        shapeId: 'shape:commitment',
        target: { type: 'commitment' as const, id: commitment.id }
      },
      { shapeId: 'shape:routine', target: { type: 'routine' as const, id: routine.id } },
      { shapeId: 'shape:todo', target: { type: 'todo' as const, id: todo.id } },
      { shapeId: 'shape:note', target: { type: 'note' as const, id: note.id } }
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
      expect.arrayContaining(targets.map(({ shapeId }) =>
        expect.objectContaining({ shapeId, deleted: true })))
    )
  })

  it('removes only Canvas references whose cards were removed and rejects duplicate cards', () => {
    const { thread, commitment } = createHierarchy()
    database.domain.canvases.addEntityReference(1, {
      shapeId: 'shape:thread',
      target: { type: 'thread', id: thread.id }
    })
    database.domain.canvases.addEntityReference(1, {
      shapeId: 'shape:commitment',
      target: { type: 'commitment', id: commitment.id }
    })
    expect(() => database.domain.canvases.addEntityReference(1, {
      shapeId: 'shape:duplicate',
      target: { type: 'thread', id: thread.id }
    })).toThrow(/already on this Canvas/)

    database.domain.canvases.saveDocument(1, {
      data: { records: {} },
      entityShapeIds: ['shape:thread']
    })
    expect(database.domain.canvases.get(1).references).toEqual([
      expect.objectContaining({ shapeId: 'shape:thread' })
    ])
    expect(database.domain.commitments.find(commitment.id)).not.toBeNull()
  })

  it('never revives a ghost when SQLite reuses its deleted entity id', () => {
    const focus = database.domain.focuses.create({ title: 'Identity project' })
    const original = database.domain.threads.create({
      focusId: focus.id,
      title: 'Original identity',
      reviewFrequencyDays: 7
    })
    database.domain.canvases.addEntityReference(1, {
      shapeId: 'shape:original-identity',
      target: { type: 'thread', id: original.id }
    })
    expect(database.domain.threads.delete(original.id)).toBe(true)
    const replacement = database.domain.threads.create({
      focusId: focus.id,
      title: 'Replacement identity',
      reviewFrequencyDays: 7
    })
    expect(replacement.id).toBe(original.id)

    expect(database.domain.canvases.get(1).references).toEqual([
      expect.objectContaining({
        shapeId: 'shape:original-identity',
        title: 'Original identity',
        deleted: true
      })
    ])
    database.domain.canvases.addEntityReference(1, {
      shapeId: 'shape:replacement-identity',
      target: { type: 'thread', id: replacement.id }
    })
    expect(database.domain.canvases.get(1).references).toEqual(expect.arrayContaining([
      expect.objectContaining({ shapeId: 'shape:original-identity', deleted: true }),
      expect.objectContaining({
        shapeId: 'shape:replacement-identity',
        title: 'Replacement identity',
        deleted: false
      })
    ]))
  })
})
