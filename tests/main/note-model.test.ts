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
      type: 'ongoing',
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

  it('uses one versioned contract for Focus fields and Update observations', () => {
    const focus = database!.domain.focuses.create({ title: 'Unified documents' })
    const update = database!.domain.updates.create({ parent: { type: 'focus', id: focus.id } })

    const goal = database!.domain.richTextDocuments.save(
      { type: 'focus', id: focus.id, field: 'goal' },
      'Ship safely'
    )
    const description = database!.domain.richTextDocuments.save(
      { type: 'focus', id: focus.id, field: 'description' },
      'Working notes'
    )
    const observation = database!.domain.richTextDocuments.save(
      { type: 'update', id: update.id, field: 'observation' },
      'Quality improved'
    )

    expect(goal).toMatchObject({ title: 'Unified documents — Goal', revision: 1 })
    expect(description).toMatchObject({ value: 'Working notes', revision: 1 })
    expect(observation).toMatchObject({ value: 'Quality improved', revision: 1 })
    expect(database!.domain.focuses.requireModel(focus.id).toSnapshot()).toMatchObject({
      goal: 'Ship safely',
      description: 'Working notes'
    })
    expect(database!.domain.updates.requireModel(update.id).toSnapshot()).toMatchObject({
      observation: 'Quality improved'
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
