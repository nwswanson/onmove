import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import type { OnMoveAccessPolicy } from '../../src/main/application/access-policy'
import { ScopeTargetValidationError } from '../../src/main/application/services'
import { RICH_TEXT_PREFIX } from '../../src/shared/rich-text-value'

const denied: OnMoveAccessPolicy = { sensitiveContent: 'deny', mutations: 'read-only' }
const writable: OnMoveAccessPolicy = { sensitiveContent: 'deny', mutations: 'allow' }
const sensitiveWritable: OnMoveAccessPolicy = { sensitiveContent: 'allow', mutations: 'allow' }

function lexical(text: string): string {
  return `${RICH_TEXT_PREFIX}${JSON.stringify({
    root: {
      type: 'root',
      children: [{
        type: 'paragraph',
        children: [{ type: 'text', text, version: 1 }],
        version: 1
      }],
      version: 1
    }
  })}`
}

describe('OnMove MCP application services', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-mcp-services-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  function hierarchy(): { focusId: number; threadId: number; commitmentId: number } {
    const focus = database.domain.focuses.create({
      title: 'Project Atlas',
      description: lexical('Deliver a resilient operating model')
    }).toSnapshot()
    const thread = database.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    }).snapshot()
    const commitment = database.domain.commitments.create({
      type: 'tracking',
      parent: { type: 'thread', id: thread.id },
      title: 'Verify delivery risks'
    }).snapshot()
    return { focusId: focus.id, threadId: thread.id, commitmentId: commitment.id }
  }

  it('indexes ordinary-language content, reindexes edits, and projects rich text as plain text', () => {
    const { focusId, threadId } = hierarchy()
    const created = database.domain.updates.create({
      parent: { type: 'thread', id: threadId },
      observation: lexical('Customer migration confidence is improving'),
      state: 'green'
    }).toSnapshot()

    expect(database.queries.search({ text: 'migration confidence' }, denied)).toEqual([
      expect.objectContaining({
        reference: { type: 'update', id: created.id },
        contextPath: ['Project Atlas', 'Sprint execution'],
        snippet: 'Customer migration confidence is improving'
      })
    ])
    const context = database.queries.getFocus(focusId, denied)
    expect(context?.entity).toMatchObject({ description: 'Deliver a resilient operating model' })

    database.domain.updates.requireModel(created.id).update({
      observation: lexical('Capacity planning now needs attention')
    })
    expect(database.queries.search({ text: 'migration confidence' }, denied)).toEqual([])
    expect(database.queries.search({ text: 'capacity attention' }, denied)[0]).toMatchObject({
      reference: { type: 'update', id: created.id }
    })

    database.domain.updates.delete(created.id)
    expect(database.queries.search({ text: 'capacity attention' }, denied)).toEqual([])
  })

  it('filters sensitive ancestors and exact Subject cells from contexts, counts, and search', () => {
    const { focusId, threadId } = hierarchy()
    database.domain.focusScopes.addSubject(focusId, { name: 'Customer North' })
    const scope = database.domain.threadScopes.followFocus(threadId)
    const subject = scope.subjects[0]
    database.domain.subjects.requireModel(subject.id).update({ sensitive: true })
    const update = database.domain.updates.create({
      parent: { type: 'thread', id: threadId },
      scope: { scopeId: scope.scopeId as number, subjectId: subject.id },
      observation: 'North account escalation evidence',
      state: 'red'
    }).toSnapshot()

    expect(database.queries.search({ text: 'escalation evidence' }, denied)).toEqual([])
    expect(database.queries.search(
      { text: 'escalation evidence' },
      sensitiveWritable
    )[0]).toMatchObject({
      reference: { type: 'update', id: update.id },
      effectiveSensitive: true,
      subject: { id: subject.id, name: 'Customer North' }
    })
    expect(database.queries.getThread(threadId, denied)?.updates).toEqual([])

    database.domain.focuses.requireModel(focusId).update({ sensitive: true })
    expect(database.queries.getThread(threadId, denied)).toBeNull()
    expect(database.queries.getThread(threadId, sensitiveWritable)).not.toBeNull()
  })

  it('resolves scoped writes, rejects stale or omitted cells, and audits no payload text', () => {
    const { focusId, threadId, commitmentId } = hierarchy()
    const first = database.domain.focusScopes.addSubject(focusId, { name: 'Platform' })
    const second = database.domain.focusScopes.addSubject(focusId, { name: 'Operations' })
    database.domain.threadScopes.followFocus(threadId)
    const platform = second.subjects.find(({ name }) => name === 'Platform') as { id: number }

    expect(() => database.commands.createUpdate({
      parent: { type: 'commitment', id: commitmentId },
      observation: 'Unattributed evidence'
    }, writable)).toThrow('requires one currently applicable subjectId')

    const created = database.commands.createUpdate({
      parent: { type: 'commitment', id: commitmentId },
      subjectId: platform.id,
      observation: 'Scoped operational evidence',
      state: 'yellow'
    }, writable, 'integration-test')
    expect(created.scope).toEqual({ scopeId: first.scopeId, subjectId: platform.id })

    const unrelated = database.domain.subjects.create({ name: 'Former Subject' }).toSnapshot()
    expect(() => database.commands.createUpdate({
      parent: { type: 'thread', id: threadId },
      subjectId: unrelated.id,
      observation: 'Former Subject evidence'
    }, writable)).toThrow('not currently applicable')

    const raw = new DatabaseSync(databasePath, { readOnly: true })
    const audit = raw.prepare(
      'SELECT tool_name, entity_type, entity_id, category, client_name FROM mcp_mutation_audit'
    ).all()
    const serialized = JSON.stringify(audit)
    raw.close()
    expect(audit).toEqual([expect.objectContaining({
      tool_name: 'onmove.create_update',
      entity_type: 'update',
      entity_id: created.id,
      category: 'create',
      client_name: 'integration-test'
    })])
    expect(serialized).not.toContain('Scoped operational evidence')
  })

  it('keeps Open Thread Updates unscoped and returns typed recovery when a Subject is supplied', () => {
    const { threadId } = hierarchy()
    const unrelated = database.domain.subjects.create({ name: 'Unrelated Person' }).toSnapshot()

    try {
      database.commands.createUpdate({
        parent: { type: 'thread', id: threadId },
        subjectId: unrelated.id,
        observation: 'Should not be silently misattributed'
      }, writable)
      throw new Error('Expected Open-parent attribution to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(ScopeTargetValidationError)
      expect(error).toMatchObject({
        issue: {
          code: 'open_parent_cannot_target_subject',
          parent: { type: 'thread', id: threadId },
          subjectId: unrelated.id,
          effectiveScopeId: null
        }
      })
      expect((error as Error).message).toContain(
        'Retry without subjectId (or set subjectId to null)'
      )
    }

    const created = database.commands.createUpdate({
      parent: { type: 'thread', id: threadId },
      observation: 'Correctly unscoped evidence'
    }, writable)
    expect(created.scope).toBeNull()
  })

  it('keeps mutations read-only by default and enforces sensitive-write permission', () => {
    const { threadId } = hierarchy()
    expect(database.mcpSettings.get()).toMatchObject({
      allowSensitive: false,
      allowMutations: false
    })
    expect(() => database.commands.createUpdate({
      parent: { type: 'thread', id: threadId }
    }, denied)).toThrow('mutations are disabled')
    expect(() => database.commands.createUpdate({
      parent: { type: 'thread', id: threadId },
      sensitive: true
    }, writable)).toThrow('sensitive-content access is disabled')

    const created = database.commands.createUpdate({
      parent: { type: 'thread', id: threadId },
      sensitive: true
    }, sensitiveWritable)
    expect(created.sensitive).toBe(true)
  })

  it('supports bounded Todo writes through the shared application boundary', () => {
    const { threadId } = hierarchy()
    const todo = database.commands.createTodo({
      parent: { type: 'thread', id: threadId },
      name: 'Prepare review packet',
      dueDate: '2026-08-21'
    }, writable)
    expect(database.queries.getTodos(denied).items).toEqual([
      expect.objectContaining({ id: todo.id, name: 'Prepare review packet', done: false })
    ])

    const completed = database.commands.updateTodo(
      { id: todo.id, done: true }, writable, 'onmove.complete_todo'
    )
    expect(completed.done).toBe(true)
  })
})
