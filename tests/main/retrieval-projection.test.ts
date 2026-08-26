import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OnMoveAccessPolicy } from '../../src/main/application/access-policy'
import { RetrievalProjectionRepository } from '../../src/main/application/retrieval-projection'
import { SearchIndexRepository } from '../../src/main/application/search-index'
import { DomainStore } from '../../src/main/data/domain'
import { runMigrations } from '../../src/main/data/migrations'
import { SqliteAdapter } from '../../src/main/data/sqlite-adapter'

const visible: OnMoveAccessPolicy = { sensitiveContent: 'deny', mutations: 'read-only' }

describe('RetrievalProjectionRepository', () => {
  let directory: string
  let database: SqliteAdapter
  let domain: DomainStore
  let legacy: SearchIndexRepository
  let projection: RetrievalProjectionRepository

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-retrieval-projection-'))
    database = new SqliteAdapter(join(directory, 'onmove.sqlite3'))
    runMigrations(database)
    domain = new DomainStore(database)
    legacy = new SearchIndexRepository(database)
    projection = new RetrievalProjectionRepository(database, legacy)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function hierarchy(prefix: string, sensitive = false) {
    const focus = domain.focuses.create({ title: `${prefix} Focus` }).toSnapshot()
    const thread = domain.threads.create({
      focusId: focus.id,
      title: `${prefix} Thread`,
      reviewFrequencyDays: 7,
      sensitive
    }).snapshot()
    const update = domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      observation: `${prefix} observability evidence`
    }).toSnapshot()
    return { focus, thread, update }
  }

  it('reads complete durable search documents only when the generation changes', () => {
    const { focus, thread, update } = hierarchy('Project A')
    const first = projection.snapshotIfChanged(null)
    expect(first).not.toBeNull()
    expect(first?.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: `update:${update.id}:observation`,
        kind: 'update',
        entityId: update.id,
        body: 'Project A observability evidence',
        focusId: focus.id,
        threadId: thread.id,
        lineageKey: `focus:${focus.id}:thread:${thread.id}:commitment:0:subject:0`
      })
    ]))
    expect(projection.snapshotIfChanged(first!.generation)).toBeNull()

    domain.updates.requireModel(update.id).update({ observation: 'Changed operating evidence' })
    const second = projection.snapshotIfChanged(first!.generation)
    expect(second?.generation).toBe(first!.generation + 1)
    expect(second?.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: `update:${update.id}:observation`,
        body: 'Changed operating evidence'
      })
    ]))
  })

  it('enumerates structured, access-filtered candidates through legacy queryless pages', () => {
    const projectA = hierarchy('Project A')
    const projectB = hierarchy('Project B')
    const hidden = hierarchy('Private Project', true)

    const candidates = projection.authorizedCandidates({
      text: 'this text is intentionally ignored',
      kinds: ['update'],
      threadId: projectA.thread.id,
      limit: 1,
      offset: 20
    }, visible)

    expect([...candidates.resultsBySourceKey.keys()]).toEqual([
      `update:${projectA.update.id}:observation`
    ])
    expect(candidates.resultsBySourceKey.get(
      `update:${projectA.update.id}:observation`
    )).toMatchObject({
      reference: { type: 'update', id: projectA.update.id },
      hierarchy: { thread: expect.objectContaining({ id: projectA.thread.id }) }
    })

    const global = projection.authorizedCandidates({ text: null, kinds: ['update'] }, visible)
    expect([...global.resultsBySourceKey.keys()]).toEqual(expect.arrayContaining([
      `update:${projectA.update.id}:observation`,
      `update:${projectB.update.id}:observation`
    ]))
    expect(global.resultsBySourceKey.has(`update:${hidden.update.id}:observation`)).toBe(false)
  })
})
