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

  it('reads complete durable search documents only when the generation changes', async () => {
    const { focus, thread, update } = hierarchy('Project A')
    const first = await projection.snapshotIfChanged(null)
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
    await expect(projection.snapshotIfChanged(first!.generation)).resolves.toBeNull()

    domain.updates.requireModel(update.id).update({ observation: 'Changed operating evidence' })
    const second = await projection.snapshotIfChanged(first!.generation)
    expect(second?.generation).toBe(first!.generation + 1)
    expect(second?.documents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: `update:${update.id}:observation`,
        body: 'Changed operating evidence'
      })
    ]))
  })

  it('enumerates structured, access-filtered candidates through legacy queryless pages', async () => {
    const projectA = hierarchy('Project A')
    const projectB = hierarchy('Project B')
    const hidden = hierarchy('Private Project', true)

    const candidates = await projection.authorizedCandidates({
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

    const global = await projection.authorizedCandidates(
      { text: null, kinds: ['update'] },
      visible
    )
    expect([...global.resultsBySourceKey.keys()]).toEqual(expect.arrayContaining([
      `update:${projectA.update.id}:observation`,
      `update:${projectB.update.id}:observation`
    ]))
    expect(global.resultsBySourceKey.has(`update:${hidden.update.id}:observation`)).toBe(false)
  })

  it('enumerates authorized closed candidates for lifecycle-aware ranking without selecting them', async () => {
    const focus = domain.focuses.create({ title: 'Lifecycle authorization' }).toSnapshot()
    const currentThread = domain.threads.create({
      focusId: focus.id,
      title: 'Current owner',
      reviewFrequencyDays: 7
    }).snapshot()
    const cancelledThread = domain.threads.create({
      focusId: focus.id,
      title: 'Cancelled owner',
      status: 'cancelled',
      reviewFrequencyDays: 7
    }).snapshot()
    const currentUpdate = domain.updates.create({
      parent: { type: 'thread', id: currentThread.id },
      observation: 'lifecycle authorization evidence'
    }).toSnapshot()
    const cancelledUpdate = domain.updates.create({
      parent: { type: 'thread', id: cancelledThread.id },
      observation: 'lifecycle authorization evidence'
    }).toSnapshot()

    const selected = projection.searchPage({
      text: null,
      kinds: ['update'],
      focusId: focus.id,
      lifecycle: { mode: 'current' }
    }, visible)
    expect(selected.items.map(({ reference }) => reference)).toEqual([
      { type: 'update', id: currentUpdate.id }
    ])

    const authorized = await projection.authorizedCandidates({
      text: 'ignored while authorizing',
      kinds: ['update'],
      focusId: focus.id,
      lifecycle: { mode: 'current' }
    }, visible)
    expect([...authorized.resultsBySourceKey.keys()]).toEqual(expect.arrayContaining([
      `update:${currentUpdate.id}:observation`,
      `update:${cancelledUpdate.id}:observation`
    ]))
    expect(authorized.resultsBySourceKey.get(
      `update:${cancelledUpdate.id}:observation`
    )?.lifecycle).toEqual({
      directStatus: null,
      effective: 'closed',
      lineage: {
        focus: { id: focus.id, status: 'active' },
        thread: { id: cancelledThread.id, status: 'cancelled' },
        commitment: null
      }
    })
  })

  it('yields while enumerating more than one authorization page', async () => {
    const { thread } = hierarchy('Large authorization')
    for (let index = 0; index < 101; index += 1) {
      domain.updates.create({
        parent: { type: 'thread', id: thread.id },
        observation: `Authorized evidence ${index}`
      })
    }
    let heartbeatRan = false
    const heartbeat = new Promise<void>((resolve) => {
      setTimeout(() => {
        heartbeatRan = true
        resolve()
      }, 0)
    })

    const candidates = await projection.authorizedCandidates(
      { text: null, kinds: ['update'], threadId: thread.id },
      visible
    )

    expect(candidates.resultsBySourceKey.size).toBe(102)
    expect(heartbeatRan).toBe(true)
    await heartbeat
  })
})
