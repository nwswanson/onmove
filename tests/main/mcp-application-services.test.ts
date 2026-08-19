import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'
import type { OnMoveAccessPolicy } from '../../src/main/application/access-policy'
import {
  NoteRevisionConflictError,
  ScopeTargetValidationError
} from '../../src/main/application/services'
import type { OnMoveRichTextDocument } from '../../src/shared/rich-text-document'
import { RICH_TEXT_PREFIX, richTextPlainText } from '../../src/shared/rich-text-value'

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

function richText(text: string): OnMoveRichTextDocument {
  return {
    version: 1,
    blocks: [{ type: 'paragraph', children: [{ type: 'text', text }] }]
  }
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

  it('resolves a named hierarchy and limits its Subject to the target Scope', () => {
    const { focusId, threadId, commitmentId } = hierarchy()
    const scope = database.domain.threadScopes.addSubject(threadId, { name: 'Person Y' })
    const person = scope.subjects[0]
    database.domain.subjects.create({ name: 'Unrelated Person' })

    expect(database.queries.resolveTarget({
      focus: { title: 'project atlas' },
      thread: { title: 'sprint execution' },
      commitment: { title: 'verify delivery risks' },
      subject: { name: 'person y' }
    }, denied)).toMatchObject({
      status: 'resolved',
      candidates: [{
        parent: { type: 'commitment', id: commitmentId },
        hierarchy: {
          focus: { id: focusId, title: 'Project Atlas' },
          thread: { id: threadId, title: 'Sprint execution' },
          commitment: { id: commitmentId, title: 'Verify delivery risks' }
        },
        subject: { id: person.id, name: 'Person Y' },
        allowedSubjects: [{ id: person.id, name: 'Person Y' }]
      }]
    })
  })

  it('returns a typed Todo attribution failure that can be recovered without guessing', () => {
    const { threadId } = hierarchy()
    const unrelated = database.domain.subjects.create({ name: 'Unrelated Person' }).toSnapshot()

    try {
      database.commands.createTodo({
        parent: { type: 'thread', id: threadId },
        subjectId: unrelated.id,
        name: 'Do X'
      }, writable)
      throw new Error('Expected Open-parent Todo attribution to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(ScopeTargetValidationError)
      expect(error).toMatchObject({
        issue: {
          code: 'open_parent_cannot_target_subject',
          parent: { type: 'thread', id: threadId },
          subjectId: unrelated.id
        }
      })
      expect((error as Error).message).toContain('writeGuide.createTodo')
    }
  })

  it('updates a visible Note without flattening its rich text and audits only metadata', () => {
    const { threadId } = hierarchy()
    const note = database.domain.notes.list({ type: 'thread', id: threadId })[0]
    const formatted: OnMoveRichTextDocument = {
      version: 1,
      blocks: [{
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Person Y', marks: ['bold'], color: 'blue' },
          { type: 'text', text: ' has completed the ' },
          {
            type: 'link',
            url: 'https://example.com/readiness',
            children: [{ type: 'text', text: 'readiness review', marks: ['italic'] }]
          },
          { type: 'text', text: '.' }
        ]
      }]
    }
    expect(database.queries.getNote(note.id, denied)).toMatchObject({
      reference: { type: 'note', id: note.id },
      contextPath: [
        { type: 'focus', title: 'Project Atlas' },
        { type: 'thread', title: 'Sprint execution' }
      ],
      note: {
        id: note.id,
        content: '',
        revision: note.revision,
        richText: { version: 1, blocks: [] }
      }
    })

    const updated = database.commands.updateNote({
      id: note.id,
      expectedRevision: note.revision,
      document: formatted
    }, writable, 'note-test')
    expect(updated).toMatchObject({
      reference: { type: 'note', id: note.id, field: 'content' },
      revision: note.revision + 1
    })
    expect(richTextPlainText(updated.value)).toBe('Person Y has completed the readiness review.')
    expect(database.queries.getNote(note.id, denied)?.note).toMatchObject({
      content: 'Person Y has completed the readiness review.',
      richText: formatted,
      revision: note.revision + 1
    })

    try {
      database.commands.updateNote({
        id: note.id,
        expectedRevision: note.revision,
        document: richText('Stale replacement')
      }, writable)
      throw new Error('Expected a stale Note write to be rejected')
    } catch (error) {
      expect(error).toBeInstanceOf(NoteRevisionConflictError)
      expect(error).toMatchObject({
        issue: {
          noteId: note.id,
          expectedRevision: note.revision,
          currentRevision: note.revision + 1,
          parent: { type: 'thread', id: threadId }
        }
      })
    }
    expect(database.domain.notes.find(note.id)?.content).toBe(updated.value)
    expect(database.domain.notes.find(note.id)?.content).toContain('"type":"link"')
    expect(database.domain.notes.find(note.id)?.content).toContain('"format":1')

    const raw = new DatabaseSync(databasePath, { readOnly: true })
    const audit = raw.prepare(
      `SELECT tool_name, entity_type, entity_id, category, client_name
       FROM mcp_mutation_audit WHERE entity_type = 'note'`
    ).all()
    raw.close()
    expect(audit).toEqual([expect.objectContaining({
      tool_name: 'onmove.update_note',
      entity_type: 'note',
      entity_id: note.id,
      category: 'update',
      client_name: 'note-test'
    })])
    expect(JSON.stringify(audit)).not.toContain('readiness review')
  })

  it('treats a Note under a sensitive ancestor as unknown unless sensitive access is enabled', () => {
    const { focusId, threadId } = hierarchy()
    const note = database.domain.notes.list({ type: 'thread', id: threadId })[0]
    database.domain.focuses.requireModel(focusId).update({ sensitive: true })

    expect(database.queries.getNote(note.id, denied)).toBeNull()
    expect(() => database.commands.updateNote({
      id: note.id,
      expectedRevision: note.revision,
      document: richText('Hidden content')
    }, writable)).toThrow('Note')

    expect(database.commands.updateNote({
      id: note.id,
      expectedRevision: note.revision,
      document: richText('Authorized content')
    }, sensitiveWritable)).toMatchObject({ revision: note.revision + 1 })
  })
})
