import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import { ModelNotFoundError, ModelValidationError } from '../../src/main/data/model'

describe('hierarchical domain models', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-domain-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('materializes a recursive hierarchy with resolved relations and metadata', () => {
    const relation = database!.domain.relations.create({
      name: 'blocks',
      meta: { presentation: { color: 'indigo' } }
    })
    const parent = database!.domain.items.create({
      relationId: relation.id,
      status: 'good',
      statusMeta: { source: 'import' },
      meta: { title: 'Parent' }
    })
    const child = database!.domain.items.create({
      parentId: parent.id,
      status: 'bad',
      meta: { title: 'Child' }
    })
    database!.domain.items.create({
      parentId: child.id,
      meta: { title: 'Grandchild' }
    })

    const snapshot = parent.materialize()

    expect(snapshot).toMatchObject({
      id: parent.id,
      relationId: relation.id,
      relation: {
        id: relation.id,
        name: 'blocks',
        meta: { presentation: { color: 'indigo' } }
      },
      meta: { title: 'Parent' },
      status: {
        current: 'good',
        previous: null,
        transitionCount: 1,
        lastTransition: { from: null, to: 'good', meta: { source: 'import' } }
      }
    })
    expect(snapshot.items[0]).toMatchObject({
      id: child.id,
      parentId: parent.id,
      status: { current: 'bad' },
      items: [{ meta: { title: 'Grandchild' } }]
    })
  })

  it('cascades parent deletion through every descendant and its status log', () => {
    const parent = database!.domain.items.create({ status: 'open' })
    const child = database!.domain.items.create({ parentId: parent.id, status: 'blocked' })
    const grandchild = database!.domain.items.create({ parentId: child.id, status: 'ready' })

    expect(parent.delete()).toBe(true)
    expect(database!.domain.items.findModel(parent.id)).toBeNull()
    expect(database!.domain.items.findModel(child.id)).toBeNull()
    expect(database!.domain.items.findModel(grandchild.id)).toBeNull()

    const raw = new DatabaseSync(databasePath)
    const transitionCount = raw
      .prepare('SELECT count(*) AS count FROM status_transitions')
      .get() as { count: number }
    raw.close()
    expect(Number(transitionCount.count)).toBe(0)
  })

  it('sets relation references to null when a relation is deleted', () => {
    const relation = database!.domain.relations.create({ name: 'depends on' })
    const item = database!.domain.items.create({ relationId: relation.id })

    expect(item.materialize().relation?.name).toBe('depends on')
    relation.delete()

    expect(item.refresh().relationId).toBeNull()
    expect(item.materialize()).toMatchObject({ relationId: null, relation: null })
  })

  it('keeps directional status semantics in history and current state on the model', () => {
    const item = database!.domain.items.create({
      status: 'bad',
      statusMeta: { reason: 'initial assessment' }
    })

    item.setStatus({ status: 'good', meta: { reason: 'reviewed' } })
    item.setStatus({ status: 'bad', meta: { reason: 'regressed' } })
    item.setStatus({ status: 'bad', meta: { reason: 'same state does not create an event' } })

    expect(item.statusHistory()).toMatchObject([
      { from: null, to: 'bad', meta: { reason: 'initial assessment' } },
      { from: 'bad', to: 'good', meta: { reason: 'reviewed' } },
      { from: 'good', to: 'bad', meta: { reason: 'regressed' } }
    ])
    expect(item.materialize().status).toMatchObject({
      current: 'bad',
      previous: 'good',
      transitionCount: 3,
      lastTransition: { from: 'good', to: 'bad', meta: { reason: 'regressed' } }
    })
    expect(item.materialize().status.changedAt).toEqual(expect.any(String))
  })

  it('tracks status changes made below the model layer and prevents history rewrites', () => {
    const item = database!.domain.items.create({ status: 'bad' })
    const raw = new DatabaseSync(databasePath)

    raw.prepare(
      `UPDATE items SET current_status = 'good', status_meta_json = '{"source":"repair"}'
       WHERE id = ?`
    ).run(item.id)

    expect(item.refresh().currentStatus).toBe('good')
    expect(item.statusHistory().at(-1)).toMatchObject({
      from: 'bad',
      to: 'good',
      meta: { source: 'repair' }
    })
    expect(() =>
      raw.prepare("UPDATE status_transitions SET to_status = 'unknown' WHERE item_id = ?").run(item.id)
    ).toThrow(/immutable/)
    expect(() =>
      raw.prepare('DELETE FROM status_transitions WHERE item_id = ?').run(item.id)
    ).toThrow(/immutable/)
    raw.close()
  })

  it('rejects cycles while allowing valid reparenting and detaching', () => {
    const parent = database!.domain.items.create()
    const child = database!.domain.items.create({ parentId: parent.id })
    const grandchild = database!.domain.items.create({ parentId: child.id })

    expect(() => parent.moveTo(grandchild.id)).toThrow(ModelValidationError)
    expect(parent.refresh().parentId).toBeNull()

    grandchild.moveTo(parent.id)
    expect(grandchild.parentId).toBe(parent.id)
    grandchild.moveTo(null)
    expect(grandchild.parentId).toBeNull()
  })

  it('validates model inputs and referenced records before writing', () => {
    expect(() => database!.domain.relations.create({ name: '   ' })).toThrow(ModelValidationError)
    expect(() => database!.domain.items.create({ parentId: 999 })).toThrow(ModelNotFoundError)

    const item = database!.domain.items.create()
    expect(() => item.setRelation(999)).toThrow(ModelNotFoundError)
    expect(() => item.setStatus({ status: '  ' })).toThrow(ModelValidationError)
    expect(item.refresh().currentStatus).toBeNull()
  })

  it('supports active-model-style refresh, mutation, metadata, and lifecycle helpers', () => {
    const relation = database!.domain.relations.create({ name: 'old name' })

    relation.rename('new name').updateMeta({ cardinality: 'many' })
    expect(relation.toSnapshot()).toMatchObject({
      name: 'new name',
      meta: { cardinality: 'many' }
    })
    expect(relation.isDeleted).toBe(false)
    expect(relation.delete()).toBe(true)
    expect(relation.isDeleted).toBe(true)
    expect(() => relation.refresh()).toThrow(ModelValidationError)
  })

  it('retains materialized state and complete status history after reopening', () => {
    const item = database!.domain.items.create({ status: 'bad', meta: { title: 'Persistent' } })
    item.setStatus({ status: 'good', meta: { reason: 'fixed' } })
    const id = item.id
    database!.close()

    database = new AppDatabase(databasePath)
    const reopened = database.domain.items.requireModel(id)

    expect(reopened.materialize()).toMatchObject({
      meta: { title: 'Persistent' },
      status: { current: 'good', previous: 'bad', transitionCount: 2 }
    })
    expect(reopened.statusHistory()).toHaveLength(2)
  })
})
