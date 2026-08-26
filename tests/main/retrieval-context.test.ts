import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('context-aware retrieval application boundary', () => {
  let directory: string
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-retrieval-context-'))
    database = new AppDatabase(join(directory, 'onmove.sqlite3'))
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('treats an asserted Thread ancestry as a hard boundary', async () => {
    const projectA = database.domain.focuses.create({ title: 'Project A' }).toSnapshot()
    const projectB = database.domain.focuses.create({ title: 'Project B' }).toSnapshot()
    const threadA = database.domain.threads.create({
      focusId: projectA.id,
      title: 'Observability',
      reviewFrequencyDays: 7
    }).snapshot()
    const updateA = database.domain.updates.create({
      parent: { type: 'thread', id: threadA.id },
      observation: 'Shared monitoring blind spots'
    }).toSnapshot()
    const access = database.mcpSettings.accessPolicy()

    const page = await database.queries.retrievePage({
      text: null,
      context: {
        boundary: { type: 'thread', focusId: projectA.id, threadId: threadA.id }
      },
      kinds: ['update']
    }, access, 'classic')
    expect(page.items).toEqual([
      expect.objectContaining({ reference: { type: 'update', id: updateA.id } })
    ])

    await expect(database.queries.retrievePage({
      text: null,
      context: {
        boundary: { type: 'thread', focusId: projectB.id, threadId: threadA.id }
      }
    }, access, 'classic')).rejects.toThrow('CONTEXT_NOT_FOUND_OR_NOT_VISIBLE')
  })

  it('does not distinguish missing, sensitive, or denied contexts', async () => {
    const visible = database.domain.focuses.create({ title: 'Visible' }).toSnapshot()
    const hidden = database.domain.focuses.create({
      title: 'Sensitive',
      sensitive: true
    }).toSnapshot()
    const access = database.mcpSettings.accessPolicy()
    const retrieve = (focusId: number) => database.queries.retrievePage({
      text: null,
      context: { boundary: { type: 'focus' as const, focusId } }
    }, access, 'classic')

    await expect(retrieve(hidden.id)).rejects.toThrow(
      'CONTEXT_NOT_FOUND_OR_NOT_VISIBLE: The requested retrieval context does not exist or is not visible.'
    )
    await expect(retrieve(999_999)).rejects.toThrow(
      'CONTEXT_NOT_FOUND_OR_NOT_VISIBLE: The requested retrieval context does not exist or is not visible.'
    )

    database.mcpSettings.update({
      permission: {
        target: { type: 'focus', id: visible.id },
        resource: 'focus',
        view: false
      }
    })
    await expect(database.queries.retrievePage({
      text: null,
      context: { boundary: { type: 'focus', focusId: visible.id } }
    }, database.mcpSettings.accessPolicy(), 'classic')).rejects.toThrow(
      'CONTEXT_NOT_FOUND_OR_NOT_VISIBLE: The requested retrieval context does not exist or is not visible.'
    )
  })

  it('intersects canonical Subject attribution with the Thread boundary', async () => {
    const focus = database.domain.focuses.create({ title: 'Projects' }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Project A',
      reviewFrequencyDays: 7
    }).snapshot()
    database.domain.threadScopes.addSubject(thread.id, { name: 'Observability' })
    const scoped = database.domain.threadScopes.addSubject(thread.id, { name: 'Reliability' })
    const observability = scoped.subjects.find(({ name }) => name === 'Observability')!
    const reliability = scoped.subjects.find(({ name }) => name === 'Reliability')!
    const expected = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      scope: { scopeId: scoped.scopeId as number, subjectId: observability.id },
      observation: 'Identical operating evidence'
    }).toSnapshot()
    database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      scope: { scopeId: scoped.scopeId as number, subjectId: reliability.id },
      observation: 'Identical operating evidence'
    })

    const page = await database.queries.retrievePage({
      text: null,
      context: {
        boundary: { type: 'thread', focusId: focus.id, threadId: thread.id },
        subjectId: observability.id
      },
      kinds: ['update']
    }, database.mcpSettings.accessPolicy(), 'classic')

    expect(page.items).toEqual([
      expect.objectContaining({
        reference: { type: 'update', id: expected.id },
        subject: expect.objectContaining({ id: observability.id })
      })
    ])
  })

  it('honors a more-specific Thread Subject grant inside a broader explicit boundary', async () => {
    const focus = database.domain.focuses.create({ title: 'Scoped access' }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Allowed Thread',
      reviewFrequencyDays: 7
    }).snapshot()
    const scope = database.domain.threadScopes.addSubject(thread.id, { name: 'Allowed Subject' })
    const subject = scope.subjects[0]
    const update = database.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      scope: { scopeId: scope.scopeId as number, subjectId: subject.id },
      observation: 'Visible only through the exact Thread Subject grant'
    }).toSnapshot()
    database.mcpSettings.update({
      permission: { target: { type: 'default' }, resource: 'subject', view: false }
    })
    database.mcpSettings.update({
      permission: {
        target: { type: 'thread', id: thread.id },
        resource: 'subject',
        view: true
      }
    })

    for (const boundary of [
      { type: 'workspace' as const },
      { type: 'focus' as const, focusId: focus.id }
    ]) {
      const page = await database.queries.retrievePage({
        text: null,
        context: { boundary, subjectId: subject.id },
        kinds: ['update']
      }, database.mcpSettings.accessPolicy(), 'classic')
      expect(page.items.map(({ reference }) => reference)).toEqual([
        { type: 'update', id: update.id }
      ])
    }
  })
})
