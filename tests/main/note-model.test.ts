import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../src/main/database'

describe('Note and durable rich-text models', () => {
  let directory: string
  let databasePath: string
  let database: AppDatabase | undefined

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'onmove-note-test-'))
    databasePath = join(directory, 'onmove.sqlite3')
    database = new AppDatabase(databasePath)
  })

  afterEach(() => {
    database?.close()
    database = undefined
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates one Default Note beneath every current work aggregate', () => {
    const focus = database!.domain.focuses.create({ title: 'Project execution' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const commitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality'
    })

    expect(focus.toSnapshot().notes).toMatchObject([
      { title: 'Default', parent: { type: 'focus', id: focus.id }, content: '', revision: 0 }
    ])
    expect(thread.snapshot().notes).toMatchObject([
      { title: 'Default', parent: { type: 'thread', id: thread.id }, content: '', revision: 0 }
    ])
    expect(commitment.snapshot().notes).toMatchObject([
      {
        title: 'Default',
        parent: { type: 'commitment', id: commitment.id },
        content: '',
        revision: 0
      }
    ])
  })

  it('allows a future aggregate to have no Notes without violating its parent model', () => {
    const focus = database!.domain.focuses.create({ title: 'Optional documents' })
    const [note] = focus.toSnapshot().notes

    expect(database!.domain.notes.delete(note.id)).toBe(true)
    expect(database!.domain.focuses.requireModel(focus.id).toSnapshot().notes).toEqual([])
  })

  it('commits every changed value synchronously and retains ordered revisions', () => {
    const focus = database!.domain.focuses.create({ title: 'Durable writing' })
    const [note] = focus.toSnapshot().notes
    const reference = { type: 'note', id: note.id, field: 'content' } as const

    expect(database!.domain.richTextDocuments.save(
      reference,
      'F',
      new Date('2026-08-09T12:00:00.000Z')
    )).toMatchObject({ value: 'F', revision: 1 })
    expect(database!.domain.richTextDocuments.save(
      reference,
      'First draft',
      new Date('2026-08-09T12:00:00.010Z')
    )).toMatchObject({ value: 'First draft', revision: 2 })
    expect(database!.domain.richTextDocuments.save(
      reference,
      'First draft',
      new Date('2026-08-09T12:00:00.020Z')
    )).toMatchObject({ value: 'First draft', revision: 2 })

    const reader = new DatabaseSync(databasePath, { readOnly: true })
    const current = reader.prepare(
      'SELECT content, content_revision AS revision FROM notes WHERE id = ?'
    ).get(note.id) as { content: string; revision: number }
    const history = reader.prepare(
      `SELECT revision, value FROM rich_text_history
       WHERE document_type = 'note-content' AND entity_id = ? ORDER BY revision`
    ).all(note.id)
    reader.close()

    expect(current).toMatchObject({ content: 'First draft', revision: 2 })
    expect(history).toEqual([
      { revision: 1, value: 'F' },
      { revision: 2, value: 'First draft' }
    ])
  })

  it('uses one versioned contract for Focus descriptions and Update observations', () => {
    const focus = database!.domain.focuses.create({ title: 'Unified documents' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Delivery',
      reviewFrequencyDays: 7
    })
    const update = database!.domain.updates.create({ parent: { type: 'thread', id: thread.id } })
    const description = database!.domain.richTextDocuments.save(
      { type: 'focus', id: focus.id, field: 'description' },
      'Working notes'
    )
    const observation = database!.domain.richTextDocuments.save(
      { type: 'update', id: update.id, field: 'observation' },
      'Quality improved'
    )

    expect(description).toMatchObject({ value: 'Working notes', revision: 1 })
    expect(observation).toMatchObject({ value: 'Quality improved', revision: 1 })
    expect(database!.domain.focuses.requireModel(focus.id).toSnapshot()).toMatchObject({
      description: 'Working notes'
    })
    expect(database!.domain.updates.requireModel(update.id).toSnapshot()).toMatchObject({
      observation: 'Quality improved'
    })
  })

  it('materializes typed hierarchy breadcrumbs without presentation-only leaf labels', () => {
    const focus = database!.domain.focuses.create({
      title: 'Project Atlas',
      sensitive: true
    })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Sprint execution',
      reviewFrequencyDays: 7
    })
    const threadedCommitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Improve ticket quality'
    })
    const overallCommitment = database!.domain.commitments.create({
      parent: { type: 'thread', id: thread.id },
      type: 'tracking',
      title: 'Keep sponsors aligned'
    })

    const noteContext = (noteId: number) => database!.domain.richTextDocuments.get({
      type: 'note',
      id: noteId,
      field: 'content'
    })

    expect(noteContext(focus.toSnapshot().notes[0].id)).toMatchObject({
      kind: 'note',
      context: [{ kind: 'focus', title: 'Project Atlas' }],
      subject: null,
      updateMetadata: null
    })
    expect(noteContext(thread.snapshot().notes[0].id).context).toEqual([
      { kind: 'focus', title: 'Project Atlas' },
      { kind: 'thread', title: 'Sprint execution' }
    ])
    expect(noteContext(threadedCommitment.snapshot().notes[0].id).context).toEqual([
      { kind: 'focus', title: 'Project Atlas' },
      { kind: 'thread', title: 'Sprint execution' },
      { kind: 'commitment', title: 'Improve ticket quality' }
    ])
    expect(noteContext(overallCommitment.snapshot().notes[0].id).context).toEqual([
      { kind: 'focus', title: 'Project Atlas' },
      { kind: 'thread', title: 'Sprint execution' },
      { kind: 'commitment', title: 'Keep sponsors aligned' }
    ])
    // Detached Notes are direct document reads, not collection projections;
    // a hidden-sensitive-content preference must never redact their contents.
    expect(noteContext(focus.toSnapshot().notes[0].id).title).toBe(
      'Project Atlas — Default Note'
    )
  })

  it('places an Update Subject after its typed owner hierarchy and exposes its metadata', () => {
    const focus = database!.domain.focuses.create({ title: 'Scoped project' })
    const subject = database!.domain.subjects.create({ kind: 'team', name: 'Platform Team' })
    const scope = database!.domain.scopes.create({
      focusId: focus.id,
      name: 'Teams',
      dimension: 'team'
    })
    database!.domain.scopeMemberships.create({
      scopeId: scope.id,
      subjectId: subject.id,
      effectiveFrom: '2026-01-01'
    })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Delivery',
      reviewFrequencyDays: 7,
      scope: { mode: 'explicit', scopeId: scope.id }
    })
    const update = database!.domain.updates.create({
      parent: { type: 'thread', id: thread.id },
      date: '2026-08-19',
      state: 'yellow',
      sensitive: true,
      scope: { scopeId: scope.id, subjectId: subject.id }
    })

    expect(database!.domain.richTextDocuments.get({
      type: 'update',
      id: update.id,
      field: 'observation'
    })).toMatchObject({
      kind: 'update',
      context: [
        { kind: 'focus', title: 'Scoped project' },
        { kind: 'thread', title: 'Delivery' }
      ],
      subject: { id: subject.id, name: 'Platform Team' },
      updateMetadata: { date: '2026-08-19', state: 'yellow', sensitive: true }
    })
  })

  it('cascades Notes and their revision history with deleted parents', () => {
    const focus = database!.domain.focuses.create({ title: 'Delete safely' })
    const thread = database!.domain.threads.create({
      focusId: focus.id,
      title: 'Child',
      reviewFrequencyDays: 7
    })
    const [note] = thread.snapshot().notes
    database!.domain.richTextDocuments.save(
      { type: 'note', id: note.id, field: 'content' },
      'Transient text'
    )

    expect(database!.domain.threads.delete(thread.id)).toBe(true)
    const reader = new DatabaseSync(databasePath, { readOnly: true })
    expect(reader.prepare('SELECT count(*) AS count FROM notes WHERE id = ?').get(note.id))
      .toMatchObject({ count: 0 })
    expect(reader.prepare(
      `SELECT count(*) AS count FROM rich_text_history
       WHERE document_type = 'note-content' AND entity_id = ?`
    ).get(note.id)).toMatchObject({ count: 0 })
    reader.close()
  })
})
